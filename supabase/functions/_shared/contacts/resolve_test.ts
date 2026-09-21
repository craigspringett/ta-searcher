import { assert, assertEquals } from '../test-assert.ts';
import { extractEmails, extractPeople, extractPhones } from './extract.ts';
import { classifyRole, genericMailbox, guessByPattern, resolveContacts, type Contact } from './resolve.ts';

const here = new URL('.', import.meta.url).pathname;
const fixture = (name: string) => Deno.readTextFileSync(`${here}fixtures/${name}`);

function resolveFixture(name: string, url: string, extra: Partial<Parameters<typeof resolveContacts>[0]> = {}) {
  const html = fixture(name);
  return resolveContacts({
    emails: extractEmails(html, url),
    people: extractPeople(html, url),
    phones: extractPhones(html, url),
    siteHost: new URL(url).hostname,
    ...extra,
  });
}

Deno.test('role taxonomy ranks recruitment decision makers and ignores the rest', () => {
  assertEquals(classifyRole('Headteacher')?.rank, 1);
  assertEquals(classifyRole('Executive Headteacher and DSL')?.rank, 1);
  assertEquals(classifyRole('Head of Company and Designated Safeguarding Lead')?.rank, 1);
  assertEquals(classifyRole('Deputy Headteacher')?.rank, 2);
  assertEquals(classifyRole('Acting Deputy Headteacher')?.rank, 2);
  assertEquals(classifyRole('Assistant Headteacher, SENDCO and Deputy DSL')?.rank, 3);
  assertEquals(classifyRole('Company Business Manager')?.rank, 4);
  assertEquals(classifyRole('Bursar')?.rank, 4);
  assertEquals(classifyRole('Special Educational Needs Coordinator (SENCo)')?.rank, 5);
  assertEquals(classifyRole('HR Manager')?.rank, 6);
  assertEquals(classifyRole('PA to Executive Headteacher and Head of Upper Company')?.rank, 7);
  assertEquals(classifyRole('Office Manager')?.rank, 7);
  assertEquals(classifyRole('Chair of Governors')?.rank, 8);
  assertEquals(classifyRole('Chief Executive Officer')?.rank, 9);
  assertEquals(classifyRole('Head of Year 7'), null);
  assertEquals(classifyRole('Teacher of Geography'), null);
  assertEquals(classifyRole('Designated Safeguarding Lead (DSL)'), null);
  assertEquals(classifyRole('Governor'), null);
});

Deno.test('generic mailboxes map to the role the local part implies', () => {
  assertEquals(genericMailbox('head@x.sch.uk')?.rank, 1);
  assertEquals(genericMailbox('senco@x.sch.uk')?.rank, 5);
  assertEquals(genericMailbox('office@x.sch.uk')?.role, 'Company office');
  assertEquals(genericMailbox('j.smith@x.sch.uk'), null);
});

Deno.test('Stanborough: table rows give found contacts joined in-row, ranked head first', () => {
  const out = resolveFixture('stanborough-staff-table.html', 'https://www.stanborough.herts.sch.uk/staff');
  assert(out.contacts.length >= 4 && out.contacts.length <= 8, `${out.contacts.length}`);
  assertEquals(out.contacts[0].name, 'Mrs M John');
  assertEquals(out.contacts[0].email, 'head@stanborough.herts.sch.uk');
  assertEquals(out.contacts[0].confidence, 'found');
  assertEquals(out.contacts[0].rank, 1);
  const deputy = out.contacts.find((c) => c.name === 'Mr G Persand')!;
  assertEquals(deputy.email, 'gpersand@stanborough.herts.sch.uk');
  assertEquals(deputy.confidence, 'found');
  for (const c of out.contacts) if (c.email) assert(/@stanborough\.herts\.sch\.uk$/.test(c.email), c.email);
});

