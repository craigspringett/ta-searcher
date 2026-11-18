import { describe, expect, it } from "vitest";
import { canPick, companyLine, contactState, formatDue, fundingStage, laterToApprove, sectorOf, DEFAULT_STAGES, needsWriting, validateCampaign, type CampaignSeq, type PickedContact } from "@/lib/campaigns";

const pc = (company: string, n: number): PickedContact => ({ companyId: company, companyName: company, name: `P${n}`, role: null, email: `p${n}@x.org` });
const step = (n: number, o: Partial<CampaignSeq["steps"][number]> = {}) => ({ step_no: n, kind: "email", status: "due", subject: null, body: null, due_at: "2026-11-18T14:00:00Z", label: null, draft_flags: [], ...o });

describe("campaigns", () => {
  it("allows two contacts at a company and fifteen in all", () => {
    expect(canPick([pc("a", 1)], pc("a", 2)).ok).toBe(true);
    expect(canPick([pc("a", 1), pc("a", 2)], pc("a", 3)).reason).toMatch(/At most 2/);
    const fifteen = Array.from({ length: 15 }, (_, i) => pc(`s${i}`, i));
    expect(canPick(fifteen, pc("z", 99)).reason).toMatch(/at most 15/);
    expect(canPick([pc("a", 1)], pc("b", 1)).reason).toBe("Already picked.");
  });
  it("checks the form", () => {
    expect(validateCampaign("", DEFAULT_STAGES, [pc("a", 1)])).toMatch(/name/);
    expect(validateCampaign("X", DEFAULT_STAGES, [])).toMatch(/at least one/);
    expect(validateCampaign("X", DEFAULT_STAGES, [pc("a", 1)])).toBeNull();
    expect(validateCampaign("X", [{ id: 1, kind: "call", day: 0 }], [pc("a", 1)])).toMatch(/first stage/);
  });
  it("says where a contact is", () => {
    const writing: CampaignSeq = { status: "active", stop_reason: null, steps: [step(1), step(2, { kind: "call" })] };
    expect(contactState(writing).state).toBe("writing");
    expect(needsWriting(writing)).toBe(true);
    const ready: CampaignSeq = { status: "active", stop_reason: null, steps: [step(1, { body: "Hi" })] };
    expect(contactState(ready).state).toBe("approve");
    expect(needsWriting(ready)).toBe(false);
    expect(contactState({ status: "active", stop_reason: null, steps: [step(1, { status: "sent", body: "Hi" })] }).state).toBe("running");
    const later: CampaignSeq = { status: "active", stop_reason: null, steps: [step(1, { status: "sent", body: "Hi" }), step(2, { kind: "call" }), step(3, { body: "Second", status: "scheduled" }), step(4, { body: "Third", status: "scheduled", campaign_approved_at: "2026-11-18T10:00:00Z" })] };
    expect(contactState(later)).toEqual({ state: "approve_later", label: "1 later email to approve" });
    expect(laterToApprove(later).map((s) => s.step_no)).toEqual([3]);
    expect(contactState({ status: "stopped", stop_reason: "replied", steps: [] }).label).toBe("Stopped: replied");
  });
  it("reads the funding stage and the sector the analysis holds", () => {
    expect(fundingStage("series_a")).toBe("series_a");
    expect(fundingStage("Pre-seed")).toBe("pre_seed");
    expect(fundingStage("series_b_plus")).toBe("series_b_plus");
    expect(fundingStage("unknown")).toBe("unknown");
    expect(fundingStage(null)).toBe("unknown");
    expect(sectorOf("Metris Energy is a software company incorporated in 2023, registered in London.")).toBe("Software");
    expect(sectorOf("Tano is a data and platforms company incorporated in 2025")).toBe("Data and platforms");
    expect(sectorOf("POV Beauty is a company. No open role is showing.")).toBe("Not known");
    expect(sectorOf(null)).toBe("Not known");
    expect(companyLine("seed", "Software", 3)).toBe("Seed · Software");
    expect(companyLine("unknown", "Not known", 0)).toBe("Stage not known · no open roles");
  });
  it("writes a due time in London words", () => {
    expect(formatDue("2026-11-09T14:00:00Z")).toBe("Mon 9 Nov, 14:00");
    expect(formatDue("2026-07-09T13:00:00Z")).toBe("Thu 9 Jul, 14:00");
    expect(formatDue(null)).toBe("");
  });
});
