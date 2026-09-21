// The funding news modules against the fixtures fetched on 21 September
// 2026 (fixtures/uktn.xml, sifted.xml, google-news.xml) and a few
// headlines of their own.
import { assert, assertEquals } from '../test-assert.ts';
import { companyNameFromTitle, isRaiseStory, parseRaise } from './detect.ts';
import { headlineNamesCompany, matchCompany } from './match.ts';
import { isoFromPubDate, parseRssItems, splitPublisher } from './rss.ts';
import { externalKey, rowsFromFeeds, syncFundingNews } from './run.ts';
import { googleNewsCompanyFeed, type FeedFetch } from './sources.ts';
import { dateFromHint } from '../facts/derive.ts';
import { monthFromDateHint, monthsSinceHint } from '../facts/validate.ts';

const here = new URL('./fixtures/', import.meta.url);
const uktn = Deno.readTextFileSync(new URL('uktn.xml', here));
const sifted = Deno.readTextFileSync(new URL('sifted.xml', here));
const google = Deno.readTextFileSync(new URL('google-news.xml', here));

Deno.test('rss: UKTN items carry title, link, date and a trimmed description', () => {
  const items = parseRssItems(uktn);
  assertEquals(items.length, 10);
  const mag = items.find((i) => i.title.startsWith('Magnitude Biosciences'))!;
  assertEquals(mag.title, 'Magnitude Biosciences raises £1.3m to scale drug discovery platform');
  assert(mag.link.startsWith('https://www.uktech.news/'), mag.link);
  assert(mag.publishedAt !== null && mag.publishedAt.startsWith('2026-09-'), String(mag.publishedAt));
  assert(mag.description.length > 40, 'has a description');
  assert(!/appeared first on/.test(mag.description), 'the trailer is gone');
  assert(!/<p>|<a /.test(mag.description), 'no tags');
  assertEquals(mag.publisher, null);
  // Titles with a hyphen are left whole outside Google News.
  const lava = items.find((i) => i.title.includes('LAVA'))!;
  assertEquals(lava.title, 'Carlo Porreca and Helen Dixon join UK head-quartered firm LAVA as it opens New York office');
});

Deno.test('rss: Sifted items have CDATA titles and no description', () => {
  const items = parseRssItems(sifted);
  assertEquals(items.length, 24);
  assertEquals(items[0].title, 'London Demo Day 2026: startups to watch');
  assertEquals(items[0].link, 'https://sifted.eu/articles/london-demo-day-2026-startups-to-watch/');
  assert(items.every((i) => i.description === ''), 'no descriptions');
  assertEquals(items[0].publishedAt, '2026-09-21T05:00:55.000Z');
  const exein = items.find((i) => i.title.startsWith('Exein'))!;
  assertEquals(exein.title, 'Exein raises $270m to fight AI hackers, doubles valuation');
});

Deno.test('rss: Google News items split the publisher off the title and keep the redirect link', () => {
  const items = parseRssItems(google);
  assertEquals(items.length, 100);
  const metris = items.find((i) => i.title.includes('Metris Energy'))!;
  assertEquals(metris.title, 'London’s Metris Energy raises €4.35 million to scale AI platform for managing renewable energy assets');
  assertEquals(metris.publisher, 'EU-Startups');
  assert(metris.link.startsWith('https://news.google.com/rss/articles/'), metris.link);
  assertEquals(metris.description, '', 'the description repeats the headline and is dropped');
  assertEquals(metris.publishedAt, '2026-09-21T07:15:35.000Z');
  const crimson = items.find((i) => i.title.includes('Crimson'))!;
  assertEquals(crimson.title, 'AI litigation legaltech start-up Crimson raises $2.5m in seed funding round');
  assertEquals(crimson.publisher, 'The Global Legal Post');
  const jack = items.find((i) => i.title.includes('Jack & Jill'))!;
  assertEquals(jack.title, 'London-based Jack & Jill raises €34.68 million Series A to scale its AI agents for jobseekers and employers', 'entities decoded');
  assert(items.every((i) => i.publisher), 'every Google item names its publisher');
});

