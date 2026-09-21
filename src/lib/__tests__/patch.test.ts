import { describe, expect, it, vi } from "vitest";

// patch.ts also holds the loader, which needs the browser client; the
// derivations under test never touch it.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { countTalentRoles, derivePatchFields, formatLongDate, latestRaiseDetail, latestRaiseLine, raisedWithin, stageLabel } from "../patch";

describe("stageLabel", () => {
  it("names every stage and falls back to Unknown", () => {
    expect(stageLabel("pre_seed")).toBe("Pre-seed");
    expect(stageLabel("seed")).toBe("Seed");
    expect(stageLabel("series_a")).toBe("Series A");
    expect(stageLabel("series_b_plus")).toBe("Series B and later");
    expect(stageLabel("unknown")).toBe("Unknown");
    expect(stageLabel(null)).toBe("Unknown");
    expect(stageLabel("ipo")).toBe("Unknown");
  });
});

describe("countTalentRoles", () => {
  it("counts the people and talent family only", () => {
    expect(countTalentRoles([
      { family: "people_talent" },
      { family: "engineering" },
      { family: "people_talent" },
      { family: "leadership" },
      { family: null },
      {},
    ])).toBe(2);
    expect(countTalentRoles([])).toBe(0);
    expect(countTalentRoles(undefined)).toBe(0);
  });
});

describe("latestRaiseLine and latestRaiseDetail", () => {
  it("joins the amount and the round, either on its own", () => {
    expect(latestRaiseLine({ amountText: "£4.2m", round: "Series A" })).toBe("£4.2m Series A");
    expect(latestRaiseLine({ amountText: null, round: "Seed" })).toBe("Seed");
    expect(latestRaiseLine({ amountText: "$10m", round: null })).toBe("$10m");
    expect(latestRaiseLine({ amountText: " ", round: "" })).toBe("");
    expect(latestRaiseLine(null)).toBe("");
  });

  it("writes the date and the investors for the tooltip", () => {
    expect(latestRaiseDetail({ date: "2026-03-12", investors: ["Index Ventures", "Seedcamp"] })).toBe("12 March 2026, with Index Ventures and Seedcamp");
    expect(latestRaiseDetail({ date: "2026-03-12", investors: ["A", "B", "C"] })).toBe("12 March 2026, with A, B and C");
    expect(latestRaiseDetail({ date: null, investors: ["Seedcamp"] })).toBe("With Seedcamp");
    expect(latestRaiseDetail({ date: "2025-11-01", investors: [] })).toBe("1 November 2025");
    expect(latestRaiseDetail({ date: null, investors: [] })).toBe("");
    expect(latestRaiseDetail(null)).toBe("");
  });

  it("formats an ISO date the long way and passes anything else through", () => {
    expect(formatLongDate("2026-09-21")).toBe("21 September 2026");
    expect(formatLongDate("spring 2026")).toBe("spring 2026");
  });

  it("knows whether a raise is recent", () => {
    const now = new Date("2026-09-21T00:00:00Z");
    expect(raisedWithin({ date: "2026-03-12" }, 12, now)).toBe(true);
    expect(raisedWithin({ date: "2025-03-12" }, 12, now)).toBe(false);
    expect(raisedWithin({ date: null }, 12, now)).toBe(false);
    expect(raisedWithin(null, 12, now)).toBe(false);
  });
});

describe("derivePatchFields", () => {
  it("reads the register, the stage, the roles and the raise from analysis_result", () => {
    const fields = derivePatchFields({
      companyRecord: { companyNumber: "12345678", name: "Searchable Ltd", status: "active", incorporationDate: "2023-01-10", sicCodes: ["62012"] },
      stage: { label: "series_a", evidence: "We closed our Series A", source_url: "https://example.com/blog" },
      latestRaise: { amountText: "£8m", amountGbp: 8_000_000, round: "Series A", date: "2026-02-01", investors: ["Index Ventures"], statement: "…", source_url: "https://example.com/blog" },
      recruitmentInsights: { currentVacancies: [{ title: "Head of Talent", family: "people_talent" }, { title: "Backend Engineer", family: "engineering" }] },
      vacancyRun: { at: "2026-09-19T05:10:00Z", degraded: false },
      websiteAccess: null,
    }, "searchable");
    expect(fields.name).toBe("Searchable Ltd");
    expect(fields.status).toBe("active");
    expect(fields.stage).toBe("series_a");
    expect(fields.stageEvidence).toBe("We closed our Series A");
    expect(fields.sector).toBe("Software");
    expect(fields.openRoles).toBe(2);
    expect(fields.talentRoles).toBe(1);
    expect(fields.latestRaise?.round).toBe("Series A");
    expect(fields.lastAnalysed).toBe("2026-09-19T05:10:00Z");
    expect(fields.degraded).toBe(false);
  });

  it("copes with an empty analysis", () => {
    const fields = derivePatchFields(null, "Acme");
    expect(fields).toEqual({ name: "Acme", status: null, stage: "unknown", stageEvidence: null, sector: null, openRoles: 0, talentRoles: 0, latestRaise: null, lastAnalysed: null, degraded: false, websiteAccess: null });
  });
});
