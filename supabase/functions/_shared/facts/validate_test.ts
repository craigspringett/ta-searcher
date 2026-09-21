import { assert, assertEquals } from '../test-assert.ts';
import { contactKey, evidenceFingerprint, fingerprintParts, fingerprintStatements, reconcileFacts, stabiliseFacts, monthsSinceHint, normaliseForMatch, quoteAppearsIn, statementKey, summaryFromFacts, validateFacts, yearFromDateHint } from './validate.ts';
import { buildPagesText, EXTRACTION_TOOL, strictSchema } from './extract.ts';
import type { Fact, RawFact } from './types.ts';

const TODAY = new Date('2026-09-08T12:00:00Z');
const PAGE = { url: 'https://www.example.sch.uk/about', text: 'Welcome to Example Primary.  We are delighted to announce that Mrs Jane Smith joined us as Headteacher in September 2026.\nOur new SEN resource base opened in April 2026 and supports 16 pupils with EHCPs.\nOfsted judged us “Good” in March 2024.' };
const HOME = { url: 'https://www.example.sch.uk/', text: 'Example Primary Company, Camden. Awarded the Artsmark Gold in 2019.' };

function fact(over: Partial<RawFact>): RawFact {
  return { kind: 'leadership_change', statement: 'Mrs Jane Smith joined as Headteacher in September 2026.', quote: 'Mrs Jane Smith joined us as Headteacher in September 2026', source_url: PAGE.url, date_hint: 'September 2026', ...over };
}

Deno.test('quote must appear verbatim on the cited page, whitespace and curly quotes normalised', () => {
  assert(quoteAppearsIn('Mrs Jane Smith  joined us as Headteacher', PAGE.text));
  assert(quoteAppearsIn('Ofsted judged us "Good" in March 2024', PAGE.text));
  assert(!quoteAppearsIn('Mrs Jane Smith was appointed Headteacher', PAGE.text));
  const out = validateFacts([fact({}), fact({ statement: 'The head is new.', quote: 'Mrs Jane Smith was appointed as Headteacher' })], [PAGE, HOME], TODAY);
  assertEquals(out.facts.length, 1);
  assertEquals(out.dropped[0].reason, 'quote not found on the cited page');
});

Deno.test('a quote from another page than the one cited is dropped', () => {
  const out = validateFacts([fact({ source_url: HOME.url })], [PAGE, HOME], TODAY);
  assertEquals(out.facts.length, 0);
  assertEquals(out.dropped[0].reason, 'quote not found on the cited page');
  const out2 = validateFacts([fact({ source_url: 'https://elsewhere.org/x' })], [PAGE, HOME], TODAY);
  assert(out2.dropped[0].reason.startsWith('source_url not among'));
});

Deno.test('source_url matching ignores trailing slash, hash and case', () => {
  const out = validateFacts([fact({ source_url: 'https://www.example.sch.uk/about/#top' })], [PAGE], TODAY);
  assertEquals(out.facts.length, 1);
});

Deno.test('quote length, unknown kind, duplicates and the 40 cap', () => {
  const short = validateFacts([fact({ quote: 'Jane' })], [PAGE], TODAY);
  assert(short.dropped[0].reason.startsWith('quote length'));
  const bad = validateFacts([fact({ kind: 'gossip' })], [PAGE], TODAY);
  assert(bad.dropped[0].reason.startsWith('unknown kind'));
  const dup = validateFacts([fact({}), fact({ statement: 'Mrs Jane Smith joined as headteacher in September 2026' })], [PAGE], TODAY);
  assertEquals(dup.facts.length, 1);
  assertEquals(dup.dropped[0].reason, 'duplicate statement');
  const many = Array.from({ length: 45 }, (_, i) => fact({ kind: 'other', statement: `Statement number ${i} about the company.` }));
  assertEquals(validateFacts(many, [PAGE], TODAY).facts.length, 40);
});

