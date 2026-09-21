// The prospecting modules against the hand-written fixtures (fixtures/
// adzuna.json, fixtures/reed.json, ../fixtures/companies-house/
// advanced-search.json) and fakes for the network and the database.
import { assert, assertEquals } from '../test-assert.ts';
import { parseAdvancedSearchResults, type CapitalFiling, type CompanyRecord, type CompanySearchHit } from '../companies-house.ts';
import type { FetchedPage } from '../fetch.ts';
import type { FeedFetch, FeedSpec } from '../funding-news/sources.ts';
import type { AtsBoard } from '../vacancies/types.ts';
import { dismissedRecently, discoverProspects, isTracked, mergeCandidates, mergeIntoExisting, rowForInsert, type ExistingProspect } from './discover.ts';
import { isAgencyEmployer, isHeadOfPeopleRole, isJobBoardHost, isProspectPostingTitle, websiteFromLanding } from './job-apis.ts';
import { promotionDecision, promoteProspect } from './promote.ts';
import { acceptRegisterHit, qualifyProspect, type QualifyDeps } from './qualify.ts';
import { normaliseWebsiteInput, orderForQualification, qualifyProspects } from './run.ts';
import { raiseReadsEarly, scoreProspect } from './score.ts';
import { settingsFromValue } from './settings.ts';
import { adzunaSearchUrl, adzunaSource, parseAdzunaResults, siftPostings } from './source-adzuna.ts';
import { candidateFromRegisterHit, incorporatedFromIso, nextWatermark, planWalk, walkPairs, walkRegister } from './source-companies-house.ts';
import { candidatesFromFeeds, candidatesFromFundingNewsRows, looksLikeCompanyName, newsFeedSpecs, newsSource, PROSPECT_NEWS_QUERIES } from './source-news.ts';
import { parseReedResults, reedDateToIso, reedSource } from './source-reed.ts';
import type { ProspectCandidate, ProspectRow } from './types.ts';
import { checkWebsite, domainWords, guessWebsite, hostOf, originOf, pageNamesCompany, websiteCandidates } from './website.ts';

const here = new URL('./fixtures/', import.meta.url);
const adzunaJson = JSON.parse(Deno.readTextFileSync(new URL('adzuna.json', here)));
const reedJson = JSON.parse(Deno.readTextFileSync(new URL('reed.json', here)));
const advancedJson = JSON.parse(Deno.readTextFileSync(new URL('../../fixtures/companies-house/advanced-search.json', here)));
const TODAY = new Date('2026-09-21T06:00:00.000Z');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// ---------------------------------------------------------------- job APIs

Deno.test('job-apis: the titles the pass keeps', () => {
  assert(isProspectPostingTitle('Head of Talent'));
  assert(isProspectPostingTitle('Head of Talent Acquisition'));
  assert(isProspectPostingTitle('Talent Acquisition Partner'));
  assert(isProspectPostingTitle('Head of People'));
  assert(isProspectPostingTitle('Founding Recruiter'));
  assert(isProspectPostingTitle('Talent Lead'));
  assert(!isProspectPostingTitle('Recruiter'), 'a seat on a team');
  assert(!isProspectPostingTitle('Senior Tech Recruiter'));
  assert(!isProspectPostingTitle('Head of Sales'));
  assert(!isProspectPostingTitle(''));
  // The first live run's noise.
  for (const t of ['Head of HR / HR Manager / Senior HR Lead', 'HR Manager', 'HR Generalist', 'Senior HRBP (Tech, Product Ops)', 'People Generalist', 'People Business Partner', 'Recruitment Coordinator', 'Senior Recruiting Coordinator (R5646)', 'Staff Talent Sourcer - UK & EU', 'Head of People Systems', 'Head of People Services Transformation - OH & Wellbeing', 'Talent Acquisition Governance and Compliance Manager', 'Talent development lead', 'Director, Talent & Player Marketing', 'EMEA Recruiter', 'Senior Recruiter (12-Month Contract)', 'HR and Talent Advisor', 'Senior People Operations Specialist', 'Recruitment Consultant - Maidenhead', 'Recruiter (GTM & Business)']) {
    assert(!isProspectPostingTitle(t), `kept: ${t}`);
  }
  for (const t of ['Talent Acquisition Partner', 'Senior Talent Acquisition Partner, Engineering', 'Talent Acquisition Manager', 'Talent Partner, GTM', 'Talent Lead, Europe', 'Head of Talent Acquisition (6-month contract)', 'Recruitment Manager - Tech', 'Head of People & Culture', 'Founding Recruiter (GTM)']) {
    assert(isProspectPostingTitle(t), `dropped: ${t}`);
  }
});

Deno.test('job-apis: agency employers and head of people', () => {
  assert(isAgencyEmployer('Big Fish Recruitment'));
  assert(isAgencyEmployer('Acme Talent Partners'));
  assert(isAgencyEmployer('Harvey Nash Executive Search'));
  assert(!isAgencyEmployer('Metris Energy'));
  assert(!isAgencyEmployer('Searchable'), '"search" as a word only');
  for (const n of ['Adecco', 'Michael Page HR', 'Frazer Jones', 'Huntress', 'Oakleaf Partnership', 'Insight Select Ltd', 'Merrifield Consultants', 'Ashdown Group', 'Birchrose Associates', 'Centre People Appointments', 'M4 Talent Group Limited', 'Technical Placements Ltd', 'Superb People', 'Unite Talent', 'Hire Ground Ltd', 'Anonymous Recruiter', 'Reed', 'eFinancialCareers', 'Hays Specialist Recruitment Limited', 'COREcruitment International']) {
    assert(isAgencyEmployer(n), `not an agency: ${n}`);
  }
  for (const n of ['Cledara', 'CarbonChain', 'Legora', 'Lendable', 'Mention Me', 'Upwind Security', 'XYZ Reality', 'Entrepreneurs First', 'Gigs', 'Shield AI']) {
    assert(!isAgencyEmployer(n), `an agency: ${n}`);
  }
  assert(isHeadOfPeopleRole('Head of People'));
  assert(isHeadOfPeopleRole('Chief People Officer'));
  assert(!isHeadOfPeopleRole('Head of Talent'));
});

Deno.test('job-apis: where a posting lands says the website unless it is a board', () => {
  assertEquals(websiteFromLanding('https://www.metris.energy/careers/head-of-talent'), 'https://www.metris.energy/');
  assertEquals(websiteFromLanding('https://jobs.ashbyhq.com/metris/123'), null);
  assertEquals(websiteFromLanding('https://www.adzuna.co.uk/land/ad/1'), null);
  assertEquals(websiteFromLanding('https://uk.linkedin.com/jobs/view/1'), null);
  assertEquals(websiteFromLanding(null), null);
  assert(isJobBoardHost('www.reed.co.uk'));
  assert(!isJobBoardHost('metris.energy'));
});

