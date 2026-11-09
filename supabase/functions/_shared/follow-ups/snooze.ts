// Snooze (Craig, 9 November 2026): move a follow-up step to a later day, and
// every step after it by the same amount, so the gaps between the steps stay
// what the plan made them. Pure and tested; the follow-ups function stores
// what this works out.
//
// The chosen step lands on the chosen London day at its usual time (the
// schedule rules still apply: a weekend rolls to Monday, a Thursday email goes
// on the Friday, never a Monday morning). Each later step keeps its gap in
// calendar days from the step before it, then the same rules apply. Steps
// already finished are never touched, and no step ever falls before the one
// before it.

import { dueOnDay, londonDate, londonInstant, type ScheduleOptions } from './schedule.ts';

export interface SnoozableStep {
  id: string;
  step_no: number;
  kind: 'call' | 'email';
  status: string;
  due_at: string;
}

export interface SnoozeMove {
  id: string;
  stepNo: number;
  oldDueAt: string;
  newDueAt: string;
}

const OPEN = ['scheduled', 'due', 'approved'];

function dayNumber(iso: string): number {
  const [y, m, d] = londonDate(new Date(iso)).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/** "YYYY-MM-DD" as a London noon instant, the base the day rules work from. */
function dateToInstant(date: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const d = londonInstant(Number(m[1]), Number(m[2]), Number(m[3]), 12, 0);
  return londonDate(d) === date ? d : null;
}

/**
 * The moves for snoozing `stepId` to `untilDate` (London, "YYYY-MM-DD").
 * Returns an error string when it cannot be done.
 */
export function planSnooze(steps: SnoozableStep[], stepId: string, untilDate: string, now: Date, opts: ScheduleOptions = {}): { moves: SnoozeMove[] } | { error: string } {
  const ordered = [...steps].sort((a, b) => a.step_no - b.step_no);
  const target = ordered.find((s) => s.id === stepId);
  if (!target) return { error: 'Step not found.' };
  if (!OPEN.includes(target.status)) return { error: `This step is already ${target.status}.` };
  const base = dateToInstant(untilDate);
  if (!base) return { error: 'Pick a date.' };
  if (untilDate < londonDate(now)) return { error: 'Pick today or a day in the future.' };

  const moves: SnoozeMove[] = [];
  let previousNew = dueOnDay(base, 0, target.kind, opts);
  // A snooze to today for a step that is already due today changes nothing worth recording.
  moves.push({ id: target.id, stepNo: target.step_no, oldDueAt: target.due_at, newDueAt: previousNew.toISOString() });
  let previousOld = target.due_at;
  for (const s of ordered) {
    if (s.step_no <= target.step_no || !OPEN.includes(s.status)) continue;
    const gap = Math.max(1, dayNumber(s.due_at) - dayNumber(previousOld));
    const nominal = dateToInstant(londonDate(new Date(previousNew.getTime() + gap * 86400000 + 3600000)));
    let due = dueOnDay(nominal || previousNew, 0, s.kind, opts);
    if (due.getTime() < previousNew.getTime()) due = previousNew;
    moves.push({ id: s.id, stepNo: s.step_no, oldDueAt: s.due_at, newDueAt: due.toISOString() });
    previousOld = s.due_at;
    previousNew = due;
  }
  return { moves };
}