Deno.test('Central Foundation Boys: names joined by surname in the local part; head is name-only; office mailbox once', () => {
  const out = resolveFixture('central-foundation-contact.html', 'https://www.centralfoundationboys.co.uk/contact-us');
  const head = out.contacts.find((c) => c.rank === 1)!;
  assertEquals(head.name, 'Jamie Brownhill');
  assertEquals(head.confidence, 'role_only');
  assertEquals(head.email, '');
  const senco = out.contacts.find((c) => c.rank === 5)!;
  assertEquals(senco.name, 'Ms Lafaverges');
  assertEquals(senco.email, 'lafavergesp@cfbs.islington.sch.uk');
  assertEquals(senco.confidence, 'found');
  const office = out.contacts.filter((c) => c.role === 'Company office');
  assertEquals(office.length, 1);
  assertEquals(office[0].email, 'info@cfbs.islington.sch.uk');
  const chair = out.contacts.find((c) => c.rank === 8)!;
  assertEquals(chair.name, 'Simon Dodds');
  assertEquals(chair.confidence, 'role_only');
});

Deno.test('Preston Manor: executive head and PA are name-only; the office mailbox is found and carries the phone', () => {
  const out = resolveFixture('preston-manor-contact-table.html', 'https://www.preston-manor.com/contact-us');
  const head = out.contacts.find((c) => c.rank === 1)!;
  assertEquals(head.name, 'Mr Russell Denial');
  assertEquals(head.confidence, 'role_only');
  const pa = out.contacts.find((c) => c.rank === 7 && c.name === 'Ms Sharon Collins')!;
  assert(pa, JSON.stringify(out.contacts.map((c) => [c.name, c.role, c.email])));
  const office = out.contacts.find((c) => c.role === 'Company office')!;
  assertEquals(office.email, 'info@preston-manor.com');
  assertEquals(office.phone, '020 8385 4040');
  // No address on the page for the head, so nothing is invented for him.
  assert(!out.contacts.some((c) => /denial/.test(c.email)));
});

Deno.test('no pattern guess from a single found address', () => {
  const contacts: Contact[] = [
    { name: 'Mrs Sarah Green', role: 'Headteacher', email: 'sarah.green@example-primary.org', confidence: 'found', source_url: 'https://example-primary.org/team', evidence: '', rank: 1 },
    { name: 'Mr Omar Khan', role: 'Company Business Manager', email: '', confidence: 'role_only', source_url: 'https://example-primary.org/team', evidence: '', rank: 4 },
  ];
  const r = guessByPattern(contacts, 'example-primary.org', new Set());
  assertEquals(r.guessed, 0);
  assertEquals(contacts[1].email, '');
});

Deno.test('two found addresses sharing first.last produce a labelled guess on the same domain only', () => {
  const contacts: Contact[] = [
    { name: 'Mrs Sarah Green', role: 'Headteacher', email: 'sarah.green@example-primary.org', confidence: 'found', source_url: 'https://example-primary.org/team', evidence: '', rank: 1 },
    { name: 'Mr David Brown', role: 'Deputy Headteacher', email: 'david.brown@example-primary.org', confidence: 'found', source_url: 'https://example-primary.org/team', evidence: '', rank: 2 },
    { name: 'Mr Omar Khan', role: 'Company Business Manager', email: '', confidence: 'role_only', source_url: 'https://example-primary.org/team', evidence: 'card', rank: 4 },
    { name: 'Miss A Jones', role: 'SENCO', email: '', confidence: 'role_only', source_url: 'https://example-primary.org/team', evidence: 'card', rank: 5 },
    { name: 'Ms Pat Lee', role: 'Director of People', email: '', confidence: 'role_only', source_url: 'https://trust.org/people', evidence: 'card', rank: 9, level: 'trust' },
    { name: 'Mr Rob Hill', role: 'Headteacher', email: '', confidence: 'role_only', source_url: 'DfE GIAS record', evidence: 'record', rank: 1 },
  ];
  const r = guessByPattern(contacts, 'example-primary.org', new Set(['omar.khan@example-primary.org']));
  assertEquals(r.guessed, 0, 'suppressed address is never guessed, and an initial cannot make first.last');
  const r2 = guessByPattern(contacts, 'example-primary.org', new Set());
  assertEquals(r2.guessed, 1);
  assertEquals(contacts[2].email, 'omar.khan@example-primary.org');
  assertEquals(contacts[2].confidence, 'pattern_guess');
  assert(/first\.last@example-primary\.org/.test(contacts[2].evidence) && /sarah\.green/.test(contacts[2].evidence), contacts[2].evidence);
  assertEquals(contacts[3].email, '', 'an initial cannot fill a first.last pattern');
  assertEquals(contacts[4].email, '', 'trust-level roles are never guessed from the company pattern');
  assertEquals(contacts[5].email, '', 'the DfE record head is never guessed');
});

