// Named people with a work address from Hunter's Domain Search, for a
// company whose own website names nobody (a JS-rendered site, or a
// start-up with no team page).
//
// Investigation of 21 September 2026: Craig has a Hunter account and the
// key is the HUNTER_API_KEY secret. GET https://api.hunter.io/v2/domain-search
// ?domain=<host>&api_key=<key>&limit=25 answers {data: {emails: [{value,
// type: 'personal' | 'generic', confidence 0..100, first_name, last_name,
// position, seniority, department, phone_number, linkedin, sources:
// [{uri}]}]}, meta: {results}}; a domain Hunter does not know answers 200
// with no emails, a bad key 401, a spent quota 429 (the free plan is a
// handful of searches a month, so every result is stored on the run and
// reused for HUNTER_CACHE_DAYS before Hunter is asked again). What is kept:
// personal addresses, confidence at or above HUNTER_MIN_CONFIDENCE, with a
// first and last name and a position that the contact taxonomy places
// (founder, COO, CTO, people, talent, exec, EA). A generic mailbox
// (hello@) is kept as an address only. Each kept person becomes a
// PersonHit with the address in the same "row", so the resolver joins
// them as a found contact; the source line is Hunter's page for the
// domain. The fixture is hand-written in the documented shape.

import { fetchWithTimeout } from '../fetch.ts';
import type { EmailHit, PersonHit } from './extract.ts';
import { classifyRole, INVESTOR_RANK, samePerson, type RecordOfficer } from './resolve.ts';

export const HUNTER_BASE = 'https://api.hunter.io/v2/domain-search';
export const HUNTER_MIN_CONFIDENCE = 50;
export const HUNTER_LIMIT = 25;
export const HUNTER_CACHE_DAYS = 30;
const FETCH_MS = 15_000;

export function hunterKey(): string | null {
  try {
    return Deno.env.get('HUNTER_API_KEY') || null;
  } catch {
    return null;
  }
}

export function hunterConfigured(): boolean {
  return !!hunterKey();
}

/** The page on Hunter for the domain, used as the contacts' source line. */
export function hunterSourceUrl(host: string): string {
  return `https://hunter.io/search/${host}`;
}

export interface HunterPerson {
  name: string;
  email: string;
  position: string;
  confidence: number;
  phone: string | null;
  linkedin: string | null;
}

/** An address Hunter listed that the sift left out, and why (the run notes, at most ten). */
export interface HunterDropped {
  email: string;
  name: string | null;
  position: string | null;
  confidence: number | null;
  why: string;
}

export interface HunterResult {
  host: string;
  /** False when the key is not set; nothing was asked. */
  configured: boolean;
  ok: boolean;
  status: number;
  /** Every address Hunter listed, before the sift. */
  listed: number;
  people: HunterPerson[];
  /** Generic mailboxes (hello@, careers@) kept as addresses only. */
  generic: string[];
  dropped: HunterDropped[];
  error: string | null;
  fetchedAt: string;
  fromCache?: boolean;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s || null;
}

export interface HunterParseOptions {
  /** Current officers from the register: a listed person with no usable position who is one of them takes the officer's role. */
  officers?: RecordOfficer[] | null;
}

/** The people worth a contact row from a Domain Search answer. */
export function parseHunterDomainSearch(json: any, options: HunterParseOptions = {}): { listed: number; people: HunterPerson[]; generic: string[]; dropped: HunterDropped[] } {
  const items = Array.isArray(json?.data?.emails) ? json.data.emails : [];
  const people: HunterPerson[] = [];
  const generic: string[] = [];
  const dropped: HunterDropped[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const email = str(it?.value)?.toLowerCase();
    if (!email || !email.includes('@') || seen.has(email)) continue;
    seen.add(email);
    const type = str(it?.type);
    if (type === 'generic') { generic.push(email); continue; }
    const confidence = Number(it?.confidence);
    const first = str(it?.first_name);
    const last = str(it?.last_name);
    const position = str(it?.position) ?? str(it?.position_raw);
    const name = first && last ? `${first} ${last}` : first ?? last;
    const drop = (why: string) => { if (dropped.length < 10) dropped.push({ email, name, position, confidence: Number.isFinite(confidence) ? Math.round(confidence) : null, why }); };
    if (!Number.isFinite(confidence) || confidence < HUNTER_MIN_CONFIDENCE) { drop(`confidence under ${HUNTER_MIN_CONFIDENCE}`); continue; }
    if (!first || !last) { drop('no full name'); continue; }
    const fullName = `${first} ${last}`;
    let role = position ? classifyRole(position) : null;
    let kept = position;
    if (!role || role.rank === INVESTOR_RANK) {
      // The register knows this person: keep them with the officer's role.
      const officer = (options.officers || []).find((o) => o.jobTitle && samePerson(o.name, fullName));
      if (officer) { kept = officer.jobTitle; role = classifyRole(officer.jobTitle!); }
    }
    if (!kept) { drop('no position'); continue; }
    if (!role) { drop('the position is not a role the app contacts'); continue; }
    if (role.rank === INVESTOR_RANK) { drop('an investor'); continue; }
    people.push({ name: fullName, email, position: kept, confidence: Math.round(confidence), phone: str(it?.phone_number), linkedin: str(it?.linkedin) });
  }
  return { listed: items.length, people, generic, dropped };
}

