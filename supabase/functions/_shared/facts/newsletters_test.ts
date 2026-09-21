import { assert, assertEquals } from '../test-assert.ts';
import { buildDeparturesMessage, findNewsletterEntries, issueDateKey, pickLatestIssues } from './newsletters.ts';

const home = `<html><body>
<nav><a href="/about">About us</a><a href="/parents/newsletters">Newsletters</a><a href="/news">News</a>
<a href="https://mailchi.mp/oak/signup">Sign up to our newsletter</a><a href="/parents/newsletters/unsubscribe">Unsubscribe from the newsletter</a>
<a href="/docs/Weekly-Bulletin-4-September-2026.pdf">Weekly Bulletin</a><a href="https://other.example.org/newsletter">Trust newsletter</a></nav>
</body></html>`;

Deno.test('findNewsletterEntries: the index page first, then a direct issue; forms, feeds and other hosts excluded', () => {
  assertEquals(findNewsletterEntries(home, 'https://oak.sch.uk/'), ['https://oak.sch.uk/parents/newsletters', 'https://oak.sch.uk/docs/Weekly-Bulletin-4-September-2026.pdf']);
  assertEquals(findNewsletterEntries('<html><body><a href="/vacancies">Vacancies</a></body></html>', 'https://oak.sch.uk/'), []);
});

Deno.test('issueDateKey reads the usual date shapes and sorts newest first', () => {
  assertEquals(issueDateKey('Newsletter 4 September 2026', '/x'), '2026-09-04');
  assertEquals(issueDateKey('Newsletter', '/docs/Newsletter-04-09-2026.pdf'), '2026-09-04');
  assertEquals(issueDateKey('Issue 3', '/docs/2026-09-04-newsletter.pdf'), '2026-09-04');
  assertEquals(issueDateKey('September 2026 newsletter', '/x'), '2026-09-00');
  assertEquals(issueDateKey('Summer term 2026', '/x'), '2026-00-00');
  assertEquals(issueDateKey('Newsletter', '/x'), '');
  assert(issueDateKey('4 September 2026', '/') > issueDateKey('17 July 2026', '/'));
});

const index = `<html><body><h1>Newsletters</h1>
<a href="/parents/newsletters">Newsletters</a>
<a href="/docs/Newsletter-17-July-2026.pdf">Newsletter 17 July 2026</a>
<a href="/docs/Newsletter-4-September-2026.pdf">Newsletter 4 September 2026</a>
<a href="/docs/Newsletter-10-July-2026.pdf">Newsletter 10 July 2026</a>
<a href="/parents/newsletters/autumn-1-week-2">Autumn term, week 2</a>
<a href="/docs/logo.png">Logo</a><a href="/admissions">Admissions</a><a href="/DressCode.pdf">Dress code</a><a href="/docs/Behaviour-Policy.pdf">Behaviour Policy</a><a href="https://cdn.example.com/oak/Bulletin-11-September-2026.pdf">Bulletin 11 September 2026</a>
</body></html>`;

Deno.test('pickLatestIssues: newest dated issues first, PDFs on any host, section links and images ignored', () => {
  assertEquals(pickLatestIssues(index, 'https://oak.sch.uk/parents/newsletters', 2), ['https://cdn.example.com/oak/Bulletin-11-September-2026.pdf', 'https://oak.sch.uk/docs/Newsletter-4-September-2026.pdf']);
  assertEquals(pickLatestIssues(index, 'https://oak.sch.uk/parents/newsletters', 9).length, 5, 'the dress code and policy PDFs are not issues');
  // Undated issues keep the page's order (latest at the top).
  const undated = `<html><body><a href="/newsletters/issue-12">Issue 12</a><a href="/newsletters/issue-11">Issue 11</a></body></html>`;
  assertEquals(pickLatestIssues(undated, 'https://oak.sch.uk/newsletters', 2), ['https://oak.sch.uk/newsletters/issue-12', 'https://oak.sch.uk/newsletters/issue-11']);
});

Deno.test('buildDeparturesMessage labels each issue by URL', () => {
  const msg = buildDeparturesMessage('Oak Primary Company', [{ url: 'https://oak.sch.uk/docs/n1.pdf', text: 'Mrs Patel will be leaving us at Christmas.' }]);
  assert(msg.startsWith('Company: Oak Primary Company'));
  assert(msg.includes('=== PAGE https://oak.sch.uk/docs/n1.pdf ===\nMrs Patel will be leaving us at Christmas.'));
});