Deno.test('adzuna: the fixture parses and sifts into prospects, an agency note and dropped titles', () => {
  const postings = parseAdzunaResults(adzunaJson);
  assertEquals(postings.length, 6);
  assertEquals(postings[0].employer, 'Metris Energy');
  assertEquals(postings[0].date, '2026-09-18');
  assert(postings[0].url!.includes('adzuna.co.uk/land/ad/'));
  const sifted = siftPostings(postings, 'adzuna', TODAY.toISOString());
  assertEquals(sifted.candidates.map((c) => c.name), ['Metris Energy', 'Nul Health'], 'the duplicate Metris posting is one candidate');
  assertEquals(sifted.agency.map((a) => a.employer), ['Big Fish Recruitment']);
  assertEquals(sifted.droppedTitles, 2, 'Head of Sales and a bare Recruiter');
  assertEquals(sifted.candidates[0].talentPosting?.title, 'Head of Talent');
  assertEquals(sifted.candidates[0].source.source, 'adzuna');
  assertEquals(sifted.candidates[0].source.at, '2026-09-18T00:00:00.000Z');
});

Deno.test('adzuna: the source asks one call per phrase and is skipped without keys', async () => {
  const urls: string[] = [];
  const r = await adzunaSource(TODAY, { keys: { appId: 'id', appKey: 'key' }, phrases: ['head of talent', 'talent lead'], fetch: (u) => { urls.push(u); return Promise.resolve(jsonResponse(adzunaJson)); } });
  assertEquals(r.calls, 2);
  assertEquals(r.configured, true);
  assertEquals(r.found, 12);
  assertEquals(r.candidates.length, 2, 'the same postings twice are two candidates');
  assert(urls[0].includes('what_phrase=head+of+talent') && urls[0].includes('app_id=id'), urls[0]);
  const none = await adzunaSource(TODAY, { keys: null });
  assertEquals(none.configured, false);
  assertEquals(none.calls, 0);
  assert(none.errors[0].includes('ADZUNA_APP_ID'));
  const failing = await adzunaSource(TODAY, { keys: { appId: 'id', appKey: 'key' }, phrases: ['x'], fetch: () => Promise.resolve(jsonResponse({}, 403)) });
  assertEquals(failing.failed, 1);
  assertEquals(failing.candidates.length, 0);
  assert(adzunaSearchUrl('head of talent', { appId: 'a', appKey: 'b' }).startsWith('https://api.adzuna.com/v1/api/jobs/gb/search/1?'));
});

Deno.test('reed: UK-first dates, the fixture, the 30-day cut and Basic auth', async () => {
  assertEquals(reedDateToIso('19/09/2026'), '2026-09-19');
  assertEquals(reedDateToIso('2026-09-19T00:00:00'), '2026-09-19');
  assertEquals(reedDateToIso(null), null);
  const postings = parseReedResults(reedJson);
  assertEquals(postings.length, 4);
  assertEquals(postings[0].employer, 'Crimson Legal AI');
  assertEquals(postings[0].date, '2026-09-19');
  let auth = '';
  const r = await reedSource(TODAY, { key: 'secret', phrases: ['head of recruitment'], fetch: (_u, init) => { auth = String(new Headers(init?.headers).get('Authorization')); return Promise.resolve(jsonResponse(reedJson)); } });
  assertEquals(auth, `Basic ${btoa('secret:')}`);
  assertEquals(r.found, 3, 'Old News Ltd (July) is past 30 days');
  assertEquals(r.candidates.map((c) => c.name), ['Crimson Legal AI', 'Stoa']);
  assertEquals(r.agency.map((a) => a.employer), ['Acme Talent Partners']);
  const none = await reedSource(TODAY, { key: null });
  assertEquals(none.configured, false);
});

// ------------------------------------------------------------ the register

Deno.test('companies-house: the advanced search fixture parses and the walk plans round-robin with watermarks', () => {
  const page = parseAdvancedSearchResults(advancedJson);
  assertEquals(page.hits, 2371);
  assertEquals(page.items.length, 3, 'the hit with no number is dropped');
  assertEquals(page.items[0].name, 'METRIS ENERGY LTD');
  assertEquals(page.items[0].locality, 'London');
  assertEquals(page.items[0].postcodeDistrict, 'EC2A');
  assertEquals(walkPairs().length, 13 * 8);
  const plan = planWalk(0, { '62012|London': 200 }, 300);
  assertEquals(plan.steps.length, 3);
  assertEquals(plan.steps[0], { sic: '62012', place: 'London', startIndex: 200 });
  assertEquals(plan.steps[1].startIndex, 0);
  assertEquals(plan.nextCursor, 3);
  assertEquals(planWalk(103, {}, 100).nextCursor, 0, 'wraps');
  assertEquals(nextWatermark(200, page), 203);
  assertEquals(nextWatermark(2300, { hits: 2371, items: new Array(100).fill(page.items[0]) }), 0, 'past the hits wraps to 0');
  assertEquals(nextWatermark(0, { hits: 0, items: [] }), 0);
  assertEquals(incorporatedFromIso(TODAY), '2020-09-21');
  const c = candidateFromRegisterHit(page.items[0], { sic: '62012', place: 'London' }, TODAY.toISOString());
  assertEquals(c.companyNumber, '14567890');
  assertEquals(c.register?.matched, false);
  assertEquals(c.register?.sector !== undefined, true);
  assertEquals(c.source.note, 'SIC 62012, London');
});

Deno.test('companies-house: the walk reads its pages, keeps active companies and moves the watermarks; a refused key stops it', async () => {
  const page = parseAdvancedSearchResults(advancedJson);
  const asked: number[] = [];
  const r = await walkRegister(TODAY, { cursor: 0, watermarks: {} }, { budget: 200, search: (p) => { asked.push(p.startIndex ?? 0); return Promise.resolve(page); } });
  assertEquals(r.calls, 2);
  assertEquals(r.found, 4, 'two active per page, the dissolved one dropped');
  assertEquals(r.watermarks['62012|London'], 3);
  assertEquals(r.nextCursor, 2);
  assertEquals(r.steps[0].hits, 2371);
  const refused = await walkRegister(TODAY, { cursor: 0, watermarks: {} }, { budget: 300, search: () => Promise.reject(new Error('Companies House key not accepted')) });
  assertEquals(refused.calls, 1, 'stops after the first refusal');
  assertEquals(refused.failed, 1);
  const off = await walkRegister(TODAY, { cursor: 0, watermarks: {} }, { configured: false });
  assertEquals(off.configured, false);
  assertEquals(off.calls, 0);
});

// ---------------------------------------------------------------- the news

Deno.test('news: what reads as a company name', () => {
  for (const n of ['Metris Energy', 'Sprive', 'Jack & Jill', 'kausable', 'Stoa', 'Luffy AI', 'London Quantum Group', 'Magnitude Biosciences', 'SORRY SUGAR', 'The Newman']) assert(looksLikeCompanyName(n), `rejected: ${n}`);
  for (const n of ['Dragons’ Den-backed Sprive', 'Mortgage overpayment app Sprive', 'Revolut founder’s QuantumLight', 'co-founded by DeepMind creative lead', 'TaiSan founded by chess champion', 'SA AI coding HyperDev platform', 'Climate change', 'just', 'Build', '', 'a', 'AI writing startup co-founded by DeepMind creative lead raises']) assert(!looksLikeCompanyName(n), `accepted: ${n}`);
});