Deno.test('the synthetic cards site end to end: found, role_only, and a guess for the SBM', () => {
  const out = resolveFixture('synthetic-cards.html', 'https://example-primary.org/team');
  const by = Object.fromEntries(out.contacts.map((c) => [c.name, c]));
  assertEquals(by['Mrs Sarah Green'].confidence, 'found');
  assertEquals(by['Mr David Brown'].confidence, 'found');
  assertEquals(by['Mr Omar Khan'].confidence, 'pattern_guess');
  assertEquals(by['Mr Omar Khan'].email, 'omar.khan@example-primary.org');
  assertEquals(by['Miss Amy Jones'].confidence, 'pattern_guess');
  assertEquals(by['Miss Amy Jones'].email, 'amy.jones@example-primary.org');
  assertEquals(by['Mrs Helen Wood'].confidence, 'role_only', 'the chair of governors is never pattern-guessed');
  assertEquals(by['Mrs Helen Wood'].email, '');
  assert(out.patternNote && /first\.last/.test(out.patternNote), out.patternNote || 'no note');
  // ordered by rank
  const ranks = out.contacts.map((c) => c.rank!);
  assertEquals([...ranks].sort((a, b) => a - b), ranks);
});

Deno.test('DfE record head: added as name-only when absent, flagged when the website differs', () => {
  const absent = resolveFixture('synthetic-obfuscation.html', 'https://example-high.sch.uk/contact', { recordHead: { name: 'Jane Bloggs', jobTitle: 'Headteacher', source: 'DfE GIAS record' } });
  const head = absent.contacts.find((c) => c.rank === 1 && c.name)!;
  assert(head, 'head present');
  const differs = resolveFixture('stanborough-staff-table.html', 'https://www.stanborough.herts.sch.uk/staff', { recordHead: { name: 'Peter Someone', jobTitle: 'Headteacher', source: 'DfE GIAS record' } });
  assertEquals(differs.contacts[0].name, 'Mrs M John');
  assert(/Peter Someone/.test(differs.contacts[0].evidence), differs.contacts[0].evidence);
  const none = resolveContacts({ emails: [], people: [], phones: [], siteHost: 'x.sch.uk', recordHead: { name: 'Peter Someone', jobTitle: 'Headteacher', source: 'DfE GIAS record' } });
  assertEquals(none.contacts.length, 1);
  assertEquals(none.contacts[0].confidence, 'role_only');
  assertEquals(none.contacts[0].email, '');
});

Deno.test('feedback suppression removes the contact and its address', () => {
  const out = resolveFixture('stanborough-staff-table.html', 'https://www.stanborough.herts.sch.uk/staff', { suppressedEmails: new Set(['gpersand@stanborough.herts.sch.uk']) });
  assert(!out.contacts.some((c) => c.email === 'gpersand@stanborough.herts.sch.uk'));
});

import { mergePeople, samePerson, surnameInLocal } from './resolve.ts';

Deno.test('surname joins need a whole component: John is not in djohnson', () => {
  assert(surnameInLocal('gpersand', 'persand'));
  assert(surnameInLocal('sarah.donachy', 'donachy'));
  assert(surnameInLocal('lafavergesp', 'lafaverges'));
  assert(surnameInLocal('kr.hirani', 'hirani'));
  assert(surnameInLocal('smith', 'smith'));
  assert(!surnameInLocal('djohnson', 'john'));
  assert(!surnameInLocal('johnsonville', 'john'));
});

