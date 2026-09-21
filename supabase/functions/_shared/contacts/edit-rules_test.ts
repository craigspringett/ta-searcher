import { assert, assertEquals } from '../test-assert.ts';
import { mergeContacts, removedContacts, type ContactEditRow } from '../contacts.ts';
import { activeRunWarning, checkContactEdit, editorName, parseContactEditRequest, savedMessage, sequenceEmailChange, type ActiveSequence, type ContactEditRequest } from './edit-rules.ts';

const company = 'b1111111-1111-1111-1111-111111111111';
const site = [
  { name: 'Mrs H Patel', role: 'Founder and CEO', email: 'founder@oak.io', confidence: 'found' },
  { name: 'Mr A Brown', role: 'COO', email: '', confidence: 'role_only' },
];
const row = (r: Partial<ContactEditRow> & { contact_key: string; action: string }): ContactEditRow => ({ name: null, role: null, email: null, phone: null, note: null, edited_by_name: 'Anja', created_at: '2026-09-18T10:00:00Z', ...r });
const parsed = (b: Record<string, unknown>): ContactEditRequest => {
  const p = parseContactEditRequest({ companySearchId: company, ...b });
  if (p.error) throw new Error(p.error);
  return p.ok;
};

Deno.test('parseContactEditRequest: the shape, the address check, the required name and reason, the key', () => {
  assertEquals(parseContactEditRequest({ action: 'rename', companySearchId: company }).error, 'action must be edit, add or remove');
  assertEquals(parseContactEditRequest({ action: 'edit', companySearchId: 'nope' }).error, 'companySearchId (uuid) is required');
  assertEquals(parseContactEditRequest({ action: 'edit', companySearchId: company }).error, 'A name is needed.');
  assertEquals(parseContactEditRequest({ action: 'edit', companySearchId: company, name: 'Mrs H Patel', email: 'hpatel@oak' }).error, 'That does not look like an email address. Check it: name@company.com.');
  assertEquals(parseContactEditRequest({ action: 'remove', companySearchId: company, contactKey: 'hpatel' }).error, 'Say why, in a few words, so the team knows.');
  assertEquals(parseContactEditRequest({ action: 'add', companySearchId: company, name: '...' }).error, 'A name is needed, with at least one letter.');
  const e = parsed({ action: 'edit', contactKey: 'HPATEL', name: '  Mrs  H Patel ', role: '', email: ' HPatel@Oak.io ', phone: '020 7946 0000', note: 'from the office' });
  assertEquals(e, { action: 'edit', companySearchId: company, contactKey: 'hpatel', name: 'Mrs H Patel', role: null, email: 'hpatel@oak.io', phone: '020 7946 0000', note: 'from the office' });
  // An add is keyed by its name; an edit without a key falls back to the name.
  assertEquals(parsed({ action: 'add', name: 'Mr J. Khan', contactKey: 'ignored' }).contactKey, 'jkhan');
  assertEquals(parsed({ action: 'edit', name: 'Mr A Brown' }).contactKey, 'abrown');
  assertEquals(parsed({ action: 'remove', contactKey: 'abrown', note: 'left' }).name, '');
});

Deno.test('checkContactEdit: adds must be new, edits and removes must name someone listed or removed, one address per person', () => {
  const contacts = mergeContacts(site, []);
  assertEquals(checkContactEdit(parsed({ action: 'add', name: 'H Patel' }), contacts, []), 'Mrs H Patel is already listed. Edit that entry instead.');
  assertEquals(checkContactEdit(parsed({ action: 'add', name: 'Mr J Khan', email: 'ops@oak.io' }), contacts, []), null);
  assertEquals(checkContactEdit(parsed({ action: 'add', name: 'Mr J Khan', email: 'founder@oak.io' }), contacts, []), 'founder@oak.io is already listed for Mrs H Patel.');
  assertEquals(checkContactEdit(parsed({ action: 'edit', contactKey: 'jkhan', name: 'Mr J Khan' }), contacts, []), "Mr J Khan is not on this company's list. Add them instead.");
  assertEquals(checkContactEdit(parsed({ action: 'edit', contactKey: 'abrown', name: 'Mr A Brown', email: 'founder@oak.io' }), contacts, []), 'founder@oak.io is already listed for Mrs H Patel.');
  assertEquals(checkContactEdit(parsed({ action: 'edit', contactKey: 'hpatel', name: 'Mrs H Patel', email: 'founder@oak.io' }), contacts, []), null);
  assertEquals(checkContactEdit(parsed({ action: 'remove', contactKey: 'abrown', note: 'left at Easter' }), contacts, []), null);
  // After a removal: the person can be put back with an edit, not removed twice, not added again.
  const edits = [row({ contact_key: 'abrown', action: 'remove', name: 'Mr A Brown', note: 'left at Easter' })];
  const after = mergeContacts(site, edits);
  const removed = removedContacts(site, edits);
  assertEquals(checkContactEdit(parsed({ action: 'edit', contactKey: 'abrown', name: 'Mr A Brown' }), after, removed), null);
  assertEquals(checkContactEdit(parsed({ action: 'remove', contactKey: 'abrown', note: 'again' }), after, removed), 'Mr A Brown has already been removed.');
  assertEquals(checkContactEdit(parsed({ action: 'add', name: 'A Brown' }), after, removed), 'Mr A Brown was removed by Anja (left at Easter). Put them back from the removed list instead of adding them again.');
});

