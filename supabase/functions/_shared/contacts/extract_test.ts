import { assert, assertEquals } from '../test-assert.ts';
import { decodeCfEmail, decodeEntities, extractEmails, extractPeople, extractPhones, looksLikeName, looksLikeRole, normaliseEmail } from './extract.ts';

const here = new URL('.', import.meta.url).pathname;
const fixture = (name: string) => Deno.readTextFileSync(`${here}fixtures/${name}`);
const emailsOf = (hits: { email: string }[]) => hits.map((h) => h.email).sort();

Deno.test('cfemail decodes the XOR scheme', () => {
  // 5a is the key; "a@b.c" xor 0x5a
  const enc = '5a' + Array.from('a@b.c').map((c) => (c.charCodeAt(0) ^ 0x5a).toString(16).padStart(2, '0')).join('');
  assertEquals(decodeCfEmail(enc), 'a@b.c');
  assertEquals(decodeCfEmail('zz'), null);
});

Deno.test('entities decode, including &commat; and numeric forms', () => {
  assertEquals(decodeEntities('t&#46;patel&#64;example&#x2e;health&period;io'), 't.patel@example.health.io');
  assertEquals(decodeEntities('a&commat;b.c'), 'a@b.c');
});

Deno.test('normaliseEmail lowercases, strips mailto/subject and rejects assets and placeholders', () => {
  assertEquals(normaliseEmail('MAILTO:Founders@Lumenly.ai?subject=Hi'), 'founders@lumenly.ai');
  assertEquals(normaliseEmail('hero@2x.png'), null);
  assertEquals(normaliseEmail('name@example.com'), null);
  assertEquals(normaliseEmail('noreply@lumenly.ai'), null);
  assertEquals(normaliseEmail('(hello@lumenly.ai).'), 'hello@lumenly.ai');
});

Deno.test('every obfuscation form on the about page is recovered, and assets are not', () => {
  const hits = extractEmails(fixture('startup-about-obfuscated.html'), 'https://example-health.io/about');
  assertEquals(emailsOf(hits), [
    'alan.reid@board.example-health.io',
    'careers@example-health.io',
    'founders@example-health.io',
    'hello@example-health.io',
    'j.bloggs@example-health.io',
    'p.shah@example-health.io',
    'press@example-health.io',
    'support@example-health.io',
    't.patel@example-health.io',
  ]);
  const by = Object.fromEntries(hits.map((h) => [h.email, h]));
  assertEquals(by['j.bloggs@example-health.io'].how, 'cfemail');
  assertEquals(by['t.patel@example-health.io'].how, 'entity');
  assertEquals(by['p.shah@example-health.io'].how, 'obfuscated');
  assertEquals(by['alan.reid@board.example-health.io'].how, 'obfuscated');
  assertEquals(by['careers@example-health.io'].how, 'js');
  assertEquals(by['founders@example-health.io'].how, 'js');
  assertEquals(by['hello@example-health.io'].how, 'mailto');
  assertEquals(by['hello@example-health.io'].linkText, 'Email the team');
  assert(by['j.bloggs@example-health.io'].context.includes('Jane Bloggs'), 'context carries the name next to the address');
  assert(by['t.patel@example-health.io'].context.includes('Chief Operating Officer'));
});

Deno.test('mailto and plain addresses on the leadership table, with row context', () => {
  const hits = extractEmails(fixture('startup-team-table.html'), 'https://fathom-robotics.co.uk/leadership');
  assertEquals(emailsOf(hits), ['chloe@fathom-robotics.co.uk', 'grace@fathom-robotics.co.uk', 'info@fathom-robotics.co.uk', 'kr.hirani@fathom-robotics.co.uk', 'm.donachy@fathom-robotics.co.uk']);
  const grace = hits.find((h) => h.email === 'grace@fathom-robotics.co.uk')!;
  assert(/Founder/.test(grace.context) && /Persand/.test(grace.context), grace.context);
  const m = hits.find((h) => h.email === 'm.donachy@fathom-robotics.co.uk')!;
  assertEquals(m.how, 'text');
  assert(/Donachy/.test(m.context), m.context);
});

Deno.test('people from a Name/Role/Email table', () => {
  const people = extractPeople(fixture('startup-team-table.html'), 'https://fathom-robotics.co.uk/leadership');
  const by = Object.fromEntries(people.map((p) => [p.name, p]));
  assert(by['Grace Persand'], Object.keys(by).join(' | '));
  assertEquals(by['Grace Persand'].role, 'Founder & CEO');
  assertEquals(by['Grace Persand'].email, 'grace@fathom-robotics.co.uk');
  assertEquals(by['Marcus Donachy'].role, 'VP Engineering');
  assertEquals(by['Marcus Donachy'].email, 'm.donachy@fathom-robotics.co.uk');
  assertEquals(by['Nadia Hirani'].role, 'Head of People');
  assertEquals(by['Nadia Hirani'].email, undefined);
  assertEquals(by['Simon Dodds'].role, 'Non-executive Director');
  assert(by['Kate Hirani'] && /Talent Partner/.test(by['Kate Hirani'].role), 'the talent partner in prose: ' + JSON.stringify(by['Kate Hirani']));
});

