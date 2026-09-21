// analyze-company: one company, end to end. Reads the website, the
// Companies House register, the careers page and the confirmed ATS feeds,
// finds the people, runs the evidence pass, validates every fact against the
// page it cites, computes the signals and the score, writes the founder
// script on a manual run and queues the rest on the weekly refresh.
//
// Ported from He-Giveth's analyze-school (docs/TA-SEARCHER-BRIEF.md). The
// control flow, the degraded-run rules, the deferred pg_net pass and the
// "contacts are stored even when the model fails" rule are unchanged; the
// DfE record, the spend lookups, Ofsted, tenders and the pupil premium are
// gone, replaced by the register, the officers and the capital filings.
//
// POST { url, companyNumber?, companyName?, consultant?, isRefresh?, companyId?, pass?, prefetch? }

import { aiConfigured } from '../_shared/ai.ts';
import { claudeExtractionsTonight, extractionFallbackCap, extractWithClaude, extractWithGemini, ExtractionQuotaError, type ExtractionOutput } from '../_shared/facts/extract.ts';
import type { SourcePage } from '../_shared/facts/types.ts';
import { fingerprintParts, fingerprintStatements, reconcileFacts, stabiliseFacts, summaryFromFacts, validateFacts } from '../_shared/facts/validate.ts';
import { deriveLatestRaise, deriveStage } from '../_shared/facts/derive.ts';
import { computeSignals, normaliseTitle } from '../_shared/signals/compute.ts';
import { extractDepartures, fetchNewsPages, type NewsFetch } from '../_shared/facts/newsletters.ts';
import { computePropensity } from '../_shared/score/propensity.ts';
import { contactsForSignals, loadFundingNewsFacts, loadRegisterForSignals, loadVacanciesForSignals } from '../_shared/signals/load.ts';
import { applicablePersonas, buildCopyInput, copyIsStale, groupRolesByFamily, legacyScripts, storeCopy, type CopyContext } from '../_shared/copy/assemble.ts';
import { generatePersonaCopy } from '../_shared/copy/generate.ts';
import { consultantFromTag } from '../_shared/copy/reviews.ts';
import { logAiUsage, type UsageRecord } from '../_shared/copy/usage.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { identifyCaller } from '../_shared/auth.ts';

import { configureDatabaseFetch, fetchHomepage, fetchPage, htmlToText, wantedPages } from '../_shared/fetch.ts';
import { fetchContactPages } from '../_shared/contacts/pages.ts';
import { extractEmails, extractPeople, extractPhones, type EmailHit, type PersonHit, type PhoneHit } from '../_shared/contacts/extract.ts';
import { resolveContacts, stripTitle, type Contact } from '../_shared/contacts/resolve.ts';
import { applyModelContactReview, mergeProvidedContacts, toDecisionMaker, type DecisionMaker } from '../_shared/contacts/review.ts';
import { mergedContactsFor } from '../_shared/contacts/edits.ts';
import { isDefunctStatus, normaliseCompanyNumber, resolveCompanyRecord, sectorFromSic, syncRegisterDetails, type CompanyRecord, type Officer } from '../_shared/companies-house.ts';
import { todayIso } from '../_shared/dates.ts';
import { normaliseOrgName } from '../_shared/vacancies/employer-match.ts';
import { groundLlmVacancies } from '../_shared/vacancies/llm-grounding.ts';
import { boardSources, collectBoardVacancies, collectVacancies, mergeVacancies, persistVacancies, summariseRun, toCurrentVacancies, SOURCE_LABELS, type PersistedVacancy } from '../_shared/vacancies/pipeline.ts';
import type { CareersPageResult } from '../_shared/vacancies/source-careers-page.ts';
import type { AtsBoard, CompanyContext, VacancyRunSummary } from '../_shared/vacancies/types.ts';
import { boardUrlFor, confirmBoard, detectAtsBoards } from '../_shared/vacancies/ats-detect.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Manual analyses a signed-in user may start in an hour; refreshes from the cron run as the service role and are not counted. */
const USER_RATE_LIMIT = 10;

const NIGHTLY_COPY_CAP = Number(Deno.env.get('NIGHTLY_COPY_CAP') || 60);

/** The persona written inline on a manual analysis; the app asks generate-copy for the others. */
const FIRST_PERSONA = 'founder' as const;

interface AnalysisResult {
  summary: string;
  buyerIntentSignals: string[];
  decisionMakers: DecisionMaker[];
  recruitmentInsights: {
    currentVacancies: Array<Record<string, unknown>>;
    recruitmentPatterns: string;
  };
  coldCallScript: string;
  warmEmailScript: string;
}

function validateUrl(inputUrl: string): { valid: boolean; url?: string; error?: string } {
  try {
    let normalizedUrl = inputUrl;
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }
    const parsed = new URL(normalizedUrl);
    const hostname = parsed.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'Only HTTP and HTTPS URLs are allowed' };
    }
    // Never fetch an internal or private address.
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.match(/^172\.(1[6-9]|2[0-9]|3[01])\./) ||
      hostname.match(/^169\.254\./) ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.localhost') ||
      hostname.includes('metadata.google') ||
      hostname.includes('169.254.169.254')
    ) {
      return { valid: false, error: 'Internal or private network URLs are not allowed' };
    }
    if (normalizedUrl.length > 500) {
      return { valid: false, error: 'URL is too long (max 500 characters)' };
    }
    if (!hostname.includes('.') || hostname.length < 4) {
      return { valid: false, error: 'Invalid domain name' };
    }
    return { valid: true, url: normalizedUrl };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

