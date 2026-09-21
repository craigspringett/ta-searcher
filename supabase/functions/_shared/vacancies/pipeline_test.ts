import { assertEquals } from '../test-assert.ts';
import { collectBoardVacancies, collectVacancies, findSameAdvert, mergeVacancies, persistVacancies, SOURCE_LABELS, SOURCE_PRIORITY, summariseRun, toCurrentVacancies } from './pipeline.ts';
import { fakeDb, fakeVacanciesDb } from './fake-supabase_test-helper.ts';
import { fixture, stubFetch } from './fetch-stub_test-helper.ts';
import type { CompanyContext } from './types.ts';

const today = new Date(Date.UTC(2026, 8, 21));
const ctx: CompanyContext = { companySearchId: 'c1', companyNumber: '12345678', name: 'Searchable', aliases: ['Searchable Technologies Ltd'], url: 'https://searchable.ai', postcodeDistrict: 'EC1', record: null, boards: [{ provider: 'ashby', slug: 'searchable', boardUrl: 'https://jobs.ashbyhq.com/searchable' }] };

Deno.test('SOURCE_PRIORITY and SOURCE_LABELS follow the contract', () => {
  assertEquals(SOURCE_PRIORITY, { ashby: 0, greenhouse: 1, lever: 2, workable: 3, careers_page: 4, consultant: 5, llm: 6, other: 7 });
  assertEquals(SOURCE_LABELS, { ashby: 'Ashby', greenhouse: 'Greenhouse', lever: 'Lever', workable: 'Workable', careers_page: 'Careers page', llm: 'Page read', consultant: 'Typed in', other: 'Other' });
});

Deno.test('mergeVacancies dedupes the feed against the careers page and the model, drops placeholders and expired roles, keeps the feed fields', () => {
  const out = mergeVacancies([
    { title: 'Senior Engineer', url: 'https://searchable.ai/careers/senior-engineer', source: 'careers_page', location: 'London' },
    { title: 'Senior Engineer', url: 'https://jobs.ashbyhq.com/searchable/8e4c', source: 'ashby', department: 'Engineering', workplaceType: 'onsite', datePosted: '2026-07-03', employmentType: 'Full-time' },
    { title: 'Senior Engineer', source: 'llm' },
    { title: 'Head of Talent', url: 'https://jobs.ashbyhq.com/searchable/hot', source: 'ashby', closingDate: '2026-09-01' },
    { title: 'General Application', url: 'https://jobs.ashbyhq.com/searchable/gen', source: 'ashby' },
    { title: 'Engineering', url: 'https://searchable.ai/careers', pageUrl: 'https://searchable.ai/careers', source: 'careers_page' },
    { title: 'Barista', url: 'https://jobs.ashbyhq.com/searchable/bar', source: 'ashby', department: 'Office' },
  ], ctx, today);
  assertEquals(out.kept.map((v) => `${v.source}:${v.title}`), ['ashby:Senior Engineer', 'ashby:Barista']);
  const senior = out.kept[0];
  assertEquals(senior.sources.sort(), ['ashby', 'careers_page', 'llm']);
  assertEquals(senior.url, 'https://jobs.ashbyhq.com/searchable/8e4c');
  assertEquals([senior.department, senior.location, senior.workplaceType, senior.datePosted, senior.employmentType], ['Engineering', 'London', 'onsite', '2026-07-03', 'Full-time'], 'the feed fields win, the page fills what the feed lacks');
  assertEquals((senior.raw as any).alsoSeenAt, ['https://searchable.ai/careers/senior-engineer']);
  assertEquals(out.dropped.map((d) => `${d.title}: ${d.reason}`).sort(), [
    'Engineering: no job noun in title',
    'General Application: role rule: not a role (a general application, talent community or future-opportunities placeholder)',
    'Head of Talent: closing date 2026-09-01 has passed',
    'Senior Engineer: same title as ashby listing',
    'Senior Engineer: same title as ashby listing',
  ]);
});

