import { assertEquals } from './test-assert.ts';
import { findClosingDateInText, formatIsoDateUk, parseUkDate } from './dates.ts';

const today = new Date(Date.UTC(2026, 8, 7)); // 7 September 2026

Deno.test('dd/mm/yyyy is day-first', () => {
  assertEquals(parseUkDate('05/09/2026', today), '2026-09-05');
  assertEquals(parseUkDate('18/07/2026', today), '2026-07-18');
  assertEquals(parseUkDate('Closing date: 30/06/2026', today), '2026-06-30');
});

Deno.test('dash and dot separators', () => {
  assertEquals(parseUkDate('05-09-2026', today), '2026-09-05');
  assertEquals(parseUkDate('05.09.2026', today), '2026-09-05');
});

Deno.test('two-digit years', () => {
  assertEquals(parseUkDate('05/09/26', today), '2026-09-05');
  assertEquals(parseUkDate('4 Jul 26', today), '2026-07-04');
});

Deno.test('long forms', () => {
  assertEquals(parseUkDate('18 July 2026', today), '2026-07-18');
  assertEquals(parseUkDate('18th July 2026', today), '2026-07-18');
  assertEquals(parseUkDate('Friday 4 July 2026', today), '2026-07-04');
  assertEquals(parseUkDate('Friday, 4th July 2026', today), '2026-07-04');
  assertEquals(parseUkDate('Thursday 10 September 2026 at 9.00am', today), '2026-09-10');
  assertEquals(parseUkDate('Apply by noon on 4 July 2026', today), '2026-07-04');
  assertEquals(parseUkDate('July 18, 2026', today), '2026-07-18');
  assertEquals(parseUkDate('Sept 14 2026', today), '2026-09-14');
});

Deno.test('ISO strings', () => {
  assertEquals(parseUkDate('2026-09-24', today), '2026-09-24');
  assertEquals(parseUkDate('2026-09-24T23:59:00+01:00', today), '2026-09-24');
});

Deno.test('no-year dates take the nearest future occurrence', () => {
  assertEquals(parseUkDate('18 May', today), '2027-05-18');
  assertEquals(parseUkDate('noon on 4 October', today), '2026-10-04');
  assertEquals(parseUkDate('18th September', today), '2026-09-18');
  // A date that passed within the last two months stays this year (it will be dropped as expired)
  assertEquals(parseUkDate('1 September', today), '2026-09-01');
  assertEquals(parseUkDate('18 July', today), '2026-07-18');
});

Deno.test('month-only maps by mode', () => {
  assertEquals(parseUkDate('July 2026', today), '2026-07-31');
  assertEquals(parseUkDate('July 2026', today, { mode: 'start' }), '2026-07-01');
  assertEquals(parseUkDate('September 2026', today, { mode: 'start' }), '2026-09-01');
  assertEquals(parseUkDate('February 2027', today), '2027-02-28');
});

Deno.test('non-dates return null', () => {
  assertEquals(parseUkDate('ASAP', today), null);
  assertEquals(parseUkDate('Unknown (no date in advert text)', today), null);
  assertEquals(parseUkDate('None', today), null);
  assertEquals(parseUkDate('', today), null);
  assertEquals(parseUkDate('the successful candidate may start', today), null);
  assertEquals(parseUkDate('Term 2025', today), null);
  assertEquals(parseUkDate('31/02/2026', today), null);
});

Deno.test('formatIsoDateUk', () => {
  assertEquals(formatIsoDateUk('2026-07-04'), 'Sat 4 Jul 2026');
  assertEquals(formatIsoDateUk('2026-09-07'), 'Mon 7 Sep 2026');
});

Deno.test('findClosingDateInText picks the labelled date', () => {
  const text = 'Teacher of Maths. Start date: September 2026. Closing date: Friday 18th September 2026 at 9am. Interviews week commencing 21 September.';
  assertEquals(findClosingDateInText(text, today), '2026-09-18');
  assertEquals(findClosingDateInText('Apply by 05/09/2026', today), '2026-09-05');
  assertEquals(findClosingDateInText('Applications close 12 noon on 30 September', today), '2026-09-30');
  assertEquals(findClosingDateInText('Welcome to our company newsletter', today), null);
});

Deno.test('findClosingDateInText does not stop at a full stop', () => {
  assertEquals(findClosingDateInText('Closing date: 12.09.2026', today), '2026-09-12');
  assertEquals(findClosingDateInText('Closing date: 9.00am on Friday 12 September 2026', today), '2026-09-12');
  assertEquals(findClosingDateInText('Deadline: Sept. 12, 2026', today), '2026-09-12');
  assertEquals(findClosingDateInText('Closing date: 12 noon, 18.9.26. Interviews: 22 September 2026.', today), '2026-09-18');
  assertEquals(findClosingDateInText('Teacher of Art. Closing date: Monday 14 September 2026. Start date: January 2027.', today), '2026-09-14');
});
