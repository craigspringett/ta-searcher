// Companies advertising a talent role on Reed today.
//
// Investigation of 21 September 2026 (docs/PROSPECTING-BRIEF.md; no key in
// the build session, so the fixture is hand-written in the documented
// shape): GET https://www.reed.co.uk/api/1.0/search?keywords=<phrase>
// &locationName=London&distanceFromLocation=30&resultsToTake=100 with HTTP
// Basic auth, the key as the username and an empty password (REED_API_KEY;
// without it the source is skipped and the run says so). The answer is
// {results: [{jobId, employerName, jobTitle, locationName, date, jobUrl,
// jobDescription}]} and the date is written UK-first (dd/mm/yyyy), so it
// is parsed that way. Reed has no age filter, so postings older than 30
// days are dropped here. One call per phrase, 15 s each, never throwing.

import { fetchWithTimeout } from '../fetch.ts';
import { TALENT_PHRASES } from './job-apis.ts';
import { siftPostings, type JobApiResult } from './source-adzuna.ts';

export const REED_BASE = 'https://www.reed.co.uk/api/1.0/search';
const FETCH_MS = 15_000;
const MAX_DAYS_OLD = 30;

export function reedKey(): string | null {
  try {
    return Deno.env.get('REED_API_KEY') || null;
  } catch {
    return null;
  }
}

export function reedSearchUrl(keywords: string, locationName = 'London'): string {
  const q = new URLSearchParams({ keywords, locationName, distanceFromLocation: '30', resultsToTake: '100' });
  return `${REED_BASE}?${q.toString()}`;
}

export interface ReedPosting {
  jobId: string | null;
  title: string;
  employer: string | null;
  location: string | null;
  /** ISO date. */
  date: string | null;
  url: string | null;
  description: string | null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s || null;
}

/** Reed writes "21/09/2026"; an ISO date is accepted too. */
export function reedDateToIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const uk = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (uk) return `${uk[3]}-${uk[2].padStart(2, '0')}-${uk[1].padStart(2, '0')}`;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : null;
}

/** The postings in a Reed answer, as written. */
export function parseReedResults(json: any): ReedPosting[] {
  const items = Array.isArray(json?.results) ? json.results : [];
  const out: ReedPosting[] = [];
  for (const it of items) {
    const title = str(it?.jobTitle);
    if (!title) continue;
    out.push({
      jobId: str(it?.jobId),
      title,
      employer: str(it?.employerName),
      location: str(it?.locationName),
      date: reedDateToIso(str(it?.date)),
      url: str(it?.jobUrl) ?? (str(it?.jobId) ? `https://www.reed.co.uk/jobs/${str(it?.jobId)}` : null),
      description: str(it?.jobDescription),
    });
  }
  return out;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Every phrase against Reed. Never throws. */
export async function reedSource(today: Date, options: { key?: string | null; fetch?: FetchLike; phrases?: string[] } = {}): Promise<JobApiResult> {
  const started = Date.now();
  const key = options.key === undefined ? reedKey() : options.key;
  const base: JobApiResult = { source: 'reed', configured: !!key, calls: 0, failed: 0, found: 0, candidates: [], agency: [], droppedTitles: 0, errors: [], ms: 0 };
  if (!key) return { ...base, errors: ['REED_API_KEY not set'], ms: Date.now() - started };
  const doFetch = options.fetch ?? ((u: string, i?: RequestInit) => fetchWithTimeout(u, FETCH_MS, i));
  const since = new Date(today.getTime() - MAX_DAYS_OLD * 86_400_000).toISOString().slice(0, 10);
  const postings: ReedPosting[] = [];
  for (const phrase of options.phrases ?? TALENT_PHRASES) {
    base.calls++;
    try {
      const res = await doFetch(reedSearchUrl(phrase), { headers: { Accept: 'application/json', Authorization: `Basic ${btoa(`${key}:`)}` } });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        base.failed++;
        base.errors.push(`"${phrase}": HTTP ${res.status}`);
        continue;
      }
      for (const p of parseReedResults(await res.json())) {
        if (p.date && p.date < since) continue;
        postings.push(p);
      }
    } catch (e) {
      base.failed++;
      base.errors.push(`"${phrase}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const sifted = siftPostings(postings, 'reed', today.toISOString());
  return { ...base, found: postings.length, candidates: sifted.candidates, agency: sifted.agency, droppedTitles: sifted.droppedTitles, ms: Date.now() - started };
}