Deno.test('rss: splitPublisher and pubDate parsing', () => {
  assertEquals(splitPublisher('Foo raises £2m - EU-Startups', 'EU-Startups'), { title: 'Foo raises £2m', publisher: 'EU-Startups' });
  assertEquals(splitPublisher('Foo raises £2m - The Times'), { title: 'Foo raises £2m', publisher: 'The Times' });
  assertEquals(splitPublisher('Foo raises £2m'), { title: 'Foo raises £2m', publisher: null });
  assertEquals(isoFromPubDate('Wed, 16 Sep 2026 17:05:00 +0000'), '2026-09-16T17:05:00.000Z');
  assertEquals(isoFromPubDate('not a date'), null);
  assertEquals(isoFromPubDate(null), null);
});

Deno.test('detect: the fixture headlines named in the brief are raise stories', () => {
  assert(isRaiseStory('Magnitude Biosciences raises £1.3m to scale drug discovery platform'));
  assert(isRaiseStory('London’s Metris Energy raises €4.35 million to scale AI platform for managing renewable energy assets'));
  assert(isRaiseStory('AI litigation legaltech start-up Crimson raises $2.5m in seed funding round'));
  assert(isRaiseStory('Exein raises $270m to fight AI hackers, doubles valuation'));
  assert(isRaiseStory('Itoflow secures £1.8m to build AI agents for investor portfolio management'));
  assert(isRaiseStory('Vuelo secures €64 million in Seed funding to build an AI-native travel booking experience'));
  assert(isRaiseStory('Acme lands seed round', ''), 'a round word with no amount is enough');
  assert(isRaiseStory('Acme bags backing', 'The company closed a £2m round this week.'), 'the summary can carry the amount');
});

Deno.test('detect: what is not a raise story', () => {
  assert(!isRaiseStory('Why small businesses could be the big winners from AI'));
  assert(!isRaiseStory('UK Sovereign AI Fund in talks to back £500m raise for drug discovery startup'), 'talks, no verb');
  assert(!isRaiseStory('Samsung and EU Scaleup Fund back efficient AI startup Euclyd in €200m Series A'), '"back" is not a raise verb');
  assert(!isRaiseStory('Acme Ventures closes $50m fund'), 'a fund closing');
  assert(!isRaiseStory('Acme Ventures raises $100m second fund for European seed deals'), 'a fund raising');
  assert(isRaiseStory('Acme raises £5m from the UK Sovereign AI Fund'), 'a fund as the investor is still a raise');
  assert(!isRaiseStory('Acme raises the bar for customer service'), 'a verb with no money and no round');
  assert(!isRaiseStory(''));
});

