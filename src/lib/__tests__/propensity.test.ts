import { describe, expect, it } from "vitest";
import { orderedBreakdown, parseScoreRow, pointsText, scoreBand, topReasons, type ScoreLine } from "../propensity";

const lines: ScoreLine[] = [
  { code: "not_interested", label: "Said not interested", points: 0.4, reason: "Said no on 20 Aug.", kind: "adjustment" },
  { code: "open_teaching_vacancies", label: "Open teaching vacancies", points: 22, reason: "2 teaching vacancies are live.", kind: "signal" },
  { code: "staff_departure", label: "Staff leaving", points: 36, reason: "Mrs Patel is leaving at Christmas.", kind: "signal" },
  { code: "callback_due", label: "Callback due", points: 15, reason: "Callback promised for 14 Sep.", kind: "adjustment" },
];

describe("propensity presentation", () => {
  it("bands", () => {
    expect(scoreBand(60)).toBe("hot");
    expect(scoreBand(59)).toBe("warm");
    expect(scoreBand(0)).toBe("cool");
    expect(scoreBand(null)).toBeNull();
  });
  it("orders signals by points, then the adjustments as applied", () => {
    expect(orderedBreakdown(lines).map((l) => l.code)).toEqual(["staff_departure", "open_teaching_vacancies", "not_interested", "callback_due"]);
  });
  it("shows points as plus, multiplier or bonus", () => {
    expect(pointsText(lines[2])).toBe("+36");
    expect(pointsText(lines[0])).toBe("×0.4");
    expect(pointsText(lines[3])).toBe("+15");
  });
  it("top reasons", () => {
    expect(topReasons(lines, 2)).toEqual(["Staff leaving (+36)", "Open teaching vacancies (+22)"]);
  });
  it("parses a row and tolerates a bad breakdown", () => {
    expect(parseScoreRow(null)).toBeNull();
    const s = parseScoreRow({ score: 41, breakdown: [{ code: "x", label: "X", points: 10, reason: "r", kind: "signal" }, null], top_reason: "r", top_code: "x", computed_at: "2026-09-10T06:00:00Z" })!;
    expect(s.score).toBe(41);
    expect(s.breakdown).toHaveLength(1);
    expect(parseScoreRow({ score: 5, breakdown: "nope", top_reason: null, top_code: null, computed_at: null })!.breakdown).toEqual([]);
  });
});
