// Proof points for the writer, and the consultant's identity.
//
// He-Giveth drew on real client and candidate reviews from the agency's
// website. TA Searcher has none yet: the list below holds the one proof
// point the brief names (the Head of Recruitment placed at Searchable) and
// keeps the shape of the old module (pickReviews(consultant, ctx) -> Review[])
// so the prompt and the generator do not change when the real ones arrive.
//
// CRAIG SUPPLIES THE REAL ONES (docs/TA-SEARCHER-BRIEF.md, question 2): the
// Searchable brief, how long it took, what the founders said, any other
// placements in tech. Until then every entry here is a placeholder and its
// unconfirmed parts are marked "[Craig to confirm]" so nothing here is
// mistaken for a verified claim; the writer is told not to use a marked
// line and the marker is a banned phrase in checks.ts.

export interface Review {
  quote: string;
  author: string;
  type: 'Client' | 'Placement';
  consultant: string;
  date?: string;
  /** Stage hints ('seed', 'series_a', ...) and sector hints ('AI', 'Fintech', ...); empty means any. */
  stages: string[];
  sectors: string[];
}

export const PROOF_POINTS: Review[] = [
  {
    quote: 'Placed the Head of Recruitment at Searchable, a Series A AI company in London, in 2026; the company had thirteen open roles on its Ashby board when the search began. [Craig to confirm: the brief, the time to hire and what the founders said.]',
    author: 'Searchable, Series A, AI, London', type: 'Client', consultant: 'Craig Springett', date: '2026', stages: ['series_a', 'seed'], sectors: ['AI', 'Software'],
  },
];

/** Kept as an alias so the old name still resolves for any caller. */
export const REVIEWS = PROOF_POINTS;

/** The consultants the emails may be signed by, for matching the app's free-text tags. Craig to confirm the team (brief, question 6). */
export const TEAM: Array<{ first: string; full: string; role: string }> = [
  { first: 'Craig', full: 'Craig Springett', role: 'Managing Director' },
];

/** The role written for a consultant the TEAM list does not name. */
export const DEFAULT_CONSULTANT_ROLE = 'Talent Search Consultant';

export interface ConsultantIdentity {
  firstName: string | null;
  fullName: string | null;
  role: string;
}

/**
 * The consultant from the app's tag ("Craig Springett", "Anja Cold Targets",
 * "Isobel NEW Area", "Nikki, Nikki Cold Targets", "House"). The first word of
 * the first tag is the first name unless it is a team label. Names not in
 * TEAM keep their first name with the generic role.
 */
export function consultantFromTag(tag: string | null | undefined): ConsultantIdentity {
  const first = (tag || '').split(',')[0].trim().split(/\s+/)[0] || '';
  if (!first || /^(house|cold|new|targets?|team|unassigned)$/i.test(first)) return { firstName: null, fullName: null, role: DEFAULT_CONSULTANT_ROLE };
  const member = TEAM.find((m) => m.first.toLowerCase() === first.toLowerCase());
  if (member) return { firstName: member.first, fullName: member.full, role: member.role };
  const cleaned = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  return { firstName: cleaned, fullName: null, role: DEFAULT_CONSULTANT_ROLE };
}

export interface ProofContext {
  /** The stage guess label: 'pre_seed', 'seed', 'series_a', 'series_b_plus', 'unknown'. */
  stage?: string | null;
  /** The sector label from the register's SIC codes ('AI', 'Fintech', ...). */
  sector?: string | null;
}

/** Up to three proof points: the consultant's own first, then stage and sector matches, then clients. */
export function pickReviews(consultant: ConsultantIdentity, ctx: ProofContext | null | undefined, max = 3): Review[] {
  const stage = ctx?.stage || null;
  const sector = (ctx?.sector || '').toLowerCase();
  const score = (r: Review) => {
    let s = 0;
    if (consultant.fullName && r.consultant === consultant.fullName) s += 10;
    if (r.type === 'Client') s += 3;
    if (stage && r.stages.includes(stage)) s += 2;
    if (sector && r.sectors.some((x) => x.toLowerCase() === sector)) s += 2;
    if (r.stages.length === 0 && r.sectors.length === 0) s += 1;
    return s;
  };
  return [...PROOF_POINTS].sort((a, b) => score(b) - score(a)).slice(0, max);
}
