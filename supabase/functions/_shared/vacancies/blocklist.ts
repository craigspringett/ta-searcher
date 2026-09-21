// Open-role title rule. TA Searcher counts every open role as hiring load
// (docs/TA-SEARCHER-BRIEF.md: "Nothing is rejected by family"), so the only
// family rejects are placeholders that are not a role at all: a general or
// speculative application, a talent community or pool, "future
// opportunities", "don't see a role?". Interns and apprentices are kept.
//
// The shape rejects (a URL, a navigation label, a category link, a sentence,
// a document, a news headline) and the non-English check are kept from
// He-Giveth's rule, without its education wording. A title from an ATS feed
// is always a role: the job-noun test (looksLikeRoleTitle) applies only to
// titles read off a careers page or by the model.

export interface RoleFamilyRule {
  /** Short slug used in the reason string. */
  family: string;
  reason: string;
  re: RegExp;
  /** Titles matching this guard are exempt from the family even when `re` matches. */
  unless?: RegExp;
}

const W = (s: string) => s.replace(/\s+/g, '[\\s-]+');
const any = (...alts: string[]) => `(?:${alts.map(W).join('|')})`;
const re = (source: string) => new RegExp(`\\b${source}\\b`, 'i');

export const ROLE_FAMILIES: RoleFamilyRule[] = [
  {
    family: 'placeholder',
    reason: 'not a role (a general application, talent community or future-opportunities placeholder)',
    re: re(any(
      'general (?:application|applications|interest|enquir(?:y|ies))', 'open (?:application|applications)', 'speculative (?:application|applications|cv|cvs|enquir(?:y|ies))?', 'speculative',
      'talent (?:community|network|pool|bank|database|pipeline|bench)', 'join our talent', 'talent (?:community|network|pool) (?:sign[\\s-]?up|registration)',
      'future (?:opportunities|roles|openings|positions|vacancies|hiring)', 'upcoming (?:opportunities|roles|openings)',
      "don'?t see (?:a|an|the|your|what)(?: \\w+)? (?:role|job|fit|position|opening|you)", 'not seeing (?:a|an|the|your)(?: \\w+)? (?:role|job|fit|position)', "can'?t find (?:a|an|the|your)(?: \\w+)? (?:role|job|fit|position)", 'no (?:role|job) for you', 'nothing (?:for you|that fits)',
      'expressions? of interest', 'register your interest', 'keep in touch', 'stay in touch', 'get on our radar', 'introduce yourself', 'send us your cv', 'drop us your cv',
      'dream job (?:not listed|missing)', "we'?re always hiring", 'always looking for', 'unlisted role',
    )),
  },
];

const NON_ENGLISH_MARKER = /[äöüßÄÖÜàâçéèêëîïôûùÿñáíóúãõ]|\(\s*[wmdfx](?:\/[wmdfx]){1,3}\s*\)/;

/** Function words and role words from other languages; any one of these marks a foreign-language advert. */
const FOREIGN_WORDS = /\b(und|für|fuer|der|die|das|mit|bei|als|gesucht|vollzeit|teilzeit|entwickler(?:in)?|ingenieur(?:in)?|mitarbeiter(?:in)?|leiter(?:in)?|développeur|developpeur|ingénieur|ingenieur|responsable|chargé|chargée|stagiaire|alternance|alternant|commercial(?:e)? (?:sédentaire|terrain)|desarrollador|ingeniero|ingeniera|responsable de|sviluppatore|ingegnere|ontwikkelaar|medewerker)\b/i;

/**
 * Words that can appear in an English start-up job title. Used only by the
 * non-English heuristic; an all-caps token (SDR, CTO, QA) always counts as
 * English. The heuristic fires only when a title has no English word at all.
 */
