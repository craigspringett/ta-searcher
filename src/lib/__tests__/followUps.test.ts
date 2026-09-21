import { describe, expect, it } from "vitest";
import { dayHeading, groupByDay, type FollowUpSequence, type FollowUpStep } from "@/lib/followUps";

const step = (o: Partial<FollowUpStep>): FollowUpStep => ({ id: o.id || Math.random().toString(36).slice(2), sequence_id: "s", step_no: 1, kind: "email", day: 0, label: null, due_at: "2026-09-21T13:00:00Z", status: "scheduled", subject: null, body: null, hook: null, draft_generated_at: null, draft_flags: [], sent_message_id: null, outcome_id: null, completed_at: null, ...o });
const seq = (steps: FollowUpStep[], o: Partial<FollowUpSequence> = {}): FollowUpSequence => ({ id: "s", company_search_id: "sch", consultant_id: null, created_by: null, contact_name: "Testy Testy", contact_email: "t@example.com", contact_role: "Headteacher", vacancy_id: null, status: "active", stop_reason: null, started_at: "2026-09-18T19:00:00Z", ended_at: null, steps, ...o });

// Friday 18 September 2026, 21:00 London.
const now = new Date("2026-09-18T20:00:00Z");

describe("groupByDay", () => {
  it("puts open steps under their London day, overdue first, and leaves finished ones out", () => {
    const s = seq([
      step({ id: "a", step_no: 1, kind: "call", status: "done", due_at: "2026-09-18T19:18:00Z", completed_at: "2026-09-18T19:20:00Z" }),
      step({ id: "b", step_no: 2, due_at: "2026-09-21T11:00:00Z" }),
      step({ id: "c", step_no: 3, due_at: "2026-09-22T13:00:00Z" }),
      step({ id: "d", step_no: 4, kind: "call", status: "due", due_at: "2026-09-17T09:00:00Z" }),
    ]);
    const groups = groupByDay([s], now);
    expect(groups.map((g) => [g.heading, g.rows.map((r) => r.step.id)])).toEqual([
      ["Overdue", ["d"]],
      ["Monday 21 Sep", ["b"]],
      ["Tuesday 22 Sep", ["c"]],
    ]);
  });
  it("with everything, finished steps sit on the day they happened and stopped runs still show", () => {
    const s = seq([step({ id: "a", step_no: 1, kind: "call", status: "done", due_at: "2026-09-18T19:18:00Z", completed_at: "2026-09-18T19:20:00Z" }), step({ id: "b", step_no: 2, due_at: "2026-09-21T11:00:00Z" })], { status: "stopped", stop_reason: "they replied" });
    const groups = groupByDay([s], now, true);
    expect(groups.map((g) => [g.heading, g.rows.map((r) => r.step.id)])).toEqual([["Today", ["a"]], ["Monday 21 Sep", ["b"]]]);
    expect(groupByDay([s], now)).toEqual([]);
  });
});

describe("dayHeading", () => {
  it("says Today, Tomorrow, then the weekday and date", () => {
    expect(dayHeading("2026-09-18", now)).toBe("Today");
    expect(dayHeading("2026-09-19", now)).toBe("Tomorrow");
    expect(dayHeading("2026-09-21", now)).toBe("Monday 21 Sep");
    expect(dayHeading("2026-09-17", now)).toBe("Overdue");
    expect(dayHeading("2026-09-17", now, false)).toBe("Thursday 17 Sep");
  });
});
