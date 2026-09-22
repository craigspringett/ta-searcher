import { assert, assertEquals } from '../test-assert.ts';
import { cachedHunterResult, hunterDomainSearch, hunterHits, parseHunterDomainSearch } from './hunter.ts';
import { resolveContacts } from './resolve.ts';

const fixture = JSON.parse(Deno.readTextFileSync(new URL('./fixtures/hunter-domain-search.json', import.meta.url)));
const NOW = new Date('2026-09-21T12:00:00.000Z');

Deno.test('hunter: the fixture keeps the named, confident, placeable people and the general mailbox', () => {
  const r = parseHunterDomainSearch(fixture);
  assertEquals(r.listed, 7);
  assertEquals(r.people.map((p) => p.name), ['Alice Founder', 'Bob Builder', 'Carol People'], 'the account executive, the 31% COO and the surname-less founder are out');
  assertEquals(r.people[0].position, 'Co-founder and CEO');
  assertEquals(r.people[1].phone, '+44 20 7946 0000');
  assertEquals(r.generic, ['hello@metrisenergy.com']);
  assertEquals(r.dropped.map((d) => `${d.email}: ${d.why}`), ['dave@metrisenergy.com: the position is not a role the app contacts', 'erin@metrisenergy.com: confidence under 50', 'frank@metrisenergy.com: no full name']);
  assertEquals(parseHunterDomainSearch({ data: { emails: [] } }).people, []);
  // Searchable, 21 September 2026: Hunter lists chris@ with no position; the register has Christopher Donnelly as a director.
  const withOfficer = parseHunterDomainSearch({ data: { emails: [{ value: 'chris@searchable.com', type: 'personal', confidence: 85, first_name: 'Chris', last_name: 'Donnelly', position: null }] } }, { officers: [{ name: 'Christopher Stuart Stanton Donnelly', jobTitle: 'Director', source: 'Companies House register' }] });
  assertEquals(withOfficer.people.map((p) => `${p.name} / ${p.position}`), ['Chris Donnelly / Director']);
  assertEquals(parseHunterDomainSearch({ data: { emails: [{ value: 'chris@searchable.com', type: 'personal', confidence: 85, first_name: 'Chris', last_name: 'Donnelly', position: null }] } }).dropped[0].why, 'no position');
  assertEquals(parseHunterDomainSearch(null).listed, 0);
});

Deno.test('hunter: the hits resolve as found contacts with Hunter as the source', () => {
  const parsed = parseHunterDomainSearch(fixture);
  const hits = hunterHits({ host: 'metrisenergy.com', ...parsed });
  assertEquals(hits.people.length, 3);
  assertEquals(hits.emails.length, 4);
  assertEquals(hits.people[0].email, 'alice@metrisenergy.com');
  assertEquals(hits.people[0].source_url, 'https://hunter.io/search/metrisenergy.com');
  const out = resolveContacts({ emails: hits.emails, people: hits.people, phones: [], siteHost: 'metrisenergy.com', companyName: 'Metris Energy' });
  const alice = out.contacts.find((c) => c.name === 'Alice Founder')!;
  assertEquals(alice.email, 'alice@metrisenergy.com');
  assertEquals(alice.confidence, 'found');
  assert(alice.source_url.includes('hunter.io'), alice.source_url);
  const carol = out.contacts.find((c) => c.name === 'Carol People')!;
  assertEquals(carol.confidence, 'found');
  assertEquals(carol.email, 'carol@metrisenergy.com');
});

Deno.test('hunter: the search, its refusals and the cache', async () => {
  const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  let url = '';
  const ok = await hunterDomainSearch('metrisenergy.com', { key: 'k', now: NOW, fetch: (u) => { url = u; return Promise.resolve(jsonResponse(fixture)); } });
  assertEquals(ok.ok, true);
  assertEquals(ok.people.length, 3);
  assert(url.startsWith('https://api.hunter.io/v2/domain-search?domain=metrisenergy.com&api_key=k&limit=25'), url);
  const none = await hunterDomainSearch('x.com', { key: null });
  assertEquals(none.configured, false);
  assertEquals(none.error, 'HUNTER_API_KEY not set');
  const refused = await hunterDomainSearch('x.com', { key: 'k', fetch: () => Promise.resolve(jsonResponse({ errors: [{ details: 'No user found for the API key supplied' }] }, 401)) });
  assertEquals(refused.ok, false);
  assertEquals(refused.error, 'the key was refused: No user found for the API key supplied');
  const spent = await hunterDomainSearch('x.com', { key: 'k', fetch: () => Promise.resolve(jsonResponse({}, 429)) });
  assertEquals(spent.error, 'the monthly quota is spent');
  const down = await hunterDomainSearch('x.com', { key: 'k', fetch: () => Promise.reject(new Error('timed out')) });
  assertEquals(down.error, 'timed out');
  const cached = cachedHunterResult({ ...ok, fetchedAt: '2026-09-01T00:00:00.000Z' }, 'metrisenergy.com', NOW);
  assertEquals(cached?.fromCache, true);
  assertEquals(cached?.people.length, 3);
  assertEquals(cachedHunterResult({ ...ok, fetchedAt: '2026-07-01T00:00:00.000Z' }, 'metrisenergy.com', NOW), null, 'older than thirty days');
  assertEquals(cachedHunterResult(ok, 'other.com', NOW), null);
  assertEquals(cachedHunterResult({ ...none }, 'x.com', NOW), null, 'a failed result is not reused');
});

