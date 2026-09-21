// The default follow-up plan (Follow-ups slice 2): days 0, 2, 4, 8 and 14.
// Pure; schedule.ts works out the times.
//
// Craig, 18 September 2026: the first step of every run is an email, not a
// call. So: the introduction email the same afternoon (or the next working
// afternoon), the first call two days later once it has landed, the second
// email on day 4, the second call on day 8, the last email on day 14.

import { dueOnDay, dueSameAfternoon, type ScheduleOptions } from './schedule.ts';

export type StepKind = 'call' | 'email';

export interface PlanTemplateStep {
  day: number;
  kind: StepKind;
  /** What the step is, in the consultant's words. */
  label: string;
  /** What the drafter is told the email (or the two-line script) is for. */
  purpose: string;
}

export const DEFAULT_PLAN: PlanTemplateStep[] = [
  { day: 0, kind: 'email', label: 'First email, an introduction', purpose: 'first' },
  { day: 2, kind: 'call', label: 'First call, after the email', purpose: 'The first call, two days after the introduction email: a two-line opener that refers to it, or the approved script on the Scripts tab if the email has not gone. Log the outcome when you have made it.' },
  { day: 4, kind: 'email', label: 'Second email, tied to something real', purpose: 'second' },
  { day: 8, kind: 'call', label: 'Call again, with a two-line script', purpose: 'A short second call that refers to the two emails.' },
  { day: 14, kind: 'email', label: 'Last email, the door left open', purpose: 'last' },
];

export interface PlanStep extends PlanTemplateStep {
  stepNo: number;
  /** ISO instant. */
  dueAt: string;
}

/**
 * The plan for a sequence starting now: each step with its due instant.
 * Steps keep their order: one never falls due before the one before it.
 */
export function buildPlan(startedAt: Date, opts: ScheduleOptions = {}, template: PlanTemplateStep[] = DEFAULT_PLAN): PlanStep[] {
  const out: PlanStep[] = [];
  let previous = startedAt;
  template.forEach((t, i) => {
    let due: Date;
    if (t.day === 0 && t.kind === 'call') due = startedAt;
    else if (t.day === 0) due = dueSameAfternoon(startedAt, opts); // the introduction email: this afternoon, or the next working afternoon
    else due = dueOnDay(startedAt, t.day, t.kind, opts);
    if (due.getTime() < previous.getTime()) due = previous;
    previous = due;
    out.push({ ...t, stepNo: i + 1, dueAt: due.toISOString() });
  });
  return out;
}

/** The last day of the plan, for "runs to 1 October". */
export function planEndsAt(plan: PlanStep[]): string | null {
  return plan.length ? plan[plan.length - 1].dueAt : null;
}
