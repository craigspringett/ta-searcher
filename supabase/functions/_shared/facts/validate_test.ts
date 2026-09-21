import { assert, assertEquals } from '../test-assert.ts';
import { contactKey, evidenceFingerprint, fingerprintParts, fingerprintStatements, reconcileFacts, stabiliseFacts, monthsSinceHint, normaliseForMatch, quoteAppearsIn, statementKey, summaryFromFacts, validateFacts, yearFromDateHint } from './validate.ts';
import { buildPagesText, buildUserMessage, CONTACT_REVIEW_ROLES, EXTRACTION_SYSTEM, EXTRACTION_TOOL, strictSchema } from './extract.ts';
import { FACT_KINDS, type Fact, type RawFact } from './types.ts';

const TODAY = new Date('2026-09-21T12:00:00Z');
const PAGE = { url: 'https://www.searchable.com/blog/series-a', text: 'Searchable secures £10.3 million Series A investment led by Headline.  The round was announced in March 2026.\nWe are 40 people today and plan to double the team this year.\nPriya Shah joins us as our first Head of People.' };
const HOME = { url: 'https://www.searchable.com/', text: 'Searchable, London. Winner of the UKTN Startup of the Year award 2019. Alumni of Y Combinator (W24).' };

function fact(over: Partial<RawFact>): RawFact {
  return { kind: 'funding_round', statement: 'Searchable secured £10.3 million Series A investment led by Headline in March 2026.', quote: 'Searchable secures £10.3 million Series A investment led by Headline', source_url: PAGE.url, date_hint: 'March 2026', ...over };
}

Deno.test('quote must appear verbatim on the cited page, whitespace and curly quotes normalised', () => {
  assert(quoteAppearsIn('Searchable secures £10.3 million  Series A investment', PAGE.text));
  assert(quoteAppearsIn('plan to double the team this year', PAGE.text));
  assert(!quoteAppearsIn('Searchable raised £10.3 million', PAGE.text));
  const out = validateFacts([fact({}), fact({ statement: 'The company raised money.', quote: 'Searchable raised £10.3 million in a Series A' })], [PAGE, HOME], TODAY);
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
  const out = validateFacts([fact({ source_url: 'https://www.searchable.com/blog/series-a/#top' })], [PAGE], TODAY);
  assertEquals(out.facts.length, 1);
});

Deno.test('quote length, unknown kind, duplicates and the 40 cap', () => {
  const short = validateFacts([fact({ quote: 'Headline' })], [PAGE], TODAY);
  assert(short.dropped[0].reason.startsWith('quote length'));
  const bad = validateFacts([fact({ kind: 'gossip' })], [PAGE], TODAY);
  assert(bad.dropped[0].reason.startsWith('unknown kind'));
  const school = validateFacts([fact({ kind: 'ofsted' })], [PAGE], TODAY);
  assert(school.dropped[0].reason.startsWith('unknown kind'), 'the school kinds are gone');
  const dup = validateFacts([fact({}), fact({ statement: 'Searchable secured £10.3 million series a investment led by headline in march 2026' })], [PAGE], TODAY);
  assertEquals(dup.facts.length, 1);
  assertEquals(dup.dropped[0].reason, 'duplicate statement');
  const many = Array.from({ length: 45 }, (_, i) => fact({ kind: 'other', statement: `Statement number ${i} about the company.` }));
  assertEquals(validateFacts(many, [PAGE], TODAY).facts.length, 40);
});

Deno.test('awards older than three years are dropped, recent ones kept', () => {
  const old = fact({ kind: 'award', statement: 'Searchable won the UKTN Startup of the Year award.', quote: 'Winner of the UKTN Startup of the Year award 2019', source_url: HOME.url, date_hint: '2019' });
  const out = validateFacts([old], [HOME], TODAY);
  assertEquals(out.facts.length, 0);
  assert(out.dropped[0].reason.includes('older than 3 years'));
  const recent = { ...old, date_hint: '2024' };
  assertEquals(validateFacts([recent], [HOME], TODAY).facts.length, 1);
  const undated = { ...old, date_hint: null };
  assertEquals(validateFacts([undated], [HOME], TODAY).facts.length, 1);
});

Deno.test('date hints: years, spans, months; a bare year is taken as its middle', () => {
  assertEquals(yearFromDateHint('September 2026'), 2026);
  assertEquals(yearFromDateHint('2024-25'), 2025);
  assertEquals(yearFromDateHint('2024/25'), 2025);
  assertEquals(yearFromDateHint('last quarter'), null);
  assertEquals(monthsSinceHint('September 2026', TODAY), 0);
  assertEquals(monthsSinceHint('March 2025', TODAY), 18);
  assertEquals(monthsSinceHint('2023', TODAY), 39);
  assertEquals(monthsSinceHint('2025', TODAY), 15);
  assertEquals(monthsSinceHint(null, TODAY), null);
});

