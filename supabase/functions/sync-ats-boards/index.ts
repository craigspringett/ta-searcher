// Nightly ATS sync (docs/TA-SEARCHER-BRIEF.md, "Open roles"), 04:50 UTC by
// pg_cron. For every company with a confirmed board in ats_boards, read the
// feeds (Ashby, Greenhouse, Lever, Workable: no site fetch, no model), merge,
// and persist the roles with closeSources set to the providers that
// answered, so a feed that failed closes nothing and the careers-page rows
// are never touched. Each ats_boards row records the check (last_checked_at,
// last_ok_at, last_count, note), the open rows are mirrored into
// analysis_result.recruitmentInsights.currentVacancies (what the company
// page reads), and one pipeline_runs row (phase 'ats_sync') carries the
// summary like sync-job-boards did in He-Giveth.
// Service role only (the cron path). Body: { companyIds?: string[],
// limit?: number, dryRun?: boolean } to run a few companies or rehearse
// without writing.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { identifyCaller } from '../_shared/auth.ts';
import { mapWithConcurrency } from '../_shared/fetch.ts';
import { collectBoardVacancies, mergeVacancies, persistVacancies, toCurrentVacancies } from '../_shared/vacancies/pipeline.ts';
import type { AtsBoard, AtsProvider, CompanyContext, VacancySource } from '../_shared/vacancies/types.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const CONCURRENCY = 5;
const PROVIDERS: AtsProvider[] = ['ashby', 'greenhouse', 'lever', 'workable'];

interface BoardRow {
  company_search_id: string;
  provider: string;
  slug: string;
  board_url: string | null;
  confirmed_at: string | null;
}

interface CompanyRow {
  id: string;
  company_name: string | null;
  url: string;
  company_number: string | null;
  analysis_result: any;
}

export interface CompanySyncResult {
  companyId: string;
  name: string;
  boards: Array<{ provider: string; slug: string; ok: boolean; count: number; note: string | null; ms: number }>;
  merged: number;
  open: number | null;
  error: string | null;
}

