import { describe, expect, it } from "vitest";
import { groupRaises, raiseLine, raiseName, roundPhrase, shortDate, type NewRaise } from "../newRaises";

const base: NewRaise = {
  id: "1", title: "London’s Metris Energy raises €4.35 million to scale AI platform", url: "https://news.google.com/rss/articles/abc", publisher: "EU-Startups", source: "google_news",
  publishedAt: "2026-09-21T07:15:35.000Z", firstSeenAt: "2026-09-21T05:20:00.000Z", companyName: "Metris Energy", amountText: "€4.35 million", amountGbp: 3_697_500, round: "seed",
  matchedCompanyId: null, matchedCompanyName: null,
};

describe("raiseLine", () => {
  it("reads name, amount, round and date", () => {
    expect(raiseLine(base)).toBe("Metris Energy raised €4.35 million (seed), 21 Sep");
  });
  it("leaves the round out when there is none, and carries the line on the round when there is no amount", () => {
    expect(raiseLine({ ...base, round: null })).toBe("Metris Energy raised €4.35 million, 21 Sep");
    expect(raiseLine({ ...base, amountText: null, round: "seed", companyName: "Crimson" })).toBe("Crimson raised a seed round, 21 Sep");
    expect(raiseLine({ ...base, amountText: null, round: "angel" })).toBe("Metris Energy raised an angel round, 21 Sep");
    expect(raiseLine({ ...base, amountText: null, round: "Series A" })).toBe("Metris Energy raised a Series A round, 21 Sep");
    expect(raiseLine({ ...base, amountText: null, round: null })).toBe("Metris Energy raised a round, 21 Sep");
  });
  it("prefers the tracked company's own name and falls back when the headline gave none", () => {
    expect(raiseLine({ ...base, matchedCompanyName: "Metris Energy Ltd" })).toBe("Metris Energy Ltd raised €4.35 million (seed), 21 Sep");
    expect(raiseName({ companyName: null, matchedCompanyName: null })).toBe("A company");
  });
  it("uses the first-seen date when there is no published date, and no date at all when neither", () => {
    expect(raiseLine({ ...base, publishedAt: null, firstSeenAt: "2026-09-19T05:20:00.000Z" })).toBe("Metris Energy raised €4.35 million (seed), 19 Sep");
    expect(raiseLine({ ...base, publishedAt: null, firstSeenAt: null })).toBe("Metris Energy raised €4.35 million (seed)");
  });
});

describe("shortDate and roundPhrase", () => {
  it("formats a UK short date in UTC", () => {
    expect(shortDate("2026-09-21T23:30:00.000Z")).toBe("21 Sep");
    expect(shortDate("2026-03-05")).toBe("5 Mar");
    expect(shortDate("nope")).toBe("");
    expect(shortDate(null)).toBe("");
  });
  it("picks the article", () => {
    expect(roundPhrase("pre-seed")).toBe("a pre-seed round");
    expect(roundPhrase("angel")).toBe("an angel round");
  });
});

describe("groupRaises", () => {
  const today = new Date("2026-09-21T12:00:00Z");
  const rows: NewRaise[] = [
    { ...base, id: "a", publishedAt: "2026-09-21T07:15:35.000Z" },
    { ...base, id: "b", title: "Old one", publishedAt: "2026-08-01T00:00:00.000Z" },
    { ...base, id: "c", title: "Tracked one", publishedAt: "2026-09-18T00:00:00.000Z", matchedCompanyId: "co", matchedCompanyName: "Searchable" },
    { ...base, id: "d", title: "Seen not published", publishedAt: null, firstSeenAt: "2026-09-20T05:20:00.000Z" },
    { ...base, id: "e", title: "No date", publishedAt: null, firstSeenAt: null },
  ];
  it("keeps the last fourteen days, newest first, split by tracked", () => {
    const g = groupRaises(rows, 14, today);
    expect(g.untracked.map((r) => r.id)).toEqual(["a", "d"]);
    expect(g.tracked.map((r) => r.id)).toEqual(["c"]);
  });
  it("widens with the window", () => {
    expect(groupRaises(rows, 60, today).untracked.map((r) => r.id)).toEqual(["a", "d", "b"]);
  });
  it("is empty with nothing recent", () => {
    expect(groupRaises([rows[1]], 14, today)).toEqual({ untracked: [], tracked: [] });
  });
});