Deno.test('statement keys ignore case and punctuation', () => {
  assertEquals(statementKey('The company has 40 people.'), statementKey('the company has 40 people'));
  assertEquals(normaliseForMatch('A  “quoted”\n string'), 'a "quoted" string');
});

Deno.test('fingerprint is stable across order and changes with evidence', async () => {
  const a = await evidenceFingerprint({ statements: ['Fact one.', 'Fact two.'], vacancyKeys: ['url:https://x/1', 'title:senior backend engineer'], contacts: ['Tom Reed|CEO', 'Priya|Head of People', 'Ann|COO'] });
  const b = await evidenceFingerprint({ statements: ['fact two', 'Fact one.'], vacancyKeys: ['title:senior backend engineer', 'url:https://x/1'], contacts: ['Tom Reed|CEO', 'Priya|Head of People', 'Ann|COO'] });
  assertEquals(a, b);
  assertEquals(a.length, 32);
  const c = await evidenceFingerprint({ statements: ['Fact one.', 'Fact two.', 'Fact three.'], vacancyKeys: ['url:https://x/1', 'title:senior backend engineer'], contacts: ['Tom Reed|CEO'] });
  assert(a !== c);
  const d = await evidenceFingerprint({ statements: ['Fact one.', 'Fact two.'], vacancyKeys: [], contacts: ['Tom Reed|CEO', 'Priya|Head of People', 'Ann|COO'] });
  assert(a !== d);
  // Contact roles and titles are not part of the identity, names are.
  const f = await evidenceFingerprint({ statements: ['Fact one.', 'Fact two.'], vacancyKeys: ['url:https://x/1', 'title:senior backend engineer'], contacts: ['Mr T Reed', 'Priya', 'Ann'] });
  assert(a !== f);
  assertEquals(contactKey('Mr T. Reed'), contactKey('Ms T Reed'));
  // Only signal-bearing kinds feed the fingerprint.
  const facts: Fact[] = [
    { id: 'f1', kind: 'values', statement: 'The company values candour.', quote: 'q', source_url: 'u', date_hint: null, statement_key: 'a' },
    { id: 'f2', kind: 'funding_round', statement: 'Searchable raised a Series A.', quote: 'q', source_url: 'u', date_hint: null, statement_key: 'b' },
    { id: 'f3', kind: 'product_launch', statement: 'Searchable launched a new product.', quote: 'q', source_url: 'u', date_hint: null, statement_key: 'c' },
    { id: 'f4', kind: 'talent_team', statement: 'Priya Shah is Head of Talent.', quote: 'q', source_url: 'u', date_hint: null, statement_key: 'd' },
    { id: 'f5', kind: 'remote_policy', statement: 'The team works hybrid.', quote: 'q', source_url: 'u', date_hint: null, statement_key: 'e' },
  ];
  assertEquals(fingerprintStatements(facts), ['Searchable raised a Series A.', 'Priya Shah is Head of Talent.']);
  // A fourth contact does not count.
  const e = await evidenceFingerprint({ statements: ['Fact one.', 'Fact two.'], vacancyKeys: ['url:https://x/1', 'title:senior backend engineer'], contacts: ['Tom Reed|CEO', 'Priya|Head of People', 'Ann|COO', 'Extra|EA'] });
  assertEquals(a, e);
});

