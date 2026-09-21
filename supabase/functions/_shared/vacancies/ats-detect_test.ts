import { assertEquals } from '../test-assert.ts';
import { confirmBoard, detectAtsBoards } from './ats-detect.ts';
import { fixture, stubFetch } from './fetch-stub_test-helper.ts';

Deno.test('detectAtsBoards finds an Ashby link and the feed URL, once', () => {
  const html = `<nav><a href="/about">About</a><a href="https://jobs.ashbyhq.com/searchable">Careers</a></nav>
    <a href="https://jobs.ashbyhq.com/searchable/8e4ca1d9-490f-43f9-aded-a74003f1a86d">Senior Engineer</a>
    <script>fetch("https://api.ashbyhq.com/posting-api/job-board/searchable")</script>`;
  assertEquals(detectAtsBoards(html, 'https://searchable.ai'), [{ provider: 'ashby', slug: 'searchable', boardUrl: 'https://jobs.ashbyhq.com/searchable' }]);
});

Deno.test('detectAtsBoards finds Greenhouse links, the API and the embed script', () => {
  assertEquals(detectAtsBoards('<a href="https://boards.greenhouse.io/monzo">Jobs</a>', 'https://monzo.com'), [{ provider: 'greenhouse', slug: 'monzo', boardUrl: 'https://job-boards.greenhouse.io/monzo' }]);
  assertEquals(detectAtsBoards('<a href="https://job-boards.greenhouse.io/monzo/jobs/8143930">Anaplan Support Analyst</a>', 'https://monzo.com').map((b) => b.slug), ['monzo']);
  assertEquals(detectAtsBoards('<a href="https://job-boards.eu.greenhouse.io/monzo">Jobs</a>', 'https://monzo.com').map((b) => b.slug), ['monzo']);
  assertEquals(detectAtsBoards('<script src="https://boards.greenhouse.io/embed/job_board/js?for=monzo"></script>', 'https://monzo.com').map((b) => `${b.provider}:${b.slug}`), ['greenhouse:monzo']);
  assertEquals(detectAtsBoards('<iframe src="https://boards.greenhouse.io/embed/job_board?for=monzo&b=https%3A%2F%2Fmonzo.com%2Fcareers"></iframe>', 'https://monzo.com').map((b) => b.slug), ['monzo']);
  assertEquals(detectAtsBoards('<a href="https://boards-api.greenhouse.io/v1/boards/monzo/jobs">api</a>', 'https://monzo.com').map((b) => b.slug), ['monzo']);
});

Deno.test('detectAtsBoards finds Lever and Workable boards and skips the providers\' own pages', () => {
  assertEquals(detectAtsBoards('<a href="https://jobs.lever.co/zopa">Open roles</a> <a href="https://jobs.lever.co/zopa/962f3756-6e45-480f-984c-64e024b57c4f">Graduate Analyst</a>', 'https://zopa.com'), [{ provider: 'lever', slug: 'zopa', boardUrl: 'https://jobs.lever.co/zopa' }]);
  assertEquals(detectAtsBoards('<a href="https://api.lever.co/v0/postings/zopa?mode=json">feed</a>', 'https://zopa.com').map((b) => b.slug), ['zopa']);
  assertEquals(detectAtsBoards('<a href="https://apply.workable.com/acme-robotics/">Jobs</a>', 'https://acme.io'), [{ provider: 'workable', slug: 'acme-robotics', boardUrl: 'https://apply.workable.com/acme-robotics' }]);
  assertEquals(detectAtsBoards('<a href="https://acme-robotics.workable.com/">Jobs</a>', 'https://acme.io').map((b) => b.slug), ['acme-robotics']);
  assertEquals(detectAtsBoards('<a href="https://jobs.workable.com/company/abc123/acme-robotics">Jobs</a>', 'https://acme.io').map((b) => b.slug), ['acme-robotics']);
  // Job short links, the provider's own pages and the www host name no board.
  assertEquals(detectAtsBoards('<a href="https://apply.workable.com/j/ABCDEF">a job</a> <a href="https://www.workable.com/pricing">Workable</a> <a href="https://help.greenhouse.io/x">help</a>', 'https://acme.io'), []);
  assertEquals(detectAtsBoards('<p>No links here</p>', 'https://acme.io'), []);
});

