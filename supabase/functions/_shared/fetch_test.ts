import { assert, assertEquals } from './test-assert.ts';
import { htmlToText, looksLikeSoft404, mapWithConcurrency } from './fetch.ts';

const home = '<html><head><title>Oak Primary Company - Home</title></head><body><nav>Menu</nav><h1>Welcome</h1></body></html>';

Deno.test('looksLikeSoft404 detects identical body', () => {
  assertEquals(looksLikeSoft404(home, home), true);
  assertEquals(looksLikeSoft404(home.replace('<h1>Welcome</h1>', '<h1>Welcome</h1>   '), home), true);
});

Deno.test('looksLikeSoft404 detects identical title', () => {
  const other = '<html><head><title>Oak Primary Company - Home</title></head><body>different</body></html>';
  assertEquals(looksLikeSoft404(other, home), true);
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
