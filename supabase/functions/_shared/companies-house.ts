// Company identity from the Companies House register, cached in `company_records`.
//
// Investigation (21 September 2026, from the Claude Code sandbox, no API key
// to hand, so the shapes below come from the published specification at
// developer-specs.company-information.service.gov.uk and the fixtures in
// fixtures/companies-house/ are hand-written; replace them with saved
// answers when a key is available):
//   - Base https://api.company-information.service.gov.uk, HTTP Basic auth
//     with the key as the username and an empty password. A free key takes
//     five minutes at developer.company-information.service.gov.uk. Rate
//     limit 600 requests per five minutes per key; a 429 carries no useful
//     Retry-After, so a hit waits a few seconds and tries once more.
//   - GET /search/companies?q=&items_per_page=  -> items[] with company_number,
//     title, company_status, date_of_creation, address_snippet, address.
//   - GET /company/{number}                     -> the profile: name, status,
//     incorporation date, SIC codes, registered office, previous names,
//     accounts.last_accounts, confirmation_statement. A dissolved company
//     still answers 200 with company_status 'dissolved'; only an unknown
//     number is a 404.
//   - GET /company/{number}/officers            -> "SURNAME, Forenames" (a
//     title, when present, follows after a second comma or leads the
//     forenames); a corporate officer has no comma. The officer's own id is
//     only in links.officer.appointments.
//   - GET /company/{number}/filing-history?category=capital -> description
//     is an enumeration key ('capital-allotment-shares'), the words to show
//     come from description_values; 'legacy' carries its own text.
//   - Company numbers are eight characters: numeric ones zero-padded on the
//     left (1234567 is 01234567), the others a two-letter prefix (SC, NI,
//     OC, SO, NC, FC, ...) in upper case and six digits.
//   - There is no website in the register. The URL the consultant gives is
//     the identity for the website read; the number is the identity here.
//
// Cache rule (`resolveCompanyRecord`): a verified `company_records` row
// fresher than maxAgeDays answers without a request; otherwise the register
// is read and the row upserted. A read that fails (no key, 404, the API
// down) never overwrites a verified row: the cached record is returned
// instead. Officers and capital filings (`syncRegisterDetails`) go to
// `ch_officers` and `ch_filings`, keyed so a second run reports only what
// is new.

import { fetchWithTimeout } from './fetch.ts';

export const COMPANIES_HOUSE_BASE = 'https://api.company-information.service.gov.uk';
export const COMPANY_RECORD_MAX_AGE_DAYS = 30;
const FETCH_MS = 12000;
const RETRY_WAIT_MS = 5000;
const SEARCH_LIMIT = 10;
const PAGE_SIZE = 50;

export interface CompanyRecord {
  /** The number as stored on company_searches, normalised (8 characters, numeric ones zero-padded, prefixes upper case). */
  companyNumber: string;
  name: string;
  previousNames: string[];
  /** Companies House company_status: 'active', 'dissolved', 'liquidation', 'administration', ... */
  status: string | null;
  /** ISO YYYY-MM-DD */
  incorporationDate: string | null;
  sicCodes: string[];
  registeredOffice: { line1: string | null; locality: string | null; region: string | null; postcode: string | null; country: string | null } | null;
  postcodeDistrict: string | null;
  /** accounts.last_accounts.type: 'micro-entity', 'small', 'full', 'dormant', 'group', ... */
  accountsType: string | null;
  lastAccountsMadeUpTo: string | null;
  lastConfirmationStatement: string | null;
  /** ISO datetime the register was read. */
  fetchedAt: string;
  /** true when the number resolved to a register entry; false when the key is missing, the number is unknown or the read failed (then `note` says why). */
  verified: boolean;
  note: string | null;
}

export interface Officer {
  officerId: string | null;
  /** As the register writes it, "SURNAME, Forenames" turned into "Forenames Surname". */
  name: string;
  /** officer_role: 'director', 'secretary', 'llp-member', ... */
  role: string;
  appointedOn: string | null;
  resignedOn: string | null;
}

export interface CapitalFiling {
  transactionId: string | null;
  date: string;
  /** 'SH01', ... */
  type: string;
  /** 'capital' */
  category: string;
  /** The register's description, plain words. */
  description: string;
}