Deno.test('detect: companyNameFromTitle strips the dressing', () => {
  assertEquals(companyNameFromTitle('Magnitude Biosciences raises £1.3m to scale drug discovery platform'), 'Magnitude Biosciences');
  assertEquals(companyNameFromTitle('London’s Metris Energy raises €4.35 million to scale AI platform'), 'Metris Energy');
  assertEquals(companyNameFromTitle("London's Zalos raises €3.1 million Seed"), 'Zalos');
  assertEquals(companyNameFromTitle('AI litigation legaltech start-up Crimson raises $2.5m in seed funding round'), 'Crimson');
  assertEquals(companyNameFromTitle('London-based Jack & Jill raises €34.68 million Series A'), 'Jack & Jill');
  assertEquals(companyNameFromTitle('UK startup Outpost raises £13m in Series A funding'), 'Outpost');
  assertEquals(companyNameFromTitle('British fintech Acme secures £4m'), 'Acme');
  assertEquals(companyNameFromTitle('Cybersecurity startup Tracebit raises £15m in Series A ‘milestone’'), 'Tracebit');
  assertEquals(companyNameFromTitle('Ex-Palantir team behind Conduct raises €51 million to make enterprise systems AI-ready'), 'Conduct');
  assertEquals(companyNameFromTitle("DeepMind creative lead's AI writing startup Marker raises $13M seed"), 'Marker');
  assertEquals(companyNameFromTitle('Exclusive: UK HealthTech startup Nul raises €840k in Seed funding'), 'Nul');
  assertEquals(companyNameFromTitle('From cash deposits to everyday rewards: London-based Stoa raises €2.1 million'), 'Stoa');
  assertEquals(companyNameFromTitle('Edinburgh-based Wordsmith raises £2m seed'), 'Wordsmith');
  assertEquals(companyNameFromTitle('Music tech startup Mozart AI raises $6M in seed round led by Balderton Capital'), 'Mozart AI');
  assertEquals(companyNameFromTitle('Stanhope AI raises £6m in seed funding round'), 'Stanhope AI');
  assertEquals(companyNameFromTitle('Defense Tech Startup Occam Raises €3M Following Brave1 Integration Approval in Ukraine'), 'Occam');
  assertEquals(companyNameFromTitle('Augur, a ‘grey-zone’ national security startup, raises $15M'), 'Augur');
  assertEquals(companyNameFromTitle('Paid, the AI agent ‘results-based billing’ startup from Manny Medina, raises $21M seed'), 'Paid');
  assertEquals(companyNameFromTitle('London and New York-based Model ML raises $75M'), 'Model ML');
  assertEquals(companyNameFromTitle('London startup raises $410m in one of Europe’s biggest ever Series A rounds'), null, 'no name in the headline');
  assertEquals(companyNameFromTitle('Forbes 30 Under 30 founder raises £6m for TraqCheck'), null, 'a person by their role');
  assertEquals(companyNameFromTitle('AI startup driven by Imperial alumni closes £9m seed funding round'), null);
  assertEquals(companyNameFromTitle('Why small businesses could be the big winners from AI'), null);
});

Deno.test('detect: parseRaise reads the amount and the round from the headline, then the summary', () => {
  assertEquals(parseRaise('Magnitude Biosciences raises £1.3m to scale drug discovery platform'), { companyName: 'Magnitude Biosciences', amountText: '£1.3m', amountGbp: 1_300_000, round: null });
  assertEquals(parseRaise('London’s Metris Energy raises €4.35 million to scale AI platform'), { companyName: 'Metris Energy', amountText: '€4.35 million', amountGbp: 3_697_500, round: null });
  assertEquals(parseRaise('AI litigation legaltech start-up Crimson raises $2.5m in seed funding round'), { companyName: 'Crimson', amountText: '$2.5m', amountGbp: 1_950_000, round: 'seed' });
  assertEquals(parseRaise('London-based incentifi raises €174k pre-Seed round to pilot wellbeing-focused workplace rewards platform').round, 'pre-seed');
  assertEquals(parseRaise('London-based Jack & Jill raises €34.68 million Series A').round, 'Series A');
  assertEquals(parseRaise('Acme lands seed round', 'Acme has raised £750,000 from angels.'), { companyName: 'Acme', amountText: '£750,000', amountGbp: 750_000, round: 'seed' });
});

Deno.test('detect: the fixtures yield the expected raise stories', () => {
  const count = (xml: string) => parseRssItems(xml).filter((i) => isRaiseStory(i.title, i.description)).length;
  assertEquals(count(uktn), 4, 'UKTN: Magnitude Biosciences, First Table, Itoflow, Embedd');
  assertEquals(count(sifted), 1, 'Sifted: Exein');
  const g = count(google);
  assert(g >= 60 && g <= 100, `Google News search feed: ${g} of 100`);
});

Deno.test('match: a headline name finds the tracked company under its register, typed and domain names', () => {
  const companies = [
    { id: 'a', name: 'Searchable Technologies Ltd', aliases: ['Searchable', 'searchable.ai'] },
    { id: 'b', name: 'Metris Energy Limited', aliases: ['metrisenergy.com'] },
    { id: 'c', name: 'Build', aliases: [] },
  ];
  assertEquals(matchCompany('Searchable', companies)?.id, 'a');
  assertEquals(matchCompany('Metris Energy', companies)?.id, 'b');
  assertEquals(matchCompany('Metris', companies)?.id, 'b', 'one name contains the other');
  assertEquals(matchCompany('Build', companies)?.id, 'c', 'a one-word name matches exactly');
  assertEquals(matchCompany('Build Robotics', companies)?.note, 'one name contains the other');
  assertEquals(matchCompany('Build Robotics Payments', companies), null, 'two tokens to spare is another company');
  assertEquals(matchCompany('Crimson', companies), null);
  assertEquals(matchCompany('', companies), null);
  assertEquals(matchCompany(null, companies), null);
  assert(headlineNamesCompany('London’s Metris Energy raises €4.35 million', companies[1]));
  assert(!headlineNamesCompany('London’s Metris Energy raises €4.35 million', companies[0]));
});

