import { assert, assertEquals } from './test-assert.ts';
import {
  advancedSearchCompanies,
  advancedSearchQuery,
  configureCompaniesHouse,
  companiesHouseConfigured,
  fetchCapitalFilings,
  fetchCompanyProfile,
  fetchOfficers,
  formatLongDateUk,
  isDefunctStatus,
  normaliseCompanyNumber,
  NOTE_KEY_NOT_SET,
  NOTE_NOT_ON_REGISTER,
  officerDisplayName,
  parseAdvancedSearchResults,
  parseCapitalFilings,
  parseCompanyProfile,
  parseOfficers,
  parseSearchResults,
  postcodeDistrict,
  recordToRow,
  renderFilingDescription,
  resolveCompanyRecord,
  rowToRecord,
  searchCompanies,
  sectorFromSic,
  syncRegisterDetails,
} from './companies-house.ts';

const FIXTURES = new URL('./fixtures/companies-house/', import.meta.url);
const fixture = (name: string) => JSON.parse(Deno.readTextFileSync(new URL(name, FIXTURES)));

// ---------------------------------------------------------------------------
// A fake fetch that answers from the fixtures and records every request.

interface FakeHttp {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  requests: Array<{ url: string; auth: string | null }>;
  fail: (matcher: RegExp, status: number, times?: number) => void;
}

function fakeHttp(): FakeHttp {
  const requests: FakeHttp['requests'] = [];
  const failures: Array<{ matcher: RegExp; status: number; left: number }> = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  return {
    requests,
    fail(matcher, status, times = Infinity) { failures.push({ matcher, status, left: times }); },
    async fetch(url, init) {
      requests.push({ url, auth: new Headers(init?.headers).get('Authorization') });
      const f = failures.find((x) => x.matcher.test(url) && x.left > 0);
      if (f) { f.left--; return new Response('', { status: f.status }); }
      const path = url.replace('https://api.company-information.service.gov.uk', '');
      if (path.startsWith('/search/companies')) return json(fixture('search.json'));
      if (path.startsWith('/advanced-search/companies')) return json(fixture('advanced-search.json'));
      if (/^\/company\/12345678\/officers/.test(path)) return json(fixture('officers.json'));
      if (/^\/company\/12345678\/filing-history/.test(path)) return json(fixture('filing-history-capital.json'));
      if (path === '/company/12345678') return json(fixture('profile.json'));
      return json({ errors: [{ error: 'company-profile-not-found' }] }, 404);
    },
  };
}

function withHttp(apiKey: string | null = 'test-key'): FakeHttp {
  const http = fakeHttp();
  configureCompaniesHouse({ fetch: http.fetch, apiKey, retryWaitMs: 1 });
  return http;
}

function reset() {
  configureCompaniesHouse({ fetch: null, apiKey: undefined, retryWaitMs: 1 });
}

// ---------------------------------------------------------------------------
// A tiny in-memory supabase: from().select().eq().maybeSingle(), upsert with onConflict.

type Row = Record<string, any>;

