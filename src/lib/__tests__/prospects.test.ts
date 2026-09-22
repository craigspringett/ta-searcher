import { describe, expect, it } from "vitest";
import {
  boardsLine,
  discoverySummary,
  groupProspects,
  normaliseWebsite,
  parseProspectRow,
  shortDate,
  prospectSector,
  prospectStage,
  stageLine,
  filterProspects,
  filterCounts,
  NO_FILTERS,
  parseScoreReason,
  parseSettingInput,
  postingLine,
  qualifySummary,
  radarLine,
  scoreChips,
  settingsFromValue,
  shortDateTime,
  sourceKeyStates,
  sourceLines,
  websiteHost,
  DISMISS_REASONS,
  type Prospect,
  type RunRow,
} from "../prospects";

const row = {
  id: "p1",
  name: "Metris Energy",
  name_key: "metris energy",
  website: "https://www.metris.energy/",
  company_number: "12345678",
  status: "qualified",
  sources: [
    { source: "companies_house", url: "https://find-and-update.company-information.service.gov.uk/company/12345678", title: "METRIS ENERGY LTD", at: "2026-09-19T05:30:00Z", note: null },
    { source: "funding_news", url: "https://news.google.com/rss/articles/abc", title: "Metris Energy raises €4.35 million", at: "2026-09-21T05:30:00Z", note: null },
    { source: "funding_news", url: "https://news.google.com/rss/articles/abc", title: "Metris Energy raises €4.35 million", at: "2026-09-21T05:30:00Z", note: null },
  ],
  raise: { amountText: "€4.35 million", amountGbp: 3697500, round: "seed", date: "2026-09-21", url: "https://news.google.com/rss/articles/abc" },
  register: { status: "active", incorporationDate: "2024-03-01", sicCodes: ["62012"], sector: "Software", locality: "London", postcodeDistrict: "EC1", capitalFilings: [{ date: "2026-08-01", type: "SH01", description: "Statement of capital" }] },
  boards: [{ provider: "ashby", slug: "metris", count: 13, talentRoles: ["Head of Talent"], titles: ["Head of Talent", "Engineer"] }],
  talent_postings: [{ title: "Head of Talent", employer: "Metris Energy", source: "adzuna", url: "https://adzuna.example/1", date: "2026-09-18" }],
  prospect_score: 85,
  score_reasons: ["+45 a talent lead role advertised", { points: 30, reason: "a seed round in the last six months" }, { points: -30, label: "no website found" }, "not matched on the register"],
  first_seen_at: "2026-09-19T05:30:00Z",
  last_seen_at: "2026-09-21T05:30:00Z",
  qualified_at: "2026-09-21T05:40:00Z",
  promoted_at: null,
  dismissed_at: null,
  promoted_company_id: null,
  dismiss_reason: null,
};

describe("parseProspectRow", () => {
  it("reads every column and the JSON shapes", () => {
    const p = parseProspectRow(row);
    expect(p.name).toBe("Metris Energy");
    expect(p.status).toBe("qualified");
    expect(p.sources).toHaveLength(3);
    expect(p.raise?.round).toBe("seed");
    expect(p.register?.capitalFilings[0].type).toBe("SH01");
    expect(p.boards[0]).toEqual({ provider: "ashby", slug: "metris", count: 13, talentRoles: ["Head of Talent"], titles: ["Head of Talent", "Engineer"] });
    expect(p.talentPostings[0].title).toBe("Head of Talent");
    expect(p.score).toBe(85);
    expect(p.scoreReasons).toHaveLength(4);
  });
  it("tolerates a slim row and odd JSON", () => {
    const p = parseProspectRow({ id: "x", status: "new", sources: "nope", boards: { not: "a list" }, score_reasons: null });
    expect(p.name).toBe("A company");
    expect(p.status).toBe("new");
    expect(p.sources).toEqual([]);
    expect(p.boards).toEqual([]);
    expect(p.scoreReasons).toEqual([]);
    expect(p.score).toBeNull();
    expect(parseProspectRow({ id: "y", status: "weird" }).status).toBe("new");
  });
});

describe("scoreChips", () => {
  it("reads strings and objects, gains first, then penalties, then notes", () => {
    const chips = scoreChips(row.score_reasons);
    expect(chips.map((c) => c.label)).toEqual(["+45 a talent lead role advertised", "+30 a seed round in the last six months", "−30 no website found", "not matched on the register"]);
    expect(chips.map((c) => c.tone)).toEqual(["positive", "positive", "critical", "muted"]);
  });
  it("parses a minus sign written either way and drops empty lines", () => {
    expect(parseScoreReason("−20 no board and no talent posting")).toEqual({ points: -20, text: "no board and no talent posting" });
    expect(parseScoreReason("-20: no board")).toEqual({ points: -20, text: "no board" });
    expect(parseScoreReason("")).toBeNull();
    expect(parseScoreReason({ points: 5 })).toBeNull();
    expect(scoreChips(null)).toEqual([]);
  });
});

