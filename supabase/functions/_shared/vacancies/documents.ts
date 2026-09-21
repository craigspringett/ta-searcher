// Careers-page documents about a post, stale dated documents, and
// near-identical titles. Kept from He-Giveth's role-rule pass of 10 September
// 2026, where a job description and its advert came through as two lines and
// a March "Advert" PDF as a new role:
//
//   - A title that is a document about a post (job description, JD, role
//     profile, application form, candidate pack, guidance notes) is never a
//     vacancy. The merge attaches it to the advert for the same post as a
//     document, or drops it when there is no advert. A title that is the
//     advert itself ("... Advert") keeps the post name without the word.
//   - A careers-page document whose title (or upload path, or Last-Modified
//     date) is more than 60 days old is not a new vacancy.
//   - Near-identical titles for one company within a run are the same post:
//     the comparison ignores dates, file words, the company's own initials,
//     filler and word order, expands the usual abbreviations, and treats a
//     truncated title ("... Job Descrip...") as a prefix.
//
// ATS feeds carry none of this (a feed lists jobs, not files); the rules
// apply to what the careers-page source and the model read off a page.

export type DocumentKind = 'advert' | 'job_description' | 'person_specification' | 'application_form' | 'pack' | 'guidance';

export const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  advert: 'advert',
  job_description: 'job description',
  person_specification: 'person specification',
  application_form: 'application form',
  pack: 'information pack',
  guidance: 'guidance notes',
};

/** Supporting documents: about a post, never the post itself. Checked in this order. */
const SUPPORTING: Array<{ kind: DocumentKind; re: RegExp }> = [
  { kind: 'job_description', re: /\b(?:job|role|post)[\s-]?descrip\w*(?:\.{2,}|…)?|\bjds?\b|\bj\.d\.?(?:\s|$)|\b(?:role|job) profiles?\b|\bjob specs?\b|\bjob specifications?\b|\bjd[\s\/&+-]+(?:ps|pers(?:on)?(?:al)? ?spec\w*)\b/i },
  { kind: 'person_specification', re: /\bperson(?:al|nel)?[\s-]?spec\w*(?:\.{2,}|…)?|\bpers\.?[\s-]?spec\w*|\bpersonal specification\b/i },
  { kind: 'application_form', re: /\bapplication forms?\b|\bapp\.? forms?\b|\bforms?\s*[-:]\s*(?:pdf|word|docx?)\b/i },
  { kind: 'pack', re: /\b(?:information|info|candidate|recruitment|applicant|application|job|vacancy|welcome|appointment|role|recruitment information) packs?\b|\bfurther (?:information|particulars|details)\b|\binformation for (?:applicants|candidates)\b|\bfact ?sheets?\b|\bbrochures?\b|\bprospectus\b/i },
  { kind: 'guidance', re: /\bguidance(?:[\s-]notes?)?\b|\bnotes? (?:for|to|on)\b|\bguides? (?:for|to)\b|\bguidelines?\b|\bhow to apply\b|\bsafer recruitment\b|\brecruitment (?:policy|process|procedure)\b|\bapplicant information\b/i },
];

const ADVERT_RE = /\b(?:job|vacancy|post|role)?[\s-]?advert(?:isement)?s?\b/i;

/** Words that describe the file rather than the post. */
const FILE_WORDS = /\b(?:pdf|docx?|word|document|download|final|v\d+|version \d+|copy|draft|updated|revised|new)\b/gi;

export interface DocumentClassification {
  /** null when the title is an ordinary vacancy title. */
  kind: DocumentKind | null;
  /** The post the document is about: the title without the document words, dates and file words. */
  post: string;
  /** True when the title is a supporting document (anything but an advert). */
  supporting: boolean;
  /** True when the post name itself was cut short ("Teacher of Mathem..."), as opposed to a trailing document word. */
  cut: boolean;
}

