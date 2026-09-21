import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { parseScoreRow, topReasons } from "@/lib/propensity";
import { STAGE_LABELS, type AnalysisResult, type LatestRaise, type OpenRole, type StageLabel } from "@/lib/analysis";
import { familyOf } from "@/lib/roleFamily";
import { sectorFromSic } from "@/lib/sector";

/** One row of "my patch": a company with the figures the list sorts on. */
export interface PatchCompany {
  id: string;
  name: string;
  url: string;
  companyNumber: string | null;
  /** The register's status; "dissolved" and "liquidation" are badged. */
  status: string | null;
  stage: StageLabel;
  stageEvidence: string | null;
  sector: string | null;
  consultantIds: string[];
  consultantNames: string[];
  openRoles: number;
  /** Open roles in the people and talent family: the direct lead. */
  talentRoles: number;
  latestRaise: LatestRaise | null;
  lastAnalysed: string | null;
  degraded: boolean;
  /** "blocks automated reading" when the site challenges every server; the register and the feeds still come. */
  websiteAccess: string | null;
  nextCallback: string | null;
  lastOutcome: { kind: string; at: string } | null;
  /** The propensity score, 0 to 100, null until the company is scored. */
  propensity: number | null;
  propensityReason: string | null;
  propensityReasons: string[];
}

export interface PatchData {
  companies: PatchCompany[];
  consultants: Tables<"consultants">[];
  sectors: string[];
}

/** The parts of analysis_result the patch list reads. */
export type PatchAnalysis = Pick<AnalysisResult, "companyRecord" | "stage" | "latestRaise" | "recruitmentInsights" | "vacancyRun" | "websiteAccess">;

/** "Series A", "Seed", "Unknown" for a missing or unrecognised stage. */
export function stageLabel(label: string | null | undefined): string {
  return label && label in STAGE_LABELS ? STAGE_LABELS[label as StageLabel] : STAGE_LABELS.unknown;
}

function stageOf(label: string | null | undefined): StageLabel {
  return label && label in STAGE_LABELS ? (label as StageLabel) : "unknown";
}

/** How many of the open roles are people and talent roles (a recruiter, a talent partner, a head of people). */
export function countTalentRoles(roles: ReadonlyArray<Pick<OpenRole, "family">> | null | undefined): number {
  return (roles || []).filter((r) => familyOf(r.family) === "people_talent").length;
}

/** "£4.2m Series A", "Series A", "£4.2m", or "" when nothing is known. */
export function latestRaiseLine(raise: Pick<LatestRaise, "amountText" | "round"> | null | undefined): string {
  if (!raise) return "";
  return [raise.amountText, raise.round].map((x) => (x || "").trim()).filter(Boolean).join(" ");
}

/** The tooltip behind the raise: "12 March 2026, led by Index Ventures and Seedcamp", either half on its own, "" when neither is known. */
export function latestRaiseDetail(raise: Pick<LatestRaise, "date" | "investors"> | null | undefined): string {
  if (!raise) return "";
  const date = raise.date ? formatLongDate(raise.date) : "";
  const investors = (raise.investors || []).map((x) => x.trim()).filter(Boolean);
  const named = investors.length === 0 ? "" : investors.length === 1 ? investors[0] : `${investors.slice(0, -1).join(", ")} and ${investors[investors.length - 1]}`;
  if (date && named) return `${date}, with ${named}`;
  if (named) return `With ${named}`;
  return date;
}

/** "12 March 2026" from an ISO date, the input itself when it is not one. */
export function formatLongDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** True when the raise is dated within the last `months` months of `now`. */
export function raisedWithin(raise: Pick<LatestRaise, "date"> | null | undefined, months: number, now: Date = new Date()): boolean {
  if (!raise?.date) return false;
  const d = new Date(raise.date);
  if (Number.isNaN(d.getTime())) return false;
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return d.getTime() >= cutoff.getTime() && d.getTime() <= now.getTime() + 86400000;
}

