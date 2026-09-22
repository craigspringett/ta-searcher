// Addresses for name-only people (22 September 2026). The site names
// nobody at a ten-person start-up, Hunter's Domain Search has never seen
// the domain, and the app used to stop at the founder's name from the
// register. Now, for each name-only person with a ranked role (the best
// three), it asks Hunter's Email Finder for the address; failing that it
// guesses first@domain then first.last@domain and asks Hunter's Verifier
// whether each is deliverable. What is kept is shown as a guess with its
// verification, never as found. Every answer is stored on the run
// (contactsRun.enrichment, keyed by person and domain) and reused for
// ENRICH_CACHE_DAYS so the weekly refresh spends nothing twice.

import { classifyRole, INVESTOR_RANK, nameParts, stripTitle } from './resolve.ts';
import { hunterEmailFinder, hunterVerifyEmail, type FinderReply, type Verification, type VerifyReply } from './hunter.ts';

export const FINDER_MIN_SCORE = 50;
export const MAX_FINDER_PER_COMPANY = 3;
export const ENRICH_CACHE_DAYS = 30;
const CORPORATE = /\b(?:ltd|limited|llp|plc|inc|gmbh|sarl|bv|holdings|nominees|secretaries|trustees|partners)\b/i;

export type EnrichOutcome = 'finder' | 'guess_verified' | 'guess_unverified' | 'none';

/** One person's answer, stored on the run. */
export interface EnrichmentEntry {
  name: string;
  domain: string;
  at: string;
  finder: { email: string | null; score: number | null; status: string | null; error: string | null } | null;
  guesses: Array<{ email: string; result: Verification; status: string | null; error: string | null }>;
  outcome: EnrichOutcome;
  email: string | null;
  verification: Verification | null;
  linkedin: string | null;
}

/** The shape both Contact (the resolver) and DecisionMaker (the stored row) share. */
export interface EnrichableContact {
  name: string;
  role: string;
  email: string;
  confidence?: string;
  evidence?: string;
  source_url?: string;
  feedback?: string;
  rank?: number;
  linkedin?: string | null;
  verification?: Verification | 'unknown' | null;
  email_source?: 'finder' | 'guess';
}

export interface EnrichDeps {
  finder: (domain: string, first: string, last: string) => Promise<FinderReply>;
  verify: (email: string) => Promise<VerifyReply>;
}

export interface EnrichOptions {
  /** The company's mail domain (its website host without www). */
  domain: string | null;
  now: Date;
  /** contactsRun.enrichment from the last run. */
  cache?: Record<string, EnrichmentEntry> | null;
  /** True ignores the cache (the page's Find addresses button after a change). */
  force?: boolean;
  maxPeople?: number;
  deps?: EnrichDeps;
}

export interface EnrichResult<T extends EnrichableContact> {
  contacts: T[];
  entries: Record<string, EnrichmentEntry>;
  finderCalls: number;
  verifyCalls: number;
  /** People given an address this pass. */
  filled: number;
  notes: string[];
}

const liveDeps: EnrichDeps = {
  finder: (domain, first, last) => hunterEmailFinder(domain, first, last),
  verify: (email) => hunterVerifyEmail(email),
};

export function enrichKey(name: string, domain: string): string {
  return `${stripTitle(name).toLowerCase().replace(/[^a-z]/g, '')}@${domain.toLowerCase()}`;
}

/** The domain a company's mail is on: its website host without www, or null. */
export function mailDomain(siteUrl: string | null | undefined): string | null {
  if (!siteUrl) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(siteUrl) ? siteUrl : `https://${siteUrl}`).hostname.toLowerCase().replace(/^www\./, '');
    return host.includes('.') ? host : null;
  } catch {
    return null;
  }
}

/** Name-only people worth a Hunter call, best rank first: a full personal name, a role the app contacts, not an investor, not reported. */
export function enrichCandidates<T extends EnrichableContact>(contacts: T[], max = MAX_FINDER_PER_COMPANY): T[] {
  const out: Array<{ c: T; rank: number }> = [];
  for (const c of contacts) {
    if ((c.email || '').trim()) continue;
    if (c.confidence && c.confidence !== 'role_only') continue;
    if (c.feedback) continue;
    const name = stripTitle(c.name || '');
    if (CORPORATE.test(name)) continue;
    const parts = nameParts(name);
    if (!parts.first || !parts.last || parts.first.length < 2 || parts.last.length < 2) continue;
    const cls = classifyRole(c.role || '');
    const rank = c.rank ?? cls?.rank ?? null;
    if (rank === null || rank >= INVESTOR_RANK) continue;
    out.push({ c, rank });
  }
  return out.sort((a, b) => a.rank - b.rank).slice(0, max).map((x) => x.c);
}

function fromCache(cache: Record<string, EnrichmentEntry> | null | undefined, key: string, now: Date): EnrichmentEntry | null {
  const e = cache?.[key];
  if (!e || !e.at) return null;
  const age = now.getTime() - Date.parse(e.at);
  return Number.isFinite(age) && age <= ENRICH_CACHE_DAYS * 86_400_000 ? e : null;
}

function finderVerification(status: string | null): Verification {
  return status === 'valid' ? 'deliverable' : status === 'accept_all' ? 'risky' : status === 'invalid' ? 'undeliverable' : 'unknown';
}

