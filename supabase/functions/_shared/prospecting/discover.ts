// The discover pass: every source's candidates merged by name, the tracked
// and recently dismissed ones dropped, the rest written to prospects.
//
// Investigation of 21 September 2026 (docs/PROSPECTING-BRIEF.md): the same
// company arrives from several sources on one night (a raise headline and
// an Adzuna posting) and on several nights (the same posting until it
// closes), so the name's normalised form (normaliseOrgName, the same rule
// the ATS employer match uses) is the key: one row per name_key, sources
// appended without repeats, the newest raise kept, the walk's register
// fields kept when nothing better is known. A company already tracked (its
// name key or its website host is a company_searches row) is never
// created; a prospect dismissed within 180 days is left alone, an older
// dismissal is reopened; a qualified or unsuitable prospect that gains a
// new posting or a new story goes back to `new` so the score is redone. A
// dry run reads the sources and writes nothing.

import { companiesHouseConfigured } from '../companies-house.ts';
import { normaliseOrgName } from '../vacancies/employer-match.ts';
import { loadSettings, saveWalkState } from './settings.ts';
import { adzunaSource, type JobApiResult } from './source-adzuna.ts';
import { reedSource } from './source-reed.ts';
import { newsSource, type NewsSourceResult } from './source-news.ts';
import { walkRegister, type RegisterWalkResult } from './source-companies-house.ts';
import { hostOf } from './website.ts';
import type { ProspectCandidate, ProspectRaise, ProspectRow, ProspectSourceEntry, ProspectSourceKind, TalentPosting } from './types.ts';

// deno-lint-ignore no-explicit-any
type Supabase = any;

export const DISMISSED_QUIET_DAYS = 180;
export const SOURCE_KINDS: ProspectSourceKind[] = ['funding_news', 'companies_house', 'adzuna', 'reed'];
const READ_CHUNK = 40;
const WRITE_CHUNK = 100;

export interface MergedCandidate {
  name: string;
  nameKey: string;
  website: string | null;
  companyNumber: string | null;
  sources: ProspectSourceEntry[];
  raise: ProspectRaise | null;
  register: ProspectCandidate['register'] | null;
  talentPostings: TalentPosting[];
}

function newerRaise(a: ProspectRaise | null, b: ProspectRaise | null): ProspectRaise | null {
  if (!a) return b;
  if (!b) return a;
  return (b.date || '') > (a.date || '') ? b : a;
}

/** One merged candidate per name key, in first-seen order. */
export function mergeCandidates(candidates: ProspectCandidate[]): MergedCandidate[] {
  const byKey = new Map<string, MergedCandidate>();
  for (const c of candidates) {
    const nameKey = normaliseOrgName(c.name);
    if (!nameKey || nameKey.length < 2) continue;
    const have = byKey.get(nameKey);
    if (!have) {
      byKey.set(nameKey, {
        name: c.name.trim(),
        nameKey,
        website: c.website ?? null,
        companyNumber: c.companyNumber ?? null,
        sources: [c.source],
        raise: c.raise ?? null,
        register: c.register ?? null,
        talentPostings: c.talentPosting ? [c.talentPosting] : [],
      });
      continue;
    }
    if (!have.website && c.website) have.website = c.website;
    if (!have.companyNumber && c.companyNumber) have.companyNumber = c.companyNumber;
    if (!have.register && c.register) have.register = c.register;
    // The register's name is the legal one; a headline's or a posting's is the trading name, which the page should show.
    if (have.sources.every((s) => s.source === 'companies_house') && c.source.source !== 'companies_house') have.name = c.name.trim();
    if (!have.sources.some((s) => s.url === c.source.url && s.source === c.source.source)) have.sources.push(c.source);
    have.raise = newerRaise(have.raise, c.raise ?? null);
    if (c.talentPosting && !have.talentPostings.some((p) => p.url === c.talentPosting!.url && p.title === c.talentPosting!.title)) have.talentPostings.push(c.talentPosting);
  }
  return Array.from(byKey.values());
}

export interface Tracked {
  nameKeys: Set<string>;
  hosts: Set<string>;
}

