// The funding news pass: read the feeds, keep the raise stories, store one
// row per article in funding_news and match each to a tracked company.
//
// Investigation of 21 September 2026: a raise story surfaces in more than
// one feed (UKTN's own item and Google News's redirect to it are two URLs,
// but a story in the general Google feed and in a company's own Google
// feed is the same redirect), so the canonical article URL is the key and
// a run dedupes on it before writing. A tracked company is matched by
// name (match.ts) with its register name, previous names and website host
// as aliases; a story from a company's own Google feed is also matched
// when the headline names the company outright, whatever the name parser
// made of it. Unmatched rows of the last 90 days are matched again on
// every run, so a company added from the "New raises this week" card
// picks up its story the next morning. A dry run reads and matches but
// writes nothing.

import { mapWithConcurrency } from '../fetch.ts';
import { isRaiseStory, parseRaise } from './detect.ts';
import { headlineNamesCompany, matchCompany, type TrackedCompany } from './match.ts';
import { fetchFeed, generalFeeds, googleNewsCompanyFeed, type FeedFetch, type FeedSpec, type FundingSource } from './sources.ts';

// deno-lint-ignore no-explicit-any
type Supabase = any;

export const DEFAULT_LIMIT_COMPANIES = 200;
const COMPANY_FEED_CONCURRENCY = 4;
const REMATCH_DAYS = 90;
const WRITE_CHUNK = 100;

export interface SyncOptions {
  today: Date;
  /** Read a Google News feed per tracked company (default true). */
  perCompany?: boolean;
  /** How many tracked companies get their own feed (default 200, newest first). */
  limitCompanies?: number;
  /** Read and match, write nothing. */
  dryRun?: boolean;
  /** The feed reader, replaceable in tests. */
  fetch?: (spec: FeedSpec) => Promise<FeedFetch>;
}

export interface FundingNewsRow {
  source: FundingSource;
  external_key: string;
  title: string;
  url: string;
  publisher: string | null;
  published_at: string | null;
  summary: string | null;
  company_name: string | null;
  amount_text: string | null;
  amount_gbp: number | null;
  round: string | null;
  matched_company_search_id: string | null;
  match_note: string | null;
}

export interface SyncCounts {
  feeds: number;
  feedsFailed: number;
  companyFeeds: number;
  companies: number;
  items: number;
  raiseStories: number;
  unique: number;
  inserted: number;
  updated: number;
  matched: number;
  rematched: number;
  dryRun: boolean;
  ms: number;
  feedNotes: Array<{ source: FundingSource; url: string; ok: boolean; items: number; error: string | null; ms: number }>;
  errors: string[];
  /** The first rows of the run, for a dry run's answer. */
  sample: FundingNewsRow[];
}

