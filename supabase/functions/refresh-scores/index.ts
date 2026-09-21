// Recompute the propensity score for every company (Phase 5, slice 4) from
// the stored signals and the call outcomes. Daily at 06:00 UTC by pg_cron,
// after the nightly refresh; any signed-in user can run it from the app
// ("Recompute scores"), the anon key cannot. Body: { companyIds?: string[],
// recomputeSignals?: boolean }. With recomputeSignals the signals themselves
// are recomputed first from the stored facts, vacancies, spend, adverts and
// Ofsted rows (no site fetch, no model), which is how a change to the signal
// rules reaches every company without waiting for its next analysis.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { identifyCaller } from '../_shared/auth.ts';
import { computePropensity, type OutcomeForScore, type SignalForScore } from '../_shared/score/propensity.ts';
import { recomputeSignals } from '../_shared/signals/recompute.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// deno-lint-ignore no-explicit-any
type Supabase = any;

/** Everything the score needs for a set of companies, in a few reads. */
export async function loadScoreInputs(supabase: Supabase, companyIds: string[] | null): Promise<Map<string, { signals: SignalForScore[]; outcomes: OutcomeForScore[]; computedAt: string | null }>> {
  const out = new Map<string, { signals: SignalForScore[]; outcomes: OutcomeForScore[]; computedAt: string | null }>();
  let companiesQ = supabase.from('company_searches').select('id, evidence_computed_at, updated_at');
  if (companyIds) companiesQ = companiesQ.in('id', companyIds);
  const { data: companies, error: sErr } = await companiesQ;
  if (sErr) throw new Error(`company_searches read failed: ${sErr.message}`);
  for (const s of companies || []) out.set(s.id, { signals: [], outcomes: [], computedAt: s.evidence_computed_at || s.updated_at || null });
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from('company_signals').select('company_search_id, code, label, strength, explanation, computed_at').order('company_search_id').range(from, from + PAGE - 1);
    if (companyIds) q = q.in('company_search_id', companyIds);
    const { data, error } = await q;
    if (error) throw new Error(`company_signals read failed: ${error.message}`);
    for (const r of data || []) {
      const e = out.get(r.company_search_id);
      if (!e) continue;
      e.signals.push({ code: r.code, label: r.label, strength: Number(r.strength), explanation: r.explanation, computedAt: r.computed_at });
      if (r.computed_at && (!e.computedAt || r.computed_at > e.computedAt)) e.computedAt = r.computed_at;
    }
    if (!data || data.length < PAGE) break;
  }
  const since = new Date(Date.now() - 120 * 86400000).toISOString();
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from('outcomes').select('company_search_id, kind, created_at, callback_at').gte('created_at', since).order('created_at', { ascending: false }).range(from, from + PAGE - 1);
    if (companyIds) q = q.in('company_search_id', companyIds);
    const { data, error } = await q;
    if (error) throw new Error(`outcomes read failed: ${error.message}`);
    for (const r of data || []) out.get(r.company_search_id)?.outcomes.push({ kind: r.kind, createdAt: r.created_at, callbackAt: r.callback_at });
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Compute and store the score for the given companies (all when null). Returns the rows written. */
export async function refreshScores(supabase: Supabase, companyIds: string[] | null, today: Date = new Date()): Promise<Array<{ company_search_id: string; score: number; top_code: string | null }>> {
  const inputs = await loadScoreInputs(supabase, companyIds);
  const rows = Array.from(inputs.entries()).map(([id, e]) => {
    const p = computePropensity({ today, signals: e.signals, outcomes: e.outcomes, computedAt: e.computedAt });
    return { company_search_id: id, score: p.score, breakdown: p.breakdown, top_reason: p.topReason, top_code: p.topCode, signals_computed_at: e.computedAt, computed_at: today.toISOString() };
  });
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from('company_scores').upsert(rows.slice(i, i + 200), { onConflict: 'company_search_id' });
    if (error) throw new Error(`company_scores upsert failed: ${error.message}`);
  }
  return rows.map((r) => ({ company_search_id: r.company_search_id, score: r.score, top_code: r.top_code }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const ident = await identifyCaller(req, supabase);
  if (ident.reject) return ident.reject;
  let body: { companyIds?: string[]; recomputeSignals?: boolean } = {};
  try { body = await req.json(); } catch { /* no body */ }
  const companyIds = Array.isArray(body.companyIds) && body.companyIds.length ? body.companyIds.map(String) : null;
  const withSignals = body.recomputeSignals === true;
  const started = new Date();
  const { data: runRow } = await supabase.from('pipeline_runs').insert({ phase: 'scores', started_at: started.toISOString(), status: 'running', details: { caller: ident.caller.kind, companyIds: companyIds?.length ?? 'all', recomputeSignals: withSignals } }).select('id').maybeSingle();
  try {
    let signalsNote: Record<string, unknown> = {};
    if (withSignals) {
      let ids = companyIds;
      if (!ids) {
        const { data, error } = await supabase.from('company_searches').select('id');
        if (error) throw new Error(`company_searches read failed: ${error.message}`);
        ids = (data || []).map((r: any) => String(r.id));
      }
      const r = await recomputeSignals(supabase, ids!, started);
      signalsNote = { signalsRecomputed: r.results.length, signalsFailed: r.failures.length, failures: r.failures.slice(0, 20), signalCodes: r.results.flatMap((x) => x.signals.map((s) => s.code)).reduce((acc: Record<string, number>, c) => { acc[c] = (acc[c] || 0) + 1; return acc; }, {}) };
    }
    const rows = await refreshScores(supabase, companyIds, started);
    const dist = { hot: rows.filter((r) => r.score >= 60).length, warm: rows.filter((r) => r.score >= 30 && r.score < 60).length, cool: rows.filter((r) => r.score < 30).length };
    const details = { companies: rows.length, ...dist, ms: Date.now() - started.getTime(), ...signalsNote };
    if (runRow?.id) await supabase.from('pipeline_runs').update({ finished_at: new Date().toISOString(), status: 'ok', new_count: rows.length, details }).eq('id', runRow.id);
    return json({ ok: true, ...details });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (runRow?.id) await supabase.from('pipeline_runs').update({ finished_at: new Date().toISOString(), status: 'failed', error: msg }).eq('id', runRow.id);
    return json({ ok: false, error: msg }, 500);
  }
});
