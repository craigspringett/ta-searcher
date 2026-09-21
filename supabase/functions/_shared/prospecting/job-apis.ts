// What the two job search APIs are asked for and how their hits are sifted,
// shared by source-adzuna.ts and source-reed.ts.
//
// Investigation of 21 September 2026 (docs/PROSPECTING-BRIEF.md, "Job
// search APIs with free keys"): both APIs match loosely on a phrase, so a
// search for "head of talent" also returns "Talent Acquisition Specialist"
// and the odd "Head of Sales", and the title is tested again here with the
// role rules the rest of the app uses (isTalentRole, isTalentLeadRole). An
// agency advertising the role is a competitor's client, not the employer,
// so a hit whose employer name reads as an agency is kept as a note on the
// run and makes no prospect. Adzuna's redirect_url goes through
// adzuna.co.uk/land/ad/... and lands on the employer's page or its ATS;
// where it lands says the website (or the board) at qualification time.

import { isTalentLeadRole, isTalentRole } from '../vacancies/role-family.ts';

/** The phrases the brief names, searched one call each; "head of people" is scored lower and the recruiter ones need founding or first. */
export const TALENT_PHRASES: string[] = [
  'head of talent',
  'head of talent acquisition',
  'head of recruitment',
  'talent acquisition lead',
  'talent lead',
  'head of people',
  'talent acquisition partner',
  'founding recruiter',
  'first recruiter',
];

/** Employer names that are a recruitment business, not the hiring company. */
const AGENCY_RE = /\b(?:recruit\w*|search|talent partners?|consulting|consultancy|resourcing|staffing|headhunt\w*|executive search)\b|big fish/i;

export function isAgencyEmployer(name: string | null | undefined): boolean {
  return !!name && AGENCY_RE.test(name);
}

/** Head of People, VP People, Chief People Officer: scored lower than a talent role. */
export function isHeadOfPeopleRole(title: string): boolean {
  return /\b(?:head of|vp,?(?: of)?|vice president,?(?: of)?|director of|chief)\s+people\b|\bchief people officer\b|\bcpo\b/i.test(title || '');
}

/** "Founding Recruiter", "First Recruiter", "Recruiter (first hire)": the first hire, not a seat on a team. */
function isFirstRecruiter(title: string): boolean {
  return /\brecruit/i.test(title) && /\b(?:founding|first)\b/i.test(title);
}

/**
 * Whether a posting's title is one the prospect pass keeps: the role Craig
 * places, another talent role, a head of people, or a first recruiter. A
 * plain "Recruiter" is a seat on an existing team and is not kept.
 */
export function isProspectPostingTitle(title: string): boolean {
  const t = (title || '').trim();
  if (!t) return false;
  if (isTalentLeadRole(t)) return true;
  if (isHeadOfPeopleRole(t)) return true;
  if (isFirstRecruiter(t)) return true;
  if (!isTalentRole(t)) return false;
  // A talent role that is not a lead: a partner, a manager, a specialist. A bare recruiter is not.
  return !/^(?:senior |junior |graduate |trainee |internal |in-house |contract |temporary |temp |permanent |perm )*(?:tech(?:nical)? |it |sales |engineering )?recruit(?:er|ment consultant|ment executive|ment resourcer)s?$/i.test(t);
}

/** Job boards and aggregators: a landing there is not the employer's website. */
const JOB_BOARD_HOST_RE = /(?:^|\.)(?:adzuna\.[a-z.]+|reed\.co\.uk|indeed\.[a-z.]+|linkedin\.com|glassdoor\.[a-z.]+|totaljobs\.com|cv-library\.co\.uk|cwjobs\.co\.uk|jobsite\.co\.uk|monster\.[a-z.]+|ziprecruiter\.[a-z.]+|jobserve\.com|technojobs\.co\.uk|efinancialcareers\.[a-z.]+|welcometothejungle\.com|otta\.com|workinstartups\.com|jobs\.ac\.uk|guardianjobs\.[a-z.]+|jooble\.[a-z.]+|talent\.com|jobrapido\.com|neuvoo\.[a-z.]+|careerjet\.[a-z.]+|simplyhired\.[a-z.]+|jobtoday\.com|escapethecity\.org|workable\.com|greenhouse\.io|lever\.co|ashbyhq\.com|bamboohr\.com|teamtailor\.com|smartrecruiters\.com|pinpointhq\.com|applytojob\.com|jobvite\.com|recruitee\.com|breezy\.hr|personio\.[a-z.]+|hibob\.com|myworkdayjobs\.com|icims\.com|successfactors\.[a-z.]+|taleo\.net|oraclecloud\.com|bullhornreach\.com|jobadder\.com|vincere\.io|dover\.com|homerun\.co|join\.com|wellfound\.com|angel\.co|ycombinator\.com|google\.com|facebook\.com|twitter\.com|x\.com)$/i;

export function isJobBoardHost(host: string | null | undefined): boolean {
  return !!host && JOB_BOARD_HOST_RE.test(host.toLowerCase().replace(/^www\./, ''));
}

/** The employer's website from where a posting's link landed: its origin, unless that is a job board or an ATS. */
export function websiteFromLanding(finalUrl: string | null | undefined): string | null {
  if (!finalUrl) return null;
  try {
    const u = new URL(finalUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (isJobBoardHost(u.hostname)) return null;
    return `${u.protocol}//${u.hostname.toLowerCase()}/`;
  } catch {
    return null;
  }
}
