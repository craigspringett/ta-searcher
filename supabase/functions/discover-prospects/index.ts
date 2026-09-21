// The prospect radar's discovery pass: the funding news (unmatched stories
// and the extra Google News searches), a page of the Companies House
// advanced search per SIC and place, and the Adzuna and Reed job APIs, into
// prospects (_shared/prospecting/discover.ts). One pipeline_runs row per
// run, phase 'prospecting'. Slice 3 of TA Searcher; scheduled at 05:30
// UTC, and run from the Prospects page's "Run the radar now".
//
// Service role or a signed-in app user. Body:
// { dryRun?: boolean, sources?: ('funding_news'|'companies_house'|'adzuna'|'reed')[], limit?: number (register companies, default 300) }.
// A dry run reads the sources and writes nothing, answering with the first
// thirty rows it would have written.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { identifyCaller } from '../_shared/auth.ts';
import { discoverProspects, SOURCE_KINDS } from '../_shared/prospecting/discover.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const PHASE = 'prospecting';

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
  const sources = Array.isArray(body?.sources) ? body.sources.map(String).filter((s: string) => (SOURCE_KINDS as string[]).includes(s)) : null;
  const limit = Number.isFinite(Number(body?.limit)) && Number(body?.limit) > 0 ? Math.floor(Number(body.limit)) : null;

  const startedAt = new Date();
  let runId: string | null = null;
  if (!dryRun) {
    const { data: runRow } = await supabase.from('pipeline_runs').insert({ phase: PHASE, started_at: startedAt.toISOString(), status: 'running', details: { by: ident.caller.kind, sources: sources ?? SOURCE_KINDS } }).select('id').maybeSingle();
    runId = runRow?.id ?? null;
  }
  const finish = async (status: string, details: Record<string, unknown>, error?: string) => {
    if (runId) await supabase.from('pipeline_runs').update({ finished_at: new Date().toISOString(), status, error: error ?? null, details, new_count: (details.inserted as number | undefined) ?? null }).eq('id', runId);
  };

  try {
    const counts = await discoverProspects(supabase, { today: startedAt, sources, dryRun, limit });
    const { sample, ...rest } = counts;
    const details = { ...rest, by: ident.caller.kind, agencyPostings: rest.agencyPostings.slice(0, 10), errors: rest.errors.slice(0, 20) };
    console.log('[discover-prospects]', JSON.stringify({ ...details, register: rest.register ? { steps: rest.register.steps.length, nextCursor: rest.register.nextCursor } : null }));
    const asked = Object.values(rest.sources).filter((s) => !s.skipped);
    const allFailed = asked.length > 0 && asked.every((s) => s.error && s.found === 0);
    await finish(allFailed ? 'failed' : rest.errors.length || asked.some((s) => s.error) ? 'degraded' : 'ok', details, allFailed ? 'every source failed' : undefined);
    return json({ ok: !allFailed, ...rest, sample: dryRun ? sample : undefined });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[discover-prospects] failed:', msg);
    await finish('failed', { dryRun, sources }, msg);
    return json({ ok: false, error: msg }, 500);
  }
});
