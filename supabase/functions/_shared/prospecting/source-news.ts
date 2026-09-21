// Raise headlines whose company nobody tracks: from the funding_news table
// (slice 2's feeds, matched to nothing) and from a set of extra Google
// News searches read here.
//
// Investigation of 21 September 2026 (docs/PROSPECTING-BRIEF.md, "Funding
// news"): sync-funding-news stores every raise story from UKTN, Sifted and
// one general Google News search; the rows with no matched company of the
// last 30 days are prospects with the raise attached. The brief's eight
// extra searches ("seed round" London, "pre-seed" UK start-up, and so on)
// are read as RSS through the same feed reader (../funding-news/sources.ts)
// and the same raise rule (../funding-news/detect.ts); their headlines are
// not written to funding_news, only to prospects, so the two tables keep
// their meanings. A headline with no readable company name is dropped.

import { isRaiseStory, parseRaise } from '../funding-news/detect.ts';
import { fetchFeed, type FeedFetch, type FeedSpec } from '../funding-news/sources.ts';
import { mapWithConcurrency } from '../fetch.ts';
import type { ProspectCandidate } from './types.ts';

/** The brief's extra Google News queries, one RSS read each. */
export const PROSPECT_NEWS_QUERIES: string[] = [
  '"seed round" London',
  '"pre-seed" UK start-up',
  '"Series A" UK',
  '"raises" fintech London',
  '"raises" AI London',
  '"raises" healthtech UK',
  '"raises" climate UK',
  '"raises" B2B SaaS UK',
];

export const FUNDING_NEWS_DAYS = 30;
const FEED_CONCURRENCY = 4;

export function googleNewsQueryFeed(query: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-GB&gl=GB&ceid=GB:en`;
}

export function newsFeedSpecs(): FeedSpec[] {
  return PROSPECT_NEWS_QUERIES.map((q) => ({ source: 'google_news' as const, url: googleNewsQueryFeed(q) }));
}

/** The raise stories in the feeds as candidates, one per company name (the newest story wins). */
export function candidatesFromFeeds(feeds: FeedFetch[], foundAt: string): { candidates: ProspectCandidate[]; items: number; raiseStories: number; unnamed: number } {
  const byName = new Map<string, ProspectCandidate>();
  let items = 0;
  let raiseStories = 0;
  let unnamed = 0;
  for (const feed of feeds) {
    for (const item of feed.items) {
      items++;
      if (!isRaiseStory(item.title, item.description)) continue;
      raiseStories++;
      const parsed = parseRaise(item.title, item.description);
      if (!parsed.companyName) { unnamed++; continue; }
      const date = item.publishedAt ? item.publishedAt.slice(0, 10) : null;
      const candidate: ProspectCandidate = {
        name: parsed.companyName,
        source: { source: 'funding_news', url: item.link, title: item.title, at: item.publishedAt ?? foundAt, note: item.publisher ? `Google News, ${item.publisher}` : 'Google News' },
        raise: { amountText: parsed.amountText, amountGbp: parsed.amountGbp, round: parsed.round, date, url: item.link },
      };
      const key = parsed.companyName.toLowerCase();
      const have = byName.get(key);
      if (!have || (date && (!have.raise?.date || date > have.raise.date))) byName.set(key, candidate);
    }
  }
  return { candidates: Array.from(byName.values()), items, raiseStories, unnamed };
}

export interface FundingNewsRowLike {
  id?: string;
  source?: string | null;
  title: string;
  url: string;
  publisher?: string | null;
  published_at?: string | null;
  company_name: string | null;
  amount_text?: string | null;
  amount_gbp?: number | null;
  round?: string | null;
}

/** Unmatched funding_news rows as candidates, one per company name. */
export function candidatesFromFundingNewsRows(rows: FundingNewsRowLike[], foundAt: string): ProspectCandidate[] {
  const byName = new Map<string, ProspectCandidate>();
  for (const r of rows) {
    const name = (r.company_name || '').trim();
    if (!name) continue;
    const date = r.published_at ? String(r.published_at).slice(0, 10) : null;
    const sourceLabel = r.source === 'uktn' ? 'UKTN' : r.source === 'sifted' ? 'Sifted' : 'Google News';
    const candidate: ProspectCandidate = {
      name,
      source: { source: 'funding_news', url: r.url, title: r.title, at: r.published_at ?? foundAt, note: r.publisher ? `${sourceLabel}, ${r.publisher}` : sourceLabel },
      raise: { amountText: r.amount_text ?? null, amountGbp: r.amount_gbp === null || r.amount_gbp === undefined ? null : Number(r.amount_gbp), round: r.round ?? null, date, url: r.url },
    };
    const key = name.toLowerCase();
    const have = byName.get(key);
    if (!have || (date && (!have.raise?.date || date > have.raise.date))) byName.set(key, candidate);
  }
  return Array.from(byName.values());
}

export interface NewsSourceResult {
  feeds: number;
  feedsFailed: number;
  items: number;
  raiseStories: number;
  unnamed: number;
  rows: number;
  candidates: ProspectCandidate[];
  errors: string[];
  ms: number;
}

// deno-lint-ignore no-explicit-any
type Supabase = any;

/** The unmatched funding_news rows of the last 30 days plus the extra searches. Never throws. */
export async function newsSource(supabase: Supabase, today: Date, options: { fetch?: (spec: FeedSpec) => Promise<FeedFetch>; specs?: FeedSpec[] } = {}): Promise<NewsSourceResult> {
  const started = Date.now();
  const foundAt = today.toISOString();
  const errors: string[] = [];
  let rowCandidates: ProspectCandidate[] = [];
  try {
    const since = new Date(today.getTime() - FUNDING_NEWS_DAYS * 86_400_000).toISOString();
    const { data, error } = await supabase.from('funding_news').select('id, source, title, url, publisher, published_at, company_name, amount_text, amount_gbp, round').is('matched_company_search_id', null).gte('published_at', since).order('published_at', { ascending: false }).limit(500);
    if (error) errors.push(`funding_news read failed: ${error.message}`);
    rowCandidates = candidatesFromFundingNewsRows(data || [], foundAt);
  } catch (e) {
    errors.push(`funding_news read failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const read = options.fetch ?? ((spec: FeedSpec) => fetchFeed(spec));
  const specs = options.specs ?? newsFeedSpecs();
  let feeds: FeedFetch[] = [];
  try {
    feeds = await mapWithConcurrency(specs, FEED_CONCURRENCY, (s) => read(s));
  } catch (e) {
    errors.push(`feeds: ${e instanceof Error ? e.message : String(e)}`);
  }
  for (const f of feeds) if (!f.ok) errors.push(`${f.url}: ${f.error}`);
  const fromFeeds = candidatesFromFeeds(feeds, foundAt);
  return {
    feeds: feeds.length,
    feedsFailed: feeds.filter((f) => !f.ok).length,
    items: fromFeeds.items,
    raiseStories: fromFeeds.raiseStories,
    unnamed: fromFeeds.unnamed,
    rows: rowCandidates.length,
    candidates: [...rowCandidates, ...fromFeeds.candidates],
    errors,
    ms: Date.now() - started,
  };
}