Deno.test('summary is built from the register, the open-role count and the facts in kind order', () => {
  const facts: Fact[] = [
    { id: 'f1', kind: 'recent_news', statement: 'Searchable spoke at SaaStock in June 2026.', quote: 'x', source_url: 'u', date_hint: null, statement_key: 'a' },
    { id: 'f2', kind: 'headcount', statement: 'Searchable is 40 people and plans to double the team this year.', quote: 'x', source_url: 'u', date_hint: null, statement_key: 'b' },
    { id: 'f3', kind: 'funding_round', statement: 'Searchable secured £10.3 million Series A investment led by Headline in March 2026', quote: 'x', source_url: 'u', date_hint: 'March 2026', statement_key: 'c' },
    { id: 'f4', kind: 'stage', statement: 'It calls itself a Series A company.', quote: 'x', source_url: 'u', date_hint: null, statement_key: 'd' },
    { id: 'f5', kind: 'talent_team', statement: 'Priya Shah is Head of People.', quote: 'x', source_url: 'u', date_hint: null, statement_key: 'e' },
  ];
  const s = summaryFromFacts({ name: 'Searchable', status: 'active', incorporatedYear: 2025, locality: 'London', sector: 'Software', stageLabel: 'series_a' }, facts, 13);
  assertEquals(s, 'Searchable is a software company incorporated in 2025, registered in London, at Series A. It has 13 open roles. Searchable secured £10.3 million Series A investment led by Headline in March 2026. Searchable is 40 people and plans to double the team this year. Priya Shah is Head of People. Searchable spoke at SaaStock in June 2026.');
  const none = summaryFromFacts({ name: 'Acme Labs', sector: null, stageLabel: 'unknown' }, [], 0);
  assertEquals(none, 'Acme Labs is a company. No open role is showing on its careers page or job board today.');
  const one = summaryFromFacts({ name: 'Acme Labs', sector: 'AI', incorporatedYear: 2026, stageLabel: 'seed' }, [], 1);
  assertEquals(one, 'Acme Labs is an AI company incorporated in 2026, at seed. It has one open role.');
  const gone = summaryFromFacts({ name: 'Acme Labs', status: 'dissolved', sector: 'Consultancy', locality: 'Manchester' }, [], 0);
  assertEquals(gone, 'Acme Labs is a consultancy, registered in Manchester; Companies House lists it as dissolved. No open role is showing on its careers page or job board today.');
  // At most five facts, one per kind.
  const many = summaryFromFacts({ name: 'Acme Labs' }, [...facts, { id: 'f6', kind: 'values', statement: 'Acme values candour.', quote: 'x', source_url: 'u', date_hint: null, statement_key: 'f' }, { id: 'f7', kind: 'headcount', statement: 'A second headcount fact.', quote: 'x', source_url: 'u', date_hint: null, statement_key: 'g' }], 2);
  assertEquals(many.split('. ').length, 7);
  assert(!many.includes('A second headcount fact'));
});

Deno.test('page text is laid out with URL labels inside the budget; the user message names the register and the open roles', () => {
  const { text, shown } = buildPagesText([PAGE, HOME], 200);
  assert(text.startsWith(`=== PAGE ${PAGE.url} ===`));
  assertEquals(shown, [PAGE.url]);
  const full = buildPagesText([PAGE, HOME], 5000);
  assertEquals(full.shown, [PAGE.url, HOME.url]);
  assert(full.text.includes(`=== PAGE ${HOME.url} ===`));
  const msg = buildUserMessage({ companyName: 'Searchable', record: { companyNumber: '12345678' }, vacancies: [{ title: 'Head of Talent' }], contactsBlock: '(none)', pages: [PAGE] }).text;
  assert(msg.startsWith('Company: Searchable\n\nCompanies House record (JSON, for context only): {"companyNumber":"12345678"}\n\nVerified open roles (JSON, for context only): [{"title":"Head of Talent"}]'));
  assert(!/DfE|school|pupil|Ofsted|phase/i.test(EXTRACTION_SYSTEM), 'no education wording in the prompt');
  assert(EXTRACTION_SYSTEM.includes('places Heads of Talent into seed and Series A start-ups'));
  assert(EXTRACTION_SYSTEM.includes('Y Combinator'));
  assertEquals(CONTACT_REVIEW_ROLES.length, 10);
  assert((EXTRACTION_TOOL.function.parameters.properties.contactReview as { description: string }).description.includes('Head of Talent / Recruiter'));
});

Deno.test('the strict schema forbids extra properties on every object and requires every field', () => {
  // deno-lint-ignore no-explicit-any
  const strict = strictSchema(EXTRACTION_TOOL.function.parameters) as any;
  assertEquals(strict.additionalProperties, false);
  assertEquals(strict.properties.facts.items.additionalProperties, false);
  assertEquals(strict.properties.facts.items.required, ['kind', 'statement', 'quote', 'source_url', 'date_hint']);
  assertEquals(strict.properties.contactReview.items.additionalProperties, false);
  assertEquals(strict.properties.vacancies.items.additionalProperties, false);
  assertEquals(strict.properties.facts.items.properties.kind.enum.length, 22);
  assertEquals(FACT_KINDS.length, 22);
  // The Gemini tool schema itself is untouched.
  // deno-lint-ignore no-explicit-any
  assertEquals((EXTRACTION_TOOL.function.parameters as any).additionalProperties, undefined);
});

