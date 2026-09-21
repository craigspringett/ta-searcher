import { describe, expect, it } from "vitest";
import { contactKeyOf, contactNameKey, editTag, isEmailAddress, latestEdits, mergeContacts, removedContacts, shortUkDate, type ContactEditRow } from "../contacts";

// The same cases as supabase/functions/_shared/contacts_test.ts; keep them in step.

interface Dm { name: string; role: string; email: string; confidence?: string; source_url?: string; evidence?: string; phone?: string; feedback?: string }

const site: Dm[] = [
  { name: "Mrs H Patel", role: "Headteacher", email: "head@oak.sch.uk", confidence: "found", source_url: "https://oak.sch.uk/staff", evidence: "Staff page" },
  { name: "Mr A Brown", role: "Deputy Headteacher", email: "", confidence: "role_only", source_url: "https://oak.sch.uk/staff" },
  { name: "", role: "Company office", email: "office@oak.sch.uk", confidence: "found" },
];

const row = (r: Partial<ContactEditRow> & { contact_key: string; action: string; created_at: string }): ContactEditRow => ({
  name: null, role: null, email: null, phone: null, note: null, edited_by_name: "Anja", ...r,
});

const now = new Date("2026-09-18T12:00:00Z");

describe("contactNameKey", () => {
  it("strips the title, case and punctuation so the site's spelling and the consultant's meet", () => {
    expect(contactNameKey("Mrs H. Patel")).toBe("hpatel");
    expect(contactNameKey("H Patel")).toBe("hpatel");
    expect(contactNameKey("Dr Anne-Marie O'Neill")).toBe("annemarieoneill");
    expect(contactNameKey("")).toBe("");
  });
  it("keys a nameless mailbox by its address", () => {
    expect(contactKeyOf({ name: "", email: "office@oak.sch.uk" })).toBe("officeoakschuk");
    expect(contactKeyOf({ name: "Mrs H Patel", email: "head@oak.sch.uk" })).toBe("hpatel");
  });
});

