// The new-roles alert (weekly, Friday 07:30 UTC, after the refresh).
//
// snapshot (05:00): no-op that records a pipeline_runs row. The comparison no
//   longer needs a copy of yesterday's list; it uses first_seen in `vacancies`.
// compare-and-alert (07:30): for each enabled new_vacancy config, "new" means
//   an open row in `vacancies` first seen today (or yesterday, if it was never
//   delivered to this config because the company was still refreshing) at a
//   company whose latest refresh run is fresh. A clean run makes every source
//   eligible; a degraded run (the website could not be read) makes only the
//   ATS feeds that answered eligible, so a company with a dead website still
//   has its Ashby, Greenhouse, Lever and Workable lines alerted. Deliveries
//   are recorded in alert_deliveries so nothing is sent twice.
//
// Body: { phase: 'snapshot' | 'compare-and-alert', dryRun?: boolean, configId?: string }
import { createClient } from 'npm:@supabase/supabase-js@2';
import { identifyCaller } from '../_shared/auth.ts';
import {
  type AlertConfig, type CompanyRow, type VacancyRow, buildCardItem, consultantInactive, deliveryNote, loadAssignments, loadConsultants, longDate, recipientsFor, runEligibility, companyInScope, scopeDescription, sendAlertEmail, todayUtc, fold, vacancyEligible,
} from '../_shared/alerts.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function isoDaysAgo(days: number, now: Date): string {
  const d = new Date(now.getTime() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  // Who is calling (Phase 4 hotfix, 9 September 2026): the cron path arrives
  // as the service role and may send; a signed-in user may only dry-run; the
  // anon key is refused. Before this, anyone holding the public anon key
  // could fire the compare-and-alert phase early and consume the day's
  // idempotency key, so the real 07:00 run sent nothing.
  const ident = await identifyCaller(req, supabase);
  if (ident.reject) return ident.reject;
  let body: { phase?: string; dryRun?: boolean; configId?: string } = {};
  try { body = await req.json(); } catch { /* no body */ }
  const phase = body.phase || 'snapshot';
  const dryRun = body.dryRun === true;
  if (ident.caller.kind === 'user' && !dryRun) {
    return json({ error: 'From the app this can only be run as a dry run; the morning alerts are sent by the schedule.' }, 403);
  }
  const now = new Date();

  try {
    let configQuery = supabase
      .from('vacancy_alert_settings')
      .select('*')
      .eq('auto_refresh_enabled', true)
      .eq('alert_type', 'new_vacancy')
      .eq('enabled', true);
    if (body.configId) configQuery = configQuery.eq('id', body.configId);
    const { data: configs, error: configError } = await configQuery;
    if (configError) throw configError;

    if (phase === 'snapshot' || phase === 'snapshot-and-trigger') {
      const { count } = await supabase.from('company_searches').select('id', { count: 'exact', head: true });
      await supabase.from('pipeline_runs').insert({ phase: 'snapshot', started_at: now.toISOString(), finished_at: new Date().toISOString(), companies_total: count ?? null, status: 'ok', details: { noop: true, configs: (configs || []).length } });
      return json({ success: true, phase: 'snapshot', noop: true, configs: (configs || []).length });
    }
    if (phase !== 'compare-and-alert') return json({ error: 'Invalid phase' }, 400);

    const { data: runRow } = await supabase.from('pipeline_runs').insert({ phase: 'compare', started_at: now.toISOString(), status: 'running', details: { dryRun } }).select('id').single();
    const runId = runRow?.id;

    if (!configs || configs.length === 0) {
      await supabase.from('pipeline_runs').update({ finished_at: new Date().toISOString(), status: 'ok', new_count: 0, details: { dryRun, message: 'no configs' } }).eq('id', runId);
      return json({ success: true, phase: 'compare-and-alert', dryRun, results: [], message: 'No auto-refresh configs enabled' });
    }

    const { data: companies, error: companyError } = await supabase.from('company_searches').select('id, company_name, url, company_number, analysis_result');
    if (companyError) throw companyError;
    const companyMap = new Map<string, CompanyRow>((companies || []).map((s: CompanyRow) => [s.id, s]));

    // Freshness: the latest refresh run per company must be after the last snapshot (or today).
    const { data: snap } = await supabase.from('pipeline_runs').select('finished_at').eq('phase', 'snapshot').eq('status', 'ok').order('started_at', { ascending: false }).limit(1).maybeSingle();
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const cutoff = snap?.finished_at && new Date(snap.finished_at) >= new Date(startOfToday.getTime() - 86400000) ? new Date(snap.finished_at) : startOfToday;
    const { data: runs } = await supabase
      .from('company_refresh_runs')
      .select('company_search_id, started_at, finished_at, degraded, sources_ok, error')
      .gte('started_at', isoDaysAgo(2, now))
      .order('started_at', { ascending: false });
    const latestRun = new Map<string, any>();
    for (const r of runs || []) if (!latestRun.has(r.company_search_id)) latestRun.set(r.company_search_id, r);

    const isFresh = (companyId: string) => runEligibility(latestRun.get(companyId), cutoff);

    // Candidate new roles: open, first seen since the last weekly refresh.
    const { data: candidates, error: candErr } = await supabase
      .from('vacancies')
      .select('id, company_search_id, vacancy_key, title, url, source, closing_date, start_text, raw, first_seen, last_seen, status')
      .eq('status', 'open')
      // Roles the team typed in themselves are never announced as new.
      .neq('source', 'consultant')
      // The refresh is weekly, so "new" is anything first seen since the last one (eight days, to be safe).
      .gte('first_seen', isoDaysAgo(8, now));
    if (candErr) throw candErr;
    const candidatesByCompany = new Map<string, VacancyRow[]>();
    for (const v of (candidates || []) as VacancyRow[]) {
      const list = candidatesByCompany.get(v.company_search_id) || [];
      list.push(v);
      candidatesByCompany.set(v.company_search_id, list);
    }
    // Deliveries are read per config, in pages: PostgREST returns at most
    // 1000 rows per request, and one read across every config and candidate
    // would silently drop the tail and re-send baseline vacancies as new.
    const deliveredFor = async (configId: string, vacancyIds: string[]): Promise<Set<string>> => {
      const out = new Set<string>();
      const PAGE = 1000;
      for (let i = 0; i < vacancyIds.length; i += 200) {
        const chunk = vacancyIds.slice(i, i + 200);
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabase
            .from('alert_deliveries')
            .select('vacancy_id')
            .eq('config_id', configId)
            .in('vacancy_id', chunk)
            .order('vacancy_id')
            .range(from, from + PAGE - 1);
          if (error) throw error;
          for (const d of data || []) out.add(d.vacancy_id);
          if (!data || data.length < PAGE) break;
        }
      }
      return out;
    };

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const results: any[] = [];
    let totalNew = 0;

    // Phase 4: companies by assignment (company_consultants) and recipients from
    // the consultant record plus extras; the legacy tag only for settings
    // that have no consultant_id.
    const assignments = await loadAssignments(supabase);
    const consultants = await loadConsultants(supabase);
    for (const config of configs as AlertConfig[]) {
      const configStarted = new Date().toISOString();
      if (consultantInactive(config, consultants)) {
        results.push({ configId: config.id, status: 'consultant_inactive' });
        continue;
      }
      const recipients = recipientsFor(config, consultants);
      const email = recipients[0];
      if (!email) {
        results.push({ configId: config.id, status: 'no_email' });
        continue;
      }
      if (!config.consultant_id && !fold(config.consultant_filter)) console.log(`[compare] config ${config.id} (${email}) has no consultant filter: treating as ${scopeDescription(config)}`);

      const scoped = (companies || []).filter((s: CompanyRow) => companyInScope(s, config, assignments));
      const skipped: Array<{ company: string; reason: string }> = [];
      const boardsOnly: Array<{ company: string; boards: string[]; held: number }> = [];
      let refreshedToday = 0;
      const freshCandidates: Array<{ v: VacancyRow; company: CompanyRow }> = [];
      for (const company of scoped) {
        const f = isFresh(company.id);
        if (!f.fresh) {
          skipped.push({ company: company.company_name, reason: f.reason! });
          continue;
        }
        refreshedToday++;
        const mine = candidatesByCompany.get(company.id) || [];
        const eligible = mine.filter((v) => vacancyEligible(v, f));
        if (f.boardsOnly) boardsOnly.push({ company: company.company_name, boards: f.boardsOnly, held: mine.length - eligible.length });
        for (const v of eligible) freshCandidates.push({ v, company });
      }
      const delivered = await deliveredFor(config.id, freshCandidates.map((c) => c.v.id));
      const newItems = freshCandidates.filter((c) => !delivered.has(c.v.id));
      newItems.sort((a, b) => a.company.company_name.localeCompare(b.company.company_name) || a.v.title.localeCompare(b.v.title));

      const base = {
        configId: config.id,
        consultant: config.consultant_filter,
        email,
        companiesInScope: scoped.length,
        companiesRefreshedToday: refreshedToday,
        companiesSkipped: skipped.length,
        companiesBoardsOnly: boardsOnly.length,
        newVacancies: newItems.length,
      };
      const writeConfigRun = async (status: string, extra: Record<string, unknown> = {}) => {
        await supabase.from('pipeline_runs').insert({
          phase: 'compare',
          config_id: config.id,
          started_at: configStarted,
          finished_at: new Date().toISOString(),
          companies_total: scoped.length,
          companies_refreshed_today: refreshedToday,
          new_count: newItems.length,
          status,
          details: { consultant: config.consultant_filter, email, dryRun, skipped: skipped.slice(0, 40), boardsOnly: boardsOnly.slice(0, 40), ...extra },
        });
      };

      if (newItems.length === 0) {
        await writeConfigRun('no_new');
        results.push({ ...base, status: 'no_new' });
        continue;
      }

      // The pipeline run id is part of the key: a second run the same day
      // (a re-fired schedule) must not be swallowed as a duplicate of the
      // first; alert_deliveries already stops the same vacancy going twice.
      const idempotencyKey = `new-vacancies-${config.id}-${todayUtc(now)}-${runId ?? 'run'}`;
      // One email per recipient, each with feedback links signed for that
      // address; the first recipient keeps the original idempotency key.
      let outcome: Awaited<ReturnType<typeof sendAlertEmail>> = { status: 'skipped' } as any;
      for (const recipient of recipients) {
        const cards = [];
        for (const item of newItems) cards.push(await buildCardItem(supabaseUrl, recipient, item.v, item.company));
        const one = await sendAlertEmail(supabase, {
          templateName: 'new-vacancies-alert',
          recipientEmail: recipient,
          idempotencyKey: recipient === email ? idempotencyKey : `${idempotencyKey}-${recipient}`,
          templateData: {
            consultant: config.consultant_filter || consultants.get(config.consultant_id || '')?.name || config.name || '',
            date: longDate(now),
            newVacancies: cards,
            totalCount: cards.length,
          },
          dryRun,
        });
        if (recipient === email || outcome.status !== 'sent') outcome = one;
      }
      if (outcome.status === 'sent') {
        // The note ties these rows to the queued message: process-email-queue
        // deletes them if the message dead-letters, so the vacancies are
        // alerted again next time instead of being lost.
        if (newItems.length) {
          const { error: delErr } = await supabase.from('alert_deliveries').upsert(
            newItems.map((i) => ({ config_id: config.id, vacancy_id: i.v.id, pipeline_run_id: runId, sent_at: new Date().toISOString(), note: deliveryNote(outcome.messageId) })),
            { onConflict: 'config_id,vacancy_id' },
          );
          if (delErr) console.error('alert_deliveries insert failed:', delErr.message);
        }
        totalNew += newItems.length;
      }
      await writeConfigRun(outcome.status, { error: outcome.error ?? null, vacancies: newItems.map((i) => ({ id: i.v.id, title: i.v.title, company: i.company.company_name })).slice(0, 100) });
      results.push({ ...base, status: outcome.status, error: outcome.error, titles: dryRun ? newItems.map((i) => `${i.company.company_name}: ${i.v.title} [${i.v.source}]`) : undefined, boardsOnly: dryRun ? boardsOnly : undefined });
    }

    await supabase.from('pipeline_runs').update({
      finished_at: new Date().toISOString(),
      status: 'ok',
      companies_total: (companies || []).length,
      companies_refreshed_today: Array.from(latestRun.values()).filter((r: any) => isFresh(r.company_search_id).fresh).length,
      new_count: totalNew,
      details: { dryRun, configs: results.length, cutoff: cutoff.toISOString() },
    }).eq('id', runId);

    return json({ success: true, phase: 'compare-and-alert', dryRun, cutoff: cutoff.toISOString(), results });
  } catch (error) {
    console.error('Error:', error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
