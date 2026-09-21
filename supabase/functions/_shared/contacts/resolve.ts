// Turn extracted emails and people into ranked contacts.
//
// Every contact is one of:
//   found          the address was on a fetched page and is joined to a person
//                  (same row / card, surname in the local part, or the person's
//                  name in the address's context), or a generic mailbox found
//                  on the site;
//   role_only      a person with a ranked role and no address (a founder named
//                  on the team page without a link, or a director from the
//                  Companies House register);
//   pattern_guess  built from a pattern that at least two found personal
//                  addresses on the same domain share (see guessByPattern).
//   consultant_provided  typed in by a consultant (their reviewed company
//                  list); never produced here, only merged in by review.ts,
//                  and never replaced by a refresh.
// Nothing else constructs an address.

import type { EmailHit, PersonHit, PhoneHit } from './extract.ts';

export type Confidence = 'found' | 'pattern_guess' | 'role_only' | 'consultant_provided';

/** 'careers' when the page was the company's careers page on another host (an ATS board or a careers. sub-domain). */
export type ContactLevel = 'company' | 'careers';

export interface Contact {
  name: string;
  role: string;
  email: string;
  confidence: Confidence;
  source_url: string;
  evidence: string;
  phone?: string;
  level?: ContactLevel;
  rank?: number;
}

export interface RoleClass {
  rank: number;
  label: string;
  key: RoleKey;
}

export type RoleKey = 'founder' | 'coo' | 'cto' | 'people' | 'talent' | 'exec' | 'ea' | 'investor';

/** Investors and board members are never guessed for and never seed a pattern: they are on their fund's mail, not the company's. */
export const INVESTOR_RANK = 8;