Deno.test('mergeVacancies: two postings with the same words on one feed are two roles; the same post on the page and the feed is one', () => {
  const out = mergeVacancies([
    { title: 'Account Executive', url: 'https://jobs.ashbyhq.com/searchable/ae-1', source: 'ashby', location: 'London' },
    { title: 'Account Executive', url: 'https://jobs.ashbyhq.com/searchable/ae-2', source: 'ashby', location: 'Salt Lake City, Utah' },
    { title: 'Sales Development Representative (SDR) - Enterprise', url: 'https://jobs.ashbyhq.com/searchable/sdr-e', source: 'ashby' },
    { title: 'Sales Development Representative (SDR) - SMB', url: 'https://jobs.ashbyhq.com/searchable/sdr-s', source: 'ashby' },
    { title: 'Account Executives', url: 'https://searchable.ai/careers/ae', source: 'careers_page' },
  ], ctx, today);
  // Identical titles collapse by title (the two London and Utah AEs are one line: the feed keys them apart but the merge cannot tell them from a re-post), the page's plural joins it.
  assertEquals(out.kept.map((v) => v.title), ['Account Executive', 'Sales Development Representative (SDR) - Enterprise', 'Sales Development Representative (SDR) - SMB']);
  assertEquals(out.dropped.map((d) => d.reason), ['same title as ashby listing', 'near-identical to ashby listing "Account Executive"']);
});

Deno.test('mergeVacancies: a careers-page job description joins its advert as a document; a stale document is dropped; feed titles with years are untouched', () => {
  const out = mergeVacancies([
    { title: 'Senior Engineer', url: 'https://jobs.ashbyhq.com/searchable/8e4c', source: 'ashby' },
    { title: 'Senior Engineer - Job Description', url: 'https://searchable.ai/files/senior-engineer-jd.pdf', source: 'careers_page', document: 'job_description', post: 'Senior Engineer', closingDate: '2026-10-31' },
    { title: 'Product Designer JD', url: 'https://searchable.ai/wp-content/uploads/2021/03/pd-jd.pdf', source: 'careers_page', document: 'job_description', post: 'Product Designer' },
    { title: 'Head of Talent Candidate Pack', url: 'https://searchable.ai/files/hot-pack.pdf', source: 'careers_page', document: 'pack', post: 'Head of Talent' },
    { title: '2027 Graduate Analyst', url: 'https://jobs.lever.co/zopa/962f', source: 'lever' },
  ], ctx, today);
  assertEquals(out.kept.map((v) => v.title), ['Senior Engineer', '2027 Graduate Analyst']);
  assertEquals(out.kept[0].closingDate, '2026-10-31');
  assertEquals((out.kept[0].raw as any).documents, [{ kind: 'job_description', title: 'Senior Engineer - Job Description', url: 'https://searchable.ai/files/senior-engineer-jd.pdf' }]);
  assertEquals(out.dropped.map((d) => `${d.title}: ${d.reason}`), [
    'Product Designer JD: dated uploaded mar 2021 (31 March 2021), more than 60 days old',
    'Senior Engineer - Job Description: job description for "Senior Engineer"',
    'Head of Talent Candidate Pack: information pack with no advert for the post',
  ]);
});

const COMPANY = 'company-1';
const baseline = (over: Record<string, any> = {}) => ({
  id: 'base-eng', company_search_id: COMPANY, vacancy_key: 'title:senior engineer', title: 'Senior Engineer', url: null,
  source: 'llm', closing_date: null, start_text: null, first_seen: '2026-08-20', last_seen: '2026-09-20', status: 'open', raw: { backfill: true }, ...over,
});
const incoming = (over: Record<string, any> = {}) => ({
  title: 'Senior Engineer', url: 'https://jobs.ashbyhq.com/searchable/8e4ca1d9', source: 'ashby' as const,
  key: 'url:jobs.ashbyhq.com/searchable/8e4ca1d9', sources: ['ashby' as const], datePosted: '2026-07-03', department: 'Engineering', location: 'London', workplaceType: 'onsite', employmentType: 'Full-time', ...over,
});