describe("sourceLines", () => {
  it("labels each source, keeps the newest first and drops a repeated link", () => {
    const lines = sourceLines(row.sources);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ label: "Funding news", text: "Metris Energy raises €4.35 million", url: "https://news.google.com/rss/articles/abc" });
    expect(lines[1]).toMatchObject({ label: "Companies House", text: "METRIS ENERGY LTD" });
  });
  it("falls back to the note and then the label, and labels an unknown source", () => {
    const lines = sourceLines([{ source: "adzuna", url: null, title: null, at: null, note: "Head of Talent posted by an agency" }, { source: "some_feed", url: "https://x", title: null, at: null, note: null }]);
    expect(lines.map((l) => l.text)).toEqual(["Head of Talent posted by an agency", "Some feed"]);
    expect(sourceLines(undefined)).toEqual([]);
  });
});

describe("boardsLine and postingLine", () => {
  it("names the provider, the count and the talent titles", () => {
    expect(boardsLine(parseProspectRow(row).boards)).toBe("Ashby: 13 roles, talent: Head of Talent");
    expect(boardsLine([{ provider: "lever", slug: null, count: 1, talentRoles: [], titles: [] }, { provider: "custom", slug: null, count: 4, talentRoles: ["Recruiter", "Talent Partner"], titles: [] }])).toBe("Lever: 1 role; custom: 4 roles, talent: Recruiter, Talent Partner");
    expect(boardsLine([])).toBe("");
  });
  it("reads the posting with its source and date", () => {
    expect(postingLine(parseProspectRow(row).talentPostings[0])).toBe("Head of Talent (Adzuna, 18 Sep)");
    expect(postingLine({ title: "Recruiter", employer: null, source: null, url: null, date: null })).toBe("Recruiter");
  });
});

describe("groupProspects", () => {
  const today = new Date("2026-09-21T12:00:00Z");
  const base = parseProspectRow(row);
  const rows: Prospect[] = [
    { ...base, id: "q1", score: 40, name: "Beta" },
    { ...base, id: "q2", score: 85, name: "Alpha" },
    { ...base, id: "q3", score: 85, name: "Aardvark" },
    { ...base, id: "q4", score: null, name: "Unscored" },
    { ...base, id: "pr1", status: "promoted", promotedAt: "2026-09-20T05:40:00Z", promotedCompanyId: "c1" },
    { ...base, id: "pr2", status: "promoted", promotedAt: "2026-09-01T05:40:00Z", promotedCompanyId: "c2" },
    { ...base, id: "pr3", status: "promoted", promotedAt: "2026-07-01T05:40:00Z", promotedCompanyId: "c3" },
    { ...base, id: "n1", status: "new", sources: [{ source: "companies_house", url: null, title: null, at: null, note: null }] },
    { ...base, id: "n2", status: "new", sources: [{ source: "companies_house", url: null, title: null, at: null, note: null }, { source: "adzuna", url: null, title: null, at: null, note: null }, { source: "adzuna", url: null, title: null, at: null, note: null }] },
    { ...base, id: "d1", status: "dismissed" },
    { ...base, id: "u1", status: "unsuitable" },
  ];
  it("orders ready by score then name, promoted by date within the month, and counts new by source", () => {
    const g = groupProspects(rows, today);
    expect(g.ready.map((p) => p.id)).toEqual(["q3", "q2", "q1", "q4"]);
    expect(g.promoted.map((p) => p.id)).toEqual(["pr1", "pr2"]);
    expect(g.watching).toBe(2);
    expect(g.watchingBySource.map((w) => `${w.label} ${w.count}`)).toEqual(["Funding news 0", "Adzuna 1", "Reed 0", "Companies House 2"]);
  });
  it("is empty with no rows", () => {
    const g = groupProspects([], today);
    expect(g.ready).toEqual([]);
    expect(g.promoted).toEqual([]);
    expect(g.watching).toBe(0);
    expect(g.watchingBySource.every((w) => w.count === 0)).toBe(true);
  });
});

describe("radarLine", () => {
  it("reads the counts as a sentence", () => {
    expect(radarLine({ addedThisWeek: 3, ready: 7 })).toBe("3 companies added from the radar this week; 7 more ready.");
    expect(radarLine({ addedThisWeek: 1, ready: 1 })).toBe("1 company added from the radar this week; 1 more ready.");
    expect(radarLine({ addedThisWeek: 0, ready: 4 })).toBe("The radar has 4 ready to add.");
    expect(radarLine({ addedThisWeek: 2, ready: 0 })).toBe("2 companies added from the radar this week; nothing more ready.");
    expect(radarLine({ addedThisWeek: 0, ready: 0 })).toBe("Nothing added from the radar this week, and nothing ready yet.");
  });
});

