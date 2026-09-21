import { assert, assertEquals } from '../test-assert.ts';
import { computePropensity, pointsFor, scoreBand, type SignalForScore } from './propensity.ts';

const TODAY = new Date('2026-09-10T09:00:00Z');
const sig = (code: string, strength: number, explanation = `${code} explanation`): SignalForScore => ({ code, label: code, strength, explanation });

Deno.test('no signals, no outcomes: zero', () => {
  const r = computePropensity({ today: TODAY, signals: [], outcomes: [] });
  assertEquals(r.score, 0);
  assertEquals(r.breakdown, []);
  assertEquals(r.topReason, null);
});

Deno.test('signals combine without exceeding 100, the strongest leads the breakdown, a weak one never lowers the score', () => {
  const one = computePropensity({ today: TODAY, signals: [sig('open_teaching_vacancies', 1)], outcomes: [] });
  assertEquals(one.score, 15);
  const two = computePropensity({ today: TODAY, signals: [sig('open_teaching_vacancies', 1), sig('staff_departure', 2, 'Mrs Patel is leaving at Christmas.')], outcomes: [] });
  assertEquals(two.score, Math.round(100 * (1 - 0.85 * 0.74)));
  assertEquals(two.topCode, 'staff_departure');
  assertEquals(two.topReason, 'Mrs Patel is leaving at Christmas.');
  const three = computePropensity({ today: TODAY, signals: [sig('open_teaching_vacancies', 1), sig('staff_departure', 2), sig('term_start_near', 1)], outcomes: [] });
  assert(three.score >= two.score);
  const many = computePropensity({ today: TODAY, signals: ['staff_departure', 'readvertised_role', 'long_open_role', 'open_teaching_vacancies', 'agency_advertising', 'new_headteacher', 'ofsted_change'].map((c) => sig(c, 3)), outcomes: [] });
  assert(many.score > 90 && many.score <= 100, String(many.score));
  assertEquals(pointsFor(sig('unknown_code', 3)), 0);
  assertEquals(computePropensity({ today: TODAY, signals: [sig('unknown_code', 3)], outcomes: [] }).score, 0);
});

Deno.test('a signal code counts once even if listed twice', () => {
  const r = computePropensity({ today: TODAY, signals: [sig('long_open_role', 2), sig('long_open_role', 2)], outcomes: [] });
  assertEquals(r.breakdown.length, 1);
  assertEquals(r.score, 22);
});

Deno.test('outcomes: not interested cuts to 40%, a recent conversation cools, a callback due lifts', () => {
  const signals = [sig('open_teaching_vacancies', 3), sig('agency_spend_high', 2)];
  const plain = computePropensity({ today: TODAY, signals, outcomes: [] }).score;
  const ni = computePropensity({ today: TODAY, signals, outcomes: [{ kind: 'not_interested', createdAt: '2026-08-20T10:00:00Z' }] });
  assertEquals(ni.score, Math.round(plain * 0.4));
  assert(ni.breakdown.some((b) => b.code === 'not_interested' && b.reason.includes('20 Aug')));
  const oldNi = computePropensity({ today: TODAY, signals, outcomes: [{ kind: 'not_interested', createdAt: '2026-05-01T10:00:00Z' }] });
  assertEquals(oldNi.score, plain, 'ninety days on it is forgotten');
  const spoke = computePropensity({ today: TODAY, signals, outcomes: [{ kind: 'spoke_to', createdAt: '2026-09-05T10:00:00Z' }] });
  assertEquals(spoke.score, 28, 'the unrounded 40.5 times 0.7');
  const cb = computePropensity({ today: TODAY, signals, outcomes: [{ kind: 'callback', createdAt: '2026-09-01T10:00:00Z', callbackAt: '2026-09-14T09:00:00Z' }] });
  assertEquals(cb.score, Math.min(100, plain + 15));
  assert(cb.breakdown.some((b) => b.code === 'callback_due' && b.reason.includes('14 Sep')));
  const farCb = computePropensity({ today: TODAY, signals, outcomes: [{ kind: 'callback', createdAt: '2026-09-01T10:00:00Z', callbackAt: '2026-10-14T09:00:00Z' }] });
  assertEquals(farCb.score, plain, 'a callback next month is not this week');
});

Deno.test('stale signals fade: 85% after a fortnight, 60% after two months', () => {
  const signals = [sig('open_teaching_vacancies', 3)];
  assertEquals(computePropensity({ today: TODAY, signals, outcomes: [], computedAt: '2026-09-09T05:00:00Z' }).score, 30);
  assertEquals(computePropensity({ today: TODAY, signals, outcomes: [], computedAt: '2026-08-20T05:00:00Z' }).score, Math.round(30 * 0.85));
  assertEquals(computePropensity({ today: TODAY, signals, outcomes: [], computedAt: '2026-06-01T05:00:00Z' }).score, 18);
});

Deno.test('bands', () => {
  assertEquals(scoreBand(75), 'hot');
  assertEquals(scoreBand(30), 'warm');
  assertEquals(scoreBand(12), 'cool');
});

Deno.test('a company that says it uses no supply staff is discounted a little; expansion is worth less when vague', () => {
  const plain = computePropensity({ today: TODAY, signals: [sig('agency_spend_high', 3)], outcomes: [] });
  const self = computePropensity({ today: TODAY, signals: [sig('agency_spend_high', 3), sig('self_sufficient_stated', 1, 'Paddington Academy states that it makes no use of supply teachers; lead with the framework.')], outcomes: [] });
  assertEquals(plain.score, 22);
  assertEquals(self.score, Math.round(22 * 0.85));
  const adj = self.breakdown.find((b) => b.code === 'self_sufficient');
  assertEquals(adj?.kind, 'adjustment');
  assertEquals(adj?.points, 0.85);
  assertEquals(self.topCode, 'agency_spend_high', 'the discount is never the reason for calling');
  assertEquals(computePropensity({ today: TODAY, signals: [sig('self_sufficient_stated', 1)], outcomes: [] }).score, 0);
  assertEquals(pointsFor(sig('expansion', 1)), 8);
  assertEquals(pointsFor(sig('expansion', 2)), 12);
});