/** Every tracked company's name key and website host. */
export async function loadTracked(supabase: Supabase): Promise<Tracked> {
  const { data, error } = await supabase.from('company_searches').select('company_name, url').limit(5000);
  if (error) throw new Error(`company_searches read failed: ${error.message}`);
  const nameKeys = new Set<string>();
  const hosts = new Set<string>();
  for (const r of data || []) {
    const k = normaliseOrgName(r.company_name);
    if (k) nameKeys.add(k);
    const h = hostOf(r.url);
    if (h) hosts.add(h);
  }
  return { nameKeys, hosts };
}

export function isTracked(tracked: Tracked, nameKey: string, website: string | null | undefined): boolean {
  if (tracked.nameKeys.has(nameKey)) return true;
  const h = hostOf(website);
  return !!h && tracked.hosts.has(h);
}

export function dismissedRecently(row: Pick<ProspectRow, 'status' | 'dismissed_at'>, today: Date): boolean {
  if (row.status !== 'dismissed') return false;
  if (!row.dismissed_at) return true;
  return today.getTime() - Date.parse(row.dismissed_at) < DISMISSED_QUIET_DAYS * 86_400_000;
}

export type ExistingProspect = Pick<ProspectRow, 'id' | 'name' | 'name_key' | 'website' | 'company_number' | 'status' | 'sources' | 'raise' | 'register' | 'talent_postings' | 'dismissed_at'>;

export type MergeOutcome = { kind: 'skip'; reason: 'dismissed' } | { kind: 'update'; patch: Record<string, unknown>; requalify: boolean } | { kind: 'unchanged' };

/** What to write for a candidate that already has a row. */
export function mergeIntoExisting(row: ExistingProspect, c: MergedCandidate, today: Date): MergeOutcome {
  if (dismissedRecently(row, today)) return { kind: 'skip', reason: 'dismissed' };
  const now = today.toISOString();
  const sources = Array.isArray(row.sources) ? [...row.sources] : [];
  const newSources = c.sources.filter((s) => !sources.some((h) => h.url === s.url && h.source === s.source));
  const postings = Array.isArray(row.talent_postings) ? [...row.talent_postings] : [];
  const newPostings = c.talentPostings.filter((p) => !postings.some((h) => h.url === p.url && h.title === p.title));
  const raise = newerRaise(row.raise, c.raise);
  const raiseChanged = JSON.stringify(raise) !== JSON.stringify(row.raise);
  const patch: Record<string, unknown> = { last_seen_at: now };
  if (newSources.length) patch.sources = [...sources, ...newSources];
  if (newPostings.length) patch.talent_postings = [...postings, ...newPostings];
  if (raiseChanged) patch.raise = raise;
  if (!row.website && c.website) patch.website = c.website;
  if (!row.company_number && c.companyNumber) patch.company_number = c.companyNumber;
  if (!row.register && c.register) patch.register = c.register;
  let requalify = false;
  const signal = newPostings.length > 0 || (raiseChanged && !!c.raise) || newSources.some((s) => s.source !== 'companies_house');
  if (row.status === 'dismissed') {
    // Older than the quiet period: reopened.
    patch.status = 'new';
    patch.dismissed_at = null;
    patch.dismiss_reason = null;
    requalify = true;
  } else if ((row.status === 'qualified' || row.status === 'unsuitable') && signal) {
    patch.status = 'new';
    requalify = true;
  }
  return { kind: 'update', patch, requalify };
}

export function rowForInsert(c: MergedCandidate, today: Date): Record<string, unknown> {
  const now = today.toISOString();
  return {
    name: c.name,
    name_key: c.nameKey,
    website: c.website,
    company_number: c.companyNumber,
    status: 'new',
    sources: c.sources,
    raise: c.raise,
    register: c.register ?? null,
    boards: [],
    talent_postings: c.talentPostings,
    prospect_score: null,
    score_reasons: [],
    first_seen_at: now,
    last_seen_at: now,
  };
}

export interface SourceCounts {
  found: number;
  inserted: number;
  updated: number;
  /** True when the source was not asked: no key, or not in the request. */
  skipped: boolean;
  error: string | null;
  ms: number;
}

