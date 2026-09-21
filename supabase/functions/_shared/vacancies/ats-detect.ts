// Which applicant tracking system a company uses, from the links, iframes
// and embed scripts on its homepage and careers page.
//
// Investigation of 21 September 2026 (from the build session):
//   Ashby      links to jobs.ashbyhq.com/{slug} (and /{slug}/{jobId}); the
//              feed is api.ashbyhq.com/posting-api/job-board/{slug}; some
//              sites embed jobs.ashbyhq.com/{slug}/embed in an iframe.
//   Greenhouse links to boards.greenhouse.io/{token} or
//              job-boards.greenhouse.io/{token} (EU: job-boards.eu.greenhouse.io);
//              the feed is boards-api.greenhouse.io/v1/boards/{token}; the
//              embed is <script src="https://boards.greenhouse.io/embed/job_board/js?for={token}">
//              with an iframe at boards.greenhouse.io/embed/job_board?for={token}.
//   Lever      links to jobs.lever.co/{slug} (EU: jobs.eu.lever.co); the
//              feed is api.lever.co/v0/postings/{slug}.
//   Workable   links to apply.workable.com/{sub} (job short links are
//              apply.workable.com/j/{code} and carry no account), or
//              {sub}.workable.com; jobs.workable.com/company/{id}/{name} is
//              Workable's own aggregate board and names the company, not
//              the account, so it is recorded with that name as a guess.
// A detected board is a candidate only: confirmBoard reads the feed once and
// the integrator stores the confirmed slug in ats_boards. A feed is read on
// a refresh only for a confirmed slug (the Teaching Vacancies rule).
import type { AtsBoard, AtsProvider } from './types.ts';
import { ashbyBoardUrl, readAshbyBoard } from './source-ashby.ts';
import { greenhouseBoardUrl, readGreenhouseBoard } from './source-greenhouse.ts';
import { leverBoardUrl, readLeverBoard } from './source-lever.ts';
import { readWorkableBoard, workableBoardUrl } from './source-workable.ts';
import { employerMatches } from './employer-match.ts';

/** Path segments and subdomains that are the provider's own pages, never a board. */
const NOT_A_SLUG = new Set(['', 'embed', 'api', 'j', 'jobs', 'www', 'apply', 'help', 'resources', 'careers-page', 'login', 'signup', 'sign-up', 'auth', 'static', 'assets', 'v0', 'v1', 'posting-api', 'job-board', 'js', 'css', 'img', 'images', 'application', 'privacy', 'terms', 'about', 'blog', 'company', 'view', 'search']);

const SLUG = '([A-Za-z0-9][A-Za-z0-9._-]{0,80})';

const PATTERNS: Array<{ provider: AtsProvider; re: RegExp; group?: number }> = [
  { provider: 'ashby', re: new RegExp(`(?:https?:)?//(?:jobs|api)\\.ashbyhq\\.com/(?:posting-api/job-board/)?${SLUG}`, 'gi') },
  { provider: 'greenhouse', re: new RegExp(`(?:https?:)?//(?:boards|job-boards|boards-api|job-boards\\.eu|boards\\.eu)\\.greenhouse\\.io/(?:v1/boards/)?${SLUG}`, 'gi') },
  { provider: 'greenhouse', re: new RegExp(`greenhouse\\.io/embed/job_board(?:/js)?\\?(?:[^"'\\s>]*&)?for=${SLUG}`, 'gi') },
  { provider: 'lever', re: new RegExp(`(?:https?:)?//(?:jobs|api|jobs\\.eu|api\\.eu)\\.lever\\.co/(?:v0/postings/)?${SLUG}`, 'gi') },
  { provider: 'workable', re: new RegExp(`(?:https?:)?//apply\\.workable\\.com/${SLUG}`, 'gi') },
  { provider: 'workable', re: new RegExp(`(?:https?:)?//${SLUG}\\.workable\\.com`, 'gi') },
  { provider: 'workable', re: new RegExp(`(?:https?:)?//jobs\\.workable\\.com/company/[^/"'\\s]+/${SLUG}`, 'gi') },
];

