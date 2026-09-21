import { assertEquals } from '../test-assert.ts';
import type { EmailHit } from './extract.ts';
import { applyModelContactReview, mergeProvidedContacts } from './review.ts';
import type { Contact } from './resolve.ts';

const page = 'https://www.oak.sch.uk/staff';
const hit = (email: string): EmailHit => ({ email, context: email, source_url: page, how: 'mailto' });
const contact = (c: Partial<Contact> & { name: string; role: string }): Contact => ({
  email: '', confidence: 'role_only', source_url: page, evidence: 'Staff list', level: 'company', ...c,
});

Deno.test('a found address moves to the person the model names, and the old holder becomes name-only', () => {
  const contacts = [
    contact({ name: 'Mr A Brown', role: 'Deputy Headteacher', email: 'deputy.head@oak.sch.uk', confidence: 'found', rank: 2 }),
    contact({ name: 'Mrs C Davis', role: 'SENCO', rank: 5 }),
  ];
  const out = applyModelContactReview(contacts, [hit('deputy.head@oak.sch.uk')], [{ name: 'Mrs C Davis', email: 'deputy.head@oak.sch.uk' }]);
  assertEquals(out.find((c) => c.name === 'Mrs C Davis')?.email, 'deputy.head@oak.sch.uk');
  assertEquals(out.find((c) => c.name === 'Mrs C Davis')?.confidence, 'found');
  assertEquals(out.find((c) => c.name === 'Mr A Brown')?.email, '');
  assertEquals(out.find((c) => c.name === 'Mr A Brown')?.confidence, 'role_only');
});

Deno.test('a pattern guess is never re-homed by the model and never becomes found (H2)', () => {
  const contacts = [
    contact({ name: 'Mr A Brown', role: 'Deputy Headteacher', email: 'a.brown@oak.sch.uk', confidence: 'pattern_guess', rank: 2 }),
    contact({ name: 'Mrs C Davis', role: 'SENCO', rank: 5 }),
  ];
  const out = applyModelContactReview(contacts, [], [{ name: 'Mrs C Davis', email: 'a.brown@oak.sch.uk' }]);
  const davis = out.find((c) => c.name === 'Mrs C Davis')!;
  assertEquals(davis.email, '');
  assertEquals(davis.confidence, 'role_only');
  const brown = out.find((c) => c.name === 'Mr A Brown')!;
  assertEquals(brown.email, 'a.brown@oak.sch.uk');
  assertEquals(brown.confidence, 'pattern_guess');
});

Deno.test('an address the model invents is discarded; a flagged contact is dropped; the rest are kept', () => {
  const contacts = [
    contact({ name: 'Mrs M John', role: 'Headteacher', email: 'head@oak.sch.uk', confidence: 'found', rank: 1 }),
    contact({ name: 'Mr G Persand', role: 'Deputy Headteacher', rank: 2 }),
    contact({ name: 'Ms P Lee', role: 'SENCO', rank: 5 }),
  ];
  const out = applyModelContactReview(contacts, [hit('head@oak.sch.uk')], [
    { name: 'Mr G Persand', email: 'g.persand@oak.sch.uk' },
    { name: 'Ms P Lee', flag: 'left the company in 2024' },
  ]);
  assertEquals(out.map((c) => c.name), ['Mrs M John', 'Mr G Persand']);
  assertEquals(out[1].email, '');
  assertEquals(out[0].roleLabel, 'Headteacher');
});

Deno.test('no model output returns the contacts unchanged', () => {
  const contacts = [contact({ name: 'Mrs M John', role: 'Headteacher', email: 'head@oak.sch.uk', confidence: 'found', rank: 1 })];
  assertEquals(applyModelContactReview(contacts, [], undefined).length, 1);
  assertEquals(applyModelContactReview(contacts, [], []).length, 1);
});

Deno.test('contacts a consultant provided survive a refresh: kept first, twins folded in, the record head dropped when the sheet names one', () => {
  const previous = [
    { name: 'Tanya Douglas', role: 'Head Teacher', email: 'tdouglas@chace.enfield.sch.uk', confidence: 'consultant_provided' as const, source_url: "Alexa's list, September 2026", evidence: 'Provided by Alexa.', provided_by: 'Alexa', provided_at: '2026-09-11' },
    { name: 'Helen Manwaring', role: 'SBM', email: '', confidence: 'consultant_provided' as const, source_url: "Alexa's list, September 2026", evidence: 'Provided by Alexa.', provided_by: 'Alexa', provided_at: '2026-09-11' },
    { name: 'Old Person', role: 'Deputy Headteacher', email: 'old@chace.enfield.sch.uk', confidence: 'found' as const, source_url: page, evidence: 'Staff list' },
  ];
  const fresh = [
    { name: 'Ms Tanya Douglas', role: 'Headteacher', email: '', confidence: 'role_only' as const, source_url: 'DfE GIAS record', evidence: 'Named as Headteacher in the DfE GIAS record.' },
    { name: 'Mrs H Manwaring', role: 'Company Business Manager', email: 'hmanwaring@chace.enfield.sch.uk', confidence: 'found' as const, source_url: page, evidence: 'Staff list', phone: '020 8363 7321' },
    { name: 'New Person', role: 'SENCO', email: 'senco@chace.enfield.sch.uk', confidence: 'found' as const, source_url: page, evidence: 'Staff list' },
  ];
  const merged = mergeProvidedContacts(fresh, previous);
  assertEquals(merged.map((d) => d.name), ['Tanya Douglas', 'Helen Manwaring', 'New Person']);
  // The provided SBM row picked up the address and phone the site now shows, and keeps its label.
  assertEquals(merged[1].email, 'hmanwaring@chace.enfield.sch.uk');
  assertEquals(merged[1].phone, '020 8363 7321');
  assertEquals(merged[1].confidence, 'consultant_provided');
  // A contact the previous run found but the site no longer shows is gone, as before.
  assertEquals(merged.some((d) => d.name === 'Old Person'), false);
  // A previous list with nothing provided is not consulted at all.
  assertEquals(mergeProvidedContacts(fresh, [previous[2]]), fresh);
  assertEquals(mergeProvidedContacts(fresh, null), fresh);
});

Deno.test('the DfE record head stays when the consultant named nobody as head', () => {
  const previous = [{ name: '', role: 'Recruitment', email: 'recruitment@oak.sch.uk', confidence: 'consultant_provided' as const, source_url: "Alexa's list, September 2026", evidence: 'Provided by Alexa.', provided_by: 'Alexa', provided_at: '2026-09-11' }];
  const fresh = [{ name: 'Ms Jane Head', role: 'Headteacher', email: '', confidence: 'role_only' as const, source_url: 'DfE GIAS record', evidence: 'Named as Headteacher in the DfE GIAS record.' }];
  assertEquals(mergeProvidedContacts(fresh, previous).map((d) => d.name), ['', 'Ms Jane Head']);
});
