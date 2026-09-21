// Ashby job board feed.
//
// Investigation of 21 September 2026 (from the build session, Searchable's
// board, the first proof point):
//   GET https://api.ashbyhq.com/posting-api/job-board/{slug}
//     answers {"jobs":[...]} with no key and no rate limit seen; 13 jobs for
//     "searchable" (fixtures/ashby-searchable.json). Each job carries id,
//     title, department, team, employmentType (FullTime, PartTime, Contract,
//     Intern, Temporary), location, secondaryLocations[{location, address}],
//     publishedAt (ISO datetime, the posting date), isListed, isRemote,
//     workplaceType (Remote, Hybrid, OnSite, or null when the posting does
//     not say: one of Searchable's SDR roles), address.postalAddress
//     {addressLocality, addressRegion, addressCountry}, jobUrl (the public
//     posting on jobs.ashbyhq.com/{slug}/{id}) and applyUrl. Titles can
//     carry a trailing space ("Sales Development Representative (SDR) ").
//     ?includeCompensation=true adds a compensation block; not requested.
//   An unknown slug answers 404 {"errors":["Job board not found"]}.
//   Only isListed jobs are public; the rest are drafts or internal postings.
import type { AtsBoard, CandidateVacancy, SourceResult } from './types.ts';
import { employmentTypeOf, fetchJsonFeed, isoDateOf, locationTextOf, workplaceTypeOf, type FeedRead } from './feed.ts';

export function ashbyFeedUrl(slug: string): string {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`;
}

export function ashbyBoardUrl(slug: string): string {
  return `https://jobs.ashbyhq.com/${encodeURIComponent(slug)}`;
}

export interface AshbyJob {
  id: string;
  title: string;
  department: string | null;
  team: string | null;
  employmentType: string | null;
  location: string | null;
  secondaryLocations: Array<{ location?: string }>;
  publishedAt: string | null;
  isListed: boolean;
  isRemote: boolean;
  workplaceType: string | null;
  jobUrl: string | null;
  applyUrl: string | null;
  address?: { postalAddress?: { addressLocality?: string; addressRegion?: string; addressCountry?: string; postalCode?: string } } | null;
}

export interface AshbyFeedRead {
  ok: boolean;
  status: number;
  jobs: AshbyJob[];
  note: string | null;
  ms: number;
}

/** Read the board once; ok only when the feed answered a jobs array. */
export async function readAshbyBoard(board: Pick<AtsBoard, 'slug'>): Promise<AshbyFeedRead> {
  const read: FeedRead<{ jobs?: unknown }> = await fetchJsonFeed(ashbyFeedUrl(board.slug));
  if (!read.ok) return { ok: false, status: read.status, jobs: [], note: read.status === 404 ? `unknown Ashby board "${board.slug}" (${read.note})` : read.note, ms: read.ms };
  const jobs = read.data && Array.isArray(read.data.jobs) ? (read.data.jobs as AshbyJob[]) : null;
  if (!jobs) return { ok: false, status: read.status, jobs: [], note: 'the feed answered without a jobs array', ms: read.ms };
  return { ok: true, status: read.status, jobs, note: null, ms: read.ms };
}

/** The listed jobs as candidates. */
export function ashbyVacancies(jobs: AshbyJob[], board: Pick<AtsBoard, 'slug'>): CandidateVacancy[] {
  const out: CandidateVacancy[] = [];
  for (const j of jobs || []) {
    if (!j || typeof j !== 'object') continue;
    if (j.isListed === false) continue;
    const title = typeof j.title === 'string' ? j.title.replace(/\s+/g, ' ').trim() : '';
    if (!title) continue;
    const locations = [locationTextOf(j.location), ...((j.secondaryLocations || []).map((s) => locationTextOf(s?.location)))].filter((l): l is string => !!l);
    const workplaceType = workplaceTypeOf(j.workplaceType) ?? (j.isRemote === true ? 'remote' : null);
    const url = typeof j.jobUrl === 'string' && j.jobUrl ? j.jobUrl : (typeof j.id === 'string' && j.id ? `${ashbyBoardUrl(board.slug)}/${j.id}` : null);
    out.push({
      title,
      url,
      source: 'ashby',
      datePosted: isoDateOf(j.publishedAt),
      department: (typeof j.department === 'string' && j.department.trim()) || (typeof j.team === 'string' && j.team.trim()) || null,
      location: Array.from(new Set(locations)).join('; ') || null,
      workplaceType,
      employmentType: employmentTypeOf(j.employmentType),
      postcode: typeof j.address?.postalAddress?.postalCode === 'string' ? j.address.postalAddress.postalCode : null,
      raw: { ashbyId: j.id, team: j.team ?? null, applyUrl: j.applyUrl ?? null, country: j.address?.postalAddress?.addressCountry ?? null, board: board.slug },
    });
  }
  return out;
}

export async function ashbySource(board: AtsBoard, _today: Date = new Date()): Promise<SourceResult> {
  const started = Date.now();
  try {
    const read = await readAshbyBoard(board);
    if (!read.ok) return { source: 'ashby', ok: false, vacancies: [], note: read.note ?? 'feed failed', ms: Date.now() - started };
    const vacancies = ashbyVacancies(read.jobs, board);
    const unlisted = read.jobs.length - read.jobs.filter((j) => j.isListed !== false).length;
    return { source: 'ashby', ok: true, vacancies, note: `${read.jobs.length} jobs on the ${board.slug} board${unlisted ? `, ${unlisted} unlisted` : ''}`, ms: Date.now() - started };
  } catch (e) {
    return { source: 'ashby', ok: false, vacancies: [], note: e instanceof Error ? e.message : String(e), ms: Date.now() - started };
  }
}