/** Names like "Searchablehq" that came from a domain label, not a person or a company. */
function looksDomainDerived(name: string | null | undefined): boolean {
  if (!name) return true;
  return !/\s/.test(name.trim());
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

/** The register entry as the app stores it in analysis_result.companyRecord. */
function recordForResult(record: CompanyRecord | null): Record<string, unknown> | null {
  if (!record) return null;
  return { ...record, sector: sectorFromSic(record.sicCodes) };
}

/** Officers who have not resigned, as name-only people for the list. Directors are usually the founders. */
function officersAsContacts(officers: Officer[], companyNumber: string, existing: DecisionMaker[]): DecisionMaker[] {
  const named = new Set(existing.map((d) => String(d.name || '').toLowerCase().replace(/[^a-z]/g, '')));
  const out: DecisionMaker[] = [];
  for (const o of officers) {
    if (o.resignedOn) continue;
    if (!/director|member/i.test(o.role)) continue;
    const key = o.name.toLowerCase().replace(/[^a-z]/g, '');
    if (!key || named.has(key)) continue;
    named.add(key);
    out.push({
      name: o.name,
      role: `Director (Companies House${o.appointedOn ? `, appointed ${o.appointedOn}` : ''})`,
      email: '',
      confidence: 'role_only',
      source_url: `https://find-and-update.company-information.service.gov.uk/company/${companyNumber}/officers`,
      evidence: `Listed as ${o.role} on the Companies House register${o.appointedOn ? `, appointed ${o.appointedOn}` : ''}.`,
    } as DecisionMaker);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
  // A page the edge runtime cannot reach at the connection level is fetched
  // by the database's pg_net (see _shared/fetch.ts). Configured after the
  // body is read, below.
  configureDatabaseFetch(supabaseClient);

  // Who is asking: the service role (the weekly refresh) or a signed-in
  // user. Anyone else is refused before anything is fetched.
  const ident = await identifyCaller(req, supabaseClient);
  if (ident.reject) return ident.reject;
  const caller = ident.caller;

  // Lets the outer catch record a degraded run when the AI call or anything
  // after the homepage fetch throws.
  let recordFailedRun: ((error: string) => Promise<void>) | null = null;
  // Set once verified roles are persisted, so an AI failure afterwards still
  // records the run (not degraded: the roles data is complete).
  let pendingRun: { write: (error: string) => Promise<void> } | null = null;
  // Contacts are resolved before the AI call; if the AI step fails on the
  // refresh path they are still stored.
  let resolvedContacts: Contact[] | null = null;
  let contactsRun: Record<string, unknown> | null = null;
  // deno-lint-ignore no-explicit-any
  let refreshTarget: { id: string; analysis_result: any } | null = null;

  try {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON request body' }, 400);
    }

    const {
      url: inputUrl,
      companyNumber: inputCompanyNumber,
      companyName: inputCompanyName,
      consultant: inputConsultant,
      isRefresh: inputIsRefresh,
      companyId: inputCompanyId,
    } = body;
    const isRefresh = inputIsRefresh === true;
    // A run the queue dispatched arrives through pg_net, whose batch cannot
    // answer a fresh request until this run ends, so pages the edge cannot
    // reach are deferred: the run notes them, a follow-up row in the queue
    // has the dispatcher prefetch them, and the next pass (at most three)
    // reads them from the prefetch.
    const pass = Math.max(1, Math.min(9, Number(body.pass) || 1));
    const prefetchMap = body.prefetch && typeof body.prefetch === 'object' ? body.prefetch as Record<string, number> : null;
    const deferPages = caller.kind === 'service' && isRefresh;
    configureDatabaseFetch(supabaseClient, { prefetched: prefetchMap, defer: deferPages });
    const MAX_PASSES = 3;
    const queueNextPass = async (): Promise<number> => {
      const want = wantedPages();
      if (!deferPages || !want.length || pass >= MAX_PASSES || !companyId) return 0;
      const { prefetch: _drop, ...rest } = body as Record<string, unknown>;
      const carried = Object.keys(prefetchMap || {});
      const prefetchUrls = Array.from(new Set([...carried, ...want])).slice(0, 70);
      const payload = { ...rest, pass: pass + 1, prefetchUrls };
      const { data, error } = await supabaseClient.rpc('enqueue_analyze_company_batch', { payloads: [payload], target_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/analyze-company`, auth_token: '' });
      if (error) { console.error('follow-up pass not queued:', error.message); return 0; }
      console.log(`Pass ${pass}: ${want.length} page(s) deferred to pass ${pass + 1}`);
      return Number(data || 0);
    };
    const refreshConsultant = typeof inputConsultant === 'string' && inputConsultant.trim() ? inputConsultant.trim() : null;
    const nameOverride = typeof inputCompanyName === 'string' && inputCompanyName.trim() ? inputCompanyName.trim() : null;
    const companyId = typeof inputCompanyId === 'string' && /^[0-9a-f-]{36}$/i.test(inputCompanyId) ? inputCompanyId : null;

    if (!inputUrl) return json({ error: 'URL is required' }, 400);
    const urlValidation = validateUrl(inputUrl);
    if (!urlValidation.valid) return json({ error: urlValidation.error }, 400);
    const url = urlValidation.url!;

    // Ten manual analyses an hour per user, counted in a table rather than
    // in memory, so the weekly fan-out from one address never trips it.
    if (caller.kind === 'user') {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await supabaseClient.from('analyze_company_requests').select('id', { count: 'exact', head: true }).eq('user_id', caller.userId).gte('created_at', since).not('company_url', 'like', 'bulk:%');
      if ((count ?? 0) >= USER_RATE_LIMIT) {
        return new Response(
          JSON.stringify({ error: `You have started ${USER_RATE_LIMIT} analyses in the last hour. Wait a little and try again.` }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '600' } },
        );
      }
      await supabaseClient.from('analyze_company_requests').insert({ user_id: caller.userId, company_url: url });
    }

    // The Companies House number is optional: a company outside the register
    // (or added before the key was set) is analysed from its website alone.
    const companyNumber = normaliseCompanyNumber(typeof inputCompanyNumber === 'string' ? inputCompanyNumber : null);
    if (inputCompanyNumber && !companyNumber) return json({ error: 'The company number does not look like a Companies House number' }, 400);

    const today = new Date();
    const runStartedAt = today.toISOString();
    console.log('Starting analysis for URL:', url, 'company number:', companyNumber ?? 'none', companyId ? `(row ${companyId})` : '', isRefresh ? '[refresh]' : '');

    // Row identity: by id when the caller knows it, otherwise by url. The
    // refresh path never inserts and never rewrites company_name.
    // deno-lint-ignore no-explicit-any
    let existingRow: { id: string; company_name: string; url: string; company_number: string | null; analysis_result: any; evidence_fingerprint?: string | null } | null = null;
    if (companyId) {
      const { data, error } = await supabaseClient.from('company_searches').select('id, company_name, url, company_number, analysis_result, evidence_fingerprint').eq('id', companyId).maybeSingle();
      if (error) console.error('company_searches lookup by id failed:', error.message);
      existingRow = data ?? null;
    } else {
      const { data, error } = await supabaseClient.from('company_searches').select('id, company_name, url, company_number, analysis_result, evidence_fingerprint').eq('url', url).limit(1).maybeSingle();
      if (error) console.error('company_searches lookup by url failed:', error.message);
      existingRow = data ?? null;
    }
    if (isRefresh && existingRow) refreshTarget = { id: existingRow.id, analysis_result: existingRow.analysis_result };
    if (isRefresh && !existingRow) {
      return json({ error: 'Refresh requested for a company that is not in company_searches; refresh never inserts.' }, 404);
    }
    const effectiveNumber = companyNumber ?? normaliseCompanyNumber(existingRow?.company_number ?? null);
    // deno-lint-ignore no-explicit-any
    const previousVacancies: any[] = Array.isArray(existingRow?.analysis_result?.recruitmentInsights?.currentVacancies)
      ? existingRow!.analysis_result.recruitmentInsights.currentVacancies
      : [];
    // "Previous run found N" uses the last non-degraded run's count (a
    // degraded run records 0, which would let the next empty run close every
    // open row), falling back to the rows currently open.
    let previousRunCount = previousVacancies.length;
    if (existingRow) {
      const { data: lastGoodRun } = await supabaseClient
        .from('company_refresh_runs')
        .select('vacancies_found')
        .eq('company_search_id', existingRow.id)
        .eq('degraded', false)
        .not('finished_at', 'is', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastGoodRun && typeof lastGoodRun.vacancies_found === 'number') {
        previousRunCount = lastGoodRun.vacancies_found;
      } else {
        const { count } = await supabaseClient
          .from('vacancies')
          .select('id', { count: 'exact', head: true })
          .eq('company_search_id', existingRow.id)
          .eq('status', 'open');
        if (typeof count === 'number') previousRunCount = count;
      }
    }

    // The run row is written at the start (finished_at null) so the app can
    // show real progress, then filled in at the end.
    let runRowId: string | null = null;
    if (existingRow) {
      try {
        const { data: started } = await supabaseClient.from('company_refresh_runs').insert({
          company_search_id: existingRow.id, started_at: runStartedAt, finished_at: null, sources_tried: [], sources_ok: [], vacancies_found: 0, degraded: false, error: null,
          notes: { stage: 'started', caller: caller.kind },
        }).select('id').single();
        runRowId = started?.id ?? null;
      } catch (e) {
        console.error('company_refresh_runs start row failed:', e instanceof Error ? e.message : e);
      }
    }
    const setStage = async (stage: string) => {
      if (!runRowId) return;
      try {
        await supabaseClient.from('company_refresh_runs').update({ notes: { stage, caller: caller.kind, stageAt: new Date().toISOString() } }).eq('id', runRowId);
      } catch { /* progress only */ }
    };
    const writeRunRow = async (summary: VacancyRunSummary, error: string | null) => {
      if (!existingRow) return;
      const row = {
        company_search_id: existingRow.id,
        started_at: runStartedAt,
        finished_at: new Date().toISOString(),
        sources_tried: summary.sourcesTried,
        sources_ok: summary.sourcesOk,
        vacancies_found: summary.vacanciesFound,
        degraded: summary.degraded,
        error: error ? error.slice(0, 1000) : null,
        notes: { ...summary.notes, degradedReason: summary.degradedReason ?? null, stage: 'finished' },
      };
      try {
        if (runRowId) await supabaseClient.from('company_refresh_runs').update(row).eq('id', runRowId);
        else await supabaseClient.from('company_refresh_runs').insert(row);
      } catch (e) {
        console.error('company_refresh_runs write failed:', e instanceof Error ? e.message : e);
      }
    };

    recordFailedRun = (error: string) => writeRunRow({ sourcesTried: [], sourcesOk: [], vacanciesFound: 0, degraded: true, degradedReason: error, notes: {} }, error);

    // The register first: it needs nothing from the website, and the name
    // it holds is the name to search boards and news by.
    await setStage('record');
    const record = await resolveCompanyRecord(supabaseClient, { companyNumber: effectiveNumber, url, name: nameOverride ?? existingRow?.company_name ?? null });
    const trusted = record && record.verified ? record : null;
    let officers: Officer[] = [];
    let registerNote: Record<string, unknown> = { number: effectiveNumber, verified: !!trusted, note: record?.note ?? null };
    if (trusted && isDefunctStatus(trusted.status)) {
      console.warn(`${trusted.name} is ${trusted.status} on the register; nothing to refresh`);
      registerNote = { ...registerNote, defunct: true };
    }
    if (trusted && !isDefunctStatus(trusted.status)) {
      try {
        const synced = await syncRegisterDetails(supabaseClient, trusted.companyNumber, today);
        officers = synced.officers;
        registerNote = { ...registerNote, officers: synced.officers.length, newOfficers: synced.newOfficers.length, filings: synced.filings.length, newFilings: synced.newFilings.length };
      } catch (e) {
        console.warn('register details failed:', e instanceof Error ? e.message : e);
        registerNote = { ...registerNote, error: e instanceof Error ? e.message : String(e) };
      }
    }
    if (record && !trusted) console.warn(`Company number ${effectiveNumber} not verified: ${record.note}`);

    // Confirmed boards, read before the website so a dead site still gets its roles.
    let boards: AtsBoard[] = [];
    if (existingRow) {
      const { data: rows } = await supabaseClient.from('ats_boards').select('provider, slug, board_url').eq('company_search_id', existingRow.id).not('confirmed_at', 'is', null);
      boards = (rows || []).map((r: { provider: AtsBoard['provider']; slug: string; board_url: string | null }) => ({ provider: r.provider, slug: r.slug, boardUrl: r.board_url }));
    }

    // Homepage. The stored URL first, then scheme / www variants (see
    // _shared/fetch.ts); only when nothing answers is the run degraded.
    // A company recorded as blocking automated reading gets one quick try
    // and then the register and the boards only.
    const blocksReading = existingRow?.analysis_result?.websiteAccess === 'blocks automated reading';
    const homeFetch = blocksReading ? await fetchHomepage(url, 6000, 1, (u, ms) => ms <= 1 ? Promise.resolve({ url: u, finalUrl: u, status: 0, ok: false, html: '', error: 'skipped: blocks automated reading', ms: 0 }) : fetchPage(u, ms)) : await fetchHomepage(url, 15000, 8000);
    const home = homeFetch.page;
    const attemptsNote = homeFetch.attempts.map((a) => `${a.url} -> ${a.status}${a.via && a.via !== 'edge' ? ` via ${a.via}` : ''}${a.error ? ` (${a.error.slice(0, 70)})` : ''}`).join('; ');
    if (!home.ok || !home.html) {
      const reason = blocksReading
        ? `website blocks automated reading (HTTP ${home.status}); register and boards only`
        : `homepage fetch failed: HTTP ${home.status}${home.error ? ` (${home.error})` : ''}; tried: ${attemptsNote}`;
      console.error(reason);
      // The register, the officers and the confirmed boards need nothing from
      // the company's own website, so a company whose site is down still
      // gets them. The run stays degraded: careers-page roles are never
      // closed and no facts or copy are written.
      let offline: Awaited<ReturnType<typeof analyseWithoutWebsite>> | null = null;
      if (existingRow) {
        try {
          offline = await analyseWithoutWebsite(supabaseClient, {
            existingRow, url, today, runStartedAt, record, trusted, officers, boards,
            candidateNames: [nameOverride, existingRow.company_name, existingRow.analysis_result?.companyRecord?.name ?? null],
          });
        } catch (e) {
          console.error('no-website analysis failed:', e instanceof Error ? e.message : e);
        }
      }
      const nextPass = await queueNextPass();
      await writeRunRow({
        sourcesTried: offline?.sourcesTried ?? [], sourcesOk: offline?.sourcesOk ?? [], vacanciesFound: offline?.vacanciesFound ?? 0,
        degraded: true, degradedReason: reason,
        notes: { homepage: { stored: url, attempts: homeFetch.attempts }, register: registerNote, withoutWebsite: offline?.note ?? null, pass, nextPassQueued: nextPass > 0, deferredPages: wantedPages().length },
      }, reason);
      if (offline && existingRow) {
        const merged = { ...(existingRow.analysis_result || {}), ...offline.patch };
        const { error: updErr } = await supabaseClient.from('company_searches').update({ analysis_result: merged, updated_at: new Date().toISOString() }).eq('id', existingRow.id);
        if (updErr) console.error('could not store the no-website result:', updErr.message);
        else console.log(`Stored the register and ${offline.vacanciesFound} board roles for ${existingRow.company_name} although the website did not answer`);
      }
      return json({ error: `Could not fetch ${url}: ${reason}`, degraded: true, withoutWebsite: offline?.patch ?? null }, 502);
    }
    // The address that answered (after redirects) is the base for every other
    // fetch this run; the stored URL stays the row's identity.
    const siteUrl = (() => {
      try {
        const u = new URL(home.finalUrl || homeFetch.urlUsed);
        u.hash = '';
        u.search = '';
        return u.toString().replace(/\/+$/, '') || url;
      } catch {
        return url;
      }
    })();
    const homepageNote = { stored: url, used: homeFetch.urlUsed, final: siteUrl, usedVariant: homeFetch.usedVariant, via: home.via ?? 'edge', pass, suggestedUrl: siteUrl.toLowerCase() !== url.toLowerCase() ? siteUrl : null, attempts: homeFetch.attempts };
    if (homepageNote.suggestedUrl) console.log(`Homepage answered at ${siteUrl} (stored ${url}); tried: ${attemptsNote}`);
    if (home.via && home.via !== 'edge') console.log(`Homepage answered via ${home.via}; tried: ${attemptsNote}`);
    const mainPageHtml = home.html;
    const mainPageText = htmlToText(mainPageHtml);
    console.log('Fetched main page, length:', mainPageText.length);

    // Company identity: the register first, the website title second, the domain last.
    const hostname = new URL(siteUrl).hostname.replace('www.', '');
    const domainName = toTitleCase(hostname.split('.')[0].replace(/-/g, ' '));
    const contentName = extractCompanyNameFromContent(mainPageHtml);
    const officialName = trusted?.name && !/\b(ltd|limited|plc|llp)\b/i.test(trusted.name)
      ? trusted.name
      : [nameOverride, existingRow?.company_name, contentName].find((n) => n && !looksDomainDerived(n))
        || contentName
        || trusted?.name
        || domainName;
    const aliases = Array.from(new Set(
      [contentName, nameOverride, existingRow?.company_name, trusted?.name, ...(trusted?.previousNames ?? [])]
        .filter((n): n is string => !!n && normaliseOrgName(n) !== normaliseOrgName(officialName)),
    ));
    console.log('Company record:', trusted ? `${trusted.name} [${trusted.companyNumber}] ${trusted.status} inc. ${trusted.incorporationDate} ${trusted.postcodeDistrict ?? ''}` : (record?.note ?? 'no number'), '| name:', officialName);

    // Contact and context pages: contact and people tiers always, blog and
    // news as budget allows, the careers host when it is elsewhere, up to two PDFs.
    await setStage('contacts');
    console.log('Fetching contact and context pages...');
    // The latest news and blog pages, read alongside the contact pages, for
    // staff departures and arrivals (a separate small model call below).
    const newsPromise: Promise<NewsFetch> = fetchNewsPages({ siteUrl, homepageHtml: mainPageHtml });
    const site = await fetchContactPages({ siteUrl, homepageHtml: mainPageHtml });
    console.log(`Site pages: ${site.pages.length} (${site.notes.fetched.length} fetched, ${site.notes.skipped.length} skipped, careers host ${site.notes.careersHost ?? 'none'}, PDFs ${site.notes.pdfs.length}) in ${site.notes.ms}ms`);
    let combinedText = mainPageText;
    for (const p of site.pages) if (p.tier !== 'home' && p.level === 'company') combinedText += '\n\n' + p.text;
    console.log('Subpage fetching complete, total length:', combinedText.length);
    const scrapedTextForGrounding = combinedText;

    // ATS boards: anything the homepage or the fetched pages link to that is
    // not already confirmed is checked once and stored; a feed is read only
    // for a confirmed slug.
    await setStage('vacancies');
    const detected = new Map<string, AtsBoard>();
    for (const b of detectAtsBoards(mainPageHtml, siteUrl)) detected.set(`${b.provider}:${b.slug}`, b);
    for (const p of site.pages) if (p.html) for (const b of detectAtsBoards(p.html, p.url)) detected.set(`${b.provider}:${b.slug}`, b);
    const boardsNote: Record<string, unknown> = { confirmed: boards.map((b) => `${b.provider}:${b.slug}`), detected: Array.from(detected.keys()) };
    for (const b of detected.values()) {
      if (boards.some((x) => x.provider === b.provider && x.slug === b.slug)) continue;
      const check = await confirmBoard(b, officialName);
      if (existingRow) {
        await supabaseClient.from('ats_boards').upsert({
          company_search_id: existingRow.id, provider: b.provider, slug: b.slug, board_url: b.boardUrl,
          confirmed_at: check.ok ? new Date().toISOString() : null, last_checked_at: new Date().toISOString(), last_ok_at: check.ok ? new Date().toISOString() : null, last_count: check.ok ? check.count : null, note: check.note,
        }, { onConflict: 'company_search_id,provider' });
      }
      if (check.ok) boards.push(b);
      console.log(`Board ${b.provider}/${b.slug}: ${check.ok ? `confirmed, ${check.count} roles` : `not confirmed (${check.note})`}`);
    }

    // Contacts: regex and structure first; the model only reviews the joins.
    const contactsStarted = Date.now();
    const allEmails: EmailHit[] = [];
    const allPeople: PersonHit[] = [];
    const allPhones: PhoneHit[] = [];
    const careersPageUrls = new Set<string>();
    for (const p of site.pages) {
      const src = p.html || p.text;
      if (p.level === 'careers') careersPageUrls.add(p.url);
      allEmails.push(...extractEmails(src, p.url));
      allPeople.push(...extractPeople(src, p.url));
      if (p.tier === 'home' || p.tier === 'contact') allPhones.push(...extractPhones(src, p.url));
    }
    const suppressedEmails = new Set<string>();
    const suppressedNames = new Set<string>();
    if (existingRow) {
      const { data: fb } = await supabaseClient.from('contact_feedback').select('email, contact_name').eq('company_search_id', existingRow.id);
      for (const f of fb || []) {
        if (f.email) suppressedEmails.add(String(f.email).toLowerCase());
        if (f.contact_name) suppressedNames.add(stripTitle(String(f.contact_name)).toLowerCase().replace(/[^a-z]/g, ''));
      }
    }
    // Current directors from the register join the people list as name only
    // (a website entry with the same name gains the register note instead).
    const recordOfficers = officers
      .filter((o) => !o.resignedOn && /director|member/i.test(o.role))
      .map((o) => ({ name: o.name, jobTitle: 'Director', source: 'Companies House register', appointedOn: o.appointedOn }));
    const resolved = resolveContacts({ emails: allEmails, people: allPeople, phones: allPhones, siteHost: new URL(siteUrl).hostname, careersPageUrls, suppressedEmails, suppressedNames, recordOfficers, companyName: officialName });
    resolvedContacts = resolved.contacts;
    const uniqueEmails = Array.from(new Set(allEmails.map((e) => e.email)));
    contactsRun = {
      at: runStartedAt,
      pagesFetched: site.notes.fetched,
      pagesSkipped: site.notes.skipped.length,
      pagesTruncated: site.notes.truncated,
      careersHost: site.notes.careersHost ?? null,
      pdfs: site.notes.pdfs,
      emailsFound: uniqueEmails.length,
      peopleFound: allPeople.length,
      patternNote: resolved.patternNote,
      officePhone: resolved.officePhone,
      officers: officers.filter((o) => !o.resignedOn).length,
      ms: site.notes.ms + (Date.now() - contactsStarted),
    };
    console.log(`Contacts: ${uniqueEmails.length} addresses, ${allPeople.length} people, ${resolved.contacts.length} contacts (${resolved.contacts.filter((c) => c.confidence === 'found').length} found, ${resolved.contacts.filter((c) => c.confidence === 'pattern_guess').length} pattern guesses, ${resolved.contacts.filter((c) => c.confidence === 'role_only').length} name only)`);
    const otherEmails = allEmails.filter((e) => !resolved.contacts.some((c) => c.email === e.email)).slice(0, 15);
    const contactsBlock = resolved.contacts.length === 0 && otherEmails.length === 0
      ? '(none found)'
      : [
        ...resolved.contacts.map((c, i) => `${i + 1}. name: "${c.name}" | role: "${c.role}" | email: "${c.email}" | confidence: ${c.confidence} | source: ${c.source_url} | evidence: "${(c.evidence || '').slice(0, 160)}"`),
        ...(otherEmails.length ? ['Other addresses found on the pages (unassigned):', ...otherEmails.map((e) => `- ${e.email} | context: "${(e.context || '').slice(0, 120)}" | source: ${e.source_url}`)] : []),
      ].join('\n');

    // The context every source reads.
    const ctx: CompanyContext = {
      companySearchId: existingRow?.id ?? null,
      companyNumber: trusted?.companyNumber ?? effectiveNumber,
      name: officialName,
      aliases,
      url: siteUrl,
      postcodeDistrict: trusted?.postcodeDistrict ?? null,
      record: trusted,
      boards,
    };

    // Open roles: the confirmed feeds and the careers page.
    await setStage('vacancies');
    console.log('Collecting open roles...');
    const sourceResults = await collectVacancies(supabaseClient, ctx, mainPageHtml, today);
    // A board the careers page itself links to (not the homepage) is
    // confirmed now and read in the same run.
    const careersResult = sourceResults.find((r) => r.source === 'careers_page') as (CareersPageResult | undefined);
    for (const b of careersResult?.detectedBoards ?? []) {
      if (boards.some((x) => x.provider === b.provider && x.slug === b.slug)) continue;
      if (detected.has(`${b.provider}:${b.slug}`)) continue;
      detected.set(`${b.provider}:${b.slug}`, b);
      const check = await confirmBoard(b, officialName);
      if (existingRow) {
        await supabaseClient.from('ats_boards').upsert({
          company_search_id: existingRow.id, provider: b.provider, slug: b.slug, board_url: b.boardUrl,
          confirmed_at: check.ok ? new Date().toISOString() : null, last_checked_at: new Date().toISOString(), last_ok_at: check.ok ? new Date().toISOString() : null, last_count: check.ok ? check.count : null, note: check.note,
        }, { onConflict: 'company_search_id,provider' });
      }
      console.log(`Board ${b.provider}/${b.slug} (from the careers page): ${check.ok ? `confirmed, ${check.count} roles` : `not confirmed (${check.note})`}`);
      if (check.ok) {
        boards.push(b);
        sourceResults.push(...await Promise.all(boardSources([b], today)));
      }
    }
    // Nothing linked from the pages (a careers page that builds its job list
    // in the browser, as Searchable's does): try each provider with the
    // company's own name as the slug, once, and keep whatever answers.
    if (!boards.length && !detected.size) {
      const label = hostname.split('.')[0].toLowerCase();
      const compact = officialName.toLowerCase().replace(/\b(ltd|limited|plc|llp|inc)\b/g, '').replace(/[^a-z0-9]+/g, '');
      const dashed = officialName.toLowerCase().replace(/\b(ltd|limited|plc|llp|inc)\b/g, '').trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const slugs = Array.from(new Set([label, compact, dashed].filter((x) => x.length >= 3)));
      const guessed: string[] = [];
      for (const provider of ['ashby', 'greenhouse', 'lever', 'workable'] as const) {
        for (const slug of slugs) {
          const b: AtsBoard = { provider, slug, boardUrl: boardUrlFor(provider, slug) };
          const check = await confirmBoard(b, officialName);
          // A guessed slug is only trusted when the feed names no other company.
          if (!check.ok || check.nameMatch === false) continue;
          guessed.push(`${provider}:${slug}`);
          if (existingRow) {
            await supabaseClient.from('ats_boards').upsert({
              company_search_id: existingRow.id, provider, slug, board_url: b.boardUrl,
              confirmed_at: new Date().toISOString(), last_checked_at: new Date().toISOString(), last_ok_at: new Date().toISOString(), last_count: check.count, note: `guessed from the company name; ${check.note ?? 'confirmed'}`,
            }, { onConflict: 'company_search_id,provider' });
          }
          boards.push(b);
          sourceResults.push(...await Promise.all(boardSources([b], today)));
          console.log(`Board ${provider}/${slug} (guessed from the name): confirmed, ${check.count} roles`);
          break;
        }
      }
      (boardsNote as Record<string, unknown>).guessed = guessed;
    }
    (boardsNote as Record<string, unknown>).detected = Array.from(detected.keys());
    for (const r of sourceResults) console.log(`  ${r.source}: ${r.ok ? 'ok' : 'FAILED'} ${r.vacancies.length} found in ${r.ms}ms${r.note ? ` (${r.note})` : ''}`);
    const verifiedCandidates = sourceResults.flatMap((r) => r.vacancies);
    const verifiedMerge = mergeVacancies(verifiedCandidates, ctx, today);
    console.log(`Verified roles after merge: ${verifiedMerge.kept.length} (dropped ${verifiedMerge.dropped.length})`);

    // Role truth does not depend on the AI: persist the verified list now.
    let persisted: PersistedVacancy[] | null = null;
    let runError: string | null = null;
    const companyNote = trusted ? { name: trusted.name, number: trusted.companyNumber, status: trusted.status, incorporated: trusted.incorporationDate, postcodeDistrict: trusted.postcodeDistrict } : (record ? { number: record.companyNumber, verified: false, note: record.note } : null);
    const preSummary = summariseRun(sourceResults, verifiedMerge.kept, true, previousRunCount, { stage: 'pre-ai', company: companyNote, nameForSearch: officialName, homepage: homepageNote, register: registerNote, boards: boardsNote });
    if (existingRow) {
      try {
        persisted = await persistVacancies(supabaseClient, verifiedMerge.kept, { companySearchId: existingRow.id, today, degraded: preSummary.degraded, closeSources: sourceResults.filter((r) => r.ok).map((r) => r.source) });
      } catch (e) {
        runError = `persist failed: ${e instanceof Error ? e.message : String(e)}`;
        console.error(runError);
      }
    }
    recordFailedRun = null;
    pendingRun = { write: (error: string) => writeRunRow(preSummary, [runError, error].filter(Boolean).join('; ')) };

    // ---- Evidence pass, signals, summary, copy ------------------------------
    // Pages for the extractor, labelled by URL: contact and people pages first
    // (the contact block), then the homepage, PDFs, about, news, careers.
    const tierOrder: Record<string, number> = { contact: 0, people: 1, home: 2, pdf: 3, about: 4, context: 5, news: 5, careers: 6 };
    const sourcePages: SourcePage[] = [...site.pages]
      .sort((a, b) => (tierOrder[a.tier] ?? 9) - (tierOrder[b.tier] ?? 9))
      .map((p) => ({ url: p.url, text: p.text }));
    const verifiedForModel = verifiedMerge.kept.map((v) => ({ title: v.title, source: v.sources.map((s) => SOURCE_LABELS[s]).join(', '), url: v.url || null, department: v.department || null, location: v.location || null }));
    const recordForModel = trusted ? { name: trusted.name, companyNumber: trusted.companyNumber, status: trusted.status, incorporationDate: trusted.incorporationDate, sicCodes: trusted.sicCodes, sector: sectorFromSic(trusted.sicCodes), registeredOffice: trusted.registeredOffice, previousNames: trusted.previousNames, directors: officers.filter((o) => !o.resignedOn).map((o) => o.name) } : null;

    if (!aiConfigured() && !Deno.env.get('ANTHROPIC_API_KEY')) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    await setStage('evidence');
    console.log('Evidence pass: calling the extraction model...');
    const extractionInput = { companyName: officialName, record: recordForModel, vacancies: verifiedForModel, contactsBlock, pages: sourcePages, maxChars: 60000 };
    let extraction: ExtractionOutput;
    try {
      extraction = await extractWithGemini(extractionInput);
    } catch (e) {
      if (e instanceof ExtractionQuotaError && Deno.env.get('ANTHROPIC_API_KEY')) {
        await logAiUsage(supabaseClient, { provider: 'gemini', model: 'gemini-3.6-flash', purpose: 'evidence', companySearchId: existingRow?.id ?? null, inputTokens: 0, outputTokens: 0, ok: false, error: e.message });
        // The Claude fallback is capped per night so a free-tier Gemini key
        // cannot quietly move the whole refresh onto a paid model.
        const used = await claudeExtractionsTonight(supabaseClient);
        const EXTRACTION_FALLBACK_CAP = extractionFallbackCap();
        if (used >= EXTRACTION_FALLBACK_CAP) {
          console.warn(`Evidence pass: Gemini refused (${e.message}) and the Claude fallback cap (${EXTRACTION_FALLBACK_CAP} tonight) is spent`);
          throw new Error(`AI rate limit exceeded (Gemini quota; Claude extraction fallback cap of ${EXTRACTION_FALLBACK_CAP} reached tonight)`);
        }
        console.warn(`Evidence pass: Gemini refused (${e.message}); falling back to Claude Sonnet (${used + 1} of ${EXTRACTION_FALLBACK_CAP} tonight)`);
        extraction = await extractWithClaude(extractionInput);
      } else {
        throw e;
      }
    }
    await logAiUsage(supabaseClient, { provider: extraction.usage.provider, model: extraction.usage.model, purpose: 'evidence', companySearchId: existingRow?.id ?? null, inputTokens: extraction.usage.inputTokens, cachedInputTokens: extraction.usage.cachedInputTokens, outputTokens: extraction.usage.outputTokens, durationMs: extraction.usage.durationMs, ok: true, details: { pagesShown: extraction.pagesShown.length, rawFacts: extraction.facts.length } });
    console.log(`Evidence pass (${extraction.usage.model}): ${extraction.facts.length} raw facts, ${extraction.vacancies.length} role titles, ${extraction.contactReview.length} contacts reviewed, ${extraction.usage.inputTokens} in / ${extraction.usage.outputTokens} out, ${extraction.usage.durationMs}ms`);

    // Departures pass: the news and blog pages, when the site has them, go
    // through a second, smaller call that records staff departures and
    // arrivals only. A quota refusal skips the pass; nothing else is lost.
    const news = await newsPromise;
    let departuresNote: Record<string, unknown> = { entries: news.notes.entries.length, pages: news.notes.fetched, skipped: news.notes.skipped.slice(0, 5), ms: news.notes.ms };
    if (news.pages.length) {
      await setStage('news');
      try {
        const dep = await extractDepartures(officialName, news.pages);
        await logAiUsage(supabaseClient, { provider: dep.usage.provider, model: dep.usage.model, purpose: 'departures', companySearchId: existingRow?.id ?? null, inputTokens: dep.usage.inputTokens, cachedInputTokens: dep.usage.cachedInputTokens, outputTokens: dep.usage.outputTokens, durationMs: dep.usage.durationMs, ok: true, details: { pages: news.pages.length, rawFacts: dep.facts.length } });
        console.log(`Departures pass: ${dep.facts.length} raw staff changes from ${news.pages.length} page(s), ${dep.usage.inputTokens} in / ${dep.usage.outputTokens} out, ${dep.usage.durationMs}ms`);
        extraction.facts.push(...dep.facts);
        sourcePages.push(...news.pages);
        departuresNote = { ...departuresNote, rawFacts: dep.facts.length, model: dep.usage.model };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`Departures pass skipped: ${msg}`);
        await logAiUsage(supabaseClient, { provider: 'gemini', model: 'gemini-2.5-flash', purpose: 'departures', companySearchId: existingRow?.id ?? null, inputTokens: 0, outputTokens: 0, ok: false, error: msg });
        departuresNote = { ...departuresNote, error: msg.slice(0, 120) };
      }
    }

    // Validate: a fact survives only when its quote is on the cited page.
    const validation = validateFacts(extraction.facts, sourcePages, today);
    let facts = validation.facts;
    let factsMatched = 0;
    let factsCarried = 0;
    let factsRetired: string[] = [];
    let factsUnverified: string[] = [];
    if (existingRow) {
      try {
        const { data: prior } = await supabaseClient.from('company_facts').select('statement_key, kind, statement, quote, source_url, date_hint, last_seen').eq('company_search_id', existingRow.id).eq('active', true).order('last_seen', { ascending: false }).limit(120);
        const stabilised = stabiliseFacts(facts, prior || []);
        facts = stabilised.facts;
        factsMatched = stabilised.matched;
        const reconciled = reconcileFacts(facts, prior || [], sourcePages, today);
        facts = reconciled.active;
        factsCarried = reconciled.carried;
        factsRetired = reconciled.retired;
        factsUnverified = reconciled.unverified;
      } catch (e) {
        console.warn('fact reconciliation skipped:', e instanceof Error ? e.message : e);
      }
    }
    console.log(`Facts: ${validation.facts.length} validated tonight (${factsMatched} matched stored), ${factsCarried} carried over from earlier runs, ${factsRetired.length} retired, ${validation.dropped.length} dropped; ${facts.length} active`);
    for (const d of validation.dropped) console.log(`  ✗ fact dropped (${d.reason}): "${d.statement.slice(0, 80)}"`);

    // Model-read role titles count only when the title is on the site verbatim.
    const aiVacancies = extraction.vacancies.map((v) => ({ title: v.title, startDate: v.startDate || '', endDate: v.endDate || '', url: v.url || '' }));
    // deno-lint-ignore no-explicit-any
    const grounding = groundLlmVacancies(aiVacancies as any[], scrapedTextForGrounding, verifiedMerge.kept, today);
    console.log(`AI roles: ${aiVacancies.length}, grounded: ${grounding.accepted.length}, rejected: ${grounding.rejected.length}`);
    for (const r of grounding.rejected) console.log(`  ✗ AI role rejected (${r.reason}): "${r.title}"`);

    const finalMerge = mergeVacancies([...verifiedCandidates, ...grounding.accepted], ctx, today);
    for (const d of finalMerge.dropped) console.log(`  ✗ dropped (${d.reason}) [${d.source}]: "${d.title}"`);
    const summary: VacancyRunSummary = {
      ...summariseRun(sourceResults, finalMerge.kept, true, previousRunCount, {
        dropped: finalMerge.dropped.slice(0, 50),
        llmRejected: grounding.rejected.slice(0, 50),
        company: companyNote,
        nameForSearch: officialName,
        homepage: homepageNote,
        register: registerNote,
        boards: boardsNote,
        evidence: { model: extraction.usage.model, rawFacts: extraction.facts.length, validated: validation.facts.length, active: facts.length, matchedStored: factsMatched, carried: factsCarried, retired: factsRetired.length, unverified: factsUnverified.length, dropped: validation.dropped.slice(0, 40) },
        news: departuresNote,
      }),
      degraded: preSummary.degraded,
      degradedReason: preSummary.degradedReason,
    };
    if (summary.degraded) console.warn(`Run is DEGRADED: ${summary.degradedReason}`);

    if (existingRow && grounding.accepted.length > 0 && !summary.degraded) {
      try {
        persisted = await persistVacancies(supabaseClient, finalMerge.kept, { companySearchId: existingRow.id, today, degraded: false, closeSources: sourceResults.filter((r) => r.ok).map((r) => r.source) });
      } catch (e) {
        runError = `persist (ai) failed: ${e instanceof Error ? e.message : String(e)}`;
        console.error(runError);
      }
    }

    const result: AnalysisResult = {
      summary: '',
      buyerIntentSignals: [],
      decisionMakers: [],
      recruitmentInsights: { currentVacancies: [], recruitmentPatterns: '' },
      coldCallScript: '',
      warmEmailScript: '',
    };
    if (summary.degraded && existingRow) {
      result.recruitmentInsights.currentVacancies = previousVacancies;
    } else if (persisted) {
      result.recruitmentInsights.currentVacancies = toCurrentVacancies(persisted) as unknown as Array<Record<string, unknown>>;
    } else {
      result.recruitmentInsights.currentVacancies = finalMerge.kept.map((v) => ({
        title: v.title,
        url: v.url || v.pageUrl || undefined,
        source: v.source,
        sourceLabel: SOURCE_LABELS[v.source],
        firstSeen: v.datePosted && v.datePosted < todayIso(today) ? v.datePosted : todayIso(today),
        datePosted: v.datePosted || null,
        department: v.department || null,
        location: v.location || null,
        workplaceType: v.workplaceType || null,
      }));
    }
    console.log(`Final roles: ${result.recruitmentInsights.currentVacancies.length}`);
    // deno-lint-ignore no-explicit-any
    const out = result as any;
    out.companyRecord = recordForResult(trusted ?? record ?? null);
    out.officers = officers;
    out.boards = boards;
    out.vacancyRun = {
      at: runStartedAt,
      degraded: summary.degraded,
      degradedReason: summary.degradedReason ?? null,
      sourcesOk: summary.sourcesOk,
      sourcesTried: summary.sourcesTried,
    };

    // Decision makers: the resolved contacts (the register's directors among
    // them), with the model's review applied and the consultants' own
    // contacts merged in.
    // deno-lint-ignore no-explicit-any
    result.decisionMakers = mergeProvidedContacts(applyModelContactReview(resolved.contacts, allEmails, extraction.contactReview as any[]), existingRow?.analysis_result?.decisionMakers);
    out.contactsRun = { ...contactsRun, modelReviewed: true };
    console.log('Decision makers after model review:', result.decisionMakers.length);

    // Facts table: upsert active facts, retire the ones no longer seen.
    if (existingRow) {
      try {
        const unverified = new Set(factsUnverified);
        const rows = facts.filter((f) => !unverified.has(f.statement_key)).map((f) => ({ company_search_id: existingRow!.id, statement_key: f.statement_key, kind: f.kind, statement: f.statement, quote: f.quote, source_url: f.source_url, date_hint: f.date_hint, last_seen: todayIso(today), active: true }));
        if (rows.length) {
          const { error } = await supabaseClient.from('company_facts').upsert(rows, { onConflict: 'company_search_id,statement_key' });
          if (error) console.error('company_facts upsert failed:', error.message);
        }
        if (factsRetired.length) {
          const { error: e2 } = await supabaseClient.from('company_facts').update({ active: false }).eq('company_search_id', existingRow.id).in('statement_key', factsRetired);
          if (e2) console.error('company_facts retire failed:', e2.message);
        }
      } catch (e) {
        console.error('company_facts write failed:', e instanceof Error ? e.message : e);
      }
    }

    await setStage('signals');
    // Signals: computed from the facts, the role rows, the register and the
    // contacts. Never asked for.
    const vacancyRows = existingRow ? await loadVacanciesForSignals(supabaseClient, existingRow.id) : {
      open: finalMerge.kept.map((v, i) => ({ id: `new${i}`, title: v.title, firstSeen: v.datePosted && v.datePosted < todayIso(today) ? v.datePosted : todayIso(today), closingDate: v.closingDate || null, source: v.source, url: v.url || null, department: v.department || null, location: v.location || null, advertText: null })),
      closed: [],
    };
    const register = trusted ? await loadRegisterForSignals(supabaseClient, trusted.companyNumber) : null;
    // Funding news (slice 2): the stories matched to this company join the
    // facts the signals, the stage, the latest raise and the copy read.
    // They are not page facts: company_facts was written above without
    // them, and out.facts stays the page's list.
    const newsFacts = existingRow ? await loadFundingNewsFacts(supabaseClient, existingRow.id, today) : [];
    const factsWithNews = newsFacts.length ? [...facts, ...newsFacts] : facts;
    if (newsFacts.length) console.log(`Funding news: ${newsFacts.length} matched stor${newsFacts.length === 1 ? 'y' : 'ies'} joined the facts`);
    const signals = computeSignals({ today, facts: factsWithNews, openVacancies: vacancyRows.open, closedVacancies: vacancyRows.closed, register, contacts: contactsForSignals(result.decisionMakers) });
    console.log(`Signals: ${signals.map((s) => `${s.code}(${s.strength})`).join(', ') || 'none'}`);
    if (existingRow) {
      try {
        await supabaseClient.from('company_signals').delete().eq('company_search_id', existingRow.id);
        if (signals.length) {
          const { error } = await supabaseClient.from('company_signals').insert(signals.map((s) => ({ company_search_id: existingRow!.id, code: s.code, label: s.label, strength: s.strength, evidence: s.evidence, explanation: s.explanation, computed_at: new Date().toISOString() })));
          if (error) console.error('company_signals insert failed:', error.message);
        }
      } catch (e) {
        console.error('company_signals write failed:', e instanceof Error ? e.message : e);
      }
      // The score, from tonight's signals and the call outcomes of the last
      // 120 days. refresh-scores recomputes every company daily; this keeps
      // the row current the moment a company is analysed.
      try {
        const since = new Date(today.getTime() - 120 * 86400000).toISOString();
        const { data: outcomeRows } = await supabaseClient.from('outcomes').select('kind, created_at, callback_at').eq('company_search_id', existingRow.id).gte('created_at', since).order('created_at', { ascending: false });
        // deno-lint-ignore no-explicit-any
        const propensity = computePropensity({ today, signals: signals.map((s) => ({ code: s.code, label: s.label, strength: s.strength, explanation: s.explanation })), outcomes: (outcomeRows || []).map((o: any) => ({ kind: o.kind, createdAt: o.created_at, callbackAt: o.callback_at })), computedAt: new Date().toISOString() });
        const { error: scoreErr } = await supabaseClient.from('company_scores').upsert({ company_search_id: existingRow.id, score: propensity.score, breakdown: propensity.breakdown, top_reason: propensity.topReason, top_code: propensity.topCode, signals_computed_at: new Date().toISOString(), computed_at: new Date().toISOString() }, { onConflict: 'company_search_id' });
        if (scoreErr) console.error('company_scores upsert failed:', scoreErr.message);
        out.propensity = { score: propensity.score, topReason: propensity.topReason, topCode: propensity.topCode };
        console.log(`Propensity: ${propensity.score} (${propensity.topCode ?? 'no signal'})`);
      } catch (e) {
        console.error('propensity failed:', e instanceof Error ? e.message : e);
      }
    }

    // Evidence fingerprint: sorted active statements, open role keys, top three contacts.
    const openKeys = persisted ? persisted.filter((p) => p.status === 'open').map((p) => p.key) : finalMerge.kept.map((v) => v.url ? `url:${v.url}` : `title:${normaliseTitle(v.title)}`);
    const topContacts = result.decisionMakers.slice(0, 3).map((d) => d.name || '');
    const fp = await fingerprintParts({ statements: fingerprintStatements(facts), vacancyKeys: openKeys, contacts: topContacts });
    const fingerprint = fp.fingerprint;
    const previousFingerprint: string | null = existingRow ? existingRow.evidence_fingerprint ?? existingRow.analysis_result?.evidenceFingerprint ?? null : null;
    const previousParts = existingRow?.analysis_result?.evidence?.parts ?? null;
    const changedParts = previousParts ? (['facts', 'vacancies', 'contacts'] as const).filter((k) => previousParts[k] !== fp[k]) : ['first run'];
    if (existingRow) {
      const { error } = await supabaseClient.from('company_searches').update({ evidence_fingerprint: fingerprint, evidence_computed_at: new Date().toISOString() }).eq('id', existingRow.id);
      if (error) console.error('evidence_fingerprint update failed:', error.message);
    }

    // The fields the app reads, all derived from validated data.
    const stage = deriveStage(factsWithNews, trusted, today);
    const latestRaise = deriveLatestRaise(factsWithNews, today);
    out.stage = stage;
    out.latestRaise = latestRaise;
    const openCount = result.recruitmentInsights.currentVacancies.length;
    result.summary = summaryFromFacts({
      name: officialName,
      status: trusted?.status ?? null,
      incorporatedYear: trusted?.incorporationDate ? Number(trusted.incorporationDate.slice(0, 4)) : null,
      locality: trusted?.registeredOffice?.locality ?? null,
      sector: trusted ? sectorFromSic(trusted.sicCodes) : null,
      stageLabel: stage.label,
    }, facts, openCount);
    result.buyerIntentSignals = signals.map((s) => `${s.label}: ${s.explanation}`);
    result.recruitmentInsights.recruitmentPatterns = openCount === 0 && !summary.degraded
      ? 'No open roles found on the careers page or a job board.'
      : `${openCount} open role${openCount === 1 ? '' : 's'}: ${result.recruitmentInsights.currentVacancies.map((v) => String(v.title)).join('; ')}.`;
    out.facts = facts;
    out.signals = signals;
    out.evidenceFingerprint = fingerprint;
    out.evidence = { computedAt: new Date().toISOString(), model: extraction.usage.model, pagesShown: extraction.pagesShown, dropped: validation.dropped.length, matchedStored: factsMatched, carried: factsCarried, retired: factsRetired.length, previousFingerprint, changed: previousFingerprint !== fingerprint, changedParts, parts: { facts: fp.facts, vacancies: fp.vacancies, contacts: fp.contacts } };

    // Copy: on a manual analysis the founder persona is written now and
    // returned; the app asks generate-copy for the others afterwards. On the
    // weekly refresh, personas whose stored copy is stale under the
    // fingerprint rule are queued, subject to the nightly cap.
    // deno-lint-ignore no-explicit-any
    const existingCopy: Record<string, any> = existingRow?.analysis_result?.copy && typeof existingRow.analysis_result.copy === 'object' ? existingRow.analysis_result.copy : {};
    out.copy = { ...existingCopy };
    const copyCtx: CopyContext = {
      company: { name: officialName, record: trusted ? { companyNumber: trusted.companyNumber, status: trusted.status, incorporationDate: trusted.incorporationDate, locality: trusted.registeredOffice?.locality ?? null, sector: sectorFromSic(trusted.sicCodes) } : null, stage, latestRaise },
      // With the consultants' contact edits laid over, so the script names the corrected person.
      // deno-lint-ignore no-explicit-any
      contacts: (existingRow ? await mergedContactsFor(supabaseClient, existingRow.id, result.decisionMakers) : result.decisionMakers).map((d) => ({ name: d.name, role: d.role, email: d.email || undefined, confidence: (d as any).confidence })),
      signals,
      facts: factsWithNews,
      // deno-lint-ignore no-explicit-any
      openRoles: groupRolesByFamily(result.recruitmentInsights.currentVacancies.map((v: any) => ({ title: String(v.title || ''), department: v.department || null }))),
      consultant: consultantFromTag(refreshConsultant || existingRow?.analysis_result?.consultant || null),
      fingerprint,
    };
    const personas = applicablePersonas(copyCtx);
    let copyNote: Record<string, unknown> = {};
    if (!isRefresh) {
      const input = buildCopyInput(copyCtx, FIRST_PERSONA, today);
      try {
        await setStage('copy');
        const gen = await generatePersonaCopy(input, existingRow?.id ?? null);
        if (existingRow) {
          out.copy[FIRST_PERSONA] = await storeCopy(supabaseClient, existingRow.id, FIRST_PERSONA, gen, input.contact, fingerprint, 'manual');
        } else {
          out.copy[FIRST_PERSONA] = { persona: FIRST_PERSONA, copy: gen.copy, contact: input.contact, evidence_fingerprint: fingerprint, quality_flags: gen.qualityFlags, model: gen.model, trigger: 'manual', generated_at: new Date().toISOString() };
          for (const u of gen.usage) await logAiUsage(supabaseClient, u);
        }
        const legacy = legacyScripts(gen.copy);
        result.coldCallScript = legacy.coldCallScript;
        result.warmEmailScript = legacy.warmEmailScript;
        copyNote = { [FIRST_PERSONA]: 'generated', attempts: gen.attempts, flags: gen.qualityFlags };
        console.log(`Copy (${FIRST_PERSONA}): ${gen.attempts} attempt(s), flags: ${gen.qualityFlags.join('; ') || 'none'}`);
      } catch (e) {
        const usage = (e as { usage?: UsageRecord[] }).usage || [];
        for (const u of usage) await logAiUsage(supabaseClient, { ...u, companySearchId: existingRow?.id ?? null });
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`Copy (${FIRST_PERSONA}) failed:`, msg);
        copyNote = { [FIRST_PERSONA]: 'failed', error: msg };
        result.coldCallScript = existingRow?.analysis_result?.coldCallScript || '';
        result.warmEmailScript = existingRow?.analysis_result?.warmEmailScript || '';
      }
    } else if (existingRow) {
      result.coldCallScript = existingRow.analysis_result?.coldCallScript || '';
      result.warmEmailScript = existingRow.analysis_result?.warmEmailScript || '';
      const stale = personas.filter((p) => copyIsStale(existingCopy[p], fingerprint, today).stale);
      if (stale.length && !summary.degraded) {
        try {
          const { data: outcome, error } = await supabaseClient.rpc('enqueue_copy_generation', { p_company_id: existingRow.id, p_personas: stale, p_trigger: 'nightly', p_force: false, p_nightly_cap: NIGHTLY_COPY_CAP });
          if (error) throw error;
          copyNote = { queued: stale, outcome };
          if (outcome === 'capped') console.warn(`Copy queue: nightly cap of ${NIGHTLY_COPY_CAP} companies reached; ${officialName} not queued (${stale.join(', ')} stale)`);
          else console.log(`Copy queue: ${outcome} for ${officialName} (${stale.join(', ')})`);
        } catch (e) {
          copyNote = { queued: stale, error: e instanceof Error ? e.message : String(e) };
          console.error('enqueue_copy_generation failed:', e instanceof Error ? e.message : e);
        }
      } else {
        copyNote = { reused: personas, reason: summary.degraded ? 'degraded run' : 'evidence unchanged' };
      }
    }
    summary.notes.copy = copyNote;
    summary.notes.fingerprint = { current: fingerprint, previous: previousFingerprint, changed: previousFingerprint !== fingerprint, changedParts, signals: signals.map((s) => s.code) };
    const nextPassQueued = await queueNextPass();
    (summary as VacancyRunSummary & { notes: Record<string, unknown> }).notes = { ...(summary.notes || {}), pass, nextPassQueued: nextPassQueued > 0, deferredPages: wantedPages().length };
    await writeRunRow(summary, runError);
    pendingRun = null;

    // Refresh path: update the existing row in place. Never insert, never rename.
    if (isRefresh && existingRow) {
      try {
        // deno-lint-ignore no-explicit-any
        const resultToPersist: any = { ...(existingRow.analysis_result || {}), ...result };
        resultToPersist.consultant = refreshConsultant || existingRow.analysis_result?.consultant || null;
        const { error: updErr } = await supabaseClient
          .from('company_searches')
          .update({ analysis_result: resultToPersist, updated_at: new Date().toISOString() })
          .eq('id', existingRow.id);
        if (updErr) console.error('[isRefresh] update failed:', updErr.message);
        else console.log(`[isRefresh] Updated company_searches row ${existingRow.id} (${existingRow.company_name})`);
      } catch (persistErr) {
        console.error('[isRefresh] Failed to persist analysis result:', persistErr);
      }
    }

    return json(result);
  } catch (error) {
    console.error('Error in analyze-company function:', error);
    const errorMsg = error instanceof Error ? error.message : 'Internal server error';
    if (resolvedContacts && refreshTarget) {
      try {
        const merged = { ...(refreshTarget.analysis_result || {}), decisionMakers: mergeProvidedContacts(resolvedContacts.map(toDecisionMaker), refreshTarget.analysis_result?.decisionMakers), contactsRun: { ...contactsRun, modelReviewed: false, aiError: errorMsg.slice(0, 200) } };
        const { error: updErr } = await supabaseClient.from('company_searches').update({ analysis_result: merged, updated_at: new Date().toISOString() }).eq('id', refreshTarget.id);
        if (updErr) console.error('could not store contacts after AI failure:', updErr.message);
        else console.log(`Stored ${resolvedContacts.length} contacts for row ${refreshTarget.id} although the AI step failed`);
      } catch (e) {
        console.error('could not store contacts after AI failure:', e);
      }
    }
    if (pendingRun) {
      try { await pendingRun.write(`after roles were persisted: ${errorMsg}`); } catch (e) { console.error('could not record run:', e); }
    } else if (recordFailedRun) {
      try { await recordFailedRun(errorMsg); } catch (e) { console.error('could not record failed run:', e); }
    }
    return json({ error: errorMsg }, 500);
  }
});

/**
 * What can be known about a company without reading its website: the
 * register (already resolved by the caller), the officers and the confirmed
 * boards. Returns the fields to merge into analysis_result and the run notes.
 */
// deno-lint-ignore no-explicit-any
async function analyseWithoutWebsite(supabaseClient: any, input: {
  // deno-lint-ignore no-explicit-any
  existingRow: { id: string; company_name: string; url: string; company_number: string | null; analysis_result: any };
  url: string;
  today: Date;
  runStartedAt: string;
  record: CompanyRecord | null;
  trusted: CompanyRecord | null;
  officers: Officer[];
  boards: AtsBoard[];
  candidateNames: Array<string | null | undefined>;
}) {
  const { existingRow, url, today, runStartedAt, record, trusted, officers, boards } = input;
  const hostname = (() => { try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; } })();
  const name = (trusted?.name && !/\b(ltd|limited|plc|llp)\b/i.test(trusted.name) ? trusted.name : null)
    || input.candidateNames.find((n) => n && !looksDomainDerived(n))
    || trusted?.name
    || toTitleCase((hostname.split('.')[0] || existingRow.company_name).replace(/-/g, ' '));
  const aliases = Array.from(new Set(input.candidateNames.filter((n): n is string => !!n && normaliseOrgName(n) !== normaliseOrgName(name))));
  const ctx: CompanyContext = {
    companySearchId: existingRow.id,
    companyNumber: trusted?.companyNumber ?? record?.companyNumber ?? null,
    name,
    aliases,
    url,
    postcodeDistrict: trusted?.postcodeDistrict ?? null,
    record: trusted,
    boards,
  };
  console.log('No website. Register:', trusted ? `${trusted.name} [${trusted.companyNumber}] ${trusted.status}` : (record?.note ?? 'no number'), '| name:', name);

  const results = await collectBoardVacancies(supabaseClient, ctx, today);
  for (const r of results) console.log(`  ${r.source}: ${r.ok ? 'ok' : 'FAILED'} ${r.vacancies.length} found in ${r.ms}ms${r.note ? ` (${r.note})` : ''}`);
  const merge = mergeVacancies(results.flatMap((r) => r.vacancies), ctx, today);
  const okSources = results.filter((r) => r.ok).map((r) => r.source);
  let persisted: PersistedVacancy[] | null = null;
  try {
    persisted = await persistVacancies(supabaseClient, merge.kept, { companySearchId: existingRow.id, today, degraded: true, closeSources: okSources });
  } catch (e) {
    console.error('persist (no website) failed:', e instanceof Error ? e.message : e);
  }

  const previous = existingRow.analysis_result || {};
  const patch: Record<string, unknown> = {
    companyRecord: record ? recordForResult(trusted ?? record) : (previous.companyRecord ?? null),
    officers: officers.length ? officers : (previous.officers ?? []),
    boards,
    vacancyRun: { at: runStartedAt, degraded: true, degradedReason: 'homepage fetch failed', sourcesOk: okSources, sourcesTried: results.map((r) => r.source) },
  };
  if (persisted) patch.recruitmentInsights = { ...(previous.recruitmentInsights || {}), currentVacancies: toCurrentVacancies(persisted) };
  if (trusted && officers.length) {
    // Directors the website never named still belong in the list, as name only.
    // deno-lint-ignore no-explicit-any
    const dms: any[] = Array.isArray(previous.decisionMakers) ? previous.decisionMakers : [];
    const added = officersAsContacts(officers, trusted.companyNumber, dms);
    if (added.length) patch.decisionMakers = [...dms, ...added];
  }
  return {
    patch,
    sourcesTried: results.map((r) => r.source),
    sourcesOk: okSources,
    vacanciesFound: merge.kept.length,
    note: { company: trusted ? { name: trusted.name, number: trusted.companyNumber, status: trusted.status } : null, officers: officers.length, sources: Object.fromEntries(results.map((r) => [r.source, { ok: r.ok, found: r.vacancies.length, note: r.note }])) },
  };
}

/** The company's name from its own page: og:site_name first, then the title and the first heading, cleaned of taglines. */
function extractCompanyNameFromContent(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i,
    /<title[^>]*>([^<]+)<\/title>/i,
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match || !match[1]) continue;
    let name = match[1].replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
    // "Searchable | AI search visibility", "Home - Acme", "Acme: the tagline": keep the shortest side that is not a tagline word.
    const parts = name.split(/\s*[-|–—:·]\s*/).map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      const candidates = parts.filter((p) => !/^(home|welcome|homepage|website|official site)$/i.test(p) && p.split(/\s+/).length <= 4);
      name = (candidates.sort((a, b) => a.length - b.length)[0] ?? parts[0]);
    }
    name = name.replace(/\s+/g, ' ').trim();
    if (name.length >= 2 && name.length < 60 && !/^(home|welcome|homepage)$/i.test(name)) return name;
  }
  return null;
}

function toTitleCase(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
