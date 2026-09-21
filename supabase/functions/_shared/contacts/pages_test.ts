import { assert, assertEquals } from '../test-assert.ts';
import { KEEP_HEAD_HTML, KEEP_TAIL_HTML, MAX_PAGE_HTML, slimPage } from './pages.ts';

Deno.test('slimPage keeps the head and the tail of an over-long page and says so (H11)', () => {
  const filler = '<p>' + 'x'.repeat(996) + '</p>';
  const html = '<html><body><h1>HEAD-MARKER</h1>' + filler.repeat(Math.ceil((MAX_PAGE_HTML + 100_000) / filler.length)) + '<footer>TAIL-MARKER senco@oak.sch.uk</footer></body></html>';
  const out = slimPage(html);
  assertEquals(out.truncated, true);
  assert(out.html.length <= KEEP_HEAD_HTML + KEEP_TAIL_HTML + 100, `${out.html.length}`);
  assert(out.html.includes('HEAD-MARKER'), 'head kept');
  assert(out.html.includes('TAIL-MARKER senco@oak.sch.uk'), 'tail kept');
  const small = slimPage('<html><body><p>hello</p></body></html>');
  assertEquals(small.truncated, false);
});