const ENGLISH_WORDS = new Set(`
a an and the of for to in at with or on by from as is are per plus into without
engineer engineers engineering developer developers development software backend frontend fullstack full stack platform infrastructure devops site reliability cloud data scientist science machine learning ai ml research researcher security mobile ios android web
product design designer designers ux ui user experience content writer copywriter creative brand visual motion illustrator
sales account executive executives manager managers management lead leads leader head heads director directors chief officer officers vice president founder founders founding partner partners associate associates
marketing growth demand generation customer customers success support service services onboarding partnerships partnership business commercial revenue community events event social media communications comms pr seo performance lifecycle crm
operations ops finance financial accountant accounting controller bookkeeper payroll legal counsel paralegal compliance risk regulatory fraud credit procurement supply chain logistics admin administrator administration administrative assistant assistants executive office receptionist facilities workplace it
people talent recruiter recruiters recruiting recruitment acquisition hr human resources sourcer sourcing employer culture onboarding
analyst analysts specialist specialists coordinator co-ordinator consultant consultants advisor adviser generalist fellow intern interns internship apprentice apprentices apprenticeship graduate graduates trainee junior senior mid level staff principal
representative representatives sdr bdr ae quality assurance qa test tester automation architect architects programme program project delivery scrum master agile coach
strategy insights intelligence protection governance treasury tax audit investor relations fundraising grants sustainability policy clinical scientific laboratory lab technician technicians
remote hybrid london manchester edinburgh bristol cambridge oxford uk europe emea us usa new york berlin amsterdam paris dublin
full part time permanent contract fixed term temporary months month year years
team member members role roles position positions job jobs opportunity opportunities hire hiring open vacancy vacancies
series announcement announce announces funding raise round
ii iii iv i two three four
`.split(/\s+/).filter(Boolean));