Deno.test('news: the extra queries, feed candidates and the unmatched funding_news rows', async () => {
  assertEquals(newsFeedSpecs().length, PROSPECT_NEWS_QUERIES.length);
  assert(newsFeedSpecs()[0].url.includes('news.google.com/rss/search?q='));
  const feed: FeedFetch = {
    source: 'google_news', url: 'https://x', ok: true, status: 200, error: null, ms: 1,
    items: [
      { title: 'London-based Metris Energy raises €4.35 million to scale AI platform', link: 'https://news.google.com/a', description: '', publishedAt: '2026-09-20T07:00:00.000Z', publisher: 'EU-Startups' },
      { title: 'Metris Energy raises €4.35 million', link: 'https://news.google.com/b', description: '', publishedAt: '2026-09-18T07:00:00.000Z', publisher: 'Tech.eu' },
      { title: 'Ten start-ups to watch this autumn', link: 'https://news.google.com/c', description: '', publishedAt: '2026-09-20T07:00:00.000Z', publisher: 'Sifted' },
    ],
  };
  const from = candidatesFromFeeds([feed], TODAY.toISOString());
  assertEquals(from.items, 3);
  assertEquals(from.raiseStories, 2);
  assertEquals(from.candidates.length, 1, 'one per company, the newest story');
  assertEquals(from.candidates[0].name, 'Metris Energy');
  assertEquals(from.candidates[0].raise?.date, '2026-09-20');
  assertEquals(from.candidates[0].source.note, 'Google News, EU-Startups');
  const rows = candidatesFromFundingNewsRows([
    { source: 'uktn', title: 'Crimson raises $2.5m seed', url: 'https://u/1', published_at: '2026-09-19T00:00:00Z', company_name: 'Crimson', amount_text: '$2.5m', amount_gbp: 1900000, round: 'seed' },
    { source: 'uktn', title: 'no name', url: 'https://u/2', published_at: '2026-09-19T00:00:00Z', company_name: null },
  ], TODAY.toISOString());
  assertEquals(rows.length, 1);
  assertEquals(rows[0].raise?.round, 'seed');
  assertEquals(rows[0].source.note, 'UKTN');
  const supabase = fakeSupabase({ funding_news: [{ id: '1', source: 'sifted', title: 'Stoa raises £3m seed round', url: 'https://s/1', publisher: null, published_at: '2026-09-15T00:00:00Z', company_name: 'Stoa', amount_text: '£3m', amount_gbp: 3000000, round: 'seed', matched_company_search_id: null }] });
  const r = await newsSource(supabase, TODAY, { specs: [{ source: 'google_news', url: 'https://x' } as FeedSpec], fetch: () => Promise.resolve(feed) });
  assertEquals(r.rows, 1);
  assertEquals(r.feeds, 1);
  assertEquals(r.candidates.map((c) => c.name), ['Stoa', 'Metris Energy']);
});

// ------------------------------------------------------------- the website

Deno.test('website: the candidates from a name and the verification', () => {
  assertEquals(domainWords('Metris Energy Ltd'), 'metris energy');
  const c = websiteCandidates('Metris Energy Ltd');
  assertEquals(c.length, 14);
  assertEquals(c[0], 'https://metrisenergy.com/');
  assertEquals(c[7], 'https://metris-energy.com/');
  assertEquals(websiteCandidates('Stoa').length, 7, 'one label when there is one word');
  assertEquals(websiteCandidates('AB'), []);
  const page = (html: string, ok = true): FetchedPage => ({ url: 'https://x/', finalUrl: 'https://x/', status: ok ? 200 : 404, ok, html, ms: 1 });
  assert(pageNamesCompany(page('<html><title>Metris Energy: renewable asset AI</title><body>hello</body></html>'), 'Metris Energy Ltd'));
  assert(pageNamesCompany(page('<html><title>Home</title><body><h1>Welcome to MetrisEnergy</h1></body></html>'), 'Metris Energy'));
  assert(!pageNamesCompany(page('<html><title>Home</title><body>Something else entirely</body></html>'), 'Metris Energy'));
  assert(!pageNamesCompany(page('<html><title>metrisenergy.com is for sale</title><body>Buy this domain</body></html>'), 'Metris Energy'), 'parked');
  assert(!pageNamesCompany(page('<title>Metris Energy</title>', false), 'Metris Energy'));
  assertEquals(originOf('https://www.metris.energy/about?x=1'), 'https://www.metris.energy/');
  assertEquals(originOf('mailto:a@b'), null);
  assertEquals(hostOf('https://www.Metris.energy/x'), 'metris.energy');
  assertEquals(hostOf('metris.energy'), 'metris.energy');
  assertEquals(hostOf(null), null);
});

Deno.test('website: the guess takes the first candidate that names the company, in candidate order', async () => {
  const answers: Record<string, string> = {
    'https://metris-energy.com/': '<title>Metris Energy</title>',
    'https://metrisenergy.io/': '<title>Metris Energy Ltd</title>',
  };
  const fetcher = (url: string) => Promise.resolve<FetchedPage>(answers[url] ? { url, finalUrl: url, status: 200, ok: true, html: answers[url], ms: 1 } : { url, finalUrl: url, status: 0, ok: false, html: '', error: 'dns', ms: 1 });
  const g = await guessWebsite('Metris Energy Ltd', fetcher);
  assertEquals(g.website, 'https://metrisenergy.io/', '.io of the compact label comes before .com of the dashed one');
  assertEquals(g.tried.length, 14);
  const none = await guessWebsite('Nul Health', fetcher);
  assertEquals(none.website, null);
  assert(none.note.includes('none of 14 guesses answered'), none.note);
  const short = await guessWebsite('AB', fetcher);
  assertEquals(short.website, null);
  const check = await checkWebsite('https://metrisenergy.io/', 'Metris Energy', fetcher);
  assertEquals(check.ok, true);
  const dead = await checkWebsite('https://nowhere.example/', 'Metris Energy', fetcher);
  assertEquals(dead.ok, false);
});

// --------------------------------------------------------------- the score

const REGISTER = { status: 'active', incorporationDate: '2024-03-01', sicCodes: ['62012'], sector: 'software', locality: 'London', postcodeDistrict: 'EC2A', capitalFilings: [], matched: true, note: null };

