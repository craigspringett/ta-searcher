// The Friday brief: every Friday at 06:55 UTC, one email
// per consultant address with the companies to work in the coming week,
// ranked by the propensity score, each with its one-line reason and the
// person to ask for; managers get the whole picture. Built on the alert
// email plumbing (sendAlertEmail through send-transactional-email).
//
// Body: { dryRun?: boolean, render?: boolean, testEmail?: string, renderFor?: string[] }
//   - the schedule (service role) sends;
//   - a signed-in user may dry-run, or send a test to their own address only;
//   - dryRun with render asks send-transactional-email to render the HTML and
//     return it, so the function-to-function hop is exercised without a send.
//
// 11 September 2026, Craig's rule (replacing the 10 September "worth a
// call, up to 25" cut): each consultant edition lists the top five by
// score, or every green company when more than five are green
// (BRIEF_TOP_COUNT and BRIEF_GREEN_SCORE in build.ts). From 10 September, a copy
// of every consultant's edition also goes to the directors
// (app_settings.brief_copy_recipients) and to the consultant row's own copy
// list (consultants.brief_copies), with the subject prefixed "[Anja] ...".
// The brief carries no feedback links, so nothing is signed per recipient;
// the idempotency key carries the recipient so copies are never swallowed
// as duplicates of the consultant's own email.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { identifyCaller } from '../_shared/auth.ts';
import { APP_BASE_URL, fold, loadAssignments, longDate, sendAlertEmail, todayUtc } from '../_shared/alerts.ts';
import { mergeContacts } from '../_shared/contacts.ts';
import { sectorFromSic } from '../_shared/companies-house.ts';
import { loadAllContactEdits } from '../_shared/contacts/edits.ts';
import { briefCopies, briefSubject, buildManagerBrief, buildPersonBrief, copySubject, countdownLine, personName, weekOfLabel, type BriefPerson, type BriefCompanyInput } from '../_shared/brief/build.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// deno-lint-ignore no-explicit-any
type Supabase = any;

interface Loaded {
  people: BriefPerson[];
  companiesByPerson: Map<string, BriefCompanyInput[]>;
  allCompanies: BriefCompanyInput[];
  managers: Array<{ email: string; name: string }>;
  /** The directors: every consultant edition is copied to them. */
  directors: string[];
  /** Per consultant row, the addresses that receive a copy of its brief. */
  copiesByConsultant: Map<string, string[]>;
}

