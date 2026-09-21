import { assertEquals } from '../test-assert.ts';
import { findSameAdvert, mergeVacancies, persistVacancies, phaseMismatch } from './pipeline.ts';
import { fakeDb, fakeVacanciesDb } from './fake-supabase_test-helper.ts';

const today = new Date(Date.UTC(2026, 8, 7));

Deno.test('mergeVacancies dedupes across sources, drops blocked and expired, keeps one line per advert', () => {
  const out = mergeVacancies([
    { title: 'Teacher of Geography', url: 'https://www.tes.com/jobs/vacancy/teacher-of-geography-enfield-1', source: 'tes', closingDate: '2026-09-18' },
    { title: 'Teacher of Geography', url: 'https://teaching-vacancies.service.gov.uk/jobs/teacher-of-geography-abc', source: 'teaching_vacancies', closingDate: '2026-09-18' },
    { title: 'Teacher of Geography (posted on TES)', source: 'llm' },
    { title: 'Pastoral Support Officer', url: 'https://teaching-vacancies.service.gov.uk/jobs/pso', source: 'teaching_vacancies', closingDate: '2026-09-01' },
    { title: 'Lunchtime Supervisor', url: 'https://company.org/vacancies/lunch', source: 'company_website' },
    { title: 'Class Teacher (KS1)', url: 'https://company.org/vacancies', pageUrl: 'https://company.org/vacancies', source: 'company_website' },
  ], { phase: 'secondary' }, today);
  assertEquals(out.kept.map((v) => `${v.source}:${v.title}`), ['teaching_vacancies:Teacher of Geography']);
  const geo = out.kept[0];
  assertEquals(geo.sources.sort(), ['llm', 'teaching_vacancies', 'tes']);
  assertEquals(geo.url, 'https://teaching-vacancies.service.gov.uk/jobs/teacher-of-geography-abc');
  assertEquals(out.dropped.map((d) => d.reason).sort(), [
    'closing date 2026-09-01 has passed',
    'phase mismatch (company is secondary)',
    'role rule: catering, cleaning, grounds or transport role',
    'same title as teaching_vacancies listing',
    'same title as teaching_vacancies listing',
  ]);
});

Deno.test('mergeVacancies: a job description joins its advert as a document, guidance notes with no advert are dropped, the advert keeps the post name', () => {
  const site = (title: string, url: string, over: Record<string, any> = {}) => ({ title, url, pageUrl: 'https://wood.sch.uk/vacancies', source: 'company_website' as const, ...over });
  const out = mergeVacancies([
    site('Pastoral Leader Non Teaching Advert', 'https://cdn.example.com/caterham/uploads/document/Pastoral-Leader-Non-Teaching-Advert.pdf?t=1'),
    site('Pastoral Leader Non teaching Job Descrip...', 'https://cdn.example.com/caterham/uploads/document/Pastoral-Leader-Non-teaching-Job-Description.pdf?t=2', { document: 'job_description', post: 'Pastoral Leader Non teaching', closingDate: '2026-09-25' }),
    site('guidance notes for teachers', 'https://hws.haringey.sch.uk/wp-content/uploads/2020/05/Notes-for-Teachers.pdf', { document: 'guidance', post: 'teachers' }),
    site('Notes for Teachers', 'https://hws.haringey.sch.uk/wp-content/uploads/2021/03/Notes-for-Teachers.pdf', { document: 'guidance', post: 'Teachers' }),
    site('Company Business Manager (SBM)', 'https://hws.haringey.sch.uk/about-us/join-us/vacancies/', { pageUrl: 'https://hws.haringey.sch.uk/about-us/join-us/vacancies/' }),
  ], { phase: 'secondary' }, new Date(Date.UTC(2026, 8, 10)));
  assertEquals(out.kept.map((v) => v.title), ['Pastoral Leader Non Teaching', 'Company Business Manager (SBM)']);
  const advert = out.kept[0];
  assertEquals(advert.url, 'https://cdn.example.com/caterham/uploads/document/Pastoral-Leader-Non-Teaching-Advert.pdf?t=1');
  assertEquals(advert.closingDate, '2026-09-25', 'the closing date found beside the job description is kept');
  assertEquals((advert.raw as any).originalTitle, 'Pastoral Leader Non Teaching Advert');
  assertEquals((advert.raw as any).documents, [{ kind: 'job_description', title: 'Pastoral Leader Non teaching Job Descrip...', url: 'https://cdn.example.com/caterham/uploads/document/Pastoral-Leader-Non-teaching-Job-Description.pdf?t=2' }]);
  assertEquals(out.dropped.map((d) => `${d.title}: ${d.reason}`), [
    'guidance notes for teachers: dated uploaded may 2020 (31 May 2020), more than 60 days old',
    'Notes for Teachers: dated uploaded mar 2021 (31 March 2021), more than 60 days old',
    'Pastoral Leader Non teaching Job Descrip...: job description for "Pastoral Leader Non Teaching"',
  ]);
  // The same notes without an upload date are still not vacancies.
  const undated = mergeVacancies([
    site('guidance notes for teachers', 'https://hws.haringey.sch.uk/files/Notes-for-Teachers.pdf', { document: 'guidance', post: 'teachers' }),
    site('Teacher of Maths', 'https://hws.haringey.sch.uk/files/maths.pdf'),
  ], { phase: 'secondary' }, new Date(Date.UTC(2026, 8, 10)));
  assertEquals(undated.kept.map((v) => v.title), ['Teacher of Maths']);
  assertEquals(undated.dropped.map((d) => d.reason), ['guidance notes with no advert for the post']);
});