Deno.test('score: the brief\'s lines add up', () => {
  assert(raiseReadsEarly({ amountText: '£2m', amountGbp: 2000000, round: 'seed', date: null, url: null }));
  assert(raiseReadsEarly({ amountText: '£4m', amountGbp: 4000000, round: null, date: null, url: null }), 'unnamed round in the £1m to £25m band');
  assert(!raiseReadsEarly({ amountText: '£40m', amountGbp: 40000000, round: null, date: null, url: null }));
  assert(!raiseReadsEarly({ amountText: '£40m', amountGbp: 40000000, round: 'Series C', date: null, url: null }));
  const full = scoreProspect({
    website: 'https://metrisenergy.io/',
    register: REGISTER,
    raise: { amountText: '€4.35 million', amountGbp: 3700000, round: null, date: '2026-09-15', url: 'https://n' },
    boards: [{ provider: 'ashby', slug: 'metris', boardUrl: null, count: 7, talentRoles: ['Head of Talent'], titles: ['Head of Talent', 'Engineer'] }],
    talentPostings: [],
  }, TODAY);
  assertEquals(full.score, 45 + 30 + 15 + 10);
  assertEquals(full.reasons.map((r) => r.points), [45, 30, 15, 10]);
  assert(full.reasons[0].text.includes('on the ashby board'), full.reasons[0].text);
  const posting = scoreProspect({ website: 'https://x/', register: null, raise: null, boards: [], talentPostings: [{ title: 'Talent Acquisition Partner', employer: 'Nul', source: 'adzuna', url: '', date: null }] }, TODAY);
  assertEquals(posting.reasons[0].points, 25);
  assert(posting.reasons[0].text.includes('on Adzuna'));
  assert(posting.reasons.some((r) => r.text === 'not matched on the register'));
  const people = scoreProspect({ website: 'https://x/', register: null, raise: null, boards: [], talentPostings: [{ title: 'Head of People', employer: 'Stoa', source: 'reed', url: '', date: null }] }, TODAY);
  assertEquals(people.reasons[0].points, 10);
  const old = scoreProspect({ website: 'https://x/', register: REGISTER, raise: { amountText: '£2m', amountGbp: 2000000, round: 'seed', date: '2026-01-10', url: null }, boards: [], talentPostings: [] }, TODAY);
  assertEquals(old.reasons.find((r) => r.text.startsWith('raised'))?.points, 15, 'six to twelve months');
  const late = scoreProspect({ website: 'https://x/', register: REGISTER, raise: { amountText: '£40m', amountGbp: 40000000, round: 'Series C', date: '2026-09-01', url: null }, boards: [], talentPostings: [] }, TODAY);
  assertEquals(late.reasons.find((r) => r.text.startsWith('raised'))?.points, 5);
  const sh01 = scoreProspect({ website: 'https://x/', register: { ...REGISTER, capitalFilings: [{ date: '2026-07-01', type: 'SH01', description: 'Statement of capital' }] }, raise: null, boards: [], talentPostings: [] }, TODAY);
  assertEquals(sh01.reasons.find((r) => r.points === 20)?.text.includes('2026-07-01'), true);
  const bare = scoreProspect({ website: null, register: { ...REGISTER, status: 'dissolved', incorporationDate: '2015-01-01' }, raise: null, boards: [], talentPostings: [] }, TODAY);
  assertEquals(bare.score, -150);
  const roles = (count: number) => scoreProspect({ website: 'https://x/', register: null, raise: null, boards: [{ provider: 'lever', slug: 's', boardUrl: null, count, talentRoles: [], titles: [] }], talentPostings: [] }, TODAY).reasons.find((r) => r.text.endsWith('open roles'))?.points;
  assertEquals([roles(2), roles(3), roles(6), roles(12)], [undefined, 5, 15, 25]);
});

// ------------------------------------------------------------ the settings

Deno.test('settings: defaults and a stored value', () => {
  assertEquals(settingsFromValue(null), { autoPromoteScore: 60, weeklyPromoteCap: 15, watermarks: {}, registerCursor: 0 });
  assertEquals(settingsFromValue({ autoPromoteScore: '70', weeklyPromoteCap: -1, watermarks: { '62012|London': 300, bad: 'x' }, registerCursor: 5 }), { autoPromoteScore: 70, weeklyPromoteCap: 15, watermarks: { '62012|London': 300 }, registerCursor: 5 });
});

// --------------------------------------------------------------- discovery

function candidate(name: string, source: ProspectCandidate['source']['source'], url: string, extra: Partial<ProspectCandidate> = {}): ProspectCandidate {
  return { name, source: { source, url, title: name, at: '2026-09-20T00:00:00.000Z', note: null }, ...extra };
}

Deno.test('discover: candidates merge by name key, keep the trading name and the newest raise', () => {
  const merged = mergeCandidates([
    candidate('METRIS ENERGY LTD', 'companies_house', 'https://ch/1', { companyNumber: '14567890', register: { status: 'active', matched: false } }),
    candidate('Metris Energy', 'funding_news', 'https://n/1', { raise: { amountText: '£2m', amountGbp: 2000000, round: 'seed', date: '2026-08-01', url: 'https://n/1' } }),
    candidate('Metris Energy', 'funding_news', 'https://n/2', { raise: { amountText: '€4.35m', amountGbp: 3700000, round: null, date: '2026-09-15', url: 'https://n/2' } }),
    candidate('Metris Energy', 'adzuna', 'https://a/1', { talentPosting: { title: 'Head of Talent', employer: 'Metris Energy', source: 'adzuna', url: 'https://a/1', date: '2026-09-18' } }),
    candidate('Metris Energy', 'adzuna', 'https://a/1', { talentPosting: { title: 'Head of Talent', employer: 'Metris Energy', source: 'adzuna', url: 'https://a/1', date: '2026-09-18' } }),
    candidate('Nul Health', 'reed', 'https://r/1'),
    candidate('X', 'reed', 'https://r/2'),
  ]);
  assertEquals(merged.length, 2, 'a one-letter name is dropped');
  const m = merged[0];
  assertEquals(m.nameKey, 'metris energy');
  assertEquals(m.name, 'Metris Energy', 'the trading name over the legal one');
  assertEquals(m.companyNumber, '14567890');
  assertEquals(m.sources.length, 4, 'the repeated posting is one source');
  assertEquals(m.raise?.date, '2026-09-15');
  assertEquals(m.talentPostings.length, 1);
  assertEquals(m.register?.status, 'active');
  const row = rowForInsert(m, TODAY);
  assertEquals(row.status, 'new');
  assertEquals(row.first_seen_at, TODAY.toISOString());
});