describe("mergeContacts", () => {
  it("an edit replaces the email, phone and role, keeps the site's evidence, and is tagged", () => {
    const edits = [row({ contact_key: "hpatel", action: "edit", name: "Mrs H Patel", role: "Executive Headteacher", email: "HPatel@oak.sch.uk", phone: "020 7946 0000", note: "from the company office, 18 Sep", created_at: "2026-09-18T10:00:00Z" })];
    const out = mergeContacts(site, edits);
    expect(out).toHaveLength(3);
    const head = out[0];
    expect(head.email).toBe("hpatel@oak.sch.uk");
    expect(head.role).toBe("Executive Headteacher");
    expect(head.phone).toBe("020 7946 0000");
    expect(head.source_url).toBe("https://oak.sch.uk/staff");
    expect(head.confidence).toBe("consultant_provided");
    expect(head.edited?.kind).toBe("edited");
    expect(head.edited?.from?.email).toBe("head@oak.sch.uk");
    expect(editTag(head.edited!, now)).toBe("edited by Anja, 18 Sep");
    expect(head.edited?.note).toBe("from the company office, 18 Sep");
    // The others are untouched.
    expect(out[1].edited).toBeUndefined();
    expect(out[2].contactKey).toBe("officeoakschuk");
  });

  it("a refresh that rewrites the list with a different address still shows the consultant's corrected one", () => {
    const edits = [row({ contact_key: "hpatel", action: "edit", name: "Mrs H Patel", email: "hpatel@oak.sch.uk", created_at: "2026-09-18T10:00:00Z" })];
    const refreshed: Dm[] = [{ name: "Mrs H Patel", role: "Headteacher", email: "headteacher@oak.sch.uk", confidence: "found" }, ...site.slice(1)];
    const out = mergeContacts(refreshed, edits);
    expect(out[0].email).toBe("hpatel@oak.sch.uk");
    expect(out[0].edited?.from?.email).toBe("headteacher@oak.sch.uk");
  });

  it("an edit for a person the refresh no longer lists is kept, not dropped", () => {
    const edits = [row({ contact_key: "hpatel", action: "edit", name: "Mrs H Patel", role: "Headteacher", email: "hpatel@oak.sch.uk", created_at: "2026-09-18T10:00:00Z" })];
    const refreshed: Dm[] = site.slice(1);
    const out = mergeContacts(refreshed, edits);
    expect(out.map((c) => c.name)).toEqual(["Mr A Brown", "", "Mrs H Patel"]);
    const kept = out[2];
    expect(kept.email).toBe("hpatel@oak.sch.uk");
    expect(kept.confidence).toBe("consultant_provided");
    expect(kept.edited?.kind).toBe("kept");
    expect(editTag(kept.edited!, now)).toBe("kept by Anja, 18 Sep");
  });

  it("an add appends a person the site did not find, and stays 'added' if the site later names them", () => {
    const edits = [row({ contact_key: "jkhan", action: "add", name: "Mr J Khan", role: "Company Business Manager", email: "sbm@oak.sch.uk", edited_by_name: "Kim", created_at: "2026-09-18T10:00:00Z" })];
    const out = mergeContacts(site, edits);
    expect(out).toHaveLength(4);
    expect(out[3].name).toBe("Mr J Khan");
    expect(out[3].confidence).toBe("consultant_provided");
    expect(editTag(out[3].edited!, now)).toBe("added by Kim, 18 Sep");
    const later = mergeContacts([...site, { name: "J Khan", role: "SBM", email: "", confidence: "role_only" }], edits);
    expect(later).toHaveLength(4);
    expect(later[3].email).toBe("sbm@oak.sch.uk");
    expect(later[3].edited?.kind).toBe("added");
  });

  it("a remove hides the person, removedContacts lists them with the reason, and a later edit puts them back", () => {
    const removed = row({ contact_key: "abrown", action: "remove", name: "Mr A Brown", note: "left at Easter", created_at: "2026-09-18T10:00:00Z" });
    expect(mergeContacts(site, [removed]).map((c) => c.name)).toEqual(["Mrs H Patel", ""]);
    const gone = removedContacts(site, [removed]);
    expect(gone).toHaveLength(1);
    expect(gone[0].name).toBe("Mr A Brown");
    expect(gone[0].reason).toBe("left at Easter");
    expect(gone[0].original?.role).toBe("Deputy Headteacher");
    const back = row({ contact_key: "abrown", action: "edit", name: "Mr A Brown", created_at: "2026-09-18T11:00:00Z" });
    expect(mergeContacts(site, [removed, back]).map((c) => c.name)).toEqual(["Mrs H Patel", "Mr A Brown", ""]);
    expect(removedContacts(site, [removed, back])).toHaveLength(0);
  });

  it("the newest row per person wins, whatever order the rows arrive in", () => {
    const first = row({ contact_key: "hpatel", action: "edit", email: "one@oak.sch.uk", created_at: "2026-09-17T10:00:00Z" });
    const second = row({ contact_key: "hpatel", action: "edit", email: "two@oak.sch.uk", edited_by_name: "Kim", created_at: "2026-09-18T10:00:00Z" });
    expect(mergeContacts(site, [second, first])[0].email).toBe("two@oak.sch.uk");
    expect(mergeContacts(site, [first, second])[0].edited?.by).toBe("Kim");
    expect(latestEdits([first, second]).get("hpatel")?.latest.email).toBe("two@oak.sch.uk");
  });

  it("an empty field in an edit keeps the site's value; a changed address clears an old bounce report", () => {
    const bounced: Dm[] = [{ ...site[0], feedback: "bounced" }];
    const roleOnly = row({ contact_key: "hpatel", action: "edit", role: "Head of Company", created_at: "2026-09-18T10:00:00Z" });
    const a = mergeContacts(bounced, [roleOnly])[0];
    expect(a.email).toBe("head@oak.sch.uk");
    expect(a.role).toBe("Head of Company");
    expect(a.confidence).toBe("found");
    expect(a.feedback).toBe("bounced");
    const newAddress = row({ contact_key: "hpatel", action: "edit", email: "hpatel@oak.sch.uk", created_at: "2026-09-18T10:00:00Z" });
    const b = mergeContacts(bounced, [newAddress])[0];
    expect(b.feedback).toBeUndefined();
    expect(b.confidence).toBe("consultant_provided");
  });

  it("a nameless mailbox can be edited by its address key, and no edits means the list as read", () => {
    const edits = [row({ contact_key: "officeoakschuk", action: "edit", name: "Company office", email: "admin@oak.sch.uk", created_at: "2026-09-18T10:00:00Z" })];
    const out = mergeContacts(site, edits);
    expect(out[2].name).toBe("Company office");
    expect(out[2].email).toBe("admin@oak.sch.uk");
    expect(mergeContacts(site, [])).toHaveLength(3);
    expect(mergeContacts(null, null)).toEqual([]);
    expect(mergeContacts(site, [row({ contact_key: "", action: "edit", created_at: "x" })]).map((c) => c.edited)).toEqual([undefined, undefined, undefined]);
  });
});

describe("helpers", () => {
  it("shortUkDate and isEmailAddress", () => {
    expect(shortUkDate("2026-09-18T10:00:00Z", now)).toBe("18 Sep");
    expect(shortUkDate("2025-12-31T23:30:00Z", now)).toBe("31 Dec 2025");
    expect(shortUkDate("not a date", now)).toBe("");
    expect(isEmailAddress("h.patel@oak.sch.uk")).toBe(true);
    expect(isEmailAddress("h.patel@oak")).toBe(false);
    expect(isEmailAddress("")).toBe(false);
  });
});
