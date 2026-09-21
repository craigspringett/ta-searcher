// The signal taxonomy (docs/PHASE-3-BRIEF.md, deliverable 2). Every signal is
// computed from data we hold: validated facts, the vacancy rows, CFR spend
// with its peer comparison, the DfE head record and a fixed calendar. The
// model is never asked to invent one.

import type { Fact } from '../facts/types.ts';
import { monthsSinceHint } from '../facts/validate.ts';
import { daysBetween, isoDate, recentResignationDeadline, upcomingResignationDeadline, upcomingTermStart } from './calendar.ts';
import type { Trend } from '../spend/fbit.ts';
import { roleFamily as familyOf } from '../vacancies/role-family.ts';

export type SignalCode =
  | 'open_teaching_vacancies' | 'open_support_vacancies' | 'long_open_role' | 'readvertised_role' | 'closing_this_week'
  | 'fixed_term_or_maternity' | 'rr_allowance' | 'agency_spend_high' | 'agency_spend_rising' | 'new_headteacher'
  | 'ofsted_ri_or_inadequate' | 'send_provision_change' | 'expansion' | 'trust_join' | 'staffing_pressure_stated'
  | 'framework_window' | 'resignation_deadline_near' | 'resignation_deadline_passed' | 'term_start_near'
  | 'agency_advertising' | 'staff_departure' | 'ofsted_change' | 'self_sufficient_stated'
  | 'tender_open' | 'tender_awarded' | 'pupil_growth' | 'new_company' | 'trust_change'
  | 'consultant_intel'
  | 'pp_support_staff' | 'pp_programme' | 'pp_above_peers';

export interface SignalEvidence {
  type: 'fact' | 'vacancy' | 'agency_advert' | 'data' | 'calendar' | 'ofsted' | 'tender' | 'register';
  /** Fact id (f1...) or vacancy id. */
  id?: string;
  text: string;
  quote?: string;
  source_url?: string;
}

export interface Signal {
  code: SignalCode;
  label: string;
  strength: 1 | 2 | 3;
  evidence: SignalEvidence[];
  explanation: string;
}

export interface VacancyForSignals {
  id: string;
  title: string;
  /** ISO date first seen open. */
  firstSeen: string;
  closingDate: string | null;
  source: string;
  url?: string | null;
  /** Contract terms from the advert when the board gives them (TES contractTerms, TV employmentType). */
  contractTerms?: string[] | null;
  /** Any advert text we hold (salary line, description) for the allowance and contract checks. */
  advertText?: string | null;
}

export interface ClosedVacancyForSignals {
  title: string;
  firstSeen: string;
  lastSeen: string;
}

export interface SpendYear {
  fiscalYear: string;
  /** Supply teaching staff plus agency supply teaching staff, in pounds. */
  agencyAndSupply: number | null;
}

export interface SpendForSignals {
  latest: SpendYear | null;
  previous: SpendYear | null;
  /** Peer companies: same phase, same local authority, latest year. */
  peers: { count: number; median: number; upperQuartile: number; phase: string | null; laName: string | null } | null;
  /** The three-year trend with spend per pupil (Phase 6), when the history is loaded. */
  trend?: Trend | null;
}

export interface HeadForSignals {
  current: string | null;
  previous: string | null;
  /** ISO date the change was first noticed. */
  changedAt: string | null;
}

export interface SignalInput {
  today: Date;
  facts: Fact[];
  openVacancies: VacancyForSignals[];
  closedVacancies: ClosedVacancyForSignals[];
  spend: SpendForSignals | null;
  head: HeadForSignals | null;
  trustName: string | null;
  /** Live adverts an agency is running for this company (agency_adverts, active). */
  agencyAdverts?: AgencyAdvertForSignals[];
  /** The Ofsted management-information row for the company (ofsted_outcomes), when synced. */
  ofsted?: OfstedForSignals | null;
  /** Procurement notices matched to the company, its trust or its authority (tender_notices, Phase 6). */
  tenders?: TenderForSignals[];
  /** The DfE register row and its history for the company (gias_establishments, company_census, gias_trust_changes; Phase 6 slice 4). */
  register?: RegisterForSignals | null;
  /** The figures from the company's pupil premium strategy statement (company_documents, 15 September 2026); the facts carry the quotes. */
  pupilPremium?: PupilPremiumForSignals | null;
}

export interface PupilPremiumForSignals {
  documentUrl: string;
  academicYear: string | null;
  /** Pupil premium funding allocation this academic year, in pounds. */
  allocation: number | null;
  /** "Number of pupils in company" from the statement, else the register's roll. */
  pupilsOnRoll: number | null;
  /** Same-authority companies with an allocation and a roll: the median allocation per pupil (at least four peers to count). */
  peers: { count: number; median: number; laName: string | null } | null;
}

export interface RegisterForSignals {
  status: string | null;
  openDate: string | null;
  reasonOpened: string | null;
  /** Pupils on roll and capacity from the register's latest census. */
  pupils: number | null;
  capacity: number | null;
  censusDate: string | null;
  /** Pupils by accounts year from FBIT (company_census), oldest first. */
  pupilHistory: Array<{ fiscalYear: string; pupils: number }>;
  trustName: string | null;
  /** The most recent trust change noticed by the register sync, within a year. */
  trustChange: { noticedAt: string; previousTrust: string | null; newTrust: string | null } | null;
}

export interface TenderForSignals {
  id: string;
  source: 'contracts_finder' | 'find_a_tender';
  title: string;
  buyerName: string | null;
  stage: 'planning' | 'tender' | 'award' | 'contract' | 'other';
  publishedAt: string | null;
  deadline: string | null;
  valueAmount: number | null;
  url: string;
  awardedSupplier: string | null;
  contractEnd: string | null;
  /** 'company' when the buyer is the company itself, 'trust' its trust, 'la' its authority. */
  matchedTo: 'company' | 'trust' | 'la';
  scope: string | null;
}

export interface OfstedForSignals {
  /** One line on the current state, from describeOfsted. */
  description: string;
  reportUrl: string | null;
  inspectionType: string | null;
  inspectionDate: string | null;
  publicationDate: string | null;
  /** Areas graded below the expected standard, as "leadership and governance \"attention needed\"". */
  concernAreas: string[];
  categoryOfConcern: string | null;
  /** The old single grade, when that is the latest graded inspection. */
  oeifOverall: string | null;
  oeifPublicationDate: string | null;
  ungradedDate: string | null;
  ungradedOutcome: string | null;
  ungradedConcern: boolean;
  /** When the sync noticed the latest change, if it did. */
  changedAt: string | null;
  changeSummary: string | null;
}

export interface AgencyAdvertForSignals {
  id: string;
  board: string;
  /** Board name for people ("Zen Educate"). */
  boardLabel: string;
  agency: string | null;
  title: string;
  url: string;
  firstSeen: string;
  lastSeen: string;
}