describe("run summaries and key states", () => {
  const discovery: RunRow = {
    phase: "prospecting", status: "completed", started_at: "2026-09-21T05:30:00Z", finished_at: "2026-09-21T05:33:10Z", new_count: 12, error: null,
    details: { sources: { funding_news: { found: 20, inserted: 4 }, companies_house: { found: 300, inserted: 8 }, adzuna: { skipped: true }, reed: { found: 6, inserted: 0 } } },
  };
  it("summarises discovery with the per-source counts and the skipped ones", () => {
    expect(discoverySummary(discovery)).toEqual({ when: "05:33 UTC, 21 Sep", status: "completed", text: "12 new prospects; Funding news 4, Adzuna key not set, Reed 0, Companies House 8" });
    expect(discoverySummary({ ...discovery, status: "running", finished_at: null })?.text).toMatch(/^still running/);
    expect(discoverySummary({ ...discovery, status: "failed", error: "boom", details: null })?.text).toBe("failed: boom");
    expect(discoverySummary({ ...discovery, new_count: 1, details: null })?.text).toBe("1 new prospect");
    expect(discoverySummary(null)).toBeNull();
  });
  it("summarises qualification from the details", () => {
    const q: RunRow = { phase: "prospect_qualify", status: "completed", started_at: "2026-09-21T05:40:00Z", finished_at: "2026-09-21T05:52:00Z", new_count: 3, error: null, details: { checked: 60, qualified: 41, promoted: 3, unsuitable: 5 } };
    expect(qualifySummary(q)).toEqual({ when: "05:52 UTC, 21 Sep", status: "completed", text: "60 checked, 41 ready, 3 added, 5 unsuitable" });
    expect(qualifySummary({ ...q, new_count: null, details: {} })?.text).toBe("finished");
    expect(qualifySummary({ ...q, status: "running" })?.text).toBe("still running");
  });
  it("reads which job APIs have a key from the last discovery run", () => {
    expect(sourceKeyStates(discovery)).toEqual({ adzuna: "key not set", reed: "on" });
    expect(sourceKeyStates({ ...discovery, details: null })).toEqual({ adzuna: "on", reed: "on" });
    expect(sourceKeyStates(null)).toEqual({ adzuna: "not run yet", reed: "not run yet" });
  });
});

describe("settings, websites and small helpers", () => {
  it("reads the settings with defaults and validates the inputs", () => {
    expect(settingsFromValue(null)).toEqual({ autoPromoteScore: 60, weeklyPromoteCap: 15 });
    expect(settingsFromValue({ autoPromoteScore: 70, watermarks: {} })).toEqual({ autoPromoteScore: 70, weeklyPromoteCap: 15 });
    expect(settingsFromValue({ autoPromoteScore: "55", weeklyPromoteCap: 20 })).toEqual({ autoPromoteScore: 55, weeklyPromoteCap: 20 });
    expect(parseSettingInput("60", 100)).toBe(60);
    expect(parseSettingInput("101", 100)).toBeNull();
    expect(parseSettingInput("1.5", 100)).toBeNull();
    expect(parseSettingInput("", 100)).toBeNull();
    expect(parseSettingInput("-1", 100)).toBeNull();
  });
  it("shows a host and normalises a typed website", () => {
    expect(websiteHost("https://www.metris.energy/")).toBe("metris.energy");
    expect(websiteHost("metris.energy")).toBe("metris.energy");
    expect(websiteHost(null)).toBe("");
    expect(normaliseWebsite("metris.energy")).toBe("https://metris.energy");
    expect(normaliseWebsite(" https://www.metris.energy/ ")).toBe("https://www.metris.energy");
    expect(normaliseWebsite("not a url")).toBe("");
    expect(normaliseWebsite("metris")).toBe("");
  });
  it("formats a UTC time and lists the dismiss reasons", () => {
    expect(shortDateTime("2026-09-21T05:30:00Z")).toBe("05:30 UTC, 21 Sep");
    expect(shortDateTime("nope")).toBe("");
    expect(DISMISS_REASONS.map((r) => r.value)).toEqual(["not_a_startup", "agency", "already_client", "wrong_country", "other"]);
  });
});

