import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ContactEditRow } from "@/lib/contacts";

/** What contact-edits answers. */
export interface ContactEditsReply {
  ok?: boolean;
  edit?: ContactEditRow;
  /** Set when the address is on the do-not-email list (the save still went through). */
  suppressed?: string | null;
  /** Set when an active follow-up run moved to the new address. */
  sequenceUpdated?: { sequenceId: string; note: string } | null;
  /** "Follow-ups are still running with ...", after a remove. */
  warning?: string | null;
  message?: string;
  error?: string;
  code?: "rule" | string;
}

/** Headers for a direct call to an edge function: the signed-in user's token, never the anon key. */
async function functionHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("You are signed out. Sign in again.");
  return { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string, Authorization: `Bearer ${token}` };
}

/** Call contact-edits and return the JSON whatever the status, so a refusal comes back in the function's own words. */
export async function callContactEdits(body: Record<string, unknown>): Promise<{ status: number; data: ContactEditsReply }> {
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/contact-edits`, { method: "POST", headers: await functionHeaders(), body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as ContactEditsReply;
  return { status: res.status, data };
}

const COLUMNS = "id, company_search_id, contact_key, name, role, email, phone, note, action, edited_by, edited_by_name, created_at";

/** Every edit row for one company (row security limits what comes back); the merge picks the newest per person. */
export async function loadCompanyContactEdits(companyId: string): Promise<ContactEditRow[]> {
  const { data, error } = await supabase.from("company_contact_edits").select(COLUMNS).eq("company_search_id", companyId).order("created_at", { ascending: true }).limit(2000);
  if (error) throw new Error(error.message);
  return (data || []) as ContactEditRow[];
}

export const companyContactEditsKey = (companyId: string) => ["contact-edits", companyId] as const;

/** React Query hook for the company page. */
export function useCompanyContactEdits(companyId: string | null | undefined) {
  return useQuery({
    queryKey: companyContactEditsKey(companyId || ""),
    queryFn: () => loadCompanyContactEdits(companyId as string),
    enabled: !!companyId,
    staleTime: 30_000,
  });
}
