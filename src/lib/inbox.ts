/**
 * Outlook inbox reading (22 September 2026): the replies the reader
 * matched to companies on the patch, each with the draft answer to copy
 * into Outlook. Pure helpers here; reads in inboxData.ts.
 */
export interface InboxReply {
  id: string;
  companyId: string | null;
  contactName: string | null;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  receivedAt: string;
  preview: string | null;
  bodyText: string | null;
  matchNote: string | null;
  sequenceId: string | null;
  draftSubject: string | null;
  draftBody: string | null;
  draftFlags: string[];
  draftError: string | null;
  handledAt: string | null;
}

export interface InboxReplyRow {
  id: string;
  company_search_id: string | null;
  contact_name: string | null;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  received_at: string;
  preview: string | null;
  body_text: string | null;
  match_note: string | null;
  sequence_id: string | null;
  draft_subject: string | null;
  draft_body: string | null;
  draft_flags: string[] | null;
  draft_error: string | null;
  handled_at: string | null;
}

export function parseReplyRow(r: InboxReplyRow): InboxReply {
  return {
    id: r.id, companyId: r.company_search_id, contactName: r.contact_name, fromEmail: r.from_email, fromName: r.from_name, subject: r.subject, receivedAt: r.received_at,
    preview: r.preview, bodyText: r.body_text, matchNote: r.match_note, sequenceId: r.sequence_id, draftSubject: r.draft_subject, draftBody: r.draft_body,
    draftFlags: Array.isArray(r.draft_flags) ? r.draft_flags : [], draftError: r.draft_error, handledAt: r.handled_at,
  };
}

/** "Priya Shah" else the address's local part, for the card. */
export function replyWho(r: Pick<InboxReply, "contactName" | "fromName" | "fromEmail">): string {
  return r.contactName || r.fromName || r.fromEmail.split("@")[0];
}

/** "read: interested, wants a call" from the match note, when the drafter left one. */
export function replyRead(note: string | null | undefined): string | null {
  const m = (note || "").match(/read:\s*(.+)$/);
  return m ? m[1].trim() : null;
}

export interface ConnectionView {
  mailbox: string;
  status: string;
  lastError: string | null;
  lastCheckedAt: string | null;
  connectedAt: string;
  /** Connected but nothing to match yet: the reader waits for a first email to a contact. */
  idle?: boolean;
}

/** The one-line state of the connection for the Alerts card. */
export function connectionLine(c: ConnectionView | null, configured: boolean): string {
  if (!configured) return "The Microsoft app is not set up on the project yet.";
  if (!c) return "Not connected. Connect Outlook to have replies spotted, follow-ups stopped and answers drafted.";
  if (c.status === "needs_reconnect") return `Outlook for ${c.mailbox} needs connecting again${c.lastError ? ` (${c.lastError})` : ""}.`;
  const when = c.lastCheckedAt ? new Date(c.lastCheckedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "not yet";
  if (c.idle) return `Connected to ${c.mailbox}. Idle until a first email goes to a contact; from then it reads every fifteen minutes. Last read ${when}.`;
  return `Reading ${c.mailbox} every fifteen minutes; last read ${when}${c.lastError ? `; last problem: ${c.lastError}` : ""}.`;
}