Deno.test('mergeVacancies: a website document dated more than 60 days ago is not a new vacancy; board titles with dates are untouched', () => {
  const out = mergeVacancies([
    { title: '03.03.26 Advert ANL Deputy Principal 2026', url: 'https://aim.example.com/uploads/document/03.03.26-Advert-ANL-Deputy-Principal-2026.pdf?t=1', source: 'company_website' },
    { title: '03.03.26 JD Deputy Principal ANL', url: 'https://aim.example.com/uploads/document/03.03.26-JD-Deputy-Principal-ANL.pdf?t=2', source: 'company_website', document: 'job_description', post: 'Deputy Principal ANL' },
    { title: 'Learning Support Assistant - Closing Date 11th September 2026', url: 'https://generationsmat.com/app/uploads/2026/08/Learning-Support-Assistant-August-2026.pdf', source: 'company_website' },
    { title: 'Teacher of Maths - September 2026', url: 'https://www.tes.com/jobs/vacancy/teacher-of-maths-1', source: 'tes' },
    { title: 'Class Teacher June 2026', url: 'https://teaching-vacancies.service.gov.uk/jobs/class-teacher-june-2026', source: 'teaching_vacancies' },
  ], { phase: 'secondary' }, new Date(Date.UTC(2026, 8, 10)));
  assertEquals(out.kept.map((v) => v.title), ['Class Teacher June 2026', 'Teacher of Maths - September 2026', 'Learning Support Assistant - Closing Date 11th September 2026']);
  assertEquals(out.dropped.map((d) => `${d.title}: ${d.reason}`), [
    '03.03.26 Advert ANL Deputy Principal 2026: dated 03.03.26 (3 March 2026), more than 60 days old',
    '03.03.26 JD Deputy Principal ANL: dated 03.03.26 (3 March 2026), more than 60 days old',
  ]);
});

