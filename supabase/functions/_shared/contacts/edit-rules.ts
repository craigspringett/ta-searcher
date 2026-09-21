// The rules the contact-edits function applies before it writes a row
// (Contact edits, 18 September 2026). Pure and tested; the function
// (supabase/functions/contact-edits) reads the company and writes.
//
//   * the request: an action (edit, add, remove), the company, the person's
//     key (for edit and remove: the key the app got from the merged list;
//     for add: made from the name), a name (required to edit or add), an
//     optional role, address and phone, and a note (required to remove);
//   * against the company's contacts: an add must not name someone already
//     listed (edit them instead); an edit or remove must name someone who
//     is listed or was removed (a removed person can be put back with an
//     edit); an address cannot be given to two people;
//   * the follow-ups interplay: when an edit changes the address of the
//     person an active follow-up run is with, the run's contact_email
//     moves too and a note goes to the Calls history; removing that person
//     does not stop the run, but the reply says it is still going.

import { contactNameKey, isEmailAddress, type ContactLike, type MergedContact, type RemovedContact } from '../contacts.ts';

export type EditAction = 'edit' | 'add' | 'remove';
const ACTIONS: EditAction[] = ['edit', 'add', 'remove'];
const UUID = /^[0-9a-f-]{36}$/i;

export interface ContactEditRequest {
  action: EditAction;
  companySearchId: string;
  contactKey: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  note: string | null;
}

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

export function parseContactEditRequest(raw: unknown): { ok: ContactEditRequest; error: null } | { ok: null; error: string } {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const action = typeof b.action === 'string' && ACTIONS.includes(b.action as EditAction) ? (b.action as EditAction) : null;
  if (!action) return { ok: null, error: 'action must be edit, add or remove' };
  const companySearchId = typeof b.companySearchId === 'string' && UUID.test(b.companySearchId) ? b.companySearchId : null;
  if (!companySearchId) return { ok: null, error: 'companySearchId (uuid) is required' };
  const name = text(b.name, 200);
  const role = text(b.role, 120) || null;
  const emailRaw = text(b.email, 200).toLowerCase();
  if (emailRaw && !isEmailAddress(emailRaw)) return { ok: null, error: 'That does not look like an email address. Check it: name@company.com.' };
  const phone = text(b.phone, 40) || null;
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 500) : '';
  if (action !== 'remove' && !name) return { ok: null, error: 'A name is needed.' };
  if (action === 'remove' && !note) return { ok: null, error: 'Say why, in a few words, so the team knows.' };
  const givenKey = typeof b.contactKey === 'string' ? b.contactKey.toLowerCase().replace(/[^a-z]/g, '').slice(0, 200) : '';
  const contactKey = action === 'add' ? contactNameKey(name) : givenKey || contactNameKey(name);
  if (!contactKey) return { ok: null, error: action === 'add' ? 'A name is needed, with at least one letter.' : 'Which contact? (contactKey or name)' };
  return { ok: { action, companySearchId, contactKey, name, role, email: emailRaw || null, phone, note: note || null }, error: null };
}

const who = (c: { name?: string | null; email?: string | null }) => (c.name || '').trim() || (c.email || '').trim() || 'this contact';

/** Why the edit cannot be written against the company's current contacts, or null when it can. */
export function checkContactEdit<T extends ContactLike>(req: ContactEditRequest, contacts: Array<MergedContact<T>>, removed: Array<RemovedContact<T>>): string | null {
  const listed = contacts.find((c) => c.contactKey === req.contactKey) || null;
  const wasRemoved = removed.find((c) => c.contactKey === req.contactKey) || null;
  if (req.action === 'add') {
    if (listed) return `${who(listed)} is already listed. Edit that entry instead.`;
    if (wasRemoved) return `${wasRemoved.name} was removed by ${wasRemoved.by}${wasRemoved.reason ? ` (${wasRemoved.reason})` : ''}. Put them back from the removed list instead of adding them again.`;
  } else if (!listed && !wasRemoved) {
    return `${req.name || 'That person'} is not on this company's list. Add them instead.`;
  } else if (req.action === 'remove' && !listed) {
    return `${wasRemoved!.name} has already been removed.`;
  }
  if (req.email) {
    const other = contacts.find((c) => c.contactKey !== req.contactKey && (c.email || '').toLowerCase() === req.email);
    if (other) return `${req.email} is already listed for ${who(other)}.`;
  }
  return null;
}

export interface ActiveSequence {
  id: string;
  status: string;
  contact_name: string;
  contact_email: string;
  contact_role: string | null;
}

export interface SequenceEmailChange {
  sequenceId: string;
  from: string;
  to: string;
  /** The line for the Calls history: "Email for Mrs Patel changed to ... by Anja." */
  note: string;
}

/** Is this active run with the person the edit is about: the same key, or the address the person had before the edit. */
function runIsWith(seq: ActiveSequence, req: ContactEditRequest, current: ContactLike | null): boolean {
  if (seq.status !== 'active') return false;
  if (contactNameKey(seq.contact_name) === req.contactKey) return true;
  const before = (current?.email || '').toLowerCase();
  return !!before && seq.contact_email.toLowerCase() === before;
}

/**
 * When an edit gives the person an active follow-up run is with a new
 * address, the run must email the new address from now on. `current` is
 * the person as listed before this edit.
 */
export function sequenceEmailChange(req: ContactEditRequest, current: ContactLike | null, sequences: ActiveSequence[], byName: string): SequenceEmailChange | null {
  if (req.action !== 'edit' || !req.email) return null;
  const seq = sequences.find((s) => runIsWith(s, req, current));
  if (!seq || seq.contact_email.toLowerCase() === req.email) return null;
  return { sequenceId: seq.id, from: seq.contact_email, to: req.email, note: `Email for ${seq.contact_name} changed to ${req.email} by ${byName}.` };
}

/** Removing a person with follow-ups running does not stop the run; say so. */
export function activeRunWarning(req: ContactEditRequest, current: ContactLike | null, sequences: ActiveSequence[]): string | null {
  if (req.action !== 'remove') return null;
  const seq = sequences.find((s) => runIsWith(s, req, current));
  return seq ? `Follow-ups are still running with ${seq.contact_name}. Stop them from the Follow-ups panel if they should stop.` : null;
}

/** The name written on the row and shown in the tag: the profile's display name, else the consultant row's name, else the address's first part. */
export function editorName(profile: { display_name?: string | null; email?: string | null }, consultantName: string | null | undefined): string {
  const display = (profile.display_name || '').trim();
  if (display) return display;
  const consultant = (consultantName || '').trim();
  if (consultant && !/\b(cold|targets?|house|area|new|list|patch|old)\b/i.test(consultant)) return consultant;
  const local = (profile.email || '').split('@')[0].trim();
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : 'a consultant';
}

/** The one-line confirmation for the app. */
export function savedMessage(req: ContactEditRequest, change: SequenceEmailChange | null): string {
  if (req.action === 'remove') return `${req.name || 'The contact'} removed.`;
  if (req.action === 'add') return `${req.name} added.`;
  return `Saved.${req.email ? ` ${req.name} now shows ${req.email}.` : ''}${change ? ' The follow-ups running with them will email the new address.' : ''}`;
}