Deno.test('an edited address moves an active follow-up run to the new address, with a note for the Calls history', () => {
  const runs: ActiveSequence[] = [
    { id: 'd1', status: 'active', contact_name: 'Mrs Patel', contact_email: 'founder@oak.io', contact_role: 'Founder and CEO' },
    { id: 'd2', status: 'stopped', contact_name: 'Mr A Brown', contact_email: 'coo@oak.io', contact_role: null },
  ];
  const current = mergeContacts(site, []).find((c) => c.contactKey === 'hpatel')!;
  // The run was started as "Mrs Patel" (a different key from "Mrs H Patel"): matched by the address the person had.
  const change = sequenceEmailChange(parsed({ action: 'edit', contactKey: 'hpatel', name: 'Mrs H Patel', email: 'hpatel@oak.io' }), current, runs, 'Anja');
  assertEquals(change, { sequenceId: 'd1', from: 'founder@oak.io', to: 'hpatel@oak.io', note: 'Email for Mrs Patel changed to hpatel@oak.io by Anja.' });
  // Matched by key when the names agree.
  const byKey = sequenceEmailChange(parsed({ action: 'edit', contactKey: 'patel', name: 'Mrs Patel', email: 'new@oak.io' }), null, runs, 'Kim');
  assertEquals(byKey?.sequenceId, 'd1');
  // Nothing to do: the same address, no address, a stopped run, or a different person.
  assertEquals(sequenceEmailChange(parsed({ action: 'edit', contactKey: 'hpatel', name: 'Mrs H Patel', email: 'founder@oak.io' }), current, runs, 'Anja'), null);
  assertEquals(sequenceEmailChange(parsed({ action: 'edit', contactKey: 'hpatel', name: 'Mrs H Patel', role: 'CEO' }), current, runs, 'Anja'), null);
  assertEquals(sequenceEmailChange(parsed({ action: 'edit', contactKey: 'abrown', name: 'Mr A Brown', email: 'abrown@oak.io' }), mergeContacts(site, [])[1], runs, 'Anja'), null);
  assertEquals(sequenceEmailChange(parsed({ action: 'add', name: 'Mr J Khan', email: 'ops@oak.io' }), null, runs, 'Anja'), null);
  // Removing the person the run is with does not stop it, but says so.
  assertEquals(activeRunWarning(parsed({ action: 'remove', contactKey: 'hpatel', note: 'left' }), current, runs), 'Follow-ups are still running with Mrs Patel. Stop them from the Follow-ups panel if they should stop.');
  assertEquals(activeRunWarning(parsed({ action: 'remove', contactKey: 'abrown', note: 'left' }), null, runs), null);
});

Deno.test('editorName and savedMessage', () => {
  assertEquals(editorName({ display_name: 'Anja Micic', email: 'anja@bigfishrecruitment.co.uk' }, 'Anja Cold Targets'), 'Anja Micic');
  assertEquals(editorName({ display_name: null, email: 'anja@bigfishrecruitment.co.uk' }, 'Anja Cold Targets'), 'Anja');
  assertEquals(editorName({ display_name: '', email: 'kim@bigfishrecruitment.co.uk' }, 'Kim Webb'), 'Kim Webb');
  assertEquals(editorName({ display_name: null, email: '' }, null), 'a consultant');
  const change = { sequenceId: 'd1', from: 'a', to: 'b', note: '' };
  assertEquals(savedMessage(parsed({ action: 'edit', contactKey: 'hpatel', name: 'Mrs H Patel', email: 'hpatel@oak.io' }), change), 'Saved. Mrs H Patel now shows hpatel@oak.io. The follow-ups running with them will email the new address.');
  assertEquals(savedMessage(parsed({ action: 'edit', contactKey: 'hpatel', name: 'Mrs H Patel', role: 'Head' }), null), 'Saved.');
  assertEquals(savedMessage(parsed({ action: 'add', name: 'Mr J Khan' }), null), 'Mr J Khan added.');
  assertEquals(savedMessage(parsed({ action: 'remove', contactKey: 'abrown', name: 'Mr A Brown', note: 'left' }), null), 'Mr A Brown removed.');
  assert(savedMessage(parsed({ action: 'remove', contactKey: 'abrown', note: 'left' }), null).startsWith('The contact removed'));
});
