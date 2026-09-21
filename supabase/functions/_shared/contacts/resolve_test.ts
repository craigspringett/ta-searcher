import { assert, assertEquals } from '../test-assert.ts';
import { extractEmails, extractPeople, extractPhones } from './extract.ts';
import { classifyRole, GENERAL_MAILBOX_ROLE, genericMailbox, guessByPattern, INVESTOR_RANK, resolveContacts, roleLabel, type Contact } from './resolve.ts';

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

Deno.test('role taxonomy: founder, coo, cto, people, talent, exec, ea, investor in rank order; the rest are not decision makers', () => {
  assertEquals(classifyRole('Founder')?.rank, 1);
  assertEquals(classifyRole('Co-founder and CEO')?.key, 'founder');
  assertEquals(classifyRole('Co-founder and CTO')?.key, 'founder');
  assertEquals(classifyRole('Chief Executive Officer')?.key, 'founder');
  assertEquals(classifyRole('COO')?.rank, 2);
  assertEquals(classifyRole('Chief of Staff')?.key, 'coo');
  assertEquals(classifyRole('Head of Operations')?.key, 'coo');
  assertEquals(classifyRole('VP Operations')?.key, 'coo');
  assertEquals(classifyRole('CTO')?.rank, 3);
  assertEquals(classifyRole('VP Engineering')?.key, 'cto');
  assertEquals(classifyRole('Head of Engineering')?.key, 'cto');
  assertEquals(classifyRole('Chief People Officer')?.rank, 4);
  assertEquals(classifyRole('Director of People')?.key, 'people');
  assertEquals(classifyRole('People Partner')?.key, 'people');
  assertEquals(classifyRole('Head of Talent')?.key, 'talent');
  assertEquals(classifyRole('Head of Talent')?.rank, 5);
  assertEquals(classifyRole('Head of Recruitment')?.key, 'talent');
  assertEquals(classifyRole('Talent Partner')?.key, 'talent');
  assertEquals(classifyRole('Senior Technical Recruiter')?.key, 'talent');
  assertEquals(classifyRole('Chief Product Officer')?.key, 'exec');
  assertEquals(classifyRole('VP Sales')?.key, 'exec');
  assertEquals(classifyRole('Director of Marketing')?.key, 'exec');
  assertEquals(classifyRole('Chief Marketing Officer')?.rank, 6);
  assertEquals(classifyRole('EA to the CEO')?.key, 'ea');
  assertEquals(classifyRole('Executive Assistant')?.rank, 7);
  assertEquals(classifyRole('Office Manager')?.key, 'ea');
  assertEquals(classifyRole('Partner, Headline')?.key, 'investor');
  assertEquals(classifyRole('Partner, Headline')?.rank, INVESTOR_RANK);
  assertEquals(classifyRole('Non-executive Director')?.key, 'investor');
  assertEquals(classifyRole('Board member')?.key, 'investor');
  assertEquals(classifyRole('Angel investor')?.key, 'investor');
  assertEquals(classifyRole('Account Executive'), null);
  assertEquals(classifyRole('Customer Success Manager'), null);
  assertEquals(classifyRole('Engineering Manager'), null);
  assertEquals(classifyRole('Founding Engineer'), null);
  assertEquals(classifyRole('Senior Software Engineer'), null);
  assertEquals(classifyRole('Investor Relations Manager'), null);
  assertEquals(classifyRole('Product Designer'), null);
  assertEquals(roleLabel('Head of Talent Acquisition'), 'Head of Talent');
  assertEquals(roleLabel('Co-founder'), 'Founder / CEO');
  assertEquals(roleLabel('Partner at Seedcamp'), 'Investor / Board', 'a partner at a fund is an investor');
  assertEquals(classifyRole('Partnerships Manager'), null);
  assertEquals(classifyRole('General Partner, Seedcamp')?.key, 'investor');
});