export interface DiscoverCounts {
  inserted: number;
  updated: number;
  requalified: number;
  skippedTracked: number;
  skippedDismissed: number;
  candidates: number;
  sources: Record<ProspectSourceKind, SourceCounts>;
  /** Agency postings: a note, no company. */
  agencyPostings: TalentPosting[];
  register: { steps: RegisterWalkResult['steps']; nextCursor: number } | null;
  news: Pick<NewsSourceResult, 'feeds' | 'feedsFailed' | 'items' | 'raiseStories' | 'rows'> | null;
  errors: string[];
  dryRun: boolean;
  ms: number;
  /** The first rows a dry run would have written. */
  sample: Record<string, unknown>[];
}

export interface DiscoverOptions {
  today: Date;
  /** Which sources to read (default all four). */
  sources?: string[] | null;
  dryRun?: boolean;
  /** Companies the register walk takes tonight (default 300). */
  limit?: number | null;
  /** The sources, replaceable in tests. */
  deps?: {
    news?: (supabase: Supabase, today: Date) => Promise<NewsSourceResult>;
    register?: (today: Date, state: { cursor: number; watermarks: Record<string, number> }, budget: number) => Promise<RegisterWalkResult>;
    adzuna?: (today: Date) => Promise<JobApiResult>;
    reed?: (today: Date) => Promise<JobApiResult>;
  };
}

function emptyCounts(): SourceCounts {
  return { found: 0, inserted: 0, updated: 0, skipped: true, error: null, ms: 0 };
}

