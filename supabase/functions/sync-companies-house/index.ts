// Keep every tracked company's register entry current: for each
// company_searches row with a company number, refresh the company_records
// cache when it is older than maxAgeDays (default 7), then read the officers
// and the capital filings into ch_officers and ch_filings
// (_shared/companies-house.ts), and copy the record and the officers into
// analysis_result (companyRecord, officers) when they changed. One
// pipeline_runs row per run, phase 'companies_house_sync'.
//
// Service role only (the schedule); a signed-in user may run it with
// {"dryRun":true}, which reads the register but writes nothing. Body:
// { companyIds?: string[], maxAgeDays?: number, dryRun?: boolean, limit?: number, maxRunMs?: number }.
//
// Companies House allows 600 requests per five minutes; a company costs up
// to three (profile when stale, officers, filings), so a run of more than
// about 200 companies hits the limit. The pass stops at maxRunMs (default
// 240 s, inside the edge worker's allowance) and reports what was left.
// A company whose cached record says it is dissolved or in liquidation is
// counted and skipped: never refreshed again.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { identifyCaller } from '../_shared/auth.ts';
import { mapWithConcurrency } from '../_shared/fetch.ts';
import {
  companiesHouseConfigured,
  isDefunctStatus,
  normaliseCompanyNumber,
  NOTE_KEY_NOT_SET,
  resolveCompanyRecord,
  syncRegisterDetails,
  type CompanyRecord,
  type Officer,
} from '../_shared/companies-house.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const PHASE = 'companies_house_sync';
const DEFAULT_MAX_AGE_DAYS = 7;
const CONCURRENCY = 4;
const PAGE = 500;
const DEFAULT_MAX_RUN_MS = 240_000;

interface CompanyRow {
  id: string;
  company_number: string | null;
  company_name: string | null;
  url: string;
}

/**
 * A client whose writes are swallowed, for a dry run: the shared module
 * still reads company_records, ch_officers and ch_filings through it, so
 * "new since the last sync" is computed as the real run would compute it.
 */
