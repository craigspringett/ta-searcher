// UK-first date parsing for vacancy adverts.
//
// Every date that reaches the alert pipeline goes through parseUkDate so that
// "05/09/2026" is 5 September, never 9 May. `new Date(string)` is deliberately
// never used to decide day/month order.

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const MONTH_ALT = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec';
const DAY_NAMES = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)\b\.?,?/gi;

export type DateMode = 'closing' | 'start';

export interface ParseUkDateOptions {
  /** Month-only strings map to the last day of the month for closing dates, first day for start dates. */
  mode?: DateMode;
}

/** Days in the past within which a no-year date is still taken to be this year. */
const NO_YEAR_LOOKBACK_DAYS = 60;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function toIsoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function todayIso(today: Date = new Date()): string {
  return toIsoDate(today);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validDay(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function normaliseYear(y: string): number {
  const n = parseInt(y, 10);
  if (y.length <= 2) return 2000 + n;
  return n;
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Strip prefixes, times, ordinals and day names so only the date tokens remain. */
export function cleanDateText(input: string): string {
  let s = input
    .replace(/&nbsp;| /g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[–—]/g, '-')
    .toLowerCase();
  s = s.replace(/\b(closing date|closing|apply by|applications? (?:close|by|deadline)|deadline|end date|closes?|expires?|due)\b\s*[:\-]?\s*/g, ' ');
  s = s.replace(/\b(at|by|on|noon|midday|midnight)\b/g, ' ');
  s = s.replace(/\b\d{1,2}([:.]\d{2})?\s*(am|pm)\b/g, ' ');
  s = s.replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' ');
  s = s.replace(DAY_NAMES, ' ');
  s = s.replace(/(\d)(st|nd|rd|th)\b/g, '$1');
  s = s.replace(/\bof\b/g, ' ');
  s = s.replace(/[,]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Parse a UK-formatted date phrase into ISO `YYYY-MM-DD`.
 * Returns null when no confident date is present.
 */
export function parseUkDate(
  input: string | null | undefined,
  today: Date = new Date(),
  options: ParseUkDateOptions = {},
): string | null {
  if (!input || typeof input !== 'string') return null;
  const mode: DateMode = options.mode ?? 'closing';
  const raw = input.trim();
  if (!raw) return null;

  // ISO first: 2026-09-05 or 2026-09-05T23:59:00+01:00
  const isoMatch = raw.match(/\b(20\d{2})-(\d{2})-(\d{2})(?:[T\s]|$)/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10), m = parseInt(isoMatch[2], 10), d = parseInt(isoMatch[3], 10);
    if (validDay(y, m, d)) return iso(y, m, d);
  }

  const s = cleanDateText(raw);
  if (!s) return null;

  // dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, with 2- or 4-digit year
  const numeric = s.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})\b/);
  if (numeric) {
    const d = parseInt(numeric[1], 10), m = parseInt(numeric[2], 10), y = normaliseYear(numeric[3]);
    if (validDay(y, m, d)) return iso(y, m, d);
    return null;
  }

  // "18 july 2026", "4 jul 26"
  const dmy = s.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_ALT})\\.?\\s+(\\d{4}|\\d{2})\\b`));
  if (dmy) {
    const d = parseInt(dmy[1], 10), m = MONTHS[dmy[2]], y = normaliseYear(dmy[3]);
    if (validDay(y, m, d)) return iso(y, m, d);
    return null;
  }

  // "july 18 2026" (US style, seen on some boards)
  const mdy = s.match(new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})\\s+(\\d{4})\\b`));
  if (mdy) {
    const m = MONTHS[mdy[1]], d = parseInt(mdy[2], 10), y = parseInt(mdy[3], 10);
    if (validDay(y, m, d)) return iso(y, m, d);
    return null;
  }

  // "18 july" (no year): nearest future occurrence, allowing a short look-back
  const dm = s.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_ALT})\\b`));
  const md = dm ? null : s.match(new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})\\b(?!\\s*[\\/\\-.]\\d)`));
  if (dm || md) {
    const d = parseInt(dm ? dm[1] : md![2], 10);
    const m = MONTHS[dm ? dm[2] : md![1]];
    return resolveNoYear(d, m, today);
  }

  // "july 2026" (month only)
  const my = s.match(new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(\\d{4})\\b`));
  if (my) {
    const m = MONTHS[my[1]], y = parseInt(my[2], 10);
    return mode === 'start' ? iso(y, m, 1) : iso(y, m, daysInMonth(y, m));
  }

  return null;
}

function resolveNoYear(day: number, month: number, today: Date): string | null {
  const y = today.getUTCFullYear();
  if (!validDay(y, month, day) && !validDay(y + 1, month, day)) return null;
  const thisYear = Date.UTC(y, month - 1, day);
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const diffDays = (thisYear - todayUtc) / 86400000;
  if (diffDays >= -NO_YEAR_LOOKBACK_DAYS) {
    return validDay(y, month, day) ? iso(y, month, day) : null;
  }
  return validDay(y + 1, month, day) ? iso(y + 1, month, day) : null;
}

/** Compare two ISO dates. Returns true when `isoDate` is strictly before `today`. */
export function isPastIso(isoDate: string | null | undefined, today: Date = new Date()): boolean {
  if (!isoDate) return false;
  return isoDate < toIsoDate(today);
}

/** Format an ISO date as `Fri 4 Jul 2026` for emails. */
export function formatIsoDateUk(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate;
  const d = new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Find the first parseable closing date in a block of text near a vacancy
 * title. Looks for phrases such as "closing date", "apply by", "deadline" and
 * parses the text that follows them; falls back to any date in the text.
 */
export function findClosingDateInText(text: string, today: Date = new Date()): string | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, ' ');
  // The capture runs to a pipe or line break, not a full stop: dates are
  // written "12.09.2026", "9.00am on Friday 12 September" and "Sept. 12".
  const labelled = /\b(closing date|closing|apply by|applications? (?:close|by|deadline)|deadline|closes|expires)\b[^0-9a-z]{0,20}([^|\n]{0,80})/gi;
  let m: RegExpExecArray | null;
  while ((m = labelled.exec(t)) !== null) {
    const parsed = parseUkDate(m[2], today, { mode: 'closing' });
    if (parsed) return parsed;
  }
  return null;
}
