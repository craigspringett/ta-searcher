// Validation of the model's facts against the pages it was shown, the
// evidence fingerprint, and the summary built from validated facts.
//
// Rules (docs/TA-SEARCHER-BRIEF.md, "What stays the same"):
//   - a fact is kept only when its quote appears verbatim, after whitespace
//     normalisation, in the text of the page it cites;
//   - quotes are 10 to 300 characters;
//   - award facts older than three years by date_hint are dropped;
//   - at most 40 facts, in the order the model gave them.

import { CARRIED_FACT_KINDS, CONSULTANT_FACT_KIND, FACT_KINDS, type Fact, type FactKind, type RawFact, type SourcePage, type ValidationOutcome } from './types.ts';

export const MAX_FACTS = 40;
export const AWARD_MAX_AGE_YEARS = 3;

/** Collapse whitespace, unify quotes and dashes, lower-case. */
export function normaliseForMatch(s: string): string {
  return s
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/ /g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Identity of a fact across runs: the statement with punctuation and case removed. */
export function statementKey(statement: string): string {
  return normaliseForMatch(statement).replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

export function quoteAppearsIn(quote: string, pageText: string): boolean {
  const q = normaliseForMatch(quote);
  if (!q) return false;
  return normaliseForMatch(pageText).includes(q);
}

function canonicalUrl(u: string): string {
  try {
    const url = new URL(u.trim());
    url.hash = '';
    return url.toString().replace(/\/+$/, '').toLowerCase();
  } catch {
    return u.trim().replace(/\/+$/, '').toLowerCase();
  }
}

/** The four-digit year in a date hint such as "September 2026" or "2024-25" (the later year). */
export function yearFromDateHint(hint: string | null | undefined): number | null {
  if (!hint) return null;
  const m = hint.match(/\b(19|20)(\d{2})(?:[-\/](\d{2}))?\b/);
  if (!m) return null;
  const base = Number(m[1] + m[2]);
  if (m[3]) {
    const second = Number(m[1] + m[3]);
    return second > base ? second : base;
  }
  return base;
}

/** Month index (0 to 11) when the hint names one, else null. */
export function monthFromDateHint(hint: string | null | undefined): number | null {
  if (!hint) return null;
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const lower = hint.toLowerCase();
  for (let i = 0; i < months.length; i++) {
    if (lower.includes(months[i]) || lower.includes(months[i].slice(0, 3) + ' ') || lower.includes(months[i].slice(0, 3) + '.')) return i;
  }
  return null;
}

/** Whole months between the hint and today; null when the hint has no year. */
export function monthsSinceHint(hint: string | null | undefined, today: Date): number | null {
  const y = yearFromDateHint(hint);
  if (y === null) return null;
  const m = monthFromDateHint(hint);
  // A bare year is taken as June of that year, the middle of it, so "2025"
  // read in September 2026 is fifteen months old rather than nine or
  // twenty-one; a "2024-25" span is taken as the later year's middle.
  const month = m ?? 5;
  return (today.getUTCFullYear() - y) * 12 + (today.getUTCMonth() - month);
}

export function validateFacts(raw: RawFact[], pages: SourcePage[], today: Date = new Date()): ValidationOutcome {
  const byUrl = new Map<string, string>();
  for (const p of pages) {
    const k = canonicalUrl(p.url);
    byUrl.set(k, (byUrl.get(k) || '') + '\n' + p.text);
  }
  const facts: Fact[] = [];
  const dropped: ValidationOutcome['dropped'] = [];
  const seen = new Set<string>();
  for (const r of raw || []) {
    const statement = String(r?.statement || '').replace(/\s+/g, ' ').trim();
    const quote = String(r?.quote || '').replace(/\s+/g, ' ').trim();
    const sourceUrl = String(r?.source_url || '').trim();
    const kind = String(r?.kind || 'other') as FactKind;
    if (!statement) { dropped.push({ statement, reason: 'empty statement' }); continue; }
    if (!(FACT_KINDS as readonly string[]).includes(kind)) { dropped.push({ statement, reason: `unknown kind ${kind}` }); continue; }
    if (quote.length < 10 || quote.length > 300) { dropped.push({ statement, reason: `quote length ${quote.length}` }); continue; }
    const pageText = byUrl.get(canonicalUrl(sourceUrl));
    if (!pageText) { dropped.push({ statement, reason: `source_url not among the pages shown: ${sourceUrl}` }); continue; }
    if (!quoteAppearsIn(quote, pageText)) { dropped.push({ statement, reason: 'quote not found on the cited page' }); continue; }
    const dateHint = r.date_hint ? String(r.date_hint).trim() || null : null;
    if (kind === 'award') {
      const y = yearFromDateHint(dateHint);
      if (y !== null && today.getUTCFullYear() - y > AWARD_MAX_AGE_YEARS) { dropped.push({ statement, reason: `award from ${y}, older than ${AWARD_MAX_AGE_YEARS} years` }); continue; }
    }
    const key = statementKey(statement);
    if (!key || seen.has(key)) { dropped.push({ statement, reason: 'duplicate statement' }); continue; }
    seen.add(key);
    facts.push({ id: `f${facts.length + 1}`, kind, statement, quote, source_url: sourceUrl, date_hint: dateHint, statement_key: key });
    if (facts.length >= MAX_FACTS) break;
  }
  return { facts, dropped };
}

/**
 * Fact identity across runs. A fact whose quote matches (or contains, or is
 * contained by) the quote of a fact already stored for the company keeps that
 * fact's statement and key, so a model rewording the same sentence does not
 * change the evidence fingerprint. Unmatched facts keep their own key.
 */
export function stabiliseFacts(facts: Fact[], existing: Array<{ statement_key: string; statement: string; quote: string; source_url: string }>): { facts: Fact[]; matched: number } {
  if (!existing.length) return { facts, matched: 0 };
  const pool = existing.map((e) => ({ ...e, q: normaliseForMatch(e.quote) }));
  const used = new Set<string>();
  const seen = new Set<string>();
  let matched = 0;
  const out: Fact[] = [];
  for (const f of facts) {
    const q = normaliseForMatch(f.quote);
    const hit = pool.find((e) => !used.has(e.statement_key) && e.q.length >= 10 && (e.q === q || e.q.includes(q) || q.includes(e.q)));
    let next = f;
    if (hit) {
      used.add(hit.statement_key);
      matched++;
      next = { ...f, statement: hit.statement, statement_key: hit.statement_key };
    }
    if (seen.has(next.statement_key)) continue;
    seen.add(next.statement_key);
    out.push(next);
  }
  return { facts: out, matched };
}

export const FACT_UNSEEN_RETIRE_DAYS = 60;

export interface StoredFact {
  statement_key: string;
  kind: string;
  statement: string;
  quote: string;
  source_url: string;
  date_hint: string | null;
  last_seen: string;
}

export interface Reconciled {
  /** Facts active after this run: tonight's validated facts first, then stored facts still on their page. */
  active: Fact[];
  /** Keys of stored facts to retire: their quote is gone from the page, or they have been unseen too long. */
  retired: string[];
  /** Keys of stored facts carried over because their page was not fetched this run. */
  unverified: string[];
  carried: number;
}

/**
 * A fact the model did not repeat tonight is still a fact while its quote is
 * still on the page it was read from. Stored facts are therefore kept active
 * until their quote disappears from a page we fetched, or until they have not
 * been seen for FACT_UNSEEN_RETIRE_DAYS. This keeps the evidence fingerprint
 * tied to the website rather than to the model's choice of sentences.
 */
export function reconcileFacts(tonight: Fact[], stored: StoredFact[], pages: SourcePage[], today: Date): Reconciled {
  const byUrl = new Map<string, string>();
  for (const p of pages) {
    const k = canonicalUrl(p.url);
    byUrl.set(k, (byUrl.get(k) || '') + '\n' + p.text);
  }
  const keys = new Set(tonight.map((f) => f.statement_key));
  const active: Fact[] = [...tonight];
  const retired: string[] = [];
  const unverified: string[] = [];
  let carried = 0;
  const cutoff = new Date(today.getTime() - FACT_UNSEEN_RETIRE_DAYS * 86400000).toISOString().slice(0, 10);
  const candidates = stored.filter((s) => !keys.has(s.statement_key)).sort((a, b) => b.last_seen.localeCompare(a.last_seen));
  // What a consultant typed in is not on any page the refresh fetched: it
  // stays active whatever the site says, does not count against the cap and
  // is never "unverified".
  for (const s of candidates.filter((c) => CARRIED_FACT_KINDS.has(c.kind))) {
    keys.add(s.statement_key);
    carried++;
    active.push({ id: `f${active.length + 1}`, kind: s.kind as FactKind, statement: s.statement, quote: s.quote, source_url: s.source_url, date_hint: s.date_hint, statement_key: s.statement_key });
  }
  for (const s of candidates.filter((c) => !CARRIED_FACT_KINDS.has(c.kind))) {
    if (active.length >= MAX_FACTS) { retired.push(s.statement_key); continue; }
    if (s.last_seen < cutoff) { retired.push(s.statement_key); continue; }
    if (!(FACT_KINDS as readonly string[]).includes(s.kind)) { retired.push(s.statement_key); continue; }
    const pageText = byUrl.get(canonicalUrl(s.source_url));
    if (pageText !== undefined) {
      if (!quoteAppearsIn(s.quote, pageText)) { retired.push(s.statement_key); continue; }
    } else {
      unverified.push(s.statement_key);
    }
    keys.add(s.statement_key);
    carried++;
    active.push({ id: `f${active.length + 1}`, kind: s.kind as FactKind, statement: s.statement, quote: s.quote, source_url: s.source_url, date_hint: s.date_hint, statement_key: s.statement_key });
  }
  return { active, retired, unverified, carried };
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface FingerprintInput {
  statements: string[];
  vacancyKeys: string[];
  /** Names of the top three contacts (roles are left out: the model review rewords them between runs). */
  contacts: string[];
}

/**
 * Fact kinds that can change what the copy says: the signal-bearing kinds.
 * The others (values, remote policy, product launches, awards, news, other)
 * are context; leaving them out of the fingerprint stops a newly noticed
 * value statement or news item from rewriting every persona's copy.
 */
export const FINGERPRINT_KINDS: ReadonlySet<string> = new Set(['funding_round', 'investor', 'stage', 'headcount', 'hiring_plan', 'leadership_change', 'people_function', 'talent_team', 'expansion', 'new_market', 'office', 'accelerator', 'staffing_pressure', 'agency_mention', 'staff_departure', 'staff_arrival', CONSULTANT_FACT_KIND]);

export function fingerprintStatements(facts: Fact[]): string[] {
  return facts.filter((f) => FINGERPRINT_KINDS.has(f.kind)).map((f) => f.statement);
}

export function contactKey(name: string): string {
  return name.toLowerCase().replace(/\b(mr|mrs|ms|miss|mx|dr|rev)\b\.?/g, '').replace(/[^a-z]/g, '');
}

/**
 * The evidence fingerprint: a hash of the sorted active statements, the open
 * vacancy keys and the top three contacts. Order-independent, so the same
 * evidence in a different order does not trigger a regeneration.
 */
export async function evidenceFingerprint(input: FingerprintInput): Promise<string> {
  return (await fingerprintParts(input)).fingerprint;
}

/** The fingerprint plus a short hash per part, so a change can be attributed. */
export async function fingerprintParts(input: FingerprintInput): Promise<{ fingerprint: string; facts: string; vacancies: string; contacts: string }> {
  const parts = [
    'facts:' + Array.from(new Set(input.statements.map(statementKey))).sort().join('|'),
    'vacancies:' + Array.from(new Set(input.vacancyKeys.map((k) => k.trim().toLowerCase()))).sort().join('|'),
    'contacts:' + input.contacts.slice(0, 3).map(contactKey).filter(Boolean).sort().join('|'),
  ];
  const [fingerprint, facts, vacancies, contacts] = await Promise.all([sha256Hex(parts.join('\n')), sha256Hex(parts[0]), sha256Hex(parts[1]), sha256Hex(parts[2])]);
  return { fingerprint: fingerprint.slice(0, 32), facts: facts.slice(0, 12), vacancies: vacancies.slice(0, 12), contacts: contacts.slice(0, 12) };
}

const SUMMARY_ORDER: FactKind[] = ['funding_round', 'investor', 'headcount', 'hiring_plan', 'leadership_change', 'talent_team', 'people_function', 'staffing_pressure', 'expansion', 'new_market', 'office', 'accelerator', 'agency_mention', 'product_launch', 'award', 'recent_news', 'remote_policy', 'values', 'other'];

export interface SummaryRecord {
  name: string;
  /** Companies House company_status ('active', 'dissolved', 'liquidation', ...). */
  status?: string | null;
  /** The year of incorporation, from the register. */
  incorporatedYear?: number | null;
  /** The registered office locality ("London"). */
  locality?: string | null;
  /** The sector label from the SIC codes ('Software', 'Fintech', ...). */
  sector?: string | null;
  /** The derived stage label ('pre_seed', 'seed', 'series_a', 'series_b_plus'); unknown or null is left out. */
  stageLabel?: string | null;
}

/** Sector labels that are a noun in their own right ("a consultancy"), not "a consultancy company". */
const SECTOR_NOUNS = new Set(['consultancy', 'agency', 'marketplace', 'platform', 'retailer', 'manufacturer', 'publisher', 'studio', 'charity']);

function sectorWords(sector: string | null | undefined): string {
  const s = (sector || '').trim();
  if (!s) return 'a company';
  const lower = /^[A-Z]{2,}$/.test(s) ? s : s.toLowerCase();
  const noun = SECTOR_NOUNS.has(lower) ? lower : `${lower} company`;
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
}

function stageWords(label: string | null | undefined): string {
  switch (label) {
    case 'pre_seed': return 'at pre-seed';
    case 'seed': return 'at seed';
    case 'series_a': return 'at Series A';
    case 'series_b_plus': return 'at Series B or later';
    default: return '';
  }
}

function sentence(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  if (!t) return '';
  const capped = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : capped + '.';
}

/**
 * The summary is assembled from the Companies House record, the open-role
 * count and the validated facts, in a fixed order of kinds, so nothing in
 * it comes from unquoted text: "Searchable is a software company
 * incorporated in 2025, registered in London, at Series A. It has 13 open
 * roles." followed by up to `maxFacts` fact statements.
 */
export function summaryFromFacts(record: SummaryRecord, facts: Fact[], openVacancies: number, maxFacts = 5): string {
  const parts: string[] = [];
  const clauses = [`${record.name} is ${sectorWords(record.sector)}`];
  if (record.incorporatedYear) clauses.push(`incorporated in ${record.incorporatedYear}`);
  if (record.locality) clauses.push(`registered in ${record.locality}`);
  const stage = stageWords(record.stageLabel);
  if (stage) clauses.push(stage);
  let first = clauses.join(', ');
  const status = (record.status || '').trim().toLowerCase();
  if (status && status !== 'active') first += `; Companies House lists it as ${status.replace(/-/g, ' ')}`;
  parts.push(sentence(first));
  parts.push(sentence(openVacancies === 0 ? 'No open role is showing on its careers page or job board today' : openVacancies === 1 ? 'It has one open role' : `It has ${openVacancies} open roles`));
  const used = new Set<string>();
  const chosen: Fact[] = [];
  for (const kind of SUMMARY_ORDER) {
    for (const f of facts) {
      if (f.kind !== kind || used.has(f.id)) continue;
      chosen.push(f);
      used.add(f.id);
      break; // one per kind
    }
    if (chosen.length >= maxFacts) break;
  }
  for (const f of chosen) parts.push(sentence(f.statement));
  return parts.filter(Boolean).join(' ');
}
