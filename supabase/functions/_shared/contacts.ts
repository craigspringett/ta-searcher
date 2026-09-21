/**
 * Contact edits (18 September 2026): how a consultant's corrections are
 * laid over the contacts read from a company's website.
 *
 * THIS FILE EXISTS TWICE, BYTE FOR BYTE: src/lib/contacts.ts (the app) and
 * supabase/functions/_shared/contacts.ts (the edge functions: the Friday
 * brief, the copy writer, the outreach and follow-up checks). Change both
 * together; _shared/contacts_test.ts fails when they differ, and the tests
 * in src/lib/__tests__/contacts.test.ts and _shared/contacts_test.ts are
 * the same cases.
 *
 * The read contacts live in company_searches.analysis_result.decisionMakers
 * and are rewritten by the weekly refresh. The edits live in
 * company_contact_edits, one row per change, and are merged at read time,
 * so a refresh never loses them. A row finds its person by contact_key:
 * the normalised name (title stripped, lower case, letters only), or the
 * address's letters when the site gave no name (a generic mailbox).
 *
 * The rule, per person (newest row for the key wins):
 *   edit    the row's name, role, email and phone replace what was read
 *           (an empty field in the row keeps the site's value); a changed
 *           address is a consultant-provided one, and clears a "bounced"
 *           or "wrong person" report that was about the old address;
 *   add     a person the site did not name, appended, "added by Anja";
 *   remove  hidden (removedContacts lists them, with the reason);
 *   an edit for a person the refresh no longer lists is still shown,
 *   "kept by Anja", so a correction is never dropped by a refresh.
 */

export type ContactEditAction = "edit" | "add" | "remove";

/** A row of company_contact_edits, as read. */
export interface ContactEditRow {
  id?: string;
  company_search_id?: string;
  contact_key: string;
  name: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  note: string | null;
  action: ContactEditAction | string;
  edited_by?: string | null;
  edited_by_name: string | null;
  created_at: string;
}

/** The fields of a read contact the merge touches; anything else rides along. */
export interface ContactLike {
  name?: string | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  confidence?: string | null;
  feedback?: string | null;
}

export interface ContactEditMark {
  /** edited: the site's person with corrections; added: not on the site; kept: edited earlier, no longer on the site. */
  kind: "edited" | "added" | "kept";
  by: string;
  at: string;
  note: string | null;
  /** What the site had, for "was head@old.sch.uk" on hover. */
  from?: { email: string | null; role: string | null; phone: string | null };
}

export type MergedContact<T extends ContactLike> = T & { contactKey: string; edited?: ContactEditMark };

export interface RemovedContact<T extends ContactLike> {
  contactKey: string;
  name: string;
  role: string | null;
  email: string | null;
  reason: string | null;
  by: string;
  at: string;
  /** The site's entry, when the site still lists the person. */
  original: T | null;
}

const TITLE = /^(?:Mr|Mrs|Ms|Miss|Mx|Dr|Rev|Revd|Reverend|Fr|Father|Sr|Sister|Prof|Professor|Sir|Dame|Lady|Canon|Deacon)\.?\s+/i;

/** "Mrs H Patel" -> "H Patel". The same rule as _shared/contacts/resolve.ts stripTitle. */
export function stripTitle(name: string): string {
  return (name || "").replace(TITLE, "").trim();
}

/** "Mrs H. Patel" -> "hpatel": the key a contact edit is filed under. The same rule as _shared/contacts/review.ts contactNameKey. */
export function contactNameKey(name: string): string {
  return stripTitle(name || "").toLowerCase().replace(/[^a-z]/g, "");
}

/** The key for a read contact: its name, or its address when the site gave no name. */
export function contactKeyOf(c: ContactLike): string {
  return contactNameKey(c.name || "") || contactNameKey(c.email || "");
}

export function isEmailAddress(s: unknown): s is string {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s.trim());
}

function clean(s: string | null | undefined): string {
  return typeof s === "string" ? s.trim() : "";
}