Deno.test('mergeVacancies: near-identical titles for one company within a run are one line', () => {
  const out = mergeVacancies([
    { title: 'Head of Design Technology & Food', url: 'https://www.tes.com/jobs/vacancy/head-of-design-technology-and-food-london-2342170', source: 'tes', closingDate: '2026-09-18' },
    { title: 'Head of Food & DT - Required January 2027, Closing Date 18th September 2026', source: 'llm' },
    { title: 'Teacher of Maths', url: 'https://www.tes.com/jobs/vacancy/teacher-of-maths-2', source: 'tes' },
    { title: 'Maths Teacher', url: 'https://www.eteach.com/job/maths-teacher-1', source: 'eteach', closingDate: '2026-09-30' },
    { title: 'Teacher of Maths (Maternity Cover)', url: 'https://www.eteach.com/job/maths-teacher-mat-2', source: 'eteach' },
    { title: 'Class Teacher', url: 'https://company.org/vacancies/class-teacher.pdf', source: 'company_website' },
    { title: 'Class Teacher', url: 'https://mynewterm.com/jobs/1/EDV-2026-1', source: 'mynewterm' },
  ], { phase: 'secondary' }, new Date(Date.UTC(2026, 8, 10)));
  assertEquals(out.kept.map((v) => `${v.source}:${v.title}`), ['tes:Head of Design Technology & Food', 'tes:Teacher of Maths', 'company_website:Class Teacher', 'eteach:Teacher of Maths (Maternity Cover)']);
  const maths = out.kept.find((v) => v.title === 'Teacher of Maths')!;
  assertEquals(maths.sources, ['tes', 'eteach']);
  assertEquals(maths.closingDate, '2026-09-30');
  assertEquals((maths.raw as any).alsoSeenAt, ['https://www.eteach.com/job/maths-teacher-1']);
  assertEquals(out.dropped.map((d) => `${d.title}: ${d.reason}`), [
    'Class Teacher: same title as company_website listing',
    'Maths Teacher: near-identical to tes listing "Teacher of Maths"',
    'Head of Food & DT - Required January 2027, Closing Date 18th September 2026: near-identical to tes listing "Head of Design Technology & Food"',
  ]);
});

Deno.test('phaseMismatch', () => {
  assertEquals(phaseMismatch('EYFS Teacher', 'secondary'), true);
  assertEquals(phaseMismatch('Head of Sixth Form', 'primary'), true);
  assertEquals(phaseMismatch('Class Teacher', 'primary'), false);
  assertEquals(phaseMismatch('KS2 Teacher', 'all-through'), false);
});

const COMPANY = 'company-1';
const baseline = (over: Record<string, any> = {}) => ({
  id: 'base-geo', company_search_id: COMPANY, vacancy_key: 'title:teacher of geography', title: 'Teacher of Geography', url: null,
  source: 'llm', closing_date: null, start_text: null, first_seen: '2026-08-20', last_seen: '2026-09-06', status: 'open', raw: { backfill: true }, ...over,
});
const incomingGeo = (over: Record<string, any> = {}) => ({
  title: 'Teacher of Geography', url: 'https://teaching-vacancies.service.gov.uk/jobs/teacher-of-geography-abc', source: 'teaching_vacancies' as const,
  key: 'url:teaching-vacancies.service.gov.uk/jobs/teacher-of-geography-abc', sources: ['teaching_vacancies' as const], closingDate: '2026-09-18', ...over,
});

Deno.test('persistVacancies re-keys a baseline title row found with a URL, keeping first_seen', async () => {
  const db = fakeVacanciesDb([baseline()]);
  const open = await persistVacancies(db, [incomingGeo()], { companySearchId: COMPANY, today, degraded: false });
  assertEquals(db.rows().length, 1, 'no second row');
  assertEquals(open.map((v) => [v.key, v.firstSeen, v.lastSeen, v.url, v.status]), [
    ['url:teaching-vacancies.service.gov.uk/jobs/teacher-of-geography-abc', '2026-08-20', '2026-09-07', 'https://teaching-vacancies.service.gov.uk/jobs/teacher-of-geography-abc', 'open'],
  ]);
  assertEquals(db.rows()[0].raw.rekeyedFrom, 'title:teacher of geography');
});