Deno.test('hunter: the Finder, the Verifier and the account parse and never throw', async () => {
  const { hunterAccount, hunterAccountLine, hunterEmailFinder, hunterVerifyEmail, parseHunterFinder, parseHunterVerifier } = await import('./hunter.ts');
  assertEquals(parseHunterFinder({ data: { email: 'Alice@X.com', score: 91, verification: { status: 'valid', date: '2026-09-01' }, position: 'CEO', linkedin_url: 'https://linkedin.com/in/alice' } }), { email: 'alice@x.com', score: 91, verificationStatus: 'valid', position: 'CEO', linkedin: 'https://www.linkedin.com/in/alice/' });
  assertEquals(parseHunterFinder({ data: { email: null, score: null } }).email, null);
  assertEquals(parseHunterVerifier({ data: { status: 'accept_all', result: 'risky', score: 60 } }), { result: 'risky', verifyStatus: 'accept_all', score: 60 });
  assertEquals(parseHunterVerifier({ data: { status: 'valid' } }).result, 'deliverable');
  assertEquals(parseHunterVerifier({ data: { status: 'webmail' } }).result, 'unknown');
  const reply = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  const urls: string[] = [];
  const f = await hunterEmailFinder('x.com', 'Alice', 'Founder', { key: 'k', fetch: (u) => { urls.push(u); return reply(200, { data: { email: 'alice@x.com', score: 80, verification: { status: 'valid' } } }); } });
  assertEquals(f.email, 'alice@x.com');
  assert(urls[0].includes('first_name=Alice') && urls[0].includes('last_name=Founder') && urls[0].includes('domain=x.com'), urls[0]);
  const notFound = await hunterEmailFinder('x.com', 'A', 'B', { key: 'k', fetch: () => reply(404, { errors: [{ details: 'Not found' }] }) });
  assertEquals([notFound.ok, notFound.email, notFound.error], [true, null, null]);
  const spent = await hunterEmailFinder('x.com', 'A', 'B', { key: 'k', fetch: () => reply(429, { errors: [{ details: 'Too many requests' }] }) });
  assertEquals([spent.ok, spent.status, spent.error], [false, 429, 'the monthly quota is spent: Too many requests']);
  const v = await hunterVerifyEmail('alice@x.com', { key: 'k', fetch: () => reply(200, { data: { status: 'invalid', result: 'undeliverable' } }) });
  assertEquals(v.result, 'undeliverable');
  const slow = await hunterVerifyEmail('alice@x.com', { key: 'k', fetch: () => reply(202, {}) });
  assertEquals([slow.ok, slow.result, slow.error], [true, 'unknown', 'Hunter is still checking']);
  const down = await hunterVerifyEmail('alice@x.com', { key: 'k', fetch: () => Promise.reject(new Error('boom')) });
  assertEquals([down.ok, down.result, down.error], [false, 'unknown', 'boom']);
  assertEquals((await hunterEmailFinder('x.com', 'A', 'B', { key: null })).error, 'HUNTER_API_KEY not set');
  const a = await hunterAccount({ key: 'k', fetch: () => reply(200, { data: { plan_name: 'Starter', reset_date: '2026-10-01', requests: { searches: { used: 88, available: 500 }, verifications: { used: 20, available: 1000 } } } }) });
  assertEquals(hunterAccountLine(a), 'Hunter Starter: 412 of 500 searches and 980 of 1,000 verifications left until 1 October 2026.');
  const credits = await hunterAccount({ key: 'k', fetch: () => reply(200, { data: { plan_name: 'Starter', reset_date: '2027-05-03', calls: { used: 3095, available: 1997 }, requests: { credits: { used: 178.5, available: 24000, remaining: 23821.5 }, searches: { used: 0, available: 0 }, verifications: { used: 0, available: 0 } } } }) });
  assertEquals(hunterAccountLine(credits), 'Hunter Starter: 23,821.5 of 24,000 credits left until 3 May 2027.');
  assertEquals(hunterAccountLine(await hunterAccount({ key: 'k', fetch: () => reply(401, { errors: [{ details: 'No user found' }] }) })), 'Hunter: the key was refused: No user found');
});