/** The hits the resolver takes: a PersonHit per person with the address in the same row, an EmailHit per address. */
export function hunterHits(result: Pick<HunterResult, 'host' | 'people' | 'generic'>): { people: PersonHit[]; emails: EmailHit[] } {
  const sourceUrl = hunterSourceUrl(result.host);
  const people: PersonHit[] = [];
  const emails: EmailHit[] = [];
  for (const p of result.people) {
    const context = `${p.name}, ${p.position}, ${p.email} (Hunter, ${p.confidence}% confidence)`;
    people.push({ name: p.name, role: p.position, context, email: p.email, source_url: sourceUrl });
    emails.push({ email: p.email, context, source_url: sourceUrl, how: 'text' });
  }
  for (const g of result.generic) emails.push({ email: g, context: `${g} (Hunter, a general mailbox)`, source_url: sourceUrl, how: 'text' });
  return { people, emails };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Ask Hunter for a domain. Never throws. */
export async function hunterDomainSearch(host: string, options: { key?: string | null; fetch?: FetchLike; now?: Date } & HunterParseOptions = {}): Promise<HunterResult> {
  const key = options.key === undefined ? hunterKey() : options.key;
  const fetchedAt = (options.now ?? new Date()).toISOString();
  const base: HunterResult = { host, configured: !!key, ok: false, status: 0, listed: 0, people: [], generic: [], dropped: [], error: null, fetchedAt };
  if (!key) return { ...base, error: 'HUNTER_API_KEY not set' };
  const doFetch = options.fetch ?? ((u: string, i?: RequestInit) => fetchWithTimeout(u, FETCH_MS, i));
  const q = new URLSearchParams({ domain: host, api_key: key, limit: String(HUNTER_LIMIT) });
  try {
    const res = await doFetch(`${HUNTER_BASE}?${q.toString()}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      let detail = '';
      try { const body = await res.json(); detail = str(body?.errors?.[0]?.details) ?? ''; } catch { /* no body */ }
      const why = res.status === 401 ? 'the key was refused' : res.status === 429 ? 'the monthly quota is spent' : `HTTP ${res.status}`;
      return { ...base, status: res.status, error: detail ? `${why}: ${detail}` : why };
    }
    const parsed = parseHunterDomainSearch(await res.json(), { officers: options.officers });
    return { ...base, ok: true, status: res.status, ...parsed };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
}

/** A stored result from a previous run, when it is recent enough to reuse. */
export function cachedHunterResult(stored: unknown, host: string, now: Date): HunterResult | null {
  if (!stored || typeof stored !== 'object') return null;
  const r = stored as Partial<HunterResult>;
  if (r.host !== host || !r.ok || !r.fetchedAt) return null;
  const age = now.getTime() - Date.parse(r.fetchedAt);
  if (!Number.isFinite(age) || age > HUNTER_CACHE_DAYS * 86_400_000) return null;
  return { host, configured: true, ok: true, status: r.status ?? 200, listed: r.listed ?? 0, people: Array.isArray(r.people) ? r.people : [], generic: Array.isArray(r.generic) ? r.generic : [], dropped: Array.isArray(r.dropped) ? r.dropped : [], error: null, fetchedAt: r.fetchedAt, fromCache: true };
}