/** Read one company's confirmed boards, persist, and note each board's check. */
async function syncCompany(supabase: any, company: CompanyRow, boards: BoardRow[], today: Date, dryRun: boolean): Promise<CompanySyncResult> {
  const name = company.company_name || company.url;
  const ctx: CompanyContext = {
    companySearchId: company.id,
    companyNumber: company.company_number,
    name,
    aliases: [],
    url: company.url,
    postcodeDistrict: null,
    record: null,
    boards: boards.map((b) => ({ provider: b.provider as AtsProvider, slug: b.slug, boardUrl: b.board_url })),
  };
  const out: CompanySyncResult = { companyId: company.id, name, boards: [], merged: 0, open: null, error: null };
  try {
    const results = await collectBoardVacancies(supabase, ctx, today);
    // One result per board, in the same order as ctx.boards.
    ctx.boards.forEach((b: AtsBoard, i: number) => {
      const r = results[i];
      out.boards.push({ provider: b.provider, slug: b.slug, ok: !!r?.ok, count: r?.vacancies.length ?? 0, note: r?.note ?? null, ms: r?.ms ?? 0 });
    });
    const okSources = Array.from(new Set(results.filter((r) => r.ok).map((r) => r.source))) as VacancySource[];
    const merged = mergeVacancies(results.flatMap((r) => (r.ok ? r.vacancies : [])), { name }, today);
    out.merged = merged.kept.length;
    if (dryRun) return out;
    const open = await persistVacancies(supabase, merged.kept, { companySearchId: company.id, today, degraded: true, closeSources: okSources });
    out.open = open.length;
    // The company page reads the roles from analysis_result; keep that one key current.
    const ar = company.analysis_result && typeof company.analysis_result === 'object' ? company.analysis_result : null;
    if (ar) {
      const next = { ...ar, recruitmentInsights: { ...(ar.recruitmentInsights || {}), currentVacancies: toCurrentVacancies(open) }, atsSyncAt: today.toISOString() };
      const { error } = await supabase.from('company_searches').update({ analysis_result: next }).eq('id', company.id);
      if (error) console.error(`[ats-sync] analysis_result update failed for ${name}: ${error.message}`);
    }
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }
  if (!dryRun) {
    const now = new Date().toISOString();
    for (const b of out.boards) {
      const patch: Record<string, unknown> = { last_checked_at: now, note: b.note };
      if (b.ok) {
        patch.last_ok_at = now;
        patch.last_count = b.count;
      }
      const { error } = await supabase.from('ats_boards').update(patch).eq('company_search_id', company.id).eq('provider', b.provider);
      if (error) console.error(`[ats-sync] ats_boards update failed for ${name} ${b.provider}: ${error.message}`);
    }
  }
  return out;
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const who = await identifyCaller(req, supabase);
  if (who.reject) return who.reject;
  if (who.caller.kind !== 'service') return json({ error: 'The nightly ATS sync runs as the service role only.' }, 403);
  let body: { companyIds?: string[]; limit?: number; dryRun?: boolean } = {};
  try { body = await req.json(); } catch { /* no body */ }
  const companyIds = Array.isArray(body.companyIds) && body.companyIds.length ? body.companyIds.map(String) : null;
  const limit = typeof body.limit === 'number' && body.limit > 0 ? Math.floor(body.limit) : null;
  const dryRun = body.dryRun === true;
  const today = new Date();
  const startedAt = today.toISOString();
  const { data: run } = await supabase.from('pipeline_runs').insert({ phase: 'ats_boards', started_at: startedAt, status: 'running', details: { dryRun, companyIds: companyIds?.length ?? 'all', limit } }).select('id').maybeSingle();
  const runId = run?.id;
  let failed: string | null = null;
  const details: Record<string, unknown> = { dryRun };
  try {
    let boardsQ = supabase.from('ats_boards').select('company_search_id, provider, slug, board_url, confirmed_at').not('confirmed_at', 'is', null).in('provider', PROVIDERS);
    if (companyIds) boardsQ = boardsQ.in('company_search_id', companyIds);
    const { data: boardRows, error: bErr } = await boardsQ;
    if (bErr) throw new Error(`ats_boards read failed: ${bErr.message}`);
    const byCompany = new Map<string, BoardRow[]>();
    for (const b of (boardRows || []) as BoardRow[]) {
      if (!b.slug) continue;
      if (!byCompany.has(b.company_search_id)) byCompany.set(b.company_search_id, []);
      byCompany.get(b.company_search_id)!.push(b);
    }
    let ids = Array.from(byCompany.keys()).sort();
    if (limit) ids = ids.slice(0, limit);
    const companies = new Map<string, CompanyRow>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabase.from('company_searches').select('id, company_name, url, company_number, analysis_result').in('id', ids.slice(i, i + 200));
      if (error) throw new Error(`company_searches read failed: ${error.message}`);
      for (const r of (data || []) as CompanyRow[]) companies.set(r.id, r);
    }
    const started = Date.now();
    const results = await mapWithConcurrency(ids.filter((id) => companies.has(id)), CONCURRENCY, (id) => syncCompany(supabase, companies.get(id)!, byCompany.get(id)!, today, dryRun));
    const boardsChecked = results.reduce((n, r) => n + r.boards.length, 0);
    const boardsOk = results.reduce((n, r) => n + r.boards.filter((b) => b.ok).length, 0);
    const rolesRead = results.reduce((n, r) => n + r.boards.reduce((m, b) => m + b.count, 0), 0);
    const errors = results.filter((r) => r.error).map((r) => `${r.name}: ${r.error}`);
    const failedBoards = results.flatMap((r) => r.boards.filter((b) => !b.ok).map((b) => `${r.name} ${b.provider}/${b.slug}: ${b.note}`));
    Object.assign(details, {
      companies: results.length,
      boardsChecked,
      boardsOk,
      rolesRead,
      rolesMerged: results.reduce((n, r) => n + r.merged, 0),
      openAfter: dryRun ? null : results.reduce((n, r) => n + (r.open ?? 0), 0),
      failedBoards: failedBoards.slice(0, 50),
      errors: errors.slice(0, 50),
      examples: results.slice(0, 10).map((r) => `${r.name}: ${r.boards.map((b) => `${b.provider} ${b.ok ? b.count : 'failed'}`).join(', ')}`),
      ms: Date.now() - started,
    });
    if (errors.length) failed = `${errors.length} compan${errors.length === 1 ? 'y' : 'ies'} failed: ${errors.slice(0, 3).join('; ')}`;
  } catch (e) {
    failed = e instanceof Error ? e.message : String(e);
  }
  if (runId) {
    await supabase.from('pipeline_runs').update({ finished_at: new Date().toISOString(), status: failed ? 'error' : 'completed', error: failed, new_count: typeof details.rolesMerged === 'number' ? details.rolesMerged : null, details }).eq('id', runId);
  }
  return json({ ok: !failed, error: failed, ...details }, failed ? 500 : 200);
});
