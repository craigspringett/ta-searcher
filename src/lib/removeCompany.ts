import { supabase } from "@/integrations/supabase/client";

/**
 * Stop tracking a company (21 September 2026; on My patch too from 22
 * September): a manager deletes the row and everything hanging off it goes
 * with it. The prospect it came from (if any) is dismissed so the radar
 * does not bring it back for six months.
 */
export async function removeCompany(companyId: string): Promise<void> {
  await supabase.from("prospects").update({ status: "dismissed", dismissed_at: new Date().toISOString(), dismiss_reason: "removed from the patch" }).eq("promoted_company_id", companyId);
  const { error, count } = await supabase.from("company_searches").delete({ count: "exact" }).eq("id", companyId);
  if (error) throw new Error(error.message);
  if (count === 0) throw new Error("Only a manager can remove a company.");
}

export const REMOVE_WARNING = "Everything the site holds about it goes: the open roles and their history, the facts, signals and score, the scripts, the contacts and your edits to them, the call history and any follow-ups. This cannot be undone. You can add the company again later from the Companies page or the Prospects page.";
