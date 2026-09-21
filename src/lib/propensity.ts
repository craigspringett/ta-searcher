/** The propensity score as the app shows it (Phase 5). The score itself is computed server-side; this is presentation. */

export interface ScoreLine {
  code: string;
  label: string;
  points: number;
  reason: string;
  kind: "signal" | "adjustment";
}

export interface CompanyScore {
  score: number;
  breakdown: ScoreLine[];
  topReason: string | null;
  topCode: string | null;
  computedAt: string | null;
}

export type Band = "hot" | "warm" | "cool";

export function scoreBand(score: number | null | undefined): Band | null {
  if (score === null || score === undefined) return null;
  return score >= 60 ? "hot" : score >= 30 ? "warm" : "cool";
}

export const BAND_LABELS: Record<Band, string> = { hot: "Call this week", warm: "Worth a call", cool: "Nothing pressing" };

/** Semantic classes only (no palette colours), so dark mode stays right. */
export const BAND_CLASSES: Record<Band, string> = {
  hot: "bg-positive/15 text-positive border-positive/30",
  warm: "bg-warning/15 text-warning border-warning/30",
  cool: "bg-muted text-muted-foreground border-border",
};

/** The signal lines, strongest first, then the adjustments in the order they applied. */
export function orderedBreakdown(lines: ScoreLine[]): ScoreLine[] {
  const signals = lines.filter((l) => l.kind === "signal").sort((a, b) => b.points - a.points);
  const adjustments = lines.filter((l) => l.kind === "adjustment");
  return [...signals, ...adjustments];
}

/** How a line's points read: "+22" for a signal, "×0.4" for a multiplier, "+15" for a bonus. */
export function pointsText(line: ScoreLine): string {
  if (line.kind === "signal") return `+${Math.round(line.points)}`;
  if (line.points > 0 && line.points < 1) return `×${line.points}`;
  return `+${Math.round(line.points)}`;
}

/** The first few reasons for a tooltip or a list row. */
export function topReasons(lines: ScoreLine[], n = 3): string[] {
  return orderedBreakdown(lines).slice(0, n).map((l) => `${l.label} (${pointsText(l)})`);
}

/** Parse a company_scores row (breakdown is JSON) into the shape above; null when the row is missing. */
export function parseScoreRow(row: { score: number; breakdown: unknown; top_reason: string | null; top_code: string | null; computed_at: string | null } | null | undefined): CompanyScore | null {
  if (!row) return null;
  const raw = Array.isArray(row.breakdown) ? row.breakdown : [];
  const breakdown: ScoreLine[] = raw
    .filter((l): l is Record<string, unknown> => !!l && typeof l === "object")
    .map((l) => ({ code: String(l.code ?? ""), label: String(l.label ?? ""), points: Number(l.points ?? 0), reason: String(l.reason ?? ""), kind: l.kind === "adjustment" ? "adjustment" : "signal" }));
  return { score: Number(row.score), breakdown, topReason: row.top_reason, topCode: row.top_code, computedAt: row.computed_at };
}
