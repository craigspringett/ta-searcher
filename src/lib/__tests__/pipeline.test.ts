import { describe, expect, it } from "vitest";
import { boardSummary, groupByStage, stageOf, timeInStage, type PipelineCompany } from "../pipeline";

const row = (over: Partial<PipelineCompany>): PipelineCompany => ({ id: "x", name: "X", stage: "prospect", movedAt: null, sector: null, fundingStage: null, score: null, lastOutcome: null, nextCallback: null, openRoles: 0, ...over });

describe("pipeline", () => {
  it("reads a stage, falling back to prospect", () => {
    expect(stageOf("call_booked")).toBe("call_booked");
    expect(stageOf("nonsense")).toBe("prospect");
    expect(stageOf(null)).toBe("prospect");
  });
  it("says how long a company has sat in its column", () => {
    const now = new Date("2026-09-22T12:00:00Z");
    expect(timeInStage("2026-09-22T09:00:00Z", now)).toBe("today");
    expect(timeInStage("2026-09-21T09:00:00Z", now)).toBe("1 day");
    expect(timeInStage("2026-09-15T09:00:00Z", now)).toBe("7 days");
    expect(timeInStage("2026-08-01T09:00:00Z", now)).toBe("7 weeks");
    expect(timeInStage(null, now)).toBe("");
  });
  it("groups by column with the best score first, and sums the board up", () => {
    const rows = [
      row({ id: "a", name: "A", stage: "prospect", score: 40 }),
      row({ id: "b", name: "B", stage: "prospect", score: 80 }),
      row({ id: "c", name: "C", stage: "contacted", score: null }),
      row({ id: "d", name: "D", stage: "lost" }),
    ];
    const g = groupByStage(rows);
    expect(g.prospect.map((r) => r.id)).toEqual(["b", "a"]);
    expect(g.contacted.map((r) => r.id)).toEqual(["c"]);
    expect(g.call_booked).toEqual([]);
    expect(boardSummary(rows)).toBe("4 companies: 2 prospects, 1 contacted, 1 not now.");
    expect(boardSummary([])).toMatch(/^No companies on the board yet/);
  });
});