export const SIGNAL_LABELS: Record<SignalCode, string> = {
  open_teaching_vacancies: 'Open teaching vacancies',
  open_support_vacancies: 'Open support vacancies',
  long_open_role: 'Role open more than five weeks',
  readvertised_role: 'Re-advertised role',
  closing_this_week: 'Closing this week',
  fixed_term_or_maternity: 'Fixed-term or maternity cover',
  rr_allowance: 'Recruitment and retention allowance',
  agency_spend_high: 'Agency spend above local peers',
  agency_spend_rising: 'Agency spend rising',
  new_headteacher: 'New headteacher',
  ofsted_ri_or_inadequate: 'Ofsted requires improvement or inadequate',
  send_provision_change: 'SEND provision changing',
  expansion: 'Expansion or new build',
  trust_join: 'Joined or joining a trust',
  staffing_pressure_stated: 'Staffing pressure stated',
  framework_window: 'Framework window (RM6376)',
  resignation_deadline_near: 'Resignation deadline near',
  resignation_deadline_passed: 'Resignation deadline just passed',
  term_start_near: 'Term starts soon',
  agency_advertising: 'Agency advertising for this company',
  staff_departure: 'Staff leaving',
  ofsted_change: 'New Ofsted report',
  self_sufficient_stated: 'Says it uses no supply or agency staff',
  tender_open: 'Tender open for supply staffing',
  tender_awarded: 'Supply staffing contract awarded',
  pupil_growth: 'Growing roll',
  new_company: 'New company',
  trust_change: 'Trust changed',
  consultant_intel: 'From the team',
  pp_support_staff: 'Pupil premium funds support staff',
  pp_programme: 'Literacy or EAL programme in place',
  pp_above_peers: 'Pupil premium above local peers',
};

export const FRAMEWORK_DEADLINE = '2026-11-01';
/** An award or contract notice this old is still worth knowing about. */
export const TENDER_AWARD_DAYS = 365;
/** A planning or tender notice with no deadline counts as open for this long. */
export const TENDER_OPEN_DAYS = 90;
/** A roll up by this share on the year, or a company more than 5% over capacity (London companies sit a little over their places as a matter of course), is growing. */
export const PUPIL_GROWTH_SHARE = 0.05;
export const OVER_CAPACITY_SHARE = 1.05;
export const NEW_COMPANY_MONTHS = 18;
export const TRUST_CHANGE_DAYS = 365;
/** A report published within this many days is news. */
export const OFSTED_RECENT_DAYS = 120;
export const LONG_OPEN_DAYS = 35;
export const READVERTISED_WINDOW_DAYS = 180;
/** A listing that vanished for a day or two and came back is a board hiccup, not a re-advert. */
export const READVERTISED_MIN_GAP_DAYS = 7;

// The role family (teaching, support, office, other) is the shared rule in
// vacancies/role-family.ts; re-exported so older imports keep working.
export { roleFamily, type RoleFamily } from '../vacancies/role-family.ts';

