import { assert, assertEquals } from '../test-assert.ts';
import { ATS_HOSTS, CONTACT_PATHS, CONTEXT_PATHS, findCareersHost, KEEP_HEAD_HTML, KEEP_TAIL_HTML, MAX_PAGE_HTML, PEOPLE_PATHS, selectPages, slimPage } from './pages.ts';

Deno.test('slimPage keeps the head and the tail of an over-long page and says so (H11)', () => {
  const filler = '<p>' + 'x'.repeat(996) + '</p>';
  const html = '<html><body><h1>HEAD-MARKER</h1>' + filler.repeat(Math.ceil((MAX_PAGE_HTML + 100_000) / filler.length)) + '<footer>TAIL-MARKER talent@oak.io</footer></body></html>';
  const out = slimPage(html);
  assertEquals(out.truncated, true);
  assert(out.html.length <= KEEP_HEAD_HTML + KEEP_TAIL_HTML + 100, `${out.html.length}`);
  assert(out.html.includes('HEAD-MARKER'), 'head kept');
  assert(out.html.includes('TAIL-MARKER talent@oak.io'), 'tail kept');
  const small = slimPage('<html><body><p>hello</p></body></html>');
  assertEquals(small.truncated, false);
});

Deno.test('the page tiers are the contract\'s paths', () => {
  assertEquals(CONTACT_PATHS, ['/contact', '/contact-us', '/get-in-touch']);
  assertEquals(PEOPLE_PATHS, ['/team', '/about', '/about-us', '/company', '/people', '/leadership', '/founders', '/careers', '/jobs', '/join', '/join-us']);
  assertEquals(CONTEXT_PATHS, ['/blog', '/news', '/press', '/customers']);
});

const home = `<html><body><nav><a href="/">Home</a> <a href="/product">Product</a> <a href="/company">Company</a> <a href="/team">Team</a> <a href="/contact">Get in touch</a>
<a href="https://jobs.ashbyhq.com/lumenly">Open roles</a> <a href="https://www.linkedin.com/company/lumenly">LinkedIn</a> <a href="https://twitter.com/lumenly">X</a></nav>
<a href="/press/team-deck.pdf">Team deck</a></body></html>`;

Deno.test('selectPages: homepage links first within each tier, then the fixed paths, same host only', () => {
  const sel = selectPages(home, 'https://lumenly.ai/');
  assertEquals(sel.contact[0], 'https://lumenly.ai/contact');
  assertEquals(sel.contact.length, 3);
  assertEquals(sel.people.slice(0, 2), ['https://lumenly.ai/company', 'https://lumenly.ai/team']);
  assert(sel.people.includes('https://lumenly.ai/careers'));
  assert(!sel.people.some((u) => /ashbyhq|linkedin/.test(u)), 'other hosts never enter the same-site tiers');
  assertEquals(sel.context, ['https://lumenly.ai/blog', 'https://lumenly.ai/news', 'https://lumenly.ai/press']);
  assertEquals(sel.pdfs.map((p) => p.url), ['https://lumenly.ai/press/team-deck.pdf']);
});

Deno.test('findCareersHost: an ATS board keeps its slug, a careers. sub-domain gives its origin, social links and job boards are never it', () => {
  assertEquals(findCareersHost(home, 'https://lumenly.ai/'), 'https://jobs.ashbyhq.com/lumenly');
  for (const h of ATS_HOSTS) assertEquals(findCareersHost(`<a href="https://${h}/acme/">Jobs</a>`, 'https://acme.com/'), `https://${h}/acme`, h);
  assertEquals(findCareersHost('<a href="https://careers.acme.co.uk/">We are hiring</a>', 'https://www.acme.co.uk/'), 'https://careers.acme.co.uk');
  assertEquals(findCareersHost('<a href="https://jobs.acme.io/roles">Jobs</a>', 'https://acme.io/'), 'https://jobs.acme.io');
  assertEquals(findCareersHost('<a href="https://careers.other.io/">Jobs</a>', 'https://acme.io/'), null, 'a careers sub-domain of another company is not ours');
  assertEquals(findCareersHost('<a href="https://www.linkedin.com/company/acme/jobs">Jobs</a> <a href="https://uk.indeed.com/cmp/acme">Indeed</a>', 'https://acme.io/'), null);
  assertEquals(findCareersHost('<a href="/careers">Careers</a>', 'https://acme.io/'), null, 'a careers page on the site itself is in the people tier, not a second host');
  assertEquals(findCareersHost('<a href="https://jobs.ashbyhq.com/">Ashby</a>', 'https://acme.io/'), null, 'an ATS host without a slug is not a board');
});
