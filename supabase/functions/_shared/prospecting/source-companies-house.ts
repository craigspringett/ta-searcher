// The base population: young technology companies with a registered office
// in London or the Home Counties, walked nightly through the Companies
// House advanced search.
//
// Investigation of 21 September 2026 (docs/PROSPECTING-BRIEF.md, "Companies
// House advanced search"): the advanced search takes a SIC code, a place
// (matched on the registered office address) and an incorporation date, and
// answers 100 companies a page with `hits`, the total. Thirteen technology
// SIC codes by eight places is 104 (sic, place) pairs and tens of thousands
// of companies, so each night walks 300 companies further: the pairs are
// taken round-robin from a cursor, each pair keeps its next start_index as
// a watermark in app_settings.prospecting.watermarks, and a pair whose
// start_index has reached its hits wraps to 0 (the register changes daily,
// so a second lap finds the newcomers). A company from here is a
// candidate only: it surfaces on the page when qualification finds a
// raise, a board with roles or a talent posting. Nothing is scored here.

import { advancedSearchCompanies, sectorFromSic, type AdvancedSearchPage } from '../companies-house.ts';
import type { ProspectCandidate } from './types.ts';

/** The brief's technology SIC codes. */
export const PROSPECT_SIC_CODES = ['62012', '62020', '62090', '63110', '63120', '58290', '72190', '72200', '74909', '64999', '66190', '86900', '71121'];

/** One call per place; the register matches the word against the registered office address. */
export const PROSPECT_PLACES = ['London', 'Cambridge', 'Oxford', 'Reading', 'Brighton', 'Bristol', 'Manchester', 'Edinburgh'];

/** How far back the walk looks: a company older than this is past its first Head of Talent. */
export const REGISTER_MAX_AGE_YEARS = 6;
export const REGISTER_PAGE_SIZE = 100;
export const DEFAULT_REGISTER_BUDGET = 300;
export const COMPANIES_HOUSE_PAGE_URL = 'https://find-and-update.company-information.service.gov.uk/company/';

export function watermarkKey(sic: string, place: string): string {
  return `${sic}|${place}`;
}

/** Every (sic, place) pair in walk order: place-major, so one night's three pages spread over the SIC codes of one place. */
export function walkPairs(): Array<{ sic: string; place: string }> {
  const out: Array<{ sic: string; place: string }> = [];
  for (const place of PROSPECT_PLACES) for (const sic of PROSPECT_SIC_CODES) out.push({ sic, place });
  return out;
}

export interface WalkStep {
  sic: string;
  place: string;
  startIndex: number;
}

/** The pages one night asks for: `budget` companies from the cursor on, one page per pair, round-robin. */
export function planWalk(cursor: number, watermarks: Record<string, number>, budget = DEFAULT_REGISTER_BUDGET): { steps: WalkStep[]; nextCursor: number } {
  const pairs = walkPairs();
  const pages = Math.max(1, Math.ceil(budget / REGISTER_PAGE_SIZE));
  const steps: WalkStep[] = [];
  let at = ((cursor % pairs.length) + pairs.length) % pairs.length;
  for (let i = 0; i < pages && i < pairs.length; i++) {
    const p = pairs[at];
    steps.push({ sic: p.sic, place: p.place, startIndex: watermarks[watermarkKey(p.sic, p.place)] ?? 0 });
    at = (at + 1) % pairs.length;
  }
  return { steps, nextCursor: at };
}

/** After a page: the next start_index for that pair, wrapping to 0 when the hits are exhausted. */
export function nextWatermark(startIndex: number, page: AdvancedSearchPage): number {
  const next = startIndex + Math.max(page.items.length, page.items.length === 0 ? REGISTER_PAGE_SIZE : 0);
  return next >= page.hits ? 0 : next;
}

export function incorporatedFromIso(today: Date): string {
  const d = new Date(Date.UTC(today.getUTCFullYear() - REGISTER_MAX_AGE_YEARS, today.getUTCMonth(), today.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

/** A register hit as a candidate: name, number and what the walk knows of the register. */
export function candidateFromRegisterHit(hit: AdvancedSearchPage['items'][number], step: { sic: string; place: string }, foundAt: string): ProspectCandidate {
  return {
    name: hit.name,
    companyNumber: hit.companyNumber,
    source: {
      source: 'companies_house',
      url: `${COMPANIES_HOUSE_PAGE_URL}${hit.companyNumber}`,
      title: hit.name,
      at: foundAt,
      note: `SIC ${step.sic}, ${step.place}`,
    },
    register: {
      status: hit.status,
      incorporationDate: hit.incorporationDate,
      sicCodes: hit.sicCodes,
      sector: sectorFromSic(hit.sicCodes),
      locality: hit.locality,
      postcodeDistrict: hit.postcodeDistrict,
      capitalFilings: [],
      matched: false,
    },
  };
}

export interface RegisterWalkResult {
  configured: boolean;
  calls: number;
  failed: number;
  found: number;
  candidates: ProspectCandidate[];
  watermarks: Record<string, number>;
  nextCursor: number;
  steps: Array<{ sic: string; place: string; startIndex: number; hits: number | null; items: number; error: string | null }>;
  errors: string[];
  ms: number;
}

type Search = (params: Parameters<typeof advancedSearchCompanies>[0]) => Promise<AdvancedSearchPage>;

/**
 * One night's walk. Never throws: a page that fails keeps its watermark and
 * is counted. `watermarks` and `nextCursor` in the result are what to
 * store; the caller writes them even on a partial run so the walk moves on.
 */
export async function walkRegister(today: Date, state: { cursor: number; watermarks: Record<string, number> }, options: { budget?: number; search?: Search; configured?: boolean } = {}): Promise<RegisterWalkResult> {
  const started = Date.now();
  const search = options.search ?? advancedSearchCompanies;
  const watermarks = { ...state.watermarks };
  const { steps, nextCursor } = planWalk(state.cursor, watermarks, options.budget ?? DEFAULT_REGISTER_BUDGET);
  const result: RegisterWalkResult = { configured: options.configured ?? true, calls: 0, failed: 0, found: 0, candidates: [], watermarks, nextCursor: state.cursor, steps: [], errors: [], ms: 0 };
  if (!result.configured) return { ...result, errors: ['Companies House key not set'], ms: Date.now() - started };
  const foundAt = today.toISOString();
  const incorporatedFrom = incorporatedFromIso(today);
  for (const step of steps) {
    result.calls++;
    try {
      const page = await search({ sicCodes: [step.sic], location: step.place, incorporatedFrom, size: REGISTER_PAGE_SIZE, startIndex: step.startIndex });
      watermarks[watermarkKey(step.sic, step.place)] = nextWatermark(step.startIndex, page);
      const active = page.items.filter((h) => !h.status || h.status === 'active');
      result.found += active.length;
      result.candidates.push(...active.map((h) => candidateFromRegisterHit(h, step, foundAt)));
      result.steps.push({ ...step, hits: page.hits, items: page.items.length, error: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.failed++;
      result.errors.push(`${step.sic} ${step.place}: ${msg}`);
      result.steps.push({ ...step, hits: null, items: 0, error: msg });
      // A key that is refused or a rate limit fails every page: stop asking.
      if (/key|rate limit/i.test(msg)) break;
    }
  }
  result.nextCursor = nextCursor;
  result.ms = Date.now() - started;
  return result;
}