Deno.test('generic mailboxes: the ranked ones map to a role, the deny list never shows, a person\'s address is not generic', () => {
  assertEquals(genericMailbox('founders@x.io')?.rank, 1);
  assertEquals(genericMailbox('people@x.io')?.rank, 4);
  assertEquals(genericMailbox('careers@x.io')?.rank, 5);
  assertEquals(genericMailbox('jobs@x.io')?.role, 'Careers mailbox');
  assertEquals(genericMailbox('talent@x.io')?.rank, 5);
  assertEquals(genericMailbox('recruiting@x.io')?.rank, 5);
  assertEquals(genericMailbox('hiring@x.io')?.rank, 5);
  for (const g of ['hello', 'hi', 'team', 'info', 'contact']) assertEquals(genericMailbox(`${g}@x.io`)?.role, GENERAL_MAILBOX_ROLE, g);
  for (const d of ['press', 'media', 'support', 'help', 'sales', 'privacy', 'legal', 'security', 'billing', 'abuse', 'dpo', 'partnerships', 'investors', 'noreply', 'no-reply']) assertEquals(genericMailbox(`${d}@x.io`)?.rank, -1, d);
  assertEquals(genericMailbox('j.smith@x.io'), null);
});

Deno.test('the team cards site end to end: founders found in-card, name-only leaders, a guess for the Head of Talent, investors never guessed', () => {
  const out = resolveFixture('startup-team-cards.html', 'https://lumenly.ai/team', { maxContacts: 12 });
  const by = Object.fromEntries(out.contacts.map((c) => [c.name, c]));
  assertEquals(by['Sarah Green'].confidence, 'found');
  assertEquals(by['Sarah Green'].email, 'sarah.green@lumenly.ai');
  assertEquals(by['Sarah Green'].rank, 1);
  assertEquals(by['David Brown'].confidence, 'found');
  assertEquals(by['David Brown'].email, 'david.brown@lumenly.ai');
  assertEquals(by['David Brown'].rank, 1, 'a co-founder and CTO is a founder');
  assertEquals(by['Omar Khan'].confidence, 'pattern_guess');
  assertEquals(by['Omar Khan'].email, 'omar.khan@lumenly.ai');
  assertEquals(by['Amy Jones'].confidence, 'pattern_guess');
  assertEquals(by['Amy Jones'].rank, 2);
  assertEquals(by['Priya Shah'].rank, 4);
  assertEquals(by['Helen Wood'].confidence, 'role_only', 'the fund partner is never pattern-guessed');
  assertEquals(by['Helen Wood'].email, '');
  assertEquals(by['Helen Wood'].rank, INVESTOR_RANK);
  assert(!by['Ben Carter'], 'an account executive is not a decision maker');
  assert(!by['Lucy Moore'], 'an engineering manager is not a decision maker');
  assert(!by['Series A'] && !by['Open Roles'], Object.keys(by).join(' | '));
  assert(out.patternNote && /first\.last@lumenly\.ai/.test(out.patternNote), out.patternNote || 'no note');
  const ranks = out.contacts.map((c) => c.rank!);
  assertEquals([...ranks].sort((a, b) => a - b), ranks, 'ordered by rank');
  assert(!out.contacts.some((c) => c.email === 'press@lumenly.ai'), 'the press mailbox never shows');
  assert(!out.contacts.some((c) => c.email === 'lucy.moore@lumenly.ai'), 'an engineering manager\'s address is not a contact');
});

