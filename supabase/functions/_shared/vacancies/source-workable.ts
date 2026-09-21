// Workable careers-widget feed.
//
// Investigation of 21 September 2026 (from the build session):
//   GET https://apply.workable.com/api/v1/widget/accounts/{sub}
//     is the public feed behind every apply.workable.com/{sub} page:
//     {"name": "<company>", "description": ..., "jobs": [{title, shortcode,
//     code, department, location {city, region, country, countryCode,
//     telecommuting, workplaceType?}, telecommuting (true for remote roles),
//     published_on (YYYY-MM-DD, the posting date), url
//     (apply.workable.com/{sub}/j/{shortcode}), employment_type
//     ("Full-time", "Part-time", "Contract")}], "total"}. Documented by
//     Workable as the "job widget" endpoint; no key.
//   From the build session's proxy every request, with a browser User-Agent
//   or without, answered 429 with Cloudflare's "error code: 1015" (a
//   rate-limit page, the proxy's shared address is throttled), so this
//   parser is written to the documented shape and has NOT been checked
//   against a live answer. It must be tested from Supabase's runtime before
//   a Workable board is confirmed; until then a 429 is reported as a failed
//   read (ok false with the note), never as an empty board.
//   An unknown subdomain answers 404.
import type { AtsBoard, CandidateVacancy, SourceResult } from './types.ts';
import { employmentTypeOf, fetchJsonFeed, isoDateOf, locationTextOf, workplaceTypeOf, type FeedRead } from './feed.ts';

export function workableFeedUrl(sub: string): string {
  return `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(sub)}`;
}

export function workableBoardUrl(sub: string): string {
  return `https://apply.workable.com/${encodeURIComponent(sub)}`;
}

export interface WorkableJob {
  title: string;
  shortcode?: string;
  code?: string | null;
  department?: string | null;
  location?: { city?: string; region?: string; country?: string; countryCode?: string; telecommuting?: boolean; workplaceType?: string } | null;
  telecommuting?: boolean;
  published_on?: string | null;
  url?: string | null;
  employment_type?: string | null;
}

export interface WorkableFeedRead {
  ok: boolean;
  status: number;
  /** The account name the feed carries, for the board confirmation. */
  name: string | null;
  jobs: WorkableJob[];
  note: string | null;
  ms: number;
}

export async function readWorkableBoard(board: Pick<AtsBoard, 'slug'>): Promise<WorkableFeedRead> {
  const read: FeedRead<{ name?: string; jobs?: unknown }> = await fetchJsonFeed(workableFeedUrl(board.slug));
  if (!read.ok) {
    let note = read.note;
    if (read.status === 429) note = `Workable rate-limited the read (HTTP 429${/1015/.test(read.note || '') ? ', Cloudflare 1015' : ''}); the board is not empty, it was not read`;
    else if (read.status === 404) note = `unknown Workable account "${board.slug}" (${read.note})`;
    return { ok: false, status: read.status, name: null, jobs: [], note, ms: read.ms };
  }
  const jobs = read.data && Array.isArray(read.data.jobs) ? (read.data.jobs as WorkableJob[]) : null;
  if (!jobs) return { ok: false, status: read.status, name: null, jobs: [], note: 'the feed answered without a jobs array', ms: read.ms };
  return { ok: true, status: read.status, name: typeof read.data?.name === 'string' ? read.data.name : null, jobs, note: null, ms: read.ms };
}

export function workableVacancies(jobs: WorkableJob[], board: Pick<AtsBoard, 'slug'>, employerName: string | null = null): CandidateVacancy[] {
  const out: CandidateVacancy[] = [];
  for (const j of jobs || []) {
    if (!j || typeof j !== 'object') continue;
    const title = typeof j.title === 'string' ? j.title.replace(/\s+/g, ' ').trim() : '';
    if (!title) continue;
    const remote = j.telecommuting === true || j.location?.telecommuting === true;
    const url = typeof j.url === 'string' && j.url ? j.url : (j.shortcode ? `${workableBoardUrl(board.slug)}/j/${j.shortcode}` : null);
    out.push({
      title,
      url,
      source: 'workable',
      employerName,
      datePosted: isoDateOf(j.published_on ?? null),
      department: typeof j.department === 'string' && j.department.trim() ? j.department.trim() : null,
      location: locationTextOf(j.location),
      workplaceType: workplaceTypeOf(j.location?.workplaceType) ?? (remote ? 'remote' : null),
      employmentType: employmentTypeOf(j.employment_type),
      raw: { workableShortcode: j.shortcode ?? null, code: j.code ?? null, countryCode: j.location?.countryCode ?? null, board: board.slug },
    });
  }
  return out;
}

export async function workableSource(board: AtsBoard, _today: Date = new Date()): Promise<SourceResult> {
  const started = Date.now();
  try {
    const read = await readWorkableBoard(board);
    if (!read.ok) return { source: 'workable', ok: false, vacancies: [], note: read.note ?? 'feed failed', ms: Date.now() - started };
    const vacancies = workableVacancies(read.jobs, board, read.name);
    return { source: 'workable', ok: true, vacancies, note: `${read.jobs.length} jobs on the ${board.slug} board${read.name ? ` (${read.name})` : ''}`, ms: Date.now() - started };
  } catch (e) {
    return { source: 'workable', ok: false, vacancies: [], note: e instanceof Error ? e.message : String(e), ms: Date.now() - started };
  }
}
