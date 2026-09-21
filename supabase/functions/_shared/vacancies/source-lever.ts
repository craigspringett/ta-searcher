// Lever postings feed.
//
// Investigation of 21 September 2026 (from the build session; monzo,
// deliveroo, wise, revolut, octopus-energy, multiverse, cleo and gocardless
// have no Lever site any more, zopa does):
//   GET https://api.lever.co/v0/postings/{slug}?mode=json
//     answers a bare array with no key; 34 postings for "zopa"
//     (fixtures/lever-zopa.json, with the description fields removed to keep
//     the fixture small: the live answer was 766 KB). Each posting carries
//     id, text (the title), categories {team, department, location,
//     commitment ("Employee - Permanent", "Employee - FTC"), allLocations[]},
//     createdAt (a millisecond epoch, the posting date), country (ISO
//     alpha-2), workplaceType ('remote' | 'hybrid' | 'on-site' |
//     'unspecified'), hostedUrl (jobs.lever.co/{slug}/{id}), applyUrl, and
//     the description blocks (description, descriptionPlain, lists, opening,
//     additional). No closing date.
//   An unknown slug answers 404 {"ok":false,"error":"Document not found"}.
//   EU-hosted sites use jobs.eu.lever.co for the page and api.eu.lever.co
//   for the feed; the detector records the slug and this source tries the
//   global host first, then the EU one.
import type { AtsBoard, CandidateVacancy, SourceResult } from './types.ts';
import { employmentTypeOf, fetchJsonFeed, isoDateOf, workplaceTypeOf, type FeedRead } from './feed.ts';

export function leverFeedUrl(slug: string, region: 'global' | 'eu' = 'global'): string {
  return `https://api.${region === 'eu' ? 'eu.' : ''}lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
}

export function leverBoardUrl(slug: string): string {
  return `https://jobs.lever.co/${encodeURIComponent(slug)}`;
}

export interface LeverPosting {
  id: string;
  text: string;
  categories?: { team?: string; department?: string; location?: string; commitment?: string; allLocations?: string[] } | null;
  createdAt?: number | string | null;
  country?: string | null;
  workplaceType?: string | null;
  hostedUrl?: string | null;
  applyUrl?: string | null;
}

export interface LeverFeedRead {
  ok: boolean;
  status: number;
  postings: LeverPosting[];
  note: string | null;
  ms: number;
}

export async function readLeverBoard(board: Pick<AtsBoard, 'slug'>): Promise<LeverFeedRead> {
  let read: FeedRead<unknown> = await fetchJsonFeed(leverFeedUrl(board.slug));
  if (!read.ok && read.status === 404) {
    const eu = await fetchJsonFeed<unknown>(leverFeedUrl(board.slug, 'eu'));
    if (eu.ok) read = eu;
  }
  if (!read.ok) return { ok: false, status: read.status, postings: [], note: read.status === 404 ? `unknown Lever site "${board.slug}" (${read.note})` : read.note, ms: read.ms };
  if (!Array.isArray(read.data)) {
    const err = read.data && typeof read.data === 'object' && typeof (read.data as any).error === 'string' ? (read.data as any).error : 'the feed answered without a postings array';
    return { ok: false, status: read.status, postings: [], note: err, ms: read.ms };
  }
  return { ok: true, status: read.status, postings: read.data as LeverPosting[], note: null, ms: read.ms };
}

export function leverVacancies(postings: LeverPosting[], board: Pick<AtsBoard, 'slug'>): CandidateVacancy[] {
  const out: CandidateVacancy[] = [];
  for (const p of postings || []) {
    if (!p || typeof p !== 'object') continue;
    const title = typeof p.text === 'string' ? p.text.replace(/\s+/g, ' ').trim() : '';
    if (!title) continue;
    const c = p.categories || {};
    const locations = [c.location, ...(Array.isArray(c.allLocations) ? c.allLocations : [])].filter((l): l is string => typeof l === 'string' && !!l.trim()).map((l) => l.trim());
    const url = typeof p.hostedUrl === 'string' && p.hostedUrl ? p.hostedUrl : (typeof p.id === 'string' && p.id ? `${leverBoardUrl(board.slug)}/${p.id}` : null);
    out.push({
      title,
      url,
      source: 'lever',
      datePosted: isoDateOf(p.createdAt ?? null),
      department: (typeof c.department === 'string' && c.department.trim()) || (typeof c.team === 'string' && c.team.trim()) || null,
      location: Array.from(new Set(locations)).join('; ') || null,
      workplaceType: workplaceTypeOf(p.workplaceType),
      employmentType: employmentTypeOf(c.commitment),
      raw: { leverId: p.id, team: c.team ?? null, country: p.country ?? null, applyUrl: p.applyUrl ?? null, board: board.slug },
    });
  }
  return out;
}

export async function leverSource(board: AtsBoard, _today: Date = new Date()): Promise<SourceResult> {
  const started = Date.now();
  try {
    const read = await readLeverBoard(board);
    if (!read.ok) return { source: 'lever', ok: false, vacancies: [], note: read.note ?? 'feed failed', ms: Date.now() - started };
    const vacancies = leverVacancies(read.postings, board);
    return { source: 'lever', ok: true, vacancies, note: `${read.postings.length} postings on the ${board.slug} site`, ms: Date.now() - started };
  } catch (e) {
    return { source: 'lever', ok: false, vacancies: [], note: e instanceof Error ? e.message : String(e), ms: Date.now() - started };
  }
}