/** Everything the brief needs, in a handful of reads. */
export async function loadBriefData(supabase: Supabase): Promise<Loaded> {
  const [consultantsQ, companiesQ, recordsQ, scoresQ, profilesQ, settingsQ] = await Promise.all([
    supabase.from('consultants').select('id, name, email, active, brief_copies'),
    supabase.from('company_searches').select('id, company_name, url, company_number, analysis_result'),
    supabase.from('company_records').select('company_number, name, status, verified, sic_codes'),
    supabase.from('company_scores').select('company_search_id, score, breakdown, top_reason, top_code'),
    supabase.from('profiles').select('email, display_name, role'),
    supabase.from('app_settings').select('key, value').eq('key', 'brief_copy_recipients').maybeSingle(),
  ]);
  for (const q of [consultantsQ, companiesQ, recordsQ, scoresQ, profilesQ, settingsQ]) if (q.error) throw new Error(q.error.message);
  const directors: string[] = Array.isArray(settingsQ.data?.value) ? (settingsQ.data.value as unknown[]).map((x) => fold(String(x))).filter((x) => x.includes('@')) : [];
  const copiesByConsultant = new Map<string, string[]>((consultantsQ.data || []).map((c: any) => [c.id, Array.isArray(c.brief_copies) ? c.brief_copies.map((x: unknown) => fold(String(x))) : []]));
  const assignments = await loadAssignments(supabase);
  // The consultants' contact edits, laid over each company's stored contacts (Contact edits, 18 September 2026).
  const contactEdits = await loadAllContactEdits(supabase);

  // People: active consultants grouped by address.
  const people: BriefPerson[] = [];
  const byEmail = new Map<string, BriefPerson & { names: string[] }>();
  for (const c of consultantsQ.data || []) {
    if (c.active === false) continue;
    const email = fold(c.email);
    if (!email || !email.includes('@')) continue;
    const p = byEmail.get(email);
    if (p) { p.consultantIds.push(c.id); p.names.push(c.name); }
    else { const np = { email, name: c.name, consultantIds: [c.id], names: [c.name] }; byEmail.set(email, np); people.push(np); }
  }
  // The person's own name, not a list name; the profile's display name wins when they have signed in.
  const displayByEmail = new Map<string, string>((profilesQ.data || []).filter((p: any) => p.display_name).map((p: any) => [fold(p.email), p.display_name]));
  for (const p of byEmail.values()) p.name = displayByEmail.get(p.email) || personName(p.names);
  const consultantName = new Map<string, string>((consultantsQ.data || []).map((c: any) => [c.id, c.name]));
  const personOfConsultant = new Map<string, string>();
  for (const p of people) for (const id of p.consultantIds) personOfConsultant.set(id, p.email);

  const recordByNumber = new Map<string, any>((recordsQ.data || []).map((r: any) => [r.company_number, r]));
  const scoreByCompany = new Map<string, any>((scoresQ.data || []).map((r: any) => [r.company_search_id, r]));

  // Outcomes of the last 120 days: the latest per company and the next callback.
  const since = new Date(Date.now() - 120 * 86400000).toISOString();
  const { data: outcomes } = await supabase.from('outcomes').select('company_search_id, kind, callback_at, created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(5000);
  const last = new Map<string, { kind: string; at: string }>();
  const next = new Map<string, string>();
  const nowMs = Date.now();
  for (const o of outcomes || []) {
    if (!last.has(o.company_search_id)) last.set(o.company_search_id, { kind: o.kind, at: o.created_at });
    if (o.callback_at && new Date(o.callback_at).getTime() >= nowMs - 86400000) {
      const cur = next.get(o.company_search_id);
      if (!cur || o.callback_at < cur) next.set(o.company_search_id, o.callback_at);
    }
  }

  const allCompanies: BriefCompanyInput[] = [];
  const companiesByPerson = new Map<string, BriefCompanyInput[]>();
  for (const p of people) companiesByPerson.set(p.email, []);
  for (const s of companiesQ.data || []) {
    const ar = s.analysis_result || {};
    const rec = s.company_number ? recordByNumber.get(s.company_number) : null;
    const verified = !!(rec && rec.verified);
    const score = scoreByCompany.get(s.id);
    const ids = Array.from(assignments.get(s.id) || []);
    const dms = mergeContacts<any>(Array.isArray(ar.decisionMakers) ? ar.decisionMakers : [], contactEdits.get(s.id) || []);
    const input: BriefCompanyInput = {
      id: s.id,
      name: s.company_name || ar.companyRecord?.name || (verified && rec?.name) || s.url,
      stage: ar.stage?.label || null,
      sector: ar.companyRecord?.sector || (verified && Array.isArray(rec?.sic_codes) ? sectorFromSic(rec.sic_codes) : null) || null,
      website: s.url,
      score: score ? Number(score.score) : null,
      breakdown: Array.isArray(score?.breakdown) ? score.breakdown : [],
      topReason: score?.top_reason ?? null,
      topCode: score?.top_code ?? null,
      contacts: dms.filter((d: any) => d && (d.confidence === 'found' || d.confidence === 'pattern_guess' || d.confidence === 'role_only' || d.confidence === 'consultant_provided')).map((d: any) => ({ name: d.name, role: d.roleLabel || d.role, email: d.email, confidence: d.confidence })),
      phone: ar.contactsRun?.officePhone ? String(ar.contactsRun.officePhone) : null,
      // Every open role counts: the score reads the hiring load, not the discipline.
      openVacancies: Array.isArray(ar.recruitmentInsights?.currentVacancies) ? ar.recruitmentInsights.currentVacancies.length : 0,
      lastOutcome: last.get(s.id) ?? null,
      nextCallback: next.get(s.id) ?? null,
      consultantNames: ids.map((id) => consultantName.get(id) || '').filter(Boolean).sort(),
    };
    allCompanies.push(input);
    const seenPerson = new Set<string>();
    for (const id of ids) {
      const email = personOfConsultant.get(id);
      if (!email || seenPerson.has(email)) continue;
      seenPerson.add(email);
      companiesByPerson.get(email)!.push(input);
    }
  }
  const managers = (profilesQ.data || []).filter((p: any) => p.role === 'manager' || p.role === 'admin').map((p: any) => ({ email: fold(p.email), name: p.display_name || p.email }));
  return { people, companiesByPerson, allCompanies, managers, directors, copiesByConsultant };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const ident = await identifyCaller(req, supabase);
  if (ident.reject) return ident.reject;
  let body: { dryRun?: boolean; render?: boolean; testEmail?: string; renderFor?: string[] } = {};
  try { body = await req.json(); } catch { /* no body */ }
  const dryRun = body.dryRun === true;
  const render = body.render === true;
  const testEmail = typeof body.testEmail === 'string' && body.testEmail.includes('@') ? fold(body.testEmail) : null;
  if (testEmail && (ident.caller.kind !== 'user' || fold(ident.caller.email) !== testEmail)) return json({ error: 'A test brief can only be sent to your own address.' }, 403);
  if (ident.caller.kind === 'user' && !testEmail && !dryRun) return json({ error: 'From the app, the brief can only be dry-run or test-sent to your own address.' }, 403);

  const now = new Date();
  const today = todayUtc(now);
  const { data: runRow } = await supabase.from('pipeline_runs').insert({ phase: 'friday_brief', started_at: now.toISOString(), status: 'running', details: { dryRun, render, testEmail: !!testEmail, caller: ident.caller.kind } }).select('id').maybeSingle();
  try {
    const data = await loadBriefData(supabase);
    const weekOf = weekOfLabel(now);
    const countdown = countdownLine(now);
    const renderFor = new Set((body.renderFor || []).map(fold));

    interface Job { email: string; name: string; kind: 'consultant' | 'manager' | 'copy'; copyOf?: string; subject: string; idempotencyKey: string; templateData: Record<string, unknown>; companies: number; count: number }
    const jobs: Job[] = [];
    const personJobs = (p: BriefPerson, withCopies: boolean): Job[] => {
      const mine = data.companiesByPerson.get(p.email) || [];
      const b = buildPersonBrief(p, mine, APP_BASE_URL);
      const subject = briefSubject(b.count, weekOf);
      const templateData = { recipientName: p.name, weekOf, date: longDate(now), countdownLine: countdown, sections: b.sections, totals: b.totals, isManager: false, appUrl: APP_BASE_URL, subjectOverride: subject };
      const own: Job = { email: p.email, name: p.name, kind: 'consultant', subject, idempotencyKey: `friday-brief-consultant-${p.email}-${today}`, companies: mine.length, count: b.count, templateData };
      if (!withCopies) return [own];
      return [own, ...briefCopies(p, data.directors, data.copiesByConsultant).map((email): Job => ({
        email, name: p.name, kind: 'copy', copyOf: p.name, subject: copySubject(p.name, subject),
        idempotencyKey: `friday-brief-copy-${p.email}-for-${email}-${today}`, companies: mine.length, count: b.count,
        templateData: { ...templateData, copyOf: p.name, subjectOverride: copySubject(p.name, subject) },
      }))];
    };
    const managerJob = (m: { email: string; name: string }): Job => {
      const b = buildManagerBrief(data.people, data.companiesByPerson, data.allCompanies, APP_BASE_URL);
      const subject = `The week ahead across the team — ${weekOf}`;
      return { email: m.email, name: m.name, kind: 'manager', subject, idempotencyKey: `friday-brief-manager-${m.email}-${today}`, companies: data.allCompanies.length, count: b.count, templateData: { recipientName: m.name, weekOf, date: longDate(now), countdownLine: countdown, sections: b.sections, totals: b.totals, isManager: true, appUrl: APP_BASE_URL } };
    };
    if (testEmail) {
      const p = data.people.find((x) => x.email === testEmail);
      if (p) jobs.push(...personJobs(p, false));
      const m = data.managers.find((x) => x.email === testEmail);
      if (m) jobs.push(managerJob(m));
      if (!jobs.length) {
        if (runRow?.id) await supabase.from('pipeline_runs').update({ finished_at: new Date().toISOString(), status: 'ok', new_count: 0 }).eq('id', runRow.id);
        return json({ success: true, message: `${testEmail} is neither a consultant address with companies nor a manager, so there is no brief to send.`, results: [] });
      }
    } else {
      for (const p of data.people) if ((data.companiesByPerson.get(p.email) || []).length) jobs.push(...personJobs(p, true));
      for (const m of data.managers) jobs.push(managerJob(m));
    }

    const results: any[] = [];
    let sent = 0;
    for (const job of jobs) {
      const idempotencyKey = testEmail ? `${job.idempotencyKey}-test-${Date.now()}` : job.idempotencyKey;
      const wantHtml = render && (renderFor.size === 0 || renderFor.has(job.email));
      const outcome = await sendAlertEmail(supabase, { templateName: 'friday-brief', recipientEmail: job.email, idempotencyKey, templateData: job.templateData, dryRun, render: wantHtml });
      if (outcome.status === 'sent') sent++;
      results.push({ email: job.email, name: job.name, kind: job.kind, copyOf: job.copyOf, companies: job.companies, count: job.count, status: outcome.status, error: outcome.error, subject: outcome.subject || job.subject, html: wantHtml ? outcome.html : undefined, sections: dryRun ? job.templateData.sections : undefined, totals: job.templateData.totals, countdownLine: countdown });
    }
    if (runRow?.id) await supabase.from('pipeline_runs').update({ finished_at: new Date().toISOString(), status: 'ok', new_count: sent, details: { dryRun, render, testEmail: !!testEmail, caller: ident.caller.kind, weekOf, emails: results.length, results: results.map((r) => ({ email: r.email, kind: r.kind, copyOf: r.copyOf, companies: r.companies, count: r.count, status: r.status, error: r.error })) } }).eq('id', runRow.id);
    return json({ success: true, dryRun, weekOf, countdownLine: countdown, sent, emails: results.length, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[send-friday-brief] failed:', msg);
    if (runRow?.id) await supabase.from('pipeline_runs').update({ finished_at: new Date().toISOString(), status: 'failed', error: msg }).eq('id', runRow.id);
    return json({ error: msg }, 500);
  }
});