Deno.test('persistVacancies writes the feed fields into raw and dates a new row from the posting date', async () => {
  const db = fakeVacanciesDb([]);
  const open = await persistVacancies(db, [incoming(), incoming({ title: 'Head of Talent', url: 'https://jobs.ashbyhq.com/searchable/hot', key: 'url:jobs.ashbyhq.com/searchable/hot', datePosted: '2026-09-30', department: 'People' })], { companySearchId: COMPANY, today, degraded: false });
  const rows = db.rows();
  assertEquals(rows.length, 2);
  const eng = rows.find((r: any) => r.title === 'Senior Engineer')!;
  assertEquals(eng.raw, { sources: ['ashby'], datePosted: '2026-07-03', department: 'Engineering', location: 'London', workplaceType: 'onsite', employmentType: 'Full-time', postcode: null });
  assertEquals(eng.first_seen, '2026-07-03', 'first_seen is the posting date when earlier than today');
  const hot = rows.find((r: any) => r.title === 'Head of Talent')!;
  assertEquals(hot.first_seen, '2026-09-21', 'a posting date in the future is not used');
  assertEquals(open.map((v) => [v.title, v.datePosted, v.department, v.workplaceType]).sort(), [['Head of Talent', '2026-09-30', 'People', 'onsite'], ['Senior Engineer', '2026-07-03', 'Engineering', 'onsite']]);
});

Deno.test('persistVacancies re-keys a baseline title row found with a feed URL, keeping first_seen', async () => {
  const db = fakeVacanciesDb([baseline()]);
  const open = await persistVacancies(db, [incoming()], { companySearchId: COMPANY, today, degraded: false });
  assertEquals(db.rows().length, 1, 'no second row');
  assertEquals(open.map((v) => [v.key, v.firstSeen, v.lastSeen, v.url, v.status]), [['url:jobs.ashbyhq.com/searchable/8e4ca1d9', '2026-08-20', '2026-09-21', 'https://jobs.ashbyhq.com/searchable/8e4ca1d9', 'open']]);
  assertEquals(db.rows()[0].raw.rekeyedFrom, 'title:senior engineer');
});

Deno.test('persistVacancies keeps a rejected row rejected and closes what the run no longer sees', async () => {
  const db = fakeVacanciesDb([
    baseline({ status: 'rejected' }),
    baseline({ id: 'old-pd', vacancy_key: 'url:jobs.ashbyhq.com/searchable/pd', title: 'Product Designer', url: 'https://jobs.ashbyhq.com/searchable/pd', source: 'ashby' }),
  ]);
  const open = await persistVacancies(db, [incoming()], { companySearchId: COMPANY, today, degraded: false });
  assertEquals(open, []);
  assertEquals(db.rows().map((r: any) => [r.vacancy_key, r.status]).sort(), [['url:jobs.ashbyhq.com/searchable/8e4ca1d9', 'rejected'], ['url:jobs.ashbyhq.com/searchable/pd', 'closed']]);
});

Deno.test('findSameAdvert prefers open, then rejected, then the most recent closed row', () => {
  const rows: any[] = [
    baseline({ id: 'c1', status: 'closed', last_seen: '2026-08-01' }),
    baseline({ id: 'c2', status: 'closed', last_seen: '2026-08-15' }),
    baseline({ id: 'r1', status: 'rejected' }),
    baseline({ id: 'o1', status: 'open' }),
  ];
  assertEquals(findSameAdvert({ title: 'Senior  Engineer' }, rows)!.id, 'o1');
  assertEquals(findSameAdvert({ title: 'Senior Engineer' }, rows.filter((r) => r.id !== 'o1'))!.id, 'r1');
  assertEquals(findSameAdvert({ title: 'Senior Engineer' }, rows.filter((r) => r.status === 'closed'))!.id, 'c2');
  assertEquals(findSameAdvert({ title: 'Head of Talent' }, rows), null);
});