Deno.test('the leadership table: rows joined in-row and by surname in the local part, the general mailbox once with the phone, the NED name-only', () => {
  const out = resolveFixture('startup-team-table.html', 'https://fathom-robotics.co.uk/leadership');
  const by = Object.fromEntries(out.contacts.map((c) => [c.name, c]));
  assertEquals(by['Grace Persand'].email, 'grace@fathom-robotics.co.uk');
  assertEquals(by['Grace Persand'].confidence, 'found');
  assertEquals(by['Grace Persand'].rank, 1);
  assertEquals(by['Marcus Donachy'].email, 'm.donachy@fathom-robotics.co.uk');
  assertEquals(by['Marcus Donachy'].rank, 3);
  assertEquals(by['Kate Hirani'].email, 'kr.hirani@fathom-robotics.co.uk', 'a surname in the local part joins the talent partner');
  assertEquals(by['Kate Hirani'].confidence, 'found');
  assertEquals(by['Nadia Hirani'].email, '', 'the other Hirani does not get the address: the leading component contradicts');
  assertEquals(by['Nadia Hirani'].confidence, 'role_only');
  assertEquals(by['Tom Lafaverges'].confidence, 'role_only');
  assertEquals(by['Simon Dodds'].rank, INVESTOR_RANK);
  assertEquals(by['Simon Dodds'].confidence, 'role_only');
  const general = out.contacts.filter((c) => c.role === GENERAL_MAILBOX_ROLE);
  assertEquals(general.length, 1);
  assertEquals(general[0].email, 'info@fathom-robotics.co.uk');
  assertEquals(general[0].phone, '020 7946 0200');
  assert(!out.contacts.some((c) => c.email === 'chloe@fathom-robotics.co.uk'), 'customer success is not a contact');
  // grace@ and m.donachy@ do not share a pattern, so nothing is guessed for the name-only people.
  assertEquals(out.patternNote, null);
  for (const c of out.contacts) if (c.email) assert(/@fathom-robotics\.co\.uk$/.test(c.email), c.email);
});

Deno.test('the obfuscated about page: every decoded address joins its person; deny-listed mailboxes never show', () => {
  const out = resolveFixture('startup-about-obfuscated.html', 'https://example-health.io/about');
  const by = Object.fromEntries(out.contacts.map((c) => [c.name, c]));
  assertEquals(by['Jane Bloggs'].email, 'j.bloggs@example-health.io');
  assertEquals(by['Jane Bloggs'].rank, 1);
  assertEquals(by['Tom Patel'].email, 't.patel@example-health.io');
  assertEquals(by['Tom Patel'].rank, 2);
  assertEquals(by['Priya Shah'].email, 'p.shah@example-health.io');
  assertEquals(by['Priya Shah'].rank, 5);
  assertEquals(by['Alan Reid'].rank, INVESTOR_RANK);
  assert(!out.contacts.some((c) => /^(press|support)@/.test(c.email)), JSON.stringify(out.contacts.map((c) => c.email)));
  const founders = out.contacts.find((c) => c.email === 'founders@example-health.io');
  assert(founders && founders.rank === 1 && founders.name === '', 'the founders mailbox is a ranked generic');
  const careers = out.contacts.find((c) => c.email === 'careers@example-health.io');
  assert(careers && careers.rank === 5, 'the careers mailbox ranks with talent');
  assert(out.patternNote && /f\.last@example-health\.io/.test(out.patternNote), out.patternNote || 'no note');
});

Deno.test('no pattern guess from a single found address', () => {
  const contacts: Contact[] = [
    { name: 'Sarah Green', role: 'CEO', email: 'sarah.green@lumenly.ai', confidence: 'found', source_url: 'https://lumenly.ai/team', evidence: '', rank: 1 },
    { name: 'Omar Khan', role: 'Head of Talent', email: '', confidence: 'role_only', source_url: 'https://lumenly.ai/team', evidence: '', rank: 5 },
  ];
  const r = guessByPattern(contacts, 'lumenly.ai', new Set());
  assertEquals(r.guessed, 0);
  assertEquals(contacts[1].email, '');
});

