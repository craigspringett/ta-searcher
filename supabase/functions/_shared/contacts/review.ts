// Apply the model's review of the CONTACTS block to the deterministic
// contacts. Lives here (not in analyze-company) so it can be unit tested.

import type { EmailHit } from './extract.ts';
import { classifyRole, type Contact, type ContactLevel, stripTitle } from './resolve.ts';

export interface DecisionMaker {
  name: string;
  role: string;
  email: string;
  /** How the contact was established. Older analyses lack these fields. */
  confidence?: 'found' | 'pattern_guess' | 'role_only' | 'consultant_provided';
  source_url?: string;
  evidence?: string;
  phone?: string;
  /** 'careers' when the page was the company's careers page on another host. */
  level?: ContactLevel;
  /** Taxonomy label derived from the role text (Founder / CEO, Head of Talent, ...). */
  roleLabel?: string;
  /** Consultant-list import: who provided the row and when; the sheet's status and notes columns. */
  provided_by?: string;
  provided_at?: string;
  sheet_status?: string;
  notes?: string;
  /** Set by the app when a consultant reports the contact. Kept across refreshes. */
  feedback?: string;
}

/** A name-only entry the Companies House register supplied, not the website. */
function isRegisterOfficer(d: DecisionMaker): boolean {
  return d.confidence === 'role_only' && /companies house/i.test(d.source_url || '');
}

/** "Helen Manwaring" and "Ms H Manwaring" are one person: same surname, and the first names agree or one is the other's initial. */
export function samePerson(a: string, b: string): boolean {
  const ta = stripTitle(a || '').toLowerCase().replace(/[^a-z\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const tb = stripTitle(b || '').toLowerCase().replace(/[^a-z\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (ta.length < 2 || tb.length < 2) return false;
  if (ta[ta.length - 1] !== tb[tb.length - 1]) return false;
  const fa = ta[0], fb = tb[0];
  return fa === fb || (fa.length === 1 && fb.startsWith(fa)) || (fb.length === 1 && fa.startsWith(fb));
}

/**
 * A refresh recomputes the contacts from the website, but a contact a
 * consultant typed in (`provided_by` set: their reviewed company list,
 * labelled consultant_provided, or pattern_guess when the sheet said the
 * address was inferred) is theirs to keep: it is never dropped or
 * relabelled by a run. The provided entries come first, in their stored
 * order; a fresh entry with the same address or the same person is folded
 * into the provided one (filling a missing address or phone) rather than
 * listed twice; and a Companies House officer added as name-only is left
 * out when the consultant has named a founder, because the sheet is the
 * fresher account of who runs the company.
 */
export function mergeProvidedContacts(fresh: DecisionMaker[], previous: DecisionMaker[] | null | undefined): DecisionMaker[] {
  const provided = (Array.isArray(previous) ? previous : []).filter((d) => d && typeof d === 'object' && d.provided_by).map((d) => ({ ...d }));
  if (!provided.length) return fresh;
  const byEmail = new Map<string, DecisionMaker>();
  const byName = new Map<string, DecisionMaker>();
  for (const p of provided) {
    if (p.email) byEmail.set(p.email.toLowerCase(), p);
    const k = contactNameKey(p.name || '');
    if (k) byName.set(k, p);
  }
  const providedFounder = provided.some((p) => (p.name || '').trim() && classifyRole(p.role)?.key === 'founder');
  const rest: DecisionMaker[] = [];
  for (const f of fresh) {
    const twin = (f.email && byEmail.get(f.email.toLowerCase())) || (contactNameKey(f.name || '') && byName.get(contactNameKey(f.name || ''))) || provided.find((p) => samePerson(p.name, f.name)) || null;
    if (twin) {
      if (!twin.email && f.email && f.confidence === 'found') {
        twin.email = f.email;
        twin.evidence = `${twin.evidence || ''}${twin.evidence ? ' ' : ''}Address found on ${f.source_url || 'the website'} on a later refresh.`.trim();
      }
      if (!twin.phone && f.phone) twin.phone = f.phone;
      continue;
    }
    if (providedFounder && isRegisterOfficer(f)) continue;
    rest.push(f);
  }
  return [...provided, ...rest];
}

export function toDecisionMaker(c: Contact): DecisionMaker {
  const dm: DecisionMaker = { name: c.name, role: c.role, email: c.email, confidence: c.confidence, source_url: c.source_url, evidence: c.evidence };
  const cls = classifyRole(c.role);
  if (cls) dm.roleLabel = cls.label;
  if (c.phone) dm.phone = c.phone;
  if (c.level) dm.level = c.level;
  return dm;
}

export function contactNameKey(name: string): string {
  return stripTitle(name || '').toLowerCase().replace(/[^a-z]/g, '');
}

export interface ModelContactRow {
  name?: unknown;
  email?: unknown;
  role?: unknown;
  flag?: unknown;
}

/**
 * The model may drop a contact (by setting a flag), relabel a role within the
 * same rank, or move an address from the input set to another person in the
 * block. It can never introduce an address that was not extracted from a
 * page: any such entry is discarded. Contacts the model left out are kept,
 * because a truncated or rate-limited answer must not silently lose real
 * people. A join correction only moves an address that was actually found on
 * a page: a pattern guess was built from the first person's name and says
 * nothing about anyone else, so it is never re-homed and never becomes
 * "found".
 */
export function applyModelContactReview(contacts: Contact[], emailHits: EmailHit[], modelOut: ModelContactRow[] | undefined): DecisionMaker[] {
  const allowed = new Set(emailHits.map((e) => e.email.toLowerCase()));
  for (const c of contacts) if (c.email) allowed.add(c.email.toLowerCase());
  const out = contacts.map((c) => ({ ...c }));
  if (!Array.isArray(modelOut) || modelOut.length === 0) return out.map(toDecisionMaker);
  const byEmail = new Map(out.filter((c) => c.email).map((c) => [c.email.toLowerCase(), c]));
  const byName = new Map(out.filter((c) => c.name).map((c) => [contactNameKey(c.name), c]));
  const flagged = new Set<Contact>();
  for (const m of modelOut) {
    const email = String(m?.email || '').trim().toLowerCase();
    const name = String(m?.name || '').trim();
    const flag = String(m?.flag || '').trim();
    if (email && !allowed.has(email)) {
      console.log(`  ✗ model returned an address that is not in the input set, discarded: ${email}`);
      continue;
    }
    const target = (email && byEmail.get(email)) || (name && byName.get(contactNameKey(name))) || null;
    if (!target) continue;
    if (flag && flag.length > 2) {
      flagged.add(target);
      console.log(`  ✗ model flagged ${target.name || target.email}: ${flag.slice(0, 80)}`);
      continue;
    }
    // The role text stays as the page wrote it; the taxonomy label is derived, never written by the model.
    // A corrected join: a found address moves to another person in the block who has none.
    if (email && name && target.email.toLowerCase() === email && target.name && contactNameKey(name) !== contactNameKey(target.name)) {
      if (target.confidence !== 'found') {
        console.log(`  ✗ model tried to move a ${target.confidence} address (${email}) to ${name}; only found addresses move`);
        continue;
      }
      const other = byName.get(contactNameKey(name));
      if (other && !other.email && other.level === target.level) {
        other.email = target.email;
        other.confidence = 'found';
        other.evidence = `${other.evidence} (join corrected by the model from ${target.name})`.slice(0, 400);
        target.email = '';
        target.confidence = 'role_only';
        byEmail.set(email, other);
      }
    }
  }
  return out.filter((c) => !flagged.has(c)).filter((c) => c.email || c.name).map(toDecisionMaker);
}
