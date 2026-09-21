// The prospect radar's qualification pass: for each new prospect the
// register, the website, the careers board and the score, then promotion
// into company_searches for what reaches the auto-promote score
// (_shared/prospecting/run.ts). One pipeline_runs row per run, phase
// 'prospect_qualify'. Slice 3 of TA Searcher; scheduled at 05:40 UTC, and
// called by the Prospects page for one prospect at a time.
//
// Service role or a signed-in app user. Body:
// { limit?: number (default 60), promote?: boolean (default true),
//   prospectIds?: string[], website?: string, dryRun?: boolean }.
// With prospectIds the named prospects are qualified again whatever their
// status except promoted, and with promote they are added even under the
// threshold (the page's Add button). `website` sets one prospect's website
// before it is qualified (the page's "website not found" input).
// The reply: { ok, checked, qualified, promoted, unsuitable, results: [{prospectId, name, status, score, promotedCompanyId, note}], errors }.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { identifyCaller } from '../_shared/auth.ts';
import { DEFAULT_QUALIFY_LIMIT, qualifyProspects } from '../_shared/prospecting/run.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const PHASE = 'prospect_qualify';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const ident = await identifyCaller(req, supabase);
  if (ident.reject) return ident.reject;

  let body: any = {};
  try {
    body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  } catch {
    body = {};
  }
  const dryRun = body?.dryRun === true;
  const promote = body?.promote !== false;
  const prospectIds = Array.isArray(body?.prospectIds) ? body.prospectIds.map(String).filter((s: string) => /^[0-9a-f-]{36}$/i.test(s)) : null;
  const website = typeof body?.website === 'string' && body.website.trim() ? body.website.trim() : null;
  const limit = Number.isFinite(Number(body?.limit)) && Number(body?.limit) > 0 ? Math.floor(Number(body.limit)) : DEFAULT_QUALIFY_LIMIT;
  if (website && !(prospectIds && prospectIds.length === 1)) return json({ ok: false, error: 'A website is set on one prospect at a time: send prospectIds with one id.' }, 400);

  const startedAt = new Date();
  let runId: string | null = null;
  if (!dryRun) {
    const { data: runRow } = await supabase.from('pipeline_runs').insert({ phase: PHASE, started_at: startedAt.toISOString(), status: 'running', details: { by: ident.caller.kind, limit, promote, prospectIds } }).select('id').maybeSingle();
    runId = runRow?.id ?? null;
  }
  const finish = async (status: string, details: Record<string, unknown>, error?: string) => {
    if (runId) await supabase.from('pipeline_runs').update({ finished_at: new Date().toISOString(), status, error: error ?? null, details, companies_total: (details.checked as number | undefined) ?? null, new_count: (details.promoted as number | undefined) ?? null }).eq('id', runId);
  };

  try {
    const counts = await qualifyProspects(supabase, { today: startedAt, limit, promote, prospectIds, website, dryRun, supabaseUrl });
    const details = { ...counts, by: ident.caller.kind, results: counts.results.slice(0, 80), errors: counts.errors.slice(0, 20) };
    console.log('[qualify-prospects]', JSON.stringify({ ...details, results: undefined }));
    const allFailed = counts.results.length > 0 && counts.results.every((r) => (r.note || '').startsWith('failed:'));
    await finish(allFailed ? 'failed' : counts.errors.length ? 'degraded' : 'ok', details, allFailed ? 'every prospect failed' : undefined);
    return json({ ok: !allFailed, ...counts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[qualify-prospects] failed:', msg);
    await finish('failed', { dryRun, limit, promote, prospectIds }, msg);
    return json({ ok: false, error: msg }, 500);
  }
});
