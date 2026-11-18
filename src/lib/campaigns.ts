// Follow-up campaigns, stage 1 (Craig, 18 November 2026): up to 15 contacts,
// at most 2 at one company, started together with one shared plan. Pure; the
// reads and calls are in campaignsData.ts. The limits mirror
// supabase/functions/_shared/follow-ups/campaign.ts. Ported from He-Giveth.

export const MAX_CAMPAIGN_CONTACTS = 15;
export const MAX_PER_COMPANY = 2;
export const MAX_CAMPAIGN_STEPS = 6;

export type StageKind = "email" | "call";
export const MAX_STAGE_NOTE = 600;
export const MAX_STAGE_EXAMPLE = 3000;
/** An email stage can say what that email is about and carry an example email to base it on. */
export interface Stage { id: number; kind: StageKind; day: number; note?: string; example?: string }

export const DEFAULT_STAGES: Stage[] = [
  { id: 1, kind: "email", day: 0 },
  { id: 2, kind: "call", day: 2 },
  { id: 3, kind: "email", day: 4 },
  { id: 4, kind: "call", day: 8 },
  { id: 5, kind: "email", day: 14 },
];

export interface PickedContact { companyId: string; companyName: string; name: string; role: string | null; email: string }

/** Can this contact be added to the picked list? Says why not in words. */
export function canPick(picked: PickedContact[], c: PickedContact): { ok: boolean; reason: string | null } {
  if (picked.some((p) => p.email.toLowerCase() === c.email.toLowerCase())) return { ok: false, reason: "Already picked." };
  if (picked.length >= MAX_CAMPAIGN_CONTACTS) return { ok: false, reason: `A campaign holds at most ${MAX_CAMPAIGN_CONTACTS} contacts.` };
  if (picked.filter((p) => p.companyId === c.companyId).length >= MAX_PER_COMPANY) return { ok: false, reason: `At most ${MAX_PER_COMPANY} contacts at one company.` };
  return { ok: true, reason: null };
}

/** What the new-campaign form sends, or why it cannot yet. */
export function validateCampaign(name: string, stages: Stage[], picked: PickedContact[]): string | null {
  if (!name.trim()) return "Give the campaign a name.";
  if (picked.length === 0) return "Pick at least one contact.";
  if (stages.length === 0 || stages[0].kind !== "email" || stages[0].day !== 0) return "The first stage is the introduction email, on day 0.";
  for (let i = 1; i < stages.length; i++) if (stages[i].day < stages[i - 1].day) return "Stages must be in date order.";
  const emailDays = stages.filter((s) => s.kind === "email").map((s) => s.day);
  if (new Set(emailDays).size !== emailDays.length) return "Two emails cannot go on the same day.";
  return null;
}

export interface CampaignStep { step_no: number; kind: string; status: string; subject: string | null; body: string | null; due_at: string; label: string | null; draft_flags: string[] | null; campaign_approved_at?: string | null }
export interface CampaignSeq { status: string; stop_reason: string | null; steps: CampaignStep[] }

export type ContactState = "writing" | "approve" | "approve_later" | "running" | "done" | "stopped";

/** The later emails still to read and approve: written, not yet gone, not approved. */
export function laterToApprove(seq: CampaignSeq): CampaignStep[] {
  return seq.steps.filter((s) => s.step_no > 1 && s.kind === "email" && ["scheduled", "due"].includes(s.status) && !!s.body && !s.campaign_approved_at);
}

/** Where one contact in the campaign is: emails not yet written, the first email waiting for approval, the later emails waiting for approval, running, finished or stopped. */
export function contactState(seq: CampaignSeq): { state: ContactState; label: string } {
  const first = seq.steps.find((s) => s.step_no === 1);
  if (seq.status === "stopped") return { state: "stopped", label: seq.stop_reason ? `Stopped: ${seq.stop_reason}` : "Stopped" };
  if (seq.status === "done") return { state: "done", label: "Finished" };
  if (first && first.status === "sent") {
    const n = laterToApprove(seq).length;
    return n > 0 ? { state: "approve_later", label: n === 1 ? "1 later email to approve" : `${n} later emails to approve` } : { state: "running", label: "First email sent, the rest approved" };
  }
  if (first && !first.body) return { state: "writing", label: "Writing the emails" };
  return { state: "approve", label: "Waiting for your approval" };
}

/** Email steps that still need writing, for the drafting pass. */
export function needsWriting(seq: CampaignSeq): boolean {
  return seq.status === "active" && seq.steps.some((s) => s.kind === "email" && ["scheduled", "due"].includes(s.status) && !s.body);
}

export function summarise(seqs: CampaignSeq[]): Record<ContactState, number> {
  const out: Record<ContactState, number> = { writing: 0, approve: 0, approve_later: 0, running: 0, done: 0, stopped: 0 };
  for (const s of seqs) out[contactState(s).state]++;
  return out;
}

// ---- the filters on the picker: stage, sector, pipeline stage ----------------------

export type FundingStage = "pre_seed" | "seed" | "series_a" | "series_b_plus" | "unknown";

export const FUNDING_STAGE_LABELS: Record<FundingStage, string> = {
  pre_seed: "Pre-seed",
  seed: "Seed",
  series_a: "Series A",
  series_b_plus: "Series B or later",
  unknown: "Stage not known",
};

/** The funding stage the analysis holds (analysis_result.stage.label); anything else is not known. */
export function fundingStage(label: string | null | undefined): FundingStage {
  const l = (label || "").toLowerCase().replace(/[\s-]+/g, "_");
  return l === "pre_seed" || l === "seed" || l === "series_a" || l === "series_b_plus" ? l : "unknown";
}

/**
 * The sector the register put the company in, from the first sentence of its summary ("X is a software company
 * incorporated in 2023"), written the way the analysis writes it. Nothing there: "Not known".
 */
export function sectorOf(summary: string | null | undefined): string {
  const m = /\bis an? ([a-z][a-z ,&-]{2,40}?) company\b/i.exec(summary || "");
  if (!m) return "Not known";
  const t = m[1].trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** What the picker shows beside a company's name: its stage and sector, in words. */
export function companyLine(stage: FundingStage, sector: string, openRoles: number): string {
  return [FUNDING_STAGE_LABELS[stage], sector !== "Not known" ? sector : null, openRoles > 0 ? null : "no open roles"].filter(Boolean).join(" · ");
}

/** "Mon 9 Nov, 14:00" in London time, for when an email or a call is due. */
export function formatDue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/London" });
  return `${day}, ${time}`;
}