function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const writes: Array<{ table: string; rows: Row[] }> = [];
  let nextId = 1;
  return {
    tables,
    writes,
    rows: (name: string) => tables[name] || [],
    from(name: string) {
      if (!tables[name]) tables[name] = [];
      const table = tables[name];
      const filters: Array<(r: Row) => boolean> = [];
      let pending: { rows: Row[]; conflict: string[] } | null = null;
      const matching = () => table.filter((r) => filters.every((f) => f(r)));
      const builder: any = {
        select() { return builder; },
        eq(col: string, val: any) { filters.push((r) => r[col] === val); return builder; },
        upsert(rows: Row | Row[], options?: { onConflict?: string }) {
          pending = { rows: Array.isArray(rows) ? rows : [rows], conflict: (options?.onConflict || 'id').split(',').map((c) => c.trim()) };
          return builder;
        },
        maybeSingle() { return Promise.resolve({ data: matching().map((r) => ({ ...r }))[0] ?? null, error: null }); },
        then(resolve: (v: any) => void) {
          if (!pending) return resolve({ data: matching().map((r) => ({ ...r })), error: null });
          writes.push({ table: name, rows: pending.rows });
          for (const incoming of pending.rows) {
            const hit = table.find((r) => pending!.conflict.every((c) => (r[c] ?? null) === (incoming[c] ?? null)));
            if (hit) Object.assign(hit, incoming);
            else table.push({ id: `new-${nextId++}`, ...incoming });
          }
          return resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
}

const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

// ---------------------------------------------------------------------------
// Pure helpers.

Deno.test('normaliseCompanyNumber pads numeric numbers and upper-cases prefixes', () => {
  assertEquals(normaliseCompanyNumber('1234567'), '01234567');
  assertEquals(normaliseCompanyNumber('12345678'), '12345678');
  assertEquals(normaliseCompanyNumber(' 123 '), '00000123');
  assertEquals(normaliseCompanyNumber('sc123456'), 'SC123456');
  assertEquals(normaliseCompanyNumber('SC 123456'), 'SC123456');
  assertEquals(normaliseCompanyNumber('ni12345'), 'NI012345');
  assertEquals(normaliseCompanyNumber('oc112233'), 'OC112233');
  assertEquals(normaliseCompanyNumber(''), null);
  assertEquals(normaliseCompanyNumber(null), null);
  assertEquals(normaliseCompanyNumber(undefined), null);
  assertEquals(normaliseCompanyNumber('abc'), null);
  assertEquals(normaliseCompanyNumber('123456789'), null);
  assertEquals(normaliseCompanyNumber('SC1234567'), null);
});

Deno.test('postcodeDistrict takes the outward part', () => {
  assertEquals(postcodeDistrict('EC2A 4NE'), 'EC2A');
  assertEquals(postcodeDistrict('sw1a1aa'), 'SW1A');
  assertEquals(postcodeDistrict('M1 1AE'), 'M1');
  assertEquals(postcodeDistrict('EH1 1AA'), 'EH1');
  assertEquals(postcodeDistrict('W1'), 'W1');
  assertEquals(postcodeDistrict(''), null);
  assertEquals(postcodeDistrict(null), null);
  assertEquals(postcodeDistrict('nonsense'), null);
});

Deno.test('sectorFromSic maps the leading SIC groups and classes', () => {
  assertEquals(sectorFromSic(['62012', '62020']), 'Software');
  assertEquals(sectorFromSic(['58290']), 'Software');
  assertEquals(sectorFromSic(['63120']), 'Data and platforms');
  assertEquals(sectorFromSic(['64999']), 'Financial services');
  assertEquals(sectorFromSic(['66190']), 'Financial services');
  assertEquals(sectorFromSic(['72190']), 'Research and development');
  assertEquals(sectorFromSic(['72110']), 'Biotech');
  assertEquals(sectorFromSic(['21200']), 'Biotech');
  assertEquals(sectorFromSic(['86900']), 'Health');
  assertEquals(sectorFromSic(['70229']), 'Consultancy');
  assertEquals(sectorFromSic(['70100']), null);
  assertEquals(sectorFromSic(['47910']), 'Online retail');
  assertEquals(sectorFromSic(['47110']), null);
  assertEquals(sectorFromSic(['73110']), 'Marketing');
  assertEquals(sectorFromSic(['82990']), 'Business services');
  assertEquals(sectorFromSic(['85590']), 'Education');
  assertEquals(sectorFromSic(['35110']), 'Energy');
  assertEquals(sectorFromSic(['71129']), 'Engineering');
  assertEquals(sectorFromSic(['74100']), 'Design and professional services');
  assertEquals(sectorFromSic(['99999', '62012']), 'Software', 'an unknown first code does not hide the second');
  assertEquals(sectorFromSic(['99999']), null);
  assertEquals(sectorFromSic([]), null);
});

Deno.test('officerDisplayName flips "SURNAME, Forenames" and keeps a title', () => {
  assertEquals(officerDisplayName('SMITH, John Andrew'), 'John Andrew Smith');
  assertEquals(officerDisplayName('SMITH, Dr John'), 'Dr John Smith');
  assertEquals(officerDisplayName('BRANSON, Richard Charles Nicholas, Sir'), 'Sir Richard Charles Nicholas Branson');
  assertEquals(officerDisplayName("O'BRIEN-JONES, Siobhan, Ms"), "Ms Siobhan O'Brien-Jones");
  assertEquals(officerDisplayName('MCDONALD, Ewan'), 'Ewan McDonald');
  assertEquals(officerDisplayName('DE LA CRUZ, Maria'), 'Maria De la Cruz');
  assertEquals(officerDisplayName('ACME SECRETARIES LIMITED'), 'ACME SECRETARIES LIMITED');
  assertEquals(officerDisplayName('  PATEL ,  Priya  '), 'Priya Patel');
  assertEquals(officerDisplayName(''), '');
});

Deno.test('formatLongDateUk writes the day, month and year', () => {
  assertEquals(formatLongDateUk('2026-05-12'), '12 May 2026');
  assertEquals(formatLongDateUk('2021-03-01'), '1 March 2021');
  assertEquals(formatLongDateUk('not a date'), 'not a date');
  assertEquals(formatLongDateUk(null), '');
});

Deno.test('renderFilingDescription turns the enumeration key into plain words', () => {
  assertEquals(
    renderFilingDescription({ description: 'capital-allotment-shares', description_values: { date: '2026-05-12', capital: [{ figure: '1,234', currency: 'GBP' }] }, type: 'SH01' }),
    'Shares allotted on 12 May 2026, capital £1,234',
  );
  assertEquals(
    renderFilingDescription({ description: 'capital-allotment-shares', description_values: { date: '2026-05-12', capital: [{ figure: '1000000', currency: 'GBP' }, { figure: '250.5', currency: 'USD' }] } }),
    'Shares allotted on 12 May 2026, capital £1,000,000, $250.5',
  );
  assertEquals(renderFilingDescription({ description: 'capital-cancellation-shares', description_values: { date: '2023-01-10', capital: [{ figure: '100', currency: 'SEK' }] } }), 'Shares cancelled on 10 January 2023, capital 100 SEK');
  assertEquals(renderFilingDescription({ description: 'capital-reduction-shares', description_values: {} }), 'Share capital reduced');
  assertEquals(renderFilingDescription({ description: 'capital-something-new', description_values: { date: '2026-01-02' } }), 'Something new on 2 January 2026', 'an unknown key still reads as words');
  assertEquals(renderFilingDescription({ description: 'legacy', description_values: { description: 'Return of allotment of shares' }, type: '88(2)' }), 'Return of allotment of shares');
  assertEquals(renderFilingDescription({ description: '', description_values: {}, type: 'SH19' }), 'Filing SH19');
});

Deno.test('isDefunctStatus marks the statuses that stop a refresh', () => {
  assert(isDefunctStatus('dissolved'));
  assert(isDefunctStatus('liquidation'));
  assert(isDefunctStatus('administration'));
  assert(!isDefunctStatus('active'));
  assert(!isDefunctStatus(null));
});

// ---------------------------------------------------------------------------
// Parsers over the fixtures.

Deno.test('parseCompanyProfile reads the profile fixture', () => {
  const r = parseCompanyProfile(fixture('profile.json'), '12345678', '2026-09-21T10:00:00.000Z');
  assertEquals(r, {
    companyNumber: '12345678',
    name: 'FABLE LABS LIMITED',
    previousNames: ['STORYFORGE SOFTWARE LTD'],
    status: 'active',
    incorporationDate: '2021-03-15',
    sicCodes: ['62012', '62020'],
    registeredOffice: { line1: 'Unit 4, 12 Example Street', locality: 'London', region: 'Greater London', postcode: 'EC2A 4NE', country: 'United Kingdom' },
    postcodeDistrict: 'EC2A',
    accountsType: 'micro-entity',
    lastAccountsMadeUpTo: '2025-03-31',
    lastConfirmationStatement: '2026-03-14',
    fetchedAt: '2026-09-21T10:00:00.000Z',
    verified: true,
    note: null,
  });
  assertEquals(sectorFromSic(r.sicCodes), 'Software');
});

Deno.test('parseCompanyProfile copes with a sparse profile', () => {
  const r = parseCompanyProfile({ company_name: 'BARE LTD', company_number: '1', company_status: 'dissolved' }, '00000001', 'now');
  assertEquals(r.companyNumber, '00000001');
  assertEquals(r.previousNames, []);
  assertEquals(r.sicCodes, []);
  assertEquals(r.registeredOffice, null);
  assertEquals(r.postcodeDistrict, null);
  assertEquals(r.accountsType, null);
  assertEquals(r.status, 'dissolved');
  assert(r.verified);
});

Deno.test('parseSearchResults reads the search fixture', () => {
  const hits = parseSearchResults(fixture('search.json'));
  assertEquals(hits, [
    { companyNumber: '12345678', name: 'FABLE LABS LIMITED', status: 'active', incorporationDate: '2021-03-15', addressSnippet: 'Unit 4, 12 Example Street, London, EC2A 4NE', postcode: 'EC2A 4NE' },
    { companyNumber: 'SC654321', name: 'FABLE LABS (SCOTLAND) LIMITED', status: 'dissolved', incorporationDate: '2015-06-01', addressSnippet: '1 Example Road, Edinburgh, EH1 1AA', postcode: 'EH1 1AA' },
    { companyNumber: 'OC112233', name: 'FABLE LABS PARTNERS LLP', status: 'active', incorporationDate: null, addressSnippet: null, postcode: null },
  ]);
  assertEquals(parseSearchResults(fixture('search.json'), 1).length, 1);
  assertEquals(parseSearchResults({}), []);
  assertEquals(parseSearchResults({ items: [{ title: 'NO NUMBER' }, { company_number: 'abc', title: 'BAD NUMBER' }] }), []);
});

Deno.test('parseOfficers reads the officers fixture, newest appointment first', () => {
  const officers = parseOfficers(fixture('officers.json'));
  assertEquals(officers.map((o) => o.name), ['Priya Anjali Patel', 'Dr John Andrew Smith', 'ACME SECRETARIES LIMITED', "Ms Siobhan O'Brien-Jones"]);
  assertEquals(officers[0], { officerId: 'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8', name: 'Priya Anjali Patel', role: 'director', appointedOn: '2026-07-01', resignedOn: null });
  assertEquals(officers[2].role, 'corporate-secretary');
  assertEquals(officers[3].resignedOn, '2024-02-29');
  const undated = parseOfficers({ items: [{ name: 'LATE, Ann', officer_role: 'director' }, { name: 'EARLY, Bob', officer_role: 'director', appointed_on: '2020-01-01' }] });
  assertEquals(undated.map((o) => o.name), ['Bob Early', 'Ann Late'], 'an undated appointment sorts last');
});

Deno.test('parseCapitalFilings reads the filing history fixture, newest first', () => {
  const filings = parseCapitalFilings(fixture('filing-history-capital.json'));
  assertEquals(filings, [
    { transactionId: 'MzQwMDAwMDAwMWFkaXF6a2N4', date: '2026-05-20', type: 'SH01', category: 'capital', description: 'Shares allotted on 12 May 2026, capital £1,234' },
    { transactionId: 'MzM5OTk5OTk5OWFkaXF6a2N4', date: '2023-01-17', type: 'SH06', category: 'capital', description: 'Shares cancelled on 10 January 2023, capital £100' },
    { transactionId: 'MzM5OTk5OTk5OGFkaXF6a2N4', date: '2021-04-02', type: '88(2)', category: 'capital', description: 'Return of allotment of shares' },
  ]);
  assertEquals(parseCapitalFilings(fixture('filing-history-capital.json'), '2023-01-01').length, 2);
  assertEquals(parseCapitalFilings({ items: [{ type: 'SH01', description: 'capital-allotment-shares' }] }), [], 'a filing without a date is dropped');
});

// ---------------------------------------------------------------------------
// The HTTP layer with the fake fetch.

Deno.test('companiesHouseConfigured follows the injected key', () => {
  try {
    configureCompaniesHouse({ apiKey: null });
    assertEquals(companiesHouseConfigured(), false);
    configureCompaniesHouse({ apiKey: 'k' });
    assertEquals(companiesHouseConfigured(), true);
  } finally {
    reset();
  }
});

Deno.test('fetchCompanyProfile sends Basic auth with the key and an empty password', async () => {
  const http = withHttp('my-key');
  try {
    const r = await fetchCompanyProfile('12345678');
    assert(r.verified);
    assertEquals(r.name, 'FABLE LABS LIMITED');
    assertEquals(http.requests.length, 1);
    assertEquals(http.requests[0].url, 'https://api.company-information.service.gov.uk/company/12345678');
    assertEquals(http.requests[0].auth, `Basic ${btoa('my-key:')}`);
  } finally {
    reset();
  }
});

Deno.test('fetchCompanyProfile without a key is unverified and makes no request', async () => {
  const http = withHttp(null);
  try {
    const r = await fetchCompanyProfile('12345678');
    assertEquals(r.verified, false);
    assertEquals(r.note, NOTE_KEY_NOT_SET);
    assertEquals(r.companyNumber, '12345678');
    assertEquals(http.requests.length, 0);
    assertEquals(await fetchOfficers('12345678'), []);
    assertEquals(await fetchCapitalFilings('12345678'), []);
    assertEquals(http.requests.length, 0);
  } finally {
    reset();
  }
});

Deno.test('fetchCompanyProfile turns a 404 into "Not on the register" and a bad number into a note', async () => {
  withHttp();
  try {
    const gone = await fetchCompanyProfile('99999999');
    assertEquals(gone.verified, false);
    assertEquals(gone.note, NOTE_NOT_ON_REGISTER);
    const bad = await fetchCompanyProfile('abc');
    assertEquals(bad.verified, false);
    assertEquals(bad.note, 'Not a company number');
  } finally {
    reset();
  }
});

Deno.test('fetchCompanyProfile waits and retries once on 429, then gives up', async () => {
  const http = withHttp();
  try {
    http.fail(/\/company\/12345678$/, 429, 1);
    const r = await fetchCompanyProfile('12345678');
    assert(r.verified, 'the retry answered');
    assertEquals(http.requests.length, 2);
    http.fail(/\/company\/12345678$/, 429);
    const again = await fetchCompanyProfile('12345678');
    assertEquals(again.verified, false);
    assertEquals(again.note, 'Companies House rate limit reached');
    assertEquals(http.requests.length, 4, 'one retry only');
  } finally {
    reset();
  }
});

Deno.test('fetchCompanyProfile reports a server error in the note and a network error too', async () => {
  const http = withHttp();
  try {
    http.fail(/\/company\/12345678$/, 503);
    const r = await fetchCompanyProfile('12345678');
    assertEquals(r.verified, false);
    assertEquals(r.note, 'Companies House did not answer (HTTP 503)');
    configureCompaniesHouse({ fetch: () => Promise.reject(new Error('timeout after 12000ms')) });
    const t = await fetchCompanyProfile('12345678');
    assertEquals(t.note, 'Companies House did not answer (timeout after 12000ms)');
  } finally {
    reset();
  }
});

Deno.test('fetchOfficers and fetchCapitalFilings read their endpoints', async () => {
  const http = withHttp();
  try {
    const officers = await fetchOfficers('12345678');
    assertEquals(officers.length, 4);
    assert(http.requests[0].url.endsWith('/company/12345678/officers?items_per_page=50'));
    const filings = await fetchCapitalFilings('12345678', '2023-01-01');
    assertEquals(filings.length, 2);
    assert(http.requests[1].url.endsWith('/company/12345678/filing-history?category=capital&items_per_page=50'));
    assertEquals(await fetchOfficers('99999999'), []);
  } finally {
    reset();
  }
});

Deno.test('searchCompanies returns hits, and throws with the note when there is no key or no answer', async () => {
  const http = withHttp();
  try {
    const hits = await searchCompanies('fable labs', 2);
    assertEquals(hits.length, 2);
    assert(http.requests[0].url.includes('/search/companies?q=fable%20labs&items_per_page=2'));
    assertEquals(await searchCompanies('fa'), []);
    http.fail(/\/search\//, 500);
    let caught = '';
    try { await searchCompanies('fable labs'); } catch (e) { caught = (e as Error).message; }
    assertEquals(caught, 'Companies House did not answer (HTTP 500)');
    configureCompaniesHouse({ apiKey: null });
    caught = '';
    try { await searchCompanies('fable labs'); } catch (e) { caught = (e as Error).message; }
    assertEquals(caught, NOTE_KEY_NOT_SET);
  } finally {
    reset();
  }
});

// ---------------------------------------------------------------------------
// The cache rule.

const cachedRow = (over: Row = {}): Row => ({
  company_number: '12345678',
  name: 'CACHED NAME LIMITED',
  previous_names: [],
  status: 'active',
  incorporation_date: '2021-03-15',
  sic_codes: ['62012'],
  registered_office: { line1: 'Somewhere', locality: 'London', region: null, postcode: 'N1 1AA', country: null },
  postcode: 'N1 1AA',
  postcode_district: 'N1',
  accounts_type: 'small',
  last_accounts_made_up_to: '2025-03-31',
  last_confirmation_statement: '2026-03-14',
  verified: true,
  note: null,
  fetched_at: isoDaysAgo(3),
  ...over,
});

Deno.test('resolveCompanyRecord returns null without a number', async () => {
  const http = withHttp();
  try {
    const db = fakeDb();
    assertEquals(await resolveCompanyRecord(db, { companyNumber: null, url: 'https://x.com', name: 'X' }), null);
    assertEquals(await resolveCompanyRecord(db, { companyNumber: 'abc', url: 'https://x.com', name: 'X' }), null);
    assertEquals(http.requests.length, 0);
  } finally {
    reset();
  }
});

Deno.test('resolveCompanyRecord answers from a fresh verified cache without a request', async () => {
  const http = withHttp();
  try {
    const db = fakeDb({ company_records: [cachedRow()] });
    const r = await resolveCompanyRecord(db, { companyNumber: '12345678', url: 'https://fablelabs.example', name: null }, 7);
    assertEquals(r?.name, 'CACHED NAME LIMITED');
    assertEquals(r?.verified, true);
    assertEquals(r?.postcodeDistrict, 'N1');
    assertEquals(http.requests.length, 0);
    assertEquals(db.writes.length, 0);
  } finally {
    reset();
  }
});

Deno.test('resolveCompanyRecord refreshes a stale row and upserts it', async () => {
  const http = withHttp();
  try {
    const db = fakeDb({ company_records: [cachedRow({ fetched_at: isoDaysAgo(10) })] });
    const r = await resolveCompanyRecord(db, { companyNumber: '12345678', url: 'https://fablelabs.example', name: null }, 7);
    assertEquals(r?.name, 'FABLE LABS LIMITED');
    assertEquals(http.requests.length, 1);
    assertEquals(db.writes.length, 1);
    assertEquals(db.rows('company_records').length, 1, 'upserted onto the same number');
    assertEquals(db.rows('company_records')[0].name, 'FABLE LABS LIMITED');
    assertEquals(db.rows('company_records')[0].postcode_district, 'EC2A');
    assertEquals(db.rows('company_records')[0].previous_names, ['STORYFORGE SOFTWARE LTD']);
  } finally {
    reset();
  }
});

Deno.test('resolveCompanyRecord refreshes an unverified row even when fresh', async () => {
  const http = withHttp();
  try {
    const db = fakeDb({ company_records: [cachedRow({ verified: false, note: NOTE_KEY_NOT_SET, name: '' })] });
    const r = await resolveCompanyRecord(db, { companyNumber: '12345678', url: 'https://fablelabs.example', name: null }, 30);
    assertEquals(r?.verified, true);
    assertEquals(r?.name, 'FABLE LABS LIMITED');
    assertEquals(http.requests.length, 1);
    assertEquals(db.rows('company_records')[0].verified, true);
  } finally {
    reset();
  }
});

Deno.test('resolveCompanyRecord keeps a verified cached row when the register cannot be read', async () => {
  const http = withHttp(null);
  try {
    const db = fakeDb({ company_records: [cachedRow({ fetched_at: isoDaysAgo(40) })] });
    const r = await resolveCompanyRecord(db, { companyNumber: '12345678', url: 'https://fablelabs.example', name: null }, 30);
    assertEquals(r?.name, 'CACHED NAME LIMITED');
    assertEquals(r?.verified, true);
    assertEquals(http.requests.length, 0);
    assertEquals(db.writes.length, 0, 'the stale but verified row is not replaced by an empty one');
  } finally {
    reset();
  }
});

Deno.test('resolveCompanyRecord stores an unverified row with the note when there is nothing cached', async () => {
  withHttp(null);
  try {
    const db = fakeDb();
    const r = await resolveCompanyRecord(db, { companyNumber: '1234567', url: 'https://x.example', name: 'X Limited' });
    assertEquals(r?.companyNumber, '01234567');
    assertEquals(r?.verified, false);
    assertEquals(r?.note, NOTE_KEY_NOT_SET);
    assertEquals(r?.name, 'X Limited', 'the stored name stands in');
    assertEquals(db.rows('company_records').length, 1);
    assertEquals(db.rows('company_records')[0].verified, false);
    withHttp();
    const gone = await resolveCompanyRecord(fakeDb(), { companyNumber: '99999999', url: 'https://x.example', name: null });
    assertEquals(gone?.note, NOTE_NOT_ON_REGISTER);
  } finally {
    reset();
  }
});

Deno.test('resolveCompanyRecord normalises the number before reading the cache', async () => {
  const http = withHttp();
  try {
    const db = fakeDb({ company_records: [cachedRow()] });
    const r = await resolveCompanyRecord(db, { companyNumber: ' 12345678 ', url: '', name: null });
    assertEquals(r?.name, 'CACHED NAME LIMITED');
    assertEquals(http.requests.length, 0);
  } finally {
    reset();
  }
});

Deno.test('rowToRecord and recordToRow round-trip', () => {
  const r = rowToRecord(cachedRow());
  const row = recordToRow(r);
  assertEquals(row.company_number, '12345678');
  assertEquals(row.postcode, 'N1 1AA');
  assertEquals(row.postcode_district, 'N1');
  assertEquals(row.verified, true);
  assertEquals(rowToRecord(row), r);
});

// ---------------------------------------------------------------------------
// Officers and filings.

Deno.test('syncRegisterDetails inserts everything on the first run and only the new rows after', async () => {
  withHttp();
  try {
    const db = fakeDb();
    const today = new Date(Date.UTC(2026, 8, 21));
    const first = await syncRegisterDetails(db, '12345678', today);
    assertEquals(first.officers.length, 4);
    assertEquals(first.newOfficers.length, 4);
    assertEquals(first.filings.length, 3);
    assertEquals(first.newFilings.length, 3);
    assertEquals(db.rows('ch_officers').length, 4);
    assertEquals(String(db.rows('ch_officers')[0].first_seen_at).slice(0, 10), '2026-09-21');
    assertEquals(String(db.rows('ch_officers')[0].last_seen_at).slice(0, 10), '2026-09-21');
    assertEquals(db.rows('ch_officers').find((r) => r.name === "Ms Siobhan O'Brien-Jones")?.resigned_on, '2024-02-29');
    assertEquals(db.rows('ch_filings').length, 3);
    assertEquals(db.rows('ch_filings')[0].transaction_id, 'MzQwMDAwMDAwMWFkaXF6a2N4');

    const later = new Date(Date.UTC(2026, 8, 28));
    const second = await syncRegisterDetails(db, '12345678', later);
    assertEquals(second.officers.length, 4);
    assertEquals(second.newOfficers, []);
    assertEquals(second.newFilings, []);
    assertEquals(db.rows('ch_officers').length, 4, 'no duplicates');
    assertEquals(String(db.rows('ch_officers')[0].first_seen_at).slice(0, 10), '2026-09-21', 'first_seen_at is kept');
    assertEquals(String(db.rows('ch_officers')[0].last_seen_at).slice(0, 10), '2026-09-28');
    assertEquals(db.rows('ch_filings').length, 3);
  } finally {
    reset();
  }
});

Deno.test('syncRegisterDetails reports a newly appointed officer and a new filing', async () => {
  withHttp();
  try {
    const today = new Date(Date.UTC(2026, 8, 21));
    const db = fakeDb({
      ch_officers: [
        { company_number: '12345678', officer_key: 'dr john andrew smith|director|2021-03-15', name: 'Dr John Andrew Smith', role: 'director', appointed_on: '2021-03-15', first_seen_at: '2026-01-01T00:00:00Z', last_seen_at: '2026-01-01T00:00:00Z' },
        { company_number: '12345678', officer_key: 'acme secretaries limited|corporate-secretary|2021-03-15', name: 'ACME SECRETARIES LIMITED', role: 'corporate-secretary', appointed_on: '2021-03-15', first_seen_at: '2026-01-01T00:00:00Z', last_seen_at: '2026-01-01T00:00:00Z' },
        { company_number: '12345678', officer_key: "ms siobhan o'brien-jones|director|2021-03-15", name: "Ms Siobhan O'Brien-Jones", role: 'director', appointed_on: '2021-03-15', resigned_on: null, first_seen_at: '2026-01-01T00:00:00Z', last_seen_at: '2026-01-01T00:00:00Z' },
      ],
      ch_filings: [
        { company_number: '12345678', filing_key: 'MzM5OTk5OTk5OWFkaXF6a2N4', transaction_id: 'MzM5OTk5OTk5OWFkaXF6a2N4', date: '2023-01-17', type: 'SH06', category: 'capital', description: 'x', first_seen_at: '2026-01-01T00:00:00Z' },
        { company_number: '12345678', filing_key: 'MzM5OTk5OTk5OGFkaXF6a2N4', transaction_id: 'MzM5OTk5OTk5OGFkaXF6a2N4', date: '2021-04-02', type: '88(2)', category: 'capital', description: 'x', first_seen_at: '2026-01-01T00:00:00Z' },
      ],
    });
    const out = await syncRegisterDetails(db, '12345678', today);
    assertEquals(out.newOfficers.map((o) => o.name), ['Priya Anjali Patel']);
    assertEquals(out.newFilings.map((f) => f.type), ['SH01']);
    assertEquals(db.rows('ch_officers').length, 4);
    assertEquals(db.rows('ch_officers').find((r) => r.name === "Ms Siobhan O'Brien-Jones")?.resigned_on, '2024-02-29', 'a resignation updates the stored row');
    assertEquals(db.rows('ch_officers').find((r) => r.name === 'Priya Anjali Patel')?.officer_id, 'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8');
    assertEquals(db.rows('ch_filings').length, 3);
  } finally {
    reset();
  }
});

Deno.test('syncRegisterDetails does nothing without a key or for an unknown company', async () => {
  const http = withHttp(null);
  try {
    const db = fakeDb();
    assertEquals(await syncRegisterDetails(db, '12345678', new Date()), { officers: [], newOfficers: [], filings: [], newFilings: [] });
    assertEquals(http.requests.length, 0);
    withHttp();
    assertEquals(await syncRegisterDetails(db, '99999999', new Date()), { officers: [], newOfficers: [], filings: [], newFilings: [] });
    assertEquals(db.rows('ch_officers').length, 0);
  } finally {
    reset();
  }
});

// ---------------------------------------------------------------------------
// The advanced search (the prospecting register walk).

Deno.test('parseAdvancedSearchResults keeps the hits total and the items with a number, name first', () => {
  const page = parseAdvancedSearchResults(fixture('advanced-search.json'));
  assertEquals(page.hits, 2371);
  assertEquals(page.items.length, 3, 'the item with no company number is dropped');
  assertEquals(page.items[0], {
    companyNumber: '14567890',
    name: 'METRIS ENERGY LTD',
    status: 'active',
    incorporationDate: '2023-02-14',
    sicCodes: ['62012', '62020'],
    locality: 'London',
    postcode: 'EC2A 4NE',
    postcodeDistrict: 'EC2A',
  });
  assertEquals(page.items[1].companyNumber, 'SC789012');
  assertEquals(page.items[1].postcodeDistrict, 'N1');
  // A numeric number is zero-padded; a dissolved company is still an item (the caller filters).
  assertEquals(page.items[2].companyNumber, '09876543');
  assertEquals(page.items[2].status, 'dissolved');
  assertEquals(page.items[2].sicCodes, []);
});

Deno.test('parseAdvancedSearchResults falls back to the item count when hits is missing', () => {
  assertEquals(parseAdvancedSearchResults({ items: [{ company_name: 'A', company_number: '1' }] }), { hits: 1, items: [{ companyNumber: '00000001', name: 'A', status: null, incorporationDate: null, sicCodes: [], locality: null, postcode: null, postcodeDistrict: null }] });
  assertEquals(parseAdvancedSearchResults(null), { hits: 0, items: [] });
});

Deno.test('advancedSearchQuery writes the parameters in a fixed order with the defaults', () => {
  assertEquals(advancedSearchQuery({ sicCodes: ['62012'], location: 'London', incorporatedFrom: '2020-09-21', startIndex: 200 }), 'company_status=active&sic_codes=62012&incorporated_from=2020-09-21&location=London&size=100&start_index=200');
  assertEquals(advancedSearchQuery({ sicCodes: [], size: 9000 }), 'company_status=active&size=5000&start_index=0');
});

Deno.test('advancedSearchCompanies sends Basic auth to /advanced-search/companies and parses the page', async () => {
  const http = withHttp();
  try {
    const page = await advancedSearchCompanies({ sicCodes: ['62012'], location: 'London', incorporatedFrom: '2020-09-21' });
    assertEquals(page.hits, 2371);
    assertEquals(page.items.length, 3);
    assertEquals(http.requests.length, 1);
    assert(http.requests[0].url.endsWith('/advanced-search/companies?company_status=active&sic_codes=62012&incorporated_from=2020-09-21&location=London&size=100&start_index=0'), http.requests[0].url);
    assertEquals(http.requests[0].auth, `Basic ${btoa('test-key:')}`);
  } finally {
    reset();
  }
});

Deno.test('advancedSearchCompanies throws the key note without a key and the HTTP note on a failure', async () => {
  withHttp(null);
  try {
    let caught: unknown = null;
    try { await advancedSearchCompanies({ sicCodes: ['62012'] }); } catch (e) { caught = e; }
    assertEquals((caught as Error)?.message, NOTE_KEY_NOT_SET);
  } finally {
    reset();
  }
  const http = withHttp();
  http.fail(/advanced-search/, 500);
  try {
    let caught: unknown = null;
    try { await advancedSearchCompanies({ sicCodes: ['62012'] }); } catch (e) { caught = e; }
    assertEquals((caught as Error)?.message, 'Companies House did not answer (HTTP 500)');
  } finally {
    reset();
  }
});
