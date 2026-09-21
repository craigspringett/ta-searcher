// The signal taxonomy (docs/TA-SEARCHER-BRIEF.md, "Signals and the score").
// Every signal is computed from data we hold: validated facts, the open and
// closed role rows, the Companies House register (status, incorporation
// date, officers, capital filings) and the contacts with a role key. The
// model is never asked to invent one.

import type { Fact } from '../facts/types.ts';
import { monthsSinceHint } from '../facts/validate.ts';
import { amountFromText, roundFromText, stageFromRound } from '../facts/derive.ts';
import { daysBetween, describeDate, isoDate, monthsBetween } from './calendar.ts';
import { isTalentLeadRole, isTalentRole, ROLE_FAMILY_LABELS, roleFamily as familyOf, type RoleFamily } from '../vacancies/role-family.ts';

export type SignalCode =
  | 'talent_role_open' | 'hiring_surge' | 'engineering_hiring' | 'no_people_function' | 'funding_round'
  | 'shares_allotted' | 'new_senior_officer' | 'long_open_role' | 'readvertised_role' | 'staffing_pressure_stated'
  | 'agency_advertising' | 'staff_departure' | 'expansion' | 'accelerator' | 'new_company' | 'consultant_intel'
  | 'has_talent_lead';

export interface SignalEvidence {
  type: 'fact' | 'vacancy' | 'register' | 'contact' | 'data';
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
  /** ISO date first seen open (the feed's posting date when that is earlier). */
  firstSeen: string;
  closingDate: string | null;
  source: string;
  url?: string | null;
  /** The feed's department or team, which decides the family when the title is ambiguous. */
  department?: string | null;
  location?: string | null;
  /** Any advert text we hold (description, summary) for the wording checks. */
  advertText?: string | null;
}

export interface ClosedVacancyForSignals {
  title: string;
  firstSeen: string;
  lastSeen: string;
}

export interface OfficerForSignals {
  name: string;
  /** Companies House officer_role: 'director', 'secretary', 'llp-member', ... */
  role: string;
  appointedOn: string | null;
  resignedOn: string | null;
}

export interface CapitalFilingForSignals {
  date: string;
  /** 'SH01', ... */
  type: string;
  description: string;
}

export interface RegisterForSignals {
  status: string | null;
  incorporationDate: string | null;
  officers: OfficerForSignals[];
  capitalFilings: CapitalFilingForSignals[];
}

export interface ContactForSignals {
  name: string;
  role: string | null;
  /** From the contacts taxonomy: founder, coo, cto, people, talent, exec, ea, investor. */
  roleKey: string | null;
}

export interface SignalInput {
  today: Date;
  facts: Fact[];
  openVacancies: VacancyForSignals[];
  closedVacancies: ClosedVacancyForSignals[];
  register: RegisterForSignals | null;
  contacts: ContactForSignals[];
}

export const SIGNAL_LABELS: Record<SignalCode, string> = {
  talent_role_open: 'Hiring for talent or recruitment',
  hiring_surge: 'Many open roles',
  engineering_hiring: 'Engineering hiring',
  no_people_function: 'No one runs hiring',
  funding_round: 'Raised recently',
  shares_allotted: 'Shares allotted (Companies House)',
  new_senior_officer: 'New senior officer',
  long_open_role: 'Role open more than five weeks',
  readvertised_role: 'Re-advertised role',
  staffing_pressure_stated: 'Hiring pressure stated',
  agency_advertising: 'Uses agencies',
  staff_departure: 'Staff leaving',
  expansion: 'Expanding',
  accelerator: 'Accelerator alumni',
  new_company: 'Young company hiring',
  consultant_intel: 'From the team',
  has_talent_lead: 'A Head of Talent is already in post',
};

export const LONG_OPEN_DAYS = 35;
export const READVERTISED_WINDOW_DAYS = 180;
/** A listing that vanished for a day or two and came back is a board hiccup, not a re-advert. */
export const READVERTISED_MIN_GAP_DAYS = 7;
/** How far back a funding_round fact still counts as "raised recently". */
export const FUNDING_WINDOW_MONTHS = 9;
/** A raise of this much or more is strength 3 whatever the round is called. */
export const FUNDING_STRONG_GBP = 5_000_000;
export const SHARES_ALLOTTED_MONTHS = 6;
export const NEW_OFFICER_MONTHS = 6;
export const LEADERSHIP_CHANGE_MONTHS = 6;
export const DEPARTURE_MONTHS = 6;
/** A talent person who left this long ago still means the function is vacant, and cancels "has a talent lead". */
export const TALENT_DEPARTURE_MONTHS = 12;
export const EXPANSION_WINDOW_MONTHS = 12;
export const AGENCY_WINDOW_MONTHS = 12;
export const NEW_COMPANY_MONTHS = 24;
export const NEW_COMPANY_MIN_ROLES = 3;
export const NO_PEOPLE_FUNCTION_MIN_ROLES = 4;
/** Open roles listed as evidence for the count signals; the rest are counted, not listed. */
const MAX_LISTED_ROLES = 20;

