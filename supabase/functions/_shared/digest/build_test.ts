import { assert, assertEquals } from '../test-assert.ts';
import { buildDigest, digestSettingsFromValue, inTheWeek, type DigestProspectRow } from './build.ts';

const NOW = new Date('2026-09-22T07:00:00.000Z');
const row = (over: Partial<DigestProspectRow>): DigestProspectRow => ({ id: 'p', name: 'X', website: null, status: 'qualified', sources: [], raise: null, register: null, talent_postings: [], prospect_score: null, first_seen_at: '2026-09-20T05:30:00.000Z', promoted_company_id: null, ...over });

Deno.test('digest: settings default to on, every sector, every named stage, every consultant', () => {
  assertEquals(digestSettingsFromValue(null), { enabled: true, sectors: [], stages: [], recipients: [] });
  assertEquals(digestSettingsFromValue({ enabled: false, sectors: ['Fintech', 'Nonsense'], stages: ['Seed'], recipients: ['Craig@Example.com', 'x'] }), { enabled: false, sectors: ['Fintech'], stages: ['Seed'], recipients: ['craig@example.com'] });
});

Deno.test('digest: only raises of the last week that are not dismissed', () => {
  assert(inTheWeek(row({ raise: { amountText: '£2m', round: 'seed', date: '2026-09-18' } }), NOW));
  assert(!inTheWeek(row({ raise: { amountText: '£2m', round: 'seed', date: '2026-09-01' } }), NOW), 'too old');
  assert(inTheWeek(row({ raise: { amountText: '£2m', round: 'seed', date: null } }), NOW), 'undated: first seen this week');
  assert(!inTheWeek(row({ raise: { amountText: '£2m', round: 'seed', date: '2026-09-18' }, status: 'dismissed' }), NOW));
  assert(!inTheWeek(row({ raise: null }), NOW));
});

Deno.test('digest: grouped by sector, filtered by the chosen sectors and stages, subject counts', () => {
  const rows = [
    row({ id: 'a', name: 'Sprive', raise: { amountText: '$10m', amountGbp: 7_500_000, round: 'Series A', date: '2026-09-21', url: 'https://n/1' }, sources: [{ source: 'funding_news', url: 'https://n/1', title: 'Fintech Sprive raises $10m Series A', at: '2026-09-21T00:00:00Z' }], prospect_score: 40 }),
    row({ id: 'b', name: 'Crimson', raise: { amountText: '$2.5m', amountGbp: 1_900_000, round: 'seed', date: '2026-09-19', url: 'https://n/2' }, sources: [{ source: 'funding_news', url: 'https://n/2', title: 'Legaltech Crimson raises $2.5m seed', at: '2026-09-19T00:00:00Z' }], promoted_company_id: 'c1' }),
    row({ id: 'c', name: 'Bigco', raise: { amountText: '£40m', amountGbp: 40_000_000, round: 'Series C', date: '2026-09-20' }, sources: [{ source: 'funding_news', url: 'https://n/3', title: 'Fintech Bigco raises £40m Series C' }] }),
  ];
  const all = buildDigest(rows, digestSettingsFromValue(null), 'https://app', NOW);
  assertEquals(all.count, 3);
  assertEquals(all.sections.map((s) => `${s.sector}:${s.items.length}`), ['Fintech:2', 'Legaltech:1']);
  assertEquals(all.sections[0].items.map((i) => i.name), ['Sprive', 'Bigco'], 'newest first');
  assertEquals(all.sections[1].items[0].appUrl, 'https://app/companies/c1');
  assertEquals(all.sections[1].items[0].tracked, true);
  assertEquals(all.sections[0].items[0].raiseLine, '$10m Series A');
  assertEquals(all.subject, '3 new raises in your sectors this week');
  const early = buildDigest(rows, digestSettingsFromValue({ sectors: ['Fintech'], stages: ['Seed', 'Series A'] }), 'https://app', NOW);
  assertEquals(early.count, 1);
  assertEquals(early.filteredOut, 2);
  assertEquals(early.sections[0].items[0].name, 'Sprive');
  const none = buildDigest([], digestSettingsFromValue(null), 'https://app', NOW);
  assertEquals(none.subject, 'No new raises in your sectors this week');
});
