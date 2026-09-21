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
  assertEquals(decodeEntities('t&#46;patel&#64;example&#x2e;sch&period;uk'), 't.patel@example.sch.uk');
  assertEquals(decodeEntities('a&commat;b.c'), 'a@b.c');
});

Deno.test('normaliseEmail lowercases, strips mailto/subject and rejects assets and placeholders', () => {
  assertEquals(normaliseEmail('MAILTO:Head@Company.sch.uk?subject=Hi'), 'head@company.sch.uk');
  assertEquals(normaliseEmail('hero@2x.png'), null);
  assertEquals(normaliseEmail('name@example.com'), null);
  assertEquals(normaliseEmail('noreply@company.sch.uk'), null);
  assertEquals(normaliseEmail('(office@company.sch.uk).'), 'office@company.sch.uk');
});

Deno.test('every obfuscation form on the synthetic contact page is recovered, and assets are not', () => {
  const hits = extractEmails(fixture('synthetic-obfuscation.html'), 'https://example-high.sch.uk/contact');
  assertEquals(emailsOf(hits), [
    'admin@example-high.sch.uk',
    'alan.reid@governors.example-high.sch.uk',
    'j.bloggs@example-high.sch.uk',
    'office@example-high.sch.uk',
    'p.shah@example-high.sch.uk',
    'reception@example-high.sch.uk',
    't.patel@example-high.sch.uk',
  ]);
  const by = Object.fromEntries(hits.map((h) => [h.email, h]));
  assertEquals(by['j.bloggs@example-high.sch.uk'].how, 'cfemail');
  assertEquals(by['t.patel@example-high.sch.uk'].how, 'entity');
  assertEquals(by['p.shah@example-high.sch.uk'].how, 'obfuscated');
  assertEquals(by['admin@example-high.sch.uk'].how, 'js');
  assertEquals(by['reception@example-high.sch.uk'].how, 'js');
  assertEquals(by['office@example-high.sch.uk'].how, 'mailto');
  assertEquals(by['office@example-high.sch.uk'].linkText, 'Email the office');
  assert(by['j.bloggs@example-high.sch.uk'].context.includes('Mrs Jane Bloggs'), 'context carries the name next to the address');
  assert(by['t.patel@example-high.sch.uk'].context.includes('Business Manager'));
});

Deno.test('mailto and plain addresses on the Stanborough staff table, with row context', () => {
  const hits = extractEmails(fixture('stanborough-staff-table.html'), 'https://www.stanborough.herts.sch.uk/staff');
  assert(hits.length >= 8, `found ${hits.length}`);
  const head = hits.find((h) => h.email === 'head@stanborough.herts.sch.uk')!;
  assert(head, 'head@ found');
  assert(/Headteacher/.test(head.context) && /John/.test(head.context), head.context);
  const g = hits.find((h) => h.email === 'gpersand@stanborough.herts.sch.uk')!;
  assert(/Persand/.test(g.context), g.context);
});

Deno.test('javascript:mt() and http://user@host hrefs on the Preston Manor table', () => {
  const hits = extractEmails(fixture('preston-manor-contact-table.html'), 'https://www.preston-manor.com/contact-us');
  const e = emailsOf(hits);
  assert(e.includes('info@preston-manor.com'), e.join(','));
  assert(e.includes('safeguarding@preston-manor.com'), e.join(','));
});

Deno.test('people from a Title/Name/Email table (Stanborough)', () => {
  const people = extractPeople(fixture('stanborough-staff-table.html'), 'https://www.stanborough.herts.sch.uk/staff');
  const by = Object.fromEntries(people.map((p) => [p.name, p]));
  assert(by['Mrs M John'], Object.keys(by).join(' | '));
  assertEquals(by['Mrs M John'].role, 'Headteacher');
  assertEquals(by['Mrs M John'].email, 'head@stanborough.herts.sch.uk');
  assertEquals(by['Mr G Persand'].role, 'Deputy Headteacher');
  assertEquals(by['Mr G Persand'].email, 'gpersand@stanborough.herts.sch.uk');
  assertEquals(by['Mrs N Abrahams'].role, 'Assistant Headteacher');
});

Deno.test('people from a label/value table (Preston Manor)', () => {
  const people = extractPeople(fixture('preston-manor-contact-table.html'), 'https://www.preston-manor.com/contact-us');
  const by = Object.fromEntries(people.map((p) => [p.name, p]));
  assert(by['Mr Russell Denial'], Object.keys(by).join(' | '));
  assertEquals(by['Mr Russell Denial'].role, 'Executive Headteacher');
  assert(by['Ms Sharon Collins'], 'PA found');
  assert(/PA to Executive Headteacher/.test(by['Ms Sharon Collins'].role), by['Ms Sharon Collins'].role);
  assert(by['Ms Zalika Dale'], 'DSL found');
});

Deno.test('people from inline "Role - Name" accordion text (Our Lady\'s Camden)', () => {
  const people = extractPeople(fixture('ourladys-camden-accordion.html'), 'https://www.ourladys.camden.sch.uk/our-staff');
  const by = Object.fromEntries(people.map((p) => [p.name, p]));
  assert(by['Ms M Richardson'], Object.keys(by).join(' | '));
  assertEquals(by['Ms M Richardson'].role, 'Executive Headteacher');
  assert(by["Mrs E O'Reilly"] || by['Mrs E O’Reilly'], 'Head of Company found: ' + Object.keys(by).join(' | '));
  assert(by['Mrs E Robbins'] && /SENDCO/.test(by['Mrs E Robbins'].role), 'SENDCO found');
  // Class teachers with year groups are not roles
  assert(!by['Ms Ibrahim'] || !/Y6/.test(by['Ms Ibrahim'].role));
});

