/**
 * Follow-up sequences in the app (Follow-ups slice 2): the words for each
 * step and status, what is due, and the lines the cards show. Pure; the
 * reads and the function calls are in followUpsData.ts. The rules
 * themselves (dates, stopping, drafting) live in the functions.
 */

export type StepKind = "call" | "email";
export type StepStatus = "scheduled" | "due" | "approved" | "sent" | "skipped" | "stopped" | "done";
export type SequenceStatus = "active" | "stopped" | "done";

export interface FollowUpStep {
  id: string;
  sequence_id: string;
  step_no: number;
  kind: string;
  day: number;
  label: string | null;
  due_at: string;
  status: string;
  subject: string | null;
  body: string | null;
  hook: string | null;
  draft_generated_at: string | null;
  draft_flags: string[];
  sent_message_id: string | null;
  outcome_id: string | null;
  completed_at: string | null;
}

export interface FollowUpSequence {
  id: string;
  company_search_id: string;
  consultant_id: string | null;
  created_by: string | null;
  contact_name: string;
  contact_email: string;
  contact_role: string | null;
  vacancy_id: string | null;
  status: string;
  stop_reason: string | null;
  started_at: string;
  ended_at: string | null;
  steps: FollowUpStep[];
}

export const STEP_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  due: "Due",
  approved: "Sending",
  sent: "Sent",
  skipped: "Skipped",
  stopped: "Stopped",
  done: "Done",
};

/** The reasons offered by the Stop button; the first four log that outcome, the last a note. */
export const STOP_CHOICES: Array<{ value: string; label: string }> = [
  { value: "replied", label: "They replied" },
  { value: "not_interested", label: "Not interested" },
  { value: "spoke_to", label: "Spoke to them" },
  { value: "meeting_booked", label: "Meeting booked" },
  { value: "other", label: "Something else" },
];

/** What a call step can be logged as. */
export const CALL_OUTCOME_CHOICES: Array<{ value: string; label: string }> = [
  { value: "spoke_to", label: "Spoke to" },
  { value: "voicemail", label: "Voicemail" },
  { value: "callback", label: "Call back" },
  { value: "not_interested", label: "Not interested" },
  { value: "meeting_booked", label: "Meeting booked" },
  { value: "replied", label: "Replied" },
];

const LONDON = "Europe/London";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function londonParts(iso: string | Date): { y: number; m: number; d: number; hh: string; mm: string; wd: number } {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(date)) parts[p.type] = p.value;
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), hh: String(Number(parts.hour) % 24).padStart(2, "0"), mm: parts.minute, wd: DAYS.indexOf(parts.weekday) };
}