Deno.test('two found addresses sharing first.last produce a labelled guess on the same domain only', () => {
  const contacts: Contact[] = [
    { name: 'Sarah Green', role: 'CEO', email: 'sarah.green@lumenly.ai', confidence: 'found', source_url: 'https://lumenly.ai/team', evidence: '', rank: 1 },
    { name: 'David Brown', role: 'CTO', email: 'david.brown@lumenly.ai', confidence: 'found', source_url: 'https://lumenly.ai/team', evidence: '', rank: 3 },
    { name: 'Omar Khan', role: 'Head of Talent', email: '', confidence: 'role_only', source_url: 'https://lumenly.ai/team', evidence: 'card', rank: 5 },
    { name: 'A Jones', role: 'COO', email: '', confidence: 'role_only', source_url: 'https://lumenly.ai/team', evidence: 'card', rank: 2 },
    { name: 'Helen Wood', role: 'Partner, Headline', email: '', confidence: 'role_only', source_url: 'https://lumenly.ai/team', evidence: 'card', rank: INVESTOR_RANK },
    { name: 'Rob Hill', role: 'Director', email: '', confidence: 'role_only', source_url: 'Companies House register', evidence: 'record', rank: 6 },
    { name: 'Kim Park', role: 'Talent Partner', email: '', confidence: 'role_only', source_url: 'https://jobs.ashbyhq.com/lumenly', evidence: 'board', rank: 5, level: 'careers' },
  ];
  const r = guessByPattern(contacts.map((c) => ({ ...c })), 'lumenly.ai', new Set(['omar.khan@lumenly.ai']));
  assertEquals(r.guessed, 1, 'a suppressed address is never guessed; the careers-page person still is');
  const fresh = contacts.map((c) => ({ ...c }));
  const r2 = guessByPattern(fresh, 'lumenly.ai', new Set());
  assertEquals(r2.guessed, 2);
  assertEquals(fresh[2].email, 'omar.khan@lumenly.ai');
  assertEquals(fresh[2].confidence, 'pattern_guess');
  assert(/first\.last@lumenly\.ai/.test(fresh[2].evidence) && /sarah\.green/.test(fresh[2].evidence), fresh[2].evidence);
  assertEquals(fresh[3].email, '', 'an initial cannot fill a first.last pattern');
  assertEquals(fresh[4].email, '', 'an investor is never guessed');
  assertEquals(fresh[5].email, '', 'a register officer is never guessed');
  assertEquals(fresh[6].email, 'kim.park@lumenly.ai', 'a person named on the careers page is company staff and may be guessed');
});

Deno.test('Companies House officers: added as name-only when absent, noted on the website\'s entry when present', () => {
  const officers = [{ name: 'Sarah Green', jobTitle: 'Director', source: 'Companies House register', appointedOn: '2024-03-01' }, { name: 'Peter Someone', jobTitle: 'Director', source: 'Companies House register', appointedOn: '2025-01-10' }];
  const out = resolveFixture('startup-team-cards.html', 'https://lumenly.ai/team', { recordOfficers: officers, maxContacts: 12 });
  const sarah = out.contacts.find((c) => c.name === 'Sarah Green')!;
  assertEquals(sarah.email, 'sarah.green@lumenly.ai', 'the website entry wins');
  assert(/Director since 2024-03-01 on the Companies House register/.test(sarah.evidence), sarah.evidence);
  const peter = out.contacts.find((c) => c.name === 'Peter Someone')!;
  assert(peter, 'the officer the website does not name is listed');
  assertEquals(peter.confidence, 'role_only');
  assertEquals(peter.email, '', 'never guessed: the register is not a page');
  assertEquals(peter.rank, 6, 'a director is an executive');
  const none = resolveContacts({ emails: [], people: [], phones: [], siteHost: 'x.io', recordOfficers: [{ name: 'Peter Someone', jobTitle: 'Director', source: 'Companies House register' }] });
  assertEquals(none.contacts.length, 1);
  assertEquals(none.contacts[0].confidence, 'role_only');
  const secretary = resolveContacts({ emails: [], people: [], phones: [], siteHost: 'x.io', recordOfficers: [{ name: 'Law Firm Nominees', jobTitle: 'Company secretary', source: 'Companies House register' }] });
  assertEquals(secretary.contacts.length, 0, 'a company secretary does not rank');
});