/** The canonical article URL: lower-cased host, no query or hash, no trailing slash; null when the link is not a URL. */
export function externalKey(link: string): string | null {
  try {
    const u = new URL(link.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host.toLowerCase()}${path}`;
  } catch {
    return null;
  }
}

/** The website's host as a name alias ("searchable.ai"), or null. */
function hostAlias(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/**
 * Every tracked company with the names a headline might use: the typed
 * name, the register's name and previous names, and the website host.
 */
export async function loadTrackedCompanies(supabase: Supabase): Promise<TrackedCompany[]> {
  const { data, error } = await supabase
    .from('company_searches')
    .select('id, company_name, url, record:analysis_result->companyRecord')
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) throw new Error(`company_searches read failed: ${error.message}`);
  const out: TrackedCompany[] = [];
  for (const row of data || []) {
    const record = row.record && typeof row.record === 'object' ? row.record as Record<string, unknown> : {};
    const names = [row.company_name, record.name, ...(Array.isArray(record.previousNames) ? record.previousNames : []), hostAlias(row.url)]
      .map((n) => (typeof n === 'string' ? n.trim() : ''))
      .filter((n) => n.length >= 2);
    if (!names.length) continue;
    const [name, ...aliases] = Array.from(new Set(names));
    out.push({ id: String(row.id), name, aliases });
  }
  return out;
}

/** Turn the feeds' items into rows, one per canonical URL, matched to the tracked companies. */
export function rowsFromFeeds(feeds: FeedFetch[], companies: TrackedCompany[]): { rows: FundingNewsRow[]; items: number; raiseStories: number } {
  const byId = new Map(companies.map((c) => [c.id, c]));
  const byKey = new Map<string, FundingNewsRow>();
  let items = 0;
  let raiseStories = 0;
  for (const feed of feeds) {
    for (const item of feed.items) {
      items++;
      if (!isRaiseStory(item.title, item.description)) continue;
      const key = externalKey(item.link);
      if (!key) continue;
      raiseStories++;
      const parsed = parseRaise(item.title, item.description);
      const row: FundingNewsRow = byKey.get(key) ?? {
        source: feed.source,
        external_key: key,
        title: item.title,
        url: item.link,
        publisher: item.publisher,
        published_at: item.publishedAt,
        summary: item.description || null,
        company_name: parsed.companyName,
        amount_text: parsed.amountText,
        amount_gbp: parsed.amountGbp,
        round: parsed.round,
        matched_company_search_id: null,
        match_note: null,
      };
      if (!row.matched_company_search_id && feed.companyId) {
        const c = byId.get(feed.companyId);
        if (c) {
          const m = matchCompany(parsed.companyName, [c]);
          if (m) { row.matched_company_search_id = c.id; row.match_note = m.note; }
          else if (headlineNamesCompany(item.title, c)) { row.matched_company_search_id = c.id; row.match_note = 'named in the headline of its own feed'; }
        }
      }
      if (!row.matched_company_search_id) {
        const m = matchCompany(parsed.companyName, companies);
        if (m) { row.matched_company_search_id = m.id; row.match_note = m.note; }
      }
      byKey.set(key, row);
    }
  }
  return { rows: Array.from(byKey.values()), items, raiseStories };
}

/** The pass. */
export async function syncFundingNews(supabase: Supabase, options: SyncOptions): Promise<SyncCounts> {
  const started = Date.now();
  const perCompany = options.perCompany !== false;
  const limitCompanies = options.limitCompanies && options.limitCompanies > 0 ? Math.floor(options.limitCompanies) : DEFAULT_LIMIT_COMPANIES;
  const dryRun = options.dryRun === true;
  const read = options.fetch ?? ((spec: FeedSpec) => fetchFeed(spec));
  const errors: string[] = [];

  const companies = await loadTrackedCompanies(supabase);

  const specs: FeedSpec[] = generalFeeds();
  const companySpecs: FeedSpec[] = perCompany
    ? companies.slice(0, limitCompanies).map((c) => ({ source: 'google_news' as const, url: googleNewsCompanyFeed(c.name), companyId: c.id }))
    : [];
  const general = await mapWithConcurrency(specs, specs.length, (s) => read(s));
  const own = await mapWithConcurrency(companySpecs, COMPANY_FEED_CONCURRENCY, (s) => read(s));
  const feeds = [...general, ...own];

  const { rows, items, raiseStories } = rowsFromFeeds(feeds, companies);
  const matched = rows.filter((r) => r.matched_company_search_id).length;

  let inserted = 0;
  let updated = 0;
  let rematched = 0;
  if (!dryRun && rows.length) {
    // Which keys are already stored, so the run can say new against seen again.
    const existing = new Set<string>();
    const keys = rows.map((r) => r.external_key);
    for (let i = 0; i < keys.length; i += 200) {
      const { data, error } = await supabase.from('funding_news').select('external_key').in('external_key', keys.slice(i, i + 200));
      if (error) { errors.push(`funding_news read failed: ${error.message}`); break; }
      for (const r of data || []) existing.add(String(r.external_key));
    }
    for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
      const chunk = rows.slice(i, i + WRITE_CHUNK);
      const { error } = await supabase.from('funding_news').upsert(chunk, { onConflict: 'external_key' });
      if (error) { errors.push(`funding_news upsert failed: ${error.message}`); continue; }
      for (const r of chunk) { if (existing.has(r.external_key)) updated++; else inserted++; }
    }
  }
  if (!dryRun && companies.length) {
    // Stories stored before their company was tracked.
    const since = new Date(options.today.getTime() - REMATCH_DAYS * 86_400_000).toISOString();
    const { data, error } = await supabase.from('funding_news').select('id, company_name, title').is('matched_company_search_id', null).gte('published_at', since).order('published_at', { ascending: false }).limit(500);
    if (error) errors.push(`funding_news rematch read failed: ${error.message}`);
    for (const r of data || []) {
      const m = matchCompany(r.company_name, companies);
      if (!m) continue;
      const { error: uErr } = await supabase.from('funding_news').update({ matched_company_search_id: m.id, match_note: m.note }).eq('id', r.id);
      if (uErr) { errors.push(`funding_news rematch update failed: ${uErr.message}`); continue; }
      rematched++;
    }
  }

  return {
    feeds: feeds.length,
    feedsFailed: feeds.filter((f) => !f.ok).length,
    companyFeeds: own.length,
    companies: companies.length,
    items,
    raiseStories,
    unique: rows.length,
    inserted,
    updated,
    matched,
    rematched,
    dryRun,
    ms: Date.now() - started,
    feedNotes: feeds.slice(0, 12).map((f) => ({ source: f.source, url: f.url, ok: f.ok, items: f.items.length, error: f.error, ms: f.ms })),
    errors,
    sample: rows.slice(0, 50),
  };
}
