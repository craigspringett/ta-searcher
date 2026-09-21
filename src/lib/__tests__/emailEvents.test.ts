import { describe, expect, it } from "vitest";
import { engagementLine, linkWord, warmLine, warmCompanies, type EmailEvent } from "../emailEvents";

const now = new Date("2026-09-17T10:00:00");
const ev = (event_type: string, occurred_at: string, extra: Partial<EmailEvent> = {}): EmailEvent => ({
  event_type,
  recipient_email: "head@company.sch.uk",
  occurred_at,
  url: null,
  company_search_id: "s1",
  contact_name: "Mrs Patel",
  message_id: "m1",
  ...extra,
});

describe("engagementLine", () => {
  it("is nothing when the contact was never emailed", () => {
    expect(engagementLine("head@company.sch.uk", [], [], now)).toBeNull();
    expect(engagementLine("other@company.sch.uk", [ev("opened", "2026-09-17T09:12:00")], [], now)).toBeNull();
  });
  it("reads: emailed, opened twice with the last time, clicked the careers link", () => {
    const events = [
      ev("sent", "2026-09-16T15:02:00"),
      ev("delivered", "2026-09-16T15:02:05"),
      ev("opened", "2026-09-16T17:40:00"),
      ev("opened", "2026-09-17T09:12:00"),
      ev("clicked", "2026-09-17T09:13:00", { url: "https://jobs.ashbyhq.com/metris/senior-engineer" }),
    ];
    expect(engagementLine("Head@Company.sch.uk", events, [], now)).toBe("Emailed 16 Sep. Opened twice, last 09:12 today. Clicked the careers link.");
  });
  it("counts only the latest email's opens", () => {
    const events = [
      ev("sent", "2026-09-10T15:02:00"),
      ev("opened", "2026-09-10T17:40:00"),
      ev("opened", "2026-09-11T08:00:00"),
      ev("sent", "2026-09-17T08:00:00"),
      ev("delivered", "2026-09-17T08:00:04"),
    ];
    expect(engagementLine("head@company.sch.uk", events, [], now)).toBe("Emailed 17 Sep 08:00. Delivered, not opened yet (or opened in a mail app that hides it).");
  });
  it("uses the emailed outcome for the date when no sent event has arrived", () => {
    expect(engagementLine("head@company.sch.uk", [], [{ created_at: "2026-09-16T15:00:00", contact_name: "Mrs Patel", contact_email: "head@company.sch.uk" }], now)).toBe("Emailed 16 Sep.");
  });
  it("says so when the email bounced or was marked as spam", () => {
    expect(engagementLine("head@company.sch.uk", [ev("sent", "2026-09-16T15:02:00"), ev("bounced", "2026-09-16T15:02:30")], [], now)).toBe("Emailed 16 Sep. Bounced: the address does not work.");
    expect(engagementLine("head@company.sch.uk", [ev("sent", "2026-09-16T15:02:00"), ev("opened", "2026-09-16T16:00:00"), ev("complained", "2026-09-16T16:01:00")], [], now)).toBe("Emailed 16 Sep. Marked as spam; do not email again.");
  });
  it("names the link in plain words", () => {
    expect(linkWord("https://jobs.lever.co/metris/123")).toBe("the careers link");
    expect(linkWord("https://www.bigfishrecruitment.co.uk/about")).toBe("the Big Fish Recruitment link");
    expect(linkWord("https://find-and-update.company-information.service.gov.uk/company/14567890")).toBe("the register link");
    expect(linkWord("https://example.com/x")).toBe("a link");
    expect(linkWord(null)).toBe("a link");
  });
});

describe("warmCompanies", () => {
  const events = [
    ev("opened", "2026-09-17T09:12:00", { company_search_id: "s1" }),
    ev("opened", "2026-09-16T17:40:00", { company_search_id: "s1" }),
    ev("clicked", "2026-09-17T08:40:00", { company_search_id: "s2", contact_name: "Mr Khan", recipient_email: "sbm@two.sch.uk", url: "https://tes.com/jobs/1" }),
    ev("opened", "2026-09-17T09:50:00", { company_search_id: "s3", contact_name: "Ms Lee", recipient_email: "head@three.sch.uk" }),
    ev("opened", "2026-09-15T09:50:00", { company_search_id: "s4" }),
    ev("delivered", "2026-09-17T09:55:00", { company_search_id: "s5" }),
    ev("opened", "2026-09-17T09:56:00", { company_search_id: null }),
  ];
  it("ranks companies with an open or click in the last 24 hours, newest first, and drops those with an outcome since", () => {
    const rows = warmCompanies(events, new Map([["s3", "2026-09-17T09:55:00"], ["s1", "2026-09-16T15:00:00"]]), now);
    expect(rows.map((r) => r.companyId)).toEqual(["s1", "s2"]);
    expect(rows[0]).toMatchObject({ opens: 2, clicks: 0, lastKind: "opened", contactName: "Mrs Patel", lastAt: "2026-09-17T09:12:00" });
    expect(rows[1]).toMatchObject({ opens: 0, clicks: 1, lastKind: "clicked", url: "https://tes.com/jobs/1" });
  });
  it("keeps a company whose only outcome is the send itself", () => {
    const rows = warmCompanies(events, new Map([["s1", "2026-09-16T15:00:00"], ["s2", "2026-09-17T08:00:00"], ["s3", "2026-09-10T00:00:00"]]), now);
    expect(rows.map((r) => r.companyId)).toEqual(["s3", "s1", "s2"]);
  });
  it("writes the line for the strip", () => {
    const rows = warmCompanies(events, new Map(), now);
    expect(warmLine(rows.find((r) => r.companyId === "s1")!, now)).toBe("Opened twice, last 09:12 today");
    expect(warmLine(rows.find((r) => r.companyId === "s2")!, now)).toBe("Clicked the careers link 08:40 today");
  });
});