Deno.test('a role a consultant marked Closed stays closed for 30 days while still posted, then is new again', async () => {
  const closedRow = baseline({ status: 'closed', rejected_reason: 'Consultant reported: closed', first_seen: '2026-07-01' });
  const recent = fakeDb({ vacancies: [closedRow], vacancy_feedback: [{ vacancy_id: 'base-eng', kind: 'closed', created_at: '2026-09-05T09:00:00Z' }], alert_deliveries: [{ config_id: 'cfg-1', vacancy_id: 'base-eng' }] });
  assertEquals(await persistVacancies(recent, [incoming()], { companySearchId: COMPANY, today, degraded: false }), [], 'still closed 16 days after the consultant said so');
  assertEquals(recent.rows('alert_deliveries').length, 1);
  const old = fakeDb({ vacancies: [closedRow], vacancy_feedback: [{ vacancy_id: 'base-eng', kind: 'closed', created_at: '2026-08-01T09:00:00Z' }], alert_deliveries: [{ config_id: 'cfg-1', vacancy_id: 'base-eng' }] });
  const openOld = await persistVacancies(old, [incoming()], { companySearchId: COMPANY, today, degraded: false });
  assertEquals(openOld.map((v) => [v.id, v.firstSeen, v.status]), [['base-eng', '2026-09-21', 'open']]);
  assertEquals(old.rows('alert_deliveries').length, 0, 'deliveries released so it is alerted again');
});

Deno.test('a boards-only run (the nightly sync) closes only rows from the feeds that answered; careers-page, model and typed-in rows stay', async () => {
  const db = fakeVacanciesDb([
    baseline({ id: 'ashby-old', vacancy_key: 'url:jobs.ashbyhq.com/searchable/old', title: 'Product Designer', url: 'https://jobs.ashbyhq.com/searchable/old', source: 'ashby' }),
    baseline({ id: 'gh-old', vacancy_key: 'url:job-boards.greenhouse.io/searchable/jobs/1', title: 'Data Scientist', url: 'https://job-boards.greenhouse.io/searchable/jobs/1', source: 'greenhouse' }),
    baseline({ id: 'page-ops', vacancy_key: 'url:searchable.ai/careers/ops', title: 'Operations Associate', url: 'https://searchable.ai/careers/ops', source: 'careers_page' }),
    baseline({ id: 'llm-cs', vacancy_key: 'title:customer success manager', title: 'Customer Success Manager', source: 'llm' }),
    baseline({ id: 'typed', vacancy_key: 'title:head of recruitment', title: 'Head of Recruitment', source: 'consultant' }),
  ]);
  // Ashby answered (with a new listing), Greenhouse did not.
  const open = await persistVacancies(db, [incoming()], { companySearchId: COMPANY, today, degraded: true, closeSources: ['ashby', 'careers_page', 'llm', 'consultant'] });
  const byId = Object.fromEntries(db.rows().map((r: any) => [r.id, r.status]));
  assertEquals(byId['ashby-old'], 'closed', 'an Ashby row the feed no longer lists is closed');
  assertEquals(byId['gh-old'], 'open', 'Greenhouse did not answer, so its row stays');
  assertEquals(byId['page-ops'], 'open', 'the careers page was not read, so its row stays');
  assertEquals(byId['llm-cs'], 'open');
  assertEquals(byId['typed'], 'open', 'a typed-in role is never closed by a run');
  assertEquals(open.map((v) => v.title).sort(), ['Customer Success Manager', 'Data Scientist', 'Head of Recruitment', 'Operations Associate', 'Senior Engineer']);
});

