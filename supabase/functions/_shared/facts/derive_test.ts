import { assertEquals } from '../test-assert.ts';
import { amountFromText, dateFromHint, deriveLatestRaise, deriveStage, investorsFromText, roundFromText, stageFromRound } from './derive.ts';
import type { Fact } from './types.ts';

const TODAY = new Date('2026-09-21T12:00:00Z');

function fact(over: Partial<Fact>): Fact {
  return { id: 'f1', kind: 'other', statement: 'A statement.', quote: 'a quote from the page', source_url: 'https://searchable.com/blog', date_hint: null, statement_key: 'k', ...over };
}

Deno.test('amounts: pounds, dollars and euros with m, million, k and plain figures; converted at the fixed rates', () => {
  assertEquals(amountFromText('Searchable secures £10.3 million Series A investment led by Headline'), { amountText: '£10.3 million', currency: 'GBP', amountGbp: 10_300_000 });
  assertEquals(amountFromText('We raised $4M from Y Combinator and angels'), { amountText: '$4M', currency: 'USD', amountGbp: 3_120_000 });
  assertEquals(amountFromText('a €2.5m seed round'), { amountText: '€2.5m', currency: 'EUR', amountGbp: 2_125_000 });
  assertEquals(amountFromText('closed a £750,000 pre-seed'), { amountText: '£750,000', currency: 'GBP', amountGbp: 750_000 });
  assertEquals(amountFromText('raised £750k'), { amountText: '£750k', currency: 'GBP', amountGbp: 750_000 });
  assertEquals(amountFromText('raised 12 million dollars'), { amountText: '12 million dollars', currency: 'USD', amountGbp: 9_360_000 });
  assertEquals(amountFromText('USD 3 million in funding'), { amountText: 'USD 3 million', currency: 'USD', amountGbp: 2_340_000 });
  assertEquals(amountFromText('we are 40 people, doubling this year'), null);
  assertEquals(amountFromText('tickets are £10'), null, 'a tenner is not a raise');
});

Deno.test('rounds and stages: pre-seed before seed, a Series letter kept, growth is Series B or later', () => {
  assertEquals(roundFromText('Searchable secures £10.3 million Series A investment'), 'Series A');
  assertEquals(roundFromText('our pre-seed round'), 'pre-seed');
  assertEquals(roundFromText('a $3m seed round led by Seedcamp'), 'seed');
  assertEquals(roundFromText('we closed our Series B'), 'Series B');
  assertEquals(roundFromText('a growth round'), 'growth');
  assertEquals(roundFromText('backed by angel investors'), 'angel');
  assertEquals(roundFromText('we raised money'), null);
  assertEquals(stageFromRound('Series A'), 'series_a');
  assertEquals(stageFromRound('Series C'), 'series_b_plus');
  assertEquals(stageFromRound('pre-seed'), 'pre_seed');
  assertEquals(stageFromRound('angel'), 'pre_seed');
  assertEquals(stageFromRound('seed'), 'seed');
  assertEquals(stageFromRound('bridge'), null);
  assertEquals(stageFromRound(null), null);
});

Deno.test('investors: led by, from a list, with participation from, and "X led the round"', () => {
  assertEquals(investorsFromText('Searchable secures £10.3 million Series A investment led by Headline.'), ['Headline']);
  assertEquals(investorsFromText('The round was led by Headline with participation from existing investors Seedcamp and Ada Ventures.'), ['Headline', 'Seedcamp', 'Ada Ventures']);
  assertEquals(investorsFromText('We raised $4M from Y Combinator, Entrepreneur First and a group of angels to build the team.'), ['Y Combinator', 'Entrepreneur First']);
  assertEquals(investorsFromText('Headline led the round and will use the funds to hire.'), ['Headline']);
  assertEquals(investorsFromText('Backed by LocalGlobe, Index Ventures and Kindred Capital, alongside angels from Monzo.'), ['LocalGlobe', 'Index Ventures', 'Kindred Capital']);
  assertEquals(investorsFromText('we hired 20 people this year'), []);
});

Deno.test('dates from hints: day, month, quarter, year', () => {
  assertEquals(dateFromHint('12 March 2026'), '2026-03-12');
  assertEquals(dateFromHint('March 2026'), '2026-03');
  assertEquals(dateFromHint('Q3 2026'), '2026-07');
  assertEquals(dateFromHint('2025'), '2025');
  assertEquals(dateFromHint('last year'), null);
  assertEquals(dateFromHint(null), null);
});