/** The London calendar date, "YYYY-MM-DD". */
export function londonDay(iso: string | Date): string {
  const p = londonParts(iso);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** "today 14:00", "tomorrow 13:30", "Fri 18 Sep 13:30", or "Tue 15 Sep 14:00 (overdue)". */
export function whenWord(iso: string, now: Date = new Date()): string {
  const p = londonParts(iso);
  const day = londonDay(iso);
  const today = londonDay(now);
  const tomorrow = londonDay(new Date(now.getTime() + 86400000));
  const time = `${p.hh}:${p.mm}`;
  if (day === today) return `today ${time}`;
  if (day === tomorrow) return `tomorrow ${time}`;
  const word = `${DAYS[p.wd]} ${p.d} ${MONTHS[p.m - 1]} ${time}`;
  return day < today ? `${word} (overdue)` : word;
}

export function isOpen(step: Pick<FollowUpStep, "status">): boolean {
  return step.status === "scheduled" || step.status === "due";
}

/** Due now: the tick has marked it due, or its time has passed and the tick has not run yet. */
export function isDueNow(step: Pick<FollowUpStep, "status" | "due_at">, now: Date = new Date()): boolean {
  return step.status === "due" || (step.status === "scheduled" && step.due_at <= now.toISOString());
}

/** Due today or overdue (still open). */
export function isDueToday(step: Pick<FollowUpStep, "status" | "due_at">, now: Date = new Date()): boolean {
  return isOpen(step) && londonDay(step.due_at) <= londonDay(now);
}

/** The next step still to do. */
export function nextStep(seq: Pick<FollowUpSequence, "steps">): FollowUpStep | null {
  return [...seq.steps].sort((a, b) => a.step_no - b.step_no).find(isOpen) ?? null;
}

/** "Follow-ups with Mrs Patel: step 3 of 5, an email, due Fri 18 Sep 13:30" or how it ended. */
export function sequenceLine(seq: FollowUpSequence, now: Date = new Date()): string {
  const who = `Follow-ups with ${seq.contact_name}`;
  if (seq.status === "stopped") return `${who} stopped${seq.stop_reason ? `: ${seq.stop_reason}` : ""}.`;
  if (seq.status === "done") return `${who} finished${seq.ended_at ? ` on ${whenWord(seq.ended_at, now).replace(/ \d{2}:\d{2}.*$/, "")}` : ""}.`;
  const next = nextStep(seq);
  if (!next) return `${who}: every step done.`;
  return `${who}: step ${next.step_no} of ${seq.steps.length}, ${next.kind === "call" ? "a call" : "an email"}, due ${whenWord(next.due_at, now)}.`;
}

export interface DueRow {
  sequence: FollowUpSequence;
  step: FollowUpStep;
}

/** Every open step due today or overdue across the sequences, earliest first: the "Follow-ups due today" strip. */
export function dueRows(sequences: FollowUpSequence[], now: Date = new Date()): DueRow[] {
  const rows: DueRow[] = [];
  for (const sequence of sequences) {
    if (sequence.status !== "active") continue;
    for (const step of sequence.steps) if (isDueToday(step, now)) rows.push({ sequence, step });
  }
  return rows.sort((a, b) => a.step.due_at.localeCompare(b.step.due_at) || a.sequence.contact_name.localeCompare(b.sequence.contact_name));
}

/** The step's label, or a plain one from its kind and day. */
export function stepLabel(step: Pick<FollowUpStep, "label" | "kind" | "day" | "step_no">): string {
  if (step.label) return step.label;
  return `${step.kind === "call" ? "Call" : "Email"}, day ${step.day}`;
}

export function wordCount(text: string | null | undefined): number {
  return (text || "").trim().split(/\s+/).filter(Boolean).length;
}

/** Whether a draft is ready to approve: an open email step with a body. */
export function hasDraft(step: Pick<FollowUpStep, "kind" | "body" | "status">): boolean {
  return step.kind === "email" && isOpen(step) && !!(step.body || "").trim();
}

/** The reply shape of the follow-ups function. */
export interface FollowUpsReply {
  ok?: boolean;
  error?: string;
  code?: "active" | "quiet" | "suppressed" | "inactive";
  message?: string;
  sequence?: FollowUpSequence;
  sequenceId?: string;
  drafting?: { drafted?: Array<{ stepNo: number; flags: string[] }>; failed?: Array<{ stepNo: number; error: string }>; error?: string } | null;
  plan?: Array<{ stepNo: number; kind: string; day: number; label: string; dueAt: string; when: string }>;
  quiet?: string | null;
  active?: { id: string; contact_name: string; started_at: string } | null;
  vacancies?: Array<{ id: string; title: string; closing_date: string | null; source: string; first_seen: string }>;
  company?: string;
}

/** One line on how the drafting went, for the dialog after Start. */
export function draftingLine(d: FollowUpsReply["drafting"]): string {
  if (!d) return "";
  if (d.error) return `The emails could not be drafted yet (${d.error}). They will be written on their due day.`;
  const n = d.drafted?.length ?? 0;
  const failed = d.failed?.length ?? 0;
  const flagged = (d.drafted || []).filter((x) => x.flags.length).length;
  const parts = [n ? `${n} email${n === 1 ? "" : "s"} drafted` : "No emails drafted yet"];
  if (flagged) parts.push(`${flagged} to check before sending`);
  if (failed) parts.push(`${failed} could not be written and will be tried again on the due day`);
  return `${parts.join(", ")}.`;
}

/** "Today", "Tomorrow", "Monday 21 Sep", or "Overdue" for an open step whose day has passed. */
export function dayHeading(day: string, now: Date = new Date(), open = true): string {
  const today = londonDay(now);
  const tomorrow = londonDay(new Date(now.getTime() + 86400000));
  if (day === today) return "Today";
  if (day === tomorrow) return "Tomorrow";
  if (open && day < today) return "Overdue";
  const [y, m, d] = day.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][wd]} ${d} ${MONTHS[m - 1]}`;
}

/** "14:00" in London time. */
export function londonClock(iso: string): string {
  const p = londonParts(iso);
  return `${p.hh}:${p.mm}`;
}

export interface DayGroup {
  /** "overdue", or the London date "YYYY-MM-DD". */
  key: string;
  heading: string;
  rows: DueRow[];
}

/**
 * The steps grouped by London day for the Follow-ups page: open steps
 * (overdue first, then today onwards) when `past` is false; otherwise every
 * step, with the finished ones on the day they happened.
 */
export function groupByDay(sequences: FollowUpSequence[], now: Date = new Date(), past = false): DayGroup[] {
  const today = londonDay(now);
  const groups = new Map<string, DayGroup>();
  for (const sequence of sequences) {
    for (const step of sequence.steps) {
      const open = isOpen(step) && sequence.status === "active";
      if (!past && !open) continue;
      const at = open ? step.due_at : step.completed_at || step.due_at;
      const day = londonDay(at);
      const key = open && day < today ? "overdue" : day;
      const g = groups.get(key) ?? { key, heading: key === "overdue" ? "Overdue" : dayHeading(day, now, open), rows: [] };
      g.rows.push({ sequence, step });
      groups.set(key, g);
    }
  }
  const out = Array.from(groups.values());
  for (const g of out) g.rows.sort((a, b) => (a.step.due_at.localeCompare(b.step.due_at)) || a.sequence.contact_name.localeCompare(b.sequence.contact_name));
  return out.sort((a, b) => (a.key === "overdue" ? -1 : b.key === "overdue" ? 1 : a.key.localeCompare(b.key)));
}
