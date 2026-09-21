import { assertEquals } from '../test-assert.ts';
import { leverSource, leverVacancies } from './source-lever.ts';
import { fixture, stubFetch } from './fetch-stub_test-helper.ts';

const board = { provider: 'lever' as const, slug: 'zopa', boardUrl: 'https://jobs.lever.co/zopa' };
const today = new Date(Date.UTC(2026, 8, 21));

Deno.test('leverSource reads the Zopa site fixture: 34 postings with createdAt as the posting date, department, locations and workplace type', async () => {
  const s = stubFetch({ 'https://api.lever.co/v0/postings/zopa?mode=json': { body: fixture('lever-zopa.json') } });
  try {
    const r = await leverSource(board, today);
    assertEquals(r.ok, true);
    assertEquals(r.vacancies.length, 34);
    assertEquals(r.note, '34 postings on the zopa site');
    const grad = r.vacancies.find((v) => v.title === '2027 Graduate Analyst')!;
    assertEquals(grad.url, 'https://jobs.lever.co/zopa/962f3756-6e45-480f-984c-64e024b57c4f');
    assertEquals(grad.department, 'CAO General');
    assertEquals(grad.location, 'London; Manchester');
    assertEquals(grad.workplaceType, 'hybrid');
    assertEquals(grad.employmentType, 'Employee - Permanent');
    assertEquals(grad.datePosted, '2026-08-28', 'createdAt 1787913476287 ms is 28 August 2026');
    assertEquals((grad.raw as any).country, 'GB');
    assertEquals(r.vacancies.every((v) => v.source === 'lever' && !!v.url), true);
  } finally {
    s.restore();
  }
});

Deno.test('leverVacancies maps on-site and unspecified workplace types and builds a URL from the id', () => {
  const out = leverVacancies([
    { id: 'p1', text: ' Product Designer ', categories: { team: 'Design', location: 'London' }, createdAt: 1789948800000, workplaceType: 'on-site' } as any,
    { id: 'p2', text: 'Ops Lead', categories: { department: 'Operations', commitment: 'Full-time' }, createdAt: '1789948800000', workplaceType: 'unspecified', hostedUrl: 'https://jobs.lever.co/zopa/p2' } as any,
    { id: 'p3', text: '' } as any,
  ], board);
  assertEquals(out.map((v) => [v.title, v.url, v.department, v.workplaceType, v.employmentType, v.datePosted]), [
    ['Product Designer', 'https://jobs.lever.co/zopa/p1', 'Design', 'onsite', null, '2026-09-21'],
    ['Ops Lead', 'https://jobs.lever.co/zopa/p2', 'Operations', null, 'Full-time', '2026-09-21'],
  ]);
});

Deno.test('leverSource: an unknown slug answers 404 "Document not found" on both hosts and is ok false with a note', async () => {
  const s = stubFetch({
    'https://api.lever.co/v0/postings/monzo?mode=json': { status: 404, body: { ok: false, error: 'Document not found' } },
    'https://api.eu.lever.co/v0/postings/monzo?mode=json': { status: 404, body: { ok: false, error: 'Document not found' } },
  });
  try {
    const r = await leverSource({ ...board, slug: 'monzo' }, today);
    assertEquals(r.ok, false);
    assertEquals(r.vacancies, []);
    assertEquals(r.note, 'unknown Lever site "monzo" (HTTP 404 {"ok":false,"error":"Document not found"})');
    assertEquals(s.calls.map((c) => c.url), ['https://api.lever.co/v0/postings/monzo?mode=json', 'https://api.eu.lever.co/v0/postings/monzo?mode=json']);
  } finally {
    s.restore();
  }
});

Deno.test('leverSource: an EU-hosted site answers on the EU host after a global 404', async () => {
  const s = stubFetch({
    'https://api.lever.co/v0/postings/eucorp?mode=json': { status: 404, body: { ok: false, error: 'Document not found' } },
    'https://api.eu.lever.co/v0/postings/eucorp?mode=json': { body: [{ id: 'e1', text: 'Engineer', categories: {}, createdAt: 1789948800000, hostedUrl: 'https://jobs.eu.lever.co/eucorp/e1' }] },
  });
  try {
    const r = await leverSource({ ...board, slug: 'eucorp' }, today);
    assertEquals(r.ok, true);
    assertEquals(r.vacancies.map((v) => v.url), ['https://jobs.eu.lever.co/eucorp/e1']);
  } finally {
    s.restore();
  }
});
