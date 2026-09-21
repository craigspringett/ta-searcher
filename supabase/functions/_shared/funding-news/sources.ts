// The funding news feeds and how they are fetched.
//
// Investigation of 21 September 2026 (from the build session, curl with a
// browser User-Agent; the parser's notes are in rss.ts):
//   UKTN   https://www.uktech.news/feed             200, RSS 2.0, 10 items, ~55 KB
//   Sifted https://sifted.eu/feed                   200, RSS 2.0, 24 items, ~10 KB, headlines only
//   Google https://news.google.com/rss/search?q=... 200, RSS 2.0, 100 items, ~137 KB
// All three answer a plain GET with no key. The Google search feed takes
// the query in q= with hl=en-GB&gl=GB&ceid=GB:en for British results; the
// general query looks for "raises" with a round word and London, and the
// per-company query is the company's name in quotes with the raise words,
// so a tracked company's own round is read even when the general feed's
// hundred items have moved on. Every fetch is a plain fetch with a 20 s
// timeout and never throws: a feed that is down is a count in the run,
// not a failed run.

import { parseRssItems, type RssItem } from './rss.ts';

export type FundingSource = 'uktn' | 'sifted' | 'google_news';

export const UKTN_FEED = 'https://www.uktech.news/feed';
export const SIFTED_FEED = 'https://sifted.eu/feed';
export const GOOGLE_NEWS_FEED = 'https://news.google.com/rss/search?q=%22raises%22+seed+OR+%22Series+A%22+OR+%22pre-seed%22+startup+London&hl=en-GB&gl=GB&ceid=GB:en';
export const FEED_TIMEOUT_MS = 20_000;
export const FEED_MAX_BYTES = 2_000_000;

/** The Google News search feed for one tracked company's raise stories. */
export function googleNewsCompanyFeed(name: string): string {
  const q = `"${name.trim().replace(/"/g, '')}" raises OR funding OR "Series A" OR seed`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-GB&gl=GB&ceid=GB:en`;
}

export interface FeedFetch {
  source: FundingSource;
  url: string;
  ok: boolean;
  status: number;
  items: RssItem[];
  error: string | null;
  ms: number;
  /** The tracked company a per-company Google News feed was read for. */
  companyId?: string;
}

export interface FeedSpec {
  source: FundingSource;
  url: string;
  companyId?: string;
}

/** The three general feeds, in the order they are read. */
export function generalFeeds(): FeedSpec[] {
  return [
    { source: 'uktn', url: UKTN_FEED },
    { source: 'sifted', url: SIFTED_FEED },
    { source: 'google_news', url: GOOGLE_NEWS_FEED },
  ];
}

/** Read one feed. Never throws: a failure is an empty item list with the error on the result. */
export async function fetchFeed(spec: FeedSpec, timeoutMs = FEED_TIMEOUT_MS): Promise<FeedFetch> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
  try {
    const res = await fetch(spec.url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5', 'Accept-Language': 'en-GB,en;q=0.9' },
      redirect: 'follow',
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ...spec, ok: false, status: res.status, items: [], error: `HTTP ${res.status}`, ms: Date.now() - started };
    }
    const text = await res.text();
    if (text.length > FEED_MAX_BYTES) return { ...spec, ok: false, status: res.status, items: [], error: `feed larger than ${FEED_MAX_BYTES} bytes`, ms: Date.now() - started };
    const items = parseRssItems(text, { googleNews: spec.source === 'google_news' });
    return { ...spec, ok: true, status: res.status, items, error: items.length ? null : 'no items in the feed', ms: Date.now() - started };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...spec, ok: false, status: 0, items: [], error: msg, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