// The taxonomy (docs/PORT-CONTRACTS.md, "Contacts"), highest rank first in
// the result but tested in this order: the EA check runs before everything
// so "EA to the CEO" is the assistant, not the founder; then the ranks in
// order, so "Co-founder and CTO" is a founder, "Head of Talent" is talent
// before the generic executive rule can claim it, and "Talent Partner" is
// talent before "Partner" can read as an investor.
const TAXONOMY: Array<RoleClass & { re: RegExp; not?: RegExp }> = [
  {
    key: 'ea', rank: 7, label: 'EA / Office manager',
    re: /\b(?:\bea\b|executive assistant|personal assistant|\bpa\b|\bea\/|assistant to the|office manager|office (?:and|&) (?:people|operations) manager|workplace manager|head of office|executive business partner)\b/i,
  },
  {
    key: 'founder', rank: 1, label: 'Founder / CEO',
    re: /\b(?:co-?founder|founder|founding (?:ceo|partner|team)|\bceo\b|chief executive(?: officer)?|managing director|\bmd\b|president)\b/i,
    // "Chief of Staff to the CEO" is the chief of staff; "Founding Engineer" and "Founder's Associate" are not founders; a vice president is not the president.
    not: /\b(?:chief of staff|vice[- ]president|\bvp\b|associate|office of the|to the (?:ceo|founders?|chief)|founding (?:engineer|designer|developer|scientist|researcher|account|sales|recruiter|member|product|gtm|analyst)|founder['’]?s (?:associate|office))\b/i,
  },
  {
    key: 'coo', rank: 2, label: 'COO / Chief of Staff',
    re: /\b(?:\bcoo\b|chief operating officer|chief operations officer|chief of staff|head of operations|head of ops|vp,? (?:of )?operations|vice president,? (?:of )?operations|director of operations|operations director|general manager)\b/i,
    not: /\b(?:head of (?:people|talent|sales|marketing|revenue|customer|engineering) operations|people operations|talent operations|sales operations|revenue operations|marketing operations)\b/i,
  },
  {
    key: 'cto', rank: 3, label: 'CTO / VP Engineering',
    re: /\b(?:\bcto\b|chief technology officer|chief technical officer|vp,? (?:of )?engineering|vice president,? (?:of )?engineering|head of engineering|engineering director|director of engineering|vp,? (?:of )?technology|head of technology|chief architect)\b/i,
  },
  {
    key: 'people', rank: 4, label: 'Head of People',
    re: /\b(?:chief people officer|\bcpo\b|head of people|vp,? (?:of )?people|vice president,? (?:of )?people|director of people|people director|people partner|people lead|people (?:operations|ops) (?:lead|manager|director|partner)|people (?:and|&) (?:culture|talent) (?:lead|director|manager|partner)|head of people (?:and|&) (?:culture|talent)|head of hr|hr director|director of hr|vp,? hr|chief human resources officer|\bchro\b|head of human resources|hr business partner|\bhrbp\b|hr manager|people manager)\b/i,
    not: /\bchief product officer\b/i,
  },
  {
    key: 'talent', rank: 5, label: 'Head of Talent',
    re: /\b(?:head of talent|head of recruitment|head of recruiting|head of talent acquisition|talent acquisition|talent partner|talent lead|talent manager|talent director|director of talent|vp,? (?:of )?talent|recruiter|recruiting|recruitment (?:lead|manager|partner|director|specialist|consultant|coordinator|co-ordinator)|sourcer|head of talent (?:and|&) people)\b/i,
  },
  {
    key: 'exec', rank: 6, label: 'Executive',
    re: /\b(?:chief [a-z]+ officer|\bc[a-z]{1,2}o\b|\bvp\b|vice president|\bsvp\b|\bevp\b|director)\b/i,
    // A non-executive director is an investor or board member; an account, art or creative director runs a team, not the company.
    not: /\b(?:non-?executive|\bned\b|board|account director|art director|creative director|director of photography|associate director of)\b/i,
  },
  {
    key: 'investor', rank: INVESTOR_RANK, label: 'Investor / Board',
    re: /\b(?:investor|angel|board member|board observer|board director|board chair|chair(?:man|woman|person)? of the board|non-?executive(?: director)?|\bned\b|general partner|managing partner|venture partner|operating partner|platform partner|^partner\b|advisory board)\b/i,
    not: /\binvestor relations\b/i,
  },
];

/** Map a free-text role to the taxonomy, or null when it is not a recruitment decision-maker role. */
export function classifyRole(role: string): RoleClass | null {
  const r = (role || '').replace(/\s+/g, ' ').trim();
  if (!r) return null;
  for (const t of TAXONOMY) {
    if (!t.re.test(r)) continue;
    if (t.not && t.not.test(r)) continue;
    return { key: t.key, rank: t.rank, label: t.label };
  }
  return null;
}

/** The label for a role's taxonomy class, or null when the role does not rank. */
export function roleLabel(role: string): string | null {
  return classifyRole(role)?.label ?? null;
}

const GENERIC_LOCAL: Array<{ re: RegExp; role: string; rank: number }> = [
  { re: /^(founders|founder)$/, role: 'Founders mailbox', rank: 1 },
  { re: /^(people|peopleteam|peopleops)$/, role: 'People mailbox', rank: 4 },
  { re: /^(careers|jobs|talent|recruiting|recruitment|hiring|joinus|join|work)$/, role: 'Careers mailbox', rank: 5 },
  { re: /^(hello|hi|team|info|contact|hey|mail|enquiries|office)$/, role: 'General mailbox', rank: 7 },
  // Mailboxes that are not a person and not a way in: recognised so they are never joined to a person, never shown.
  { re: /^(press|media|support|help|sales|privacy|legal|security|billing|abuse|dpo|partnerships|partners|investors|ir|noreply|no-reply|donotreply|marketing|news|newsletter|feedback|complaints|accounts|invoices|finance|payments|compliance|status|api|dev|developers|community|events|affiliates|careers-noreply)$/, role: '', rank: -1 },
];

export function genericMailbox(email: string): { role: string; rank: number } | null {
  const local = (email.split('@')[0] || '').toLowerCase().replace(/[._-]/g, '');
  for (const g of GENERIC_LOCAL) if (g.re.test(local)) return { role: g.role, rank: g.rank };
  return null;
}

/** The generic mailbox shown at most once per company and given the office phone. */
export const GENERAL_MAILBOX_ROLE = 'General mailbox';

export function stripTitle(name: string): string {
  return (name || '').replace(/^(?:Mr|Mrs|Ms|Miss|Mx|Dr|Rev|Revd|Reverend|Fr|Father|Sr|Sister|Prof|Professor|Sir|Dame|Lady|Canon|Deacon)\.?\s+/i, '').trim();
}

export function nameParts(name: string): { first: string | null; initial: string | null; last: string | null; words: string[] } {
  const words = stripTitle(name).replace(/[’']/g, "'").split(/\s+/).filter(Boolean);
  if (words.length === 0) return { first: null, initial: null, last: null, words };
  const last = words[words.length - 1].toLowerCase().replace(/[^a-z-]/g, '');
  const firstWord = words.length > 1 ? words[0] : null;
  const isInitial = !!firstWord && /^[A-Z]\.?$/.test(firstWord);
  const first = firstWord && !isInitial ? firstWord.toLowerCase().replace(/[^a-z]/g, '') : null;
  const initial = firstWord ? firstWord[0].toLowerCase() : null;
  return { first, initial, last: last || null, words };
}

/** An officer from the Companies House register: a name and a role, never an address. */
export interface RecordOfficer {
  name: string;
  jobTitle: string | null;
  /** Where it came from, for the evidence line: "Companies House register". Not a URL, so never anchors a pattern guess. */
  source: string;
  appointedOn?: string | null;
}

export interface ResolveInput {
  emails: EmailHit[];
  people: PersonHit[];
  phones: PhoneHit[];
  /** Host of the company's website (used to tag which domain is the company's). */
  siteHost: string | null;
  /** Pages tagged careers-level (an ATS board or a careers. sub-domain), by URL. */
  careersPageUrls?: Set<string>;
  /** Emails (lower case) and "name|role" keys a consultant has reported. */
  suppressedEmails?: Set<string>;
  suppressedNames?: Set<string>;
  /** Current officers from the Companies House register, when known. */
  recordOfficers?: RecordOfficer[] | null;
  /** The company's name: a "person" whose words all sit in it is the company, not a contact. */
  companyName?: string | null;
  maxContacts?: number;
}

/** "Mrs O'Reilly", "Mrs E O'Reilly" and "Emma O'Reilly" are one person: same surname, compatible first name or initial. */
export function samePerson(a: string, b: string): boolean {
  const pa = nameParts(a), pb = nameParts(b);
  if (!pa.last || !pb.last || pa.last !== pb.last) return false;
  if (pa.last.length < 3) return false;
  if (pa.first && pb.first) return pa.first === pb.first;
  if (pa.initial && pb.initial) return pa.initial === pb.initial;
  return true;
}

/** Does the surname sit in the address as a whole component ("gpersand", "sarah.donachy", "lafavergesp"), not as a fragment ("djohnson" for John)? */
export function surnameInLocal(local: string, last: string): boolean {
  const l = last.replace(/[^a-z]/g, '');
  if (l.length < 3) return false;
  const re = new RegExp(`^(?:[a-z]{1,2}[._-]?)?${l}(?:[._-]?[a-z]{1,2})?\\d*$|^[a-z]+[._-]${l}\\d*$|^${l}[._-][a-z]+\\d*$`);
  return re.test(local);
}

const TITLE_LOCALS = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'rev', 'sir']);

/** The component before the surname in the local part: "emma" in emma.brown, "a" in abrown, null when the surname leads (brown.e) or stands alone. */
export function leadingComponent(local: string, last: string): string | null {
  const l = last.replace(/[^a-z]/g, '');
  if (l.length < 3) return null;
  const m = new RegExp(`^([a-z]+)[._-]${l}\\d*$|^([a-z]{1,2})[._-]?${l}(?:[._-]?[a-z]{1,2})?\\d*$`).exec(local.toLowerCase());
  return m?.[1] ?? m?.[2] ?? null;
}

/**
 * "emma.brown@" is not Mr A Brown's address, and "a.brown@" is not Emma
 * Brown's: when the local part carries a first name or an initial before the
 * surname and the person's own first name or initial disagrees, the surname
 * alone is not a join. "e.brown@" fits both Emma Brown and Mr E Brown, and
 * "mrs.brown@" is a title, not a name.
 */
export function leadingComponentContradicts(local: string, parts: { first: string | null; initial: string | null; last: string | null }): boolean {
  if (!parts.last || !parts.initial) return false;
  const lead = leadingComponent(local, parts.last);
  if (!lead || TITLE_LOCALS.has(lead)) return false;
  if (lead[0] !== parts.initial) return true;
  if (lead.length >= 3 && parts.first && parts.first.length >= 3 && !lead.startsWith(parts.first) && !parts.first.startsWith(lead)) return true;
  return false;
}

/** One PersonHit per person across pages: keep the one with an address, else the longer role. */
export function mergePeople(people: PersonHit[]): PersonHit[] {
  const out: PersonHit[] = [];
  for (const p of people) {
    const existing = out.find((o) => samePerson(o.name, p.name));
    if (!existing) { out.push({ ...p }); continue; }
    if (!existing.email && p.email) { existing.email = p.email; existing.source_url = p.source_url; existing.context = p.context; }
    if (stripTitle(p.name).split(' ').length > stripTitle(existing.name).split(' ').length && !/^[A-Z]\.?$/.test(stripTitle(p.name).split(' ')[0])) existing.name = p.name;
    if (!classifyRole(existing.role) && classifyRole(p.role)) existing.role = p.role;
    else if (classifyRole(existing.role) && classifyRole(p.role) && classifyRole(p.role)!.rank < classifyRole(existing.role)!.rank) existing.role = p.role;
  }
  return out;
}

export interface ResolveOutput {
  contacts: Contact[];
  /** All joined / generic emails, for the LLM step's allow-list. */
  emailsInPlay: string[];
  patternNote: string | null;
  officePhone: string | null;
}

function domainOf(email: string): string {
  return email.split('@')[1] || '';
}

function confidenceOrder(c: Confidence): number {
  return c === 'consultant_provided' ? 0 : c === 'found' ? 1 : c === 'pattern_guess' ? 2 : 3;
}

/** Join emails to people and rank them. */
export function resolveContacts(input: ResolveInput): ResolveOutput {
  const maxContacts = input.maxContacts ?? 8;
  const suppressedEmails = input.suppressedEmails ?? new Set<string>();
  const suppressedNames = input.suppressedNames ?? new Set<string>();
  const careersUrls = input.careersPageUrls ?? new Set<string>();
  const levelOf = (url: string): ContactLevel => (careersUrls.has(url) ? 'careers' : 'company');

  const emails = input.emails.filter((e) => !suppressedEmails.has(e.email.toLowerCase()));
  const companyTokens = new Set((input.companyName || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((t) => t.length >= 3));
  const isCompanyName = (name: string) => {
    const words = stripTitle(name).toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
    return words.length > 0 && companyTokens.size > 0 && words.every((w) => companyTokens.has(w));
  };
  const people = mergePeople(input.people.filter((p) => !isCompanyName(p.name)));
  const emailByAddr = new Map<string, EmailHit>();
  for (const e of emails) if (!emailByAddr.has(e.email)) emailByAddr.set(e.email, e);

  // Where each person's name sits in each address's context (about 200
  // characters of collapsed text around the address, so "the line" is that
  // window): the position and whether the name precedes the address.
  const positionsFor = new Map<EmailHit, Map<PersonHit, { idx: number; len: number }>>();
  const namePositions = (e: EmailHit): Map<PersonHit, { idx: number; len: number }> => {
    let m = positionsFor.get(e);
    if (m) return m;
    m = new Map();
    const ctx = (e.context || '').toLowerCase();
    for (const p of people) {
      const parts = nameParts(p.name);
      const full = stripTitle(p.name).toLowerCase();
      if (full && parts.words.length >= 2) {
        const idx = ctx.indexOf(full);
        if (idx >= 0) { m.set(p, { idx, len: full.length }); continue; }
      }
      if (parts.last && parts.last.length >= 4) {
        const tm = new RegExp(`\\b(?:mr|mrs|ms|miss|mx|dr)\\.?\\s+(?:[a-z]\\.?\\s+)?${parts.last}\\b`).exec(ctx);
        if (tm) m.set(p, { idx: tm.index, len: tm[0].length });
      }
    }
    positionsFor.set(e, m);
    return m;
  };

  // Score every (person, email) pair; each email joins at most one person.
  // Ties on score go to the name nearest the address.
  const joins = new Map<string, { person: PersonHit; score: number; why: string }>();
  const scored: Array<{ person: PersonHit; email: string; score: number; distance: number; why: string }> = [];
  const FAR = 1000;
  for (const p of people) {
    const parts = nameParts(p.name);
    // Same row or card: strongest join, except for a mailbox that is nobody's address (press@, support@).
    if (p.email && emailByAddr.has(p.email) && (genericMailbox(p.email)?.rank ?? 0) >= 0) scored.push({ person: p, email: p.email, score: 3, distance: 0, why: 'same row or card' });
    for (const e of emails) {
      if (p.email === e.email) continue;
      // A shared mailbox (hello@, press@) is never a person's address, however close the name sits.
      if (genericMailbox(e.email)) continue;
      const rawLocal = e.email.split('@')[0];
      const local = rawLocal.replace(/[^a-z]/g, '');
      const ctx = (e.context || '').toLowerCase();
      // "emma.brown@" names someone else: never Mr A Brown's, however close his name sits (H3).
      if (leadingComponentContradicts(rawLocal, parts)) continue;
      let score = 0;
      let why = '';
      if (parts.last && surnameInLocal(rawLocal, parts.last)) {
        score = 2;
        why = `surname "${parts.last}" in the address`;
        if (parts.initial && (local.startsWith(parts.initial + parts.last.replace(/-/g, '')) || (parts.first && local.startsWith(parts.first)))) score = 2.5;
      }
      // Name in the context: only when it sits within 60 characters of the
      // address, so neighbours on a team grid do not swap addresses, and
      // only before the address unless it is the only name in the window
      // ("Ava Brown, COO ops@x Chloe Davis, CTO" is Ava Brown's address) (H4).
      const emailIdx = ctx.indexOf(e.email.toLowerCase());
      const positions = namePositions(e);
      const pos = positions.get(p);
      let distance = FAR;
      if (pos && emailIdx >= 0) {
        const precedes = pos.idx + pos.len <= emailIdx;
        distance = Math.max(0, precedes ? emailIdx - (pos.idx + pos.len) : pos.idx - (emailIdx + e.email.length));
        const onlyName = positions.size === 1;
        if (distance <= 60 && (precedes || onlyName)) { score = Math.max(score, 2); why = why || 'name in the text next to the address'; }
      }
      if (score >= 2 && e.source_url === p.source_url) score += 0.25;
      if (score >= 2) scored.push({ person: p, email: e.email, score, distance, why });
    }
  }
  scored.sort((a, b) => (b.score - a.score) || (a.distance - b.distance));
  const personEmail = new Map<PersonHit, { email: string; why: string }>();
  for (const s of scored) {
    if (joins.has(s.email) || personEmail.has(s.person)) continue;
    joins.set(s.email, { person: s.person, score: s.score, why: s.why });
    personEmail.set(s.person, { email: s.email, why: s.why });
  }

  const contacts: Contact[] = [];
  const usedEmails = new Set<string>();
  const usedNames = new Set<string>();
  const nameKey = (n: string) => stripTitle(n).toLowerCase().replace(/[^a-z]/g, '');

  // People with ranked roles: found (joined) or role_only.
  for (const p of people) {
    const cls = classifyRole(p.role);
    if (!cls) continue;
    const nk = nameKey(p.name);
    if (!nk || usedNames.has(nk)) continue;
    if (suppressedNames.has(`${nk}|${cls.key}`) || suppressedNames.has(nk)) continue;
    const join = personEmail.get(p);
    const level = levelOf(p.source_url);
    if (join) {
      const hit = emailByAddr.get(join.email)!;
      contacts.push({
        name: p.name, role: p.role, email: join.email, confidence: 'found', source_url: hit.source_url,
        evidence: `${(hit.context || p.context || '').slice(0, 200)}${join.why !== 'same row or card' ? ` (joined: ${join.why})` : ''}`,
        level, rank: cls.rank,
      });
      usedEmails.add(join.email);
    } else {
      contacts.push({ name: p.name, role: p.role, email: '', confidence: 'role_only', source_url: p.source_url, evidence: (p.context || '').slice(0, 200), level, rank: cls.rank });
    }
    usedNames.add(nk);
  }

  // Emails with a role in their context but no person (e.g. "Head of Talent: talent@..."),
  // and genuinely-found generic mailboxes.
  for (const e of emails) {
    if (usedEmails.has(e.email) || joins.has(e.email)) continue;
    const generic = genericMailbox(e.email);
    if (generic) {
      if (generic.rank < 0) continue;
      contacts.push({ name: '', role: generic.role, email: e.email, confidence: 'found', source_url: e.source_url, evidence: (e.context || e.linkText || '').slice(0, 200), level: levelOf(e.source_url), rank: generic.rank });
      usedEmails.add(e.email);
      continue;
    }
    const ctxRole = roleInContext(e);
    if (ctxRole) {
      // A titled name right next to the address is the person ("CEO Dr Sarah Donachy: s.donachy@...").
      const near = (e.context || '').match(new RegExp(`\\b((?:Mr|Mrs|Ms|Miss|Mx|Dr|Rev|Revd|Prof|Sir)\\.?\\s+(?:[A-Z]\\.?\\s+)?[A-Z][a-z'’-]+(?:\\s+[A-Z][a-z'’-]+)?)\\b[^@]{0,60}${e.email.replace(/[.+]/g, '\\$&')}`));
      const name = near && !usedNames.has(nameKey(near[1])) ? near[1] : '';
      contacts.push({ name, role: ctxRole.text, email: e.email, confidence: 'found', source_url: e.source_url, evidence: (e.context || '').slice(0, 200), level: levelOf(e.source_url), rank: ctxRole.cls.rank });
      usedEmails.add(e.email);
      if (name) usedNames.add(nameKey(name));
    }
  }

  // The Companies House officers: the website's entry for the same person
  // wins and gains a note; an officer the website does not name is added
  // as name-only when the register's role ranks (a director is an executive).
  for (const officer of input.recordOfficers || []) {
    if (!officer?.name) continue;
    const recKey = nameKey(officer.name);
    if (!recKey) continue;
    const onSite = contacts.find((c) => c.name && samePerson(c.name, officer.name));
    const note = `${officer.jobTitle || 'officer'}${officer.appointedOn ? ` since ${officer.appointedOn}` : ''} on the ${officer.source}`;
    if (onSite) {
      if (!onSite.evidence.includes(officer.source)) onSite.evidence = `${onSite.evidence} | ${note}.`.slice(0, 400);
      continue;
    }
    if (usedNames.has(recKey) || suppressedNames.has(recKey)) continue;
    const role = officer.jobTitle || 'Director';
    const cls = classifyRole(role);
    if (!cls) continue;
    contacts.push({
      name: officer.name, role, email: '', confidence: 'role_only',
      source_url: officer.source, evidence: `Named as ${note}; not found on the website.`,
      level: 'company', rank: cls.rank,
    });
    usedNames.add(recKey);
  }

  // Pattern guesses, strictly.
  const guess = guessByPattern(contacts, input.siteHost, suppressedEmails);

  // Selection: a real address always beats a name-only entry of any rank, and
  // no more than three name-only people per rank, so eight directors cannot
  // push the one Head of Talent with an address off the list. Display order
  // is rank, then confidence.
  const ranked = contacts.filter((c) => c.rank !== undefined);
  const byPriority = [...ranked].sort((a, b) => (confidenceOrder(a.confidence) - confidenceOrder(b.confidence)) || (a.rank! - b.rank!) || (a.level === 'careers' ? 1 : 0) - (b.level === 'careers' ? 1 : 0));
  const seenGeneral = { n: 0 };
  const perRankNameOnly = new Map<number, number>();
  const chosen: Contact[] = [];
  for (const c of byPriority) {
    if (c.role === GENERAL_MAILBOX_ROLE) { if (seenGeneral.n++ >= 1) continue; }
    if (c.email && chosen.some((f) => f.email === c.email)) continue;
    if (c.name && chosen.some((f) => f.name && samePerson(f.name, c.name))) continue;
    if (c.confidence === 'role_only') {
      const n = perRankNameOnly.get(c.rank!) ?? 0;
      if (n >= 3) continue;
      perRankNameOnly.set(c.rank!, n + 1);
    }
    chosen.push(c);
    if (chosen.length >= maxContacts) break;
  }
  const final = chosen.sort((a, b) => (a.rank! - b.rank!) || (confidenceOrder(a.confidence) - confidenceOrder(b.confidence)) || (a.level === 'careers' ? 1 : 0) - (b.level === 'careers' ? 1 : 0));

  const officePhone = input.phones[0]?.phone ?? null;
  if (officePhone) for (const c of final) if (c.role === GENERAL_MAILBOX_ROLE && !c.phone) c.phone = officePhone;

  return {
    contacts: final,
    emailsInPlay: Array.from(new Set(final.map((c) => c.email).filter(Boolean))),
    patternNote: guess.note,
    officePhone,
  };
}

function roleInContext(e: EmailHit): { text: string; cls: RoleClass } | null {
  const ctx = (e.context || '').replace(/\s+/g, ' ');
  const idx = ctx.toLowerCase().indexOf(e.email);
  const before = idx >= 0 ? ctx.slice(Math.max(0, idx - 90), idx) : ctx.slice(0, 90);
  const m = before.match(/([A-Z][A-Za-z'’()\/&\s-]{2,80}?)\s*[:–—-]?\s*(?:contact details:?\s*)?(?:<|email:?\s*)?$/);
  const text = m?.[1]?.trim() || e.linkText || '';
  const cls = classifyRole(text);
  if (!cls) return null;
  return { text, cls };
}

// ---------------------------------------------------------------------------
// Pattern guesses

type Pattern = 'first.last' | 'first_last' | 'f.last' | 'flast' | 'first' | 'lastf' | 'first.l';

function applyPattern(p: Pattern, first: string | null, initial: string | null, last: string | null): string | null {
  if (!last) return null;
  const l = last.replace(/-/g, '');
  switch (p) {
    case 'first.last': return first ? `${first}.${l}` : null;
    case 'first_last': return first ? `${first}_${l}` : null;
    case 'f.last': return initial ? `${initial}.${l}` : null;
    case 'flast': return initial ? `${initial}${l}` : null;
    case 'first': return first;
    case 'lastf': return initial ? `${l}${initial}` : null;
    case 'first.l': return first && initial ? `${first}.${l[0]}` : null;
  }
}

const PATTERNS: Pattern[] = ['first.last', 'first_last', 'f.last', 'flast', 'first', 'lastf', 'first.l'];

/**
 * Only when at least two found personal addresses on one domain share a
 * pattern, and only for company-level people with a ranked role and no
 * address, on that same domain. Investors and board members are never
 * guessed for (they are on their fund's mail), and an address found on the
 * careers page of another host never seeds a pattern (it may be the ATS's
 * or a recruiting alias, and says nothing about the company's mail).
 * Mutates the contacts in place.
 */
export function guessByPattern(contacts: Contact[], siteHost: string | null, suppressed: Set<string>): { note: string | null; guessed: number } {
  const evidence = new Map<string, Map<Pattern, string[]>>(); // domain -> pattern -> emails
  for (const c of contacts) {
    if (c.confidence !== 'found' || !c.email || !c.name) continue;
    if (c.level === 'careers') continue;
    if (c.rank !== undefined && c.rank >= INVESTOR_RANK) continue;
    if (genericMailbox(c.email)) continue;
    const { first, initial, last } = nameParts(c.name);
    const local = c.email.split('@')[0];
    const domain = domainOf(c.email);
    for (const p of PATTERNS) {
      const built = applyPattern(p, first, initial, last);
      if (built && built === local) {
        if (!evidence.has(domain)) evidence.set(domain, new Map());
        const m = evidence.get(domain)!;
        m.set(p, [...(m.get(p) || []), c.email]);
      }
    }
  }
  let best: { domain: string; pattern: Pattern; emails: string[] } | null = null;
  for (const [domain, m] of evidence) {
    for (const [pattern, list] of m) {
      const uniq = Array.from(new Set(list));
      if (uniq.length >= 2 && (!best || uniq.length > best.emails.length)) best = { domain, pattern, emails: uniq };
    }
  }
  if (!best) return { note: null, guessed: 0 };
  // The pattern's domain must be the domain the company's found addresses use;
  // a site host that differs from it (a .com site on .io mail) is fine as long
  // as we only ever guess on the found domain, never on the website host.
  const site = (siteHost || '').toLowerCase().replace(/^www\./, '');
  let guessed = 0;
  for (const c of contacts) {
    if (c.confidence !== 'role_only' || !c.name || c.rank === undefined || c.rank >= INVESTOR_RANK) continue;
    if (c.source_url && !/^https?:\/\//.test(c.source_url)) continue; // e.g. the Companies House register, no page to anchor the guess to
    const { first, initial, last } = nameParts(c.name);
    const local = applyPattern(best.pattern, first, initial, last);
    if (!local) continue;
    const email = `${local}@${best.domain}`;
    if (suppressed.has(email)) continue;
    if (contacts.some((o) => o.email === email)) continue;
    c.email = email;
    c.confidence = 'pattern_guess';
    c.evidence = `Pattern guess (${best.pattern}@${best.domain}) from ${best.emails.slice(0, 2).join(' and ')}. ${c.evidence}`.slice(0, 400);
    guessed++;
  }
  const note = `${best.pattern}@${best.domain} (${best.emails.length} found addresses${site && site !== best.domain ? `; website host ${site}` : ''})`;
  return { note, guessed };
}