Deno.test('awards older than three years are dropped, recent ones kept', () => {
  const old = fact({ kind: 'award', statement: 'The company holds the Artsmark Gold award.', quote: 'Awarded the Artsmark Gold in 2019', source_url: HOME.url, date_hint: '2019' });
  const out = validateFacts([old], [HOME], TODAY);
  assertEquals(out.facts.length, 0);
  assert(out.dropped[0].reason.includes('older than 3 years'));
  const recent = { ...old, date_hint: '2024' };
  assertEquals(validateFacts([recent], [HOME], TODAY).facts.length, 1);
  const undated = { ...old, date_hint: null };
  assertEquals(validateFacts([undated], [HOME], TODAY).facts.length, 1);
});

Deno.test('date hints: years, academic years, months', () => {
  assertEquals(yearFromDateHint('September 2026'), 2026);
  assertEquals(yearFromDateHint('2024-25'), 2025);
  assertEquals(yearFromDateHint('2024/25'), 2025);
  assertEquals(yearFromDateHint('Autumn term'), null);
  assertEquals(monthsSinceHint('September 2026', TODAY), 0);
  assertEquals(monthsSinceHint('March 2025', TODAY), 18);
  assertEquals(monthsSinceHint('2023', TODAY), 36);
  assertEquals(monthsSinceHint(null, TODAY), null);
});

Deno.test('statement keys ignore case and punctuation', () => {
  assertEquals(statementKey('The company has 420 pupils on roll.'), statementKey('the company has 420 pupils on roll'));
  assertEquals(normaliseForMatch('A  “quoted”\n string'), 'a "quoted" string');
});

Deno.test('fingerprint is stable across order and changes with evidence', async () => {
  const a = await evidenceFingerprint({ statements: ['Fact one.', 'Fact two.'], vacancyKeys: ['url:https://x/1', 'title:teacher of maths'], contacts: ['Jane Smith|Headteacher', 'Bob|SBM', 'Ann|SENCO'] });
  const b = await evidenceFingerprint({ statements: ['fact two', 'Fact one.'], vacancyKeys: ['title:teacher of maths', 'url:https://x/1'], contacts: ['Jane Smith|Headteacher', 'Bob|SBM', 'Ann|SENCO'] });
  assertEquals(a, b);
  assertEquals(a.length, 32);
  const c = await evidenceFingerprint({ statements: ['Fact one.', 'Fact two.', 'Fact three.'], vacancyKeys: ['url:https://x/1', 'title:teacher of maths'], contacts: ['Jane Smith|Headteacher'] });
  assert(a !== c);
  const d = await evidenceFingerprint({ statements: ['Fact one.', 'Fact two.'], vacancyKeys: [], contacts: ['Jane Smith|Headteacher', 'Bob|SBM', 'Ann|SENCO'] });
  assert(a !== d);
  // Contact roles and titles are not part of the identity, names are.
  const f = await evidenceFingerprint({ statements: ['Fact one.', 'Fact two.'], vacancyKeys: ['url:https://x/1', 'title:teacher of maths'], contacts: ['Mrs J Smith', 'Bob', 'Ann'] });
  assert(a !== f);
  assertEquals(contactKey('Mrs J. Smith'), contactKey('Ms J Smith'));
  // Only signal-bearing kinds feed the fingerprint.
  const facts: Fact[] = [
    { id: 'f1', kind: 'values', statement: 'The company values kindness.', quote: 'q', source_url: 'u', date_hint: null, statement_key: 'a' },
    { id: 'f2', kind: 'ofsted', statement: 'Ofsted judged the company Good.', quote: 'q', source_url: 'u', date_hint: null, statement_key: 'b' },
  ];
  assertEquals(fingerprintStatements(facts), ['Ofsted judged the company Good.']);
  // A fourth contact does not count.
  const e = await evidenceFingerprint({ statements: ['Fact one.', 'Fact two.'], vacancyKeys: ['url:https://x/1', 'title:teacher of maths'], contacts: ['Jane Smith|Headteacher', 'Bob|SBM', 'Ann|SENCO', 'Extra|PA'] });
  assertEquals(a, e);
});