Deno.test('people from card grids and definition lists, with the stop list applied', () => {
  const people = extractPeople(fixture('startup-team-cards.html'), 'https://lumenly.ai/team');
  const by = Object.fromEntries(people.map((p) => [p.name, p]));
  assertEquals(by['Sarah Green'].role, 'Co-founder and CEO');
  assertEquals(by['Sarah Green'].email, 'sarah.green@lumenly.ai');
  assertEquals(by['David Brown'].email, 'david.brown@lumenly.ai');
  assertEquals(by['Amy Jones'].role, 'Chief of Staff');
  assertEquals(by['Omar Khan'].role, 'Head of Talent');
  assertEquals(by['Priya Shah'].role, 'Director of People');
  assertEquals(by['Ben Carter'].role, 'Account Executive');
  assertEquals(by['Helen Wood'].role, 'Partner, Headline');
  assertEquals(by['Ann Lee'].email, 'ann@headline.com');
  assertEquals(by['Tom Patel'].role, 'EA to the CEO');
  assert(!by['Series A'] && !by['Open Roles'] && !by['Backed By'], Object.keys(by).join(' | '));
});

Deno.test('people from "Role: Name - address" lines on the about page', () => {
  const people = extractPeople(fixture('startup-about-obfuscated.html'), 'https://example-health.io/about');
  const by = Object.fromEntries(people.map((p) => [p.name, p]));
  assert(by['Jane Bloggs'], Object.keys(by).join(' | '));
  assertEquals(by['Jane Bloggs'].role, 'Founder and CEO');
  assertEquals(by['Jane Bloggs'].email, 'j.bloggs@example-health.io');
  assertEquals(by['Tom Patel'].role, 'Chief Operating Officer');
  assertEquals(by['Priya Shah'].role, 'Head of Talent');
  assertEquals(by['Alan Reid'].role, 'Board member');
});

Deno.test('looksLikeName and looksLikeRole guard against page furniture', () => {
  assert(looksLikeName('Sarah Green'));
  assert(looksLikeName('Jamie Brownhill'));
  assert(looksLikeName("Emma O'Reilly"));
  assert(looksLikeName('Dr Priya Shah'));
  assert(!looksLikeName('Welcome To Our Company'));
  assert(!looksLikeName('Head Of Talent'));
  assert(!looksLikeName('Series A'));
  assert(!looksLikeName('Open Roles'));
  assert(!looksLikeName('Backed By'));
  assert(!looksLikeName('Machine Learning'));
  assert(!looksLikeName('Mrs'));
  assert(looksLikeRole('Co-founder and CEO'));
  assert(looksLikeRole('EA to the CEO'));
  assert(looksLikeRole('Head of Talent'));
  assert(looksLikeRole('VP Engineering'));
  assert(looksLikeRole('Partner, Headline'));
  assert(looksLikeRole('General Counsel'));
  assert(looksLikeRole('Board observer'));
  assert(!looksLikeRole('Y6'));
  assert(!looksLikeRole('Raised in March 2026'));
});

Deno.test('phones near tel/phone and in tel: links, UK format', () => {
  const hits = extractPhones('<a href="tel:+442079460123">Call</a> <p>Telephone: 020 7946 0123</p> <p>Fax 020 7946 9999</p>', 'https://x');
  assertEquals(hits.map((h) => h.phone), ['020 7946 0123']);
});

Deno.test('names shed trailing role words and possessives; roles shed "Meet our"', () => {
  const html = `<table><tr><td>Chief of Staff - Operations</td><td>Mr Sear's Office</td><td><a href="mailto:asr@x.io">asr@x.io</a></td></tr>
  <tr><td>EA to the Founders</td><td>Ms Bailey Operations</td></tr>
  <tr><td>Meet Our Founder</td><td>Georgina Charles</td><td>g.charles@x.io</td></tr>
  <tr><td>Head of Engineering</td><td>Stephen Wallman Engineering</td></tr></table>`;
  const people = extractPeople(html, 'https://x.io/team');
  const by = Object.fromEntries(people.map((p) => [p.name, p]));
  assert(by['Mr Sear'], Object.keys(by).join(' | '));
  assertEquals(by['Mr Sear'].email, 'asr@x.io');
  assert(by['Ms Bailey'], Object.keys(by).join(' | '));
  assertEquals(by['Georgina Charles'].role, 'Founder');
  assert(by['Stephen Wallman'], Object.keys(by).join(' | '));
});

import { slimHtml } from './pages.ts';

Deno.test('slimHtml drops scripts, styles, svg and data URIs but keeps a script that builds an address', () => {
  const html = `<html><head><style>.a{}</style><script src="x.js"></script><script>var big = "${'x'.repeat(5000)}";</script></head><body>
  <img src="data:image/png;base64,${'A'.repeat(3000)}"> <svg><path d="M0 0"/></svg><!-- c -->
  <p>Founder: Jane Bloggs <a href="mailto:jane@x.io">jane@x.io</a></p>
  <script>var e = 'hello' + '@' + 'x.io';</script></body></html>`;
  const slim = slimHtml(html);
  assert(slim.length < 700, `${slim.length}`);
  assert(!/base64|<style|<svg|xxxx/.test(slim));
  const emails = extractEmails(slim, 'https://x.io/').map((e) => e.email).sort();
  assertEquals(emails, ['hello@x.io', 'jane@x.io']);
});

Deno.test('"(at)" in prose is not an address; a bracketed address with a real TLD still is (H10)', () => {
  const none = extractEmails('We meet (at) lunchtime. Then the office is free (at) weekends. Join us', 'https://oak.io/blog');
  assertEquals(none.map((e) => e.email), []);
  const real = extractEmails('Email the founders (at) oak (dot) io or talent [at] oak.co.uk', 'https://oak.io/contact');
  assertEquals(real.map((e) => e.email).sort(), ['founders@oak.io', 'talent@oak.co.uk']);
});