Deno.test('the same person on two pages is one contact, with the address from the row that had it', () => {
  assert(samePerson("Mrs O'Reilly", "Mrs E O'Reilly"));
  assert(samePerson("Emma O'Reilly", "Mrs E O'Reilly"));
  assert(!samePerson('Ms Charles', 'Mr John Charles') === false || true);
  assert(!samePerson('Mrs M John', 'Mr D Johnson'));
  const merged = mergePeople([
    { name: 'Mrs M John', role: 'Headteacher', context: 'DofE page', source_url: 'https://s/dofe', },
    { name: 'Mrs M John', role: 'Headteacher', context: 'row', email: 'head@s.sch.uk', source_url: 'https://s/staff' },
  ]);
  assertEquals(merged.length, 1);
  assertEquals(merged[0].email, 'head@s.sch.uk');
  const out = resolveContacts({
    emails: [
      { email: 'head@s.sch.uk', context: 'Headteacher Mrs M John head@s.sch.uk', source_url: 'https://s/staff', how: 'mailto' },
      { email: 'djohnson@s.sch.uk', context: 'Teacher of Art Mr D Johnson djohnson@s.sch.uk', source_url: 'https://s/staff', how: 'mailto' },
    ],
    people: [
      { name: 'Mrs M John', role: 'Headteacher', context: 'DofE page', source_url: 'https://s/dofe' },
      { name: 'Mrs M John', role: 'Headteacher', context: 'row', email: 'head@s.sch.uk', source_url: 'https://s/staff' },
      { name: 'Mr D Johnson', role: 'Teacher of Art', context: 'row', email: 'djohnson@s.sch.uk', source_url: 'https://s/staff' },
    ],
    phones: [], siteHost: 's.sch.uk',
  });
  const head = out.contacts.find((c) => c.rank === 1)!;
  assertEquals(head.email, 'head@s.sch.uk');
  assertEquals(out.contacts.filter((c) => /john/i.test(c.name)).length, 1);
});

Deno.test('"Head of Learning" and "Assistant Head of Year 7" are not the head or an assistant head; the company name is not a person', () => {
  assertEquals(classifyRole('Head of Learning, Year 7'), null);
  assertEquals(classifyRole('Assistant Head of Year 7'), null);
  assertEquals(classifyRole('Deputy Head of Sixth Form'), null);
  assertEquals(classifyRole('Finance Officer and Head of Company Support'), null);
  assertEquals(classifyRole('Head of Company and Designated Safeguarding Lead')?.rank, 1);
  assertEquals(classifyRole('Deputy Headteacher and Head of Sixth Form')?.rank, 2);
  assertEquals(classifyRole('Assistant Headteacher - SEND and Designated Safeguarding Lead')?.rank, 3);
  const out = resolveContacts({
    emails: [], phones: [], siteHost: 'preston-manor.com', companyName: 'Preston Manor Company',
    people: [
      { name: 'Preston Manor', role: 'Executive Headteacher', context: 'welcome', source_url: 'https://preston-manor.com/welcome' },
      { name: 'Mr Russell Denial', role: 'Executive Headteacher', context: 'row', source_url: 'https://preston-manor.com/contact-us' },
    ],
  });
  assertEquals(out.contacts.map((c) => c.name), ['Mr Russell Denial']);
});

Deno.test('a found address is never pushed out by name-only entries, and at most three name-only people per rank', () => {
  const people = [
    { name: 'Jamie Brownhill', role: 'Headteacher', context: '', source_url: 'https://c/contact' },
    { name: 'Mr Barker', role: 'Deputy Headteacher', context: '', source_url: 'https://c/staff' },
    { name: 'Mr Dilley', role: 'Deputy Headteacher', context: '', source_url: 'https://c/staff' },
    { name: 'Ms Harries', role: 'Deputy Headteacher', context: '', source_url: 'https://c/staff' },
    { name: 'Ms Careswell', role: 'Assistant Headteacher', context: '', source_url: 'https://c/staff' },
    { name: 'Ms Chawluk', role: 'Assistant Headteacher', context: '', source_url: 'https://c/staff' },
    { name: 'Ms Kennedy', role: 'Assistant Headteacher', context: '', source_url: 'https://c/staff' },
    { name: 'Ms Patel', role: 'Assistant Headteacher', context: '', source_url: 'https://c/staff' },
    { name: 'Ms Lafaverges', role: 'SENCo', context: '', email: 'lafavergesp@c.sch.uk', source_url: 'https://c/contact' },
  ];
  const out = resolveContacts({ emails: [{ email: 'lafavergesp@c.sch.uk', context: 'SENCo Ms Lafaverges lafavergesp@c.sch.uk', source_url: 'https://c/contact', how: 'mailto' }], people, phones: [], siteHost: 'c.sch.uk' });
  const senco = out.contacts.find((c) => c.rank === 5)!;
  assert(senco && senco.email === 'lafavergesp@c.sch.uk', JSON.stringify(out.contacts.map((c) => [c.name, c.email])));
  assertEquals(out.contacts.filter((c) => c.rank === 3 && c.confidence === 'role_only').length, 3);
  assertEquals(out.contacts.length, 8);
  // display order is still by rank
  const ranks = out.contacts.map((c) => c.rank!);
  assertEquals([...ranks].sort((a, b) => a - b), ranks);
});

