import { assertEquals } from '../test-assert.ts';
import { greenhouseSource, greenhouseVacancies, greenhouseWorkplaceType } from './source-greenhouse.ts';
import { fixture, stubFetch } from './fetch-stub_test-helper.ts';

const board = { provider: 'greenhouse' as const, slug: 'monzo', boardUrl: 'https://job-boards.greenhouse.io/monzo' };
const today = new Date(Date.UTC(2026, 8, 21));

Deno.test('greenhouseSource reads the Monzo board fixture: 70 jobs, first_published as the posting date, updated_at never', async () => {
  const s = stubFetch({ 'https://boards-api.greenhouse.io/v1/boards/monzo/jobs?content=false': { body: fixture('greenhouse-monzo.json') } });
  try {
    const r = await greenhouseSource(board, today);
    assertEquals(r.ok, true);
    assertEquals(r.vacancies.length, 70);
    assertEquals(r.note, '70 jobs on the monzo board');
    const anaplan = r.vacancies.find((v) => v.title === 'Anaplan Support Analyst')!;
    assertEquals(anaplan.url, 'https://job-boards.greenhouse.io/monzo/jobs/8143930');
    assertEquals(anaplan.location, 'Cardiff, London or Remote (UK)');
    assertEquals(anaplan.workplaceType, null, 'a choice of city or remote is not settled by the feed');
    assertEquals(anaplan.datePosted, '2026-08-24');
    assertEquals(anaplan.employerName, 'Monzo');
    assertEquals(anaplan.department, null, 'the list endpoint carries no departments');
    assertEquals((anaplan.raw as any).updatedAt, '2026-09-15T09:40:53-04:00');
    assertEquals(anaplan.closingDate, null);
    // A title with a trailing space in the feed is trimmed.
    assertEquals(r.vacancies.some((v) => v.title === 'Backend Engineer III'), true);
    assertEquals(r.vacancies.every((v) => v.source === 'greenhouse'), true);
    assertEquals(r.vacancies.filter((v) => !v.datePosted).length, 0, 'every Monzo job carries first_published');
  } finally {
    s.restore();
  }
});

Deno.test('greenhouseWorkplaceType reads the location text', () => {
  assertEquals(greenhouseWorkplaceType('Remote (UK)'), 'remote');
  assertEquals(greenhouseWorkplaceType('Remote'), 'remote');
  assertEquals(greenhouseWorkplaceType('London; Remote (UK)'), null);
  assertEquals(greenhouseWorkplaceType('Cardiff, London or Remote (UK)'), null);
  assertEquals(greenhouseWorkplaceType('Hybrid - London'), 'hybrid');
  assertEquals(greenhouseWorkplaceType('Barcelona'), null);
  assertEquals(greenhouseWorkplaceType(null), null);
});

Deno.test('greenhouseVacancies reads departments and a deadline when the feed gives them, and builds a URL from the id when absolute_url is missing', () => {
  const out = greenhouseVacancies([
    { id: 1, title: 'Platform Engineer', absolute_url: null, departments: [{ name: 'Engineering' }], location: { name: 'London' }, application_deadline: '2026-10-31T23:59:00Z', first_published: null } as any,
    { id: 2, title: '', absolute_url: 'https://x' } as any,
  ], board);
  assertEquals(out.length, 1);
  assertEquals(out[0].url, 'https://job-boards.greenhouse.io/monzo/jobs/1');
  assertEquals(out[0].department, 'Engineering');
  assertEquals(out[0].closingDate, '2026-10-31');
  assertEquals(out[0].datePosted, null, 'Greenhouse without first_published has no posting date');
});

Deno.test('greenhouseSource never throws: an unknown token is ok false with a note', async () => {
  const s = stubFetch({ 'https://boards-api.greenhouse.io/v1/boards/nobody/jobs?content=false': { status: 404, body: { status: 404, error: 'Not found' } } });
  try {
    const r = await greenhouseSource({ ...board, slug: 'nobody' }, today);
    assertEquals(r.ok, false);
    assertEquals(r.vacancies, []);
    assertEquals(r.note, 'unknown Greenhouse board "nobody" (HTTP 404 {"status":404,"error":"Not found"})');
  } finally {
    s.restore();
  }
});