Deno.test('discover: tracked companies, recent dismissals and the merge into an existing row', () => {
  const tracked = { nameKeys: new Set(['searchable']), hosts: new Set(['metris.energy']) };
  assert(isTracked(tracked, 'searchable', null));
  assert(isTracked(tracked, 'metris energy', 'https://www.metris.energy/'));
  assert(!isTracked(tracked, 'nul health', 'https://nul.health/'));
  assert(dismissedRecently({ status: 'dismissed', dismissed_at: '2026-06-01T00:00:00Z' }, TODAY));
  assert(!dismissedRecently({ status: 'dismissed', dismissed_at: '2026-01-01T00:00:00Z' }, TODAY), 'older than 180 days');
  assert(!dismissedRecently({ status: 'qualified', dismissed_at: null }, TODAY));
  const base: ExistingProspect = { id: 'p1', name: 'Metris Energy', name_key: 'metris energy', website: null, company_number: null, status: 'qualified', sources: [{ source: 'funding_news', url: 'https://n/1', title: 't', at: null, note: null }], raise: { amountText: '£2m', amountGbp: 2000000, round: 'seed', date: '2026-08-01', url: 'https://n/1' }, register: null, talent_postings: [], dismissed_at: null };
  const [m] = mergeCandidates([candidate('Metris Energy', 'adzuna', 'https://a/1', { talentPosting: { title: 'Head of Talent', employer: 'Metris Energy', source: 'adzuna', url: 'https://a/1', date: '2026-09-18' } })]);
  const out = mergeIntoExisting(base, m, TODAY);
  assert(out.kind === 'update');
  if (out.kind === 'update') {
    assertEquals(out.requalify, true, 'a new posting sends a qualified row back to new');
    assertEquals(out.patch.status, 'new');
    assertEquals((out.patch.sources as unknown[]).length, 2);
    assertEquals((out.patch.talent_postings as unknown[]).length, 1);
    assertEquals(out.patch.raise, undefined, 'the raise is unchanged');
  }
  const same = mergeIntoExisting(base, mergeCandidates([candidate('Metris Energy', 'funding_news', 'https://n/1')])[0], TODAY);
  assert(same.kind === 'update' && same.requalify === false && same.patch.status === undefined, 'the same story again changes nothing but last_seen_at');
  const registerOnly = mergeIntoExisting(base, mergeCandidates([candidate('Metris Energy Ltd', 'companies_house', 'https://ch/1', { companyNumber: '1' })])[0], TODAY);
  assert(registerOnly.kind === 'update' && registerOnly.requalify === false && registerOnly.patch.company_number === '1', 'the register alone is no new signal');
  assertEquals(mergeIntoExisting({ ...base, status: 'dismissed', dismissed_at: '2026-09-01T00:00:00Z' }, m, TODAY), { kind: 'skip', reason: 'dismissed' });
  const reopened = mergeIntoExisting({ ...base, status: 'dismissed', dismissed_at: '2026-01-01T00:00:00Z' }, m, TODAY);
  assert(reopened.kind === 'update' && reopened.patch.status === 'new' && reopened.patch.dismissed_at === null, 'an old dismissal is reopened');
});

Deno.test('discover: the pass writes new rows, updates known ones, skips tracked and dismissed, and saves the walk state', async () => {
  const supabase = fakeSupabase({
    app_settings: [{ key: 'prospecting', value: { autoPromoteScore: 60, weeklyPromoteCap: 15, watermarks: {}, registerCursor: 0 } }],
    company_searches: [{ id: 'c1', company_name: 'Searchable', url: 'https://searchable.ai' }],
    prospects: [
      { id: 'p1', name: 'Nul Health', name_key: 'nul health', website: null, company_number: null, status: 'qualified', sources: [], raise: null, register: null, talent_postings: [], dismissed_at: null },
      { id: 'p2', name: 'Stoa', name_key: 'stoa', website: null, company_number: null, status: 'dismissed', sources: [], raise: null, register: null, talent_postings: [], dismissed_at: '2026-09-10T00:00:00Z' },
    ],
    funding_news: [],
  });
  const r = await discoverProspects(supabase, {
    today: TODAY,
    deps: {
      news: () => Promise.resolve({ feeds: 1, feedsFailed: 0, items: 2, raiseStories: 2, unnamed: 0, rows: 0, candidates: [candidate('Metris Energy', 'funding_news', 'https://n/1', { raise: { amountText: '£2m', amountGbp: 2000000, round: 'seed', date: '2026-09-01', url: 'https://n/1' } }), candidate('Searchable', 'funding_news', 'https://n/2')], errors: [], ms: 1 }),
      register: () => Promise.resolve({ configured: true, calls: 3, failed: 0, found: 1, candidates: [candidate('METRIS ENERGY LTD', 'companies_house', 'https://ch/1', { companyNumber: '14567890' })], watermarks: { '62012|London': 100 }, nextCursor: 3, steps: [], errors: [], ms: 1 }),
      adzuna: () => Promise.resolve({ source: 'adzuna', configured: true, calls: 9, failed: 0, found: 3, candidates: [candidate('Nul Health', 'adzuna', 'https://a/1', { talentPosting: { title: 'Talent Acquisition Partner', employer: 'Nul Health', source: 'adzuna', url: 'https://a/1', date: '2026-09-20' } }), candidate('Stoa', 'adzuna', 'https://a/2')], agency: [], droppedTitles: 0, errors: [], ms: 1 }),
      reed: () => Promise.resolve({ source: 'reed', configured: false, calls: 0, failed: 0, found: 0, candidates: [], agency: [], droppedTitles: 0, errors: ['REED_API_KEY not set'], ms: 1 }),
    },
  });
  assertEquals(r.inserted, 1, 'Metris Energy');
  assertEquals(r.updated, 1, 'Nul Health');
  assertEquals(r.requalified, 1);
  assertEquals(r.skippedTracked, 1, 'Searchable');
  assertEquals(r.skippedDismissed, 1, 'Stoa');
  assertEquals(r.sources.reed.skipped, true);
  assertEquals(r.sources.adzuna.skipped, false);
  assertEquals(r.sources.funding_news.inserted, 1);
  assertEquals(r.sources.companies_house.inserted, 1, 'the same row counts for both of its sources');
  const rows = supabase.rows('prospects');
  assertEquals(rows.length, 3);
  const metris = rows.find((x) => x.name_key === 'metris energy')!;
  assertEquals(metris.company_number, '14567890');
  assertEquals(metris.status, 'new');
  assertEquals(rows.find((x) => x.id === 'p1')!.status, 'new');
  assertEquals(rows.find((x) => x.id === 'p2')!.status, 'dismissed');
  assertEquals(supabase.rows('app_settings')[0].value.watermarks, { '62012|London': 100 });
  assertEquals(supabase.rows('app_settings')[0].value.registerCursor, 3);
  const dry = await discoverProspects(supabase, { today: TODAY, dryRun: true, sources: ['adzuna'], deps: { adzuna: () => Promise.resolve({ source: 'adzuna', configured: true, calls: 1, failed: 0, found: 1, candidates: [candidate('Crimson', 'adzuna', 'https://a/9')], agency: [], droppedTitles: 0, errors: [], ms: 1 }) } });
  assertEquals(dry.inserted, 1);
  assertEquals(dry.sample.length, 1);
  assertEquals(dry.sources.funding_news.skipped, true, 'not asked');
  assertEquals(supabase.rows('prospects').length, 3, 'a dry run writes nothing');
});

// ----------------------------------------------------------- qualification

Deno.test('qualify: the register hit to accept', () => {
  const hits: CompanySearchHit[] = [
    { companyNumber: '1', name: 'METRIS ENERGY SOLAR TRADING LIMITED', status: 'active', incorporationDate: null, addressSnippet: null, postcode: null },
    { companyNumber: '2', name: 'METRIS ENERGY LTD', status: 'dissolved', incorporationDate: null, addressSnippet: null, postcode: null },
    { companyNumber: '3', name: 'METRIS ENERGY UK LTD', status: 'active', incorporationDate: null, addressSnippet: null, postcode: null },
  ];
  assertEquals(acceptRegisterHit(hits, 'Metris Energy')?.companyNumber, '3', 'one token to spare, active');
  assertEquals(acceptRegisterHit([hits[0]], 'Metris Energy'), null, 'two tokens to spare');
  assertEquals(acceptRegisterHit([{ ...hits[0], name: 'METRIS ENERGY HOLDINGS GROUP LIMITED' }], 'Metris Energy')?.companyNumber, '1', 'holdings and group are generic words');
  assertEquals(acceptRegisterHit([{ ...hits[1], status: 'active' }, hits[2]], 'Metris Energy')?.companyNumber, '2', 'an exact name first');
  assertEquals(acceptRegisterHit([], 'Metris Energy'), null);
});