export function boardUrlFor(provider: AtsProvider, slug: string): string {
  switch (provider) {
    case 'ashby': return ashbyBoardUrl(slug);
    case 'greenhouse': return greenhouseBoardUrl(slug);
    case 'lever': return leverBoardUrl(slug);
    case 'workable': return workableBoardUrl(slug);
  }
}

function cleanSlug(raw: string): string {
  return raw.replace(/[.,;:)]+$/, '').toLowerCase();
}

/**
 * The boards a page links to or embeds, one per provider and slug. `baseUrl`
 * resolves protocol-relative links; a company's own domain never names a
 * board, so relative links are not looked at.
 */
export function detectAtsBoards(html: string, _baseUrl: string): AtsBoard[] {
  const out: AtsBoard[] = [];
  const seen = new Set<string>();
  const text = (html || '').replace(/&amp;/g, '&').replace(/\\\//g, '/');
  for (const p of PATTERNS) {
    const re = new RegExp(p.re.source, p.re.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const slug = cleanSlug(m[p.group ?? 1] || '');
      if (!slug || NOT_A_SLUG.has(slug)) continue;
      // A Greenhouse job link's numeric id, an Ashby posting id after the slug: the slug is the first segment, which these patterns already take.
      if (/^\d+$/.test(slug)) continue;
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(slug)) continue;
      const key = `${p.provider}:${slug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ provider: p.provider, slug, boardUrl: boardUrlFor(p.provider, slug) });
    }
  }
  return out;
}

export interface BoardConfirmation {
  ok: boolean;
  count: number;
  note: string | null;
}

/**
 * Read the feed once. ok when it answers 200 with a jobs array; where the
 * feed names the company (Workable), a name that does not match is noted
 * but the board still confirms: the link was on the company's own site.
 */
export async function confirmBoard(board: AtsBoard, companyName: string): Promise<BoardConfirmation> {
  try {
    switch (board.provider) {
      case 'ashby': {
        const r = await readAshbyBoard(board);
        return r.ok ? { ok: true, count: r.jobs.filter((j) => j.isListed !== false).length, note: `Ashby board ${board.slug} answers` } : { ok: false, count: 0, note: r.note };
      }
      case 'greenhouse': {
        const r = await readGreenhouseBoard(board);
        if (!r.ok) return { ok: false, count: 0, note: r.note };
        const names = Array.from(new Set(r.jobs.map((j) => (typeof j.company_name === 'string' ? j.company_name.trim() : '')).filter(Boolean)));
        const named = names.length === 1 ? names[0] : null;
        const mismatch = named && companyName && !employerMatches(named, { name: companyName }).matched ? `; the feed names "${named}", not "${companyName}"` : '';
        return { ok: true, count: r.jobs.length, note: `Greenhouse board ${board.slug} answers${mismatch}` };
      }
      case 'lever': {
        const r = await readLeverBoard(board);
        return r.ok ? { ok: true, count: r.postings.length, note: `Lever site ${board.slug} answers` } : { ok: false, count: 0, note: r.note };
      }
      case 'workable': {
        const r = await readWorkableBoard(board);
        if (!r.ok) return { ok: false, count: 0, note: r.note };
        const mismatch = r.name && companyName && !employerMatches(r.name, { name: companyName }).matched ? `; the feed names "${r.name}", not "${companyName}"` : '';
        return { ok: true, count: r.jobs.length, note: `Workable account ${board.slug} answers${r.name ? ` as "${r.name}"` : ''}${mismatch}` };
      }
      default:
        return { ok: false, count: 0, note: `unknown provider ${(board as AtsBoard).provider}` };
    }
  } catch (e) {
    return { ok: false, count: 0, note: e instanceof Error ? e.message : String(e) };
  }
}
