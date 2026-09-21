// Read the funding news feeds (UKTN, Sifted, Google News, and a Google
// News search per tracked company), keep the raise stories, store them in
// funding_news and match them to tracked companies
// (_shared/funding-news/run.ts). One pipeline_runs row per run, phase
// 'funding_news'. Slice 2 of TA Searcher; scheduled at 05:20 UTC.
//
// Service role only (the schedule); a signed-in user may run it with
// {"dryRun":true}, which reads and matches but writes nothing and answers
// with the first fifty rows it would have stored. Body:
// { dryRun?: boolean, perCompany?: boolean (default true), limitCompanies?: number (default 200) }.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { identifyCaller } from '../_shared/auth.ts';
import { DEFAULT_LIMIT_COMPANIES, syncFundingNews } from '../_shared/funding-news/run.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const PHASE = 'funding_news';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const ident = await identifyCaller(req, supabase);
  if (ident.reject) return ident.reject;

  let body: any = {};
  try {
    body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  } catch {
    body = {};
  }
  const dryRun = body?.dryRun === true;
  if (ident.caller.kind !== 'service' && !dryRun) return json({ error: 'The sync runs on the schedule only. A signed-in user may run it with dryRun.' }, 403);
  const perCompany = body?.perCompany !== false;
  const limitCompanies = Number.isFinite(Number(body?.limitCompanies)) && Number(body?.limitCompanies) > 0 ? Math.floor(Number(body.limitCompanies)) : DEFAULT_LIMIT_COMPANIES;

  const startedAt = new Date();
  const startedIso = startedAt.toISOString();
  let runId: string | null = null;
  if (!dryRun) {
    const { data: runRow } = await supabase.from('pipeline_runs').insert({ phase: PHASE, started_at: startedIso, status: 'running', details: { perCompany, limitCompanies } }).select('id').maybeSingle();
    runId = runRow?.id ?? null;
  }
  const finish = async (status: string, details: Record<string, unknown>, error?: string) => {
    if (runId) await supabase.from('pipeline_runs').update({ finished_at: new Date().toISOString(), status, error: error ?? null, details, companies_total: details.companies ?? null, new_count: details.inserted ?? null }).eq('id', runId);
  };

  try {
    const counts = await syncFundingNews(supabase, { today: startedAt, perCompany, limitCompanies, dryRun });
    const { sample, ...rest } = counts;
    const details = { ...rest, feedNotes: rest.feedNotes.slice(0, 6), errors: rest.errors.slice(0, 20) };
    console.log('[sync-funding-news]', JSON.stringify(details));
    const allFailed = counts.feeds > 0 && counts.feedsFailed === counts.feeds;
    await finish(allFailed ? 'failed' : counts.errors.length ? 'degraded' : 'ok', details, allFailed ? 'every feed failed' : undefined);
    return json({ ok: !allFailed, ...rest, sample: dryRun ? sample : undefined });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[sync-funding-news] failed:', msg);
    await finish('failed', { dryRun, perCompany, limitCompanies }, msg);
    return json({ ok: false, error: msg }, 500);
  }
});
