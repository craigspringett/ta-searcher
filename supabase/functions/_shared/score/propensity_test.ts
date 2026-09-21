import { assert, assertEquals } from '../test-assert.ts';
import { computePropensity, HAS_TALENT_LEAD_FACTOR, pointsFor, scoreBand, SIGNAL_POINTS, type SignalForScore } from './propensity.ts';

const TODAY = new Date('2026-09-10T09:00:00Z');
const sig = (code: string, strength: number, explanation = `${code} explanation`): SignalForScore => ({ code, label: code, strength, explanation });

Deno.test('no signals, no outcomes: zero', () => {
  const r = computePropensity({ today: TODAY, signals: [], outcomes: [] });
  assertEquals(r.score, 0);
  assertEquals(r.breakdown, []);
  assertEquals(r.topReason, null);
});

Deno.test('the points table is the brief\'s', () => {
  assertEquals(SIGNAL_POINTS.talent_role_open, [36, 40, 44]);
  assertEquals(SIGNAL_POINTS.hiring_surge, [14, 24, 34]);
  assertEquals(SIGNAL_POINTS.engineering_hiring, [8, 12, 16]);
  assertEquals(SIGNAL_POINTS.no_people_function, [22, 22, 22]);
  assertEquals(SIGNAL_POINTS.funding_round, [22, 30, 38]);
  assertEquals(SIGNAL_POINTS.shares_allotted, [12, 18, 24]);
  assertEquals(SIGNAL_POINTS.new_senior_officer, [12, 16, 20]);
  assertEquals(SIGNAL_POINTS.long_open_role, [22, 22, 24]);
  assertEquals(SIGNAL_POINTS.readvertised_role, [30, 30, 32]);
  assertEquals(SIGNAL_POINTS.staffing_pressure_stated, [20, 22, 25]);
  assertEquals(SIGNAL_POINTS.agency_advertising, [16, 20, 26]);
  assertEquals(SIGNAL_POINTS.staff_departure, [20, 26, 36]);
  assertEquals(SIGNAL_POINTS.expansion, [8, 12, 14]);
  assertEquals(SIGNAL_POINTS.accelerator, [6, 6, 6]);
  assertEquals(SIGNAL_POINTS.new_company, [8, 12, 12]);
  assertEquals(SIGNAL_POINTS.consultant_intel, [10, 10, 10]);
  assertEquals(Object.keys(SIGNAL_POINTS).length, 16);
  assertEquals(SIGNAL_POINTS.has_talent_lead, undefined, 'the adjustment scores nothing itself');
});

Deno.test('signals combine without exceeding 100, the strongest leads the breakdown, a weak one never lowers the score', () => {
  const one = computePropensity({ today: TODAY, signals: [sig('hiring_surge', 1)], outcomes: [] });
  assertEquals(one.score, 14);
  const two = computePropensity({ today: TODAY, signals: [sig('hiring_surge', 1), sig('funding_round', 2, 'Searchable raised a £2m seed round.')], outcomes: [] });
  assertEquals(two.score, Math.round(100 * (1 - 0.86 * 0.7)));
  assertEquals(two.topCode, 'funding_round');
  assertEquals(two.topReason, 'Searchable raised a £2m seed round.');
  const three = computePropensity({ today: TODAY, signals: [sig('hiring_surge', 1), sig('funding_round', 2), sig('accelerator', 1)], outcomes: [] });
  assert(three.score >= two.score);
  const many = computePropensity({ today: TODAY, signals: ['talent_role_open', 'hiring_surge', 'funding_round', 'no_people_function', 'staff_departure', 'long_open_role', 'readvertised_role'].map((c) => sig(c, 3)), outcomes: [] });
  assert(many.score > 90 && many.score <= 100, String(many.score));
  assertEquals(pointsFor(sig('unknown_code', 3)), 0);
  assertEquals(computePropensity({ today: TODAY, signals: [sig('unknown_code', 3)], outcomes: [] }).score, 0);
});

Deno.test('Searchable: a Series A with 13 open roles, an engineering push and nobody running hiring calls this week', () => {
  const r = computePropensity({ today: TODAY, signals: [sig('funding_round', 3), sig('hiring_surge', 2), sig('engineering_hiring', 2), sig('no_people_function', 2), sig('new_company', 1)], outcomes: [] });
  assertEquals(r.score, Math.round(100 * (1 - 0.62 * 0.76 * 0.88 * 0.78 * 0.92)));
  assertEquals(scoreBand(r.score), 'hot');
  assertEquals(r.topCode, 'funding_round');
});

