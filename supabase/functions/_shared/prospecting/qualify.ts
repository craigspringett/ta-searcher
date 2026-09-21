// One prospect's qualification: the register, the website, the boards and
// the score (docs/PROSPECTING-BRIEF.md, "Qualification", steps 1 to 4).
//
// Investigation of 21 September 2026: everything a step needs from the
// network is a dependency the pass injects (the register client, the page
// fetcher, the board check and the feed reader), so the rules are tested
// with fakes and the run wires the real ones. Each step is bounded: at most
// 14 website guesses (6 s each, four in flight), the homepage and three
// careers pages, four boards, one register search and two register reads.
// Nothing here writes: the pass takes the patch and stores it.

import { fetchCapitalFilings, fetchCompanyProfile, isDefunctStatus, searchCompanies, sectorFromSic, type CapitalFiling, type CompanyRecord, type CompanySearchHit } from '../companies-house.ts';
import { fetchPage, looksLikeSoft404, type FetchedPage } from '../fetch.ts';
import { boardUrlFor, confirmBoard, detectAtsBoards, type BoardConfirmation } from '../vacancies/ats-detect.ts';
import { normaliseOrgName, orgTokens } from '../vacancies/employer-match.ts';
import { boardSources } from '../vacancies/pipeline.ts';
import { isTalentRole } from '../vacancies/role-family.ts';
import { discoverCareersLinks } from '../vacancies/source-careers-page.ts';
import type { AtsBoard } from '../vacancies/types.ts';
import { websiteFromLanding } from './job-apis.ts';
import { scoreProspect } from './score.ts';
import { checkWebsite, guessWebsite, hostOf, originOf } from './website.ts';
import type { ProspectBoard, ProspectRegister, ProspectRow, ScoreReason } from './types.ts';

export const CAPITAL_FILINGS_MONTHS = 12;
const HOMEPAGE_MS = 12_000;
const CAREERS_PAGE_MS = 8_000;
const LANDING_MS = 10_000;
const MAX_CAREERS_PAGES = 3;
const MAX_BOARDS = 4;
const BOARD_TITLES = 20;

export interface QualifyDeps {
  searchCompanies: (q: string, limit?: number) => Promise<CompanySearchHit[]>;
  fetchCompanyProfile: (n: string) => Promise<CompanyRecord>;
  fetchCapitalFilings: (n: string, sinceIso?: string | null) => Promise<CapitalFiling[]>;
  fetchPage: (url: string, ms: number) => Promise<FetchedPage>;
  confirmBoard: (board: AtsBoard, name: string) => Promise<BoardConfirmation>;
  readBoard: (board: AtsBoard, today: Date) => Promise<{ ok: boolean; titles: string[] }>;
  /** Website hosts already tracked (company_searches.url). */
  trackedHosts: Set<string>;
}

export function liveDeps(trackedHosts: Set<string>): QualifyDeps {
  return {
    searchCompanies,
    fetchCompanyProfile,
    fetchCapitalFilings,
    fetchPage: (url, ms) => fetchPage(url, ms),
    confirmBoard,
    readBoard: async (board, today) => {
      const [r] = await Promise.all(boardSources([board], today));
      return { ok: r.ok, titles: r.vacancies.map((v) => v.title) };
    },
    trackedHosts,
  };
}

/**
 * The register hit to take for a name: the first active one whose
 * normalised name equals the prospect's, or contains it with one token to
 * spare ("Metris Energy" for "Metris Energy Ltd", not "Metris Energy
 * Holdings Group"). Null when none does.
 */
export function acceptRegisterHit(hits: CompanySearchHit[], name: string): CompanySearchHit | null {
  const want = normaliseOrgName(name);
  if (!want) return null;
  const wantTokens = orgTokens(name);
  const active = hits.filter((h) => !h.status || h.status === 'active');
  for (const h of active) if (normaliseOrgName(h.name) === want) return h;
  for (const h of active) {
    const have = orgTokens(h.name);
    if (wantTokens.size && Array.from(wantTokens).every((t) => have.has(t)) && have.size - wantTokens.size <= 1) return h;
  }
  return null;
}

function registerFromRecord(record: CompanyRecord, filings: CapitalFiling[]): ProspectRegister {
  return {
    status: record.status,
    incorporationDate: record.incorporationDate,
    sicCodes: record.sicCodes,
    sector: sectorFromSic(record.sicCodes),
    locality: record.registeredOffice?.locality ?? null,
    postcodeDistrict: record.postcodeDistrict,
    capitalFilings: filings.map((f) => ({ date: f.date, type: f.type, description: f.description })),
    matched: true,
    note: null,
  };
}