export interface CompanySearchHit {
  companyNumber: string;
  name: string;
  status: string | null;
  incorporationDate: string | null;
  addressSnippet: string | null;
  postcode: string | null;
}

export const NOTE_KEY_NOT_SET = 'Companies House key not set';
export const NOTE_NOT_ON_REGISTER = 'Not on the register';
export const NOTE_NOT_A_NUMBER = 'Not a company number';

/** Statuses that mean the company is not trading and is never refreshed, alerted or scored again. */
export function isDefunctStatus(status: string | null | undefined): boolean {
  return /^(dissolved|liquidation|administration|receivership|insolvency-proceedings|closed|converted-closed)$/.test((status || '').toLowerCase());
}

// ---------------------------------------------------------------------------
// Configuration (tests inject a fetch and a key; the runtime reads the env).

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface ClientConfig {
  fetch: FetchLike | null;
  apiKey: string | null | undefined;
  retryWaitMs: number;
}

const config: ClientConfig = { fetch: null, apiKey: undefined, retryWaitMs: RETRY_WAIT_MS };

/**
 * Override the HTTP layer or the key (tests). `apiKey: null` means "behave
 * as if no key is set", `undefined` (the default) reads the environment.
 */
export function configureCompaniesHouse(options: { fetch?: FetchLike | null; apiKey?: string | null; retryWaitMs?: number } = {}): void {
  if ('fetch' in options) config.fetch = options.fetch ?? null;
  if ('apiKey' in options) config.apiKey = options.apiKey;
  if (options.retryWaitMs !== undefined) config.retryWaitMs = options.retryWaitMs;
}

function apiKey(): string | null {
  if (config.apiKey !== undefined) return config.apiKey || null;
  try {
    return Deno.env.get('COMPANIES_HOUSE_API_KEY') || null;
  } catch {
    return null;
  }
}

/** COMPANIES_HOUSE_API_KEY set. */
export function companiesHouseConfigured(): boolean {
  return !!apiKey();
}

// ---------------------------------------------------------------------------
// Pure helpers.

/** Eight characters: numeric numbers zero-padded on the left, a letter prefix upper case. Null when it is not a company number. */
export function normaliseCompanyNumber(s: string | null | undefined): string | null {
  if (!s) return null;
  const raw = String(s).toUpperCase().replace(/[\s-]+/g, '').trim();
  if (!raw) return null;
  if (/^\d{1,8}$/.test(raw)) return raw.padStart(8, '0');
  const m = raw.match(/^([A-Z]{1,2})(\d{1,7})$/);
  if (!m) return null;
  const digits = m[2].padStart(8 - m[1].length, '0');
  if (m[1].length + digits.length !== 8) return null;
  return `${m[1]}${digits}`;
}

/** The outward part of a UK postcode: 'EC2A 4NE' -> 'EC2A'. */
export function postcodeDistrict(postcode: string | null | undefined): string | null {
  if (!postcode) return null;
  const compact = postcode.toUpperCase().replace(/\s+/g, '');
  const m = compact.match(/^([A-Z]{1,2}\d[A-Z\d]?)\d[A-Z]{2}$/);
  if (m) return m[1];
  const loose = postcode.toUpperCase().trim().match(/^([A-Z]{1,2}\d[A-Z\d]?)\b/);
  return loose ? loose[1] : null;
}

/** Sector labels by SIC group; the four-digit classes first because they are more specific than their two-digit group. */
const SIC_CLASSES: Array<[string, string]> = [
  ['5829', 'Software'],
  ['7211', 'Biotech'],
  ['7022', 'Consultancy'],
  ['4791', 'Online retail'],
];
const SIC_GROUPS: Record<string, string> = {
  '62': 'Software',
  '63': 'Data and platforms',
  '64': 'Financial services',
  '66': 'Financial services',
  '72': 'Research and development',
  '86': 'Health',
  '21': 'Biotech',
  '73': 'Marketing',
  '82': 'Business services',
  '85': 'Education',
  '35': 'Energy',
  '71': 'Engineering',
  '74': 'Design and professional services',
};

/** A short sector label from the company's SIC codes (the first code the register lists is its main activity), or null. */
export function sectorFromSic(codes: string[]): string | null {
  for (const raw of codes || []) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.length < 2) continue;
    const cls = SIC_CLASSES.find(([prefix]) => digits.startsWith(prefix));
    if (cls) return cls[1];
    const group = SIC_GROUPS[digits.slice(0, 2)];
    if (group) return group;
  }
  return null;
}

