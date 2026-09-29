import { assert, assertEquals } from './test-assert.ts';
import { configureDatabaseFetch, fetchPage, fetchViaDatabase, htmlToText, isPrefetched, looksLikeSoft404, mapWithConcurrency } from './fetch.ts';

const home = '<html><head><title>Oak Primary Company - Home</title></head><body><nav>Menu</nav><h1>Welcome</h1></body></html>';

Deno.test('looksLikeSoft404 detects identical body', () => {
  assertEquals(looksLikeSoft404(home, home), true);
  assertEquals(looksLikeSoft404(home.replace('<h1>Welcome</h1>', '<h1>Welcome</h1>   '), home), true);
});

Deno.test('looksLikeSoft404 detects the homepage served again under its own title, not a different page with the same title', () => {
  // The homepage's text under another URL (a catch-all route): a soft 404.
  const servedAgain = home.replace('<body>', '<body><!-- served for /missing -->');
  assertEquals(looksLikeSoft404(servedAgain, home), true);
  // The same title on a page that says something else: a real page (29 September 2026).
  const other = '<html><head><title>Oak Primary Company - Home</title></head><body>A different page with its own words about the team and the office.</body></html>';
  assertEquals(looksLikeSoft404(other, home), false);
});

Deno.test('looksLikeSoft404 detects not-found titles and empty pages', () => {
  assertEquals(looksLikeSoft404('<title>Page not found</title><body>x</body>', home), true);
  assertEquals(looksLikeSoft404('', home), true);
});

Deno.test('looksLikeSoft404 accepts a real vacancies page', () => {
  const vac = '<html><head><title>Vacancies - Oak Primary Company</title></head><body><h1>Vacancies</h1><a href="/vacancies/class-teacher">Class Teacher</a></body></html>';
  assertEquals(looksLikeSoft404(vac, home), false);
});

Deno.test('htmlToText keeps line breaks between blocks', () => {
  const text = htmlToText('<p>Class Teacher</p><p>Closing date: 18 September 2026</p><script>x()</script>');
  assertEquals(text, 'Class Teacher\nClosing date: 18 September 2026');
});

Deno.test('mapWithConcurrency preserves order', async () => {
  const out = await mapWithConcurrency([3, 1, 2], 2, async (n) => {
    await new Promise((r) => setTimeout(r, n * 5));
    return n * 10;
  });
  assertEquals(out, [30, 10, 20]);
});

import { fetchHomepage, homepageVariants, looksParked } from './fetch.ts';
import type { FetchedPage } from './fetch.ts';

const parkedHtml = '<html><head><title>oakprimary.co.uk is for sale | HugeDomains</title></head><body><p>This domain is for sale. Buy it now.</p></body></html>';
const fakePage = (url: string, html: string, ok = true): FetchedPage => ({ url, finalUrl: url, status: ok ? 200 : 0, ok, html, ms: 1, error: ok ? undefined : 'connection reset' });

Deno.test('looksParked recognises a domain-for-sale page and accepts a company homepage', () => {
  assertEquals(looksParked(parkedHtml), true);
  assertEquals(looksParked(home), false);
});

Deno.test('fetchHomepage does not return a parked page as the homepage when every variant is parked (H5)', async () => {
  const out = await fetchHomepage('https://www.oakprimary.co.uk', 100, 100, (url) => Promise.resolve(fakePage(url, parkedHtml)));
  assertEquals(out.page.ok, false);
  assertEquals(out.page.error, 'parked or challenge page');
  assertEquals(out.urlUsed, 'https://www.oakprimary.co.uk');
  assertEquals(out.attempts.length, homepageVariants('https://www.oakprimary.co.uk').length);
  for (const a of out.attempts) assertEquals(a.error, 'parked or challenge page');
});

Deno.test('fetchHomepage keeps the first real failure when the stored URL is reset and the variants are parked', async () => {
  const out = await fetchHomepage('https://www.oakprimary.co.uk', 100, 100, (url) =>
    Promise.resolve(url === 'https://www.oakprimary.co.uk/' ? fakePage(url, '', false) : fakePage(url, parkedHtml)));
  assertEquals(out.page.ok, false);
  assertEquals(out.page.error, 'connection reset');
});

Deno.test('fetchHomepage uses a real variant when the stored URL is parked', async () => {
  const out = await fetchHomepage('https://www.oakprimary.co.uk', 100, 100, (url) =>
    Promise.resolve(url === 'http://oakprimary.co.uk/' ? fakePage(url, home) : fakePage(url, parkedHtml)));
  assertEquals(out.page.ok, true);
  assertEquals(out.urlUsed, 'http://oakprimary.co.uk/');
  assertEquals(out.usedVariant, true);
});