/** The columns derived from analysis_result: what the patch row and the company page both show. */
export function derivePatchFields(ar: PatchAnalysis | null | undefined, fallbackName: string) {
  const record = ar?.companyRecord || null;
  const roles = Array.isArray(ar?.recruitmentInsights?.currentVacancies) ? ar!.recruitmentInsights!.currentVacancies! : [];
  return {
    name: record?.name || fallbackName,
    status: record?.status ?? null,
    stage: stageOf(ar?.stage?.label),
    stageEvidence: ar?.stage?.evidence ?? null,
    sector: sectorFromSic(record?.sicCodes),
    openRoles: roles.length,
    talentRoles: countTalentRoles(roles),
    latestRaise: ar?.latestRaise ?? null,
    lastAnalysed: ar?.vacancyRun?.at || null,
    degraded: !!ar?.vacancyRun?.degraded,
    websiteAccess: ar?.websiteAccess ?? null,
  };
}

/** Everything the patch page needs, in five reads. */
export async function loadPatch(): Promise<PatchData> {
  const [companies, assignments, consultants, outcomes, scores] = await Promise.all([
    supabase.from("company_searches").select("id, company_name, url, company_number, updated_at, analysis_result"),
    supabase.from("company_consultants").select("company_search_id, consultant_id"),
    supabase.from("consultants").select("*").order("name"),
    supabase.from("outcomes").select("company_search_id, kind, callback_at, created_at").order("created_at", { ascending: false }),
    supabase.from("company_scores").select("company_search_id, score, breakdown, top_reason, top_code, computed_at"),
  ]);
  const firstError = [companies, assignments, consultants, outcomes, scores].find((r) => r.error)?.error;
  if (firstError) throw new Error(firstError.message);
  const scoreByCompany = new Map((scores.data || []).map((r) => [r.company_search_id, parseScoreRow(r)]));

  const byConsultant = new Map<string, string[]>();
  for (const a of assignments.data || []) (byConsultant.get(a.company_search_id) ?? byConsultant.set(a.company_search_id, []).get(a.company_search_id)!).push(a.consultant_id);
  const consultantName = new Map((consultants.data || []).map((c) => [c.id, c.name]));

  const now = Date.now();
  const outcomeByCompany = new Map<string, { last: { kind: string; at: string } | null; next: string | null }>();
  for (const o of outcomes.data || []) {
    const cur = outcomeByCompany.get(o.company_search_id) || { last: null, next: null };
    if (!cur.last) cur.last = { kind: o.kind, at: o.created_at };
    if (o.callback_at && new Date(o.callback_at).getTime() >= now - 86400000 && (!cur.next || o.callback_at < cur.next)) cur.next = o.callback_at;
    outcomeByCompany.set(o.company_search_id, cur);
  }

  const rows: PatchCompany[] = (companies.data || []).map((s) => {
    const ar = (s.analysis_result || null) as PatchAnalysis | null;
    const ids = byConsultant.get(s.id) || [];
    const o = outcomeByCompany.get(s.id);
    const derived = derivePatchFields(ar, s.company_name);
    return {
      id: s.id,
      url: s.url,
      companyNumber: s.company_number ?? null,
      ...derived,
      lastAnalysed: derived.lastAnalysed || s.updated_at || null,
      consultantIds: ids,
      consultantNames: ids.map((id) => consultantName.get(id) || "").filter(Boolean).sort(),
      nextCallback: o?.next ?? null,
      lastOutcome: o?.last ?? null,
      propensity: scoreByCompany.get(s.id)?.score ?? null,
      propensityReason: scoreByCompany.get(s.id)?.topReason ?? null,
      propensityReasons: topReasons(scoreByCompany.get(s.id)?.breakdown ?? []),
    };
  });
  const sectors = Array.from(new Set(rows.map((r) => r.sector).filter((x): x is string => !!x))).sort();
  return { companies: rows, consultants: consultants.data || [], sectors };
}

export const OUTCOME_LABELS: Record<string, string> = {
  spoke_to: "Spoke to",
  voicemail: "Voicemail",
  callback: "Call back",
  not_interested: "Not interested",
  meeting_booked: "Meeting booked",
  /** Logged by send-outreach-email, or by hand for an email sent from Outlook. */
  emailed: "Emailed",
  /** A reply the consultant logs. */
  replied: "Replied",
  /** A note by hand. */
  note: "Note",
};

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