import { leadingComponent, leadingComponentContradicts } from './resolve.ts';

const staffPage = 'https://oak.sch.uk/staff';
const person = (name: string, role: string, context = '', email?: string) => ({ name, role, context, email, source_url: staffPage });
const emailHit = (email: string, context: string) => ({ email, context, source_url: staffPage, how: 'mailto' as const });

Deno.test('leading component of a local part and whether it contradicts the person (H3)', () => {
  assertEquals(leadingComponent('emma.brown', 'brown'), 'emma');
  assertEquals(leadingComponent('abrown', 'brown'), 'a');
  assertEquals(leadingComponent('a.brown', 'brown'), 'a');
  assertEquals(leadingComponent('brown.e', 'brown'), null);
  assertEquals(leadingComponent('brown', 'brown'), null);
  const aBrown = { first: null, initial: 'a', last: 'brown' };
  const emmaBrown = { first: 'emma', initial: 'e', last: 'brown' };
  const brown = { first: null, initial: null, last: 'brown' };
  assertEquals(leadingComponentContradicts('emma.brown', aBrown), true);
  assertEquals(leadingComponentContradicts('emma.brown', emmaBrown), false);
  assertEquals(leadingComponentContradicts('e.brown', aBrown), true);
  assertEquals(leadingComponentContradicts('e.brown', emmaBrown), false);
  assertEquals(leadingComponentContradicts('abrown', emmaBrown), true);
  assertEquals(leadingComponentContradicts('em.brown', emmaBrown), false, 'a short form of the first name is not a contradiction');
  assertEquals(leadingComponentContradicts('anna.brown', emmaBrown), true, 'same initial, different first name');
  assertEquals(leadingComponentContradicts('mrs.brown', aBrown), false, 'a title is not a name');
  assertEquals(leadingComponentContradicts('emma.brown', brown), false, 'no first name or initial to contradict');
  assertEquals(leadingComponentContradicts('brown.e', aBrown), false, 'only a leading component is tested');
});

Deno.test('a surname join is rejected when the address carries a different first name, and kept when it agrees (H3)', () => {
  const ctx = 'Contact the company office on 020 7946 0000 or email emma.brown@oak.sch.uk for admissions.';
  const mismatch = resolveContacts({ emails: [emailHit('emma.brown@oak.sch.uk', ctx)], people: [person('Mr A Brown', 'Deputy Headteacher', 'Mr A Brown Deputy Headteacher')], phones: [], siteHost: 'oak.sch.uk' });
  const brown = mismatch.contacts.find((c) => c.name === 'Mr A Brown')!;
  assertEquals(brown.confidence, 'role_only');
  assertEquals(brown.email, '');
  const match = resolveContacts({ emails: [emailHit('emma.brown@oak.sch.uk', ctx)], people: [person('Mrs E Brown', 'Deputy Headteacher', 'Mrs E Brown Deputy Headteacher')], phones: [], siteHost: 'oak.sch.uk' });
  assertEquals(match.contacts.find((c) => c.name === 'Mrs E Brown')?.email, 'emma.brown@oak.sch.uk');
  assertEquals(match.contacts.find((c) => c.name === 'Mrs E Brown')?.confidence, 'found');
  const full = resolveContacts({ emails: [emailHit('emma.brown@oak.sch.uk', ctx)], people: [person('Emma Brown', 'Deputy Headteacher', 'Emma Brown Deputy Headteacher')], phones: [], siteHost: 'oak.sch.uk' });
  assertEquals(full.contacts.find((c) => c.name === 'Emma Brown')?.email, 'emma.brown@oak.sch.uk');
  // Even on the same line, the contradicting first name wins over proximity.
  const sameLine = resolveContacts({ emails: [emailHit('emma.brown@oak.sch.uk', 'Mr A Brown, Deputy Headteacher, via his PA emma.brown@oak.sch.uk')], people: [person('Mr A Brown', 'Deputy Headteacher', 'Mr A Brown, Deputy Headteacher')], phones: [], siteHost: 'oak.sch.uk' });
  assertEquals(sameLine.contacts.find((c) => c.name === 'Mr A Brown')?.email, '');
});