function record(over: Partial<CompanyRecord> = {}): CompanyRecord {
  return {
    companyNumber: '14567890', name: 'METRIS ENERGY LTD', previousNames: [], status: 'active', incorporationDate: '2024-03-01', sicCodes: ['62012'],
    registeredOffice: { line1: '12 Example Street', locality: 'London', region: null, postcode: 'EC2A 4NE', country: 'England' }, postcodeDistrict: 'EC2A',
    accountsType: null, lastAccountsMadeUpTo: null, lastConfirmationStatement: null, fetchedAt: TODAY.toISOString(), verified: true, note: null, ...over,
  } as CompanyRecord;
}

function fakeDeps(over: Partial<QualifyDeps> = {}, pages: Record<string, string> = {}): QualifyDeps {
  return {
    searchCompanies: () => Promise.resolve([{ companyNumber: '14567890', name: 'METRIS ENERGY LTD', status: 'active', incorporationDate: '2024-03-01', addressSnippet: null, postcode: null }]),
    fetchCompanyProfile: () => Promise.resolve(record()),
    fetchCapitalFilings: () => Promise.resolve([{ transactionId: null, date: '2026-07-01', type: 'SH01', category: 'capital', description: 'Statement of capital following an allotment of shares' } as CapitalFiling]),
    fetchPage: (url) => Promise.resolve<FetchedPage>(pages[url] !== undefined ? { url, finalUrl: url, status: 200, ok: true, html: pages[url], ms: 1 } : { url, finalUrl: url, status: 0, ok: false, html: '', error: 'no answer', ms: 1 }),
    confirmBoard: (b: AtsBoard) => Promise.resolve(b.provider === 'ashby' && b.slug === 'metrisenergy' ? { ok: true, count: 7, note: '7 roles', nameMatch: null } : { ok: false, count: 0, note: 'HTTP 404', nameMatch: null }),
    readBoard: () => Promise.resolve({ ok: true, titles: ['Head of Talent', 'Software Engineer', 'Account Executive'] }),
    trackedHosts: new Set(),
    ...over,
  };
}

const prospect = (over: Partial<ProspectRow> = {}): ProspectRow => ({
  id: 'p1', name: 'Metris Energy', name_key: 'metris energy', website: null, company_number: null, status: 'new', sources: [], raise: null, register: null, boards: [], talent_postings: [],
  prospect_score: null, score_reasons: [], first_seen_at: TODAY.toISOString(), last_seen_at: TODAY.toISOString(), qualified_at: null, promoted_at: null, dismissed_at: null, promoted_company_id: null, dismiss_reason: null, ...over,
});

Deno.test('qualify: register, guessed website, guessed board and the score', async () => {
  const home = '<html><title>Metris Energy</title><body><a href="/careers">Careers</a></body></html>';
  const deps = fakeDeps({}, { 'https://metrisenergy.com/': home, 'https://metrisenergy.com/careers': '<html><title>Careers</title><body>Open roles</body></html>' });
  const out = await qualifyProspect(prospect({ raise: { amountText: '£2m', amountGbp: 2000000, round: 'seed', date: '2026-09-01', url: 'https://n/1' } }), deps, TODAY);
  assertEquals(out.status, 'qualified');
  assertEquals(out.website, 'https://metrisenergy.com/');
  assertEquals(out.patch.company_number, '14567890');
  assertEquals((out.patch.register as { matched: boolean }).matched, true);
  assertEquals(out.boards.length, 1);
  assertEquals(out.boards[0].slug, 'metrisenergy');
  assertEquals(out.boards[0].talentRoles, ['Head of Talent']);
  assertEquals(out.boards[0].count, 7);
  // +45 lead role, +30 seed within six months, +15 for 7 roles, +10 young.
  assertEquals(out.score, 100);
  assert(out.notes.some((n) => n.startsWith('register: matched')), out.notes.join(' | '));
  assert(out.notes.some((n) => n.includes('guessed from the name')), out.notes.join(' | '));
});

Deno.test('qualify: a dissolved company is unsuitable and its website is not guessed', async () => {
  let fetched = 0;
  const deps = fakeDeps({ fetchCompanyProfile: () => Promise.resolve(record({ status: 'dissolved' })), fetchPage: (url) => { fetched++; return Promise.resolve({ url, finalUrl: url, status: 0, ok: false, html: '', ms: 1 }); } });
  const out = await qualifyProspect(prospect(), deps, TODAY);
  assertEquals(out.status, 'unsuitable');
  assertEquals(fetched, 0);
  assertEquals(out.note, 'dissolved on the register');
});

Deno.test('qualify: no register match, no website: qualified with the penalties and the note', async () => {
  const deps = fakeDeps({ searchCompanies: () => Promise.resolve([]) });
  const out = await qualifyProspect(prospect({ talent_postings: [{ title: 'Head of Talent', employer: 'Metris Energy', source: 'reed', url: 'https://r/1', date: '2026-09-19' }] }), deps, TODAY);
  assertEquals(out.status, 'qualified');
  assertEquals(out.website, null);
  assertEquals(out.score, 45 - 30);
  assert(out.note.includes('website not found'));
  assert(out.reasons.some((r) => r.text === 'not matched on the register'));
});

Deno.test('qualify: an Adzuna posting that lands on the employer gives the website; a tracked host is dismissed', async () => {
  const landing = 'https://www.metris.energy/careers/head-of-talent';
  const deps = fakeDeps({
    fetchPage: (url) => Promise.resolve<FetchedPage>(url.startsWith('https://www.adzuna.co.uk/') ? { url, finalUrl: landing, status: 200, ok: true, html: '<title>Head of Talent at Metris Energy</title>', ms: 1 } : { url, finalUrl: url, status: 0, ok: false, html: '', ms: 1 }),
    confirmBoard: () => Promise.resolve({ ok: false, count: 0, note: 'HTTP 404' }),
  });
  const posting = { title: 'Head of Talent', employer: 'Metris Energy', source: 'adzuna' as const, url: 'https://www.adzuna.co.uk/land/ad/1', date: '2026-09-18' };
  const out = await qualifyProspect(prospect({ talent_postings: [posting] }), deps, TODAY);
  assertEquals(out.website, 'https://www.metris.energy/');
  assertEquals(out.status, 'qualified');
  const tracked = await qualifyProspect(prospect({ talent_postings: [posting] }), { ...deps, trackedHosts: new Set(['metris.energy']) }, TODAY);
  assertEquals(tracked.status, 'dismissed');
  assertEquals(tracked.patch.dismiss_reason, 'already tracked');
});

