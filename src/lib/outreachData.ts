import { supabase } from "@/integrations/supabase/client";
import type { OutreachReply, OutreachRequest } from "@/lib/outreach";

/**
 * Call send-outreach-email with the signed-in person's token and return the
 * JSON whatever the status, so the dialog can show a block, a warning or a
 * refusal in the function's own words.
 */
export async function callOutreach(req: OutreachRequest): Promise<{ status: number; data: OutreachReply }> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error("You are signed out. Sign in again.");
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-outreach-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string, Authorization: `Bearer ${token}` },
    body: JSON.stringify(req),
  });
  const data = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as OutreachReply;
  return { status: res.status, data };
}