Deno.test('feedback suppression removes the contact and its address', () => {
  const out = resolveFixture('startup-team-table.html', 'https://fathom-robotics.co.uk/leadership', { suppressedEmails: new Set(['m.donachy@fathom-robotics.co.uk']) });
  assert(!out.contacts.some((c) => c.email === 'm.donachy@fathom-robotics.co.uk'));
  const named = resolveFixture('startup-team-table.html', 'https://fathom-robotics.co.uk/leadership', { suppressedNames: new Set(['gracepersand']) });
  assert(!named.contacts.some((c) => c.name === 'Grace Persand'));
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

Deno.test('the same person on two pages is one contact, with the address from the card that had it', () => {
  assert(samePerson("Mrs O'Reilly", "Mrs E O'Reilly"));
  assert(samePerson("Emma O'Reilly", "E O'Reilly"));
  assert(!samePerson('M John', 'D Johnson'));
  const merged = mergePeople([
    { name: 'Sarah Green', role: 'CEO', context: 'blog byline', source_url: 'https://s/blog' },
    { name: 'Sarah Green', role: 'Co-founder and CEO', context: 'card', email: 'sarah@s.io', source_url: 'https://s/team' },
  ]);
  assertEquals(merged.length, 1);
  assertEquals(merged[0].email, 'sarah@s.io');
  const out = resolveContacts({
    emails: [
      { email: 'sarah@s.io', context: 'Co-founder and CEO Sarah Green sarah@s.io', source_url: 'https://s/team', how: 'mailto' },
      { email: 'djohnson@s.io', context: 'Software Engineer D Johnson djohnson@s.io', source_url: 'https://s/team', how: 'mailto' },
    ],
    people: [
      { name: 'Sarah Green', role: 'CEO', context: 'blog byline', source_url: 'https://s/blog' },
      { name: 'Sarah Green', role: 'Co-founder and CEO', context: 'card', email: 'sarah@s.io', source_url: 'https://s/team' },
      { name: 'D Johnson', role: 'Software Engineer', context: 'card', email: 'djohnson@s.io', source_url: 'https://s/team' },
    ],
    phones: [], siteHost: 's.io',
  });
  const founder = out.contacts.find((c) => c.rank === 1)!;
  assertEquals(founder.email, 'sarah@s.io');
  assertEquals(out.contacts.filter((c) => /green/i.test(c.name)).length, 1);
  assert(!out.contacts.some((c) => /johnson/i.test(c.name)), 'an engineer is not a contact');
});

Deno.test('the company name is not a person; "Head of Sales" and "Founding Engineer" are not decision makers', () => {
  assertEquals(classifyRole('Head of Sales'), null);
  assertEquals(classifyRole('Founding Engineer'), null);
  assertEquals(classifyRole('Head of Talent and People')?.key, 'talent', 'a combined title reads as the talent role');
  assertEquals(classifyRole('Head of People and Talent')?.key, 'people');
  const out = resolveContacts({
    emails: [], phones: [], siteHost: 'lumenly.ai', companyName: 'Lumenly Ltd',
    people: [
      { name: 'Lumenly Ltd', role: 'Founder', context: 'welcome', source_url: 'https://lumenly.ai/about' },
      { name: 'Sarah Green', role: 'Founder', context: 'card', source_url: 'https://lumenly.ai/team' },
    ],
  });
  assertEquals(out.contacts.map((c) => c.name), ['Sarah Green']);
});

Deno.test('a found address is never pushed out by name-only entries, and at most three name-only people per rank', () => {
  const people = [
    { name: 'Sarah Green', role: 'CEO', context: '', source_url: 'https://c/team' },
    { name: 'A Barker', role: 'VP Sales', context: '', source_url: 'https://c/team' },
    { name: 'B Dilley', role: 'VP Marketing', context: '', source_url: 'https://c/team' },
    { name: 'C Harries', role: 'VP Product', context: '', source_url: 'https://c/team' },
    { name: 'D Careswell', role: 'VP Finance', context: '', source_url: 'https://c/team' },
    { name: 'E Chawluk', role: 'Chief Revenue Officer', context: '', source_url: 'https://c/team' },
    { name: 'F Kennedy', role: 'Chief Marketing Officer', context: '', source_url: 'https://c/team' },
    { name: 'G Patel', role: 'Chief Financial Officer', context: '', source_url: 'https://c/team' },
    { name: 'Kate Lafaverges', role: 'Head of Talent', context: '', email: 'lafavergesp@c.io', source_url: 'https://c/team' },
  ];
  const out = resolveContacts({ emails: [{ email: 'lafavergesp@c.io', context: 'Head of Talent Kate Lafaverges lafavergesp@c.io', source_url: 'https://c/team', how: 'mailto' }], people, phones: [], siteHost: 'c.io' });
  const talent = out.contacts.find((c) => c.rank === 5)!;
  assert(talent && talent.email === 'lafavergesp@c.io', JSON.stringify(out.contacts.map((c) => [c.name, c.email])));
  assertEquals(out.contacts.filter((c) => c.rank === 6 && c.confidence === 'role_only').length, 3);
  assertEquals(out.contacts.length, 5);
  const ranks = out.contacts.map((c) => c.rank!);
  assertEquals([...ranks].sort((a, b) => a - b), ranks);
});

import { leadingComponent, leadingComponentContradicts } from './resolve.ts';

const teamPage = 'https://oak.io/team';
const person = (name: string, role: string, context = '', email?: string) => ({ name, role, context, email, source_url: teamPage });
const emailHit = (email: string, context: string) => ({ email, context, source_url: teamPage, how: 'mailto' as const });

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
  const ctx = 'Contact the team on 020 7946 0000 or email emma.brown@oak.io for partnerships.';
  const mismatch = resolveContacts({ emails: [emailHit('emma.brown@oak.io', ctx)], people: [person('A Brown', 'COO', 'A Brown COO')], phones: [], siteHost: 'oak.io' });
  const brown = mismatch.contacts.find((c) => c.name === 'A Brown')!;
  assertEquals(brown.confidence, 'role_only');
  assertEquals(brown.email, '');
  const match = resolveContacts({ emails: [emailHit('emma.brown@oak.io', ctx)], people: [person('E Brown', 'COO', 'E Brown COO')], phones: [], siteHost: 'oak.io' });
  assertEquals(match.contacts.find((c) => c.name === 'E Brown')?.email, 'emma.brown@oak.io');
  assertEquals(match.contacts.find((c) => c.name === 'E Brown')?.confidence, 'found');
  const full = resolveContacts({ emails: [emailHit('emma.brown@oak.io', ctx)], people: [person('Emma Brown', 'COO', 'Emma Brown COO')], phones: [], siteHost: 'oak.io' });
  assertEquals(full.contacts.find((c) => c.name === 'Emma Brown')?.email, 'emma.brown@oak.io');
  // Even on the same line, the contradicting first name wins over proximity.
  const sameLine = resolveContacts({ emails: [emailHit('emma.brown@oak.io', 'A Brown, COO, via his EA emma.brown@oak.io')], people: [person('A Brown', 'COO', 'A Brown, COO')], phones: [], siteHost: 'oak.io' });
  assertEquals(sameLine.contacts.find((c) => c.name === 'A Brown')?.email, '');
});

