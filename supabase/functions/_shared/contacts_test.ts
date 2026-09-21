import { assert, assertEquals } from './test-assert.ts';
import { contactKeyOf, contactNameKey, editTag, isEmailAddress, latestEdits, mergeContacts, removedContacts, shortUkDate, type ContactEditRow } from './contacts.ts';
import { contactNameKey as reviewKey } from './contacts/review.ts';

// The same cases as src/lib/__tests__/contacts.test.ts; keep them in step.

interface Dm { name: string; role: string; email: string; confidence?: string; source_url?: string; evidence?: string; phone?: string; feedback?: string }

const site: Dm[] = [
  { name: 'Mrs H Patel', role: 'Headteacher', email: 'head@oak.sch.uk', confidence: 'found', source_url: 'https://oak.sch.uk/staff', evidence: 'Staff page' },
  { name: 'Mr A Brown', role: 'Deputy Headteacher', email: '', confidence: 'role_only', source_url: 'https://oak.sch.uk/staff' },
  { name: '', role: 'Company office', email: 'office@oak.sch.uk', confidence: 'found' },
];

const row = (r: Partial<ContactEditRow> & { contact_key: string; action: string; created_at: string }): ContactEditRow => ({
  name: null, role: null, email: null, phone: null, note: null, edited_by_name: 'Anja', ...r,
});

const now = new Date('2026-09-18T12:00:00Z');

Deno.test('the app copy and the edge-function copy of contacts.ts are byte for byte the same', async () => {
  const here = new URL('./contacts.ts', import.meta.url);
  const app = new URL('../../../src/lib/contacts.ts', import.meta.url);
  assertEquals(await Deno.readTextFile(here), await Deno.readTextFile(app), 'src/lib/contacts.ts and _shared/contacts.ts differ: change both together');
});

Deno.test('contactNameKey strips the title, case and punctuation, and agrees with the Phase 2 rule', () => {
  assertEquals(contactNameKey('Mrs H. Patel'), 'hpatel');
  assertEquals(contactNameKey('H Patel'), 'hpatel');
  assertEquals(contactNameKey("Dr Anne-Marie O'Neill"), 'annemarieoneill');
  assertEquals(contactNameKey(''), '');
  for (const n of ['Mrs H. Patel', 'Revd John Smith', 'Professor A B-C', 'office@oak.sch.uk', '']) assertEquals(contactNameKey(n), reviewKey(n), n);
  assertEquals(contactKeyOf({ name: '', email: 'office@oak.sch.uk' }), 'officeoakschuk');
  assertEquals(contactKeyOf({ name: 'Mrs H Patel', email: 'head@oak.sch.uk' }), 'hpatel');
});

Deno.test('an edit replaces the email, phone and role, keeps the site evidence, and is tagged', () => {
  const edits = [row({ contact_key: 'hpatel', action: 'edit', name: 'Mrs H Patel', role: 'Executive Headteacher', email: 'HPatel@oak.sch.uk', phone: '020 7946 0000', note: 'from the company office, 18 Sep', created_at: '2026-09-18T10:00:00Z' })];
  const out = mergeContacts(site, edits);
  assertEquals(out.length, 3);
  const head = out[0];
  assertEquals(head.email, 'hpatel@oak.sch.uk');
  assertEquals(head.role, 'Executive Headteacher');
  assertEquals(head.phone, '020 7946 0000');
  assertEquals(head.source_url, 'https://oak.sch.uk/staff');
  assertEquals(head.confidence, 'consultant_provided');
  assertEquals(head.edited?.kind, 'edited');
  assertEquals(head.edited?.from?.email, 'head@oak.sch.uk');
  assertEquals(editTag(head.edited!, now), 'edited by Anja, 18 Sep');
  assertEquals(head.edited?.note, 'from the company office, 18 Sep');
  assertEquals(out[1].edited, undefined);
  assertEquals(out[2].contactKey, 'officeoakschuk');
});

Deno.test('a refresh that rewrites the list with a different address still shows the corrected one', () => {
  const edits = [row({ contact_key: 'hpatel', action: 'edit', name: 'Mrs H Patel', email: 'hpatel@oak.sch.uk', created_at: '2026-09-18T10:00:00Z' })];
  const refreshed: Dm[] = [{ name: 'Mrs H Patel', role: 'Headteacher', email: 'headteacher@oak.sch.uk', confidence: 'found' }, ...site.slice(1)];
  const out = mergeContacts(refreshed, edits);
  assertEquals(out[0].email, 'hpatel@oak.sch.uk');
  assertEquals(out[0].edited?.from?.email, 'headteacher@oak.sch.uk');
});

Deno.test('an edit for a person the refresh no longer lists is kept, not dropped', () => {
  const edits = [row({ contact_key: 'hpatel', action: 'edit', name: 'Mrs H Patel', role: 'Headteacher', email: 'hpatel@oak.sch.uk', created_at: '2026-09-18T10:00:00Z' })];
  const out = mergeContacts(site.slice(1), edits);
  assertEquals(out.map((c) => c.name), ['Mr A Brown', '', 'Mrs H Patel']);
  const kept = out[2];
  assertEquals(kept.email, 'hpatel@oak.sch.uk');
  assertEquals(kept.confidence, 'consultant_provided');
  assertEquals(kept.edited?.kind, 'kept');
  assertEquals(editTag(kept.edited!, now), 'kept by Anja, 18 Sep');
});

