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
import { tidyProfileUrl } from './linkedin.ts';

/** Hunter writes the company page as "linkedin.com/company/x" without a scheme. */
function tidyCompanyUrl(v: string | null): string | null {
  if (!v) return null;
  const m = v.match(/linkedin\.com\/company\/([A-Za-z0-9._%-]+)/i);
  return m ? `https://www.linkedin.com/company/${m[1]}/` : null;
}

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
  /** The company's LinkedIn page, when Hunter knows it. */
  companyLinkedin: string | null;
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
export function parseHunterDomainSearch(json: any, options: HunterParseOptions = {}): { listed: number; people: HunterPerson[]; generic: string[]; dropped: HunterDropped[]; companyLinkedin: string | null } {
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
    people.push({ name: fullName, email, position: kept, confidence: Math.round(confidence), phone: str(it?.phone_number), linkedin: tidyProfileUrl(str(it?.linkedin)) });
  }
  const companyLinkedin = tidyCompanyUrl(str(json?.data?.linkedin));
  return { listed: items.length, people, generic, dropped, companyLinkedin };
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
  const base: HunterResult = { host, configured: !!key, ok: false, status: 0, listed: 0, people: [], generic: [], dropped: [], companyLinkedin: null, error: null, fetchedAt };
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
  return { host, configured: true, ok: true, status: r.status ?? 200, listed: r.listed ?? 0, people: Array.isArray(r.people) ? r.people : [], generic: Array.isArray(r.generic) ? r.generic : [], dropped: Array.isArray(r.dropped) ? r.dropped : [], companyLinkedin: r.companyLinkedin ?? null, error: null, fetchedAt: r.fetchedAt, fromCache: true };
}

// ---------------------------------------------------------------------------
// Email Finder, Email Verifier and the account (22 September 2026; Craig:
// "it's really important I have the correct name and emails"). The Finder
// takes a domain and a person's name and answers {data: {email, score
// 0..100, verification: {status, date}, position, linkedin_url}}; email is
// null (or the call 404s) when Hunter has nothing. The Verifier takes an
// address and answers {data: {status: valid | invalid | accept_all | webmail
// | disposable | unknown, result: deliverable | undeliverable | risky,
// score}}; 202 means it is still checking. The account endpoint answers
// {data: {plan_name, reset_date, requests: {searches: {used, available},
// verifications: {used, available}}}}. A Finder call counts as a search,
// a Verifier call as a verification.

export const HUNTER_FINDER = 'https://api.hunter.io/v2/email-finder';
export const HUNTER_VERIFIER = 'https://api.hunter.io/v2/email-verifier';
export const HUNTER_ACCOUNT = 'https://api.hunter.io/v2/account';

export type Verification = 'deliverable' | 'risky' | 'undeliverable' | 'unknown';

export interface FinderReply {
  ok: boolean;
  status: number;
  email: string | null;
  score: number | null;
  /** Hunter's own verification of the address: valid, accept_all, unknown, ... */
  verificationStatus: string | null;
  position: string | null;
  linkedin: string | null;
  error: string | null;
}

export interface VerifyReply {
  ok: boolean;
  status: number;
  result: Verification;
  /** valid, invalid, accept_all, webmail, disposable, unknown */
  verifyStatus: string | null;
  score: number | null;
  error: string | null;
}

export interface HunterAccount {
  ok: boolean;
  plan: string | null;
  resetDate: string | null;
  searches: { used: number | null; available: number | null };
  verifications: { used: number | null; available: number | null };
  /** The newer plans count credits (a Finder call is one, a verification is less): data.calls. */
  credits: { used: number | null; available: number | null };
  error: string | null;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n;
}

function hunterFailure(status: number, body: any): string {
  const detail = str(body?.errors?.[0]?.details) ?? '';
  const why = status === 401 ? 'the key was refused' : status === 429 ? 'the monthly quota is spent' : `HTTP ${status}`;
  return detail ? `${why}: ${detail}` : why;
}

export function parseHunterFinder(json: any): Pick<FinderReply, 'email' | 'score' | 'verificationStatus' | 'position' | 'linkedin'> {
  const d = json?.data ?? {};
  const email = str(d?.email)?.toLowerCase() ?? null;
  return {
    email: email && email.includes('@') ? email : null,
    score: num(d?.score),
    verificationStatus: str(d?.verification?.status),
    position: str(d?.position),
    linkedin: tidyProfileUrl(str(d?.linkedin_url)),
  };
}

/** Hunter's "result" is the verdict; "status" the reason. Anything else is unknown. */
export function parseHunterVerifier(json: any): Pick<VerifyReply, 'result' | 'verifyStatus' | 'score'> {
  const d = json?.data ?? {};
  const result = str(d?.result);
  const verifyStatus = str(d?.status);
  const verdict: Verification = result === 'deliverable' || result === 'undeliverable' || result === 'risky' ? result
    : verifyStatus === 'valid' ? 'deliverable' : verifyStatus === 'invalid' ? 'undeliverable' : verifyStatus === 'accept_all' ? 'risky' : 'unknown';
  return { result: verdict, verifyStatus, score: num(d?.score) };
}

