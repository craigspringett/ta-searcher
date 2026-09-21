// Greenhouse job board feed.
//
// Investigation of 21 September 2026 (from the build session, Monzo's board):
//   GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=false
//     answers {"jobs":[...],"meta":{"total":N}} with no key; 70 jobs for
//     "monzo" (fixtures/greenhouse-monzo.json). Each job carries id,
//     internal_job_id, requisition_id, title, absolute_url (the public
//     posting on job-boards.greenhouse.io/{token}/jobs/{id}, or the
//     company's own careers site when the board is embedded there),
//     location {name} (free text: "Cardiff, London or Remote (UK)",
//     "Barcelona"), updated_at (an edit date, NOT the posting date),
//     first_published (an ISO datetime with offset, the posting date: set on
//     all 70 Monzo jobs; the brief expected no date here and was wrong),
//     company_name, language, application_deadline (null on every Monzo
//     job), data_compliance, metadata (null unless the board publishes
//     custom fields). departments and offices arrive only with
//     ?content=true or on the per-job endpoint, so the department is read
//     when present and is usually null.
//   An unknown token answers 404 {"status":404,"error":"Not found"}.
//   EU-hosted boards use job-boards.eu.greenhouse.io for the page but the
//   same boards-api host for the feed.
import type { AtsBoard, CandidateVacancy, SourceResult } from './types.ts';
import { fetchJsonFeed, isoDateOf, locationTextOf, type FeedRead } from './feed.ts';

export function greenhouseFeedUrl(token: string): string {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=false`;
}

export function greenhouseBoardUrl(token: string): string {
  return `https://job-boards.greenhouse.io/${encodeURIComponent(token)}`;
}

export interface GreenhouseJob {
  id: number | string;
  internal_job_id?: number | string;
  title: string;
  absolute_url: string | null;
  updated_at?: string | null;
  first_published?: string | null;
  location?: { name?: string } | null;
  departments?: Array<{ name?: string }>;
  offices?: Array<{ name?: string; location?: string }>;
  company_name?: string | null;
  application_deadline?: string | null;
}

export interface GreenhouseFeedRead {
  ok: boolean;
  status: number;
  jobs: GreenhouseJob[];
  /** meta.total when the feed gives it. */
  total: number | null;
  note: string | null;
  ms: number;
}

export async function readGreenhouseBoard(board: Pick<AtsBoard, 'slug'>): Promise<GreenhouseFeedRead> {
  const read: FeedRead<{ jobs?: unknown; meta?: { total?: number } }> = await fetchJsonFeed(greenhouseFeedUrl(board.slug));
  if (!read.ok) return { ok: false, status: read.status, jobs: [], total: null, note: read.status === 404 ? `unknown Greenhouse board "${board.slug}" (${read.note})` : read.note, ms: read.ms };
  const jobs = read.data && Array.isArray(read.data.jobs) ? (read.data.jobs as GreenhouseJob[]) : null;
  if (!jobs) return { ok: false, status: read.status, jobs: [], total: null, note: 'the feed answered without a jobs array', ms: read.ms };
  const total = typeof read.data?.meta?.total === 'number' ? read.data.meta.total : null;
  return { ok: true, status: read.status, jobs, total, note: null, ms: read.ms };
}

/** "Remote (UK)" is remote; "London or Remote" is a choice the feed does not settle; "Hybrid - London" is hybrid. */
export function greenhouseWorkplaceType(locationName: string | null): string | null {
  if (!locationName) return null;
  const l = locationName.toLowerCase();
  if (/\bhybrid\b/.test(l)) return 'hybrid';
  if (/\bremote\b/.test(l) && !/,|\bor\b|\/|\band\b/.test(l.replace(/\(.*?\)/g, ''))) return 'remote';
  return null;
}

export function greenhouseVacancies(jobs: GreenhouseJob[], board: Pick<AtsBoard, 'slug'>): CandidateVacancy[] {
  const out: CandidateVacancy[] = [];
  for (const j of jobs || []) {
    if (!j || typeof j !== 'object') continue;
    const title = typeof j.title === 'string' ? j.title.replace(/\s+/g, ' ').trim() : '';
    if (!title) continue;
    const location = locationTextOf(j.location);
    const url = typeof j.absolute_url === 'string' && j.absolute_url ? j.absolute_url : (j.id != null ? `${greenhouseBoardUrl(board.slug)}/jobs/${j.id}` : null);
    const department = Array.isArray(j.departments) ? (j.departments.map((d) => (typeof d?.name === 'string' ? d.name.trim() : '')).find((n) => n) ?? null) : null;
    out.push({
      title,
      url,
      source: 'greenhouse',
      employerName: typeof j.company_name === 'string' ? j.company_name : null,
      // first_published is the posting date; updated_at is an edit and is never used.
      datePosted: isoDateOf(j.first_published),
      closingDate: isoDateOf(j.application_deadline),
      department,
      location,
      workplaceType: greenhouseWorkplaceType(location),
      employmentType: null,
      raw: { greenhouseId: j.id, internalJobId: j.internal_job_id ?? null, updatedAt: j.updated_at ?? null, board: board.slug },
    });
  }
  return out;
}

export async function greenhouseSource(board: AtsBoard, _today: Date = new Date()): Promise<SourceResult> {
  const started = Date.now();
  try {
    const read = await readGreenhouseBoard(board);
    if (!read.ok) return { source: 'greenhouse', ok: false, vacancies: [], note: read.note ?? 'feed failed', ms: Date.now() - started };
    const vacancies = greenhouseVacancies(read.jobs, board);
    return { source: 'greenhouse', ok: true, vacancies, note: `${read.jobs.length} jobs on the ${board.slug} board${read.total !== null && read.total !== read.jobs.length ? ` (feed says ${read.total})` : ''}`, ms: Date.now() - started };
  } catch (e) {
    return { source: 'greenhouse', ok: false, vacancies: [], note: e instanceof Error ? e.message : String(e), ms: Date.now() - started };
  }
}