function looksNonEnglish(t: string): boolean {
  if (NON_ENGLISH_MARKER.test(t)) return true;
  if (FOREIGN_WORDS.test(t)) return true;
  const tokens = (t.match(/[A-Za-z][A-Za-z'-]*/g) || []).filter((w) => w.length >= 3);
  if (tokens.length < 2) return false;
  const english = tokens.filter((w) => w === w.toUpperCase() || ENGLISH_WORDS.has(w.toLowerCase()) || ENGLISH_WORDS.has(w.toLowerCase().replace(/s$/, ''))).length;
  return english === 0;
}

const SHAPE_REJECTS: Array<{ re: RegExp; reason: string }> = [
  { re: /\?\s*$/, reason: 'question, not a title' },
  { re: /^(?:https?:\/\/|www\.)|\.(?:co\.uk|org\.uk|com|org|net|io|ai|dev|app)(?:\/|$)/i, reason: 'url' },
  { re: /\bwelcome\b/i, reason: 'welcome page' },
  { re: /^message from/i, reason: 'message page' },
  { re: /policy$/i, reason: 'policy page' },
  { re: /policies$/i, reason: 'policy page' },
  { re: /newsletter/i, reason: 'newsletter' },
  { re: /^our /i, reason: 'about page' },
  { re: /^about( us)?$/i, reason: 'about page' },
  { re: /^(home|contact( us)?|news|blog|events|press|vacancies|jobs|careers|open roles|open positions|openings|all (?:roles|jobs|openings|positions)|current (?:vacancies|openings|roles|jobs|opportunities)|latest (?:vacancies|jobs|roles)|job (?:vacancies|opportunities|openings)|work(ing)? (for|with|at) us|join (us|our team|the team)|life at [^\s]+|why [^\s]+|benefits|perks|culture|values|our values|team|meet the team|the team|apply now|apply|see all jobs|view all jobs|view (?:open )?roles|explore (?:roles|jobs|opportunities))$/i, reason: 'navigation' },
  { re: /^(there are |we )?(currently )?(have |are )?no\b.*(vacanc|role|opening|position)/i, reason: 'no-vacancies notice' },
  { re: /^(click|read|find out|learn|view|see) (here|more|all)/i, reason: 'link text' },
  { re: /^(hear|meet|read|see|watch|discover|find out|learn|explore|view|join|why|what|how|thank|congratulations)\b/i, reason: 'link text' },
  { re: /\b(celebrat|award|ceremony|newsletter|blog|podcast|interview with|case study|webinar|whitepaper|white paper|press release|announc\w*|funding round|series [a-d]\b|raises?|raised)\b/i, reason: 'news item' },
  { re: /^(how to apply|application form|job description|person specification|hiring process|interview process|our hiring process|recruitment (pack|policy|process))\b/i, reason: 'application document' },
  { re: /\b(information|overview|handbook|guide|guidance|pack|faqs?)$/i, reason: 'information page' },
  { re: /\b(network|programme|program|scheme|association|forum)$/i, reason: 'information page' },
  { re: /\b(application form|fact sheet|brochure|handbook|recruitment events?|person specification|privacy notice|candidate privacy)\b|\bjob description$|\bform\s*-\s*(pdf|word)$/i, reason: 'document, not a vacancy' },
  { re: /^(?:(?:engineering|product|design|sales|marketing|operations|people|all|other|our|current|latest|open|remote|london|and|&)\s+)*(?:opportunities|vacancies|jobs|roles|openings|positions|teams?)$/i, reason: 'category link' },
  { re: /^(become a|be a|be part|register|sign up|subscribe)\b/i, reason: 'link text' },
  { re: /\b(can|will|receive|receives|are|is|has|have|we're|we are|you'll|you will)\b|^in addition/i, reason: 'sentence, not a title' },
];

export interface BlockDecision {
  blocked: boolean;
  reason?: string;
}

const CURRENT_YEAR = new Date().getUTCFullYear();

/** Which family rule, if any, excludes this title. Only placeholders are excluded. */
export function matchRoleFamily(title: string): RoleFamilyRule | null {
  for (const f of ROLE_FAMILIES) {
    if (!f.re.test(title)) continue;
    if (f.unless && f.unless.test(title)) continue;
    return f;
  }
  return null;
}

export function isBlockedTitle(title: string): BlockDecision {
  const t = (title || '').replace(/\s+/g, ' ').trim();
  const year = t.match(/\b(20\d{2})\b/);
  if (year && parseInt(year[1], 10) < CURRENT_YEAR - 1) return { blocked: true, reason: `refers to ${year[1]}` };
  if (t.length < 3) return { blocked: true, reason: 'too short' };
  if (t.length > 140) return { blocked: true, reason: 'too long' };
  const family = matchRoleFamily(t);
  if (family) return { blocked: true, reason: `role rule: ${family.reason}` };
  for (const s of SHAPE_REJECTS) {
    if (s.re.test(t)) return { blocked: true, reason: s.reason };
  }
  if (looksNonEnglish(t)) return { blocked: true, reason: 'role rule: non-English title' };
  return { blocked: false };
}

/**
 * Job nouns. A title read off a careers page or by the model must contain
 * one of these to count as a role, so team names and page headings
 * ("Engineering", "Our culture", "London") never become vacancies. A title
 * from an ATS feed is a role by definition and is never tested.
 */
const JOB_NOUNS = [
  'engineer', 'developer', 'programmer', 'architect', 'scientist', 'researcher', 'analyst', 'technician', 'tester', 'devops', 'sre',
  'manager', 'lead', 'head of', 'head', 'director', 'chief', 'officer', 'president', 'vp', 'svp', 'evp', 'founder', 'co-founder', 'partner', 'principal', 'gm', 'general manager', 'chief of staff', 'ceo', 'cto', 'coo', 'cfo', 'cpo', 'cmo', 'cro', 'ciso',
  'designer', 'writer', 'copywriter', 'illustrator', 'editor', 'producer', 'strategist', 'marketer', 'evangelist', 'advocate',
  'recruiter', 'sourcer', 'talent', 'people', 'hr', 'hrbp',
  'executive', 'representative', 'rep', 'sdr', 'bdr', 'ae', 'associate', 'specialist', 'coordinator', 'co-ordinator', 'consultant', 'advisor', 'adviser', 'generalist', 'agent', 'ambassador', 'champion',
  'assistant', 'ea', 'pa', 'secretary', 'receptionist', 'administrator', 'controller', 'accountant', 'bookkeeper', 'counsel', 'paralegal', 'lawyer', 'solicitor', 'clerk',
  'intern', 'internship', 'apprentice', 'apprenticeship', 'graduate', 'trainee', 'fellow', 'placement',
  'sales', 'account', 'success', 'support', 'operations', 'ops', 'product', 'marketing', 'growth', 'finance', 'legal', 'compliance', 'risk', 'underwriter', 'trader',
  'nurse', 'doctor', 'clinician', 'pharmacist', 'therapist', 'psychologist', 'dietitian', 'driver', 'rider', 'courier', 'installer', 'mechanic', 'electrician', 'chef', 'barista', 'host',
  'scrum master', 'owner', 'buyer', 'planner', 'auditor', 'actuary', 'quant', 'economist', 'statistician', 'mathematician', 'physicist', 'chemist', 'biologist', 'geologist',
];

const JOB_NOUN_RE = new RegExp(`\\b(?:${JOB_NOUNS.map((w) => w.replace(/[-\s]+/g, '[-\\s]?')).join('|')})s?\\b`, 'i');

/** The sources whose titles are roles by definition (a feed lists jobs and nothing else). */
const FEED_SOURCES = new Set(['ashby', 'greenhouse', 'lever', 'workable', 'consultant']);

/**
 * Weak positive check: does the text read like a job title? A feed title
 * always does; a careers-page or model title needs a job noun.
 */
export function looksLikeRoleTitle(title: string, source?: string | null): boolean {
  if (source && FEED_SOURCES.has(source)) return !!(title || '').trim();
  return JOB_NOUN_RE.test(title || '');
}

/**
 * The full rule as the pipeline applies it to a stored title: strip source
 * suffixes first (the caller does that with cleanTitle), then reject
 * placeholders and page shapes, and for a title not from a feed require a
 * job noun and no headline shape. Returns the reason a title fails, or null.
 */
export function roleRuleFailure(cleanedTitle: string, source?: string | null): string | null {
  const block = isBlockedTitle(cleanedTitle);
  if (block.blocked) return block.reason || 'blocked';
  if (source && FEED_SOURCES.has(source)) return null;
  if (!looksLikeRoleTitle(cleanedTitle, source)) return 'no job noun in title';
  if (looksLikeHeadline(cleanedTitle)) return 'reads like a news headline';
  return null;
}

/**
 * News headlines and blog titles that happen to contain a job noun ("Our
 * head of product on shipping fast", "How our engineers work remotely") are
 * not vacancies: a verb phrase, a celebration word, a trailing ellipsis or a
 * question mark gives them away.
 */
const HEADLINE_RE = /\b(leads? to|led to|successes|successful|celebrat\w*|congratulat\w*|wins?|won|winners?|awarded|achiev\w*|announc\w*|visits?|visited|launch\w*|enjoy\w*|inspir\w*|shine[sd]?|triumph\w*|journey|takes? part|took part|welcome[sd]|raise[sd]?|raising|raised|fundrais\w*|competition|festival|showcase|spotlight|thank you|thanks|well done|proud|delighted|excited|amazing|fantastic|brilliant|wonderful|returns?|update[sd]?|reminder|this week|last week|next week|today|yesterday|tomorrow|series [a-d]\b|funding|lessons? (?:from|learned|learnt)|behind the scenes|a day in the life|meet our|q&a|interview)\b/i;

export function looksLikeHeadline(title: string): boolean {
  const t = (title || '').trim();
  if (!t) return false;
  if (/(\.\.\.|…)$/.test(t) || /\?$/.test(t)) return true;
  if (HEADLINE_RE.test(t)) return true;
  // A question word or an "our" opener is a blog title, not a role.
  if (/^(?:how|why|what|when|where|who|meet|inside|introducing|our|the|a|an)\b/i.test(t)) return true;
  // A title that starts with a job noun ("Head of Talent") is a title; one
  // whose only job word is a verb-like "Leads" mid-sentence is not.
  if (/\b(?:leads|leading)\b/i.test(t) && t.split(/\s+/).length >= 5) return true;
  return false;
}