export interface QualifyOutcome {
  /** What to store on the row (the status included). */
  patch: Record<string, unknown>;
  status: 'qualified' | 'unsuitable' | 'dismissed';
  score: number;
  reasons: ScoreReason[];
  website: string | null;
  boards: ProspectBoard[];
  note: string;
  /** The steps' notes, for the run details. */
  notes: string[];
}

type Prospect = Pick<ProspectRow, 'id' | 'name' | 'name_key' | 'website' | 'company_number' | 'register' | 'raise' | 'talent_postings' | 'sources' | 'first_seen_at'>;

/** Qualify one prospect. Never throws; a step that fails is a note and the rest go on. */
export async function qualifyProspect(p: Prospect, deps: QualifyDeps, today: Date): Promise<QualifyOutcome> {
  const notes: string[] = [];
  const now = today.toISOString();

  // 1. The register.
  let companyNumber: string | null = p.company_number ?? null;
  let register: ProspectRegister | null = p.register ? { ...p.register, capitalFilings: p.register.capitalFilings || [], matched: !!p.register.matched } : null;
  if (!companyNumber) {
    try {
      const hits = await deps.searchCompanies(p.name, 10);
      const hit = acceptRegisterHit(hits, p.name);
      if (hit) { companyNumber = hit.companyNumber; notes.push(`register: matched ${hit.name} (${hit.companyNumber})`); }
      else notes.push(hits.length ? `register: ${hits.length} hits, none named ${p.name}` : 'register: no hits');
    } catch (e) {
      notes.push(`register search: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (companyNumber) {
    try {
      const record = await deps.fetchCompanyProfile(companyNumber);
      if (record.verified) {
        const since = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - CAPITAL_FILINGS_MONTHS, today.getUTCDate())).toISOString().slice(0, 10);
        let filings: CapitalFiling[] = [];
        try { filings = await deps.fetchCapitalFilings(companyNumber, since); } catch (e) { notes.push(`filings: ${e instanceof Error ? e.message : String(e)}`); }
        register = registerFromRecord(record, filings);
        notes.push(`register: ${record.status || 'status unknown'}, incorporated ${record.incorporationDate || 'unknown'}, ${filings.length} capital filing${filings.length === 1 ? '' : 's'} in ${CAPITAL_FILINGS_MONTHS} months`);
      } else {
        register = register ? { ...register, note: record.note } : { status: null, incorporationDate: null, sicCodes: [], sector: null, locality: null, postcodeDistrict: null, capitalFilings: [], matched: false, note: record.note };
        notes.push(`register: ${record.note}`);
      }
    } catch (e) {
      notes.push(`register: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const defunct = !!register?.matched && isDefunctStatus(register.status);

  // 2. The website.
  let website: string | null = p.website ? originOf(p.website) ?? p.website : null;
  let homepage: FetchedPage | null = null;
  const landingBoards: AtsBoard[] = [];
  if (website) {
    const check = await checkWebsite(website, p.name, deps.fetchPage);
    notes.push(`website: ${check.note}`);
    if (check.page) homepage = check.page;
  }
  if (!website && !defunct) {
    const posting = (p.talent_postings || []).find((t) => t.source === 'adzuna' && t.url);
    if (posting) {
      try {
        const landed = await deps.fetchPage(posting.url, LANDING_MS);
        const finalUrl = landed.finalUrl || posting.url;
        for (const b of detectAtsBoards(`${finalUrl} ${landed.html || ''}`, finalUrl)) landingBoards.push(b);
        const fromLanding = landed.ok ? websiteFromLanding(finalUrl) : null;
        if (fromLanding) {
          website = fromLanding;
          notes.push(`website: the Adzuna posting lands on ${website}`);
          if (originOf(finalUrl) === website && landed.html) homepage = landed;
        } else notes.push(`website: the Adzuna posting lands on ${hostOf(finalUrl) || 'nowhere'}${landingBoards.length ? `, a ${landingBoards[0].provider} board` : ''}`);
      } catch (e) {
        notes.push(`landing: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  if (!website && !defunct) {
    const guess = await guessWebsite(p.name, deps.fetchPage);
    notes.push(`website: ${guess.note}`);
    if (guess.website) { website = guess.website; homepage = guess.page; }
  }
  if (website && !homepage) {
    try {
      const page = await deps.fetchPage(website, HOMEPAGE_MS);
      if (page.ok && page.html) homepage = page;
    } catch { /* noted below by the board step */ }
  }

  // Already tracked by its website.
  const host = hostOf(website);
  if (host && deps.trackedHosts.has(host)) {
    return {
      patch: { company_number: companyNumber, website, register, status: 'dismissed', dismissed_at: now, dismiss_reason: 'already tracked', qualified_at: now, last_seen_at: now },
      status: 'dismissed', score: 0, reasons: [], website, boards: [], note: `${host} is already a tracked company`, notes,
    };
  }

  // 3. The boards.
  const boards: ProspectBoard[] = [];
  if (website && !defunct) {
    const detected = new Map<string, AtsBoard>();
    const add = (b: AtsBoard) => { const k = `${b.provider}:${b.slug}`; if (!detected.has(k)) detected.set(k, b); };
    for (const b of landingBoards) add(b);
    if (homepage?.html) {
      for (const b of detectAtsBoards(homepage.html, website)) add(b);
      const origin = originOf(website) ?? website;
      const links = discoverCareersLinks(homepage.html, website).slice(0, MAX_CAREERS_PAGES);
      for (const path of ['careers', 'jobs']) if (links.length < MAX_CAREERS_PAGES) links.push(`${origin}${path}`);
      let fetched = 0;
      for (const url of Array.from(new Set(links)).slice(0, MAX_CAREERS_PAGES)) {
        try {
          const page = await deps.fetchPage(url, CAREERS_PAGE_MS);
          fetched++;
          if (!page.ok || !page.html || looksLikeSoft404(page.html, homepage.html)) continue;
          for (const b of detectAtsBoards(page.html, url)) add(b);
        } catch { /* a careers page that fails is nothing to note */ }
      }
      notes.push(`boards: ${detected.size} linked from the homepage and ${fetched} careers page${fetched === 1 ? '' : 's'}`);
    } else {
      notes.push('boards: the homepage did not answer, nothing to read the links from');
    }
    const guessed: string[] = [];
    if (!detected.size) {
      const label = (host || '').split('.')[0];
      const words = normaliseOrgName(p.name);
      const compact = words.replace(/\s+/g, '');
      const dashed = words.replace(/\s+/g, '-');
      const slugs = Array.from(new Set([label, compact, dashed].filter((x) => x.length >= 3)));
      for (const provider of ['ashby', 'greenhouse', 'lever', 'workable'] as const) {
        for (const slug of slugs) {
          const b: AtsBoard = { provider, slug, boardUrl: boardUrlFor(provider, slug) };
          let check: BoardConfirmation;
          try { check = await deps.confirmBoard(b, p.name); } catch (e) { check = { ok: false, count: 0, note: e instanceof Error ? e.message : String(e) }; }
          if (!check.ok || check.nameMatch === false) continue;
          add(b);
          guessed.push(`${provider}:${slug}`);
          break;
        }
      }
      if (guessed.length) notes.push(`boards: guessed from the name: ${guessed.join(', ')}`);
    }
    for (const b of Array.from(detected.values()).slice(0, MAX_BOARDS)) {
      let check: BoardConfirmation;
      try { check = await deps.confirmBoard(b, p.name); } catch (e) { check = { ok: false, count: 0, note: e instanceof Error ? e.message : String(e) }; }
      if (!check.ok) { notes.push(`board ${b.provider}/${b.slug}: ${check.note}`); continue; }
      let titles: string[] = [];
      try {
        const read = await deps.readBoard(b, today);
        titles = read.titles;
      } catch (e) {
        notes.push(`board ${b.provider}/${b.slug} feed: ${e instanceof Error ? e.message : String(e)}`);
      }
      const count = Math.max(check.count, titles.length);
      boards.push({ provider: b.provider, slug: b.slug, boardUrl: b.boardUrl, count, talentRoles: titles.filter((t) => isTalentRole(t)), titles: titles.slice(0, BOARD_TITLES), note: check.note });
      notes.push(`board ${b.provider}/${b.slug}: ${count} roles${check.nameMatch === false ? ' (the feed names another company)' : ''}`);
    }
  }

  // 4. The score.
  const scored = scoreProspect({ website, register, raise: p.raise ?? null, boards, talentPostings: p.talent_postings || [], firstSeenAt: p.first_seen_at }, today);
  const status: QualifyOutcome['status'] = defunct ? 'unsuitable' : 'qualified';
  const note = defunct
    ? `${register?.status} on the register`
    : website
    ? `scored ${scored.score}`
    : `scored ${scored.score}; website not found`;
  return {
    patch: {
      company_number: companyNumber,
      website,
      register,
      boards,
      prospect_score: scored.score,
      score_reasons: scored.reasons,
      status,
      qualified_at: now,
      last_seen_at: now,
    },
    status,
    score: scored.score,
    reasons: scored.reasons,
    website,
    boards,
    note,
    notes,
  };
}
