# Port contracts (working notes for the build, 21 September 2026)

TA Searcher is He-Giveth ported to a new market. This directory
(`ta-searcher/`) was seeded from the generic layer of `who-finds-leads` and
a mechanical rename ran over it (`school` → `company`, `schools` →
`companies`, same for the capitalised forms), so identifiers such as
`company_searches`, `companySearchId`, `company_refresh_runs`,
`company_facts`, `company_signals`, `company_scores`, `company_copy`,
`company_consultants`, `company_contact_edits`, `analyze_company_queue`,
`analyze_company_requests`, `enqueue_analyze_company_batch`,
`dispatch_analyze_company_queue` and `set_company_copy` are the names to
keep. `docs/TA-SEARCHER-BRIEF.md` is the product design; this file fixes
the interfaces the modules are built against so that work in parallel
joins up. Every module's tests run with
`cd supabase/functions && DENO_NO_PACKAGE_JSON=1 deno test --allow-all --no-check --node-modules-dir=none _shared`
(Deno is at `~/.deno/bin/deno`).

Style: British English in every user-facing string, no em dashes, no
exclamation marks, sentences not labels. Each source or register module
opens with a dated investigation note like He-Giveth's. Nothing is fetched
from LinkedIn.

## Identity: `supabase/functions/_shared/companies-house.ts`

Replaces `_shared/gias.ts` (do not import gias.ts in new code; it is
deleted at integration).

```ts
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
  officerId: string | null;   // the id in the officer's appointments link, when given
  name: string;               // as the register writes it, "SURNAME, Forenames" turned into "Forenames Surname"
  role: string;               // officer_role: 'director', 'secretary', 'llp-member', ...
  appointedOn: string | null;
  resignedOn: string | null;
}

export interface CapitalFiling {
  transactionId: string | null;
  date: string;               // ISO
  type: string;               // 'SH01', ...
  category: string;           // 'capital'
  description: string;        // the register's description, plain words
}

export interface CompanySearchHit {
  companyNumber: string;
  name: string;
  status: string | null;
  incorporationDate: string | null;
  addressSnippet: string | null;
  postcode: string | null;
}

export function companiesHouseConfigured(): boolean;              // COMPANIES_HOUSE_API_KEY set
export function normaliseCompanyNumber(s: string | null | undefined): string | null;
export function postcodeDistrict(postcode: string | null | undefined): string | null;
export function sectorFromSic(codes: string[]): string | null;     // a short label: 'Software', 'Fintech', 'Biotech', 'Consultancy', ... or null
export async function searchCompanies(q: string, limit?: number): Promise<CompanySearchHit[]>;
export async function fetchCompanyProfile(companyNumber: string): Promise<CompanyRecord>;   // verified false with a note rather than a throw
export async function fetchOfficers(companyNumber: string): Promise<Officer[]>;             // current and resigned, newest appointment first
export async function fetchCapitalFilings(companyNumber: string, sinceIso?: string | null): Promise<CapitalFiling[]>;
/** company_records cache: read when fresher than maxAgeDays and verified, else fetch and upsert. Returns null only when no number is given. */
export async function resolveCompanyRecord(supabase: any, input: { companyNumber: string | null; url: string; name: string | null }, maxAgeDays?: number): Promise<CompanyRecord | null>;
/** Upsert officers into ch_officers and capital filings into ch_filings for one company; returns what is new since the last sync. */
export async function syncRegisterDetails(supabase: any, companyNumber: string, today: Date): Promise<{ officers: Officer[]; newOfficers: Officer[]; filings: CapitalFiling[]; newFilings: CapitalFiling[] }>;
```

Tables (see the migration): `company_records` (one row per company number),
`ch_officers`, `ch_filings`.

## Open roles: `supabase/functions/_shared/vacancies/`

```ts
export type VacancySource = 'ashby' | 'greenhouse' | 'lever' | 'workable' | 'careers_page' | 'llm' | 'consultant' | 'other';
export type AtsProvider = 'ashby' | 'greenhouse' | 'lever' | 'workable';

export interface AtsBoard { provider: AtsProvider; slug: string; boardUrl: string | null; }

export interface CompanyContext {
  companySearchId: string | null;
  companyNumber: string | null;
  name: string;
  aliases: string[];
  /** Stored website URL. */
  url: string;
  postcodeDistrict: string | null;
  record: CompanyRecord | null;
  /** Confirmed boards from ats_boards; a feed is read only for a confirmed slug. */
  boards: AtsBoard[];
}

export interface CandidateVacancy {
  title: string;
  url?: string | null;
  pageUrl?: string | null;
  source: VacancySource;
  employerName?: string | null;
  closingDate?: string | null;
  startText?: string | null;
  /** ISO date the feed says the role was posted (Ashby publishedAt, Greenhouse updated_at is NOT a posting date, Lever createdAt, Workable published_on). */
  datePosted?: string | null;
  postcode?: string | null;
  department?: string | null;
  location?: string | null;
  /** 'remote' | 'hybrid' | 'onsite' | null */
  workplaceType?: string | null;
  employmentType?: string | null;
  document?: DocumentKind | null;
  lastModified?: string | null;
  post?: string | null;
  raw?: Record<string, unknown>;
}
```