function tidy(s: string): string {
  return s
    .replace(/[…]|\.{3,}/g, ' ')
    .replace(/\s*[-–—:|\/&+,]+\s*(?=[-–—:|\/&+,]|$)/g, ' ')
    .replace(/^\s*[-–—:|\/&+,.]+\s*/, '')
    .replace(/\s*[-–—:|\/&+,.]+\s*$/, '')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip every date, year and dd.mm.yy stamp from a title. */
export function stripDates(title: string): string {
  return tidy(title
    .replace(DATE_NUMERIC_G, ' ')
    .replace(DATE_ISO_G, ' ')
    .replace(DATE_DAY_MONTH_YEAR_G, ' ')
    .replace(DATE_MONTH_YEAR_G, ' ')
    .replace(/\b20\d{2}\b/g, ' '));
}

/** Classify a title as an advert, a supporting document, or an ordinary title, and name the post it is about. */
export function classifyDocument(title: string): DocumentClassification {
  const t = (title || '').replace(/\s+/g, ' ').trim();
  let kind: DocumentKind | null = null;
  let post = t;
  if (ADVERT_RE.test(t)) {
    kind = 'advert';
    post = post.replace(new RegExp(ADVERT_RE.source, 'gi'), ' ');
    // "Advert and JD" is still the advert; drop the other words too.
    for (const s of SUPPORTING) post = post.replace(new RegExp(s.re.source, 'gi'), ' ');
  } else {
    for (const s of SUPPORTING) {
      if (!s.re.test(t)) continue;
      kind = s.kind;
      post = post.replace(new RegExp(s.re.source, 'gi'), ' ');
      // A JD that also mentions the person specification, or the reverse.
      for (const o of SUPPORTING) if (o !== s) post = post.replace(new RegExp(o.re.source, 'gi'), ' ');
      break;
    }
  }
  const cut = /(?:\.{3,}|…)\s*$/.test(post.replace(FILE_WORDS, ' ').trim());
  post = stripDates(post.replace(FILE_WORDS, ' '));
  post = tidy(post.replace(/^(?:for|of|the|a|an|and|&)\s+/i, '').replace(/\s+(?:for|of|the|a|an|and|&)$/i, ''));
  return { kind, post, supporting: kind !== null && kind !== 'advert', cut };
}

// --- Dates in titles and upload paths ---------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DATE_NUMERIC_G = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/g;
const DATE_ISO_G = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;
const DATE_DAY_MONTH_YEAR_G = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\.?,?\\s+(20\\d{2}|\\d{2})\\b`, 'gi');
const DATE_MONTH_YEAR_G = new RegExp(`\\b${MONTH_RE}\\.?,?\\s+(20\\d{2})\\b`, 'gi');
const UPLOAD_PATH_RE = /\/(?:uploads?|files?|documents?|media|assets|attachments?)\/(20\d{2})\/(\d{2})(?:\/|$)/i;

function monthIndex(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase());
}

function daysIn(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

function utc(year: number, month0: number, day: number): Date | null {
  if (month0 < 0 || month0 > 11) return null;
  if (day < 1 || day > daysIn(year, month0)) return null;
  return new Date(Date.UTC(year, month0, day));
}

function fullYear(y: string): number {
  return y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
}

export interface TitleDate {
  /** The date the title refers to; a month or a year alone counts as its last day. */
  date: Date;
  /** The text that carried it. */
  text: string;
}

/**
 * The date a title carries, if any: "03.03.26", "3 March 2026", "March 2026",
 * "2026-03-03", or a bare year. UK day-first. A month or year on its own is
 * read as its last day, so "September 2026" is not stale until December.
 */
export function titleDate(title: string): TitleDate | null {
  const t = title || '';
  let m: RegExpExecArray | null;
  const numeric = new RegExp(DATE_NUMERIC_G.source, 'g');
  while ((m = numeric.exec(t)) !== null) {
    const d = utc(fullYear(m[3]), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    if (d) return { date: d, text: m[0] };
  }
  const isoRe = new RegExp(DATE_ISO_G.source, 'g');
  while ((m = isoRe.exec(t)) !== null) {
    const d = utc(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    if (d) return { date: d, text: m[0] };
  }
  const dmy = new RegExp(DATE_DAY_MONTH_YEAR_G.source, 'gi');
  while ((m = dmy.exec(t)) !== null) {
    const d = utc(fullYear(m[3]), monthIndex(m[2]), parseInt(m[1], 10));
    if (d) return { date: d, text: m[0] };
  }
  const my = new RegExp(DATE_MONTH_YEAR_G.source, 'gi');
  if ((m = my.exec(t)) !== null) {
    const y = parseInt(m[2], 10);
    const mi = monthIndex(m[1]);
    return { date: new Date(Date.UTC(y, mi, daysIn(y, mi))), text: m[0] };
  }
  const year = t.match(/\b(20\d{2})\b/);
  if (year) {
    const y = parseInt(year[1], 10);
    return { date: new Date(Date.UTC(y, 11, 31)), text: year[1] };
  }
  return null;
}

/** The month a document was uploaded, from a WordPress-style path (/wp-content/uploads/2020/05/...). */
export function uploadDate(url: string | null | undefined): TitleDate | null {
  if (!url) return null;
  const m = url.match(UPLOAD_PATH_RE);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10) - 1;
  if (mi < 0 || mi > 11) return null;
  return { date: new Date(Date.UTC(y, mi, daysIn(y, mi))), text: `uploaded ${MONTHS[mi]} ${y}` };
}

export const STALE_DOCUMENT_DAYS = 60;

function formatUk(d: Date): string {
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${d.getUTCDate()} ${names[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Why a website document is too old to be a new vacancy, or null. The title's
 * own date wins; the upload path is used only when the title carries none.
 */
export function staleDocumentReason(title: string, url: string | null | undefined, today: Date, maxDays: number = STALE_DOCUMENT_DAYS, lastModified?: string | null): string | null {
  let found = titleDate(title) ?? uploadDate(url);
  if (!found && lastModified) {
    const d = new Date(lastModified + (lastModified.length === 10 ? 'T00:00:00Z' : ''));
    if (!Number.isNaN(d.getTime())) found = { date: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), text: `last changed ${lastModified.slice(0, 10)}` };
  }
  if (!found) return null;
  const ageDays = Math.floor((Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - found.date.getTime()) / 86400000);
  if (ageDays <= maxDays) return null;
  return `dated ${found.text} (${formatUk(found.date)}), more than ${maxDays} days old`;
}

/** True when the title or the upload path carries a date at all. */
export function hasDateEvidence(title: string, url: string | null | undefined): boolean {
  return !!(titleDate(title) ?? uploadDate(url));
}

// --- Near-identical titles ---------------------------------------------------

/** Acronyms that are part of a post name and must not be read as a company's initials. */
const KNOWN_ACRONYMS = new Set(['SDR', 'BDR', 'AE', 'AM', 'CSM', 'PM', 'PMM', 'TPM', 'EM', 'SRE', 'QA', 'ML', 'AI', 'UX', 'UI', 'UR', 'PA', 'EA', 'HR', 'HRBP', 'TA', 'L&D', 'CEO', 'CTO', 'COO', 'CFO', 'CMO', 'CRO', 'CPO', 'CISO', 'VP', 'SVP', 'EVP', 'GM', 'MD', 'IT', 'SEO', 'PR', 'CRM', 'FP&A', 'KYC', 'AML', 'MLRO', 'DBA', 'IOS', 'API', 'SDK', 'R&D', 'B2B', 'B2C', 'SMB', 'SME', 'UK', 'US', 'USA', 'EU', 'EMEA', 'APAC', 'DACH', 'FTE', 'FTC', 'GTM', 'OPS', 'BI', 'ETL', 'RPA', 'ERP', 'SAP', 'AWS', 'GCP', 'JS', 'PHP', 'NET', 'GO']);

const SYNONYMS: Array<[RegExp, string]> = [
  [/\bsales development representatives?\b|\bsdrs?\b/g, 'sdr'],
  [/\bbusiness development representatives?\b|\bbdrs?\b/g, 'bdr'],
  [/\baccount executives?\b|\baes?\b/g, 'accountexecutive'],
  [/\bcustomer success managers?\b|\bcsms?\b/g, 'csm'],
  [/\bsoftware (?:development )?engineers?\b|\bsoftware developers?\b|\bsdes?\b/g, 'softwareengineer'],
  [/\bfull[ -]?stack\b/g, 'fullstack'],
  [/\bfront[ -]?end\b/g, 'frontend'],
  [/\bback[ -]?end\b/g, 'backend'],
  [/\bmachine learning\b|\bml\b/g, 'machinelearning'],
  [/\bartificial intelligence\b|\bai\b/g, 'ai'],
  [/\buser experience\b|\bux\b/g, 'ux'],
  [/\bproduct managers?\b|\bpms?\b/g, 'productmanager'],
  [/\btalent acquisition\b|\bta\b|\brecruit(?:ing|ment)\b/g, 'recruiting'],
  [/\bpeople operations\b|\bpeople ops\b/g, 'peopleops'],
  [/\bhuman resources\b|\bhr\b/g, 'hr'],
  [/\bexecutive assistants?\b|\beas?\b|\bpersonal assistants?\b|\bpas?\b/g, 'ea'],
  [/\bco ?ordinators?\b/g, 'coordinator'],
  [/\bsr\.?\b/g, 'senior'],
  [/\bjr\.?\b/g, 'junior'],
  [/\bvice president\b/g, 'vp'],
  [/\bunited kingdom\b/g, 'uk'],
];

const FILLER = new Set(['a', 'an', 'the', 'of', 'for', 'to', 'in', 'at', 'with', 'x', 'role', 'roles', 'post', 'posts', 'vacancy', 'vacancies', 'position', 'positions', 'required', 'wanted', 'needed', 'job', 'jobs', 'opportunity', 'pdf', 'doc', 'docx', 'word', 'document', 'our', 'we', 'are', 'hiring', 'start', 'from', 'asap', 'immediate', 'closing', 'date', 'dates', 'deadline', 'apply', 'by', 'applications', 'close', 'closes', 'now', 'open', 'new']);

export interface PostKey {
  tokens: string[];
  truncated: boolean;
}

/** Tokens that identify the post a title is about, order-free. */
export function postKey(title: string): PostKey {
  const { post, cut } = classifyDocument(title);
  const truncated = /(?:\.{3,}|…)\s*$/.test(title || '');
  // A company's own initials ("ANL", "HWS") are noise; a role acronym is not.
  let s = post.replace(/\b[A-Z][A-Z&]{1,3}\b/g, (w) => (KNOWN_ACRONYMS.has(w) ? w : ' '));
  s = s.toLowerCase().replace(/[‘’']/g, '');
  s = s.replace(/&/g, ' and ');
  for (const [re, to] of SYNONYMS) s = s.replace(re, to);
  s = s.replace(/[^a-z0-9]+/g, ' ');
  let tokens = s.split(' ').filter((w) => w && !FILLER.has(w) && w !== 'and');
  tokens = tokens.map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
  if (cut && tokens.length > 1) tokens = tokens.slice(0, -1); // the last token may be cut short
  return { tokens: Array.from(new Set(tokens)).sort(), truncated };
}

/** Are these two titles, at the same company in the same run, the same post? */
export function samePost(a: string, b: string): boolean {
  const ka = postKey(a);
  const kb = postKey(b);
  if (ka.tokens.length === 0 || kb.tokens.length === 0) return false;
  const sa = new Set(ka.tokens);
  const sb = new Set(kb.tokens);
  const shared = ka.tokens.filter((t) => sb.has(t)).length;
  if (shared === sa.size && shared === sb.size) return true;
  if (ka.truncated && shared === sa.size) return true;
  if (kb.truncated && shared === sb.size) return true;
  const union = sa.size + sb.size - shared;
  return union >= 4 && shared / union >= 0.8;
}