// The role family (engineering, product and design, go to market, operations,
// people and talent, leadership, other) is the shared rule in
// vacancies/role-family.ts; re-exported so the callers keep one import.
export { roleFamily, type RoleFamily } from '../vacancies/role-family.ts';

/**
 * A title's identity across postings: the source suffix, any parenthetical
 * ("(Remote)", "(London)"), a trailing location or workplace segment and
 * the workplace, contract and location words are removed, so "Senior
 * Backend Engineer - London (Hybrid)" and "Senior Backend Engineer" are one
 * role. Seniority stays: a Senior Engineer and an Engineer are two roles.
 */
export function normaliseTitle(title: string): string {
  return title.toLowerCase()
    .replace(/\s*\([^)]*\)/g, ' ')
    .replace(/\s*[-–—|:,]\s*(?:remote|hybrid|on-?site|in[- ]office|london|uk|united kingdom|england|europe|emea|us|usa|united states|new york|nyc|berlin|paris|amsterdam|dublin|global|worldwide|full[- ]time|part[- ]time|contract|permanent|fixed[- ]term|temporary|maternity cover|internship)\b[^-–—|]*$/g, ' ')
    .replace(/\b(remote|hybrid|on-?site|in[- ]office|full[- ]time|part[- ]time|contract|permanent|fixed[- ]term|temporary|maternity cover|london|uk|united kingdom|emea|europe|usa|\d+ ?fte)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SENIOR_ROLE_RE = /\b(?:\bceo\b|\bcoo\b|\bcto\b|\bcpo\b|\bcfo\b|\bcmo\b|\bcro\b|\bcso\b|\bciso\b|chief [a-z]+ officer|chief of staff|\bvp\b|vice president|\bsvp\b|\bevp\b|managing director|general manager|president|head of (?:people|talent|engineering|product|sales|marketing|operations|finance|growth|revenue|design))\b/i;
const LEADERSHIP_MOVE_RE = /\b(?:join\w*|appoint\w*|hire\w*|hired|welcom\w*|named|promot\w*|becom\w*|steps? (?:up|down|into)|stepp\w* (?:up|down|into)|tak\w* over|takes? the (?:helm|reins)|new (?:ceo|coo|cto|cpo|cfo|cmo|cro|chief|vp|head)|leav\w*|left|depart\w*|exit\w*|moving on|transition\w*|succeed\w*|replac\w*|resign\w*)\b/i;
const DEPARTURE_RE = /\b(leav\w*|left|retir\w*|depart\w*|moving on|moves? to|moved to|last day|farewell|goodbye|say goodbye|maternity leave|paternity leave|parental leave|adoption leave|sabbatical|secondment|stepping down|steps down|stepped down|stepping back|new (?:role|post|position|company|challenge|chapter|adventure)|promotion|promoted|exit\w*|resign\w*|handing over|handed over|signing off|next chapter)\b/i;
/** The leaver ran people or talent: the function is now vacant. */
const TALENT_PERSON_RE = /\b(?:talent|recruit\w*|people|\bhr\b|human resources|hiring)\b/i;
/** A Head of Talent, Head of Recruitment, Director of Talent or TA lead named in a talent_team fact or a contact's role text. */
const TALENT_LEAD_TEXT_RE = /\b(?:head|director|lead|leader|vp|vice president|chief|manager) (?:of )?(?:talent|recruit\w*|talent acquisition|people (?:and|&) talent|\bta\b)\b|\b(?:talent|recruit(?:ing|ment)|talent acquisition|\bta\b) (?:lead|leader|director|head|manager)\b|\blead recruiter\b/i;
/** A people_function fact that says nobody runs it yet. */
const NO_PEOPLE_RE = /\b(?:no|nobody|no one|no-one|not yet|without|don['’]t (?:yet )?have|do not (?:yet )?have|doesn['’]t (?:yet )?have|does not (?:yet )?have|yet to (?:hire|appoint)|haven['’]t (?:yet )?(?:hired|appointed)|has not (?:yet )?(?:hired|appointed)|hasn['’]t (?:yet )?(?:hired|appointed)|no dedicated|no in-house|no internal|no full-time|founders? (?:run|runs|handle|handles|lead|leads|do|does) (?:all )?(?:the )?(?:hiring|recruit\w*))\b/i;
/** A people_function fact that names someone in post running people or talent. */
const PEOPLE_IN_POST_RE = /\b(?:head of people|chief people officer|\bcpo\b|vp,? (?:of )?people|director of people|people (?:lead|partner|director|manager|ops|operations)|head of talent|head of recruit\w*|talent (?:partner|lead|manager|acquisition)|in-house recruit\w*|internal recruit\w*)\b/i;
/**
 * Hiring pressure needs pressure wording: scaling the team, hiring
 * aggressively, doubling headcount, hiring x people, growing the team from
 * x to y, hard or struggling to hire, hiring as the bottleneck. "We're
 * hiring" on its own is every careers page and never fires.
 */
const PRESSURE_RE = /\b(?:scal(?:e|ing) (?:up )?(?:the |our )?(?:team|company|headcount|engineering|hiring|org(?:anisation|anization)?)|hiring (?:aggressively|fast|quickly|rapidly|at pace|at speed|across (?:the board|every team|all teams))|(?:doubl|tripl)(?:e|ed|ing) (?:in size|(?:the |our |its )?(?:headcount|team|size|engineering team|workforce))|(?:hire|hiring|recruit|recruiting|add|adding|bring on|bringing on|onboard|onboarding) (?:over |more than |another |around |about |up to |at least )?\d+ (?:new |more |additional )?(?:people|engineers|hires|roles|heads|staff|employees|colleagues|team members|salespeople|developers)|grow(?:ing|n)? (?:the |our |its )?(?:team|headcount|company) (?:from \d+ to \d+|to (?:over |more than |around )?\d+|by \d+)|from \d+ to (?:over |more than )?\d+ (?:people|employees|staff|engineers|heads)|(?:hard|difficult|tough|struggl\w*|challenging|a challenge) to (?:hire|find|recruit|attract|fill)|struggl\w* (?:to|with) (?:hire|hiring|recruit\w*)|(?:difficulty|difficulties) (?:hiring|recruiting|finding)|hard[- ]to[- ]fill|(?:hiring|recruit\w*|talent) (?:is|remains|has become|was) (?:our |the |a )?(?:biggest |number one |top |main |key )?(?:challenge|bottleneck|constraint|priority|focus)|(?:aggressive|rapid|ambitious) (?:hiring|growth|expansion) plans?|headcount (?:growth|plans?|targets?)|\d+ open (?:roles|positions|vacancies)|open roles across)\b/i;
/** A number or a timescale in a pressure statement makes it strength 3. */
const PRESSURE_CONCRETE_RE = /\b\d+\b|\b(?:this (?:year|quarter|half)|next (?:year|quarter|\d+ months|six months|twelve months)|by (?:the end of )?(?:20\d{2}|q[1-4]|january|february|march|april|may|june|july|august|september|october|november|december|christmas|summer|year[- ]end)|(?:in|over|within) the (?:next|coming) (?:\d+ |few |six |twelve )?(?:months|weeks|quarters|year)|in 20\d{2}|20\d{2})\b/i;
/** "No agencies", "we don't work with recruitment agencies": the opposite of using one. */
const NO_AGENCY_RE = /\b(?:no (?:recruitment |recruiting |staffing |search )?agenc(?:y|ies)|not (?:currently )?(?:working|work|engage|engaging) with (?:recruitment |external |third[- ]party )?agenc(?:y|ies)|agenc(?:y|ies) (?:need not|should not|please do not|please don['’]t|do not|don['’]t)|without (?:using )?(?:recruitment )?agenc(?:y|ies)|(?:don['’]t|do not|never|doesn['’]t|does not) (?:use|work with|accept|engage) (?:recruitment |recruiting |external |third[- ]party )?(?:agenc(?:y|ies)|recruiters|headhunters)|direct(?:ly)? (?:hires?|hiring|applicants?|applications?) only|unsolicited (?:cvs?|resumes?|agency))\b/i;
/** A named agency or search firm: "Acme Search", "via Talent Partners", "retained Hunter & Co". */
const NAMED_AGENCY_RE = /\b[A-Z][\w&'’-]*(?:\s+[A-Z][\w&'’-]*){0,3}\s+(?:Recruitment|Recruiting|Search|Talent|Staffing|Consulting|Partners|Executive Search|Headhunters?|Associates)\b|\b(?:via|through|partnered with|working with|retained|appointed|engaged|using)\s+[A-Z][\w&'’-]+/;
/** Growth wording for the expansion signal: a new office, market, country, city or team. */
const EXPANSION_RE = /\b(?:expand\w*|expansion|grow(?:ing|th|n)|launch\w* (?:in|into|across) [A-Za-z]+|open\w* (?:a |an |our |its |their )?(?:new |second |third |first )?(?:office|offices|hub|hq|headquarters|studio|site|team|market|base)|new (?:office|offices|hub|hq|headquarters|studio|market|markets|country|countries|region|regions|team|teams|city|cities|territory|territories)|(?:second|third|first international|european|us|uk|american|german|french|dutch|nordic|asian|australian|singapore|new york|berlin|paris|amsterdam|dublin) (?:office|hub|launch|expansion|market|team|base)|(?:enter\w*|entering|entry into|move into|moving into) (?:the )?(?:us|uk|eu|european|american|german|french|asian|australian|nordic|japanese|global|international|new) (?:market|markets)?|international(?:ly)?|go(?:ing|es)? global|across (?:europe|the us|north america|asia|apac|latam|\d+ (?:countries|markets|cities))|now (?:live|available|operating|open) in [A-Za-z]+|relocat\w*|mov(?:e|es|ed|ing) (?:in)?to (?:a |our |its |their )?(?:new |larger |bigger )?(?:office|hq|headquarters|home|space|premises))\b/i;
/** Concrete growth (strength 2): a named place, a new office or team, a number. Vague growth ("a growing company") is strength 1. */
const EXPANSION_CONCRETE_RE = /\b(?:office|offices|hub|hq|headquarters|studio|site|country|countries|market|markets|region|city|cities|territory|team|teams|\d+ (?:countries|markets|cities|people))\b|\b(?:us|uk|eu|europe|european|america|american|germany|german|france|french|netherlands|dutch|nordics?|asia|apac|latam|australia|singapore|india|new york|berlin|paris|amsterdam|dublin|manchester|edinburgh|london)\b/i;
/** An undated growth fact counts only when it reads as current or planned. */
const EXPANSION_ONGOING_RE = /\b(?:expanding|growing|launching|opening|entering|moving|relocating|plans?|planned|planning|will|currently|now|this year|next year|soon|upcoming|is being|are being|continue\w*|due to open|recently|just|newly|latest)\b/i;
/** A completed thing with no date is history, not a signal. */
const EXPANSION_DONE_RE = /\b(?:was (?:founded|opened|launched|established)|were (?:founded|opened|launched|established)|founded in|established in|since 20\d{2})\b/i;
/** A named accelerator, for the wording; the fact kind is enough for the signal. */
const ACCELERATOR_RE = /\b(?:y ?combinator|\byc\b|techstars|entrepreneur first|\bef\b|antler|seedcamp|founders factory|500 (?:startups|global)|plug and play|wayra|creative destruction lab|\bcdl\b|alchemist|zinc|carbon13|bethnal green ventures|\bbgv\b|accelerator|incubator)\b/i;

/** One, two, three or more of a thing: strength 1, 2, 3. Kept for the rules that count facts. */
export function strengthByCount(n: number): 1 | 2 | 3 {
  return n >= 3 ? 3 : n === 2 ? 2 : 1;
}

function factEvidence(f: Fact): SignalEvidence {
  return { type: 'fact', id: f.id, text: f.statement, quote: f.quote, source_url: f.source_url };
}

function vacancyEvidence(v: VacancyForSignals, extra?: string): SignalEvidence {
  const where = [v.department, v.location].filter(Boolean).join(', ');
  return { type: 'vacancy', id: v.id, text: `${v.title} (${v.source}, first seen ${v.firstSeen}${where ? `, ${where}` : ''}${v.closingDate ? `, closes ${v.closingDate}` : ''}${extra ? `; ${extra}` : ''})`, source_url: v.url || undefined };
}

function contactEvidence(c: ContactForSignals): SignalEvidence {
  return { type: 'contact', text: c.role ? `${c.name}, ${c.role}` : c.name };
}

function factWithin(f: Fact, today: Date, months: number): boolean {
  const since = monthsSinceHint(f.date_hint, today);
  // A fact with no usable date is taken as current: the site says it today.
  return since === null || (since >= 0 && since <= months) || (since < 0 && since >= -12);
}

/** Like factWithin, but a fact without a usable date does not count. */
export function factWithinDated(f: Fact, today: Date, months: number): boolean {
  const since = monthsSinceHint(f.date_hint, today);
  return since !== null && ((since >= 0 && since <= months) || (since < 0 && since >= -12));
}

function pounds(n: number): string {
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}m`;
  if (n >= 1_000) return `£${Math.round(n / 1_000)}k`;
  return '£' + Math.round(n).toLocaleString('en-GB');
}

function list(items: string[], max = 6): string {
  return items.length <= max ? items.join(', ') : `${items.slice(0, max).join(', ')} and ${items.length - max} more`;
}

/**
 * The fact kinds a signal may be built from. A "values", "remote_policy"
 * or "other" fact is never evidence, whatever it says, so it can never be
 * the reason for a call.
 */
export const SIGNAL_FACT_KINDS: ReadonlySet<string> = new Set(['funding_round', 'investor', 'stage', 'headcount', 'hiring_plan', 'leadership_change', 'people_function', 'talent_team', 'expansion', 'new_market', 'office', 'accelerator', 'staffing_pressure', 'agency_mention', 'staff_departure', 'consultant_intel']);

function isGrowthFact(f: Fact, today: Date): boolean {
  const text = f.statement + ' ' + f.quote;
  if (!EXPANSION_RE.test(text)) return false;
  const since = monthsSinceHint(f.date_hint, today);
  if (since !== null) return (since >= 0 && since <= EXPANSION_WINDOW_MONTHS) || (since < 0 && since >= -24);
  if (EXPANSION_DONE_RE.test(f.statement)) return false;
  return EXPANSION_ONGOING_RE.test(text);
}

/** The strength a funding_round fact earns: 3 for a Series A or later or £5m and up, 1 for pre-seed or angel, 2 for seed or an unnamed round. */
function fundingStrength(f: Fact): 1 | 2 | 3 {
  const round = roundFromText(f.statement) ?? roundFromText(f.quote);
  const stage = stageFromRound(round);
  const amount = amountFromText(f.statement) ?? amountFromText(f.quote);
  if (stage === 'series_a' || stage === 'series_b_plus' || (amount && amount.amountGbp >= FUNDING_STRONG_GBP)) return 3;
  if (stage === 'pre_seed') return 1;
  return 2;
}

function monthsAgo(iso: string, todayIso: string): number {
  return monthsBetween(iso, todayIso);
}

export function computeSignals(input: SignalInput): Signal[] {
  const { today, openVacancies, closedVacancies, contacts } = input;
  const register = input.register ?? null;
  const facts = input.facts.filter((f) => SIGNAL_FACT_KINDS.has(f.kind));
  const todayIso = isoDate(today);
  const out: Signal[] = [];
  const push = (s: Signal) => out.push(s);

  // Roles by family, for the counts and the wording.
  const families = new Map<RoleFamily, VacancyForSignals[]>();
  for (const v of openVacancies) {
    const fam = familyOf(v.title, v.department);
    families.set(fam, [...(families.get(fam) || []), v]);
  }
  const familyWords = (): string => {
    const order: RoleFamily[] = ['engineering', 'go_to_market', 'product_design', 'operations', 'people_talent', 'leadership', 'other'];
    return order.filter((f) => families.get(f)?.length).map((f) => `${families.get(f)!.length} ${ROLE_FAMILY_LABELS[f].toLowerCase()}`).join(', ');
  };

  // Hiring for talent or recruitment: the company is advertising for the
  // person who would run its hiring. A Head of Talent or Head of
  // Recruitment is strength 3; two or more talent roles 2; one recruiter 1.
  const talentRoles = openVacancies.filter((v) => isTalentRole(v.title));
  if (talentRoles.length) {
    const leads = talentRoles.filter((v) => isTalentLeadRole(v.title));
    const lead = leads[0] ?? talentRoles[0];
    push({ code: 'talent_role_open', label: SIGNAL_LABELS.talent_role_open, strength: leads.length ? 3 : talentRoles.length >= 2 ? 2 : 1,
      evidence: [lead, ...talentRoles.filter((v) => v !== lead)].map((v) => vacancyEvidence(v)),
      explanation: leads.length
        ? `${lead.title} is open (${lead.source}, first seen ${lead.firstSeen}): the company is hiring the person who would run its recruiting.`
        : talentRoles.length === 1 ? `One talent role is open: ${lead.title} (${lead.source}, first seen ${lead.firstSeen}); the company is building its hiring capacity.` : `${talentRoles.length} talent roles are open: ${list(talentRoles.map((v) => v.title))}; the company is building its hiring capacity.` });
  }

  // Many open roles: 4 to 7 is 1, 8 to 14 is 2, 15 or more is 3.
  const n = openVacancies.length;
  if (n >= 4) {
    push({ code: 'hiring_surge', label: SIGNAL_LABELS.hiring_surge, strength: n >= 15 ? 3 : n >= 8 ? 2 : 1, evidence: openVacancies.slice(0, MAX_LISTED_ROLES).map((v) => vacancyEvidence(v)),
      explanation: `${n} open roles: ${familyWords()}; that is a lot of hiring for a team without a recruiter.` });
  }

  // Engineering hiring: 2 to 3 is 1, 4 to 6 is 2, 7 or more is 3.
  const engineering = families.get('engineering') || [];
  if (engineering.length >= 2) {
    push({ code: 'engineering_hiring', label: SIGNAL_LABELS.engineering_hiring, strength: engineering.length >= 7 ? 3 : engineering.length >= 4 ? 2 : 1, evidence: engineering.slice(0, MAX_LISTED_ROLES).map((v) => vacancyEvidence(v)),
      explanation: `${engineering.length} engineering roles are open: ${list(engineering.map((v) => v.title))}; engineers are the slowest hires a founder makes alone.` });
  }

  // Long open.
  const longOpen = openVacancies.filter((v) => daysBetween(v.firstSeen, todayIso) > LONG_OPEN_DAYS);
  if (longOpen.length) {
    const talentLong = longOpen.some((v) => isTalentRole(v.title));
    push({ code: 'long_open_role', label: SIGNAL_LABELS.long_open_role, strength: talentLong || longOpen.length >= 3 ? 3 : 2, evidence: longOpen.map((v) => vacancyEvidence(v, `${daysBetween(v.firstSeen, todayIso)} days open`)),
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

  // Who runs people or talent today, from the contacts, the facts and the
  // register. Used by "no one runs hiring" and by the talent-lead adjustment.
  const peopleContacts = contacts.filter((c) => c.roleKey === 'people' || c.roleKey === 'talent');
  const talentTeamFacts = facts.filter((f) => f.kind === 'talent_team');
  const peopleFunctionFacts = facts.filter((f) => f.kind === 'people_function');
  // "We don't yet have a Head of People" names the post and says it is empty: the negation wins.
  const nobodyFacts = peopleFunctionFacts.filter((f) => NO_PEOPLE_RE.test(`${f.statement} ${f.quote}`));
  const inPostFacts = peopleFunctionFacts.filter((f) => PEOPLE_IN_POST_RE.test(`${f.statement} ${f.quote}`) && !NO_PEOPLE_RE.test(`${f.statement} ${f.quote}`));
  const peopleOfficers = (register?.officers || []).filter((o) => !o.resignedOn && TALENT_PERSON_RE.test(o.role));
  const departures = facts.filter((f) => f.kind === 'staff_departure' && DEPARTURE_RE.test(f.statement + ' ' + f.quote) && factWithin(f, today, DEPARTURE_MONTHS));
  const talentLeavers = facts.filter((f) => f.kind === 'staff_departure' && TALENT_PERSON_RE.test(f.statement) && factWithin(f, today, TALENT_DEPARTURE_MONTHS));

  // No one runs hiring: 4 or more open roles and no people or talent
  // person among the contacts, the facts or the officers.
  if (n >= NO_PEOPLE_FUNCTION_MIN_ROLES && !peopleContacts.length && !talentTeamFacts.length && !inPostFacts.length && !peopleOfficers.length) {
    push({ code: 'no_people_function', label: SIGNAL_LABELS.no_people_function, strength: 2,
      evidence: [{ type: 'data', text: `${n} open roles and no people or talent person among the ${contacts.length} contact${contacts.length === 1 ? '' : 's'} found, the facts or the officers` }, ...nobodyFacts.map(factEvidence)],
      explanation: nobodyFacts.length ? `${nobodyFacts[0].statement.replace(/\.$/, '')}, and ${n} roles are open.` : `${n} roles are open and nobody found on the site or the register runs people or talent: the founders are doing the hiring themselves.` });
  }

  // Raised recently: a funding_round fact within nine months (undated ones
  // count as current). Strength from the round and the amount; the investor
  // facts ride along as evidence.
  const funding = facts.filter((f) => f.kind === 'funding_round' && factWithin(f, today, FUNDING_WINDOW_MONTHS));
  if (funding.length) {
    const ranked = [...funding].sort((a, b) => fundingStrength(b) - fundingStrength(a) || (monthsSinceHint(a.date_hint, today) ?? 99) - (monthsSinceHint(b.date_hint, today) ?? 99));
    const lead = ranked[0];
    const investors = facts.filter((f) => f.kind === 'investor' && factWithin(f, today, FUNDING_WINDOW_MONTHS));
    const amount = amountFromText(lead.statement) ?? amountFromText(lead.quote);
    const round = roundFromText(lead.statement) ?? roundFromText(lead.quote);
    const detail = [amount ? pounds(amount.amountGbp) : null, round].filter(Boolean).join(' ');
    push({ code: 'funding_round', label: SIGNAL_LABELS.funding_round, strength: fundingStrength(lead), evidence: [...ranked, ...investors].map(factEvidence),
      explanation: `${lead.statement.replace(/\.$/, '')}${detail && !lead.statement.toLowerCase().includes((round || '').toLowerCase()) ? ` (${detail})` : ''}; new money is spent on people first.` });
  }

  // Shares allotted: an SH01 within six months is the register's own
  // evidence of money coming in; 2 within three months; 3 when the website
  // says nothing about a round.
  const allotments = (register?.capitalFilings || []).filter((f) => /^SH01\b/i.test(f.type) || /allotment of shares/i.test(f.description)).filter((f) => monthsAgo(f.date, todayIso) >= 0 && monthsAgo(f.date, todayIso) <= SHARES_ALLOTTED_MONTHS && f.date <= todayIso);
  if (allotments.length) {
    const latest = [...allotments].sort((a, b) => b.date.localeCompare(a.date))[0];
    const recent = monthsAgo(latest.date, todayIso) <= 3;
    const unmentioned = !funding.length;
    push({ code: 'shares_allotted', label: SIGNAL_LABELS.shares_allotted, strength: unmentioned ? 3 : recent ? 2 : 1,
      evidence: allotments.map((f) => ({ type: 'register', text: `Companies House ${f.type} ${describeDate(f.date)}: ${f.description}` })),
      explanation: `Companies House recorded an allotment of shares on ${describeDate(latest.date)}${allotments.length > 1 ? ` (${allotments.length} filings in six months)` : ''}, which is money coming in${unmentioned ? '; the website says nothing about a round' : ''}.` });
  }

  // New senior officer: a Companies House director appointment within six
  // months, or a leadership_change fact within six months naming a CEO,
  // COO, CTO, CPO, CFO, a VP or a chief. Both together is strength 3.
  const newOfficers = (register?.officers || []).filter((o) => o.appointedOn && !o.resignedOn && /director|member/i.test(o.role) && monthsAgo(o.appointedOn, todayIso) >= 0 && monthsAgo(o.appointedOn, todayIso) <= NEW_OFFICER_MONTHS && o.appointedOn <= todayIso);
  const leadershipFacts = facts.filter((f) => f.kind === 'leadership_change' && SENIOR_ROLE_RE.test(f.statement) && LEADERSHIP_MOVE_RE.test(f.statement + ' ' + f.quote) && factWithin(f, today, LEADERSHIP_CHANGE_MONTHS));
  if (newOfficers.length || leadershipFacts.length) {
    const recent = newOfficers.some((o) => monthsAgo(o.appointedOn!, todayIso) <= 3);
    const strength: 1 | 2 | 3 = newOfficers.length && leadershipFacts.length ? 3 : leadershipFacts.length ? 2 : recent ? 2 : 1;
    const ev: SignalEvidence[] = [
      ...leadershipFacts.map(factEvidence),
      ...newOfficers.map((o) => ({ type: 'register' as const, text: `Companies House: ${o.name} appointed ${o.role} on ${describeDate(o.appointedOn!)}` })),
    ];
    push({ code: 'new_senior_officer', label: SIGNAL_LABELS.new_senior_officer, strength, evidence: ev,
      explanation: leadershipFacts.length
        ? `${leadershipFacts[0].statement.replace(/\.$/, '')}${newOfficers.length ? `; Companies House shows ${list(newOfficers.map((o) => o.name), 3)} appointed ${newOfficers.length === 1 ? 'as a director' : 'as directors'} in the last six months` : ''}; a new leader reviews how the team is hired.`
        : `Companies House shows ${list(newOfficers.map((o) => `${o.name} appointed ${o.role} on ${describeDate(o.appointedOn!)}`), 3)}; a new director often means a new investor or a new leader, and either reviews how the team is hired.` });
  }

  // Hiring pressure stated: pressure wording in a staffing_pressure,
  // hiring_plan or headcount fact. Strength 3 with a number or a timescale.
  const pressure = facts.filter((f) => (f.kind === 'staffing_pressure' || f.kind === 'hiring_plan' || f.kind === 'headcount') && PRESSURE_RE.test(f.statement + ' ' + f.quote) && factWithin(f, today, 12));
  if (pressure.length) {
    const concrete = pressure.filter((f) => PRESSURE_CONCRETE_RE.test(f.statement + ' ' + f.quote));
    const lead = concrete[0] ?? pressure[0];
    push({ code: 'staffing_pressure_stated', label: SIGNAL_LABELS.staffing_pressure_stated, strength: concrete.length ? 3 : 2, evidence: [lead, ...pressure.filter((f) => f !== lead)].map(factEvidence), explanation: lead.statement });
  }

  // Uses agencies: an agency_mention fact that is not "no agencies". A
  // named firm is strength 2, two or more mentions 3, a bare mention 1.
  const agencyFacts = facts.filter((f) => f.kind === 'agency_mention' && !NO_AGENCY_RE.test(f.statement + ' ' + f.quote) && factWithin(f, today, AGENCY_WINDOW_MONTHS));
  if (agencyFacts.length) {
    const named = agencyFacts.filter((f) => NAMED_AGENCY_RE.test(f.statement) || NAMED_AGENCY_RE.test(f.quote));
    const lead = named[0] ?? agencyFacts[0];
    push({ code: 'agency_advertising', label: SIGNAL_LABELS.agency_advertising, strength: agencyFacts.length >= 2 ? 3 : named.length ? 2 : 1, evidence: [lead, ...agencyFacts.filter((f) => f !== lead)].map(factEvidence),
      explanation: `${lead.statement.replace(/\.$/, '')}; a company already paying agency fees knows what a Head of Talent would save it.` });
  }

  // Staff leaving: a departure fact within six months or dated ahead.
  // Strength 3 when two or more are leaving or when the leaver ran people or
  // talent, because that function is now vacant.
  if (departures.length) {
    const talent = departures.filter((f) => TALENT_PERSON_RE.test(f.statement));
    const lead = talent[0] ?? departures[0];
    push({ code: 'staff_departure', label: SIGNAL_LABELS.staff_departure, strength: talent.length || departures.length >= 2 ? 3 : 2, evidence: [lead, ...departures.filter((f) => f !== lead)].map(factEvidence),
      explanation: talent.length
        ? `${lead.statement.replace(/\.$/, '')}; the person who ran hiring has gone.`
        : departures.length === 1 ? departures[0].statement : `${departures.length} members of staff are leaving or have left: ${departures.map((f) => f.statement.replace(/\.$/, '')).join('; ')}.` });
  }

  // Expanding: a new office, market, country or team within twelve months,
  // with growth wording. A named place or office is strength 2, two or
  // more concrete facts 3, vague growth 1.
  const growth = facts.filter((f) => (f.kind === 'expansion' || f.kind === 'new_market' || f.kind === 'office') && isGrowthFact(f, today));
  if (growth.length) {
    const concrete = growth.filter((f) => EXPANSION_CONCRETE_RE.test(f.statement + ' ' + f.quote));
    const lead = concrete[0] ?? growth[0];
    push({ code: 'expansion', label: SIGNAL_LABELS.expansion, strength: concrete.length >= 2 ? 3 : concrete.length ? 2 : 1, evidence: [lead, ...growth.filter((f) => f !== lead)].map(factEvidence), explanation: `${lead.statement.replace(/\.$/, '')}; a new office or market is a new team to hire.` });
  }

  // Accelerator alumni: informational, strength 1; the accelerator's own
  // network is where a founder first hears of a recruiter.
  const accelerators = facts.filter((f) => f.kind === 'accelerator');
  if (accelerators.length) {
    const named = accelerators.map((f) => (f.statement + ' ' + f.quote).match(ACCELERATOR_RE)?.[0]).filter((x): x is string => !!x && !/^(?:accelerator|incubator)$/i.test(x));
    push({ code: 'accelerator', label: SIGNAL_LABELS.accelerator, strength: 1, evidence: accelerators.map(factEvidence),
      explanation: named.length ? `${accelerators[0].statement.replace(/\.$/, '')}; ${named[0]} companies raise and hire on a schedule.` : accelerators[0].statement });
  }

  // Young company hiring: incorporated within 24 months and three or more
  // open roles. A company in its first year is strength 2.
  if (register?.incorporationDate && n >= NEW_COMPANY_MIN_ROLES) {
    const months = monthsAgo(register.incorporationDate, todayIso);
    if (months >= 0 && months <= NEW_COMPANY_MONTHS) {
      push({ code: 'new_company', label: SIGNAL_LABELS.new_company, strength: months <= 12 ? 2 : 1,
        evidence: [{ type: 'register', text: `Companies House: incorporated ${describeDate(register.incorporationDate)} (${months} month${months === 1 ? '' : 's'} ago)${register.status ? `, ${register.status}` : ''}; ${n} open roles` }],
        explanation: `Incorporated on ${describeDate(register.incorporationDate)} and already has ${n} open roles: a young company building its first team, usually with nobody to run hiring.` });
    }
  }

  // From the team: what a consultant wrote in the intel column, stored as
  // consultant_intel facts. Always strength 1: it is a colleague's note,
  // not a dated source, and the other rules already fire on anything the
  // site confirms.
  const teamFacts = facts.filter((f) => f.kind === 'consultant_intel');
  if (teamFacts.length) {
    push({ code: 'consultant_intel', label: SIGNAL_LABELS.consultant_intel, strength: 1, evidence: teamFacts.map(factEvidence),
      explanation: teamFacts.length === 1 ? teamFacts[0].statement : `${teamFacts[0].statement.replace(/\.$/, '')}; ${teamFacts.length - 1} more note${teamFacts.length > 2 ? 's' : ''} from the team.` });
  }

  // A Head of Talent is already in post: a talent contact whose role is a
  // head, director or lead of talent or recruitment, or a talent_team fact,
  // and no talent person has left within twelve months. Scores nothing
  // itself; the propensity score halves on it.
  const talentLeadContacts = contacts.filter((c) => c.roleKey === 'talent' && !!c.role && (TALENT_LEAD_TEXT_RE.test(c.role) || isTalentLeadRole(c.role)));
  if ((talentLeadContacts.length || talentTeamFacts.length) && !talentLeavers.length) {
    const who = talentLeadContacts[0];
    push({ code: 'has_talent_lead', label: SIGNAL_LABELS.has_talent_lead, strength: 1,
      evidence: [...talentLeadContacts.map(contactEvidence), ...talentTeamFacts.map(factEvidence)],
      explanation: who
        ? `${who.name} is ${who.role}; the company has the function, so the conversation is about capacity, not building one.`
        : `${talentTeamFacts[0].statement.replace(/\.$/, '')}; the company has the function, so the conversation is about capacity, not building one.` });
  }

  return out.sort((a, b) => b.strength - a.strength);
}
