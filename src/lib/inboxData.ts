import { supabase } from "@/integrations/supabase/client";
import { parseReplyRow, type ConnectionView, type InboxReply } from "@/lib/inbox";

export const companyRepliesKey = (companyId: string) => ["inbox-replies", companyId] as const;
export const unhandledRepliesKey = ["inbox-replies", "unhandled"] as const;

const COLUMNS = "id, company_search_id, contact_name, from_email, from_name, subject, received_at, preview, body_text, match_note, sequence_id, draft_subject, draft_body, draft_flags, draft_error, handled_at";

export async function loadCompanyReplies(companyId: string): Promise<InboxReply[]> {
  const { data, error } = await supabase.from("inbox_replies").select(COLUMNS).eq("company_search_id", companyId).order("received_at", { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  return (data || []).map(parseReplyRow);
}

/** Replies not yet handled, newest first, with the company's name. */
export async function loadUnhandledReplies(): Promise<Array<InboxReply & { companyName: string }>> {
  const { data, error } = await supabase.from("inbox_replies").select(`${COLUMNS}, company_searches(company_name)`).is("handled_at", null).order("received_at", { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({ ...parseReplyRow(r), companyName: (r as { company_searches?: { company_name?: string } | null }).company_searches?.company_name || "a company" }));
}

export async function markReplyHandled(id: string, handled: boolean): Promise<void> {
  const { error, count } = await supabase.from("inbox_replies").update({ handled_at: handled ? new Date().toISOString() : null }, { count: "exact" }).eq("id", id);
  if (error) throw new Error(error.message);
  if (count === 0) throw new Error("Not saved. Only a signed-in app user can do this.");
}

export interface ConnectReply { ok?: boolean; url?: string; configured?: boolean; idle?: boolean; connection?: { mailbox: string; status: string; last_error: string | null; last_checked_at: string | null; connected_at: string } | null; message?: string; error?: string; result?: unknown }

export async function callMsConnect(action: "start" | "status" | "disconnect" | "check"): Promise<ConnectReply> {
  const { data, error } = await supabase.functions.invoke("ms-connect", { body: { action } });
  if (error) throw error;
  return (data || {}) as ConnectReply;
}

export function toConnectionView(c: ConnectReply["connection"], idle = false): ConnectionView | null {
  return c ? { mailbox: c.mailbox, status: c.status, lastError: c.last_error, lastCheckedAt: c.last_checked_at, connectedAt: c.connected_at, idle } : null;
}