Deno.test('persistVacancies re-keys an advert that moved boards and closes what is gone', async () => {
  const db = fakeVacanciesDb([
    baseline({ id: 'tv-geo', vacancy_key: 'url:teaching-vacancies.service.gov.uk/jobs/geo-1', url: 'https://teaching-vacancies.service.gov.uk/jobs/geo-1', source: 'teaching_vacancies' }),
    baseline({ id: 'tv-maths', vacancy_key: 'url:teaching-vacancies.service.gov.uk/jobs/maths-1', title: 'Teacher of Maths', url: 'https://teaching-vacancies.service.gov.uk/jobs/maths-1', first_seen: '2026-09-01' }),
  ]);
  const open = await persistVacancies(db, [incomingGeo({ url: 'https://www.tes.com/jobs/vacancy/teacher-of-geography-2', key: 'url:tes.com/jobs/vacancy/teacher-of-geography-2', source: 'tes', closingDate: null })], { companySearchId: COMPANY, today, degraded: false });
  assertEquals(db.rows().length, 2);
  assertEquals(open.map((v) => [v.id, v.key, v.firstSeen]), [['tv-geo', 'url:tes.com/jobs/vacancy/teacher-of-geography-2', '2026-08-20']]);
  assertEquals(db.rows().find((r) => r.id === 'tv-maths')!.status, 'closed');
});

Deno.test('persistVacancies keeps a rejected row rejected when the same advert reappears under a new key', async () => {
  const db = fakeVacanciesDb([baseline({ status: 'rejected' })]);
  const open = await persistVacancies(db, [incomingGeo()], { companySearchId: COMPANY, today, degraded: false });
  assertEquals(open, []);
  assertEquals(db.rows().map((r) => [r.vacancy_key, r.status]), [['url:teaching-vacancies.service.gov.uk/jobs/teacher-of-geography-abc', 'rejected']]);
});

Deno.test('persistVacancies still inserts a genuinely new advert and a re-advertised post with a different closing date', async () => {
  const db = fakeVacanciesDb([baseline({ closing_date: '2026-09-10' })]);
  const open = await persistVacancies(db, [incomingGeo({ closingDate: '2026-10-30' }), incomingGeo({ title: 'Teacher of Physics', url: 'https://teaching-vacancies.service.gov.uk/jobs/physics', key: 'url:teaching-vacancies.service.gov.uk/jobs/physics', closingDate: null })], { companySearchId: COMPANY, today, degraded: false });
  assertEquals(db.rows().length, 3);
  assertEquals(open.filter((v) => v.firstSeen === '2026-09-07').length, 2, 'both incoming rows are new');
  assertEquals(db.rows().find((r) => r.id === 'base-geo')!.status, 'closed', 'the old advert with the earlier closing date is closed');
});

Deno.test('findSameAdvert prefers open, then rejected, then the most recent closed row', () => {
  const rows: any[] = [
    baseline({ id: 'c1', status: 'closed', last_seen: '2026-08-01' }),
    baseline({ id: 'c2', status: 'closed', last_seen: '2026-08-15' }),
    baseline({ id: 'r1', status: 'rejected' }),
    baseline({ id: 'o1', status: 'open' }),
  ];
  assertEquals(findSameAdvert({ title: 'Teacher of Geography (posted on TES)' }, rows)!.id, 'o1');
  assertEquals(findSameAdvert({ title: 'Teacher of Geography' }, rows.filter((r) => r.id !== 'o1'))!.id, 'r1');
  assertEquals(findSameAdvert({ title: 'Teacher of Geography' }, rows.filter((r) => r.status === 'closed'))!.id, 'c2');
  assertEquals(findSameAdvert({ title: 'Teacher of History' }, rows), null);
});