Deno.test('the latest raise is the newest dated funding_round fact with its investors from the investor facts', () => {
  const facts: Fact[] = [
    fact({ id: 'f1', kind: 'funding_round', statement: 'Searchable raised a £2 million seed round in 2024.', quote: 'raised a £2 million seed round', date_hint: '2024' }),
    fact({ id: 'f2', kind: 'funding_round', statement: 'Searchable secures £10.3 million Series A investment led by Headline.', quote: 'Searchable secures £10.3 million Series A investment led by Headline', date_hint: 'March 2026', source_url: 'https://searchable.com/blog/series-a' }),
    fact({ id: 'f3', kind: 'investor', statement: 'Seedcamp and Ada Ventures also took part in the round.', quote: 'with participation from Seedcamp and Ada Ventures', date_hint: 'March 2026' }),
    fact({ id: 'f4', kind: 'investor', statement: 'Angel investors from Monzo backed the seed round.', quote: 'angels from Monzo backed the seed round', date_hint: '2024' }),
  ];
  const r = deriveLatestRaise(facts, TODAY)!;
  assertEquals(r.amountText, '£10.3 million');
  assertEquals(r.amountGbp, 10_300_000);
  assertEquals(r.round, 'Series A');
  assertEquals(r.date, '2026-03');
  assertEquals(r.investors, ['Headline', 'Seedcamp', 'Ada Ventures'], 'the 2024 angels are before the raise');
  assertEquals(r.statement, facts[1].statement);
  assertEquals(r.source_url, 'https://searchable.com/blog/series-a');
  assertEquals(deriveLatestRaise([fact({ kind: 'investor', statement: 'Backed by Headline.', quote: 'backed by Headline' })], TODAY), null, 'an investor fact alone is not a raise');
  // An undated fact comes after every dated one; between undated facts the one with an amount leads.
  const undated = deriveLatestRaise([
    fact({ id: 'f1', kind: 'funding_round', statement: 'We recently closed our seed round.', quote: 'recently closed our seed round' }),
    fact({ id: 'f2', kind: 'funding_round', statement: 'We raised $4M from Y Combinator.', quote: 'raised $4M from Y Combinator' }),
  ], TODAY)!;
  assertEquals(undated.amountGbp, 3_120_000);
  assertEquals(undated.round, null);
  assertEquals(undated.date, null);
});

Deno.test('the stage: what the company calls itself first, then the latest raise, then any round word; never the incorporation date', () => {
  const record = { incorporationDate: '2025-03-12' };
  const stageFact = fact({ id: 'f1', kind: 'stage', statement: 'Searchable describes itself as a Series A company.', quote: 'we are a Series A company', source_url: 'https://searchable.com/about' });
  const seedRaise = fact({ id: 'f2', kind: 'funding_round', statement: 'Searchable raised a £2 million seed round in 2024.', quote: 'raised a £2 million seed round', date_hint: '2024' });
  assertEquals(deriveStage([seedRaise, stageFact], record, TODAY), { label: 'series_a', evidence: stageFact.statement, source_url: 'https://searchable.com/about' });
  assertEquals(deriveStage([seedRaise], record, TODAY), { label: 'seed', evidence: seedRaise.statement, source_url: seedRaise.source_url });
  const seriesB = fact({ id: 'f3', kind: 'funding_round', statement: 'The company closed a $30M Series B in June 2026.', quote: 'closed a $30M Series B', date_hint: 'June 2026' });
  assertEquals(deriveStage([seedRaise, seriesB], record, TODAY).label, 'series_b_plus');
  // A bridge says nothing about the stage; a pre-seed word elsewhere in the facts does.
  const bridge = fact({ id: 'f4', kind: 'funding_round', statement: 'The company raised a bridge round in 2026.', quote: 'raised a bridge round', date_hint: '2026' });
  const preSeed = fact({ id: 'f5', kind: 'funding_round', statement: 'The pre-seed came from angels.', quote: 'our pre-seed came from angels' });
  assertEquals(deriveStage([bridge, preSeed], record, TODAY).label, 'pre_seed');
  assertEquals(deriveStage([], record, TODAY), { label: 'unknown', evidence: null, source_url: null }, 'a young company with no round on its site is unknown, not pre-seed');
  assertEquals(deriveStage([fact({ kind: 'headcount', statement: 'We are 40 people.', quote: 'we are 40 people' })], null, TODAY).label, 'unknown');
});