/** The pass. */
export async function discoverProspects(supabase: Supabase, options: DiscoverOptions): Promise<DiscoverCounts> {
  const started = Date.now();
  const today = options.today;
  const dryRun = options.dryRun === true;
  const wanted = new Set<string>((options.sources && options.sources.length ? options.sources : SOURCE_KINDS).map((s) => String(s)));
  const errors: string[] = [];
  const counts: Record<ProspectSourceKind, SourceCounts> = { funding_news: emptyCounts(), companies_house: emptyCounts(), adzuna: emptyCounts(), reed: emptyCounts() };
  const candidates: ProspectCandidate[] = [];
  const agencyPostings: TalentPosting[] = [];
  let registerNote: DiscoverCounts['register'] = null;
  let newsNote: DiscoverCounts['news'] = null;

  const settings = await loadSettings(supabase);

  if (wanted.has('funding_news')) {
    try {
      const r = await (options.deps?.news ?? newsSource)(supabase, today);
      counts.funding_news = { found: r.candidates.length, inserted: 0, updated: 0, skipped: false, error: r.errors.length ? r.errors.slice(0, 3).join('; ') : null, ms: r.ms };
      candidates.push(...r.candidates);
      newsNote = { feeds: r.feeds, feedsFailed: r.feedsFailed, items: r.items, raiseStories: r.raiseStories, rows: r.rows };
    } catch (e) {
      counts.funding_news = { ...emptyCounts(), skipped: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  if (wanted.has('companies_house')) {
    try {
      const budget = options.limit && options.limit > 0 ? Math.floor(options.limit) : undefined;
      const r = options.deps?.register
        ? await options.deps.register(today, { cursor: settings.registerCursor, watermarks: settings.watermarks }, budget ?? 300)
        : await walkRegister(today, { cursor: settings.registerCursor, watermarks: settings.watermarks }, { budget, configured: companiesHouseConfigured() });
      counts.companies_house = { found: r.found, inserted: 0, updated: 0, skipped: !r.configured, error: r.errors.length ? r.errors.slice(0, 3).join('; ') : null, ms: r.ms };
      candidates.push(...r.candidates);
      registerNote = { steps: r.steps, nextCursor: r.nextCursor };
      if (!dryRun && r.configured && r.calls > 0) {
        try {
          await saveWalkState(supabase, { watermarks: r.watermarks, registerCursor: r.nextCursor });
        } catch (e) {
          errors.push(`walk state not saved: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      counts.companies_house = { ...emptyCounts(), skipped: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  for (const kind of ['adzuna', 'reed'] as const) {
    if (!wanted.has(kind)) continue;
    try {
      const r = kind === 'adzuna' ? await (options.deps?.adzuna ?? ((t: Date) => adzunaSource(t)))(today) : await (options.deps?.reed ?? ((t: Date) => reedSource(t)))(today);
      counts[kind] = { found: r.candidates.length, inserted: 0, updated: 0, skipped: !r.configured, error: r.errors.length ? r.errors.slice(0, 3).join('; ') : null, ms: r.ms };
      candidates.push(...r.candidates);
      agencyPostings.push(...r.agency);
    } catch (e) {
      counts[kind] = { ...emptyCounts(), skipped: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  const merged = mergeCandidates(candidates);
  let tracked: Tracked = { nameKeys: new Set(), hosts: new Set() };
  try {
    tracked = await loadTracked(supabase);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  let skippedTracked = 0;
  const fresh = merged.filter((c) => {
    if (isTracked(tracked, c.nameKey, c.website)) { skippedTracked++; return false; }
    return true;
  });

  // The rows that already exist, by name key.
  const existing = new Map<string, ExistingProspect>();
  const keys = fresh.map((c) => c.nameKey);
  for (let i = 0; i < keys.length; i += READ_CHUNK) {
    const { data, error } = await supabase.from('prospects').select('id, name, name_key, website, company_number, status, sources, raise, register, talent_postings, dismissed_at').in('name_key', keys.slice(i, i + READ_CHUNK));
    if (error) { errors.push(`prospects read failed: ${error.message}`); break; }
    for (const r of data || []) existing.set(String(r.name_key), r as ExistingProspect);
  }

  const inserts: Record<string, unknown>[] = [];
  const updates: Array<{ id: string; patch: Record<string, unknown>; kinds: Set<string> }> = [];
  let skippedDismissed = 0;
  let requalified = 0;
  for (const c of fresh) {
    const row = existing.get(c.nameKey);
    if (!row) { inserts.push(rowForInsert(c, today)); continue; }
    const outcome = mergeIntoExisting(row, c, today);
    if (outcome.kind === 'skip') { skippedDismissed++; continue; }
    if (outcome.kind === 'unchanged') continue;
    if (outcome.requalify) requalified++;
    updates.push({ id: row.id, patch: outcome.patch, kinds: new Set(c.sources.map((s) => s.source)) });
  }
  const kindsOf = (row: Record<string, unknown>) => new Set((row.sources as ProspectSourceEntry[]).map((s) => s.source));
  let inserted = 0;
  let updated = 0;
  if (!dryRun) {
    for (let i = 0; i < inserts.length; i += WRITE_CHUNK) {
      const chunk = inserts.slice(i, i + WRITE_CHUNK);
      const { error } = await supabase.from('prospects').upsert(chunk, { onConflict: 'name_key', ignoreDuplicates: true });
      if (error) { errors.push(`prospects insert failed: ${error.message}`); continue; }
      inserted += chunk.length;
      for (const row of chunk) for (const k of kindsOf(row)) counts[k as ProspectSourceKind].inserted++;
    }
    for (const u of updates) {
      const { error } = await supabase.from('prospects').update(u.patch).eq('id', u.id);
      if (error) { errors.push(`prospects update failed: ${error.message}`); continue; }
      updated++;
      for (const k of u.kinds) counts[k as ProspectSourceKind].updated++;
    }
  } else {
    inserted = inserts.length;
    updated = updates.length;
    for (const row of inserts) for (const k of kindsOf(row)) counts[k as ProspectSourceKind].inserted++;
    for (const u of updates) for (const k of u.kinds) counts[k as ProspectSourceKind].updated++;
  }

  return {
    inserted,
    updated,
    requalified,
    skippedTracked,
    skippedDismissed,
    candidates: merged.length,
    sources: counts,
    agencyPostings: agencyPostings.slice(0, 20),
    register: registerNote,
    news: newsNote,
    errors,
    dryRun,
    ms: Date.now() - started,
    sample: inserts.slice(0, 30),
  };
}