/** Apply an entry to a contact: the address, the tag and the evidence line. */
export function applyEntry<T extends EnrichableContact>(c: T, e: EnrichmentEntry): T {
  if (!e.email || e.outcome === 'none') return c;
  const label = e.outcome === 'finder'
    ? `Hunter Email Finder gave ${e.email} (score ${e.finder?.score ?? '?'}%, ${e.finder?.status || 'not verified'}).`
    : `Guessed ${e.email}; Hunter's verifier says ${e.verification === 'deliverable' ? 'deliverable' : e.verification === 'risky' ? 'risky (the server accepts every address)' : 'unknown'}.`;
  return {
    ...c,
    email: e.email,
    confidence: 'pattern_guess',
    verification: e.verification ?? 'unknown',
    email_source: e.outcome === 'finder' ? 'finder' : 'guess',
    linkedin: c.linkedin ?? e.linkedin ?? null,
    evidence: `${label} ${c.evidence || ''}`.trim().slice(0, 400),
  };
}

/** Fill in addresses for the name-only people. Never throws; a Hunter problem is a note. */
export async function enrichContacts<T extends EnrichableContact>(contacts: T[], options: EnrichOptions): Promise<EnrichResult<T>> {
  const deps = options.deps ?? liveDeps;
  const entries: Record<string, EnrichmentEntry> = { ...(options.cache || {}) };
  const result: EnrichResult<T> = { contacts: contacts.map((c) => ({ ...c })), entries, finderCalls: 0, verifyCalls: 0, filled: 0, notes: [] };
  const domain = options.domain;
  if (!domain) { result.notes.push('no domain to look up'); return result; }
  const candidates = enrichCandidates(result.contacts, options.maxPeople ?? MAX_FINDER_PER_COMPANY);
  if (!candidates.length) return result;
  let quotaSpent = false;
  for (const c of candidates) {
    const key = enrichKey(c.name, domain);
    let entry = options.force ? null : fromCache(options.cache, key, options.now);
    if (!entry) {
      if (quotaSpent) { result.notes.push(`${c.name}: not asked, the quota is spent`); continue; }
      const parts = nameParts(stripTitle(c.name));
      const first = parts.first!, last = parts.last!;
      entry = { name: c.name, domain, at: options.now.toISOString(), finder: null, guesses: [], outcome: 'none', email: null, verification: null, linkedin: null };
      const f = await deps.finder(domain, first, last);
      result.finderCalls++;
      entry.finder = { email: f.email, score: f.score, status: f.verificationStatus, error: f.error };
      if (f.status === 429) quotaSpent = true;
      if (f.ok && f.email && (f.score ?? 0) >= FINDER_MIN_SCORE) {
        entry.outcome = 'finder';
        entry.email = f.email;
        entry.verification = finderVerification(f.verificationStatus);
        entry.linkedin = f.linkedin;
      } else {
        if (f.error) result.notes.push(`${c.name}: Finder ${f.error}`);
        // The plain guesses, verified one at a time; the first deliverable
        // one wins, a risky (accept-all) one is kept as unverified and the
        // search stops there, undeliverable moves on to the next pattern.
        const patterns = [`${first}@${domain}`, `${first}.${last}@${domain}`];
        for (const guess of patterns) {
          if (quotaSpent) break;
          const v = await deps.verify(guess);
          result.verifyCalls++;
          entry.guesses.push({ email: guess, result: v.result, status: v.verifyStatus, error: v.error });
          if (v.status === 429) { quotaSpent = true; result.notes.push(`${c.name}: Verifier ${v.error}`); break; }
          if (v.error && !v.ok) { result.notes.push(`${c.name}: Verifier ${v.error}`); break; }
          if (v.result === 'deliverable') { entry.outcome = 'guess_verified'; entry.email = guess; entry.verification = 'deliverable'; break; }
          if (v.result === 'risky') { entry.outcome = 'guess_unverified'; entry.email = guess; entry.verification = 'risky'; break; }
          if (v.result === 'unknown') { entry.outcome = 'guess_unverified'; entry.email = guess; entry.verification = 'unknown'; break; }
          // undeliverable: try the next pattern
        }
      }
      entries[key] = entry;
    }
    if (entry.email && entry.outcome !== 'none') {
      const i = result.contacts.indexOf(c);
      if (i >= 0) { result.contacts[i] = applyEntry(c, entry); result.filled++; }
    }
  }
  return result;
}

/** "2 addresses found by Hunter, 1 guessed and verified, 1 guessed but unverified" for the log and the page. */
export function enrichSummary(entries: Record<string, EnrichmentEntry>, keys?: string[]): string {
  const list = (keys ? keys.map((k) => entries[k]).filter(Boolean) : Object.values(entries)) as EnrichmentEntry[];
  const n = (o: EnrichOutcome) => list.filter((e) => e.outcome === o).length;
  const parts = [
    n('finder') ? `${n('finder')} found by Hunter's Email Finder` : null,
    n('guess_verified') ? `${n('guess_verified')} guessed and verified` : null,
    n('guess_unverified') ? `${n('guess_unverified')} guessed but unverified` : null,
    n('none') ? `${n('none')} with nothing found` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'nothing to look up';
}