Deno.test('detectAtsBoards dedupes across providers and handles escaped JSON in scripts', () => {
  const html = `<script type="application/json">{"careersUrl":"https:\\/\\/jobs.ashbyhq.com\\/searchable","board":"https://jobs.lever.co/zopa"}</script><a href="https://jobs.ashbyhq.com/Searchable">roles</a>`;
  assertEquals(detectAtsBoards(html, 'https://x.com').map((b) => `${b.provider}:${b.slug}`), ['ashby:searchable', 'lever:zopa']);
});

Deno.test('confirmBoard: a feed that answers with jobs confirms, a 404 does not', async () => {
  const s = stubFetch({
    'https://api.ashbyhq.com/posting-api/job-board/searchable': { body: fixture('ashby-searchable.json') },
    'https://api.ashbyhq.com/posting-api/job-board/nobody': { status: 404, body: { errors: ['Job board not found'] } },
    'https://boards-api.greenhouse.io/v1/boards/monzo/jobs?content=false': { body: fixture('greenhouse-monzo.json') },
    'https://api.lever.co/v0/postings/zopa?mode=json': { body: fixture('lever-zopa.json') },
    'https://api.lever.co/v0/postings/nobody?mode=json': { status: 404, body: { ok: false, error: 'Document not found' } },
    'https://api.eu.lever.co/v0/postings/nobody?mode=json': { status: 404, body: { ok: false, error: 'Document not found' } },
    'https://apply.workable.com/api/v1/widget/accounts/acme': { body: { name: 'Acme Robotics Ltd', jobs: [{ title: 'Robotics Engineer', shortcode: 'A1', published_on: '2026-09-01', url: 'https://apply.workable.com/acme/j/A1', location: { city: 'London', country: 'United Kingdom' } }] } },
    'https://apply.workable.com/api/v1/widget/accounts/other': { body: { name: 'Someone Else Inc', jobs: [] } },
    'https://apply.workable.com/api/v1/widget/accounts/limited': { status: 429, body: 'error code: 1015' },
  });
  try {
    assertEquals(await confirmBoard({ provider: 'ashby', slug: 'searchable', boardUrl: null }, 'Searchable'), { ok: true, count: 13, note: 'Ashby board searchable answers' });
    const missing = await confirmBoard({ provider: 'ashby', slug: 'nobody', boardUrl: null }, 'Nobody');
    assertEquals(missing.ok, false);
    assertEquals(missing.count, 0);
    assertEquals(missing.note?.startsWith('unknown Ashby board "nobody"'), true, missing.note ?? '');
    const gh = await confirmBoard({ provider: 'greenhouse', slug: 'monzo', boardUrl: null }, 'Monzo Bank Limited');
    assertEquals(gh, { ok: true, count: 70, note: 'Greenhouse board monzo answers', nameMatch: true });
    const ghOther = await confirmBoard({ provider: 'greenhouse', slug: 'monzo', boardUrl: null }, 'Searchable');
    assertEquals(ghOther.ok, true);
    assertEquals(ghOther.note, 'Greenhouse board monzo answers; the feed names "Monzo", not "Searchable"');
    assertEquals(await confirmBoard({ provider: 'lever', slug: 'zopa', boardUrl: null }, 'Zopa'), { ok: true, count: 34, note: 'Lever site zopa answers' });
    assertEquals((await confirmBoard({ provider: 'lever', slug: 'nobody', boardUrl: null }, 'Nobody')).ok, false);
    assertEquals(await confirmBoard({ provider: 'workable', slug: 'acme', boardUrl: null }, 'Acme Robotics'), { ok: true, count: 1, note: 'Workable account acme answers as "Acme Robotics Ltd"', nameMatch: true });
    assertEquals(await confirmBoard({ provider: 'workable', slug: 'other', boardUrl: null }, 'Acme Robotics'), { ok: true, count: 0, note: 'Workable account other answers as "Someone Else Inc"; the feed names "Someone Else Inc", not "Acme Robotics"' });
    const limited = await confirmBoard({ provider: 'workable', slug: 'limited', boardUrl: null }, 'Acme');
    assertEquals(limited.ok, false);
    assertEquals(limited.note, 'Workable rate-limited the read (HTTP 429, Cloudflare 1015); the board is not empty, it was not read');
  } finally {
    s.restore();
  }
});
