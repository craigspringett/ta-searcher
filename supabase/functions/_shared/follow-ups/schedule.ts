// When each follow-up step is due (Follow-ups slice 2, docs/FOLLOW-UPS-BRIEF.md,
// Craig's answers of 17 September 2026). Pure and tested; the follow-ups
// function stores what this works out and the tick marks steps due.
//
// Every time here is Europe/London. The rules, in the order they apply:
//   * the default plan is days 0, 4, 8 and 14 from the day the sequence
//     starts: call then email on day 0, email on day 4, call on day 8,
//     email on day 14 (plan.ts);
//   * an email is never due before 09:30 or after 17:00; a plain weekday
//     email is due at 14:00, a call at 10:00;
//   * never a Monday morning: anything landing on a Monday before 12:00
//     moves to 12:00;
//   * a weekend moves to the next working day (Monday, then the Monday rule);
//   * an email falling on a Thursday or Friday goes out on the Friday at
//     13:30 (the 13:30 to 15:30 window Craig asked for), except the day 0
//     email, which is "the same afternoon" as the call and stays put;
//   * the day 0 email is due at 14:00 that day, or straight away when the
//     sequence starts later than that; started after 17:00, it waits for
//     09:30 the next working day;
//   * a holiday week (half-term) is skipped when the caller passes one
//     (holidayWeeks: the Monday of each week, ISO). There is no company_terms
//     table today, so nothing passes any: the rule is wired and idle;
//   * steps keep their order: a step never falls due before the one before it.
// Steps are due, not automatic: an email step becomes ready to approve with
// its draft, a call step becomes a to-do.

export const EMAIL_EARLIEST = { hour: 9, minute: 30 };
export const EMAIL_LATEST = { hour: 17, minute: 0 };
export const EMAIL_TIME = { hour: 14, minute: 0 };
export const CALL_TIME = { hour: 10, minute: 0 };
export const MONDAY_EARLIEST = { hour: 12, minute: 0 };
export const FRIDAY_TIME = { hour: 13, minute: 30 };
export const FRIDAY_WINDOW_END = { hour: 15, minute: 30 };

export const LONDON = 'Europe/London';

export interface LondonTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 Sunday to 6 Saturday. */
  weekday: number;
}

const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: LONDON, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The London wall-clock reading of an instant. */
export function londonTime(d: Date): LondonTime {
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) parts[p.type] = p.value;
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) % 24, minute: Number(parts.minute), weekday: WEEKDAYS.indexOf(parts.weekday) };
}

/** The instant at which a London wall-clock time happens (BST or GMT as the date requires). */
export function londonInstant(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (t: number) => { const l = londonTime(new Date(t)); return Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute) - t; };
  let t = guess - offsetAt(guess);
  // Around a clock change the first guess can be an hour out; one more pass settles it.
  if (offsetAt(t) !== guess - t) t = guess - offsetAt(t);
  return new Date(t);
}

/** The London calendar date of an instant, "YYYY-MM-DD". */
export function londonDate(d: Date): string {
  const l = londonTime(d);
  return `${l.year}-${String(l.month).padStart(2, '0')}-${String(l.day).padStart(2, '0')}`;
}

