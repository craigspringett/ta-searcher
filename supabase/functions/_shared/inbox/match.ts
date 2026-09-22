// Which company a reply belongs to (22 September 2026). A message is a
// reply worth keeping when its sender is a contact the site knows: the
// contact of an active follow-up run first, then any contact on a tracked
// company (the stored decision makers with the consultant's edits laid
// over), then anyone at a tracked company's own domain. Newsletters and
// no-reply senders are never matched. Pure and tested.

export interface KnownContact {
  companyId: string;
  companyName: string;
  email: string;
  name: string | null;
}

export interface KnownSequence {
  id: string;
  companyId: string;
  contactEmail: string;
  contactName: string;
}

export interface KnownCompany {
  id: string;
  name: string;
  host: string | null;
}

export interface MatchIndex {
  sequencesByEmail: Map<string, KnownSequence>;
  contactsByEmail: Map<string, KnownContact>;
  companiesByHost: Map<string, KnownCompany>;
}

const NEVER_RE = /^(?:no-?reply|noreply|donotreply|do-not-reply|mailer-daemon|postmaster|notifications?|newsletter|news|marketing|hello|info|support|billing|bounce\w*|alerts?|updates?|team|digest)@/i;
const FREE_HOSTS = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'live.co.uk', 'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'me.com', 'protonmail.com', 'proton.me', 'aol.com', 'msn.com']);

export function hostOfEmail(email: string | null | undefined): string | null {
  const at = (email || '').lastIndexOf('@');
  if (at < 0) return null;
  const host = email!.slice(at + 1).toLowerCase().trim();
  return host || null;
}

export function normaliseHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, '') || null; } catch { return null; }
}

export function buildIndex(input: { sequences: KnownSequence[]; contacts: KnownContact[]; companies: KnownCompany[] }): MatchIndex {
  const sequencesByEmail = new Map<string, KnownSequence>();
  for (const s of input.sequences) sequencesByEmail.set(s.contactEmail.toLowerCase(), s);
  const contactsByEmail = new Map<string, KnownContact>();
  for (const c of input.contacts) if (c.email) contactsByEmail.set(c.email.toLowerCase(), c);
  const companiesByHost = new Map<string, KnownCompany>();
  for (const c of input.companies) if (c.host && !FREE_HOSTS.has(c.host)) companiesByHost.set(c.host, c);
  return { sequencesByEmail, contactsByEmail, companiesByHost };
}

export interface ReplyMatch {
  companyId: string;
  companyName: string;
  contactName: string | null;
  sequenceId: string | null;
  /** How it was matched, for the row. */
  note: string;
}

/** The company a sender belongs to, or null when the site does not know them. */
export function matchSender(index: MatchIndex, fromEmail: string | null | undefined, fromName: string | null | undefined): ReplyMatch | null {
  const email = (fromEmail || '').toLowerCase().trim();
  if (!email || NEVER_RE.test(email)) return null;
  const seq = index.sequencesByEmail.get(email);
  if (seq) return { companyId: seq.companyId, companyName: '', contactName: seq.contactName, sequenceId: seq.id, note: 'the contact of an active follow-up run' };
  const contact = index.contactsByEmail.get(email);
  if (contact) return { companyId: contact.companyId, companyName: contact.companyName, contactName: contact.name || fromName || null, sequenceId: null, note: 'a contact on the company' };
  const host = hostOfEmail(email);
  if (host && !FREE_HOSTS.has(host)) {
    const company = index.companiesByHost.get(host);
    if (company) return { companyId: company.id, companyName: company.name, contactName: fromName || null, sequenceId: null, note: `someone at ${host}` };
  }
  return null;
}

/** The part of a reply the person wrote, before the quoted thread. */
export function stripQuotedThread(text: string | null | undefined): string {
  const t = (text || '').replace(/\r\n?/g, '\n');
  const cut = [/^\s*On .{5,120} wrote:\s*$/m, /^\s*-{2,}\s*Original Message\s*-{2,}/mi, /^\s*From:\s.+\n\s*Sent:\s/mi, /^\s*From:\s.+\n\s*Date:\s/mi, /^\s*_{5,}\s*$/m, /^\s*>/m]
    .map((re) => { const m = t.match(re); return m && m.index !== undefined ? m.index : -1; })
    .filter((i) => i >= 0);
  const end = cut.length ? Math.min(...cut) : t.length;
  return t.slice(0, end).trim();
}