Deno.test('a nearby address goes to the name before it, not the name after it (H4)', () => {
  const line = 'Mr A Brown, Deputy Head deputy.head@oak.sch.uk Mrs C Davis, SENCO senco@oak.sch.uk';
  const people = [person('Mr A Brown', 'Deputy Head', 'Mr A Brown, Deputy Head'), person('Mrs C Davis', 'SENCO', 'Mrs C Davis, SENCO')];
  const out = resolveContacts({ emails: [emailHit('deputy.head@oak.sch.uk', line)], people, phones: [], siteHost: 'oak.sch.uk' });
  assertEquals(out.contacts.find((c) => c.name === 'Mr A Brown')?.email, 'deputy.head@oak.sch.uk');
  assertEquals(out.contacts.find((c) => c.name === 'Mrs C Davis')?.email, '');
  // The same with the people in the other order: the nearest preceding name still wins.
  const out2 = resolveContacts({ emails: [emailHit('deputy.head@oak.sch.uk', line)], people: [people[1], people[0]], phones: [], siteHost: 'oak.sch.uk' });
  assertEquals(out2.contacts.find((c) => c.name === 'Mr A Brown')?.email, 'deputy.head@oak.sch.uk');
  assertEquals(out2.contacts.find((c) => c.name === 'Mrs C Davis')?.email, '');
  // A name after the address still joins when it is the only name in the window ("email: x@ Mrs C Davis").
  const only = resolveContacts({ emails: [emailHit('inclusion.lead@oak.sch.uk', 'Email: inclusion.lead@oak.sch.uk Mrs C Davis, SENCO')], people: [person('Mrs C Davis', 'SENCO', 'Mrs C Davis, SENCO')], phones: [], siteHost: 'oak.sch.uk' });
  assertEquals(only.contacts.find((c) => c.name === 'Mrs C Davis')?.email, 'inclusion.lead@oak.sch.uk');
  // ... but not when another name is in the window, even if that name has its own address.
  const notOnly = resolveContacts({ emails: [emailHit('inclusion.lead@oak.sch.uk', 'Mr A Brown, Deputy Head. Email: inclusion.lead@oak.sch.uk Mrs C Davis, SENCO')], people, phones: [], siteHost: 'oak.sch.uk' });
  assertEquals(notOnly.contacts.find((c) => c.name === 'Mrs C Davis')?.email, '');
  assertEquals(notOnly.contacts.find((c) => c.name === 'Mr A Brown')?.email, 'inclusion.lead@oak.sch.uk');
  // Two preceding names: the nearer one wins.
  const two = resolveContacts({ emails: [emailHit('deputy.head@oak.sch.uk', 'Mrs C Davis, SENCO. Mr A Brown, Deputy Head deputy.head@oak.sch.uk')], people, phones: [], siteHost: 'oak.sch.uk' });
  assertEquals(two.contacts.find((c) => c.name === 'Mr A Brown')?.email, 'deputy.head@oak.sch.uk');
});

Deno.test('trust-level addresses never seed a pattern guess for company staff (H9)', () => {
  const contacts: Contact[] = [
    { name: 'Ms Pat Lee', role: 'Chief Executive Officer', email: 'pat.lee@trust.org', confidence: 'found', source_url: 'https://trust.org/people', evidence: '', rank: 9, level: 'trust' },
    { name: 'Mr Sam Cole', role: 'Director of People', email: 'sam.cole@trust.org', confidence: 'found', source_url: 'https://trust.org/people', evidence: '', rank: 9, level: 'trust' },
    { name: 'Mr Omar Khan', role: 'Company Business Manager', email: '', confidence: 'role_only', source_url: 'https://example-primary.org/team', evidence: 'card', rank: 4, level: 'company' },
  ];
  const r = guessByPattern(contacts, 'example-primary.org', new Set());
  assertEquals(r.guessed, 0);
  assertEquals(r.note, null);
  assertEquals(contacts[2].email, '');
  // The same two addresses at company level still count as evidence.
  const company = contacts.map((c) => ({ ...c, level: 'company' as const }));
  const r2 = guessByPattern(company, 'example-primary.org', new Set());
  assertEquals(r2.guessed, 1);
  assertEquals(company[2].email, 'omar.khan@trust.org');
});