function readOnly(supabase: any): any {
  const noWrite = () => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: (v: any) => void) => resolve({ data: null, error: null }),
    };
    return chain;
  };
  return {
    from(name: string) {
      const real = supabase.from(name);
      return new Proxy(real, {
        get(target, prop, receiver) {
          if (prop === 'upsert' || prop === 'insert' || prop === 'update' || prop === 'delete') return noWrite;
          const v = Reflect.get(target, prop, receiver);
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    },
  };
}

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
  const maxAgeDays = Number.isFinite(Number(body?.maxAgeDays)) && Number(body?.maxAgeDays) >= 0 ? Number(body.maxAgeDays) : DEFAULT_MAX_AGE_DAYS;
  const limit = Number.isFinite(Number(body?.limit)) && Number(body?.limit) > 0 ? Math.floor(Number(body.limit)) : null;
  const maxRunMs = Number.isFinite(Number(body?.maxRunMs)) && Number(body?.maxRunMs) > 0 ? Number(body.maxRunMs) : DEFAULT_MAX_RUN_MS;
  const companyIds: string[] | null = Array.isArray(body?.companyIds) ? body.companyIds.map(String).filter(Boolean) : null;

  const startedAt = new Date();
  const startedIso = startedAt.toISOString();
  const db = dryRun ? readOnly(supabase) : supabase;

  if (!companiesHouseConfigured()) {
    if (!dryRun) await supabase.from('pipeline_runs').insert({ phase: PHASE, started_at: startedIso, finished_at: new Date().toISOString(), status: 'skipped', error: NOTE_KEY_NOT_SET, details: { maxAgeDays } });
    return json({ ok: false, configured: false, note: NOTE_KEY_NOT_SET });
  }

  let runId: string | null = null;
  if (!dryRun) {
    const { data: runRow } = await supabase.from('pipeline_runs').insert({ phase: PHASE, started_at: startedIso, status: 'running', details: { maxAgeDays, limit, companyIds: companyIds?.length ?? null } }).select('id').maybeSingle();
    runId = runRow?.id ?? null;
  }
  const finish = async (status: string, details: Record<string, unknown>, error?: string) => {
    if (runId) await supabase.from('pipeline_runs').update({ finished_at: new Date().toISOString(), status, error: error ?? null, details, companies_total: details.companies ?? null, new_count: ((details.newOfficers as number) || 0) + ((details.newFilings as number) || 0) }).eq('id', runId);
  };

  try {
    // Every tracked company with a number (paged), or the ones asked for.
    const companies: CompanyRow[] = [];
    for (let from = 0; ; from += PAGE) {
      let query = supabase.from('company_searches').select('id, company_number, company_name, url').not('company_number', 'is', null).order('created_at', { ascending: true }).range(from, from + PAGE - 1);
      if (companyIds) query = query.in('id', companyIds);
      const { data, error } = await query;
      if (error) throw new Error(`company_searches read failed: ${error.message}`);
      for (const row of data || []) {
        companies.push(row as CompanyRow);
        if (limit && companies.length >= limit) break;
      }
      if (!data || data.length < PAGE || (limit && companies.length >= limit)) break;
    }

    // The cached status, so a dissolved company is never read again.
    const numbers = Array.from(new Set(companies.map((c) => normaliseCompanyNumber(c.company_number)).filter((n): n is string => !!n)));
    const cachedStatus = new Map<string, string | null>();
    for (let i = 0; i < numbers.length; i += 200) {
      const { data, error } = await supabase.from('company_records').select('company_number, status').in('company_number', numbers.slice(i, i + 200));
      if (error) throw new Error(`company_records read failed: ${error.message}`);
      for (const r of data || []) cachedStatus.set(String(r.company_number), r.status ?? null);
    }

    const counts = { companies: companies.length, refreshed: 0, newOfficers: 0, newFilings: 0, dissolved: 0, errors: 0, updated: 0, notANumber: 0, skippedDefunct: 0, notReached: 0 };
    const errors: Array<{ id: string; companyNumber: string | null; error: string }> = [];
    const changes: Array<{ id: string; companyNumber: string; newOfficers: string[]; newFilings: string[] }> = [];
    const deadline = startedAt.getTime() + maxRunMs;

    await mapWithConcurrency(companies, CONCURRENCY, async (c) => {
      const number = normaliseCompanyNumber(c.company_number);
      if (!number) { counts.notANumber++; return; }
      if (Date.now() > deadline) { counts.notReached++; return; }
      if (isDefunctStatus(cachedStatus.get(number))) { counts.dissolved++; counts.skippedDefunct++; return; }
      try {
        const record = await resolveCompanyRecord(db, { companyNumber: number, url: c.url, name: c.company_name }, maxAgeDays);
        if (!record) { counts.notANumber++; return; }
        const refreshed = record.verified && record.fetchedAt >= startedIso;
        if (refreshed) counts.refreshed++;
        const defunct = isDefunctStatus(record.status);
        if (defunct) counts.dissolved++;
        // Officers and filings only for a live, verified company: a dissolved one is marked and left.
        const details = record.verified && !defunct ? await syncRegisterDetails(db, number, startedAt) : null;
        if (details) {
          counts.newOfficers += details.newOfficers.length;
          counts.newFilings += details.newFilings.length;
        }
        if (refreshed || (details && (details.newOfficers.length || details.newFilings.length))) {
          const changed = await mergeIntoAnalysis(supabase, c.id, record, details?.officers ?? null, dryRun);
          if (changed) counts.updated++;
          if (details && (details.newOfficers.length || details.newFilings.length)) {
            changes.push({ id: c.id, companyNumber: number, newOfficers: details.newOfficers.map((o) => `${o.name} (${o.role}${o.appointedOn ? `, ${o.appointedOn}` : ''})`), newFilings: details.newFilings.map((f) => `${f.type} ${f.date}: ${f.description}`) });
          }
        }
      } catch (e) {
        counts.errors++;
        const msg = e instanceof Error ? e.message : String(e);
        errors.push({ id: c.id, companyNumber: number, error: msg });
        console.error(`[sync-companies-house] ${number}: ${msg}`);
      }
    });

    const details = { ...counts, maxAgeDays, dryRun, limit, stoppedEarly: counts.notReached > 0, ms: Date.now() - startedAt.getTime(), changes: changes.slice(0, 50), errors: errors.slice(0, 20) };
    console.log('[sync-companies-house]', JSON.stringify({ ...details, changes: changes.length }));
    await finish(counts.errors && counts.errors === counts.companies ? 'failed' : 'ok', details);
    return json({ ok: true, ...details });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[sync-companies-house] failed:', msg);
    await finish('failed', { dryRun }, msg);
    return json({ ok: false, error: msg }, 500);
  }
});

/**
 * Set analysis_result.companyRecord (and officers, when they were read) on
 * the company's row when either differs from what is stored. Reads the
 * current JSON, merges the two keys and writes it back; nothing else in the
 * JSON is touched. Returns whether anything changed.
 */
async function mergeIntoAnalysis(supabase: any, companyId: string, record: CompanyRecord, officers: Officer[] | null, dryRun: boolean): Promise<boolean> {
  const { data: row, error } = await supabase.from('company_searches').select('analysis_result').eq('id', companyId).maybeSingle();
  if (error) throw new Error(`company_searches read failed: ${error.message}`);
  const current = row?.analysis_result && typeof row.analysis_result === 'object' && !Array.isArray(row.analysis_result) ? row.analysis_result : {};
  const nextOfficers = officers ?? (Array.isArray(current.officers) ? current.officers : []);
  const same = JSON.stringify(current.companyRecord ?? null) === JSON.stringify(record) && JSON.stringify(current.officers ?? []) === JSON.stringify(nextOfficers);
  if (same) return false;
  if (dryRun) return true;
  const merged = { ...current, companyRecord: record, officers: nextOfficers };
  const { error: updErr } = await supabase.from('company_searches').update({ analysis_result: merged, updated_at: new Date().toISOString() }).eq('id', companyId);
  if (updErr) throw new Error(`company_searches update failed: ${updErr.message}`);
  return true;
}