Deno.test('qualify: a known website is kept and its board read from the careers page', async () => {
  const home = '<html><title>Nul Health</title><body><a href="https://nul.health/jobs">Jobs</a></body></html>';
  const jobs = '<html><title>Jobs</title><body><a href="https://jobs.lever.co/nulhealth">Apply</a></body></html>';
  const deps = fakeDeps({
    searchCompanies: () => Promise.resolve([]),
    confirmBoard: (b: AtsBoard) => Promise.resolve(b.provider === 'lever' && b.slug === 'nulhealth' ? { ok: true, count: 3, note: '3 roles', nameMatch: true } : { ok: false, count: 0, note: 'HTTP 404' }),
    readBoard: () => Promise.resolve({ ok: true, titles: ['Talent Acquisition Partner', 'Nurse', 'Engineer'] }),
  }, { 'https://nul.health/': home, 'https://nul.health/jobs': jobs });
  const out = await qualifyProspect(prospect({ name: 'Nul Health', name_key: 'nul health', website: 'https://nul.health/about' }), deps, TODAY);
  assertEquals(out.website, 'https://nul.health/');
  assertEquals(out.boards.map((b) => `${b.provider}:${b.slug}`), ['lever:nulhealth']);
  assertEquals(out.score, 25 + 5);
});

// -------------------------------------------------------------- promotion

Deno.test('promote: the rule', () => {
  const base = { score: 70, threshold: 60, website: 'https://x/', promotedThisWeek: 3, cap: 15, tracked: false, dismissedRecently: false };
  assertEquals(promotionDecision(base).promote, true);
  assertEquals(promotionDecision({ ...base, website: null }), { promote: false, reason: 'no website known' });
  assertEquals(promotionDecision({ ...base, tracked: true }).reason, 'already tracked');
  assertEquals(promotionDecision({ ...base, defunct: true }).reason, 'not active on the register');
  assertEquals(promotionDecision({ ...base, score: 59 }).reason, 'score 59 is under the threshold of 60');
  assertEquals(promotionDecision({ ...base, promotedThisWeek: 15 }).reason, 'the weekly cap of 15 is reached');
  assertEquals(promotionDecision({ ...base, dismissedRecently: true }).reason, 'dismissed recently');
  assertEquals(promotionDecision({ ...base, score: 10, promotedThisWeek: 20, dismissedRecently: true, forced: true }), { promote: true, reason: 'added by hand' });
  assertEquals(promotionDecision({ ...base, website: null, forced: true }).promote, false, 'never without a website');
});

Deno.test('promote: the writes', async () => {
  const supabase = fakeSupabase({ company_searches: [], company_consultants: [], ats_boards: [], prospects: [{ id: 'p1', status: 'qualified' }] });
  const done = await promoteProspect(supabase, {
    prospectId: 'p1', name: 'Metris Energy', website: 'https://metrisenergy.com/', companyNumber: '14567890',
    boards: [{ provider: 'ashby', slug: 'metrisenergy', boardUrl: 'https://jobs.ashbyhq.com/metrisenergy', count: 7, talentRoles: [], titles: [], note: '7 roles' }, { provider: 'ashby', slug: 'metris', boardUrl: null, count: 1, talentRoles: [], titles: [] }],
    consultantId: 'k1', supabaseUrl: 'https://proj.supabase.co', today: TODAY,
  });
  assertEquals(done.queued, 1);
  const company = supabase.rows('company_searches')[0];
  assertEquals(company.company_name, 'Metris Energy');
  assertEquals(company.url, 'https://metrisenergy.com/');
  assertEquals(done.companyId, company.id);
  const { id: _id, ...assignment } = supabase.rows('company_consultants')[0];
  assertEquals(assignment, { company_search_id: company.id, consultant_id: 'k1' });
  assertEquals(supabase.rows('ats_boards').length, 1, 'one board per provider');
  assertEquals(supabase.rows('ats_boards')[0].slug, 'metrisenergy');
  assertEquals(supabase.rpcCalls[0].fn, 'enqueue_analyze_company_batch');
  assertEquals(supabase.rpcCalls[0].args.payloads[0].isRefresh, true);
  assertEquals(supabase.rpcCalls[0].args.target_url, 'https://proj.supabase.co/functions/v1/analyze-company');
  assertEquals(supabase.rows('prospects')[0].status, 'promoted');
  assertEquals(supabase.rows('prospects')[0].promoted_company_id, company.id);
});

// ---------------------------------------------------------------- the run

Deno.test('run: the queue order and the website input', () => {
  const rows = [
    { id: 'a', talent_postings: [], raise: null, last_seen_at: '2026-09-21T00:00:00Z', first_seen_at: '' },
    { id: 'b', talent_postings: [], raise: { amountText: null, amountGbp: null, round: null, date: null, url: null }, last_seen_at: '2026-09-19T00:00:00Z', first_seen_at: '' },
    { id: 'c', talent_postings: [{ title: 'Head of Talent', employer: '', source: 'reed' as const, url: '', date: null }], raise: null, last_seen_at: '2026-09-01T00:00:00Z', first_seen_at: '' },
    { id: 'd', talent_postings: [], raise: null, last_seen_at: '2026-09-22T00:00:00Z', first_seen_at: '' },
  ];
  assertEquals(orderForQualification(rows).map((r) => r.id), ['c', 'b', 'd', 'a']);
  assertEquals(normaliseWebsiteInput('metris.energy'), 'https://metris.energy/');
  assertEquals(normaliseWebsiteInput(' www.Metris.energy/about '), 'https://www.metris.energy/');
  assertEquals(normaliseWebsiteInput('http://metris.energy'), 'http://metris.energy/');
  assertEquals(normaliseWebsiteInput('metris'), null);
  assertEquals(normaliseWebsiteInput(''), null);
});

Deno.test('run: the nightly pass qualifies the new rows, promotes over the threshold under the cap, and a dry run writes nothing', async () => {
  const home = '<html><title>Metris Energy</title><body>hello</body></html>';
  const seed = () => fakeSupabase({
    app_settings: [{ key: 'prospecting', value: { autoPromoteScore: 60, weeklyPromoteCap: 15 } }],
    company_searches: [], company_consultants: [], ats_boards: [],
    consultants: [{ id: 'k1', name: 'Craig', active: true }],
    prospects: [
      prospect({ id: 'p1', raise: { amountText: '£2m', amountGbp: 2000000, round: 'seed', date: '2026-09-01', url: 'https://n/1' } }),
      prospect({ id: 'p2', name: 'Nul Health', name_key: 'nul health', last_seen_at: '2026-09-20T00:00:00Z' }),
      prospect({ id: 'p3', name: 'Done Ltd', name_key: 'done', status: 'qualified' }),
    ],
  });
  const deps = () => fakeDeps({ searchCompanies: (q) => Promise.resolve(q === 'Metris Energy' ? [{ companyNumber: '14567890', name: 'METRIS ENERGY LTD', status: 'active', incorporationDate: '2024-03-01', addressSnippet: null, postcode: null }] : []) }, { 'https://metrisenergy.com/': home });
  const supabase = seed();
  const r = await qualifyProspects(supabase, { today: TODAY, supabaseUrl: 'https://proj.supabase.co', deps });
  assertEquals(r.checked, 2, 'the qualified row is not in the nightly queue');
  assertEquals(r.promoted, 1);
  assertEquals(r.qualified, 1);
  assertEquals(r.consultant, 'Craig');
  const metris = r.results.find((x) => x.prospectId === 'p1')!;
  assertEquals(metris.status, 'promoted');
  assert(metris.promotedCompanyId, 'has a company id');
  assertEquals(supabase.rows('prospects').find((x) => x.id === 'p1')!.status, 'promoted');
  const nul = r.results.find((x) => x.prospectId === 'p2')!;
  assertEquals(nul.status, 'qualified');
  assert(nul.note!.includes('not added: no website known'), nul.note!);
  assertEquals(supabase.rows('prospects').find((x) => x.id === 'p2')!.status, 'qualified');
  assertEquals(supabase.rows('prospects').find((x) => x.id === 'p2')!.prospect_score, -50);

  const dry = seed();
  const d = await qualifyProspects(dry, { today: TODAY, supabaseUrl: 'https://x', deps, dryRun: true });
  assertEquals(d.promoted, 0);
  assertEquals(d.candidatesPromotable, 1);
  assert(d.results.find((x) => x.prospectId === 'p1')!.note!.includes('would be added'));
  assertEquals(dry.rows('prospects').find((x) => x.id === 'p1')!.status, 'new');
  assertEquals(dry.rows('company_searches').length, 0);

  const capped = seed();
  capped.rows('app_settings')[0].value = { autoPromoteScore: 60, weeklyPromoteCap: 0 };
  const c = await qualifyProspects(capped, { today: TODAY, supabaseUrl: 'https://x', deps });
  assertEquals(c.promoted, 0);
  assert(c.results.find((x) => x.prospectId === 'p1')!.note!.includes('weekly cap of 0'));
});

