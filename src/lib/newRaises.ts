// New raises this week (slice 2): the raise stories sync-funding-news read
// from UKTN, Sifted and Google News, split into companies not yet tracked
// (one click adds them) and companies already in the patch. The reads are
// in newRaisesData.ts so this file stays pure and testable.

export interface NewRaise {
  id: string;
  title: string;
  url: string;
  publisher: string | null;
  source: string;
  publishedAt: string | null;
  firstSeenAt: string | null;
  /** The name read from the headline. */
  companyName: string | null;
  amountText: string | null;
  amountGbp: number | null;
  round: string | null;
  matchedCompanyId: string | null;
  /** The tracked company's own name, when matched. */
  matchedCompanyName: string | null;
}

export const NEW_RAISE_DAYS = 14;

/** The date the story is filed under: when it was published, else when the feed first showed it. */
export function raiseDate(r: Pick<NewRaise, "publishedAt" | "firstSeenAt">): string | null {
  return r.publishedAt || r.firstSeenAt || null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "21 Sep" from an ISO instant or date (UTC), spelt the same everywhere; "" when it does not parse. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "a seed round", "an angel round", "a Series A round". */
export function roundPhrase(round: string): string {
  const r = round.trim();
  return `${/^[aeiou]/i.test(r) ? "an" : "a"} ${r} round`;
}

/** The name the line leads with: the tracked company's, else the headline's, else "A company". */
export function raiseName(r: Pick<NewRaise, "companyName" | "matchedCompanyName">): string {
  return (r.matchedCompanyName || r.companyName || "").trim() || "A company";
}

/**
 * One line per story: "Metris Energy raised €4.35 million (seed), 21 Sep".
 * Without an amount the round carries it ("Crimson raised a seed round,
 * 21 Sep"); with neither, "raised a round". No date, no comma.
 */
export function raiseLine(r: Pick<NewRaise, "companyName" | "matchedCompanyName" | "amountText" | "round" | "publishedAt" | "firstSeenAt">): string {
  const name = raiseName(r);
  const amount = (r.amountText || "").trim();
  const round = (r.round || "").trim();
  let what: string;
  if (amount && round) what = `${amount} (${round})`;
  else if (amount) what = amount;
  else if (round) what = roundPhrase(round);
  else what = "a round";
  const date = shortDate(raiseDate(r));
  return `${name} raised ${what}${date ? `, ${date}` : ""}`;
}

export interface GroupedRaises {
  /** Stories about companies not in the patch, newest first. */
  untracked: NewRaise[];
  /** Stories matched to a tracked company, newest first. */
  tracked: NewRaise[];
}

/** The stories of the last `days` days, newest first, split by whether the company is tracked. */
export function groupRaises(rows: NewRaise[], days = NEW_RAISE_DAYS, today: Date = new Date()): GroupedRaises {
  const since = today.getTime() - days * 86_400_000;
  const kept = rows.filter((r) => {
    const d = raiseDate(r);
    if (!d) return false;
    const t = new Date(d).getTime();
    return !Number.isNaN(t) && t >= since && t <= today.getTime() + 86_400_000;
  });
  kept.sort((a, b) => (raiseDate(b) || "").localeCompare(raiseDate(a) || "") || a.title.localeCompare(b.title));
  return { untracked: kept.filter((r) => !r.matchedCompanyId), tracked: kept.filter((r) => !!r.matchedCompanyId) };
}