Deno.test('a nearby address goes to the name before it, not the name after it (H4)', () => {
  const line = 'Ava Brown, COO ops@oak.io Chloe Davis, Head of Talent talent@oak.io';
  const people = [person('Ava Brown', 'COO', 'Ava Brown, COO'), person('Chloe Davis', 'Head of Talent', 'Chloe Davis, Head of Talent')];
  const out = resolveContacts({ emails: [emailHit('ops@oak.io', line)], people, phones: [], siteHost: 'oak.io' });
  assertEquals(out.contacts.find((c) => c.name === 'Ava Brown')?.email, 'ops@oak.io');
  assertEquals(out.contacts.find((c) => c.name === 'Chloe Davis')?.email, '');
  // The same with the people in the other order: the nearest preceding name still wins.
  const out2 = resolveContacts({ emails: [emailHit('ops@oak.io', line)], people: [people[1], people[0]], phones: [], siteHost: 'oak.io' });
  assertEquals(out2.contacts.find((c) => c.name === 'Ava Brown')?.email, 'ops@oak.io');
  assertEquals(out2.contacts.find((c) => c.name === 'Chloe Davis')?.email, '');
  // A name after the address still joins when it is the only name in the window ("email: x@ Chloe Davis").
  const only = resolveContacts({ emails: [emailHit('hiring.lead@oak.io', 'Email: hiring.lead@oak.io Chloe Davis, Head of Talent')], people: [person('Chloe Davis', 'Head of Talent', 'Chloe Davis, Head of Talent')], phones: [], siteHost: 'oak.io' });
  assertEquals(only.contacts.find((c) => c.name === 'Chloe Davis')?.email, 'hiring.lead@oak.io');
  // ... but not when another name is in the window, even if that name has its own address.
  const notOnly = resolveContacts({ emails: [emailHit('hiring.lead@oak.io', 'Ava Brown, COO. Email: hiring.lead@oak.io Chloe Davis, Head of Talent')], people, phones: [], siteHost: 'oak.io' });
  assertEquals(notOnly.contacts.find((c) => c.name === 'Chloe Davis')?.email, '');
  assertEquals(notOnly.contacts.find((c) => c.name === 'Ava Brown')?.email, 'hiring.lead@oak.io');
  // Two preceding names: the nearer one wins.
  const two = resolveContacts({ emails: [emailHit('ops@oak.io', 'Chloe Davis, Head of Talent. Ava Brown, COO ops@oak.io')], people, phones: [], siteHost: 'oak.io' });
  assertEquals(two.contacts.find((c) => c.name === 'Ava Brown')?.email, 'ops@oak.io');
});

