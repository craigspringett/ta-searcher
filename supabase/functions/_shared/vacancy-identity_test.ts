import { assertEquals } from './test-assert.ts';
import { canonicalUrl, cleanTitle, normaliseTitle, vacancyKey } from './vacancy-identity.ts';

Deno.test('normaliseTitle strips source suffixes and entities', () => {
  assertEquals(normaliseTitle('Teacher of Maths (posted on TES)'), 'teacher of maths');
  assertEquals(normaliseTitle('Teacher of Maths (from company website)'), 'teacher of maths');
  assertEquals(normaliseTitle('Exam Invigilator (company website) (from company website)'), 'exam invigilator');
  assertEquals(normaliseTitle('Teaching Assistant (Gov Teaching Vacancies) (from company website)'), 'teaching assistant');
  assertEquals(normaliseTitle('Teacher of MFL - French &amp; Spanish (posted on TES)'), 'teacher of mfl french spanish');
  assertEquals(normaliseTitle("St Mary's  SENCO"), 'st marys senco');
  assertEquals(normaliseTitle('Teaching Assistant Role &#8211; September 2026'), 'teaching assistant role september 2026');
});

Deno.test('canonicalUrl', () => {
  assertEquals(canonicalUrl('https://www.TES.com/jobs/vacancy/teacher-southwark-2316104/?utm=1#top'), 'tes.com/jobs/vacancy/teacher-southwark-2316104');
  assertEquals(canonicalUrl('http://teaching-vacancies.service.gov.uk/jobs/abc'), 'teaching-vacancies.service.gov.uk/jobs/abc');
  assertEquals(canonicalUrl('not a url'), null);
  assertEquals(canonicalUrl(''), null);
});

Deno.test('vacancyKey prefers a direct URL, falls back to title', () => {
  assertEquals(vacancyKey({ title: 'Teacher of Maths', url: 'https://www.tes.com/jobs/vacancy/x-1?ref=2' }), 'url:tes.com/jobs/vacancy/x-1');
  assertEquals(vacancyKey({ title: 'Teacher of Maths (posted on TES)' }), 'title:teacher of maths');
  // Same advert from two sources with different wording of the suffix
  assertEquals(vacancyKey({ title: 'Teacher of Maths (posted on TES)' }), vacancyKey({ title: 'Teacher of Maths (from company website)' }));
  // A listing-page URL does not identify a single vacancy
  assertEquals(
    vacancyKey({ title: 'Class Teacher', url: 'https://company.org/vacancies/', pageUrl: 'https://company.org/vacancies' }),
    'title:class teacher',
  );
});

Deno.test('cleanTitle keeps the display title tidy', () => {
  assertEquals(cleanTitle('Teacher of Maths (posted on TES)'), 'Teacher of Maths');
  assertEquals(cleanTitle('Teacher of MFL - French &amp; Spanish'), 'Teacher of MFL - French & Spanish');
});
