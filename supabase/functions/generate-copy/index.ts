// generate-copy: writes the per-persona call script and email for a company
// with Claude.
//
// POST { companyId, personas?: string[], force?: boolean, trigger?: string }
//   personas  which of founder, coo, people, cto, investor (default: all that
//             apply; investor only when an investor is named)
//   force     regenerate even when the evidence fingerprint is unchanged
//             (the app's "Regenerate" button)
//   trigger   'manual' (app), 'regenerate', 'nightly' (copy_queue), 'queue'
//
// Callers: the app after an analysis (anon JWT, the interim until Phase 4),
// the copy_queue dispatcher (service role) and analyze-company itself.
// Without force, a persona is regenerated only when the stored copy's
// fingerprint differs from the company's current one or is older than 30 days.

import { identifyCaller } from '../_shared/auth.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { applicablePersonas, buildCopyInput, copyIsStale, loadCopyContext, storeCopy, type StoredCopy } from '../_shared/copy/assemble.ts';
import { CopyGenerationError, generatePersonaCopy } from '../_shared/copy/generate.ts';
import { type Persona, PERSONAS } from '../_shared/copy/prompt.ts';
import { logAiUsage, type UsageRecord } from '../_shared/copy/usage.ts';

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
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

  let body: { companyId?: string; personas?: string[]; force?: boolean; trigger?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON request body' }, 400);
  }
  const companyId = typeof body.companyId === 'string' && /^[0-9a-f-]{36}$/i.test(body.companyId) ? body.companyId : null;
  if (!companyId) return json({ error: 'companyId (uuid) is required' }, 400);
  const force = body.force === true;
  const trigger = typeof body.trigger === 'string' && /^[a-z_]{1,20}$/.test(body.trigger) ? body.trigger : force ? 'regenerate' : 'manual';
  const requested = Array.isArray(body.personas) ? body.personas.filter((p): p is Persona => (PERSONAS as string[]).includes(p)) : null;

  const { data: row, error } = await supabase.from('company_searches').select('id, company_name, company_number, analysis_result, evidence_fingerprint').eq('id', companyId).maybeSingle();
  if (error) return json({ error: `lookup failed: ${error.message}` }, 500);
  if (!row) return json({ error: 'company not found' }, 404);

  const today = new Date();
  const ctx = await loadCopyContext(supabase, row);
  const applicable = applicablePersonas(ctx);
  const personas = (requested?.length ? requested : applicable).filter((p) => applicable.includes(p));
  const existing: Record<string, StoredCopy | undefined> = (row.analysis_result?.copy && typeof row.analysis_result.copy === 'object') ? row.analysis_result.copy : {};

  const results: Record<string, unknown> = {};
  const work = personas.map(async (persona) => {
    const check = copyIsStale(existing[persona], ctx.fingerprint, today);
    if (!force && !check.stale) {
      results[persona] = { status: 'reused', reason: check.reason, generated_at: existing[persona]?.generated_at };
      return;
    }
    const input = buildCopyInput(ctx, persona, today);
    try {
      const gen = await generatePersonaCopy(input, companyId);
      const stored = await storeCopy(supabase, companyId, persona, gen, input.contact, ctx.fingerprint, trigger);
      results[persona] = { status: 'generated', reason: force ? 'forced' : check.reason, attempts: gen.attempts, quality_flags: gen.qualityFlags, copy: stored };
      console.log(`Copy generated for ${row.company_name} / ${persona}: ${gen.attempts} attempt(s), flags: ${gen.qualityFlags.join('; ') || 'none'}`);
    } catch (e) {
      const usage = (e as { usage?: UsageRecord[] }).usage || [];
      for (const u of usage) await logAiUsage(supabase, { ...u, companySearchId: companyId });
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Copy generation failed for ${row.company_name} / ${persona}:`, msg);
      results[persona] = { status: 'failed', error: msg, retryable: e instanceof CopyGenerationError ? e.retryable : false };
    }
  });
  await Promise.all(work);

  const failed = Object.values(results).filter((r) => (r as { status: string }).status === 'failed').length;
  return json({ companyId, company: row.company_name, fingerprint: ctx.fingerprint, trigger, personas: results }, failed === personas.length && personas.length > 0 ? 502 : 200);
});