Deno.test('careers-page addresses and investors never seed a pattern guess for company staff (H9)', () => {
  const contacts: Contact[] = [
    { name: 'Pat Lee', role: 'Talent Partner', email: 'pat.lee@lumenly.ai', confidence: 'found', source_url: 'https://jobs.ashbyhq.com/lumenly', evidence: '', rank: 5, level: 'careers' },
    { name: 'Sam Cole', role: 'Recruiter', email: 'sam.cole@lumenly.ai', confidence: 'found', source_url: 'https://jobs.ashbyhq.com/lumenly', evidence: '', rank: 5, level: 'careers' },
    { name: 'Omar Khan', role: 'Head of Talent', email: '', confidence: 'role_only', source_url: 'https://lumenly.ai/team', evidence: 'card', rank: 5, level: 'company' },
  ];
  const r = guessByPattern(contacts, 'lumenly.ai', new Set());
  assertEquals(r.guessed, 0);
  assertEquals(r.note, null);
  assertEquals(contacts[2].email, '');
  // The same two addresses at company level still count as evidence.
  const company = contacts.map((c) => ({ ...c, level: 'company' as const }));
  const r2 = guessByPattern(company, 'lumenly.ai', new Set());
  assertEquals(r2.guessed, 1);
  assertEquals(company[2].email, 'omar.khan@lumenly.ai');
  // Two investors' addresses on the company domain do not seed either.
  const investors: Contact[] = [
    { name: 'Helen Wood', role: 'Partner, Headline', email: 'helen.wood@lumenly.ai', confidence: 'found', source_url: 'https://lumenly.ai/team', evidence: '', rank: INVESTOR_RANK },
    { name: 'Ann Lee', role: 'Board member', email: 'ann.lee@lumenly.ai', confidence: 'found', source_url: 'https://lumenly.ai/team', evidence: '', rank: INVESTOR_RANK },
    { name: 'Omar Khan', role: 'Head of Talent', email: '', confidence: 'role_only', source_url: 'https://lumenly.ai/team', evidence: 'card', rank: 5 },
  ];
  assertEquals(guessByPattern(investors, 'lumenly.ai', new Set()).guessed, 0);
});