Deno.test('a full run never closes a typed-in role; a degraded run with no feed answering writes nothing', async () => {
  const db = fakeVacanciesDb([baseline({ id: 'typed', vacancy_key: 'title:head of recruitment', title: 'Head of Recruitment', source: 'consultant' }), baseline({ id: 'page', vacancy_key: 'title:ops associate', title: 'Ops Associate', source: 'careers_page' })]);
  await persistVacancies(db, [incoming()], { companySearchId: COMPANY, today, degraded: false });
  assertEquals(Object.fromEntries(db.rows().map((r: any) => [r.id, r.status])), { typed: 'open', page: 'closed', [db.rows().find((r: any) => r.title === 'Senior Engineer')!.id]: 'open' });
  const quiet = fakeVacanciesDb([baseline({ id: 'a', source: 'ashby' })]);
  const open = await persistVacancies(quiet, [], { companySearchId: COMPANY, today, degraded: true, closeSources: [] });
  assertEquals(quiet.rows()[0].status, 'open');
  assertEquals(open.length, 1);
});

Deno.test('toCurrentVacancies gives the contract shape with the role family', () => {
  const out = toCurrentVacancies([
    { id: 'v1', key: 'url:x', title: 'Head of Talent', url: 'https://jobs.ashbyhq.com/searchable/hot', source: 'ashby', closingDate: null, startText: null, firstSeen: '2026-09-01', lastSeen: '2026-09-21', status: 'open', datePosted: '2026-09-01', department: 'People', location: 'London', workplaceType: 'hybrid', employmentType: 'Full-time' },
    { id: 'v2', key: 'title:senior analyst', title: 'Senior Analyst', url: null, source: 'careers_page', closingDate: null, startText: null, firstSeen: '2026-09-10', lastSeen: '2026-09-21', status: 'open', datePosted: null, department: 'Engineering', location: null, workplaceType: null, employmentType: null },
  ]);
  assertEquals(out, [
    { title: 'Head of Talent', url: 'https://jobs.ashbyhq.com/searchable/hot', source: 'ashby', sourceLabel: 'Ashby', firstSeen: '2026-09-01', datePosted: '2026-09-01', department: 'People', location: 'London', workplaceType: 'hybrid', family: 'people_talent', vacancyId: 'v1' },
    { title: 'Senior Analyst', url: undefined, source: 'careers_page', sourceLabel: 'Careers page', firstSeen: '2026-09-10', datePosted: null, department: 'Engineering', location: null, workplaceType: null, family: 'engineering', vacancyId: 'v2' },
  ]);
});

Deno.test('collectBoardVacancies runs one source per confirmed board; collectVacancies adds the careers page', async () => {
  const s = stubFetch({
    'https://api.ashbyhq.com/posting-api/job-board/searchable': { body: fixture('ashby-searchable.json') },
    'https://api.lever.co/v0/postings/nobody?mode=json': { status: 404, body: { ok: false, error: 'Document not found' } },
    'https://api.eu.lever.co/v0/postings/nobody?mode=json': { status: 404, body: { ok: false, error: 'Document not found' } },
    'https://searchable.ai/': { status: 404, body: '' },
  });
  try {
    const two = { ...ctx, boards: [...ctx.boards, { provider: 'lever' as const, slug: 'nobody', boardUrl: null }] };
    const boards = await collectBoardVacancies(null, two, today);
    assertEquals(boards.map((r) => [r.source, r.ok, r.vacancies.length]), [['ashby', true, 13], ['lever', false, 0]]);
    const all = await collectVacancies(null, two, '<html></html>', today);
    assertEquals(all.map((r) => r.source), ['ashby', 'lever', 'careers_page']);
    const summary = summariseRun(all, mergeVacancies(all.flatMap((r) => r.vacancies), two, today).kept, true, 0);
    assertEquals(summary.sourcesOk, ['ashby', 'careers_page']);
    assertEquals(summary.degraded, false);
    assertEquals(summary.vacanciesFound, 13);
    assertEquals(collectBoardVacancies(null, { ...ctx, boards: [] }, today).then((r) => r.length), Promise.resolve(0));
  } finally {
    s.restore();
  }
});