`persistVacancies` writes `raw.department`, `raw.location`,
`raw.workplaceType`, `raw.employmentType`, `raw.datePosted`, `raw.sources`
on every row, and a new row's `first_seen` is `datePosted` when that is
earlier than today (so "open more than five weeks" is right from the first
read). Source `consultant` rows are never closed by a run. Source
`careers_page` and `llm` are never closed by a degraded run.

```ts
// role-family.ts
export type RoleFamily = 'engineering' | 'product_design' | 'go_to_market' | 'operations' | 'people_talent' | 'leadership' | 'other';
export function roleFamily(title: string, department?: string | null): RoleFamily;
export const ROLE_FAMILY_LABELS: Record<RoleFamily, string>;   // 'Engineering', 'Product and design', 'Go to market', 'Operations', 'People and talent', 'Leadership', 'Other'
/** Recruiter, talent, people partner, head of people: the roles that run hiring. */
export function isTalentRole(title: string): boolean;
/** Head of Talent, Head of Recruitment, Head of Talent Acquisition, Director of Talent, Talent Lead, Recruiting Lead: the role Craig places. */
export function isTalentLeadRole(title: string): boolean;
```

Sources, one exported async function each returning `Promise<SourceResult>`
and never throwing: `ashbySource(board: AtsBoard, today)`,
`greenhouseSource(board, today)`, `leverSource(board, today)`,
`workableSource(board, today)`, `careersPageSource(ctx, { homepageHtml, today })`.
`ats-detect.ts` exports `detectAtsBoards(html: string, baseUrl: string): AtsBoard[]`
(links and embed scripts on the homepage and careers page) and
`confirmBoard(board: AtsBoard, companyName: string): Promise<{ ok: boolean; count: number; note: string | null }>`
(the feed answers and, where the feed names the company, the name matches).

`SOURCE_LABELS`: ashby 'Ashby', greenhouse 'Greenhouse', lever 'Lever',
workable 'Workable', careers_page 'Careers page', llm 'Page read',
consultant 'Typed in', other 'Other'.

`blocklist.ts` keeps the shape rejects and the headline check; the only
family rejects are non-roles: "general application", "open application",
"speculative", "don't see a role", "join our talent community / network /
pool", "future opportunities", "internship" and "intern" (kept? no: an
intern is hiring load too; keep interns), "apprentice" kept. So: reject
placeholders only.

Table `ats_boards`: `company_search_id`, `provider`, `slug`, `board_url`,
`confirmed_at`, `last_checked_at`, `last_ok_at`, `last_count`, `note`,
unique on `(company_search_id, provider)`.

## Facts: `supabase/functions/_shared/facts/`

```ts
export const FACT_KINDS = [
  'funding_round', 'investor', 'stage', 'headcount', 'hiring_plan', 'leadership_change', 'people_function',
  'talent_team', 'expansion', 'new_market', 'office', 'product_launch', 'award', 'accelerator',
  'staffing_pressure', 'agency_mention', 'remote_policy', 'values', 'recent_news', 'staff_departure',
  'staff_arrival', 'other',
] as const;
export const CONSULTANT_FACT_KIND = 'consultant_intel';
```

`derive.ts` (new):

```ts
export type StageLabel = 'pre_seed' | 'seed' | 'series_a' | 'series_b_plus' | 'unknown';
export interface StageGuess { label: StageLabel; evidence: string | null; source_url: string | null; }
export function deriveStage(facts: Fact[], record: CompanyRecord | null, today: Date): StageGuess;
export interface LatestRaise { amountText: string | null; amountGbp: number | null; round: string | null; date: string | null; investors: string[]; statement: string; source_url: string; }
export function deriveLatestRaise(facts: Fact[], today: Date): LatestRaise | null;
```

The contact review's role enum in the extraction tool: 'Founder / CEO',
'Co-founder', 'COO / Chief of Staff', 'CTO / VP Engineering', 'Head of
People / CPO', 'Head of Talent / Recruiter', 'Head of Operations', 'EA /
Office Manager', 'Investor / Board', 'Other'.

## Signals and score: `_shared/signals/`, `_shared/score/`

Codes, labels and points exactly as the brief's table, plus the
`has_talent_lead` adjustment (factor 0.5; the code is present in the signals
list with strength 1 and scores nothing itself, like He-Giveth's
`self_sufficient_stated`).

```ts
export interface VacancyForSignals { id: string; title: string; firstSeen: string; closingDate: string | null; source: string; url?: string | null; department?: string | null; location?: string | null; advertText?: string | null; }
export interface ClosedVacancyForSignals { title: string; firstSeen: string; lastSeen: string; }
export interface OfficerForSignals { name: string; role: string; appointedOn: string | null; resignedOn: string | null; }
export interface CapitalFilingForSignals { date: string; type: string; description: string; }
export interface RegisterForSignals { status: string | null; incorporationDate: string | null; officers: OfficerForSignals[]; capitalFilings: CapitalFilingForSignals[]; }
export interface ContactForSignals { name: string; role: string | null; roleKey: string | null; }   // roleKey from the contacts taxonomy below
export interface SignalInput { today: Date; facts: Fact[]; openVacancies: VacancyForSignals[]; closedVacancies: ClosedVacancyForSignals[]; register: RegisterForSignals | null; contacts: ContactForSignals[]; }
```