describe("sector and stage", () => {
  const base = parseProspectRow(row);
  const withSources = (titles: string[], extra: Partial<typeof base> = {}) => ({ ...base, ...extra, sources: titles.map((t) => ({ source: "funding_news", url: null, title: t, at: null, note: null })) });
  it("reads the sector from the headline words, the more specific first", () => {
    expect(prospectSector(withSources(["London fintech Sprive raises $10m Series A"]))).toBe("Fintech");
    expect(prospectSector(withSources(["AI litigation legaltech start-up Crimson raises $2.5m"]))).toBe("Legaltech");
    expect(prospectSector(withSources(["Magnitude Biosciences raises £1.3m to scale drug discovery platform"]))).toBe("Healthtech");
    expect(prospectSector(withSources(["Metris Energy raises €4.35 million to scale AI platform for managing renewable energy assets"]))).toBe("Climate and energy");
    expect(prospectSector(withSources(["Magentic raises $18M to build AI agents that diagnose, plan and fix"]))).toBe("AI");
    expect(prospectSector(withSources(["Exein raises $270m to fight AI hackers"]))).toBe("Cybersecurity");
    expect(prospectSector(withSources(["Soul Padel raises £3.6m to triple UK club count"]))).toBe("Ecommerce and consumer");
  });
  it("falls back to the domain, then the register, then Other", () => {
    expect(prospectSector(withSources(["Head of Talent"], { website: "https://geosurge.ai/", talentPostings: [] }))).toBe("AI");
    expect(prospectSector(withSources(["Head of Talent"], { website: "https://x.com/", register: { ...base.register!, sector: "Financial services" } }))).toBe("Fintech");
    expect(prospectSector(withSources(["Head of Talent"], { website: "https://x.com/", register: null, name: "Blank Ltd" }))).toBe("Other");
  });
  it("reads the stage from the round, else the amount, else an SH01", () => {
    const today = new Date("2026-09-21T00:00:00Z");
    const raise = (round: string | null, amountGbp: number | null) => ({ ...base, raise: { amountText: null, amountGbp, round, date: "2026-09-01", url: null }, register: null });
    expect(prospectStage(raise("pre-seed", null), today)).toBe("Pre-seed");
    expect(prospectStage(raise("seed", null), today)).toBe("Seed");
    expect(prospectStage(raise("Series A", null), today)).toBe("Series A");
    expect(prospectStage(raise("Series C", null), today)).toBe("Series B or later");
    expect(prospectStage(raise(null, 4_000_000), today)).toBe("Seed");
    expect(prospectStage(raise(null, 20_000_000), today)).toBe("Series A");
    expect(prospectStage(raise(null, 100_000_000), today)).toBe("Series B or later");
    expect(prospectStage(raise(null, null), today)).toBe("Unknown");
    const sh01 = { ...base, raise: null, register: { ...base.register!, capitalFilings: [{ date: "2026-07-23", type: "SH01", description: "Statement of capital" }] } };
    expect(prospectStage(sh01, today)).toBe("Unannounced raise");
    expect(stageLine(sh01, today)).toBe(`shares allotted ${shortDate("2026-07-23")}, no raise in the news`);
    expect(prospectStage({ ...base, raise: null, register: null }, today)).toBe("Unknown");
    expect(stageLine({ ...base, raise: null, register: null }, today)).toBe("no raise found");
    expect(stageLine({ ...base, raise: { amountText: "£2m", amountGbp: 2_000_000, round: "seed", date: "2026-09-01", url: null } }, today)).toBe(`£2m seed, ${shortDate("2026-09-01")}`);
  });
  it("filters and counts", () => {
    const today = new Date("2026-09-21T00:00:00Z");
    const rows = [
      withSources(["Fintech Sprive raises $10m Series A"], { id: "a", raise: { amountText: "$10m", amountGbp: 7_500_000, round: "Series A", date: "2026-09-01", url: null } }),
      withSources(["Crimson legaltech raises $2.5m seed"], { id: "b", raise: { amountText: "$2.5m", amountGbp: 1_900_000, round: "seed", date: "2026-09-01", url: null } }),
      withSources(["Head of Talent"], { id: "c", raise: null, register: null, website: "https://x.com/", name: "Blank" }),
    ];
    expect(filterProspects(rows, NO_FILTERS, today).map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(filterProspects(rows, { sectors: ["Fintech"], stages: [] }, today).map((p) => p.id)).toEqual(["a"]);
    expect(filterProspects(rows, { sectors: [], stages: ["Seed", "Unknown"] }, today).map((p) => p.id)).toEqual(["b", "c"]);
    expect(filterProspects(rows, { sectors: ["Legaltech"], stages: ["Series A"] }, today)).toEqual([]);
    const counts = filterCounts(rows, today);
    expect(counts.sectors).toEqual([{ value: "Fintech", count: 1 }, { value: "Legaltech", count: 1 }, { value: "Other", count: 1 }]);
    expect(counts.stages).toEqual([{ value: "Seed", count: 1 }, { value: "Series A", count: 1 }, { value: "Unknown", count: 1 }]);
  });
});
