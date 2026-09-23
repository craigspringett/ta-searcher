// The qualify pass: the prospects to look at, each one qualified, stored,
// and promoted when the rule says so (docs/PROSPECTING-BRIEF.md,
// "Qualification"). Order: a talent posting first, then a raise, then the
// register pool, newest first. The nightly run takes `limit` (60) with a
// time budget, three in flight, and reports what it did not reach; the
// page's call names prospectIds and (re)qualifies those whatever their
// status except promoted, promoting when asked even under the threshold
// (the Add button) as long as a website is known.

import { mapWithConcurrency } from '../fetch.ts';
import { dismissedRecently, loadTracked } from './discover.ts';
import { promoteProspect, promotedThisWeek, promotionDecision, singleActiveConsultant } from './promote.ts';
import { liveDeps, qualifyProspect, type QualifyDeps } from './qualify.ts';
import { loadSettings } from './settings.ts';
import type { ProspectRow, ScoreReason } from './types.ts';

// deno-lint-ignore no-explicit-any
type Supabase = any;

export const DEFAULT_QUALIFY_LIMIT = 60;
export const DEFAULT_BUDGET_MS = 120_000;
const CONCURRENCY = 3;
const POOL_READ = 400;

export interface QualifyOptions {
  today: Date;
  limit?: number | null;
  /** With prospectIds, add them (default true). The nightly pass never adds; everything waits on the Prospects page. */
  promote?: boolean;
  /** (Re)qualify these whatever their status except promoted; with promote, promote even under the threshold. */
  prospectIds?: string[] | null;
  /** The nightly pool is the new rows with a signal (a raise or a talent posting); true takes the register-only rows too (23 September 2026). */
  includeRegisterOnly?: boolean;
  /** With one prospectId: the website to store on it before qualifying (the page's "website not found" input). */
  website?: string | null;
  dryRun?: boolean;
  /** Stop taking new prospects after this long (the nightly run). */
  budgetMs?: number;
  supabaseUrl: string;
  /** The network, replaceable in tests. */
  deps?: (trackedHosts: Set<string>) => QualifyDeps;
}

export interface QualifyResultLine {
  prospectId: string;
  name: string;
  status: string;
  score: number | null;
  promotedCompanyId: string | null;
  note: string | null;
  /** The score's lines, so a dry run can be read without the table. */
  reasons?: ScoreReason[];
}

export interface QualifyCounts {
  checked: number;
  qualified: number;
  promoted: number;
  unsuitable: number;
  tracked: number;
  /** Prospects the budget did not reach. */
  remaining: number;
  candidatesPromotable: number;
  promotedThisWeek: number;
  cap: number;
  threshold: number;
  consultant: string | null;
  results: QualifyResultLine[];
  errors: string[];
  dryRun: boolean;
  ms: number;
}

/** The queue order: a talent posting, then a raise, then the rest; newest first within each. */
export function orderForQualification<T extends Pick<ProspectRow, 'talent_postings' | 'raise' | 'last_seen_at' | 'first_seen_at'>>(rows: T[]): T[] {
  const tier = (r: T) => (Array.isArray(r.talent_postings) && r.talent_postings.length ? 0 : r.raise ? 1 : 2);
  return [...rows].sort((a, b) => tier(a) - tier(b) || (b.last_seen_at || b.first_seen_at || '').localeCompare(a.last_seen_at || a.first_seen_at || ''));
}

/** "metris.energy", "www.metris.energy/about" or "https://metris.energy" to "https://metris.energy/"; null when it is not a host. */
export function normaliseWebsiteInput(input: string): string | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
    return `${u.protocol}//${host}/`;
  } catch {
    return null;
  }
}

const COLUMNS = 'id, name, name_key, website, company_number, status, sources, raise, register, boards, talent_postings, prospect_score, score_reasons, first_seen_at, last_seen_at, qualified_at, promoted_at, dismissed_at, promoted_company_id, dismiss_reason';