Deno.test('a signal code counts once even if listed twice', () => {
  const r = computePropensity({ today: TODAY, signals: [sig('long_open_role', 2), sig('long_open_role', 2)], outcomes: [] });
  assertEquals(r.breakdown.length, 1);
  assertEquals(r.score, 22);
});

Deno.test('outcomes: not interested cuts to 40%, a recent conversation cools, a callback due lifts', () => {
  const signals = [sig('hiring_surge', 3), sig('expansion', 2)];
  const plain = computePropensity({ today: TODAY, signals, outcomes: [] }).score;
  assertEquals(plain, Math.round(100 * (1 - 0.66 * 0.88)));
  const ni = computePropensity({ today: TODAY, signals, outcomes: [{ kind: 'not_interested', createdAt: '2026-08-20T10:00:00Z' }] });
  assertEquals(ni.score, Math.round(plain * 0.4));
  assert(ni.breakdown.some((b) => b.code === 'not_interested' && b.reason.includes('20 Aug')));
  const oldNi = computePropensity({ today: TODAY, signals, outcomes: [{ kind: 'not_interested', createdAt: '2026-05-01T10:00:00Z' }] });
  assertEquals(oldNi.score, plain, 'ninety days on it is forgotten');
  const spoke = computePropensity({ today: TODAY, signals, outcomes: [{ kind: 'spoke_to', createdAt: '2026-09-05T10:00:00Z' }] });
  assertEquals(spoke.score, Math.round(100 * (1 - 0.66 * 0.88) * 0.7));
  const cb = computePropensity({ today: TODAY, signals, outcomes: [{ kind: 'callback', createdAt: '2026-09-01T10:00:00Z', callbackAt: '2026-09-14T09:00:00Z' }] });
  assertEquals(cb.score, Math.min(100, plain + 15));
  assert(cb.breakdown.some((b) => b.code === 'callback_due' && b.reason.includes('14 Sep')));
  const farCb = computePropensity({ today: TODAY, signals, outcomes: [{ kind: 'callback', createdAt: '2026-09-01T10:00:00Z', callbackAt: '2026-10-14T09:00:00Z' }] });
  assertEquals(farCb.score, plain, 'a callback next month is not this week');
});

Deno.test('stale signals fade: 85% after a fortnight, 60% after two months', () => {
  const signals = [sig('hiring_surge', 3)];
  assertEquals(computePropensity({ today: TODAY, signals, outcomes: [], computedAt: '2026-09-09T05:00:00Z' }).score, 34);
  assertEquals(computePropensity({ today: TODAY, signals, outcomes: [], computedAt: '2026-08-20T05:00:00Z' }).score, Math.round(34 * 0.85));
  assertEquals(computePropensity({ today: TODAY, signals, outcomes: [], computedAt: '2026-06-01T05:00:00Z' }).score, Math.round(34 * 0.6));
});

Deno.test('bands', () => {
  assertEquals(scoreBand(75), 'hot');
  assertEquals(scoreBand(30), 'warm');
  assertEquals(scoreBand(12), 'cool');
});

Deno.test('a Head of Talent already in post halves the score; it is never the reason for calling and scores nothing alone', () => {
  const plain = computePropensity({ today: TODAY, signals: [sig('hiring_surge', 3)], outcomes: [] });
  const lead = computePropensity({ today: TODAY, signals: [sig('hiring_surge', 3), sig('has_talent_lead', 1, 'Priya Shah is Head of Talent; the company has the function.')], outcomes: [] });
  assertEquals(plain.score, 34);
  assertEquals(lead.score, 17);
  const adj = lead.breakdown.find((b) => b.code === 'has_talent_lead');
  assertEquals(adj?.kind, 'adjustment');
  assertEquals(adj?.points, HAS_TALENT_LEAD_FACTOR);
  assertEquals(adj?.label, 'A Head of Talent is already in post');
  assertEquals(adj?.reason, 'Priya Shah is Head of Talent; the company has the function.');
  assertEquals(lead.topCode, 'hiring_surge', 'the discount is never the reason for calling');
  assertEquals(computePropensity({ today: TODAY, signals: [sig('has_talent_lead', 1)], outcomes: [] }).score, 0);
  assertEquals(pointsFor(sig('expansion', 1)), 8);
  assertEquals(pointsFor(sig('expansion', 2)), 12);
});
