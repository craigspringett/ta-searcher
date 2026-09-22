/**
 * The pipeline board (22 September 2026): where each tracked company
 * stands with Big Fish. The stage lives on company_searches.pipeline_stage;
 * an outcome moves it forward on its own (a database trigger), the
 * consultant moves it anywhere from the board or the company page.
 */
export const PIPELINE_STAGES = ["prospect", "contacted", "call_booked", "search_agreed", "lost"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const STAGE_LABELS: Record<PipelineStage, string> = {
  prospect: "Prospect",
  contacted: "Contacted",
  call_booked: "Call booked",
  search_agreed: "Search agreed",
  lost: "Not now",
};

export const STAGE_HINTS: Record<PipelineStage, string> = {
  prospect: "Tracked, nothing said to them yet",
  contacted: "An email went or a call was made",
  call_booked: "A call or a meeting is in the diary",
  search_agreed: "The search is on",
  lost: "Not now; kept for later",
};

/** The columns on the board, in order; Not now is shown apart. */
export const BOARD_COLUMNS: PipelineStage[] = ["prospect", "contacted", "call_booked", "search_agreed"];

export function isPipelineStage(v: unknown): v is PipelineStage {
  return typeof v === "string" && (PIPELINE_STAGES as readonly string[]).includes(v);
}

export function stageOf(v: unknown): PipelineStage {
  return isPipelineStage(v) ? v : "prospect";
}

export interface PipelineCompany {
  id: string;
  name: string;
  stage: PipelineStage;
  movedAt: string | null;
  sector: string | null;
  fundingStage: string | null;
  score: number | null;
  lastOutcome: { kind: string; at: string } | null;
  nextCallback: string | null;
  openRoles: number;
}

/** "3 days in this column", "today", "6 weeks". */
export function timeInStage(movedAt: string | null, now: Date = new Date()): string {
  if (!movedAt) return "";
  const days = Math.floor((now.getTime() - new Date(movedAt).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  if (days < 14) return `${days} days`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"}`;
}

/** Companies by column, each column best score first, then most recently moved. */
export function groupByStage(rows: PipelineCompany[]): Record<PipelineStage, PipelineCompany[]> {
  const out = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, [] as PipelineCompany[]])) as Record<PipelineStage, PipelineCompany[]>;
  for (const r of rows) out[r.stage].push(r);
  for (const s of PIPELINE_STAGES) out[s].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.movedAt || "").localeCompare(a.movedAt || "") || a.name.localeCompare(b.name));
  return out;
}

/** The line under the board: "12 companies: 7 prospects, 3 contacted, 1 call booked, 1 search agreed, 2 not now". */
export function boardSummary(rows: PipelineCompany[]): string {
  const n = rows.length;
  if (n === 0) return "No companies on the board yet. Add one from the Companies page or let the radar add it.";
  const counts = groupByStage(rows);
  const parts = PIPELINE_STAGES.filter((s) => counts[s].length > 0).map((s) => `${counts[s].length} ${s === "prospect" ? (counts[s].length === 1 ? "prospect" : "prospects") : STAGE_LABELS[s].toLowerCase()}`);
  return `${n} ${n === 1 ? "company" : "companies"}: ${parts.join(", ")}.`;
}
