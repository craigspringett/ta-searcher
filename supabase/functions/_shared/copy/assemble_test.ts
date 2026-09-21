import { assert, assertEquals } from '../test-assert.ts';
import { applicablePersonas, contactForPersona, copyIsStale, groupRolesByFamily, PERSONA_ROLE_KEYS, recordLineFrom } from './assemble.ts';

Deno.test('PERSONA_ROLE_KEYS is the contract\'s mapping', () => {
  assertEquals(PERSONA_ROLE_KEYS, { founder: ['founder'], coo: ['coo', 'exec'], people: ['people', 'talent'], cto: ['cto'], investor: ['investor'] });
});

Deno.test('applicablePersonas: founder, coo, people and cto always; investor only with an investor fact or contact', () => {
  assertEquals(applicablePersonas({ facts: [], contacts: [] }), ['founder', 'coo', 'people', 'cto']);
  assertEquals(applicablePersonas({ facts: [{ kind: 'investor' }], contacts: [] }), ['founder', 'coo', 'people', 'cto', 'investor']);
  assertEquals(applicablePersonas({ facts: [{ kind: 'funding_round' }], contacts: [{ role: 'Partner, Headline' }] }), ['founder', 'coo', 'people', 'cto', 'investor']);
  assertEquals(applicablePersonas({ facts: [{ kind: 'funding_round' }], contacts: [{ role: 'CEO' }] }), ['founder', 'coo', 'people', 'cto']);
});

Deno.test('contactForPersona: best role first, real addresses first, never a reported contact', () => {
  const contacts = [
    { name: 'Sarah Green', role: 'Co-founder and CEO', email: 'sarah@l.ai', confidence: 'found' },
    { name: 'Amy Jones', role: 'Chief of Staff', email: '', confidence: 'role_only' },
    { name: 'Pat Lee', role: 'VP Sales', email: 'pat@l.ai', confidence: 'found' },
    { name: 'Omar Khan', role: 'Head of Talent', email: 'omar@l.ai', confidence: 'found' },
    { name: 'Priya Shah', role: 'Director of People', email: '', confidence: 'role_only' },
    { name: 'Dan Cole', role: 'CTO', email: 'dan@l.ai', confidence: 'found', feedback: 'wrong person' },
    { name: 'Helen Wood', role: 'Partner, Headline', email: '', confidence: 'role_only' },
    { name: '', role: 'General mailbox', email: 'hello@l.ai', confidence: 'found' },
  ];
  assertEquals(contactForPersona('founder', contacts)?.name, 'Sarah Green');
  assertEquals(contactForPersona('coo', contacts)?.name, 'Amy Jones', 'the coo key beats the exec key even without an address');
  assertEquals(contactForPersona('people', contacts)?.name, 'Priya Shah', 'the people key beats the talent key');
  assertEquals(contactForPersona('cto', contacts), null, 'a reported contact is never used');
  assertEquals(contactForPersona('investor', contacts)?.name, 'Helen Wood');
});

Deno.test('groupRolesByFamily: counts per family, the people-and-talent family first, then by count', () => {
  const groups = groupRolesByFamily([
    { title: 'Senior Backend Engineer', department: 'Engineering' },
    { title: 'ML Engineer' },
    { title: 'Account Executive', department: 'Sales' },
    { title: 'Talent Partner', department: 'People' },
    { title: 'Product Designer' },
    { title: 'Platform Engineer' },
    { title: '', department: 'Engineering' },
  ]);
  assertEquals(groups[0].family, 'people_talent');
  assertEquals(groups[0].count, 1);
  assertEquals(groups[0].titles, ['Talent Partner']);
  assertEquals(groups[1].family, 'engineering');
  assertEquals(groups[1].count, 3);
  assertEquals(groups[1].label, 'Engineering');
  assertEquals(groups.reduce((n, g) => n + g.count, 0), 6);
  assertEquals(groupRolesByFamily([]), []);
});

Deno.test('recordLineFrom reduces a stored companyRecord to the register line', () => {
  const rec = { companyNumber: '12345678', name: 'Lumenly Ltd', status: 'active', incorporationDate: '2023-04-12', sicCodes: ['62012'], registeredOffice: { line1: '1 Example Street', locality: 'London', region: null, postcode: 'EC1A 1AA', country: 'England' }, verified: true };
  assertEquals(recordLineFrom(rec, null, 'Software'), { companyNumber: '12345678', status: 'active', incorporationDate: '2023-04-12', locality: 'London', sector: 'Software' });
  assertEquals(recordLineFrom(null, '00000001'), { companyNumber: '00000001', status: null, incorporationDate: null, locality: null, sector: null });
  assertEquals(recordLineFrom(null, null), null);
  assertEquals(recordLineFrom({ ...rec, registeredOffice: { line1: null, locality: null, region: 'Greater London', postcode: null, country: null } }, null)?.locality, 'Greater London');
});

Deno.test('copyIsStale: no copy, a changed fingerprint, or thirty days', () => {
  const today = new Date('2026-09-21T12:00:00Z');
  assert(copyIsStale(null, 'fp', today).stale);
  assert(copyIsStale({ evidence_fingerprint: 'old', generated_at: '2026-09-20T00:00:00Z' }, 'fp', today).stale);
  assert(copyIsStale({ evidence_fingerprint: 'fp', generated_at: '2026-07-01T00:00:00Z' }, 'fp', today).stale);
  assertEquals(copyIsStale({ evidence_fingerprint: 'fp', generated_at: '2026-09-20T00:00:00Z' }, 'fp', today).stale, false);
});