/** The pass. */
export async function qualifyProspects(supabase: Supabase, options: QualifyOptions): Promise<QualifyCounts> {
  const started = Date.now();
  const today = options.today;
  const dryRun = options.dryRun === true;
  const byId = !!(options.prospectIds && options.prospectIds.length);
  // The radar never adds a company on its own (22 September 2026): a
  // prospect joins the patch only when the page names it (Add to my patch).
  const wantPromote = options.promote !== false && byId;
  const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : DEFAULT_QUALIFY_LIMIT;
  const budgetMs = options.budgetMs ?? (byId ? Number.MAX_SAFE_INTEGER : DEFAULT_BUDGET_MS);
  const errors: string[] = [];

  const settings = await loadSettings(supabase);
  let rows: ProspectRow[] = [];
  if (byId) {
    const { data, error } = await supabase.from('prospects').select(COLUMNS).in('id', options.prospectIds!.slice(0, 50));
    if (error) throw new Error(`prospects read failed: ${error.message}`);
    rows = (data || []).filter((r: ProspectRow) => r.status !== 'promoted');
    for (const r of (data || []).filter((r: ProspectRow) => r.status === 'promoted')) errors.push(`${r.name} is already promoted`);
    // The page's "Add the website" input: stored on the one row before it is qualified again.
    if (options.website !== undefined && options.website !== null) {
      const website = normaliseWebsiteInput(options.website);
      if (!website) throw new Error(`"${options.website}" is not a website`);
      if (rows.length !== 1) throw new Error('a website is set on one prospect at a time');
      rows[0].website = website;
      if (!dryRun) {
        const { error } = await supabase.from('prospects').update({ website, last_seen_at: today.toISOString() }).eq('id', rows[0].id);
        if (error) throw new Error(`prospects update failed: ${error.message}`);
      }
    }
  } else {
    // The nightly pool (23 September 2026; Craig: the register walk adds
    // 240 a night and the queue never clears): only new rows with a signal,
    // a raise or a talent posting. A register-only row waits, unqualified,
    // until discovery sees one for it (mergeIntoExisting flags it then).
    if (options.includeRegisterOnly) {
      const { data, error } = await supabase.from('prospects').select(COLUMNS).eq('status', 'new').order('last_seen_at', { ascending: false }).limit(POOL_READ);
      if (error) throw new Error(`prospects read failed: ${error.message}`);
      rows = orderForQualification((data || []) as ProspectRow[]).slice(0, limit);
    } else {
      const [withRaise, withPosting] = await Promise.all([
        supabase.from('prospects').select(COLUMNS).eq('status', 'new').not('raise', 'is', null).order('last_seen_at', { ascending: false }).limit(POOL_READ),
        supabase.from('prospects').select(COLUMNS).eq('status', 'new').neq('talent_postings', '[]').order('last_seen_at', { ascending: false }).limit(POOL_READ),
      ]);
      if (withRaise.error) throw new Error(`prospects read failed: ${withRaise.error.message}`);
      if (withPosting.error) throw new Error(`prospects read failed: ${withPosting.error.message}`);
      const seen = new Set<string>();
      const pool: ProspectRow[] = [];
      for (const r of [...(withPosting.data || []), ...(withRaise.data || [])] as ProspectRow[]) { if (!seen.has(r.id)) { seen.add(r.id); pool.push(r); } }
      rows = orderForQualification(pool).slice(0, limit);
    }
  }

  const tracked = await loadTracked(supabase);
  const deps = (options.deps ?? liveDeps)(tracked.hosts);
  const consultantRow = wantPromote ? await singleActiveConsultant(supabase) : null;
  const consultant: { id: string | null; name: string | null; error: string | null } = consultantRow === null
    ? { id: null, name: null, error: 'promotion not asked for' }
    : consultantRow.id !== null
    ? { id: consultantRow.id, name: consultantRow.name, error: null }
    : { id: null, name: null, error: consultantRow.error };
  let weekCount = wantPromote ? await promotedThisWeek(supabase, today) : 0;
  if (wantPromote && !consultant.id) errors.push(`no promotion: ${consultant.error}`);

  const counts: QualifyCounts = {
    checked: 0, qualified: 0, promoted: 0, unsuitable: 0, tracked: 0, remaining: 0, candidatesPromotable: 0,
    promotedThisWeek: weekCount, cap: settings.weeklyPromoteCap, threshold: settings.autoPromoteScore,
    consultant: consultant.name, results: [], errors, dryRun, ms: 0,
  };
  const deadline = started + budgetMs;
  let index = 0;
  const skipped: ProspectRow[] = [];

  await mapWithConcurrency(rows, CONCURRENCY, async (row) => {
    if (Date.now() > deadline) { skipped.push(row); return; }
    index++;
    let line: QualifyResultLine = { prospectId: row.id, name: row.name, status: row.status, score: row.prospect_score, promotedCompanyId: row.promoted_company_id, note: null };
    try {
      const outcome = await qualifyProspect(row, deps, today);
      counts.checked++;
      line = { ...line, status: outcome.status, score: outcome.score, note: outcome.note, reasons: outcome.reasons };
      if (!dryRun) {
        const { error } = await supabase.from('prospects').update(outcome.patch).eq('id', row.id);
        if (error) { errors.push(`${row.name}: prospects update failed: ${error.message}`); line.note = `${outcome.note}; not stored (${error.message})`; }
      }
      if (outcome.status === 'unsuitable') counts.unsuitable++;
      else if (outcome.status === 'dismissed') counts.tracked++;
      else counts.qualified++;

      if (wantPromote && outcome.status === 'qualified') {
        const decision = promotionDecision({
          score: outcome.score,
          threshold: settings.autoPromoteScore,
          website: outcome.website,
          promotedThisWeek: weekCount,
          cap: settings.weeklyPromoteCap,
          tracked: false,
          dismissedRecently: dismissedRecently(row, today),
          forced: byId,
        });
        if (decision.promote) counts.candidatesPromotable++;
        if (decision.promote && !consultant.id) {
          line.note = `${outcome.note}; not added: ${consultant.error}`;
        } else if (decision.promote && dryRun) {
          line.note = `${outcome.note}; would be added (${decision.reason})`;
        } else if (decision.promote) {
          try {
            const done = await promoteProspect(supabase, {
              prospectId: row.id, name: row.name, website: outcome.website!, companyNumber: (outcome.patch.company_number as string | null) ?? null,
              boards: outcome.boards, consultantId: consultant.id!, supabaseUrl: options.supabaseUrl, today,
            });
            weekCount++;
            counts.promoted++;
            counts.qualified--;
            line = { ...line, status: 'promoted', promotedCompanyId: done.companyId, note: `${outcome.note}; ${done.note}` };
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            errors.push(`${row.name}: ${msg}`);
            line.note = `${outcome.note}; not added: ${msg}`;
          }
        } else {
          line.note = `${outcome.note}; not added: ${decision.reason}`;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${row.name}: ${msg}`);
      line.note = `failed: ${msg}`;
    }
    counts.results.push(line);
  });
  counts.remaining = skipped.length;
  counts.promotedThisWeek = weekCount;
  counts.ms = Date.now() - started;
  return counts;
}