export function parseHunterAccount(json: any): Omit<HunterAccount, 'ok' | 'error'> {
  const d = json?.data ?? {};
  const r = d?.requests ?? {};
  return {
    plan: str(d?.plan_name),
    resetDate: str(d?.reset_date),
    searches: { used: num(r?.searches?.used), available: num(r?.searches?.available) },
    verifications: { used: num(r?.verifications?.used), available: num(r?.verifications?.available) },
    credits: { used: num(d?.calls?.used), available: num(d?.calls?.available) },
  };
}

/** Ask Hunter for one person's address at a domain. Never throws. */
export async function hunterEmailFinder(domain: string, firstName: string, lastName: string, options: { key?: string | null; fetch?: FetchLike } = {}): Promise<FinderReply> {
  const key = options.key === undefined ? hunterKey() : options.key;
  const base: FinderReply = { ok: false, status: 0, email: null, score: null, verificationStatus: null, position: null, linkedin: null, error: null };
  if (!key) return { ...base, error: 'HUNTER_API_KEY not set' };
  const doFetch = options.fetch ?? ((u: string, i?: RequestInit) => fetchWithTimeout(u, FETCH_MS, i));
  const q = new URLSearchParams({ domain, first_name: firstName, last_name: lastName, api_key: key });
  try {
    const res = await doFetch(`${HUNTER_FINDER}?${q.toString()}`, { headers: { Accept: 'application/json' } });
    let body: any = null;
    try { body = await res.json(); } catch { body = null; }
    if (res.status === 404) return { ...base, ok: true, status: 404 }; // nothing known for the name
    if (!res.ok) return { ...base, status: res.status, error: hunterFailure(res.status, body) };
    return { ...base, ok: true, status: res.status, ...parseHunterFinder(body) };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Ask Hunter whether an address is deliverable. Never throws; 202 (still checking) is unknown. */
export async function hunterVerifyEmail(email: string, options: { key?: string | null; fetch?: FetchLike } = {}): Promise<VerifyReply> {
  const key = options.key === undefined ? hunterKey() : options.key;
  const base: VerifyReply = { ok: false, status: 0, result: 'unknown', verifyStatus: null, score: null, error: null };
  if (!key) return { ...base, error: 'HUNTER_API_KEY not set' };
  const doFetch = options.fetch ?? ((u: string, i?: RequestInit) => fetchWithTimeout(u, FETCH_MS, i));
  const q = new URLSearchParams({ email, api_key: key });
  try {
    const res = await doFetch(`${HUNTER_VERIFIER}?${q.toString()}`, { headers: { Accept: 'application/json' } });
    let body: any = null;
    try { body = await res.json(); } catch { body = null; }
    if (res.status === 202) return { ...base, ok: true, status: 202, error: 'Hunter is still checking' };
    if (!res.ok) return { ...base, status: res.status, error: hunterFailure(res.status, body) };
    return { ...base, ok: true, status: res.status, ...parseHunterVerifier(body) };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The plan and what is left this month. Never throws. */
export async function hunterAccount(options: { key?: string | null; fetch?: FetchLike } = {}): Promise<HunterAccount> {
  const key = options.key === undefined ? hunterKey() : options.key;
  const base: HunterAccount = { ok: false, plan: null, resetDate: null, searches: { used: null, available: null }, verifications: { used: null, available: null }, credits: { used: null, available: null }, error: null };
  if (!key) return { ...base, error: 'HUNTER_API_KEY not set' };
  const doFetch = options.fetch ?? ((u: string, i?: RequestInit) => fetchWithTimeout(u, FETCH_MS, i));
  try {
    const res = await doFetch(`${HUNTER_ACCOUNT}?${new URLSearchParams({ api_key: key }).toString()}`, { headers: { Accept: 'application/json' } });
    let body: any = null;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok) return { ...base, error: hunterFailure(res.status, body) };
    return { ...base, ok: true, ...parseHunterAccount(body) };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
}

/** "Hunter Starter: 412 of 500 searches and 980 of 1,000 verifications left until 1 October" for the card. */
export function hunterAccountLine(a: HunterAccount): string {
  if (!a.ok) return `Hunter: ${a.error || 'not reachable'}`;
  const left = (x: { used: number | null; available: number | null }) => (x.available === null ? null : `${Math.max(0, x.available - (x.used ?? 0)).toLocaleString('en-GB')} of ${x.available.toLocaleString('en-GB')}`);
  const s = left(a.searches);
  const v = left(a.verifications);
  const c = left(a.credits);
  const reset = a.resetDate ? new Date(a.resetDate + (a.resetDate.length === 10 ? 'T00:00:00Z' : '')) : null;
  const until = reset && !Number.isNaN(reset.getTime()) ? ` until ${reset.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}` : '';
  if (c && !s) return `Hunter${a.plan ? ` ${a.plan}` : ''}: ${c} credits left${until}.`;
  return `Hunter${a.plan ? ` ${a.plan}` : ''}: ${s ? `${s} searches` : 'searches unknown'} and ${v ? `${v} verifications` : 'verifications unknown'} left${until}.`;
}