Deno.test('run: externalKey lower-cases the host and drops the query and hash', () => {
  assertEquals(externalKey('https://WWW.UKTech.news/ai/some-story/?utm_source=rss#top'), 'https://www.uktech.news/ai/some-story');
  assertEquals(externalKey('https://news.google.com/rss/articles/CBMi0wFB?oc=5'), 'https://news.google.com/rss/articles/CBMi0wFB');
  assertEquals(externalKey('not a url'), null);
  assertEquals(externalKey('mailto:x@y'), null);
});

Deno.test('run: rowsFromFeeds keeps raise stories, dedupes on the key and matches tracked companies', () => {
  const companies = [{ id: 'm', name: 'Metris Energy Ltd', aliases: [] }, { id: 's', name: 'Searchable Technologies Ltd', aliases: ['Searchable'] }];
  const feeds: FeedFetch[] = [
    { source: 'uktn', url: 'u', ok: true, status: 200, items: parseRssItems(uktn), error: null, ms: 1 },
    { source: 'sifted', url: 's', ok: true, status: 200, items: parseRssItems(sifted), error: null, ms: 1 },
    { source: 'google_news', url: 'g', ok: true, status: 200, items: parseRssItems(google), error: null, ms: 1 },
    // A company's own feed repeating a story from the general feed, plus one the name parser gets wrong.
    { source: 'google_news', url: 'g2', ok: true, status: 200, companyId: 's', error: null, ms: 1, items: [
      ...parseRssItems(google).filter((i) => i.title.includes('Metris Energy')),
      { title: 'The London search start-up everyone is talking about, Searchable, raises $12m Series A', link: 'https://news.google.com/rss/articles/XYZ?oc=5', pubDate: null, publishedAt: '2026-09-20T09:00:00.000Z', description: '', publisher: 'Sifted' },
    ] },
  ];
  const { rows, items, raiseStories } = rowsFromFeeds(feeds, companies);
  assertEquals(items, 136);
  assert(raiseStories > rows.length, 'the repeated Metris story counted twice, stored once');
  const keys = new Set(rows.map((r) => r.external_key));
  assertEquals(keys.size, rows.length, 'one row per key');
  const metris = rows.find((r) => r.company_name === 'Metris Energy')!;
  assertEquals(metris.matched_company_search_id, 'm');
  assertEquals(metris.source, 'google_news');
  assertEquals(metris.publisher, 'EU-Startups');
  assertEquals(metris.amount_text, '€4.35 million');
  const searchable = rows.find((r) => r.external_key.endsWith('/XYZ'))!;
  assertEquals(searchable.matched_company_search_id, 's', 'named in the headline of its own feed');
  assertEquals(searchable.match_note, 'named in the headline of its own feed');
  assertEquals(searchable.round, 'Series A');
  const mag = rows.find((r) => r.title.startsWith('Magnitude Biosciences'))!;
  assertEquals(mag.source, 'uktn');
  assertEquals(mag.matched_company_search_id, null);
  assert(mag.summary && mag.summary.length > 40, 'UKTN summary kept');
  const exein = rows.find((r) => r.title.startsWith('Exein'))!;
  assertEquals(exein.summary, null, 'Sifted gives no summary');
});