`load.ts` exports `loadVacanciesForSignals(supabase, companySearchId)`,
`loadRegisterForSignals(supabase, companyNumber)` (from `company_records`,
`ch_officers`, `ch_filings`) and `contactsForSignals(decisionMakers)`;
`recompute.ts` keeps `recomputeSignalsForCompany` and `recomputeSignals`
with the same signatures, reading `company_facts`, `vacancies`, the register
tables and `company_searches.analysis_result.decisionMakers`.

## Contacts: `_shared/contacts/`

Taxonomy keys and ranks (highest first): `founder` 1 (Founder, CEO,
Co-founder, Founder and CEO), `coo` 2 (COO, Chief of Staff, Head of
Operations, VP Operations), `cto` 3 (CTO, VP Engineering, Head of
Engineering, Co-founder and CTO counts as `cto`? No: a co-founder is
`founder`; use the first matching rule in rank order), `people` 4 (Chief
People Officer, Head of People, VP People, People Partner, People Lead),
`talent` 5 (Head of Talent, Head of Recruitment, Talent Acquisition, Talent
Partner, Recruiter, Recruiting), `exec` 6 (any other Chief, VP, Director),
`ea` 7 (EA, Executive Assistant, Office Manager), `investor` 8 (Investor,
Board member, Non-executive, Partner at a fund). Labels: 'Founder / CEO',
'COO / Chief of Staff', 'CTO / VP Engineering', 'Head of People', 'Head of
Talent', 'Executive', 'EA / Office manager', 'Investor / Board'.

Generic mailboxes that rank: careers@, jobs@, talent@, people@, recruiting@,
hiring@, founders@, hello@, hi@, team@, info@, contact@. Deny list (never
shown): press@, media@, support@, help@, sales@, privacy@, legal@,
security@, billing@, abuse@, dpo@, partnerships@, investors@ (an investor
relations mailbox is not a person), noreply@, no-reply@.

Pages: contact tier `/contact`, `/contact-us`, `/get-in-touch`; people tier
`/team`, `/about`, `/about-us`, `/company`, `/people`, `/leadership`,
`/founders`, `/careers`, `/jobs`, `/join`, `/join-us`; context tier
`/blog`, `/news`, `/press`, `/customers`. No trust host; the "trust" tier
becomes an optional second host only when the careers page is on another
domain (e.g. `jobs.ashbyhq.com`): tag `level: 'careers'`.

## Copy: `_shared/copy/`

```ts
export type Persona = 'founder' | 'coo' | 'people' | 'cto' | 'investor';
export const PERSONA_LABELS = { founder: 'Founder / CEO', coo: 'COO / Chief of Staff', people: 'Head of People', cto: 'CTO / VP Engineering', investor: 'Investor talent partner' };
export const PERSONA_ROLE_KEYS = { founder: ['founder'], coo: ['coo', 'exec'], people: ['people', 'talent'], cto: ['cto'], investor: ['investor'] };
```

`applicablePersonas(ctx)` returns founder, coo, people, cto always and
investor only when an `investor` fact or contact exists. The user message
carries: persona, today, consultant identity, the register line (number,
status, incorporated, registered office district, sector), the stage guess
and the latest raise, the named contact and the other contacts, signals
strongest first with evidence, facts, open roles grouped by family with
counts, and the proof points. No spend, no pupil premium, no term.

## `analysis_result` (what the frontend reads)

```jsonc
{
  "summary": "…",
  "buyerIntentSignals": ["Label: explanation", …],
  "decisionMakers": [ DecisionMaker ],
  "recruitmentInsights": { "currentVacancies": [ { "title", "url", "source", "sourceLabel", "firstSeen", "datePosted", "department", "location", "workplaceType", "family" } ] },
  "companyRecord": CompanyRecord | null,
  "stage": StageGuess | null,
  "latestRaise": LatestRaise | null,
  "officers": [ Officer ],
  "boards": [ AtsBoard ],
  "vacancyRun": { at, degraded, degradedReason, sourcesOk, sourcesTried },
  "contactsRun": { … },
  "propensity": { score, topReason, topCode },
  "facts": [ Fact ], "signals": [ Signal ],
  "evidenceFingerprint": "…", "evidence": { … },
  "copy": { "<persona>": { persona, copy, contact, evidence_fingerprint, quality_flags, model, trigger, generated_at } },
  "consultant": "…",
  "websiteAccess": "blocks automated reading"
}
```

`company_searches` columns: `id`, `url`, `company_number` (text, nullable,
was `urn`), `company_name`, `analysis_result`, `evidence_fingerprint`,
`evidence_computed_at`, `created_at`, `updated_at`, plus whatever the live
table carries that is generic (see the migration).