Deno.test('summary is built from the record and facts in kind order', () => {
  const facts: Fact[] = [
    { id: 'f1', kind: 'recent_news', statement: 'The company held a summer fair in July 2026.', quote: 'x', source_url: 'u', date_hint: null, statement_key: 'a' },
    { id: 'f2', kind: 'ofsted', statement: 'Ofsted judged the company Good in March 2024.', quote: 'x', source_url: 'u', date_hint: 'March 2024', statement_key: 'b' },
    { id: 'f3', kind: 'size', statement: 'The company has 420 pupils on roll', quote: 'x', source_url: 'u', date_hint: null, statement_key: 'c' },
    { id: 'f4', kind: 'phase', statement: 'It is a primary company.', quote: 'x', source_url: 'u', date_hint: null, statement_key: 'd' },
  ];
  const s = summaryFromFacts({ name: 'Example Primary', phase: 'primary', laName: 'Camden', trustName: 'LEARNING TRUST' }, facts, 2);
  assertEquals(s, 'Example Primary is a primary company in Camden, part of Learning Trust. The company has 420 pupils on roll. Ofsted judged the company Good in March 2024. The company held a summer fair in July 2026. 2 live vacancies are showing today.');
  const none = summaryFromFacts({ name: 'Example Primary', phase: 'secondary', laName: null, trustName: null }, [], 0);
  assertEquals(none, 'Example Primary is a secondary company. No live vacancy is showing on Teaching Vacancies, TES or the company website today.');
});

Deno.test('page text is laid out with URL labels inside the budget', () => {
  const { text, shown } = buildPagesText([PAGE, HOME], 200);
  assert(text.startsWith(`=== PAGE ${PAGE.url} ===`));
  assertEquals(shown, [PAGE.url]);
  const full = buildPagesText([PAGE, HOME], 5000);
  assertEquals(full.shown, [PAGE.url, HOME.url]);
  assert(full.text.includes(`=== PAGE ${HOME.url} ===`));
});

Deno.test('the strict schema forbids extra properties on every object and requires every field', () => {
  const strict = strictSchema(EXTRACTION_TOOL.function.parameters) as any;
  assertEquals(strict.additionalProperties, false);
  assertEquals(strict.properties.facts.items.additionalProperties, false);
  assertEquals(strict.properties.facts.items.required, ['kind', 'statement', 'quote', 'source_url', 'date_hint']);
  assertEquals(strict.properties.contactReview.items.additionalProperties, false);
  assertEquals(strict.properties.vacancies.items.additionalProperties, false);
  assertEquals(strict.properties.facts.items.properties.kind.enum.length, 18);
  // The Gemini tool schema itself is untouched.
  assertEquals((EXTRACTION_TOOL.function.parameters as any).additionalProperties, undefined);
});

Deno.test('a reworded fact with the same quote keeps its stored identity', async () => {
  const stored = [{ statement_key: statementKey('Mrs Jane Smith joined as Headteacher in September 2026.'), statement: 'Mrs Jane Smith joined as Headteacher in September 2026.', quote: 'Mrs Jane Smith joined us as Headteacher in September 2026', source_url: PAGE.url }];
  const reworded = validateFacts([fact({ statement: 'The company has a new headteacher, Mrs Jane Smith, from September 2026.' })], [PAGE], TODAY).facts;
  assert(reworded[0].statement_key !== stored[0].statement_key);
  const { facts, matched } = stabiliseFacts(reworded, stored);
  assertEquals(matched, 1);
  assertEquals(facts[0].statement_key, stored[0].statement_key);
  assertEquals(facts[0].statement, stored[0].statement);
  const a = await evidenceFingerprint({ statements: [stored[0].statement], vacancyKeys: [], contacts: [] });
  const b = await evidenceFingerprint({ statements: facts.map((f) => f.statement), vacancyKeys: [], contacts: [] });
  assertEquals(a, b);
  // A shorter quote inside the stored one also matches; an unrelated one does not.
  const shorter = validateFacts([fact({ statement: 'Jane Smith is headteacher.', quote: 'joined us as Headteacher in September 2026' })], [PAGE], TODAY).facts;
  assertEquals(stabiliseFacts(shorter, stored).matched, 1);
  const other = validateFacts([fact({ kind: 'send_provision', statement: 'A resource base opened in April 2026.', quote: 'new SEN resource base opened in April 2026' })], [PAGE], TODAY).facts;
  assertEquals(stabiliseFacts(other, stored).matched, 0);
  const parts = await fingerprintParts({ statements: ['x'], vacancyKeys: ['k'], contacts: ['c'] });
  assertEquals(parts.fingerprint.length, 32);
  assertEquals(parts.facts.length, 12);
});

