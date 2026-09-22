import { describe, expect, it } from "vitest";
import { filterInvestors, groupByInvestor, investorFromStatement, investorKey, investorsOf } from "../investors";

describe("investors", () => {
  it("reads the fund from an investor fact", () => {
    expect(investorFromStatement("Plural is an investor in Augur.")).toBe("Plural");
    expect(investorFromStatement("Bessemer Venture Partners is an investor in Upwind.")).toBe("Bessemer Venture Partners");
    expect(investorFromStatement("The round was led by Zinc.")).toBeNull();
    expect(investorFromStatement("Zinc led the seed round.")).toBe("Zinc");
    expect(investorFromStatement("Existing investors are backing the company.")).toBeNull();
  });
  it("keys names so spellings merge", () => {
    expect(investorKey("Bessemer Venture Partners")).toBe("bessemer");
    expect(investorKey("Index Ventures")).toBe("index");
    expect(investorKey("General Catalyst")).toBe("general catalyst");
  });
  it("lists every investor an analysis carries, once", () => {
    const ar = { latestRaise: { amountText: null, amountGbp: null, round: null, date: null, investors: ["Plural", "Zinc"], statement: "", source_url: "" }, facts: [{ id: "f1", kind: "investor", statement: "Plural is an investor in Augur.", quote: "", source_url: "" }, { id: "f2", kind: "hiring_plan", statement: "x", quote: "", source_url: "" }] };
    expect(investorsOf(ar)).toEqual(["Plural", "Zinc"]);
    expect(investorsOf(null)).toEqual([]);
  });
  it("groups companies under each fund, most companies first, and filters", () => {
    const co = (id: string, name: string, score: number | null) => ({ id, name, fundingStage: null, raise: null, score, pipelineStage: null });
    const groups = groupByInvestor([
      { company: co("a", "Augur", 60), investors: ["Plural"] },
      { company: co("u", "Upwind", 35), investors: ["Greylock", "Bessemer Venture Partners"] },
      { company: co("l", "Legora", 30), investors: ["General Catalyst", "Bessemer"] },
    ]);
    expect(groups.map((g) => `${g.name}:${g.companies.length}`)).toEqual(["Bessemer Venture Partners:2", "General Catalyst:1", "Greylock:1", "Plural:1"]);
    expect(groups[0].companies.map((c) => c.name)).toEqual(["Upwind", "Legora"]);
    expect(filterInvestors(groups, "grey").map((g) => g.name)).toEqual(["Greylock"]);
    expect(filterInvestors(groups, "legora").map((g) => g.name)).toEqual(["Bessemer Venture Partners", "General Catalyst"]);
  });
});