Deno.test('an add appends a person the site did not find, and stays added if the site later names them', () => {
  const edits = [row({ contact_key: 'jkhan', action: 'add', name: 'Mr J Khan', role: 'Company Business Manager', email: 'sbm@oak.sch.uk', edited_by_name: 'Kim', created_at: '2026-09-18T10:00:00Z' })];
  const out = mergeContacts(site, edits);
  assertEquals(out.length, 4);
  assertEquals(out[3].name, 'Mr J Khan');
  assertEquals(out[3].confidence, 'consultant_provided');
  assertEquals(editTag(out[3].edited!, now), 'added by Kim, 18 Sep');
  const later = mergeContacts([...site, { name: 'J Khan', role: 'SBM', email: '', confidence: 'role_only' }], edits);
  assertEquals(later.length, 4);
  assertEquals(later[3].email, 'sbm@oak.sch.uk');
  assertEquals(later[3].edited?.kind, 'added');
});

Deno.test('a remove hides the person, removedContacts lists them with the reason, a later edit puts them back', () => {
  const removed = row({ contact_key: 'abrown', action: 'remove', name: 'Mr A Brown', note: 'left at Easter', created_at: '2026-09-18T10:00:00Z' });
  assertEquals(mergeContacts(site, [removed]).map((c) => c.name), ['Mrs H Patel', '']);
  const gone = removedContacts(site, [removed]);
  assertEquals(gone.length, 1);
  assertEquals(gone[0].name, 'Mr A Brown');
  assertEquals(gone[0].reason, 'left at Easter');
  assertEquals(gone[0].original?.role, 'Deputy Headteacher');
  const back = row({ contact_key: 'abrown', action: 'edit', name: 'Mr A Brown', created_at: '2026-09-18T11:00:00Z' });
  assertEquals(mergeContacts(site, [removed, back]).map((c) => c.name), ['Mrs H Patel', 'Mr A Brown', '']);
  assertEquals(removedContacts(site, [removed, back]).length, 0);
});

Deno.test('the newest row per person wins, whatever order the rows arrive in', () => {
  const first = row({ contact_key: 'hpatel', action: 'edit', email: 'one@oak.sch.uk', created_at: '2026-09-17T10:00:00Z' });
  const second = row({ contact_key: 'hpatel', action: 'edit', email: 'two@oak.sch.uk', edited_by_name: 'Kim', created_at: '2026-09-18T10:00:00Z' });
  assertEquals(mergeContacts(site, [second, first])[0].email, 'two@oak.sch.uk');
  assertEquals(mergeContacts(site, [first, second])[0].edited?.by, 'Kim');
  assertEquals(latestEdits([first, second]).get('hpatel')?.latest.email, 'two@oak.sch.uk');
});

Deno.test('an empty field keeps the site value; a changed address clears an old bounce report', () => {
  const bounced: Dm[] = [{ ...site[0], feedback: 'bounced' }];
  const roleOnly = row({ contact_key: 'hpatel', action: 'edit', role: 'Head of Company', created_at: '2026-09-18T10:00:00Z' });
  const a = mergeContacts(bounced, [roleOnly])[0];
  assertEquals(a.email, 'head@oak.sch.uk');
  assertEquals(a.role, 'Head of Company');
  assertEquals(a.confidence, 'found');
  assertEquals(a.feedback, 'bounced');
  const newAddress = row({ contact_key: 'hpatel', action: 'edit', email: 'hpatel@oak.sch.uk', created_at: '2026-09-18T10:00:00Z' });
  const b = mergeContacts(bounced, [newAddress])[0];
  assertEquals(b.feedback, undefined);
  assertEquals(b.confidence, 'consultant_provided');
});

Deno.test('a nameless mailbox is edited by its address key; no edits means the list as read', () => {
  const edits = [row({ contact_key: 'officeoakschuk', action: 'edit', name: 'Company office', email: 'admin@oak.sch.uk', created_at: '2026-09-18T10:00:00Z' })];
  const out = mergeContacts(site, edits);
  assertEquals(out[2].name, 'Company office');
  assertEquals(out[2].email, 'admin@oak.sch.uk');
  assertEquals(mergeContacts(site, []).length, 3);
  assertEquals(mergeContacts(null, null), []);
  assertEquals(mergeContacts(site, [row({ contact_key: '', action: 'edit', created_at: 'x' })]).map((c) => c.edited), [undefined, undefined, undefined]);
});

Deno.test('shortUkDate and isEmailAddress', () => {
  assertEquals(shortUkDate('2026-09-18T10:00:00Z', now), '18 Sep');
  assertEquals(shortUkDate('2025-12-31T23:30:00Z', now), '31 Dec 2025');
  assertEquals(shortUkDate('not a date', now), '');
  assert(isEmailAddress('h.patel@oak.sch.uk'));
  assert(!isEmailAddress('h.patel@oak'));
  assert(!isEmailAddress(''));
});