function addDays(l: LondonTime, days: number): { year: number; month: number; day: number } {
  const t = new Date(Date.UTC(l.year, l.month - 1, l.day + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

function weekdayOf(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function at(date: { year: number; month: number; day: number }, time: { hour: number; minute: number }): Date {
  return londonInstant(date.year, date.month, date.day, time.hour, time.minute);
}

function minutes(t: { hour: number; minute: number }): number {
  return t.hour * 60 + t.minute;
}

/** The Monday (ISO date) of the week a London date falls in. */
export function mondayOf(y: number, m: number, d: number): string {
  const wd = weekdayOf(y, m, d);
  const back = wd === 0 ? 6 : wd - 1;
  const t = new Date(Date.UTC(y, m - 1, d - back));
  return t.toISOString().slice(0, 10);
}

export interface ScheduleOptions {
  /** Half-term and holiday weeks to skip: the Monday of each week, ISO date. None today (no company_terms table). */
  holidayWeeks?: string[];
}

function isHolidayWeek(date: { year: number; month: number; day: number }, opts: ScheduleOptions): boolean {
  return (opts.holidayWeeks || []).includes(mondayOf(date.year, date.month, date.day));
}

/** The next day that is a weekday and not in a holiday week (the day itself when it already is). */
function nextWorkingDay(date: { year: number; month: number; day: number }, opts: ScheduleOptions): { year: number; month: number; day: number } {
  let d = date;
  for (let i = 0; i < 60; i++) {
    const wd = weekdayOf(d.year, d.month, d.day);
    if (wd !== 0 && wd !== 6 && !isHolidayWeek(d, opts)) return d;
    d = addDays({ ...d, hour: 0, minute: 0, weekday: wd }, 1);
  }
  return d;
}

/**
 * When a step on day N (N > 0) is due. The nominal day is the start day
 * plus N in London; then the weekend, holiday, Thursday/Friday and Monday
 * rules above.
 */
export function dueOnDay(startedAt: Date, day: number, kind: 'call' | 'email', opts: ScheduleOptions = {}): Date {
  const start = londonTime(startedAt);
  let date = nextWorkingDay(addDays(start, day), opts);
  let time = kind === 'email' ? EMAIL_TIME : CALL_TIME;
  let wd = weekdayOf(date.year, date.month, date.day);
  if (kind === 'email' && wd === 4) {
    // Thursday: prefer the Friday afternoon, unless the Friday is a holiday.
    const friday = addDays({ ...date, hour: 0, minute: 0, weekday: wd }, 1);
    if (!isHolidayWeek(friday, opts)) { date = friday; wd = 5; }
  }
  if (kind === 'email' && wd === 5) time = FRIDAY_TIME;
  if (wd === 1 && minutes(time) < minutes(MONDAY_EARLIEST)) time = MONDAY_EARLIEST;
  return at(date, time);
}

/**
 * The day 0 email: the same afternoon as the call. 14:00 that day, or now
 * when the sequence starts later than that; after 17:00 it waits for 09:30
 * the next working day. Never a Monday morning.
 */
export function dueSameAfternoon(startedAt: Date, opts: ScheduleOptions = {}): Date {
  const start = londonTime(startedAt);
  const today = { year: start.year, month: start.month, day: start.day };
  const startMinutes = start.hour * 60 + start.minute;
  const workingToday = nextWorkingDay(today, opts);
  const sameDay = workingToday.day === today.day && workingToday.month === today.month && workingToday.year === today.year;
  if (sameDay && startMinutes <= minutes(EMAIL_LATEST)) {
    let time = startMinutes < minutes(EMAIL_TIME) ? EMAIL_TIME : { hour: start.hour, minute: start.minute };
    if (start.weekday === 1 && minutes(time) < minutes(MONDAY_EARLIEST)) time = MONDAY_EARLIEST;
    return at(today, time);
  }
  // Too late today (or a weekend or holiday): the next working day, first thing.
  const next = nextWorkingDay(addDays(start, sameDay ? 1 : 0), opts);
  const time = weekdayOf(next.year, next.month, next.day) === 1 ? MONDAY_EARLIEST : EMAIL_EARLIEST;
  return at(next, time);
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Friday 18 Sep 13:30" in London time, for the plan the consultant sees (a fixed list, because ICU writes "Sept"). */
export function describeDue(d: Date): string {
  const l = londonTime(d);
  return `${DAY_NAMES[l.weekday]} ${l.day} ${MONTHS[l.month - 1]} ${String(l.hour).padStart(2, '0')}:${String(l.minute).padStart(2, '0')}`;
}

/** Is an instant inside the email window (09:30 to 17:00 London, not a weekend, not a Monday morning)? For the tick's sanity check. */
export function inEmailWindow(d: Date): boolean {
  const l = londonTime(d);
  const m = l.hour * 60 + l.minute;
  if (l.weekday === 0 || l.weekday === 6) return false;
  if (m < minutes(EMAIL_EARLIEST) || m > minutes(EMAIL_LATEST)) return false;
  if (l.weekday === 1 && m < minutes(MONDAY_EARLIEST)) return false;
  return true;
}
