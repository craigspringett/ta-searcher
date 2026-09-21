// Catch-up alert: every open vacancy at a consultant's companies, in one email.
// Body: { consultant, recipientEmail, idempotencyKey?, dryRun?: boolean }
import { identifyCaller } from '../_shared/auth.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { type CompanyRow, type VacancyRow, buildCardItem, loadAssignments, loadConsultants, longDate, companyInScope, sendAlertEmail, todayUtc } from '../_shared/alerts.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const callerClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const ident = await identifyCaller(req, callerClient);
  if (ident.reject) return ident.reject;

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const body = await req.json();
    const { consultant, recipientEmail, idempotencyKey } = body;
    const dryRun = body.dryRun === true;
    if (!consultant || !recipientEmail) return json({ error: 'Missing consultant or recipientEmail' }, 400);

    const { data: companies, error } = await supabase.from('company_searches').select('id, company_name, url, company_number, analysis_result');
    if (error) throw error;
    // `consultant` may be a consultants.id or a name; by assignment when the
    // consultant exists as a row, by the legacy tag otherwise.
    const consultants = await loadConsultants(supabase);
    const wanted = String(consultant).trim().toLowerCase();
    const match = [...consultants.values()].find((c) => c.id === wanted || c.name.toLowerCase() === wanted) || null;
    if (match && match.active === false) return json({ success: true, dryRun, totalVacancies: 0, message: `${match.name} is marked inactive on the Consultants page; nothing sent.` });
    const assignments = match ? await loadAssignments(supabase) : undefined;
    const scoped = (companies || []).filter((s: CompanyRow) => companyInScope(s, { consultant_filter: match ? match.name : consultant, la_filter: null, consultant_id: match?.id ?? null }, assignments));
    const companyMap = new Map<string, CompanyRow>(scoped.map((s: CompanyRow) => [s.id, s]));
    if (scoped.length === 0) return json({ success: true, dryRun, totalVacancies: 0, message: `No companies assigned to ${consultant}` });

    const { data: open, error: vacErr } = await supabase
      .from('vacancies')
      .select('id, company_search_id, vacancy_key, title, url, source, closing_date, start_text, raw, first_seen, last_seen, status')
      .eq('status', 'open')
      .neq('source', 'consultant')
      .in('company_search_id', scoped.map((s: CompanyRow) => s.id))
      .order('first_seen', { ascending: false });
    if (vacErr) throw vacErr;

    if (!open || open.length === 0) return json({ success: true, dryRun, totalVacancies: 0, companies: scoped.length, message: `No open vacancies at ${consultant}'s companies; nothing sent` });

    const items = ((open || []) as VacancyRow[]).sort((a, b) => companyMap.get(a.company_search_id)!.company_name.localeCompare(companyMap.get(b.company_search_id)!.company_name));
    const cards = [];
    for (const v of items) cards.push(await buildCardItem(supabaseUrl, recipientEmail, v, companyMap.get(v.company_search_id)!));

    const now = new Date();
    const key = idempotencyKey || `catchup-${String(consultant).trim().toLowerCase()}-${todayUtc(now)}`;
    const outcome = await sendAlertEmail(supabase, {
      templateName: 'new-vacancies-alert',
      recipientEmail,
      idempotencyKey: key,
      templateData: {
        consultant,
        date: longDate(now),
        heading: 'Catch-up: all current vacancies at your companies',
        summaryLine: `${cards.length} open ${cards.length === 1 ? 'vacancy' : 'vacancies'} across ${scoped.length} ${scoped.length === 1 ? 'company' : 'companies'} assigned to ${consultant}. This is the full current list, not just what is new.`,
        subjectOverride: `Catch-up: ${cards.length} open ${cards.length === 1 ? 'vacancy' : 'vacancies'} at your companies — ${consultant}`,
        newVacancies: cards,
        totalCount: cards.length,
      },
      dryRun,
    });
    if (outcome.status === 'failed') throw new Error(outcome.error);

    return json({ success: true, dryRun, status: outcome.status, totalVacancies: cards.length, companies: scoped.length, recipientEmail });
  } catch (error) {
    console.error('Error:', error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
