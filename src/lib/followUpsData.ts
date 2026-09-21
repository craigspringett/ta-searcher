import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { FollowUpSequence, FollowUpsReply, FollowUpStep } from "@/lib/followUps";

/** Headers for a direct call to an edge function: the signed-in user's token, never the anon key. */
async function functionHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("You are signed out. Sign in again.");
  return { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string, Authorization: `Bearer ${token}` };
}

/** Call the follow-ups function and return the JSON whatever the status, so a refusal comes back in the function's own words. */
export async function callFollowUps(body: Record<string, unknown>): Promise<{ status: number; data: FollowUpsReply }> {
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/follow-ups`, { method: "POST", headers: await functionHeaders(), body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as FollowUpsReply;
  return { status: res.status, data };
}

function attachSteps(sequences: Omit<FollowUpSequence, "steps">[], steps: FollowUpStep[]): FollowUpSequence[] {
  const bySeq = new Map<string, FollowUpStep[]>();
  for (const s of steps) (bySeq.get(s.sequence_id) ?? bySeq.set(s.sequence_id, []).get(s.sequence_id)!).push(s);
  return sequences.map((q) => ({ ...q, steps: (bySeq.get(q.id) || []).sort((a, b) => a.step_no - b.step_no) }));
}

const SEQ_COLUMNS = "id, company_search_id, consultant_id, created_by, contact_name, contact_email, contact_role, vacancy_id, status, stop_reason, started_at, ended_at";
const STEP_COLUMNS = "id, sequence_id, step_no, kind, day, label, due_at, status, subject, body, hook, draft_generated_at, draft_flags, sent_message_id, outcome_id, completed_at";

/** The sequences for one company with their steps, newest first (row security limits what comes back). */
export async function loadCompanyFollowUps(companyId: string): Promise<FollowUpSequence[]> {
  const seqs = await supabase.from("follow_up_sequences").select(SEQ_COLUMNS).eq("company_search_id", companyId).order("started_at", { ascending: false }).limit(10);
  if (seqs.error) throw new Error(seqs.error.message);
  const ids = (seqs.data || []).map((s) => s.id);
  if (!ids.length) return [];
  const steps = await supabase.from("follow_up_steps").select(STEP_COLUMNS).in("sequence_id", ids).order("step_no");
  if (steps.error) throw new Error(steps.error.message);
  return attachSteps(seqs.data || [], steps.data || []);
}

export const companyFollowUpsKey = (companyId: string) => ["follow-ups", companyId] as const;

export function useCompanyFollowUps(companyId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: companyFollowUpsKey(companyId || ""),
    queryFn: () => loadCompanyFollowUps(companyId as string),
    enabled: enabled && !!companyId,
    staleTime: 15_000,
    refetchInterval: enabled && companyId ? 60_000 : false,
  });
}

/** Every active sequence the reader may see, with its steps: the "Follow-ups due today" strip filters to what is due. */
export async function loadActiveFollowUps(): Promise<FollowUpSequence[]> {
  const seqs = await supabase.from("follow_up_sequences").select(SEQ_COLUMNS).eq("status", "active").order("started_at", { ascending: false }).limit(500);
  if (seqs.error) throw new Error(seqs.error.message);
  const ids = (seqs.data || []).map((s) => s.id);
  if (!ids.length) return [];
  const steps = await supabase.from("follow_up_steps").select(STEP_COLUMNS).in("sequence_id", ids).in("status", ["scheduled", "due"]).order("due_at");
  if (steps.error) throw new Error(steps.error.message);
  return attachSteps(seqs.data || [], steps.data || []);
}

export const activeFollowUpsKey = ["follow-ups-active"] as const;

export function useActiveFollowUps(enabled: boolean) {
  return useQuery({ queryKey: activeFollowUpsKey, queryFn: loadActiveFollowUps, enabled, staleTime: 15_000, refetchInterval: enabled ? 60_000 : false });
}

/** Every sequence the reader may see (active, stopped and done), with every step: the Follow-ups page. */
export async function loadAllFollowUps(): Promise<FollowUpSequence[]> {
  const seqs = await supabase.from("follow_up_sequences").select(SEQ_COLUMNS).order("started_at", { ascending: false }).limit(500);
  if (seqs.error) throw new Error(seqs.error.message);
  const ids = (seqs.data || []).map((s) => s.id);
  if (!ids.length) return [];
  const steps: FollowUpStep[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const r = await supabase.from("follow_up_steps").select(STEP_COLUMNS).in("sequence_id", ids.slice(i, i + 100)).order("due_at");
    if (r.error) throw new Error(r.error.message);
    steps.push(...(r.data || []));
  }
  return attachSteps(seqs.data || [], steps);
}

export const allFollowUpsKey = ["follow-ups-all"] as const;

export function useAllFollowUps(enabled: boolean) {
  return useQuery({ queryKey: allFollowUpsKey, queryFn: loadAllFollowUps, enabled, staleTime: 15_000, refetchInterval: enabled ? 60_000 : false });
}