export function normaliseTitle(title: string): string {
  return title.toLowerCase()
    .replace(/\s*\((?:posted on )?[^)]*\)\s*$/i, '')
    .replace(/\b(maternity cover|fixed[- ]term|temporary|part[- ]time|full[- ]time|permanent|required for [a-z]+ \d{4}|from [a-z]+ \d{4}|\d+ ?fte)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FIXED_TERM_RE = /\b(maternity|fixed[- ]term|cover for|to cover|temporary|interim|secondment|until [a-z]+ \d{4}|one[- ]year|1[- ]year|two[- ]year|2[- ]year)\b/i;
const RR_RE = /\b(recruitment (?:and|&) retention|r ?& ?r allowance|r&r payment|golden hello|welcome bonus|relocation (?:package|allowance|support|assistance)|retention (?:allowance|payment|bonus)|signing[- ]on bonus)\b/i;
const OFSTED_BAD_RE = /\b(requires improvement|inadequate|special measures|serious weaknesses)\b/i;
const OFSTED_GOOD_RE = /\b(outstanding|good)\b/i;
const SEND_CHANGE_RE = /\b(new|opened|opening|open|launch\w*|expand\w*|growing|growth|increase\w*|rising|more|additional|extra)\b[^.]*\b(unit|resource base|resourced provision|provision|ehcps?|ehc plans?|send|sen\b|arp|specialist)\b|\b(unit|resource base|resourced provision|ehcps?|ehc plans?)\b[^.]*\b(new|opened|opening|expand\w*|growing|growth|increase\w*|rising|more|additional)\b/i;
const HEAD_ROLE_RE = /\b(head\s?teacher|head of company|headmaster|headmistress|principal|executive head(?:teacher)?|new head|acting head|interim head|co-head(?:teacher)?s?)\b/i;
const ACTING_HEAD_RE = /\b(acting|interim)\s+(head\w*|principal)\b/i;
const NOT_HEAD_RE = /\b(deputy|assistant|associate|vice|acting deputy|head of (?!company\b)[a-z]+|pa to|secretary)\b/i;
const DEPARTURE_RE = /\b(leav\w*|left|retir\w*|depart\w*|moving on|moves? to|moved to|last day|farewell|goodbye|say goodbye|maternity leave|paternity leave|adoption leave|sabbatical|secondment|stepping down|steps down|stepped down|new (?:role|post|position|company|challenge)|promotion|promoted)\b/i;
/**
 * Staffing pressure needs pressure wording. Strong (strength 3): recruitment
 * difficulty, posts hard to fill, or reliance on agency or long-term supply.
 * Moderate (strength 2): a supply or cover mention, staff on leave being
 * covered, interim or acting posts, a restructure. "A hardworking, dedicated
 * staff team", "17% PPA time", salaries above the sector or teacher-training
 * routes are not pressure and never fire.
 */
const PRESSURE_STRONG_RE = /\b(recruitment (?:is )?(?:difficult|a challenge|challenging|hard|tough|pressure|crisis|shortage|difficulties)|(?:difficult|difficulty|difficulties|hard|struggl\w*|challenge|challenging|unable|failed|failing) (?:in |to |with )?(?:recruit\w*|fill\w*|appoint\w*|staff\w*)|hard[- ]to[- ]fill|unfilled (?:post|posts|vacanc\w*|role|roles)|(?:teacher|staff|staffing|recruitment) (?:shortage|shortages|crisis|pressures?)|shortage of (?:teachers|staff)|(?:rely|relies|relying|reliant|reliance|depend\w*) on (?:supply|agency)|agency (?:staff|supply|teachers?|workers?|cover|tas?|teaching assistants?)|long[- ]term supply|supply (?:teachers?|staff) (?:cover|covering|are covering|is covering|teach\w*)|re-?advertis\w*|high (?:staff )?turnover|turnover (?:is|remains) high)\b/i;
const PRESSURE_RE = /\b(supply (?:teachers?|staff|cover|work|agency|agencies)|cover (?:for|is being|being) |being covered|covered by|covering (?:for|the|a|her|his|their) |maternity leave|paternity leave|adoption leave|long[- ]term (?:sick|sickness|absence)|interim|acting (?:head\w*|principal|deputy|assistant|senco|sendco)|secondment|restructur\w*|redundanc\w*|vacanc(?:y|ies)|(?:we are|currently|now) recruiting|(?:looking|seeking|wish\w*) to (?:appoint|recruit)|staff shortage)\b/i;
/** The opposite of pressure: the company says it needs no supply or agency staff, or that its turnover is low. */
const SELF_SUFFICIENT_RE = /\b(no (?:use of |need for |reliance on )?(?:supply|agency)(?: staff| teachers?| workers?| cover)?\b|(?:never|not|don['’]t|do not|doesn['’]t|does not|without) (?:use|using|rely on|relying on|employ\w*|need\w*|the use of) (?:any )?(?:supply|agency)|(?:very |extremely |exceptionally )?low (?:staff |teacher )?turnover|turnover is (?:very |extremely )?low|fully staffed|no (?:current )?vacancies|no staff (?:shortages?|vacancies))\b/i;
/** Growth wording for the expansion signal; anything else filed as expansion or new_build (a pitch, a pool, a refectory) is not a signal. */
const EXPANSION_RE = /\b(expand\w*|expansion|grow(?:ing|th|n)|rising rolls?|rolls? (?:is|are) rising|(?:pupil|student) numbers? (?:has|have|is|are|will) (?:grown|grow|expanded|expand|risen|rise|increased|increase)|population has (?:grown|expanded|increased)|increas\w* (?:in )?(?:the )?(?:pupil|student|roll|number of (?:pupils|students|places|classes)|places|capacity|admission|pan\b)|(?:additional|extra|more) (?:forms?|classes|class|places|pupils|students)|bulge class|forms? of entry|published admission number|admission number|new (?:class|classes|classrooms?|provision|unit|resource base|site|campus|building|buildings|company building|block|wing|sixth[- ]form(?: block| centre| building)?|nursery|satellite)|brand[- ]new building|rebuild\w*|rebuilt|new[- ]build\b|building (?:project|development|programme|program|works)|(?:open|opening|opens|opened|launch|launching|launched) (?:a |its |our |the )?(?:new )?(?:sixth[- ]form|nursery|provision|unit|satellite|site|resource base)|mov(?:e|es|ed|ing) (?:in)?to (?:a |the |its |our )?(?:new |)(?:site|building|premises|campus)|co-?education\w*|all-through)\b/i;
/** Concrete growth (strength 2): more pupils, more classes, a new building or site, a new provision. Vague growth ("an expanding company") is strength 1. */
const EXPANSION_CONCRETE_RE = /\b(rising rolls?|rolls? (?:is|are) rising|(?:pupil|student) numbers?|population has|increas\w* (?:in )?(?:the )?(?:pupil|student|roll|number of|places|capacity|admission|pan\b)|(?:additional|extra|more) (?:forms?|classes|class|places|pupils|students)|bulge class|forms? of entry|published admission number|admission number|new (?:class|classes|classrooms?|provision|unit|resource base|site|campus|building|buildings|company building|block|wing|sixth[- ]form(?: block| centre| building)?|nursery|satellite)|brand[- ]new building|rebuild\w*|rebuilt|new[- ]build\b|building (?:project|development|programme|program|works)|(?:open|opening|opens|opened|launch|launching|launched) (?:a |its |our |the )?(?:new )?(?:sixth[- ]form|nursery|provision|unit|satellite|site|resource base)|mov(?:e|es|ed|ing) (?:in)?to (?:a |the |its |our )?(?:new |)(?:site|building|premises|campus)|co-?education\w*|all-through|continued? expansion|continue expanding|expanded considerably|three separate sites|across \w+ sites)\b/i;
/** An undated growth fact counts only when it reads as current or planned; "opened in 2017" without a date hint does not. */
const EXPANSION_ONGOING_RE = /\b(expanding|growing|rising|increasing|opening|launching|moving|constructing|under construction|under ?way|plans?|planned|planning|future|proposed|consultation|will|currently|now|is being|are being|continue\w*|programme|program|project|confirm\w*|due to open|opens in|from september|next year|this year|bid\w*)\b/i;
/** A completed thing with no date is history, not a signal. */
const EXPANSION_DONE_RE = /\b(completed|has been (?:\w+ly )?(?:rebuilt|completed|built|extended)|was (?:built|opened|rebuilt|completed)|were (?:built|opened|completed))\b/i;
/** How far back a dated growth or building fact still counts. */
export const EXPANSION_WINDOW_MONTHS = 18;
const TRUST_JOIN_RE = /\b(joined|joining|join|converted|converting|conversion|became part of|become part of|becoming part of|transferred to|academisation|academy order|will join)\b/i;

function strengthByCount(n: number): 1 | 2 | 3 {
  return n >= 3 ? 3 : n === 2 ? 2 : 1;
}

function factEvidence(f: Fact): SignalEvidence {
  return { type: 'fact', id: f.id, text: f.statement, quote: f.quote, source_url: f.source_url };
}

function vacancyEvidence(v: VacancyForSignals, extra?: string): SignalEvidence {
  return { type: 'vacancy', id: v.id, text: `${v.title} (${v.source}, first seen ${v.firstSeen}${v.closingDate ? `, closes ${v.closingDate}` : ''}${extra ? `; ${extra}` : ''})`, source_url: v.url || undefined };
}

function factWithin(f: Fact, today: Date, months: number): boolean {
  const since = monthsSinceHint(f.date_hint, today);
  // A fact with no usable date is taken as current: the site says it today.
  return since === null || (since >= 0 && since <= months) || (since < 0 && since >= -12);
}

/** Like factWithin, but a fact without a usable date does not count. */
function factWithinDated(f: Fact, today: Date, months: number): boolean {
  const since = monthsSinceHint(f.date_hint, today);
  return since !== null && ((since >= 0 && since <= months) || (since < 0 && since >= -12));
}

function pounds(n: number): string {
  return '£' + Math.round(n).toLocaleString('en-GB');
}

/**
 * The fact kinds a signal may be built from. A "values" or "other" fact is
 * never evidence, whatever it says, so it can never be the reason for a call.
 */
export const SIGNAL_FACT_KINDS: ReadonlySet<string> = new Set(['leadership_change', 'ofsted', 'send_provision', 'expansion', 'new_build', 'trust', 'staffing_pressure', 'supply_mention', 'staff_departure', 'consultant_intel', 'pupil_premium']);

/** Pupil premium staffing lines that are support staff (a teacher funded by the premium is listed but does not fire the signal). */
const PP_SUPPORT_KEY = /^pp_staffing_(teaching_assistant|hlta|learning_mentor|tutor|intervention_staff|speech_and_language|elsa|family_support|attendance_officer|counsellor|other)\b/;
/** The lines a consultant can place against: TAs, HLTAs, tutors and intervention staff. */
const PP_RECRUITABLE_KEY = /^pp_staffing_(teaching_assistant|hlta|tutor|intervention_staff|learning_mentor)\b/;
/** Wording that says the staffing is new, additional or to be recruited (facts.ts appends the first phrase when the statement says so). */
const PP_RECRUIT_RE = /new or additional staffing|\b(recruit\w*|appoint\w*|additional|extra|expand\w*|increas\w*|employ\w* (?:a |an |two |three |more )|a new|new (?:teaching assistant|hlta|tutor|learning mentor|intervention|member of staff|post|role)s?)\b/i;
const PP_LITERACY_KEY = /^pp_programme_(literacy|eal|oracy)_/;

function isGrowthFact(f: Fact, today: Date): boolean {
  const text = f.statement + ' ' + f.quote;
  if (!EXPANSION_RE.test(text)) return false;
  const since = monthsSinceHint(f.date_hint, today);
  if (since !== null) return (since >= 0 && since <= EXPANSION_WINDOW_MONTHS) || (since < 0 && since >= -24);
  if (EXPANSION_DONE_RE.test(f.statement)) return false;
  return EXPANSION_ONGOING_RE.test(text);
}

export function computeSignals(input: SignalInput): Signal[] {
  const { today, openVacancies, closedVacancies, spend, head, trustName } = input;
  const facts = input.facts.filter((f) => SIGNAL_FACT_KINDS.has(f.kind));
  const todayIso = isoDate(today);
  const out: Signal[] = [];
  const push = (s: Signal) => out.push(s);

  // Vacancies by family.
  // Office posts (a PA, an office manager) are listed but are neither teaching nor support for scoring.
  const teaching = openVacancies.filter((v) => familyOf(v.title) === 'teaching');
  const support = openVacancies.filter((v) => familyOf(v.title) === 'support');
  if (teaching.length) {
    push({ code: 'open_teaching_vacancies', label: SIGNAL_LABELS.open_teaching_vacancies, strength: strengthByCount(teaching.length), evidence: teaching.map((v) => vacancyEvidence(v)),
      explanation: teaching.length === 1 ? `One teaching vacancy is live: ${teaching[0].title}.` : `${teaching.length} teaching vacancies are live: ${teaching.map((v) => v.title).join(', ')}.` });
  }
  if (support.length) {
    push({ code: 'open_support_vacancies', label: SIGNAL_LABELS.open_support_vacancies, strength: strengthByCount(support.length), evidence: support.map((v) => vacancyEvidence(v)),
      explanation: support.length === 1 ? `One support vacancy is live: ${support[0].title}.` : `${support.length} support vacancies are live: ${support.map((v) => v.title).join(', ')}.` });
  }

  // Long open.
  const longOpen = openVacancies.filter((v) => daysBetween(v.firstSeen, todayIso) > LONG_OPEN_DAYS);
  if (longOpen.length) {
    push({ code: 'long_open_role', label: SIGNAL_LABELS.long_open_role, strength: 2, evidence: longOpen.map((v) => vacancyEvidence(v, `${daysBetween(v.firstSeen, todayIso)} days open`)),
      explanation: `${longOpen.map((v) => `${v.title} has been advertised for ${daysBetween(v.firstSeen, todayIso)} days`).join('; ')}.` });
  }

  // Re-advertised: an open row whose normalised title matches a closed row that
  // closed before this one appeared, within 180 days.
  const readvertised: Array<{ v: VacancyForSignals; closed: ClosedVacancyForSignals }> = [];
  for (const v of openVacancies) {
    const key = normaliseTitle(v.title);
    if (!key) continue;
    const prior = closedVacancies.filter((c) => normaliseTitle(c.title) === key && c.lastSeen < v.firstSeen && daysBetween(c.lastSeen, v.firstSeen) <= READVERTISED_WINDOW_DAYS && daysBetween(c.lastSeen, v.firstSeen) >= READVERTISED_MIN_GAP_DAYS);
    if (prior.length) readvertised.push({ v, closed: prior.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))[0] });
  }
  if (readvertised.length) {
    push({ code: 'readvertised_role', label: SIGNAL_LABELS.readvertised_role, strength: 3, evidence: readvertised.map(({ v, closed }) => vacancyEvidence(v, `previously advertised ${closed.firstSeen} to ${closed.lastSeen}`)),
      explanation: `${readvertised.map(({ v, closed }) => `${v.title} was advertised until ${closed.lastSeen} and is back up since ${v.firstSeen}`).join('; ')}.` });
  }

  // Closing within 7 days.
  const closing = openVacancies.filter((v) => v.closingDate && daysBetween(todayIso, v.closingDate) >= 0 && daysBetween(todayIso, v.closingDate) <= 7);
  if (closing.length) {
    push({ code: 'closing_this_week', label: SIGNAL_LABELS.closing_this_week, strength: 1, evidence: closing.map((v) => vacancyEvidence(v)),
      explanation: `${closing.map((v) => `${v.title} closes on ${v.closingDate}`).join('; ')}.` });
  }

  // Fixed term / maternity.
  const fixed = openVacancies.filter((v) => FIXED_TERM_RE.test(v.title) || FIXED_TERM_RE.test(v.advertText || '') || (v.contractTerms || []).some((c) => /maternity|fixed|temporary/i.test(c)));
  if (fixed.length) {
    push({ code: 'fixed_term_or_maternity', label: SIGNAL_LABELS.fixed_term_or_maternity, strength: 2, evidence: fixed.map((v) => vacancyEvidence(v, (v.contractTerms || []).join(', ') || 'cover role')),
      explanation: `${fixed.map((v) => v.title).join('; ')}: cover or fixed-term, the kind of role a supply or fixed-term placement fills quickly.` });
  }

  // Recruitment and retention allowance.
  const rr = openVacancies.filter((v) => RR_RE.test(v.title) || RR_RE.test(v.advertText || ''));
  if (rr.length) {
    push({ code: 'rr_allowance', label: SIGNAL_LABELS.rr_allowance, strength: 2, evidence: rr.map((v) => vacancyEvidence(v, 'advert mentions an allowance or incentive')),
      explanation: `${rr.map((v) => v.title).join('; ')}: the advert offers a recruitment or retention incentive, which companies add when a post is hard to fill.` });
  }

  // Agency spend vs peers.
  if (spend?.latest?.agencyAndSupply != null && spend.peers && spend.peers.count >= 4 && spend.peers.median > 0) {
    const v = spend.latest.agencyAndSupply;
    if (v > spend.peers.median) {
      const top = v >= spend.peers.upperQuartile;
      push({ code: 'agency_spend_high', label: SIGNAL_LABELS.agency_spend_high, strength: top ? 3 : 2,
        evidence: [{ type: 'data', text: `Supply and agency teaching staff ${spend.latest.fiscalYear}: ${pounds(v)}; median of ${spend.peers.count} ${spend.peers.phase || ''} companies in ${spend.peers.laName || 'the same authority'}: ${pounds(spend.peers.median)}; upper quartile ${pounds(spend.peers.upperQuartile)} (DfE financial benchmarking)` }],
        explanation: `Spent ${pounds(v)} on supply and agency teaching staff in ${spend.latest.fiscalYear}, ${top ? 'in the top quarter of' : 'above the median of'} ${spend.peers.count} ${spend.peers.phase || ''} companies in ${spend.peers.laName || 'the same authority'} (median ${pounds(spend.peers.median)}).`.replace(/\s+/g, ' ') });
    }
  }
  if (spend?.latest?.agencyAndSupply != null && spend.previous?.agencyAndSupply != null && spend.previous.agencyAndSupply > 0) {
    const change = (spend.latest.agencyAndSupply - spend.previous.agencyAndSupply) / spend.previous.agencyAndSupply;
    if (change > 0.2) {
      const trend = spend.trend ?? null;
      const twoYears = !!trend?.risingTwoYears;
      const series = trend && trend.points.length >= 3 ? trend.points.map((p) => `${pounds(p.agencyAndSupply)} in ${p.fiscalYear}`).join(', ') : `${pounds(spend.previous.agencyAndSupply)} in ${spend.previous.fiscalYear}, ${pounds(spend.latest.agencyAndSupply)} in ${spend.latest.fiscalYear}`;
      const perPupil = trend?.perPupil ? `; ${pounds(trend.perPupil)} per pupil in ${spend.latest.fiscalYear}` : '';
      push({ code: 'agency_spend_rising', label: SIGNAL_LABELS.agency_spend_rising, strength: twoYears ? 3 : 2,
        evidence: [{ type: 'data', text: `Supply and agency teaching staff: ${series}${perPupil} (DfE financial benchmarking)` }],
        explanation: `Supply and agency teaching spend rose ${Math.round(change * 100)}% from ${pounds(spend.previous.agencyAndSupply)} in ${spend.previous.fiscalYear} to ${pounds(spend.latest.agencyAndSupply)} in ${spend.latest.fiscalYear}${twoYears ? ', the second rise in a row' : ''}.` });
    }
  }

  // New headteacher: a leadership_change fact about the head (not a deputy or
  // assistant) within 12 months, or a changed DfE head record.
  // A dated fact is required: "new head" claims without a date are too weak
  // for a strength-3 signal.
  // An acting or interim head is a current state, so it counts undated.
  const leadershipFacts = facts.filter((f) => f.kind === 'leadership_change' && HEAD_ROLE_RE.test(f.statement) && !NOT_HEAD_RE.test(f.statement) && (factWithinDated(f, today, 12) || (ACTING_HEAD_RE.test(f.statement) && factWithin(f, today, 12))));
  const headChanged = !!(head?.current && head.previous && head.current !== head.previous && (!head.changedAt || daysBetween(head.changedAt, todayIso) <= 365));
  if (leadershipFacts.length || headChanged) {
    const ev: SignalEvidence[] = leadershipFacts.map(factEvidence);
    if (headChanged) ev.push({ type: 'data', text: `DfE record now names ${head!.current} as head; the previous record named ${head!.previous}${head!.changedAt ? ` (noticed ${head!.changedAt})` : ''}` });
    push({ code: 'new_headteacher', label: SIGNAL_LABELS.new_headteacher, strength: 3, evidence: ev,
      explanation: leadershipFacts.length ? leadershipFacts[0].statement : `The DfE record now names ${head!.current} as head, where it named ${head!.previous} before.` });
  }

  // Ofsted (Phase 5): the management-information row first. A report
  // published in the last 120 days is news whatever it says (strength 2), and
  // strength 3 when an area is below the expected standard or the company is
  // in a category of concern: leadership change and staff turnover follow.
  const ofsted = input.ofsted ?? null;
  const ofstedConcernNow = !!ofsted && (ofsted.concernAreas.length > 0 || !!ofsted.categoryOfConcern || ofsted.ungradedConcern || /requires improvement|inadequate/i.test(ofsted.oeifOverall || ''));
  if (ofsted) {
    const latest = [ofsted.publicationDate, ofsted.oeifPublicationDate, ofsted.ungradedDate].filter((d): d is string => !!d).sort().pop() ?? null;
    if (latest && daysBetween(latest, todayIso) >= 0 && daysBetween(latest, todayIso) <= OFSTED_RECENT_DAYS) {
      push({ code: 'ofsted_change', label: SIGNAL_LABELS.ofsted_change, strength: ofstedConcernNow ? 3 : 2,
        evidence: [{ type: 'ofsted', text: `Ofsted management information: ${ofsted.description}${ofsted.changeSummary ? ` (change noticed ${ofsted.changedAt}: ${ofsted.changeSummary})` : ''}`, source_url: ofsted.reportUrl || undefined }],
        explanation: `Ofsted: ${ofsted.description}${ofstedConcernNow ? '; a report like this is usually followed by leadership change and staff turnover' : ''}.` });
    }
  }

  // Ofsted RI, inadequate or an area needing attention: from the data when
  // we have it (within 3 years), else from an Ofsted fact on the site.
  const ofstedBad = facts.filter((f) => f.kind === 'ofsted' && OFSTED_BAD_RE.test(f.statement + ' ' + f.quote) && !(OFSTED_GOOD_RE.test(f.statement) && !OFSTED_BAD_RE.test(f.statement)) && factWithin(f, today, 36));
  const ofstedDataBad = ofsted && ofstedConcernNow && [ofsted.publicationDate, ofsted.oeifPublicationDate, ofsted.ungradedDate].some((d) => d && daysBetween(d, todayIso) <= 3 * 365);
  if (ofstedBad.length || ofstedDataBad) {
    const ev: SignalEvidence[] = ofstedBad.map(factEvidence);
    if (ofstedDataBad) ev.unshift({ type: 'ofsted', text: `Ofsted management information: ${ofsted!.description}`, source_url: ofsted!.reportUrl || undefined });
    push({ code: 'ofsted_ri_or_inadequate', label: SIGNAL_LABELS.ofsted_ri_or_inadequate, strength: 2, evidence: ev, explanation: ofstedDataBad ? `Ofsted: ${ofsted!.description}.` : ofstedBad[0].statement });
  }

  // SEND provision change.
  const sendChange = facts.filter((f) => f.kind === 'send_provision' && SEND_CHANGE_RE.test(f.statement + ' ' + f.quote));
  if (sendChange.length) {
    push({ code: 'send_provision_change', label: SIGNAL_LABELS.send_provision_change, strength: 2, evidence: sendChange.map(factEvidence), explanation: sendChange[0].statement });
  }

  // Expansion or new build: only with growth wording (rising rolls, new
  // classes, a new building or site, a new provision, a PAN change). A dated
  // fact counts within 18 months or ahead; an undated one only when it reads
  // as current or planned. A pitch, a pool or a theatre is not growth.
  const growth = facts.filter((f) => (f.kind === 'expansion' || f.kind === 'new_build') && isGrowthFact(f, today));
  if (growth.length) {
    const concrete = growth.filter((f) => EXPANSION_CONCRETE_RE.test(f.statement + ' ' + f.quote));
    const lead = concrete[0] ?? growth[0];
    push({ code: 'expansion', label: SIGNAL_LABELS.expansion, strength: concrete.length ? 2 : 1, evidence: [lead, ...growth.filter((f) => f !== lead)].map(factEvidence), explanation: lead.statement });
  }

  // Trust join within 18 months.
  const trustJoin = facts.filter((f) => f.kind === 'trust' && TRUST_JOIN_RE.test(f.statement + ' ' + f.quote) && factWithinDated(f, today, 18));
  if (trustJoin.length) {
    push({ code: 'trust_join', label: SIGNAL_LABELS.trust_join, strength: 2, evidence: trustJoin.map(factEvidence), explanation: trustJoin[0].statement });
  }

  // Staffing pressure stated: only with pressure wording, and never when
  // the sentence says the opposite ("no use of supply teachers"). Strength 3
  // for recruitment difficulty or agency reliance, 2 for a supply, cover or
  // interim mention. The opposite is its own small signal.
  const pressureFacts = facts.filter((f) => f.kind === 'staffing_pressure' || f.kind === 'supply_mention');
  const selfSufficient = pressureFacts.filter((f) => SELF_SUFFICIENT_RE.test(f.statement + ' ' + f.quote));
  const pressure = pressureFacts.filter((f) => !selfSufficient.includes(f) && (PRESSURE_STRONG_RE.test(f.statement + ' ' + f.quote) || PRESSURE_RE.test(f.statement + ' ' + f.quote)));
  if (pressure.length) {
    const strong = pressure.filter((f) => PRESSURE_STRONG_RE.test(f.statement + ' ' + f.quote));
    const lead = strong[0] ?? pressure[0];
    push({ code: 'staffing_pressure_stated', label: SIGNAL_LABELS.staffing_pressure_stated, strength: strong.length ? 3 : 2, evidence: [lead, ...pressure.filter((f) => f !== lead)].map(factEvidence), explanation: lead.statement });
  }
  if (selfSufficient.length) {
    push({ code: 'self_sufficient_stated', label: SIGNAL_LABELS.self_sufficient_stated, strength: 1, evidence: selfSufficient.map(factEvidence),
      explanation: `${selfSufficient[0].statement.replace(/\.$/, '')}; lead with the framework and permanent recruitment rather than supply.` });
  }

  // Staff leaving (Phase 5): a departure fact from the company's own pages,
  // usually a newsletter, within the last six months or dated ahead. The
  // vacancy that follows is weeks or months away, so this is the earliest
  // signal there is. Arrivals are kept as facts but are not a signal.
  const departures = facts.filter((f) => f.kind === 'staff_departure' && DEPARTURE_RE.test(f.statement + ' ' + f.quote) && factWithin(f, today, 6));
  if (departures.length) {
    push({ code: 'staff_departure', label: SIGNAL_LABELS.staff_departure, strength: departures.length >= 2 ? 3 : 2, evidence: departures.map(factEvidence),
      explanation: departures.length === 1 ? departures[0].statement : `${departures.length} members of staff are leaving or have left: ${departures.map((f) => f.statement.replace(/\.$/, '')).join('; ')}.` });
  }

  // Framework window.
  if (trustName && todayIso < FRAMEWORK_DEADLINE) {
    push({ code: 'framework_window', label: SIGNAL_LABELS.framework_window, strength: 1,
      evidence: [{ type: 'data', text: `DfE record: part of ${trustName}. From October 2026 academy trusts must engage agency staff through an approved framework (RM6376).` }],
      explanation: `The company is in ${trustName}; from October 2026 trusts must use a framework-approved agency, and WhoFoundWho is on RM6376 Lot 1.` });
  }

  // Resignation deadline countdown (Phase 5). Three weeks before each
  // deadline every company carries the date; a company with open teaching
  // posts or staff already leaving carries it at strength 2, because it is
  // the company that will have gaps to fill the day after. For ten days after
  // the deadline the signal flips to "just passed": the company now knows
  // its gaps for the term the leavers go.
  const gapEvidence: SignalEvidence[] = [
    ...teaching.map((v) => vacancyEvidence(v)),
    ...departures.map(factEvidence),
  ];
  const gapsWhy = teaching.length && departures.length
    ? `${teaching.length} open teaching ${teaching.length === 1 ? 'post' : 'posts'} and ${departures.length} ${departures.length === 1 ? 'member' : 'members'} of staff leaving`
    : teaching.length ? `${teaching.length} open teaching ${teaching.length === 1 ? 'post' : 'posts'}`
    : departures.length ? `${departures.length} ${departures.length === 1 ? 'member' : 'members'} of staff leaving` : '';
  const deadline = upcomingResignationDeadline(today, 21);
  if (deadline) {
    push({ code: 'resignation_deadline_near', label: SIGNAL_LABELS.resignation_deadline_near, strength: gapsWhy ? 2 : 1,
      evidence: [{ type: 'calendar', text: `Resignation deadline ${deadline.date} for staff leaving ${deadline.leaves}` }, ...gapEvidence],
      explanation: `Staff leaving ${deadline.leaves} must resign by ${deadline.date}, ${deadline.daysAway === 0 ? 'today' : `${deadline.daysAway} days away`}; the company will know its gaps shortly after${gapsWhy ? `, and it already has ${gapsWhy}` : ''}.` });
  }
  const passed = recentResignationDeadline(today, 10);
  if (passed) {
    push({ code: 'resignation_deadline_passed', label: SIGNAL_LABELS.resignation_deadline_passed, strength: gapsWhy ? 2 : 1,
      evidence: [{ type: 'calendar', text: `Resignation deadline ${passed.date} for staff leaving ${passed.leaves} passed ${passed.daysAgo === 0 ? 'today' : `${passed.daysAgo} ${passed.daysAgo === 1 ? 'day' : 'days'} ago`}` }, ...gapEvidence],
      explanation: `The ${passed.date} resignation deadline has passed, so the company now knows who is leaving ${passed.leaves}${gapsWhy ? `; it already has ${gapsWhy}` : ''}.` });
  }

  // Term start.
  const term = upcomingTermStart(today, 21);
  if (term) {
    push({ code: 'term_start_near', label: SIGNAL_LABELS.term_start_near, strength: 1,
      evidence: [{ type: 'calendar', text: `${term.term.name} starts ${term.term.date}` }],
      explanation: `The ${term.term.name} starts on ${term.term.date}, ${term.daysAway === 0 ? 'today' : `in ${term.daysAway} days`}; unfilled posts become cover needs from day one.` });
  }

  // An agency is already being paid to fill a role here (Zen Educate, Reed):
  // strength 2, 3 when two or more agencies or boards are at it. Adverts
  // with the same title on the same board are one line ("3 adverts"), in
  // the wording and in the evidence.
  const advertsAll = input.agencyAdverts || [];
  const groups = new Map<string, { first: AgencyAdvertForSignals; count: number }>();
  for (const a of advertsAll) {
    const k = `${a.board}|${normaliseTitle(a.title)}`;
    const g = groups.get(k);
    if (g) { g.count++; if (a.lastSeen > g.first.lastSeen) g.first = { ...a, id: g.first.id }; }
    else groups.set(k, { first: a, count: 1 });
  }
  if (groups.size) {
    const adverts = Array.from(groups.values());
    const agencies = new Set(adverts.map(({ first: a }) => (a.agency || a.boardLabel).toLowerCase()));
    const who = (a: AgencyAdvertForSignals) => a.agency && a.agency.toLowerCase() !== a.boardLabel.toLowerCase() ? `${a.agency} on ${a.boardLabel}` : a.boardLabel;
    const seen = (g: { first: AgencyAdvertForSignals; count: number }) => `${g.count > 1 ? `${g.count} adverts, ` : ''}seen ${formatSeen(g.first.lastSeen)}`;
    push({ code: 'agency_advertising', label: SIGNAL_LABELS.agency_advertising, strength: agencies.size >= 2 ? 3 : 2,
      evidence: adverts.map((g) => ({ type: 'agency_advert', id: g.first.id, text: `${who(g.first)}: "${g.first.title}" (${seen(g)})`, source_url: g.first.url })),
      explanation: adverts.map((g) => `${g.first.agency || g.first.boardLabel} is advertising "${g.first.title}" for this company${g.first.agency && g.first.agency.toLowerCase() !== g.first.boardLabel.toLowerCase() ? ` on ${g.first.boardLabel}` : ''} (${seen(g)})`).join('; ') + '.' });
  }

  // Tenders (Phase 6, slice 3): a live procurement for supply or agency
  // staff by the company, its trust or its authority is the clearest buying
  // signal there is; an award in the last year says who won and when the
  // contract ends, which is the next conversation.
  const tenders = input.tenders || [];
  const matchWord = (t: TenderForSignals) => t.matchedTo === 'company' ? 'the company itself' : t.matchedTo === 'trust' ? `its trust${t.buyerName ? ` (${t.buyerName})` : ''}` : `its local authority${t.buyerName ? ` (${t.buyerName})` : ''}`;
  const tenderEvidence = (t: TenderForSignals): SignalEvidence => ({ type: 'tender', id: t.id, text: `${t.source === 'find_a_tender' ? 'Find a Tender' : 'Contracts Finder'}: "${t.title}" by ${t.buyerName || 'unnamed buyer'} (${t.stage}${t.publishedAt ? `, published ${t.publishedAt.slice(0, 10)}` : ''}${t.deadline ? `, deadline ${t.deadline.slice(0, 10)}` : ''}${t.valueAmount ? `, ${pounds(t.valueAmount)}` : ''}${t.awardedSupplier ? `, awarded to ${t.awardedSupplier}` : ''}${t.contractEnd ? `, contract ends ${t.contractEnd.slice(0, 10)}` : ''})`, source_url: t.url });
  const openTenders = tenders.filter((t) => (t.stage === 'tender' || t.stage === 'planning') && (t.deadline ? daysBetween(todayIso, t.deadline.slice(0, 10)) >= -7 : !!t.publishedAt && daysBetween(t.publishedAt.slice(0, 10), todayIso) <= TENDER_OPEN_DAYS));
  if (openTenders.length) {
    const best = openTenders.find((t) => t.matchedTo === 'company') || openTenders.find((t) => t.matchedTo === 'trust') || openTenders[0];
    const strength: 1 | 2 | 3 = best.matchedTo === 'company' ? 3 : best.matchedTo === 'trust' ? 3 : 2;
    push({ code: 'tender_open', label: SIGNAL_LABELS.tender_open, strength, evidence: openTenders.map(tenderEvidence),
      explanation: `${matchWord(best).charAt(0).toUpperCase() + matchWord(best).slice(1)} has a ${best.stage === 'planning' ? 'planned procurement' : 'tender open'} for "${best.title}"${best.deadline ? `, deadline ${best.deadline.slice(0, 10)}` : ''}${best.valueAmount ? `, ${pounds(best.valueAmount)}` : ''}.` });
  }
  const awarded = tenders.filter((t) => (t.stage === 'award' || t.stage === 'contract') && !!t.publishedAt && daysBetween(t.publishedAt.slice(0, 10), todayIso) <= TENDER_AWARD_DAYS);
  if (awarded.length) {
    const best = awarded.find((t) => t.matchedTo === 'company') || awarded.find((t) => t.matchedTo === 'trust') || awarded[0];
    push({ code: 'tender_awarded', label: SIGNAL_LABELS.tender_awarded, strength: best.matchedTo === 'la' ? 1 : 2, evidence: awarded.map(tenderEvidence),
      explanation: `${matchWord(best).charAt(0).toUpperCase() + matchWord(best).slice(1)} awarded "${best.title}"${best.awardedSupplier ? ` to ${best.awardedSupplier}` : ''}${best.publishedAt ? ` on ${best.publishedAt.slice(0, 10)}` : ''}${best.contractEnd ? `; the contract runs to ${best.contractEnd.slice(0, 10)}` : ''}.` });
  }

  // Register (Phase 6, slice 4): a growing roll means more classes and more
  // cover; a new company is a full staff hire; a trust change means new
  // procurement and a new HR route.
  const reg = input.register ?? null;
  if (reg) {
    const hist = reg.pupilHistory;
    const latestP = hist[hist.length - 1];
    const prevP = hist[hist.length - 2];
    const growth = latestP && prevP && prevP.pupils > 0 ? (latestP.pupils - prevP.pupils) / prevP.pupils : null;
    const twoYears = hist.length >= 3 && hist[hist.length - 3].pupils > 0 ? (latestP.pupils - hist[hist.length - 3].pupils) / hist[hist.length - 3].pupils : null;
    const occupancy = reg.pupils && reg.capacity ? reg.pupils / reg.capacity : null;
    const overCapacity = occupancy !== null && occupancy > OVER_CAPACITY_SHARE;
    if ((growth !== null && growth >= PUPIL_GROWTH_SHARE) || overCapacity || (twoYears !== null && twoYears >= 2 * PUPIL_GROWTH_SHARE && growth !== null && growth > 0)) {
      const ev: SignalEvidence[] = [];
      if (latestP && prevP) ev.push({ type: 'register', text: `Pupils on roll (DfE benchmarking census): ${hist.slice(-3).map((h) => `${h.pupils.toLocaleString('en-GB')} in ${h.fiscalYear}`).join(', ')}` });
      if (reg.pupils && reg.capacity) ev.push({ type: 'register', text: `DfE register${reg.censusDate ? ` (census ${reg.censusDate})` : ''}: ${reg.pupils.toLocaleString('en-GB')} pupils against a capacity of ${reg.capacity.toLocaleString('en-GB')} (${Math.round(occupancy! * 100)}% full)` });
      const parts: string[] = [];
      if (growth !== null && growth >= PUPIL_GROWTH_SHARE) parts.push(`the roll rose ${Math.round(growth * 100)}% from ${prevP.pupils.toLocaleString('en-GB')} in ${prevP.fiscalYear} to ${latestP.pupils.toLocaleString('en-GB')} in ${latestP.fiscalYear}`);
      else if (twoYears !== null && twoYears >= 2 * PUPIL_GROWTH_SHARE) parts.push(`the roll is up ${Math.round(twoYears * 100)}% over two years to ${latestP.pupils.toLocaleString('en-GB')} in ${latestP.fiscalYear}`);
      if (overCapacity) parts.push(`the company is over capacity (${reg.pupils!.toLocaleString('en-GB')} pupils for ${reg.capacity!.toLocaleString('en-GB')} places)`);
      push({ code: 'pupil_growth', label: SIGNAL_LABELS.pupil_growth, strength: (growth !== null && growth >= 2 * PUPIL_GROWTH_SHARE) || (occupancy !== null && occupancy > 1.1) ? 2 : 1, evidence: ev,
        explanation: `${parts.join(' and ')}; more pupils means more classes to staff and more cover.`.replace(/^./, (c) => c.toUpperCase()) });
    }
    const status = (reg.status || '').toLowerCase();
    const openedMonths = reg.openDate ? (today.getTime() - new Date(reg.openDate + 'T00:00:00Z').getTime()) / (30.44 * 86400000) : null;
    const newReason = /new provision|academy free company|free special company|new nursery company/i.test(reg.reasonOpened || '');
    if (status === 'proposed to open' || (status.startsWith('open') && newReason && openedMonths !== null && openedMonths >= -1 && openedMonths <= NEW_COMPANY_MONTHS)) {
      const proposed = status === 'proposed to open';
      push({ code: 'new_company', label: SIGNAL_LABELS.new_company, strength: proposed ? 3 : openedMonths !== null && openedMonths <= 6 ? 3 : 2,
        evidence: [{ type: 'register', text: `DfE register: ${proposed ? 'proposed to open' : 'opened'}${reg.openDate ? ` ${reg.openDate}` : ''}${reg.reasonOpened ? ` (${reg.reasonOpened})` : ''}` }],
        explanation: proposed ? `The DfE register lists the company as proposed to open${reg.openDate ? ` on ${reg.openDate}` : ''}: a whole staff to recruit before the first day.` : `The company opened on ${reg.openDate} as new provision; a new company builds its staff and its supply arrangements in its first two years.` });
    }
    if (reg.trustChange && daysBetween(reg.trustChange.noticedAt, todayIso) <= TRUST_CHANGE_DAYS) {
      const c = reg.trustChange;
      push({ code: 'trust_change', label: SIGNAL_LABELS.trust_change, strength: 2,
        evidence: [{ type: 'register', text: `DfE register (noticed ${c.noticedAt}): trust ${c.previousTrust || 'none'} before, ${c.newTrust || 'none'} now` }],
        explanation: c.newTrust && c.previousTrust ? `The company moved from ${c.previousTrust} to ${c.newTrust} (noticed ${c.noticedAt}); a rebrokered company gets new HR and procurement routes.` : c.newTrust ? `The company joined ${c.newTrust} (noticed ${c.noticedAt}); a new trust reviews its supply arrangements.` : `The company left ${c.previousTrust} (noticed ${c.noticedAt}) and now stands alone.` });
    }
  }

  // From the team (consultant lists, September 2026): what a consultant
  // wrote on the "Buying signals & intel" tab, stored as consultant_intel
  // facts. Always strength 1: it is a colleague's note, not a dated source,
  // and the other rules already fire on anything the site confirms.
  const teamFacts = facts.filter((f) => f.kind === 'consultant_intel');
  if (teamFacts.length) {
    push({ code: 'consultant_intel', label: SIGNAL_LABELS.consultant_intel, strength: 1, evidence: teamFacts.map(factEvidence),
      explanation: teamFacts.length === 1 ? teamFacts[0].statement : `${teamFacts[0].statement.replace(/\.$/, '')}; ${teamFacts.length - 1} more note${teamFacts.length > 2 ? 's' : ''} from the team.` });
  }

  // Pupil premium strategy statement (15 September 2026). Three rules over
  // the pupil_premium facts (each a line of the statement with its quote)
  // and the allocation against same-authority peers.
  // 1. The statement puts pupil premium money into support staff: strength
  //    2; 3 when a TA, HLTA, tutor, mentor or intervention line says the
  //    staffing is new, additional or to be recruited.
  const ppYear = input.pupilPremium?.academicYear ?? facts.find((f) => f.kind === 'pupil_premium' && f.date_hint)?.date_hint ?? null;
  const ppSupport = facts.filter((f) => f.kind === 'pupil_premium' && PP_SUPPORT_KEY.test(f.statement_key));
  if (ppSupport.length) {
    const recruiting = ppSupport.filter((f) => PP_RECRUITABLE_KEY.test(f.statement_key) && PP_RECRUIT_RE.test(`${f.statement} ${f.quote}`));
    const roles = Array.from(new Set(ppSupport.map((f) => f.statement_key.replace(/^pp_staffing_/, '').replace(/_\d+$/, '').replace(/_/g, ' ').replace(/^hlta$/, 'HLTA').replace(/^elsa$/, 'ELSA'))));
    push({ code: 'pp_support_staff', label: SIGNAL_LABELS.pp_support_staff, strength: recruiting.length ? 3 : 2, evidence: [...recruiting, ...ppSupport.filter((f) => !recruiting.includes(f))].slice(0, 6).map(factEvidence),
      explanation: `The pupil premium statement${ppYear ? ` for ${ppYear}` : ''} puts money into ${roles.join(', ')} (${ppSupport.length} staffing line${ppSupport.length === 1 ? '' : 's'})${recruiting.length ? `, and says ${recruiting.length === 1 ? 'one of them is' : `${recruiting.length} of them are`} new, additional or to be recruited` : ''}.` });
  }
  // 2. A named literacy, EAL or oracy programme: informational, strength 1.
  const ppProgrammes = facts.filter((f) => f.kind === 'pupil_premium' && PP_LITERACY_KEY.test(f.statement_key));
  if (ppProgrammes.length) {
    const names = ppProgrammes.map((f) => f.statement.replace(/ is used for .*$/, '').replace(/\.$/, ''));
    push({ code: 'pp_programme', label: SIGNAL_LABELS.pp_programme, strength: 1, evidence: ppProgrammes.slice(0, 6).map(factEvidence),
      explanation: `The pupil premium statement${ppYear ? ` for ${ppYear}` : ''} names ${names.join(', ')}; staff who know ${names.length === 1 ? 'it' : 'them'} are worth offering.` });
  }
  // 3. The allocation per pupil on roll is above the median of the
  //    same-authority companies whose statements we hold (at least four).
  const pp = input.pupilPremium;
  if (pp?.allocation && pp.pupilsOnRoll && pp.peers && pp.peers.count >= 4 && pp.peers.median > 0) {
    const perPupil = pp.allocation / pp.pupilsOnRoll;
    if (perPupil > pp.peers.median) {
      const allocationFact = facts.find((f) => f.kind === 'pupil_premium' && f.statement_key === 'pp_allocation');
      push({ code: 'pp_above_peers', label: SIGNAL_LABELS.pp_above_peers, strength: 1,
        evidence: [...(allocationFact ? [factEvidence(allocationFact)] : []), { type: 'data', text: `${pounds(pp.allocation)} ÷ ${pp.pupilsOnRoll.toLocaleString('en-GB')} pupils on roll = ${pounds(perPupil)} per pupil; median of ${pp.peers.count} companies in ${pp.peers.laName || 'the same authority'} with a statement: ${pounds(pp.peers.median)} per pupil (their statements)`, source_url: pp.documentUrl }],
        explanation: `Pupil premium of ${pounds(pp.allocation)}${ppYear ? ` in ${ppYear}` : ''} is ${pounds(perPupil)} per pupil on roll, above the median of ${pp.peers.count} companies in ${pp.peers.laName || 'the same authority'} (${pounds(pp.peers.median)}).` });
    }
  }

  return out.sort((a, b) => b.strength - a.strength);
}

/** "9 Sep" from an ISO date. */
function formatSeen(iso: string): string {
  const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]}`;
}
