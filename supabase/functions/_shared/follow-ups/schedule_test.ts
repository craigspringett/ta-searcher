import { assert, assertEquals } from '../test-assert.ts';
import { buildPlan, DEFAULT_PLAN } from './plan.ts';
import { describeDue, dueOnDay, dueSameAfternoon, inEmailWindow, londonDate, londonInstant, londonTime, mondayOf } from './schedule.ts';

// September 2026 (BST, UTC+1): Mon 14, Tue 15, Wed 16, Thu 17, Fri 18, Sat 19, Sun 20, Mon 21.
const london = (iso: string) => {
  const l = londonTime(new Date(iso));
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][l.weekday]} ${l.year}-${String(l.month).padStart(2, '0')}-${String(l.day).padStart(2, '0')} ${String(l.hour).padStart(2, '0')}:${String(l.minute).padStart(2, '0')}`;
};

Deno.test('London wall-clock time round-trips through BST and GMT', () => {
  assertEquals(londonTime(new Date('2026-09-17T13:00:00Z')).hour, 14, 'BST is an hour ahead of UTC');
  assertEquals(londonTime(new Date('2026-12-17T13:00:00Z')).hour, 13, 'GMT is UTC');
  assertEquals(londonInstant(2026, 9, 17, 14, 0).toISOString(), '2026-09-17T13:00:00.000Z');
  assertEquals(londonInstant(2026, 12, 17, 14, 0).toISOString(), '2026-12-17T14:00:00.000Z');
  assertEquals(londonDate(new Date('2026-09-16T23:30:00Z')), '2026-09-17', 'half past midnight BST is already the 17th');
  assertEquals(mondayOf(2026, 9, 17), '2026-09-14');
  assertEquals(mondayOf(2026, 9, 20), '2026-09-14', 'Sunday belongs to the week before');
  // The clock change: 25 October 2026, 01:00 UTC. 14:00 the day after is GMT.
  assertEquals(londonInstant(2026, 10, 26, 14, 0).toISOString(), '2026-10-26T14:00:00.000Z');
  assertEquals(londonInstant(2026, 10, 24, 14, 0).toISOString(), '2026-10-24T13:00:00.000Z');
});

Deno.test('a plain weekday email is due at 14:00, a call at 10:00', () => {
  const start = new Date('2026-09-14T09:00:00Z'); // Monday 10:00 BST
  assertEquals(london(dueOnDay(start, 1, 'email').toISOString()), 'Tue 2026-09-15 14:00');
  assertEquals(london(dueOnDay(start, 2, 'call').toISOString()), 'Wed 2026-09-16 10:00');
});

Deno.test('a weekend rolls to Monday, and Monday is never before 12:00', () => {
  const start = new Date('2026-09-16T09:00:00Z'); // Wednesday
  // Day 4 is Sunday 20th: Monday 21st. An email at 14:00 is already past noon.
  assertEquals(london(dueOnDay(start, 4, 'email').toISOString()), 'Mon 2026-09-21 14:00');
  // A call at 10:00 on a Monday moves to 12:00.
  assertEquals(london(dueOnDay(start, 4, 'call').toISOString()), 'Mon 2026-09-21 12:00');
  // Day 3 is Saturday 19th: Monday too.
  assertEquals(london(dueOnDay(start, 3, 'call').toISOString()), 'Mon 2026-09-21 12:00');
});

Deno.test('an email on a Thursday or Friday prefers Friday 13:30; a call keeps its day', () => {
  const start = new Date('2026-09-14T09:00:00Z'); // Monday
  assertEquals(london(dueOnDay(start, 3, 'email').toISOString()), 'Fri 2026-09-18 13:30', 'Thursday moves to Friday');
  assertEquals(london(dueOnDay(start, 4, 'email').toISOString()), 'Fri 2026-09-18 13:30', 'Friday at the window start');
  assertEquals(london(dueOnDay(start, 3, 'call').toISOString()), 'Thu 2026-09-17 10:00');
  assertEquals(london(dueOnDay(start, 4, 'call').toISOString()), 'Fri 2026-09-18 10:00');
});

Deno.test('the day 0 email is the same afternoon, or first thing the next working day', () => {
  assertEquals(london(dueSameAfternoon(new Date('2026-09-15T09:00:00Z')).toISOString()), 'Tue 2026-09-15 14:00', 'a morning start waits for the afternoon');
  assertEquals(london(dueSameAfternoon(new Date('2026-09-15T14:20:00Z')).toISOString()), 'Tue 2026-09-15 15:20', 'an afternoon start is due at once');
  assertEquals(london(dueSameAfternoon(new Date('2026-09-15T16:30:00Z')).toISOString()), 'Wed 2026-09-16 09:30', 'after 17:00 waits for 09:30 next day');
  assertEquals(london(dueSameAfternoon(new Date('2026-09-18T16:30:00Z')).toISOString()), 'Mon 2026-09-21 12:00', 'Friday evening waits for Monday noon');
  assertEquals(london(dueSameAfternoon(new Date('2026-09-19T10:00:00Z')).toISOString()), 'Mon 2026-09-21 12:00', 'a Saturday start goes to Monday noon');
  assertEquals(london(dueSameAfternoon(new Date('2026-09-14T09:00:00Z')).toISOString()), 'Mon 2026-09-14 14:00', 'a Monday morning start is due in the afternoon');
  assertEquals(london(dueSameAfternoon(new Date('2026-09-17T09:00:00Z')).toISOString()), 'Thu 2026-09-17 14:00', 'the day 0 email is not pushed to Friday');
});

Deno.test('a holiday week is skipped when one is given, and nothing is skipped by default', () => {
  const start = new Date('2026-10-19T09:00:00Z'); // Monday 19 October; half-term the week of the 26th
  assertEquals(london(dueOnDay(start, 8, 'email').toISOString()), 'Tue 2026-10-27 14:00', 'no holiday data: due as normal');
  const opts = { holidayWeeks: ['2026-10-26'] };
  assertEquals(london(dueOnDay(start, 8, 'email', opts).toISOString()), 'Mon 2026-11-02 14:00', 'moves to the Monday after half-term');
  assertEquals(london(dueOnDay(start, 3, 'email', opts).toISOString()), 'Fri 2026-10-23 13:30', 'the Friday before half-term is fine');
});

Deno.test('the default plan: email day 0, call day 2, email day 4, call day 8, email day 14, in order', () => {
  const plan = buildPlan(new Date('2026-09-15T09:00:00Z')); // Tuesday 15 September, 10:00
  assertEquals(plan.map((s) => `${s.stepNo} ${s.kind} d${s.day}`), ['1 email d0', '2 call d2', '3 email d4', '4 call d8', '5 email d14']);
  assertEquals(plan[0].kind, 'email', 'the first step of every run is an email (Craig, 18 September 2026)');
  assertEquals(plan.map((s) => london(s.dueAt)), [
    'Tue 2026-09-15 14:00',
    'Thu 2026-09-17 10:00',
    'Mon 2026-09-21 14:00', // day 4 is Saturday 19th
    'Wed 2026-09-23 10:00',
    'Tue 2026-09-29 14:00',
  ]);
  for (let i = 1; i < plan.length; i++) assert(plan[i].dueAt >= plan[i - 1].dueAt, 'steps stay in order');
  assertEquals(DEFAULT_PLAN.length, 5);
});

Deno.test('a plan started on a Monday puts the second email on the Friday afternoon', () => {
  const plan = buildPlan(new Date('2026-09-14T08:30:00Z')); // Monday 09:30
  assertEquals(london(plan[2].dueAt), 'Fri 2026-09-18 13:30'); // day 4 is Friday
  assertEquals(london(plan[3].dueAt), 'Tue 2026-09-22 10:00');
  assertEquals(london(plan[4].dueAt), 'Mon 2026-09-28 14:00');
});

Deno.test('a holiday can push a step past the next one; the order is kept', () => {
  const plan = buildPlan(new Date('2026-10-19T09:00:00Z'), { holidayWeeks: ['2026-10-26'] });
  for (let i = 1; i < plan.length; i++) assert(plan[i].dueAt >= plan[i - 1].dueAt, `step ${i + 1} is not before step ${i}`);
});

Deno.test('the email window and the plan wording', () => {
  assert(inEmailWindow(new Date('2026-09-15T13:00:00Z')), 'Tuesday 14:00');
  assert(!inEmailWindow(new Date('2026-09-14T09:00:00Z')), 'Monday 10:00');
  assert(!inEmailWindow(new Date('2026-09-15T16:30:00Z')), '17:30');
  assert(!inEmailWindow(new Date('2026-09-19T13:00:00Z')), 'Saturday');
  assertEquals(describeDue(new Date('2026-09-18T12:30:00Z')), 'Friday 18 Sep 13:30');
});