Deno.test('people from "Role: </strong>Name<br>" contact blocks (Central Foundation Boys)', () => {
  const people = extractPeople(fixture('central-foundation-contact.html'), 'https://www.centralfoundationboys.co.uk/contact-us');
  const by = Object.fromEntries(people.map((p) => [p.name, p]));
  assert(by['Jamie Brownhill'], Object.keys(by).join(' | '));
  assertEquals(by['Jamie Brownhill'].role, 'Headteacher');
  assert(by['Simon Dodds'] && /Chair of Governors/.test(by['Simon Dodds'].role), 'chair found');
  assert(by['Ms Lafaverges'] && /SENCo/i.test(by['Ms Lafaverges'].role), 'SENCo found: ' + JSON.stringify(by['Ms Lafaverges']));
  assertEquals(by['Ms Lafaverges'].email, 'lafavergesp@cfbs.islington.sch.uk');
});

Deno.test('people from card grids and definition lists, with the stop list applied', () => {
  const people = extractPeople(fixture('synthetic-cards.html'), 'https://example-primary.org/team');
  const by = Object.fromEntries(people.map((p) => [p.name, p]));
  assertEquals(by['Mrs Sarah Green'].role, 'Headteacher');
  assertEquals(by['Mrs Sarah Green'].email, 'sarah.green@example-primary.org');
  assertEquals(by['Mr David Brown'].email, 'david.brown@example-primary.org');
  assert(/SENCO/.test(by['Miss Amy Jones'].role));
  assertEquals(by['Mr Omar Khan'].role, 'Company Business Manager');
  assertEquals(by['Mrs Helen Wood'].role, 'Chair of Governors');
  assertEquals(by['Ms Ann Lee'].email, 'clerk@example-primary.org');
  assert(!by['Year Class'] && !by['Welcome to Our Company'] && !by['Ofsted Good'], Object.keys(by).join(' | '));
});

Deno.test('looksLikeName and looksLikeRole guard against page furniture', () => {
  assert(looksLikeName('Mrs M John'));
  assert(looksLikeName('Jamie Brownhill'));
  assert(looksLikeName("Mrs E O'Reilly"));
  assert(!looksLikeName('Welcome To Our Company'));
  assert(!looksLikeName('Head Of Company'));
  assert(!looksLikeName('Mrs'));
  assert(!looksLikeName('Year Class'));
  assert(!looksLikeName('Mandarin Success'));
  assert(looksLikeRole('Executive Headteacher'));
  assert(looksLikeRole('PA to the Headteacher'));
  assert(!looksLikeRole('Y6'));
});

Deno.test('phones near tel/phone and in tel: links, UK format', () => {
  const hits = extractPhones('<a href="tel:+442079460123">Call</a> <p>Telephone: 020 7946 0123</p> <p>Fax 020 7946 9999</p>', 'https://x');
  assertEquals(hits.map((h) => h.phone), ['020 7946 0123']);
});

Deno.test('names shed trailing role words and possessives; roles shed "Welcome from"', () => {
  const html = `<table><tr><td>Acting Headteacher - Operational</td><td>Mr Sear's Office</td><td><a href="mailto:asrpa@x.sch.uk">asrpa@x.sch.uk</a></td></tr>
  <tr><td>EA to the Principal</td><td>Ms Bailey Administration</td></tr>
  <tr><td>Welcome From Our Principal</td><td>Ms Georgina Charles</td><td>g.charles@x.sch.uk</td></tr>
  <tr><td>Acting Assistant Headteacher</td><td>Mr. Stephen Wallman Acting Assistant</td></tr></table>`;
  const people = extractPeople(html, 'https://x.sch.uk/staff');
  const by = Object.fromEntries(people.map((p) => [p.name, p]));
  assert(by['Mr Sear'], Object.keys(by).join(' | '));
  assertEquals(by['Mr Sear'].email, 'asrpa@x.sch.uk');
  assert(by['Ms Bailey'], Object.keys(by).join(' | '));
  assertEquals(by['Ms Georgina Charles'].role, 'Principal');
  assert(by['Mr. Stephen Wallman'], Object.keys(by).join(' | '));
});

import { slimHtml } from './pages.ts';

Deno.test('slimHtml drops scripts, styles, svg and data URIs but keeps a script that builds an address', () => {
  const html = `<html><head><style>.a{}</style><script src="x.js"></script><script>var big = "${'x'.repeat(5000)}";</script></head><body>
  <img src="data:image/png;base64,${'A'.repeat(3000)}"> <svg><path d="M0 0"/></svg><!-- c -->
  <p>Headteacher: Mrs J Bloggs <a href="mailto:head@x.sch.uk">head@x.sch.uk</a></p>
  <script>var e = 'admin' + '@' + 'x.sch.uk';</script></body></html>`;
  const slim = slimHtml(html);
  assert(slim.length < 700, `${slim.length}`);
  assert(!/base64|<style|<svg|xxxx/.test(slim));
  const emails = extractEmails(slim, 'https://x.sch.uk/').map((e) => e.email).sort();
  assertEquals(emails, ['admin@x.sch.uk', 'head@x.sch.uk']);
});

Deno.test('"(at)" in prose is not an address; a bracketed address with a real TLD still is (H10)', () => {
  const none = extractEmails('Sports clubs run (at) lunchtime. Then the hall is free (at) weekends. Join us', 'https://oak.sch.uk/clubs');
  assertEquals(none.map((e) => e.email), []);
  const real = extractEmails('Email the head (at) oak (dot) sch (dot) uk or admin [at] oak.herts.sch.uk', 'https://oak.sch.uk/contact');
  assertEquals(real.map((e) => e.email).sort(), ['admin@oak.herts.sch.uk', 'head@oak.sch.uk']);
});