Deno.test('connection-level errors are recognised; HTTP answers and parse errors are not', async () => {
  const { isConnectionLevelError } = await import('./fetch.ts');
  assert(isConnectionLevelError('error sending request for url (https://x/): client error (Connect): Connection reset by peer (os error 104)'));
  assert(isConnectionLevelError('timeout after 15000ms'));
  assert(isConnectionLevelError('dns error: failed to lookup address information'));
  assert(!isConnectionLevelError('Unexpected token < in JSON'));
  assert(!isConnectionLevelError(undefined));
});

Deno.test('fetchViaDatabase fails at once for a page outside the prefetch in prefetch-only mode, without touching the database', async () => {
  const calls: string[] = [];
  const client = { rpc: (name: string) => { calls.push(name); return Promise.resolve({ data: null, error: null }); } };
  configureDatabaseFetch(client, { prefetched: { 'https://Company.example/': 1 }, prefetchOnly: true, defer: true });
  try {
    assertEquals(isPrefetched('https://company.example'), true, 'case and the trailing slash do not matter');
    assertEquals(isPrefetched('https://company.example/team'), false);
    const r = await fetchViaDatabase('https://company.example/team', 5000);
    assertEquals(r.ok, false);
    assertEquals(calls, [], 'no enqueue, no poll');
    assertEquals(r.error, 'database fetch skipped: not among the prefetched pages');
    assertEquals(r.via, 'database');
  } finally {
    configureDatabaseFetch(null);
  }
});

Deno.test('fetchPage reads a prefetched page from the database before any edge fetch', async () => {
  const calls: Array<[string, unknown]> = [];
  const client = { rpc: (name: string, args: unknown) => { calls.push([name, args]); return Promise.resolve({ data: name === 'http_page_result' ? { status: 200, content: '<html><title>Prefetched</title></html>', error: null } : null, error: null }); } };
  configureDatabaseFetch(client, { prefetched: { 'https://company.example/': 9000000000001 }, prefetchOnly: true });
  try {
    const page = await fetchPage('https://company.example', 5000);
    assertEquals(page.ok, true);
    assertEquals(page.via, 'database');
    assert(page.html.includes('Prefetched'));
    assertEquals(calls.map((c) => c[0]), ['http_page_result']);
    assertEquals((calls[0][1] as { p_id: number }).p_id, 9000000000001);
  } finally {
    configureDatabaseFetch(null);
  }
});

Deno.test('looksLikeSoft404: the same title as the homepage is a soft 404 only when the page reads the same', () => {
  const shell = (title: string, body: string) => `<html><head><title>${title}</title></head><body><nav>Home Product About</nav><main>${body}</main><footer>Metris Energy Ltd</footer></body></html>`;
  const home = shell('Metris Energy', '<h1>The all-in-one energy platform</h1><p>The future of renewables is here and it needs better data.</p>');
  const about = shell('Metris Energy', '<h1>Our story</h1><p>At Metris, we want to simplify energy data processing. No more spreadsheets.</p>');
  assertEquals(looksLikeSoft404(about, home), false, 'same title, different page');
  assertEquals(looksLikeSoft404(shell('Metris Energy', '<h1>The all-in-one energy platform</h1><p>The future of renewables is here and it needs better data.</p>'), home), true, 'the homepage served again');
  assertEquals(looksLikeSoft404(shell('Page not found', '<p>Sorry</p>'), home), true);
});

Deno.test('fetchPage in prefetch-only mode fails at once for an unseeded page on a seeded host, and still fetches other hosts', async () => {
  const calls: string[] = [];
  const client = { rpc: (name: string) => { calls.push(name); return Promise.resolve({ data: null, error: null }); } };
  configureDatabaseFetch(client, { prefetched: { 'https://www.company.example/': 1 }, prefetchOnly: true });
  try {
    const r = await fetchPage('https://company.example/team', 5000);
    assertEquals([r.ok, r.error, r.via], [false, 'not among the prefetched pages', 'database']);
    assertEquals(calls, [], 'no database call, no edge fetch');
    const { refusedByPrefetchOnly } = await import('./fetch.ts');
    assertEquals(refusedByPrefetchOnly('https://jobs.ashbyhq.com/company'), false, 'another host is fetched as usual');
    assertEquals(refusedByPrefetchOnly('https://www.company.example'), false, 'the seeded page itself');
  } finally {
    configureDatabaseFetch(null);
  }
});
