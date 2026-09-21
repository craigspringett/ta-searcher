import { assertEquals } from '../test-assert.ts';
import { candidatePageUrls, extractTitlesFromPage, isVacancyPage, fileNameWords } from './source-company-website.ts';

const nav = `<nav><a href="/admissions">Admissions</a><a href="/subjects/mathematics">Mathematics</a><a href="/about/safeguarding">Safeguarding</a><a href="/curriculum/careers-destinations">Best-in-class careers provision</a><a href="/news/ark-teacher-training-graduation-2022">Ark Teacher Training Graduation 2022</a><a href="/news?field_category=134">Teaching at Ark</a></nav>`;

const vacanciesPage = `<html><head><title>Vacancies - Oak Primary Company</title></head><body>${nav}
<main><h1>Vacancies</h1>
<p>We are currently seeking to appoint the following staff.</p>
<h2>Class Teacher (KS2)</h2><p>Full-time, permanent. Start date: January 2027. Closing date: Friday 18th September 2026 at 9am.</p>
<a href="/vacancies/class-teacher-ks2/">Class Teacher (KS2)</a>
<a href="/wp-content/uploads/2026/09/Teaching-Assistant-JD.pdf">Teaching Assistant - Job Description</a>
<p>Apply by 05/10/2026.</p>
<h3>Lunchtime Supervisor</h3>
<a href="/news/new-headteacher-appointed">Headteacher appointed</a>
<a href="/jobs/working-for-us">Hear from our teachers</a>
<h2>Ark Teacher Training Graduation 2022</h2>
<h3>Teacher of Science</h3><p>Come and meet the team on our open evening.</p>
<strong>Welcome from the Headteacher</strong>
</main></body></html>`;

const careersPage = `<html><head><title>Careers - Oak Academy</title></head><body>${nav}<main><h1>Careers provision</h1><p>Our careers programme supports pupils with destinations and university pathways.</p></main></body></html>`;

Deno.test('isVacancyPage needs a vacancy signal and ignores pupil careers pages', () => {
  assertEquals(isVacancyPage(vacanciesPage, 'https://oak.sch.uk/vacancies'), true);
  assertEquals(isVacancyPage(careersPage, 'https://oak.sch.uk/careers'), false);
  assertEquals(isVacancyPage(`<html><body>${nav}<h1>Jobs</h1></body></html>`, 'https://oak.sch.uk/jobs'), false);
});

Deno.test('extractTitlesFromPage keeps roles and drops navigation, news and blocked roles', () => {
  const found = extractTitlesFromPage(vacanciesPage, 'https://oak.sch.uk/vacancies');
  const titles = found.map((f) => f.title).sort();
  assertEquals(titles, ['Class Teacher (KS2)', 'Teaching Assistant - Job Description']);
  const classTeacher = found.find((f) => f.title === 'Class Teacher (KS2)')!;
  assertEquals(classTeacher.url, 'https://oak.sch.uk/vacancies/class-teacher-ks2/');
  assertEquals(classTeacher.document, null);
  assertEquals(/Closing date: Friday 18th September 2026/.test(classTeacher.context), true);
  // The job description is carried as a document about the Teaching Assistant post, not as a vacancy.
  const jd = found.find((f) => f.title === 'Teaching Assistant - Job Description')!;
  assertEquals(jd.document, 'job_description');
  assertEquals(jd.post, 'Teaching Assistant');
  assertEquals(jd.url, 'https://oak.sch.uk/wp-content/uploads/2026/09/Teaching-Assistant-JD.pdf');
});

const documentsPage = `<html><head><title>Vacancies - Wood Company</title></head><body><main><h1>Vacancies</h1>
<p>We are seeking to appoint a Pastoral Leader. Closing date: 25 September 2026.</p>
<a href="/uploads/document/Pastoral-Leader-Non-Teaching-Advert.pdf">Pastoral Leader Non Teaching Advert</a>
<a href="/uploads/document/Pastoral-Leader-Non-teaching-Job-Description.pdf">Pastoral Leader Non teaching Job Descrip...</a>
<a href="/wp-content/uploads/2020/05/Notes-for-Teachers.pdf">guidance notes for teachers</a>
<a href="/wp-content/uploads/2021/03/Notes-for-Teachers.pdf">Notes for Teachers</a>
<a href="/uploads/document/03.03.26-Advert-ANL-Deputy-Principal-2026.pdf">03.03.26 Advert ANL Deputy Principal 2026</a>
<a href="/uploads/document/03.03.26-JD-Deputy-Principal-ANL.pdf">03.03.26 JD Deputy Principal ANL</a>
<a href="/uploads/document/Premises-Officer-JD.pdf">Premises Officer Job Description</a>
<a href="/about-us/join-us/working-at-wood/">Teacher support network</a>
</main></body></html>`;

Deno.test('extractTitlesFromPage: the 10 September lines come through as adverts and documents, never as pages or excluded roles', () => {
  const found = extractTitlesFromPage(documentsPage, 'https://wood.sch.uk/vacancies');
  assertEquals(found.map((f) => [f.title, f.document]), [
    ['Pastoral Leader Non Teaching Advert', null],
    ['Pastoral Leader Non teaching Job Descrip...', 'job_description'],
    ['guidance notes for teachers', 'guidance'],
    ['Notes for Teachers', 'guidance'],
    ['03.03.26 Advert ANL Deputy Principal 2026', null],
    ['03.03.26 JD Deputy Principal ANL', 'job_description'],
  ]);
});

Deno.test('candidatePageUrls resolves trust-hosted paths first', () => {
  const home = '<html><body><h1>Oak Academy</h1><a href="/oak-academy/vacancies">Vacancies</a></body></html>';
  const r = candidatePageUrls('https://trust.org/oak-academy', home, 'Oak Academy');
  assertEquals(r.trustHosted, true);
  assertEquals(r.rootAllowed, true);
  assertEquals(r.urls[0], 'https://trust.org/oak-academy/vacancies');
  const r2 = candidatePageUrls('https://trust.org/oak-academy', '<html><body>Trust home</body></html>', 'Oak Academy');
  assertEquals(r2.rootAllowed, false);
  assertEquals(r2.urls.every((u) => u.startsWith('https://trust.org/oak-academy/')), true);
});

Deno.test('the file name classifies a link whose text is only the role (teaching-assistant-jd-ba_v1.pdf is a job description)', () => {
  const words = fileNameWords('https://0e58658be539ee7325a0.ssl.cf3.rackcdn.com/berkley/uploads/document/2_218_teaching-assistant-jd-ba_v1.pdf');
  assertEquals(words, '2 218 teaching assistant jd ba v1');
  const html = '<html><body><h1>Jobs</h1><a href="https://cdn.example.com/berkley/uploads/document/2_218_teaching-assistant-jd-ba_v1.pdf">Teaching Assistant</a><a href="https://cdn.example.com/berkley/uploads/document/lsa-advert-sep-2026.pdf">LSA</a></body></html>';
  const found = extractTitlesFromPage(html, 'https://www.berkeleyacademy.org.uk/210/jobs-opportunities');
  const ta = found.find((f) => f.title === 'Teaching Assistant');
  assertEquals(ta?.document, 'job_description');
  const lsa = found.find((f) => f.title === 'LSA');
  assertEquals(lsa?.document ?? null, null);
});
