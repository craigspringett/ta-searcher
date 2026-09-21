import { assertEquals } from '../test-assert.ts';
import type { EmailHit } from './extract.ts';
import { applyModelContactReview, mergeProvidedContacts } from './review.ts';
import type { Contact } from './resolve.ts';

const page = 'https://lumenly.ai/team';
const hit = (email: string): EmailHit => ({ email, context: email, source_url: page, how: 'mailto' });
const contact = (c: Partial<Contact> & { name: string; role: string }): Contact => ({
  email: '', confidence: 'role_only', source_url: page, evidence: 'Team page', level: 'company', ...c,
});

Deno.test('a found address moves to the person the model names, and the old holder becomes name-only', () => {
  const contacts = [
    contact({ name: 'Ava Brown', role: 'COO', email: 'ops@lumenly.ai', confidence: 'found', rank: 2 }),
    contact({ name: 'Chloe Davis', role: 'Head of Talent', rank: 5 }),
  ];
  const out = applyModelContactReview(contacts, [hit('ops@lumenly.ai')], [{ name: 'Chloe Davis', email: 'ops@lumenly.ai' }]);
  assertEquals(out.find((c) => c.name === 'Chloe Davis')?.email, 'ops@lumenly.ai');
  assertEquals(out.find((c) => c.name === 'Chloe Davis')?.confidence, 'found');
  assertEquals(out.find((c) => c.name === 'Ava Brown')?.email, '');
  assertEquals(out.find((c) => c.name === 'Ava Brown')?.confidence, 'role_only');
});

Deno.test('a pattern guess is never re-homed by the model and never becomes found (H2)', () => {
  const contacts = [
    contact({ name: 'Ava Brown', role: 'COO', email: 'ava.brown@lumenly.ai', confidence: 'pattern_guess', rank: 2 }),
    contact({ name: 'Chloe Davis', role: 'Head of Talent', rank: 5 }),
  ];
  const out = applyModelContactReview(contacts, [], [{ name: 'Chloe Davis', email: 'ava.brown@lumenly.ai' }]);
  const davis = out.find((c) => c.name === 'Chloe Davis')!;
  assertEquals(davis.email, '');
  assertEquals(davis.confidence, 'role_only');
  const brown = out.find((c) => c.name === 'Ava Brown')!;
  assertEquals(brown.email, 'ava.brown@lumenly.ai');
  assertEquals(brown.confidence, 'pattern_guess');
});

Deno.test('an address the model invents is discarded; a flagged contact is dropped; the rest are kept with their labels', () => {
  const contacts = [
    contact({ name: 'Sarah Green', role: 'Co-founder and CEO', email: 'sarah@lumenly.ai', confidence: 'found', rank: 1 }),
    contact({ name: 'Omar Khan', role: 'Head of Talent', rank: 5 }),
    contact({ name: 'Pat Lee', role: 'VP Engineering', rank: 3 }),
  ];
  const out = applyModelContactReview(contacts, [hit('sarah@lumenly.ai')], [
    { name: 'Omar Khan', email: 'omar.khan@lumenly.ai' },
    { name: 'Pat Lee', flag: 'left the company in 2025' },
  ]);
  assertEquals(out.map((c) => c.name), ['Sarah Green', 'Omar Khan']);
  assertEquals(out[1].email, '');
  assertEquals(out[0].roleLabel, 'Founder / CEO');
  assertEquals(out[1].roleLabel, 'Head of Talent');
  assertEquals(out[0].level, 'company');
});

Deno.test('no model output returns the contacts unchanged', () => {
  const contacts = [contact({ name: 'Sarah Green', role: 'CEO', email: 'sarah@lumenly.ai', confidence: 'found', rank: 1 })];
  assertEquals(applyModelContactReview(contacts, [], undefined).length, 1);
  assertEquals(applyModelContactReview(contacts, [], []).length, 1);
});

Deno.test('contacts a consultant provided survive a refresh: kept first, twins folded in, the register officer dropped when the sheet names a founder', () => {
  const previous = [
    { name: 'Tanya Douglas', role: 'CEO', email: 'tanya@lumenly.ai', confidence: 'consultant_provided' as const, source_url: "Craig's list, September 2026", evidence: 'Provided by Craig.', provided_by: 'Craig', provided_at: '2026-09-21', notes: 'Met at a Seedcamp event' },
    { name: 'Helen Manwaring', role: 'Head of People', email: '', confidence: 'consultant_provided' as const, source_url: "Craig's list, September 2026", evidence: 'Provided by Craig.', provided_by: 'Craig', provided_at: '2026-09-21' },
    { name: 'Old Person', role: 'COO', email: 'old@lumenly.ai', confidence: 'found' as const, source_url: page, evidence: 'Team page' },
  ];
  const fresh = [
    { name: 'Tanya Douglas', role: 'Director', email: '', confidence: 'role_only' as const, source_url: 'Companies House register', evidence: 'Named as director on the Companies House register.' },
    { name: 'Peter Nominee', role: 'Director', email: '', confidence: 'role_only' as const, source_url: 'Companies House register', evidence: 'Named as director on the Companies House register.' },
    { name: 'H Manwaring', role: 'Chief People Officer', email: 'hmanwaring@lumenly.ai', confidence: 'found' as const, source_url: page, evidence: 'Team page', phone: '020 7946 0100' },
    { name: 'New Person', role: 'Head of Talent', email: 'talent@lumenly.ai', confidence: 'found' as const, source_url: page, evidence: 'Team page' },
  ];
  const merged = mergeProvidedContacts(fresh, previous);
  assertEquals(merged.map((d) => d.name), ['Tanya Douglas', 'Helen Manwaring', 'New Person']);
  // The provided Head of People picked up the address and phone the site now shows, and keeps its label and notes.
  assertEquals(merged[1].email, 'hmanwaring@lumenly.ai');
  assertEquals(merged[1].phone, '020 7946 0100');
  assertEquals(merged[1].confidence, 'consultant_provided');
  assertEquals(merged[0].notes, 'Met at a Seedcamp event');
  assertEquals(merged[0].provided_by, 'Craig');
  // A contact the previous run found but the site no longer shows is gone, as before.
  assertEquals(merged.some((d) => d.name === 'Old Person'), false);
  // A previous list with nothing provided is not consulted at all.
  assertEquals(mergeProvidedContacts(fresh, [previous[2]]), fresh);
  assertEquals(mergeProvidedContacts(fresh, null), fresh);
});

Deno.test('the register officer stays when the consultant named nobody as founder', () => {
  const previous = [{ name: '', role: 'Careers mailbox', email: 'careers@lumenly.ai', confidence: 'consultant_provided' as const, source_url: "Craig's list, September 2026", evidence: 'Provided by Craig.', provided_by: 'Craig', provided_at: '2026-09-21' }];
  const fresh = [{ name: 'Jane Founder', role: 'Director', email: '', confidence: 'role_only' as const, source_url: 'Companies House register', evidence: 'Named as director on the Companies House register.' }];
  assertEquals(mergeProvidedContacts(fresh, previous).map((d) => d.name), ['', 'Jane Founder']);
});
