// Companies advertising a talent role on Adzuna today.
//
// Investigation of 21 September 2026 (docs/PROSPECTING-BRIEF.md; no key in
// the build session, so the fixture is hand-written in the documented
// shape): GET https://api.adzuna.com/v1/api/jobs/gb/search/1?app_id=&app_key=
// &what_phrase=<phrase>&where=London&results_per_page=50&max_days_old=30
// answers {results: [{title, company: {display_name}, location:
// {display_name}, created (ISO instant), redirect_url, description}]}. The
// key is a free app id and app key pair (ADZUNA_APP_ID, ADZUNA_APP_KEY);
// without them the source is skipped and the run says so. The redirect_url
// goes through adzuna.co.uk and lands on the employer's page or ATS, which
// qualification follows for the website and the board. One call per phrase
// in TALENT_PHRASES, a 15 s timeout each, never throwing.

import { fetchWithTimeout } from '../fetch.ts';
import { isAgencyEmployer, isProspectPostingTitle, TALENT_PHRASES } from './job-apis.ts';
import type { ProspectCandidate, TalentPosting } from './types.ts';

export const ADZUNA_BASE = 'https://api.adzuna.com/v1/api/jobs/gb/search/1';
const FETCH_MS = 15_000;

export interface AdzunaKeys {
  appId: string;
  appKey: string;
}

export function adzunaKeys(): AdzunaKeys | null {
  try {
    const appId = Deno.env.get('ADZUNA_APP_ID') || '';
    const appKey = Deno.env.get('ADZUNA_APP_KEY') || '';
    return appId && appKey ? { appId, appKey } : null;
  } catch {
    return null;
  }
}

export function adzunaSearchUrl(phrase: string, keys: AdzunaKeys, where = 'London'): string {
  const q = new URLSearchParams({ app_id: keys.appId, app_key: keys.appKey, what_phrase: phrase, where, results_per_page: '50', max_days_old: '30' });
  return `${ADZUNA_BASE}?${q.toString()}`;
}

export interface AdzunaPosting {
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

/** The postings in an Adzuna answer, as written; nothing is filtered here. */
export function parseAdzunaResults(json: any): AdzunaPosting[] {
  const items = Array.isArray(json?.results) ? json.results : [];
  const out: AdzunaPosting[] = [];
  for (const it of items) {
    const title = str(it?.title);
    if (!title) continue;
    const created = str(it?.created);
    out.push({
      title,
      employer: str(it?.company?.display_name),
      location: str(it?.location?.display_name),
      date: created && /^\d{4}-\d{2}-\d{2}/.test(created) ? created.slice(0, 10) : null,
      url: str(it?.redirect_url),
      description: str(it?.description),
    });
  }
  return out;
}

export interface SiftedPostings {
  /** The postings that make a prospect, one per employer and title. */
  candidates: ProspectCandidate[];
  /** Postings from an agency: kept as a note, no company. */
  agency: TalentPosting[];
  /** Titles the role rules did not keep. */
  droppedTitles: number;
}

/** Turn the postings of one source into prospect candidates, dropping agencies and off-topic titles. */
export function siftPostings(postings: Array<{ title: string; employer: string | null; date: string | null; url: string | null }>, source: 'adzuna' | 'reed', foundAt: string): SiftedPostings {
  const candidates: ProspectCandidate[] = [];
  const agency: TalentPosting[] = [];
  const seen = new Set<string>();
  let droppedTitles = 0;
  for (const p of postings) {
    if (!isProspectPostingTitle(p.title)) { droppedTitles++; continue; }
    if (!p.employer) { droppedTitles++; continue; }
    const key = `${p.employer.toLowerCase()}|${p.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const posting: TalentPosting = { title: p.title, employer: p.employer, source, url: p.url || '', date: p.date };
    if (isAgencyEmployer(p.employer)) { agency.push(posting); continue; }
    candidates.push({
      name: p.employer,
      source: { source, url: p.url || '', title: p.title, at: p.date ? `${p.date}T00:00:00.000Z` : foundAt, note: `advertised on ${source === 'adzuna' ? 'Adzuna' : 'Reed'}` },
      talentPosting: posting,
    });
  }
  return { candidates, agency, droppedTitles };
}

export interface JobApiResult {
  source: 'adzuna' | 'reed';
  /** False when the key is not set: nothing was asked. */
  configured: boolean;
  calls: number;
  failed: number;
  found: number;
  candidates: ProspectCandidate[];
  agency: TalentPosting[];
  droppedTitles: number;
  errors: string[];
  ms: number;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Every phrase against Adzuna. Never throws; a phrase that fails is counted and the rest go on. */
export async function adzunaSource(today: Date, options: { keys?: AdzunaKeys | null; fetch?: FetchLike; phrases?: string[] } = {}): Promise<JobApiResult> {
  const started = Date.now();
  const keys = options.keys === undefined ? adzunaKeys() : options.keys;
  const base: JobApiResult = { source: 'adzuna', configured: !!keys, calls: 0, failed: 0, found: 0, candidates: [], agency: [], droppedTitles: 0, errors: [], ms: 0 };
  if (!keys) return { ...base, errors: ['ADZUNA_APP_ID and ADZUNA_APP_KEY not set'], ms: Date.now() - started };
  const doFetch = options.fetch ?? ((u: string, i?: RequestInit) => fetchWithTimeout(u, FETCH_MS, i));
  const postings: AdzunaPosting[] = [];
  for (const phrase of options.phrases ?? TALENT_PHRASES) {
    base.calls++;
    try {
      const res = await doFetch(adzunaSearchUrl(phrase, keys), { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        base.failed++;
        base.errors.push(`"${phrase}": HTTP ${res.status}`);
        continue;
      }
      postings.push(...parseAdzunaResults(await res.json()));
    } catch (e) {
      base.failed++;
      base.errors.push(`"${phrase}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const sifted = siftPostings(postings, 'adzuna', today.toISOString());
  return { ...base, found: postings.length, candidates: sifted.candidates, agency: sifted.agency, droppedTitles: sifted.droppedTitles, ms: Date.now() - started };
}
