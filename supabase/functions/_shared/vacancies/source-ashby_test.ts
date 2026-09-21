import { assert, assertEquals } from '../test-assert.ts';
import { ashbySource, ashbyVacancies, readAshbyBoard } from './source-ashby.ts';
import { fixture, stubFetch } from './fetch-stub_test-helper.ts';

const board = { provider: 'ashby' as const, slug: 'searchable', boardUrl: 'https://jobs.ashbyhq.com/searchable' };
const today = new Date(Date.UTC(2026, 8, 21));

Deno.test('ashbySource reads the Searchable board fixture: 13 listed jobs with department, location, workplace type and posting date', async () => {
  const s = stubFetch({ 'https://api.ashbyhq.com/posting-api/job-board/searchable': { body: fixture('ashby-searchable.json') } });
  try {
    const r = await ashbySource(board, today);
    assertEquals(r.ok, true);
    assertEquals(r.source, 'ashby');
    assertEquals(r.vacancies.length, 13);
    assertEquals(r.note, '13 jobs on the searchable board');
    const senior = r.vacancies.find((v) => v.title === 'Senior Engineer')!;
    assertEquals(senior.url, 'https://jobs.ashbyhq.com/searchable/8e4ca1d9-490f-43f9-aded-a74003f1a86d');
    assertEquals(senior.department, 'Engineering');
    assertEquals(senior.location, 'London');
    assertEquals(senior.workplaceType, 'onsite');
    assertEquals(senior.employmentType, 'Full-time');
    assertEquals(senior.datePosted, '2026-07-03');
    assertEquals((senior.raw as any).country, 'United Kingdom');
    const dach = r.vacancies.find((v) => v.title.startsWith('Senior Account Executive, Germany'))!;
    assertEquals(dach.workplaceType, 'remote');
    assertEquals(dach.location, 'Germany; London', 'the primary location plus the secondary ones');
    const hybrid = r.vacancies.find((v) => v.title === 'Sales Development Representative (SDR) - Enterprise')!;
    assertEquals(hybrid.workplaceType, 'hybrid');
    assertEquals(hybrid.location, 'Salt Lake City, Utah');
    // A trailing space in the feed's title is trimmed; a null workplaceType stays null.
    const sdr = r.vacancies.find((v) => v.title === 'Sales Development Representative (SDR)')!;
    assert(sdr, 'the SDR title is trimmed');
    const smb = r.vacancies.find((v) => v.title === 'Sales Development Representative (SDR) - SMB')!;
    assertEquals(smb.workplaceType, null);
    assertEquals(s.calls.length, 1);
  } finally {
    s.restore();
  }
});

Deno.test('ashbyVacancies skips unlisted jobs and reads isRemote when workplaceType is missing', () => {
  const out = ashbyVacancies([
    { id: 'a', title: 'Hidden Role', isListed: false, isRemote: false } as any,
    { id: 'b', title: 'Remote Engineer', isListed: true, isRemote: true, workplaceType: null, location: 'Anywhere', secondaryLocations: [{ location: 'London' }], department: null, team: 'Platform', employmentType: 'Contract', publishedAt: 'not a date' } as any,
    { id: 'c', title: '   ', isListed: true } as any,
  ], board);
  assertEquals(out.map((v) => v.title), ['Remote Engineer']);
  assertEquals(out[0].workplaceType, 'remote');
  assertEquals(out[0].location, 'Anywhere; London');
  assertEquals(out[0].department, 'Platform');
  assertEquals(out[0].employmentType, 'Contract');
  assertEquals(out[0].datePosted, null);
  assertEquals(out[0].url, 'https://jobs.ashbyhq.com/searchable/b');
});

Deno.test('ashbySource never throws: a 404, a non-JSON answer and a network error are ok false with a note', async () => {
  const s = stubFetch({
    'https://api.ashbyhq.com/posting-api/job-board/nobody': { status: 404, body: { errors: ['Job board not found'] } },
    'https://api.ashbyhq.com/posting-api/job-board/html': { body: '<html>Just a moment</html>' },
    'https://api.ashbyhq.com/posting-api/job-board/nojobs': { body: { boards: [] } },
    'https://api.ashbyhq.com/posting-api/job-board/down': () => { throw new Error('error sending request: connection reset'); },
  });
  try {
    const missing = await ashbySource({ ...board, slug: 'nobody' }, today);
    assertEquals(missing.ok, false);
    assertEquals(missing.vacancies, []);
    assertEquals(missing.note, 'unknown Ashby board "nobody" (HTTP 404 {"errors":["Job board not found"]})');
    assertEquals((await ashbySource({ ...board, slug: 'html' }, today)).note, 'the feed did not answer JSON');
    assertEquals((await ashbySource({ ...board, slug: 'nojobs' }, today)).note, 'the feed answered without a jobs array');
    const down = await readAshbyBoard({ slug: 'down' });
    assertEquals(down.ok, false);
    assertEquals(down.status, 0);
    assertEquals(down.note, 'error sending request: connection reset');
  } finally {
    s.restore();
  }
});
