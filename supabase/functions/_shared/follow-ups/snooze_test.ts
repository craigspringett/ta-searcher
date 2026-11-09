import { assertEquals } from 'jsr:@std/assert@1';
import { planSnooze, type SnoozableStep } from './snooze.ts';

const steps: SnoozableStep[] = [
  { id: 'a', step_no: 1, kind: 'email', status: 'sent', due_at: '2026-11-03T14:00:00.000Z' },
  { id: 'b', step_no: 2, kind: 'call', status: 'due', due_at: '2026-11-05T10:00:00.000Z' },
  { id: 'c', step_no: 3, kind: 'email', status: 'scheduled', due_at: '2026-11-09T14:00:00.000Z' },
  { id: 'd', step_no: 4, kind: 'call', status: 'scheduled', due_at: '2026-11-11T10:00:00.000Z' },
  { id: 'e', step_no: 5, kind: 'email', status: 'scheduled', due_at: '2026-11-17T14:00:00.000Z' },
];
const now = new Date('2026-11-05T09:00:00Z');

Deno.test('snoozing a call moves it and every later step by the same gaps', () => {
  const r = planSnooze(steps, 'b', '2026-11-10', now);
  if ('error' in r) throw new Error(r.error);
  assertEquals(r.moves.map((m) => [m.stepNo, m.newDueAt]), [
    [2, '2026-11-10T10:00:00.000Z'], // Tuesday call
    [3, '2026-11-16T14:00:00.000Z'], // 4 days on is Saturday: Monday 14:00 (the gap was 4 days)
    [4, '2026-11-18T10:00:00.000Z'],
    [5, '2026-11-24T14:00:00.000Z'], // a Tuesday
  ]);
});

Deno.test('finished steps are never touched', () => {
  const r = planSnooze(steps, 'b', '2026-11-10', now);
  if ('error' in r) throw new Error(r.error);
  assertEquals(r.moves.some((m) => m.id === 'a'), false);
});

Deno.test('a weekend date rolls to Monday and the Monday rule applies to emails', () => {
  const r = planSnooze(steps, 'c', '2026-11-14', now);
  if ('error' in r) throw new Error(r.error);
  assertEquals(r.moves[0].newDueAt, '2026-11-16T14:00:00.000Z');
});

Deno.test('a sent step, a past day and a bad date are refused', () => {
  assertEquals('error' in planSnooze(steps, 'a', '2026-11-10', now), true);
  assertEquals('error' in planSnooze(steps, 'b', '2026-11-04', now), true);
  assertEquals('error' in planSnooze(steps, 'b', 'next week', now), true);
});

Deno.test('steps never fall out of order', () => {
  const r = planSnooze(steps, 'b', '2026-12-01', now);
  if ('error' in r) throw new Error(r.error);
  const times = r.moves.map((m) => new Date(m.newDueAt).getTime());
  assertEquals([...times].sort((x, y) => x - y), times);
});