Deno.test('a vacancy a consultant marked Closed stays closed for 30 days while still advertised, then is new again', async () => {
  const closedRow = baseline({ status: 'closed', rejected_reason: 'Consultant reported: closed', first_seen: '2026-07-01' });
  const recent = fakeDb({
    vacancies: [closedRow],
    vacancy_feedback: [{ vacancy_id: 'base-geo', kind: 'closed', created_at: '2026-08-20T09:00:00Z' }],
    alert_deliveries: [{ config_id: 'cfg-1', vacancy_id: 'base-geo' }],
  });
  const openRecent = await persistVacancies(recent, [incomingGeo()], { companySearchId: COMPANY, today, degraded: false });
  assertEquals(openRecent, [], 'still closed 18 days after the consultant said so');
  assertEquals(recent.rows().map((r) => [r.status, r.rejected_reason, r.first_seen]), [['closed', 'Consultant reported: closed', '2026-07-01']]);
  assertEquals(recent.rows('alert_deliveries').length, 1, 'deliveries kept');

  const old = fakeDb({
    vacancies: [closedRow],
    vacancy_feedback: [{ vacancy_id: 'base-geo', kind: 'closed', created_at: '2026-08-01T09:00:00Z' }],
    alert_deliveries: [{ config_id: 'cfg-1', vacancy_id: 'base-geo' }],
  });
  const openOld = await persistVacancies(old, [incomingGeo()], { companySearchId: COMPANY, today, degraded: false });
  assertEquals(openOld.map((v) => [v.id, v.firstSeen, v.status]), [['base-geo', '2026-09-07', 'open']], 'reopened as new after 30 days');
  assertEquals(old.rows()[0].rejected_reason, null);
  assertEquals(old.rows('alert_deliveries').length, 0, 'deliveries released so it is alerted again');
});

Deno.test('a vacancy closed by the pipeline for 30+ days is new again and its deliveries are released', async () => {
  const db = fakeDb({
    vacancies: [baseline({ status: 'closed', last_seen: '2026-07-20' })],
    alert_deliveries: [{ config_id: 'cfg-1', vacancy_id: 'base-geo' }],
  });
  const open = await persistVacancies(db, [incomingGeo()], { companySearchId: COMPANY, today, degraded: false });
  assertEquals(open.map((v) => [v.id, v.firstSeen]), [['base-geo', '2026-09-07']]);
  assertEquals(db.rows('alert_deliveries').length, 0);
});

Deno.test('persistVacancies on a run without the website closes only rows from the boards that answered, never website rows', async () => {
  const db = fakeVacanciesDb([
    baseline({ id: 'tv-geo', vacancy_key: 'url:teaching-vacancies.service.gov.uk/jobs/geo-1', url: 'https://teaching-vacancies.service.gov.uk/jobs/geo-1', source: 'teaching_vacancies' }),
    baseline({ id: 'tes-maths', vacancy_key: 'url:tes.com/jobs/vacancy/maths-1', title: 'Teacher of Maths', url: 'https://www.tes.com/jobs/vacancy/maths-1', source: 'tes' }),
    baseline({ id: 'site-ta', vacancy_key: 'url:company.org/vacancies/ta', title: 'Teaching Assistant', url: 'https://company.org/vacancies/ta', source: 'company_website' }),
  ]);
  // Homepage down; Teaching Vacancies answered (with a new listing), TES did not.
  const incoming = { title: 'Head of Science', url: 'https://teaching-vacancies.service.gov.uk/jobs/science-1', source: 'teaching_vacancies' as const,
    key: 'url:teaching-vacancies.service.gov.uk/jobs/science-1', sources: ['teaching_vacancies' as const], closingDate: '2026-09-30' };
  const open = await persistVacancies(db, [incoming], { companySearchId: COMPANY, today, degraded: true, closeSources: ['teaching_vacancies'] });
  const byId = Object.fromEntries(db.rows().map((r: any) => [r.id, r.status]));
  assertEquals(byId['tv-geo'], 'closed', 'a Teaching Vacancies row the board no longer lists is closed');
  assertEquals(byId['tes-maths'], 'open', 'TES did not answer, so its row stays');
  assertEquals(byId['site-ta'], 'open', 'the website was not read, so its row stays');
  assertEquals(open.map((v) => v.title).sort(), ['Head of Science', 'Teacher of Maths', 'Teaching Assistant']);
});

Deno.test('persistVacancies on a degraded run with no board answering writes nothing', async () => {
  const db = fakeVacanciesDb([baseline({ id: 'tv-geo', source: 'teaching_vacancies' })]);
  const open = await persistVacancies(db, [], { companySearchId: COMPANY, today, degraded: true, closeSources: [] });
  assertEquals(db.rows()[0].status, 'open');
  assertEquals(open.length, 1);
});