Deno.test('run: the page adds one prospect by id under the threshold, sets a website, and refuses a promoted one', async () => {
  const supabase = fakeSupabase({
    app_settings: [{ key: 'prospecting', value: { autoPromoteScore: 90, weeklyPromoteCap: 0 } }],
    company_searches: [], company_consultants: [], ats_boards: [],
    consultants: [{ id: 'k1', name: 'Craig', active: true }],
    prospects: [
      prospect({ id: 'p2', name: 'Nul Health', name_key: 'nul health', status: 'qualified' }),
      prospect({ id: 'p9', name: 'Gone', name_key: 'gone', status: 'promoted', promoted_company_id: 'c9' }),
    ],
  });
  const deps = () => fakeDeps({ searchCompanies: () => Promise.resolve([]), confirmBoard: () => Promise.resolve({ ok: false, count: 0, note: 'HTTP 404' }) }, { 'https://nul.health/': '<title>Nul Health</title>' });
  const saved = await qualifyProspects(supabase, { today: TODAY, supabaseUrl: 'https://x', deps, prospectIds: ['p2'], website: 'nul.health', promote: false });
  assertEquals(saved.checked, 1);
  assertEquals(saved.promoted, 0);
  assertEquals(supabase.rows('prospects').find((x) => x.id === 'p2')!.website, 'https://nul.health/');
  assertEquals(saved.results[0].status, 'qualified');
  const added = await qualifyProspects(supabase, { today: TODAY, supabaseUrl: 'https://x', deps, prospectIds: ['p2', 'p9'], promote: true });
  assertEquals(added.promoted, 1, 'under the threshold and over the cap, by hand');
  assertEquals(added.results[0].status, 'promoted');
  assert(added.errors.some((e) => e.includes('Gone is already promoted')), added.errors.join(' | '));
  let refused = '';
  try { await qualifyProspects(supabase, { today: TODAY, supabaseUrl: 'https://x', deps, prospectIds: ['p2'], website: 'nonsense' }); } catch (e) { refused = (e as Error).message; }
  assert(refused.includes('is not a website'), refused);
});

// ------------------------------------------------- an in-memory supabase

type Row = Record<string, any>;

/** The slice of the client the prospecting modules use: from().select/insert/update/upsert with eq, in, is, gte, order, limit, maybeSingle, count; and rpc. */
function fakeSupabase(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const rpcCalls: Array<{ fn: string; args: Row }> = [];
  let nextId = 1;
  const api = {
    rows: (name: string) => (tables[name] ||= []),
    rpcCalls,
    rpc(fn: string, args: Row) { rpcCalls.push({ fn, args }); return Promise.resolve({ data: 1, error: null }); },
    from(name: string) {
      const table = (tables[name] ||= []);
      const filters: Array<(r: Row) => boolean> = [];
      let op: { kind: 'select' } | { kind: 'update'; patch: Row } | { kind: 'insert'; rows: Row[] } | { kind: 'upsert'; rows: Row[]; onConflict: string[]; ignore: boolean } = { kind: 'select' };
      let head = false;
      let single = false;
      let limitN: number | null = null;
      let orderBy: { col: string; asc: boolean } | null = null;
      const b: any = {
        select(_cols?: string, opts?: { count?: string; head?: boolean }) { head = !!opts?.head; return b; },
        eq(col: string, v: any) { filters.push((r) => r[col] === v); return b; },
        in(col: string, vs: any[]) { filters.push((r) => vs.includes(r[col])); return b; },
        is(col: string, v: any) { filters.push((r) => (r[col] ?? null) === v); return b; },
        gte(col: string, v: any) { filters.push((r) => r[col] !== null && r[col] !== undefined && String(r[col]) >= String(v)); return b; },
        order(col: string, o?: { ascending?: boolean }) { orderBy = { col, asc: o?.ascending !== false }; return b; },
        limit(n: number) { limitN = n; return b; },
        maybeSingle() { single = true; return b; },
        insert(rows: Row | Row[]) { op = { kind: 'insert', rows: Array.isArray(rows) ? rows : [rows] }; return b; },
        update(patch: Row) { op = { kind: 'update', patch }; return b; },
        upsert(rows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) { op = { kind: 'upsert', rows: Array.isArray(rows) ? rows : [rows], onConflict: (opts?.onConflict || 'id').split(',').map((s) => s.trim()), ignore: !!opts?.ignoreDuplicates }; return b; },
        then(resolve: (v: any) => void) {
          const matching = () => {
            let out = table.filter((r) => filters.every((f) => f(r)));
            if (orderBy) { const { col, asc } = orderBy; out = [...out].sort((x, y) => (String(x[col] ?? '') < String(y[col] ?? '') ? -1 : 1) * (asc ? 1 : -1)); }
            if (limitN !== null) out = out.slice(0, limitN);
            return out;
          };
          if (op.kind === 'select') {
            const rows = matching();
            if (head) return resolve({ data: null, count: rows.length, error: null });
            return resolve({ data: single ? (rows[0] ? { ...rows[0] } : null) : rows.map((r) => ({ ...r })), count: rows.length, error: null });
          }
          if (op.kind === 'update') { for (const r of matching()) Object.assign(r, op.patch); return resolve({ data: null, error: null }); }
          if (op.kind === 'insert') {
            const made = op.rows.map((r) => ({ id: `${name}-${nextId++}`, ...r }));
            table.push(...made);
            return resolve({ data: single ? made[0] : made, error: null });
          }
          for (const incoming of op.rows) {
            const hit = table.find((r) => op.kind === 'upsert' && op.onConflict.every((c) => r[c] === incoming[c]));
            if (hit) { if (!op.ignore) Object.assign(hit, incoming); }
            else table.push({ id: `${name}-${nextId++}`, ...incoming });
          }
          return resolve({ data: null, error: null });
        },
      };
      return b;
    },
  };
  return api;
}
