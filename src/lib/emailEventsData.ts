import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { EmailEvent, EmailedOutcome } from "@/lib/emailEvents";

/** The email events for one company (every contact), plus the "emailed" outcomes, for the engagement lines. */
export async function loadCompanyEmailEvents(companyId: string): Promise<{ events: EmailEvent[]; emailed: EmailedOutcome[] }> {
  const [events, outcomes] = await Promise.all([
    supabase.from("email_events").select("event_type, recipient_email, occurred_at, url, company_search_id, contact_name, message_id").eq("company_search_id", companyId).order("occurred_at", { ascending: false }).limit(500),
    supabase.from("outcomes").select("created_at, contact_name, external_refs").eq("company_search_id", companyId).eq("kind", "emailed").order("created_at", { ascending: false }).limit(100),
  ]);
  if (events.error) throw new Error(events.error.message);
  if (outcomes.error) throw new Error(outcomes.error.message);
  return {
    events: events.data || [],
    emailed: (outcomes.data || []).map((o) => {
      const refs = (o.external_refs && typeof o.external_refs === "object" && !Array.isArray(o.external_refs) ? o.external_refs : {}) as { contact_email?: unknown };
      return { created_at: o.created_at, contact_name: o.contact_name, contact_email: typeof refs.contact_email === "string" ? refs.contact_email : null };
    }),
  };
}

export const companyEmailEventsKey = (companyId: string) => ["email-events", companyId] as const;

/** React Query hook for the company page; `enabled` is the feature flag, so nothing is read for anyone without it. */
export function useCompanyEmailEvents(companyId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: companyEmailEventsKey(companyId || ""),
    queryFn: () => loadCompanyEmailEvents(companyId as string),
    enabled: enabled && !!companyId,
    staleTime: 30_000,
    refetchInterval: enabled && companyId ? 60_000 : false,
  });
}

/** Opens and clicks in the last `hours`, for the "Warm right now" strip. */
export async function loadRecentEngagement(hours = 24, now = new Date()): Promise<EmailEvent[]> {
  const since = new Date(now.getTime() - hours * 3600_000).toISOString();
  const { data, error } = await supabase
    .from("email_events")
    .select("event_type, recipient_email, occurred_at, url, company_search_id, contact_name, message_id")
    .in("event_type", ["opened", "clicked"])
    .gte("occurred_at", since)
    .not("company_search_id", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  return data || [];
}