function when(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

interface KeyState {
  latest: ContactEditRow;
  /** Any row for this key was an add: the person came from a consultant, not the site. */
  everAdded: boolean;
}

/** The newest row per key, in the order the keys were first seen (oldest first). */
export function latestEdits(edits: ContactEditRow[]): Map<string, KeyState> {
  const sorted = (Array.isArray(edits) ? edits : []).filter((e) => e && typeof e === "object" && clean(e.contact_key)).slice().sort((a, b) => when(a.created_at) - when(b.created_at));
  const out = new Map<string, KeyState>();
  for (const e of sorted) {
    const key = clean(e.contact_key);
    const cur = out.get(key);
    out.set(key, { latest: e, everAdded: (cur?.everAdded ?? false) || e.action === "add" });
  }
  return out;
}

function mark(kind: ContactEditMark["kind"], row: ContactEditRow, from?: ContactEditMark["from"]): ContactEditMark {
  return { kind, by: clean(row.edited_by_name) || "a consultant", at: row.created_at, note: clean(row.note) || null, ...(from ? { from } : {}) };
}

/**
 * The read contacts with the edits laid over them. Pure. The order is the
 * site's, with added and kept people after it in the order they were
 * first edited.
 */
export function mergeContacts<T extends ContactLike>(decisionMakers: T[] | null | undefined, edits: ContactEditRow[] | null | undefined): Array<MergedContact<T>> {
  const states = latestEdits(edits || []);
  const out: Array<MergedContact<T>> = [];
  const seen = new Set<string>();
  for (const dm of Array.isArray(decisionMakers) ? decisionMakers : []) {
    if (!dm || typeof dm !== "object") continue;
    const key = contactKeyOf(dm);
    const state = key ? states.get(key) : undefined;
    if (!state || seen.has(key)) {
      out.push({ ...dm, contactKey: key });
      continue;
    }
    seen.add(key);
    const row = state.latest;
    if (row.action === "remove") continue;
    const newEmail = clean(row.email).toLowerCase();
    const oldEmail = clean(dm.email).toLowerCase();
    const emailChanged = !!newEmail && newEmail !== oldEmail;
    const merged = {
      ...dm,
      name: clean(row.name) || dm.name,
      role: clean(row.role) || dm.role,
      email: newEmail || dm.email,
      phone: clean(row.phone) || dm.phone,
      ...(emailChanged ? { confidence: "consultant_provided", feedback: undefined } : {}),
      contactKey: key,
      edited: mark(state.everAdded ? "added" : "edited", row, { email: dm.email ?? null, role: dm.role ?? null, phone: dm.phone ?? null }),
    } as MergedContact<T>;
    out.push(merged);
  }
  for (const [key, state] of states) {
    if (seen.has(key)) continue;
    const row = state.latest;
    if (row.action === "remove") continue;
    const email = clean(row.email).toLowerCase();
    const added = {
      name: clean(row.name),
      role: clean(row.role),
      email,
      ...(clean(row.phone) ? { phone: clean(row.phone) } : {}),
      confidence: email ? "consultant_provided" : "role_only",
      level: "company",
      contactKey: key,
      edited: mark(state.everAdded ? "added" : "kept", row),
    } as unknown as MergedContact<T>;
    out.push(added);
  }
  return out;
}

/** The people a consultant removed, newest removal first, so a wrong removal can be put back. */
export function removedContacts<T extends ContactLike>(decisionMakers: T[] | null | undefined, edits: ContactEditRow[] | null | undefined): Array<RemovedContact<T>> {
  const byKey = new Map<string, T>();
  for (const dm of Array.isArray(decisionMakers) ? decisionMakers : []) {
    if (!dm || typeof dm !== "object") continue;
    const key = contactKeyOf(dm);
    if (key && !byKey.has(key)) byKey.set(key, dm);
  }
  const out: Array<RemovedContact<T>> = [];
  for (const [key, state] of latestEdits(edits || [])) {
    const row = state.latest;
    if (row.action !== "remove") continue;
    const original = byKey.get(key) ?? null;
    out.push({
      contactKey: key,
      name: clean(row.name) || clean(original?.name) || "(no name)",
      role: clean(row.role) || clean(original?.role) || null,
      email: clean(row.email).toLowerCase() || clean(original?.email).toLowerCase() || null,
      reason: clean(row.note) || null,
      by: clean(row.edited_by_name) || "a consultant",
      at: row.created_at,
      original,
    });
  }
  return out.sort((a, b) => when(b.at) - when(a.at));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "18 Sep", or "18 Sep 2025" in another year, in London time (a fixed list, because ICU writes "Sept" for en-GB). */
export function shortUkDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Europe/London" }).formatToParts(d);
  const get = (t: string) => Number(parts.find((x) => x.type === t)?.value || 0);
  const year = get("year");
  const nowYear = Number(new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: "Europe/London" }).format(now));
  return `${get("day")} ${MONTHS[get("month") - 1] || ""}${year !== nowYear ? ` ${year}` : ""}`;
}

/** "edited by Anja, 18 Sep" / "added by Anja, 18 Sep" / "kept by Anja, 18 Sep". */
export function editTag(mark: ContactEditMark, now: Date = new Date()): string {
  const date = shortUkDate(mark.at, now);
  return `${mark.kind} by ${mark.by}${date ? `, ${date}` : ""}`;
}