Deno.test('run: syncFundingNews dry run reads the feeds and writes nothing; a real run upserts and rematches', async () => {
  const writes: Array<{ table: string; op: string; payload: unknown }> = [];
  const companies = [{ id: 'm', company_name: 'Metris Energy Ltd', url: 'https://metrisenergy.com', record: { name: 'METRIS ENERGY LIMITED', previousNames: ['METRIS LTD'] } }];
  // One story already stored (Magnitude's, by its key), unmatched, with a name the new company now matches.
  const magKey = externalKey(parseRssItems(uktn).find((i) => i.title.startsWith('Magnitude'))!.link);
  const stored = [{ id: 'old', external_key: magKey, company_name: 'Metris', title: 'Metris raises £1m', published_at: '2026-09-01T00:00:00Z' }];
  const fake = (dry: boolean) => ({
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      Object.assign(chain, {
        select: self, order: self, limit: self, in: self, is: self, gte: self, eq: self,
        upsert: (payload: unknown) => { writes.push({ table, op: 'upsert', payload }); return Promise.resolve({ error: null }); },
        update: (payload: unknown) => ({ eq: () => { writes.push({ table, op: 'update', payload }); return Promise.resolve({ error: null }); } }),
        then: (resolve: (v: unknown) => void) => {
          if (table === 'company_searches') return resolve({ data: companies, error: null });
          if (table === 'funding_news') return resolve({ data: dry ? [] : stored, error: null });
          return resolve({ data: [], error: null });
        },
      });
      return chain;
    },
  });
  const read = (spec: { source: 'uktn' | 'sifted' | 'google_news'; url: string; companyId?: string }): Promise<FeedFetch> => {
    const xml = spec.source === 'uktn' ? uktn : spec.source === 'sifted' ? sifted : spec.companyId ? '' : google;
    return Promise.resolve({ ...spec, ok: !!xml, status: xml ? 200 : 503, items: xml ? parseRssItems(xml, { googleNews: spec.source === 'google_news' }) : [], error: xml ? null : 'HTTP 503', ms: 1 });
  };
  const today = new Date('2026-09-21T12:00:00Z');

  const dry = await syncFundingNews(fake(true), { today, dryRun: true, fetch: read });
  assertEquals(writes.length, 0);
  assertEquals(dry.feeds, 4);
  assertEquals(dry.companyFeeds, 1);
  assertEquals(dry.feedsFailed, 1, "the company's own feed answered 503");
  assertEquals(dry.companies, 1);
  assertEquals(dry.items, 134);
  assert(dry.unique >= 60, `unique ${dry.unique}`);
  assertEquals(dry.matched, 1, 'Metris Energy matched by name');
  assertEquals(dry.inserted, 0);
  assert(dry.sample.length > 0 && dry.sample.length <= 50);
  assertEquals(dry.errors, []);

  const real = await syncFundingNews(fake(false), { today, perCompany: false, fetch: read });
  assertEquals(real.companyFeeds, 0);
  assertEquals(real.feeds, 3);
  const upserts = writes.filter((w) => w.op === 'upsert');
  assert(upserts.length >= 1, 'rows were upserted');
  assertEquals(real.inserted + real.updated, real.unique);
  assertEquals(real.updated, 1, 'the one stored key came back as seen again');
  assertEquals(real.rematched, 1, 'the old unmatched Metris story is now matched');
  const rematch = writes.find((w) => w.op === 'update')!;
  assertEquals((rematch.payload as { matched_company_search_id: string }).matched_company_search_id, 'm');
});

Deno.test('sources: the per-company Google News query quotes the name', () => {
  const url = googleNewsCompanyFeed('Jack & Jill');
  assert(url.startsWith('https://news.google.com/rss/search?q='), url);
  assert(url.includes(encodeURIComponent('"Jack & Jill" raises OR funding OR "Series A" OR seed')), url);
  assert(url.endsWith('&hl=en-GB&gl=GB&ceid=GB:en'), url);
});

Deno.test('facts: an ISO date hint from a funding news row reads as a full date', () => {
  assertEquals(dateFromHint('2026-09-21'), '2026-09-21');
  assertEquals(monthFromDateHint('2026-09-21'), 8);
  assertEquals(monthsSinceHint('2026-03-15', new Date('2026-09-21T00:00:00Z')), 6);
  assertEquals(dateFromHint('12 March 2026'), '2026-03-12', 'the wordy hints are as before');
});