Deno.test('stored facts stay active while their quote is on the page, retire when it is gone or stale', () => {
  const tonight = validateFacts([fact({})], [PAGE, HOME], TODAY).facts;
  const stored = [
    { statement_key: 'k-send', kind: 'send_provision', statement: 'A new SEN resource base opened in April 2026.', quote: 'Our new SEN resource base opened in April 2026', source_url: PAGE.url, date_hint: 'April 2026', last_seen: '2026-09-01' },
    { statement_key: 'k-gone', kind: 'award', statement: 'The company holds the Artsmark award.', quote: 'Artsmark Platinum awarded in 2026', source_url: HOME.url, date_hint: '2026', last_seen: '2026-09-01' },
    { statement_key: 'k-unfetched', kind: 'values', statement: 'The company values kindness.', quote: 'kindness is at the heart of everything', source_url: 'https://www.example.sch.uk/values', date_hint: null, last_seen: '2026-09-01' },
    { statement_key: 'k-stale', kind: 'values', statement: 'The company values honesty.', quote: 'honesty is at the heart of everything', source_url: 'https://www.example.sch.uk/values', date_hint: null, last_seen: '2026-05-01' },
    { statement_key: tonight[0].statement_key, kind: 'leadership_change', statement: tonight[0].statement, quote: tonight[0].quote, source_url: PAGE.url, date_hint: 'September 2026', last_seen: '2026-09-01' },
  ];
  const r = reconcileFacts(tonight, stored, [PAGE, HOME], TODAY);
  assertEquals(r.active.map((f) => f.statement_key), [tonight[0].statement_key, 'k-send', 'k-unfetched']);
  assertEquals(r.retired, ['k-gone', 'k-stale']);
  assertEquals(r.unverified, ['k-unfetched']);
  assertEquals(r.carried, 2);
  assertEquals(r.active[1].id, 'f2');
});

Deno.test('a fact the team typed in is carried whatever the pages say, is never unverified and does not count against the cap', () => {
  const tonight = validateFacts([fact({})], [PAGE, HOME], TODAY).facts;
  const team = { statement_key: 'k-team', kind: 'consultant_intel', statement: 'Moving into a brand-new building on the current site in September 2026; recruitment likely.', quote: '', source_url: 'consultant sheet, September 2026', date_hint: '2026-09', last_seen: '2026-06-01' };
  const stale = { statement_key: 'k-stale', kind: 'values', statement: 'The company values honesty.', quote: 'honesty is at the heart of everything', source_url: 'https://www.example.sch.uk/values', date_hint: null, last_seen: '2026-05-01' };
  const r = reconcileFacts(tonight, [stale, team], [PAGE, HOME], TODAY);
  assertEquals(r.active.map((f) => f.statement_key), [tonight[0].statement_key, 'k-team']);
  assertEquals(r.active[1].kind, 'consultant_intel');
  assertEquals(r.retired, ['k-stale']);
  assertEquals(r.unverified, []);
  assertEquals(fingerprintStatements(r.active).includes(team.statement), true);
});