Deno.test('a reworded fact with the same quote keeps its stored identity', async () => {
  const stored = [{ statement_key: statementKey('Searchable secured £10.3 million Series A investment led by Headline in March 2026.'), statement: 'Searchable secured £10.3 million Series A investment led by Headline in March 2026.', quote: 'Searchable secures £10.3 million Series A investment led by Headline', source_url: PAGE.url }];
  const reworded = validateFacts([fact({ statement: 'Headline led a £10.3 million Series A into Searchable in March 2026.' })], [PAGE], TODAY).facts;
  assert(reworded[0].statement_key !== stored[0].statement_key);
  const { facts, matched } = stabiliseFacts(reworded, stored);
  assertEquals(matched, 1);
  assertEquals(facts[0].statement_key, stored[0].statement_key);
  assertEquals(facts[0].statement, stored[0].statement);
  const a = await evidenceFingerprint({ statements: [stored[0].statement], vacancyKeys: [], contacts: [] });
  const b = await evidenceFingerprint({ statements: facts.map((f) => f.statement), vacancyKeys: [], contacts: [] });
  assertEquals(a, b);
  // A shorter quote inside the stored one also matches; an unrelated one does not.
  const shorter = validateFacts([fact({ statement: 'Headline led the Series A.', quote: 'Series A investment led by Headline' })], [PAGE], TODAY).facts;
  assertEquals(stabiliseFacts(shorter, stored).matched, 1);
  const other = validateFacts([fact({ kind: 'headcount', statement: 'Searchable is 40 people.', quote: 'We are 40 people today' })], [PAGE], TODAY).facts;
  assertEquals(stabiliseFacts(other, stored).matched, 0);
  const parts = await fingerprintParts({ statements: ['x'], vacancyKeys: ['k'], contacts: ['c'] });
  assertEquals(parts.fingerprint.length, 32);
  assertEquals(parts.facts.length, 12);
});

Deno.test('stored facts stay active while their quote is on the page, retire when it is gone or stale', () => {
  const tonight = validateFacts([fact({})], [PAGE, HOME], TODAY).facts;
  const stored = [
    { statement_key: 'k-headcount', kind: 'headcount', statement: 'Searchable is 40 people and plans to double this year.', quote: 'We are 40 people today and plan to double the team this year', source_url: PAGE.url, date_hint: null, last_seen: '2026-09-14' },
    { statement_key: 'k-gone', kind: 'award', statement: 'Searchable won Startup of the Year.', quote: 'Startup of the Year 2026 winner', source_url: HOME.url, date_hint: '2026', last_seen: '2026-09-14' },
    { statement_key: 'k-unfetched', kind: 'values', statement: 'The company values candour.', quote: 'candour is at the heart of everything', source_url: 'https://www.searchable.com/values', date_hint: null, last_seen: '2026-09-14' },
    { statement_key: 'k-stale', kind: 'values', statement: 'The company values pace.', quote: 'pace is at the heart of everything', source_url: 'https://www.searchable.com/values', date_hint: null, last_seen: '2026-05-01' },
    { statement_key: 'k-school', kind: 'ofsted', statement: 'A kind from the old world.', quote: 'Searchable, London', source_url: HOME.url, date_hint: null, last_seen: '2026-09-14' },
    { statement_key: tonight[0].statement_key, kind: 'funding_round', statement: tonight[0].statement, quote: tonight[0].quote, source_url: PAGE.url, date_hint: 'March 2026', last_seen: '2026-09-14' },
  ];
  const r = reconcileFacts(tonight, stored, [PAGE, HOME], TODAY);
  assertEquals(r.active.map((f) => f.statement_key), [tonight[0].statement_key, 'k-headcount', 'k-unfetched']);
  assertEquals(r.retired, ['k-gone', 'k-school', 'k-stale'], 'newest last seen first');
  assertEquals(r.unverified, ['k-unfetched']);
  assertEquals(r.carried, 2);
  assertEquals(r.active[1].id, 'f2');
});

Deno.test('a fact the team typed in is carried whatever the pages say, is never unverified and does not count against the cap', () => {
  const tonight = validateFacts([fact({})], [PAGE, HOME], TODAY).facts;
  const team = { statement_key: 'k-team', kind: 'consultant_intel', statement: 'Founder said on a call that they want a Head of Talent by January.', quote: '', source_url: 'consultant sheet, September 2026', date_hint: '2026-09', last_seen: '2026-06-01' };
  const stale = { statement_key: 'k-stale', kind: 'values', statement: 'The company values pace.', quote: 'pace is at the heart of everything', source_url: 'https://www.searchable.com/values', date_hint: null, last_seen: '2026-05-01' };
  const r = reconcileFacts(tonight, [stale, team], [PAGE, HOME], TODAY);
  assertEquals(r.active.map((f) => f.statement_key), [tonight[0].statement_key, 'k-team']);
  assertEquals(r.active[1].kind, 'consultant_intel');
  assertEquals(r.retired, ['k-stale']);
  assertEquals(r.unverified, []);
  assertEquals(fingerprintStatements(r.active).includes(team.statement), true);
});