const NAME_PARTICLES = new Set(['de', 'da', 'di', 'du', 'la', 'le', 'van', 'von', 'der', 'den', 'del', 'della', 'y', 'e', 'of', 'the', 'and', 'bin', 'al']);

function titleCaseSurname(s: string): string {
  return s
    .toLowerCase()
    .split(/(\s+|-|')/)
    .map((part, i) => {
      if (!part || /^(\s+|-|')$/.test(part)) return part;
      if (i > 0 && NAME_PARTICLES.has(part)) return part;
      if (/^mc[a-z]/.test(part)) return 'Mc' + part[2].toUpperCase() + part.slice(3);
      return part[0].toUpperCase() + part.slice(1);
    })
    .join('');
}

/**
 * "SURNAME, Forenames" -> "Forenames Surname"; "SURNAME, Forenames, Title"
 * and "SURNAME, Title Forenames" -> "Title Forenames Surname". A name with
 * no comma (a corporate officer) is returned as written.
 */
export function officerDisplayName(registerName: string): string {
  const raw = (registerName || '').replace(/\s+/g, ' ').trim();
  if (!raw.includes(',')) return raw;
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) return parts[0];
  const surname = titleCaseSurname(parts[0]);
  const forenames = parts[1];
  const title = parts.length > 2 ? parts.slice(2).join(' ') : '';
  return [title, forenames, surname].filter(Boolean).join(' ');
}

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** '2026-05-12' -> '12 May 2026'; anything else comes back as given. */
export function formatLongDateUk(iso: string | null | undefined): string {
  const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || '';
  return `${parseInt(m[3], 10)} ${MONTHS_LONG[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

const CURRENCY_SIGNS: Record<string, string> = { GBP: '£', EUR: '€', USD: '$' };

function formatCapital(entries: unknown): string {
  if (!Array.isArray(entries)) return '';
  const parts: string[] = [];
  for (const e of entries) {
    const figureRaw = String((e as any)?.figure ?? '').trim();
    const currency = String((e as any)?.currency ?? '').toUpperCase();
    if (!figureRaw) continue;
    const numeric = Number(figureRaw.replace(/,/g, ''));
    const figure = Number.isFinite(numeric) ? numeric.toLocaleString('en-GB', { maximumFractionDigits: 2 }) : figureRaw;
    const sign = CURRENCY_SIGNS[currency];
    parts.push(sign ? `${sign}${figure}` : currency ? `${figure} ${currency}` : figure);
  }
  return parts.join(', ');
}

/** The plain words for the register's filing description keys in the capital category. */
const FILING_WORDS: Record<string, string> = {
  'capital-allotment-shares': 'Shares allotted',
  'capital-allotment-shares-single-currency': 'Shares allotted',
  'capital-return-of-allotment-shares': 'Return of allotment of shares',
  'capital-cancellation-shares': 'Shares cancelled',
  'capital-cancellation-treasury-shares': 'Treasury shares cancelled',
  'capital-reduction-shares': 'Share capital reduced',
  'capital-reduction-shares-solvency-statement': 'Share capital reduced with a solvency statement',
  'capital-consolidation-shares': 'Shares consolidated',
  'capital-subdivision-shares': 'Shares sub-divided',
  'capital-redenomination-shares': 'Shares redenominated',
  'capital-redemption-shares': 'Shares redeemed',
  'capital-purchase-own-shares': 'Company bought back its own shares',
  'capital-purchase-own-shares-treasury': 'Company bought back shares into treasury',
  'capital-sale-treasury-shares': 'Treasury shares sold',
  'capital-alter-shares': 'Shares altered',
  'capital-variation-of-rights': 'Share rights varied',
  'capital-statement-capital-company': 'Statement of capital',
  'capital-statement-of-capital': 'Statement of capital',
  'capital-notice-of-sale-of-treasury-shares': 'Treasury shares sold',
  'resolution-securities': 'Resolution on securities',
};

/**
 * Render a filing-history item's description into plain words, e.g.
 * "Shares allotted on 12 May 2026, capital £1,234".
 */
export function renderFilingDescription(item: { description?: string | null; description_values?: Record<string, unknown> | null; type?: string | null; date?: string | null }): string {
  const key = String(item.description || '').trim();
  const values = item.description_values || {};
  const legacy = typeof values.description === 'string' ? values.description.trim() : '';
  if (key === 'legacy' || (!key && legacy)) return legacy || `Filing ${item.type || ''}`.trim();
  let words = FILING_WORDS[key];
  if (!words) {
    const stripped = key.replace(/^capital-/, '').replace(/-/g, ' ').trim();
    words = stripped ? stripped[0].toUpperCase() + stripped.slice(1) : `Filing ${item.type || ''}`.trim();
  }
  const date = typeof values.date === 'string' ? values.date : '';
  const capital = formatCapital(values.capital);
  let out = words;
  if (date) out += ` on ${formatLongDateUk(date)}`;
  if (capital) out += `, capital ${capital}`;
  return out;
}

// ---------------------------------------------------------------------------
// Parsers (pure; the fetchers feed them the decoded JSON).

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

function isoDate(v: unknown): string | null {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

export function parseSearchResults(json: any, limit = SEARCH_LIMIT): CompanySearchHit[] {
  const items = Array.isArray(json?.items) ? json.items : [];
  const out: CompanySearchHit[] = [];
  for (const it of items) {
    const companyNumber = normaliseCompanyNumber(str(it?.company_number));
    const name = str(it?.title);
    if (!companyNumber || !name) continue;
    out.push({
      companyNumber,
      name,
      status: str(it?.company_status),
      incorporationDate: isoDate(it?.date_of_creation),
      addressSnippet: str(it?.address_snippet),
      postcode: str(it?.address?.postal_code),
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function parseCompanyProfile(json: any, companyNumber: string, fetchedAt = new Date().toISOString()): CompanyRecord {
  const office = json?.registered_office_address;
  const registeredOffice = office && typeof office === 'object'
    ? {
      line1: str(office.address_line_1) ?? str(office.premises),
      locality: str(office.locality),
      region: str(office.region),
      postcode: str(office.postal_code),
      country: str(office.country),
    }
    : null;
  const previousNames = Array.isArray(json?.previous_company_names)
    ? json.previous_company_names.map((p: any) => str(p?.name)).filter((n: string | null): n is string => !!n)
    : [];
  const sicCodes = Array.isArray(json?.sic_codes) ? json.sic_codes.map((c: unknown) => str(c)).filter((c: string | null): c is string => !!c) : [];
  return {
    companyNumber: normaliseCompanyNumber(str(json?.company_number)) ?? companyNumber,
    name: str(json?.company_name) ?? '',
    previousNames,
    status: str(json?.company_status),
    incorporationDate: isoDate(json?.date_of_creation),
    sicCodes,
    registeredOffice,
    postcodeDistrict: postcodeDistrict(registeredOffice?.postcode),
    accountsType: str(json?.accounts?.last_accounts?.type),
    lastAccountsMadeUpTo: isoDate(json?.accounts?.last_accounts?.made_up_to),
    lastConfirmationStatement: isoDate(json?.confirmation_statement?.last_made_up_to),
    fetchedAt,
    verified: true,
    note: null,
  };
}

function officerIdOf(item: any): string | null {
  const link = str(item?.links?.officer?.appointments);
  const m = link?.match(/\/officers\/([^/]+)\/appointments/);
  return m ? m[1] : null;
}

/** Newest appointment first; undated appointments last. */
export function parseOfficers(json: any): Officer[] {
  const items = Array.isArray(json?.items) ? json.items : [];
  const out: Officer[] = [];
  for (const it of items) {
    const name = officerDisplayName(str(it?.name) ?? '');
    if (!name) continue;
    out.push({
      officerId: officerIdOf(it),
      name,
      role: str(it?.officer_role) ?? 'officer',
      appointedOn: isoDate(it?.appointed_on),
      resignedOn: isoDate(it?.resigned_on),
    });
  }
  return out.sort((a, b) => (b.appointedOn || '').localeCompare(a.appointedOn || ''));
}

/** Newest filing first. `sinceIso` keeps filings dated on or after that day. */
export function parseCapitalFilings(json: any, sinceIso?: string | null): CapitalFiling[] {
  const items = Array.isArray(json?.items) ? json.items : [];
  const out: CapitalFiling[] = [];
  for (const it of items) {
    const date = isoDate(it?.date);
    if (!date) continue;
    if (sinceIso && date < sinceIso) continue;
    out.push({
      transactionId: str(it?.transaction_id),
      date,
      type: str(it?.type) ?? '',
      category: str(it?.category) ?? 'capital',
      description: renderFilingDescription(it),
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

// ---------------------------------------------------------------------------
// HTTP.

export class CompaniesHouseError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'CompaniesHouseError';
  }
}

interface ApiAnswer {
  status: number;
  json: any | null;
  error: string | null;
}

/** The note for a failed read, in the words the app shows. */
function noteFor(status: number, error: string | null): string {
  if (status === 404) return NOTE_NOT_ON_REGISTER;
  if (status === 401 || status === 403) return 'Companies House refused the key';
  if (status === 429) return 'Companies House rate limit reached';
  if (status > 0) return `Companies House did not answer (HTTP ${status})`;
  return `Companies House did not answer${error ? ` (${error})` : ''}`;
}

async function chGet(path: string, key: string): Promise<ApiAnswer> {
  const url = `${COMPANIES_HOUSE_BASE}${path}`;
  const init: RequestInit = { headers: { Authorization: `Basic ${btoa(`${key}:`)}`, Accept: 'application/json' } };
  const doFetch = config.fetch ?? ((u: string, i?: RequestInit) => fetchWithTimeout(u, FETCH_MS, i));
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await doFetch(url, init);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      return { status: 0, json: null, error: lastError };
    }
    if (res.status === 429 && attempt === 0) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '', 10);
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30000) : config.retryWaitMs;
      console.warn(`[companies-house] 429 for ${path}; waiting ${wait} ms`);
      try { await res.body?.cancel(); } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      return { status: res.status, json: null, error: `HTTP ${res.status}` };
    }
    try {
      return { status: res.status, json: await res.json(), error: null };
    } catch (e) {
      return { status: res.status, json: null, error: `bad JSON: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  return { status: 429, json: null, error: lastError ?? 'HTTP 429' };
}

/**
 * Search the register by name. Throws a CompaniesHouseError when the key is
 * missing or the API does not answer, so the caller can say why there are
 * no results rather than show an empty list.
 */
export async function searchCompanies(q: string, limit = SEARCH_LIMIT): Promise<CompanySearchHit[]> {
  const key = apiKey();
  if (!key) throw new CompaniesHouseError(NOTE_KEY_NOT_SET, 0);
  const query = (q || '').trim();
  if (query.length < 3) return [];
  const perPage = Math.max(1, Math.min(limit, 20));
  const answer = await chGet(`/search/companies?q=${encodeURIComponent(query)}&items_per_page=${perPage}`, key);
  if (answer.error) throw new CompaniesHouseError(noteFor(answer.status, answer.error), answer.status);
  return parseSearchResults(answer.json, limit);
}

function unverifiedRecord(companyNumber: string, note: string, name = ''): CompanyRecord {
  return {
    companyNumber,
    name,
    previousNames: [],
    status: null,
    incorporationDate: null,
    sicCodes: [],
    registeredOffice: null,
    postcodeDistrict: null,
    accountsType: null,
    lastAccountsMadeUpTo: null,
    lastConfirmationStatement: null,
    fetchedAt: new Date().toISOString(),
    verified: false,
    note,
  };
}

/** The profile; verified false with a note rather than a throw. */
export async function fetchCompanyProfile(companyNumber: string): Promise<CompanyRecord> {
  const number = normaliseCompanyNumber(companyNumber);
  if (!number) return unverifiedRecord(String(companyNumber || ''), NOTE_NOT_A_NUMBER);
  const key = apiKey();
  if (!key) return unverifiedRecord(number, NOTE_KEY_NOT_SET);
  const answer = await chGet(`/company/${encodeURIComponent(number)}`, key);
  if (answer.error || !answer.json) return unverifiedRecord(number, noteFor(answer.status, answer.error));
  return parseCompanyProfile(answer.json, number);
}

/** Current and resigned officers, newest appointment first. Empty when the key is missing or the read fails. */
export async function fetchOfficers(companyNumber: string): Promise<Officer[]> {
  const number = normaliseCompanyNumber(companyNumber);
  const key = apiKey();
  if (!number || !key) return [];
  const answer = await chGet(`/company/${encodeURIComponent(number)}/officers?items_per_page=${PAGE_SIZE}`, key);
  if (answer.error || !answer.json) {
    if (answer.status !== 404) console.warn(`[companies-house] officers for ${number}: ${answer.error}`);
    return [];
  }
  return parseOfficers(answer.json);
}

/** Capital-category filings (SH01 and the like), newest first. Empty when the key is missing or the read fails. */
export async function fetchCapitalFilings(companyNumber: string, sinceIso?: string | null): Promise<CapitalFiling[]> {
  const number = normaliseCompanyNumber(companyNumber);
  const key = apiKey();
  if (!number || !key) return [];
  const answer = await chGet(`/company/${encodeURIComponent(number)}/filing-history?category=capital&items_per_page=${PAGE_SIZE}`, key);
  if (answer.error || !answer.json) {
    if (answer.status !== 404) console.warn(`[companies-house] filings for ${number}: ${answer.error}`);
    return [];
  }
  return parseCapitalFilings(answer.json, sinceIso);
}

// ---------------------------------------------------------------------------
// The company_records cache.

export function rowToRecord(row: any): CompanyRecord {
  return {
    companyNumber: String(row.company_number),
    name: row.name ?? '',
    previousNames: Array.isArray(row.previous_names) ? row.previous_names.map(String) : [],
    status: row.status ?? null,
    incorporationDate: row.incorporation_date ?? null,
    sicCodes: Array.isArray(row.sic_codes) ? row.sic_codes.map(String) : [],
    registeredOffice: row.registered_office && typeof row.registered_office === 'object' ? row.registered_office : null,
    postcodeDistrict: row.postcode_district ?? postcodeDistrict(row.postcode),
    accountsType: row.accounts_type ?? null,
    lastAccountsMadeUpTo: row.last_accounts_made_up_to ?? null,
    lastConfirmationStatement: row.last_confirmation_statement ?? null,
    fetchedAt: row.fetched_at,
    verified: !!row.verified,
    note: row.note ?? null,
  };
}

export function recordToRow(r: CompanyRecord): Record<string, unknown> {
  return {
    company_number: r.companyNumber,
    name: r.name,
    previous_names: r.previousNames,
    status: r.status,
    incorporation_date: r.incorporationDate,
    sic_codes: r.sicCodes,
    registered_office: r.registeredOffice,
    postcode: r.registeredOffice?.postcode ?? null,
    postcode_district: r.postcodeDistrict,
    accounts_type: r.accountsType,
    last_accounts_made_up_to: r.lastAccountsMadeUpTo,
    last_confirmation_statement: r.lastConfirmationStatement,
    verified: r.verified,
    note: r.note,
    fetched_at: r.fetchedAt,
    updated_at: new Date().toISOString(),
  };
}

export interface ResolveInput {
  companyNumber: string | null;
  /** The company's stored website. Not in the register; kept for the caller's context only. */
  url: string;
  /** The stored name, used for the record when the register cannot be read. */
  name: string | null;
}

/**
 * company_records cache: read when fresher than maxAgeDays and verified,
 * else fetch and upsert. Returns null only when no number is given. A read
 * that fails never replaces a verified cached row; the cached row is
 * returned (the note says nothing of the failed read, the log does).
 */
export async function resolveCompanyRecord(supabase: any, input: ResolveInput, maxAgeDays = COMPANY_RECORD_MAX_AGE_DAYS): Promise<CompanyRecord | null> {
  const number = normaliseCompanyNumber(input.companyNumber);
  if (!number) return null;

  let cached: any = null;
  try {
    const { data } = await supabase.from('company_records').select('*').eq('company_number', number).maybeSingle();
    cached = data ?? null;
    if (cached?.verified && cached.fetched_at) {
      const ageDays = (Date.now() - new Date(cached.fetched_at).getTime()) / 86400000;
      if (ageDays <= maxAgeDays) return rowToRecord(cached);
    }
  } catch (e) {
    console.warn('[companies-house] cache read failed:', e instanceof Error ? e.message : e);
  }

  const fresh = await fetchCompanyProfile(number);
  if (!fresh.verified) {
    if (cached) {
      console.warn(`[companies-house] ${number}: ${fresh.note}; keeping the cached record from ${cached.fetched_at}`);
      return rowToRecord(cached);
    }
    if (!fresh.name && input.name) fresh.name = input.name;
  }
  try {
    const { error } = await supabase.from('company_records').upsert(recordToRow(fresh), { onConflict: 'company_number' });
    if (error) console.warn('[companies-house] cache write failed:', error.message);
  } catch (e) {
    console.warn('[companies-house] cache write failed:', e instanceof Error ? e.message : e);
  }
  return fresh;
}

// ---------------------------------------------------------------------------
// Officers and capital filings.

function officerKey(o: { name: string; role: string; appointedOn: string | null }): string {
  return `${o.name}\u0000${o.role}\u0000${o.appointedOn ?? ''}`;
}

export interface RegisterDetails {
  officers: Officer[];
  newOfficers: Officer[];
  filings: CapitalFiling[];
  newFilings: CapitalFiling[];
}

/**
 * Upsert officers into ch_officers and capital filings into ch_filings for
 * one company; returns what is new since the last sync (compared by the
 * tables' unique keys before writing). Nothing is ever deleted: a resigned
 * officer keeps the row with resigned_on set.
 */
export async function syncRegisterDetails(supabase: any, companyNumber: string, today: Date): Promise<RegisterDetails> {
  const number = normaliseCompanyNumber(companyNumber);
  const empty: RegisterDetails = { officers: [], newOfficers: [], filings: [], newFilings: [] };
  if (!number || !companiesHouseConfigured()) return empty;
  const todayIso = today.toISOString().slice(0, 10);
  const [officers, filings] = await Promise.all([fetchOfficers(number), fetchCapitalFilings(number)]);

  // Officers: which of the register's rows are already stored.
  let newOfficers: Officer[] = [];
  if (officers.length) {
    const { data: stored, error } = await supabase.from('ch_officers').select('id, name, role, appointed_on').eq('company_number', number);
    if (error) throw new Error(`ch_officers read failed: ${error.message}`);
    const known = new Set<string>((stored || []).map((r: any) => officerKey({ name: r.name, role: r.role, appointedOn: r.appointed_on ?? null })));
    newOfficers = officers.filter((o) => !known.has(officerKey(o)));
    const existing = officers.filter((o) => known.has(officerKey(o)));
    const rowOf = (o: Officer) => ({ company_number: number, officer_id: o.officerId, name: o.name, role: o.role, appointed_on: o.appointedOn, resigned_on: o.resignedOn, last_seen: todayIso });
    if (newOfficers.length) {
      const { error: insErr } = await supabase.from('ch_officers').upsert(newOfficers.map((o) => ({ ...rowOf(o), first_seen: todayIso })), { onConflict: 'company_number,name,role,appointed_on' });
      if (insErr) throw new Error(`ch_officers insert failed: ${insErr.message}`);
    }
    if (existing.length) {
      const { error: updErr } = await supabase.from('ch_officers').upsert(existing.map(rowOf), { onConflict: 'company_number,name,role,appointed_on' });
      if (updErr) throw new Error(`ch_officers upsert failed: ${updErr.message}`);
    }
  }

  // Filings: keyed by the register's transaction id; one without an id is reported but not stored.
  let newFilings: CapitalFiling[] = [];
  if (filings.length) {
    const keyed = filings.filter((f) => f.transactionId);
    const { data: stored, error } = await supabase.from('ch_filings').select('transaction_id').eq('company_number', number);
    if (error) throw new Error(`ch_filings read failed: ${error.message}`);
    const known = new Set<string>((stored || []).map((r: any) => String(r.transaction_id)));
    newFilings = keyed.filter((f) => !known.has(f.transactionId!));
    if (newFilings.length) {
      const rows = newFilings.map((f) => ({ company_number: number, transaction_id: f.transactionId, date: f.date, type: f.type, category: f.category, description: f.description, first_seen: todayIso }));
      const { error: insErr } = await supabase.from('ch_filings').upsert(rows, { onConflict: 'transaction_id' });
      if (insErr) throw new Error(`ch_filings insert failed: ${insErr.message}`);
    }
  }

  return { officers, newOfficers, filings, newFilings };
}
