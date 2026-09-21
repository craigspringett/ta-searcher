// A prospect's website when no source gave one: guessed from the name and
// verified by fetching it.
//
// Investigation of 21 September 2026 (docs/PROSPECTING-BRIEF.md,
// "Qualification", step 2): a start-up's domain is nearly always its name
// compacted ("metrisenergy") or dashed ("metris-energy") under .com, .io,
// .ai, .co.uk, .co, .tech or .app, so those fourteen are fetched (6 s each,
// four in flight) and the first that answers 200 with the compact name in
// its title or first 3,000 characters of text is taken. A parked domain or
// a hosting default page (looksParked in ../fetch.ts) is never accepted: a
// name under .com is for sale more often than it is a website. A page that
// redirects elsewhere is judged by where it lands, and the website stored
// is that origin.

import { extractTitle, fetchPage, htmlToText, looksParked, mapWithConcurrency, type FetchedPage } from '../fetch.ts';
import { normaliseOrgName } from '../vacancies/employer-match.ts';

export const WEBSITE_TLDS = ['.com', '.io', '.ai', '.co.uk', '.co', '.tech', '.app'];
export const WEBSITE_FETCH_MS = 6000;
const VERIFY_CHARS = 3000;
const CONCURRENCY = 4;

/** The name with its legal suffixes off, lower case: "Metris Energy Ltd" -> "metris energy". */
export function domainWords(name: string): string {
  return normaliseOrgName(name).replace(/\b(?:the|and)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The candidate URLs for a name: compact then dashed, each under every TLD; empty when the name is too short to be a domain. */
export function websiteCandidates(name: string): string[] {
  const words = domainWords(name);
  const compact = words.replace(/\s+/g, '');
  if (compact.length < 3 || compact.length > 40) return [];
  const dashed = words.replace(/\s+/g, '-');
  const labels = dashed !== compact ? [compact, dashed] : [compact];
  const out: string[] = [];
  for (const label of labels) for (const tld of WEBSITE_TLDS) out.push(`https://${label}${tld}/`);
  return out;
}

/** Whether a fetched page is the company's: 200, not parked, and the compact name in the title or the first 3,000 characters. */
export function pageNamesCompany(page: Pick<FetchedPage, 'ok' | 'html'>, name: string): boolean {
  if (!page.ok || !page.html) return false;
  if (looksParked(page.html)) return false;
  const compact = domainWords(name).replace(/\s+/g, '');
  if (compact.length < 3) return false;
  const title = extractTitle(page.html).replace(/[^a-z0-9]/g, '');
  if (title.includes(compact)) return true;
  const text = htmlToText(page.html.slice(0, 60_000)).slice(0, VERIFY_CHARS).toLowerCase();
  // With and without the spaces: "Metris Energy" on the page, "metrisenergy" in the domain.
  return text.replace(/[^a-z0-9]/g, '').includes(compact) || text.includes(domainWords(name));
}

/** "https://www.metris.energy/about" -> "https://www.metris.energy/". */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.hostname.toLowerCase()}/`;
  } catch {
    return null;
  }
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

export interface WebsiteGuess {
  website: string | null;
  /** The homepage that answered, so the board detection need not fetch it again. */
  page: FetchedPage | null;
  tried: string[];
  note: string;
}

type Fetcher = (url: string, ms: number) => Promise<FetchedPage>;

/** Fetch the candidates and take the first (in candidate order) that names the company. Never throws. */
export async function guessWebsite(name: string, fetcher: Fetcher = fetchPage): Promise<WebsiteGuess> {
  const candidates = websiteCandidates(name);
  if (!candidates.length) return { website: null, page: null, tried: [], note: 'the name is too short to guess a domain from' };
  const pages = await mapWithConcurrency(candidates, CONCURRENCY, async (url) => {
    try {
      return await fetcher(url, WEBSITE_FETCH_MS);
    } catch (e) {
      return { url, finalUrl: url, status: 0, ok: false, html: '', error: e instanceof Error ? e.message : String(e), ms: 0 } as FetchedPage;
    }
  });
  for (const page of pages) {
    if (pageNamesCompany(page, name)) {
      const website = originOf(page.finalUrl || page.url) ?? page.url;
      return { website, page, tried: candidates, note: `${website} names the company` };
    }
  }
  const answered = pages.filter((p) => p.ok).length;
  return { website: null, page: null, tried: candidates, note: answered ? `${answered} of ${candidates.length} guesses answered but none names the company` : `none of ${candidates.length} guesses answered` };
}

/** Confirm a website the prospect already has: fetch it once and check it names the company (a stored one is kept even when the check fails; the note says so). */
export async function checkWebsite(url: string, name: string, fetcher: Fetcher = fetchPage): Promise<{ ok: boolean; page: FetchedPage | null; note: string }> {
  try {
    const page = await fetcher(url, WEBSITE_FETCH_MS * 2);
    if (!page.ok) return { ok: false, page: null, note: `${url} did not answer (${page.error || `HTTP ${page.status}`})` };
    if (looksParked(page.html)) return { ok: false, page: null, note: `${url} is a parked page` };
    return { ok: true, page, note: pageNamesCompany(page, name) ? `${url} names the company` : `${url} answers but does not name the company` };
  } catch (e) {
    return { ok: false, page: null, note: `${url}: ${e instanceof Error ? e.message : String(e)}` };
  }
}
