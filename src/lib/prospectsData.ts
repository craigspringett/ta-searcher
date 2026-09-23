import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { parseProspectRow, PROMOTED_DAYS, settingsFromValue, type Prospect, type ProspectingSettings, type RunRow } from "@/lib/prospects";

const PROSPECT_COLUMNS =
  "id, name, name_key, website, company_number, status, sources, raise, register, boards, talent_postings, prospect_score, score_reasons, first_seen_at, last_seen_at, qualified_at, promoted_at, dismissed_at, promoted_company_id, dismiss_reason, parked_at, wake_note";

export interface ProspectsPageData {
  /** Qualified, promoted this month, parked, and the new ones (slim rows: id, status, sources, raise, talent_postings). */
  prospects: Prospect[];
  /** Status new, the exact count, in case more exist than the slim read returned. */
  newCount: number;
  lastDiscovery: RunRow | null;
  lastQualify: RunRow | null;
  settings: ProspectingSettings;
  /** The stored value, so a save merges over it rather than replacing the watermarks. */
  settingsValue: Json | null;
}

/**
 * Everything the Prospects page shows: the qualified rows with every column,
 * the promoted rows of the last month, the new rows slim (for the counts by
 * source), the last run of each phase and the prospecting settings.
 */
export async function loadProspectsPage(today = new Date()): Promise<ProspectsPageData> {
  const since = new Date(today.getTime() - PROMOTED_DAYS * 86_400_000).toISOString();
  const [ready, promoted, fresh, freshCount, runs, settingsRow, parked] = await Promise.all([
    supabase.from("prospects").select(PROSPECT_COLUMNS).eq("status", "qualified").order("prospect_score", { ascending: false, nullsFirst: false }).order("name").limit(200),
    supabase.from("prospects").select(PROSPECT_COLUMNS).eq("status", "promoted").gte("promoted_at", since).order("promoted_at", { ascending: false }).limit(200),
    supabase.from("prospects").select("id, status, sources, raise, talent_postings").eq("status", "new").order("first_seen_at", { ascending: false }).limit(1000),
    supabase.from("prospects").select("id", { count: "exact", head: true }).eq("status", "new"),
    supabase.from("pipeline_runs").select("phase, status, started_at, finished_at, new_count, error, details").in("phase", ["prospecting", "prospect_qualify"]).order("started_at", { ascending: false }).limit(20),
    supabase.from("app_settings").select("value").eq("key", "prospecting").maybeSingle(),
    supabase.from("prospects").select(PROSPECT_COLUMNS).eq("status", "parked").order("parked_at", { ascending: false }).limit(300),
  ]);
  for (const r of [ready, promoted, fresh, freshCount, runs, settingsRow, parked]) if (r.error) throw new Error(r.error.message);
  const rows = [...(ready.data || []), ...(promoted.data || []), ...(fresh.data || []), ...(parked.data || [])].map(parseProspectRow);
  const runRows = (runs.data || []) as RunRow[];
  return {
    prospects: rows,
    newCount: freshCount.count ?? (fresh.data || []).length,
    lastDiscovery: runRows.find((r) => r.phase === "prospecting") || null,
    lastQualify: runRows.find((r) => r.phase === "prospect_qualify") || null,
    settings: settingsFromValue(settingsRow.data?.value),
    settingsValue: settingsRow.data?.value ?? null,
  };
}

/** The two numbers the My patch line needs: promoted in the last seven days, and qualified. */
export async function loadRadarCounts(today = new Date()): Promise<{ addedThisWeek: number; ready: number }> {
  const since = new Date(today.getTime() - 7 * 86_400_000).toISOString();
  const [added, ready] = await Promise.all([
    supabase.from("prospects").select("id", { count: "exact", head: true }).eq("status", "promoted").gte("promoted_at", since),
    supabase.from("prospects").select("id", { count: "exact", head: true }).eq("status", "qualified"),
  ]);
  if (added.error) throw new Error(added.error.message);
  if (ready.error) throw new Error(ready.error.message);
  return { addedThisWeek: added.count ?? 0, ready: ready.count ?? 0 };
}

/** One prospect re-read after a function call, so the page trusts the row and not the reply. */
export async function loadProspect(id: string): Promise<Prospect | null> {
  const { data, error } = await supabase.from("prospects").select(PROSPECT_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? parseProspectRow(data) : null;
}

/**
 * Dismiss: the one write the signed-in user may make to a prospect (status,
 * dismissed_at, dismiss_reason). A count of 0 means row security refused it.
 */
export async function dismissProspect(id: string, reason: string): Promise<void> {
  const { error, count } = await supabase
    .from("prospects")
    .update({ status: "dismissed", dismissed_at: new Date().toISOString(), dismiss_reason: reason }, { count: "exact" })
    .eq("id", id);
  if (error) throw new Error(error.message);
  if (count === 0) throw new Error("Not saved. Only a signed-in app user can dismiss a prospect.");
}

/**
 * Park (23 September 2026): set a prospect aside; the nightly discovery
 * brings it back when it sees a newer raise or a Head of Talent posting.
 * Bring back sets it to new, so it is qualified again on the next pass.
 */
export async function parkProspect(id: string): Promise<void> {
  const { error, count } = await supabase.from("prospects").update({ status: "parked", parked_at: new Date().toISOString() }, { count: "exact" }).eq("id", id);
  if (error) throw new Error(error.message);
  if (count === 0) throw new Error("Not saved. Only a signed-in app user can park a prospect.");
}

export async function unparkProspect(id: string): Promise<void> {
  const { error, count } = await supabase.from("prospects").update({ status: "new", parked_at: null }, { count: "exact" }).eq("id", id);
  if (error) throw new Error(error.message);
  if (count === 0) throw new Error("Not saved. Only a signed-in app user can bring a prospect back.");
}

/** One result per prospect the function looked at; the page re-reads the row and uses `note` for the message. */
export interface QualifyResult {
  prospectId: string;
  status?: string;
  score?: number | null;
  promotedCompanyId?: string | null;
  note?: string | null;
}

export interface QualifyReply {
  ok?: boolean;
  checked?: number;
  qualified?: number;
  promoted?: number;
  unsuitable?: number;
  results?: QualifyResult[];
  error?: string;
}

export interface DiscoverReply {
  ok?: boolean;
  inserted?: number;
  sources?: Record<string, { found?: number; inserted?: number; skipped?: boolean; error?: string | null }>;
  error?: string;
}

export interface QualifyBody {
  prospectIds?: string[];
  promote?: boolean;
  limit?: number;
  /** Sets the prospect's website before qualifying it (the page's "website not found" input). */
  website?: string;
  dryRun?: boolean;
}

/**
 * Call a prospecting function with the signed-in person's token and return
 * the JSON whatever the status, so the page can show a refusal in the
 * function's own words.
 */
async function callProspectFunction<T extends { error?: string }>(name: "discover-prospects" | "qualify-prospects", body: object): Promise<{ status: number; data: T }> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error("You are signed out. Sign in again.");
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as T;
  return { status: res.status, data };
}

/** qualify-prospects: `{prospectIds: [id], promote: true}` for Add, `{prospectIds: [id], website, promote: false}` for Save website, `{}` for the nightly default. */
export async function qualifyProspects(body: QualifyBody): Promise<{ status: number; data: QualifyReply }> {
  return callProspectFunction<QualifyReply>("qualify-prospects", body);
}

/** discover-prospects: `{}`, the same as the nightly job. */
export async function discoverProspects(): Promise<{ status: number; data: DiscoverReply }> {
  return callProspectFunction<DiscoverReply>("discover-prospects", {});
}

/** The message a failed call should show: the function's error, else the HTTP status. */
export function replyError(status: number, data: { error?: string }): string | null {
  if (data.error) return data.error;
  if (status >= 400) return `The function answered HTTP ${status}.`;
  return null;
}

/**
 * Save the two page settings into `app_settings.prospecting`, merged over
 * whatever else the value holds (the discovery watermarks live there too).
 * Row security lets a manager write settings; anyone else gets a count of 0.
 */
export async function saveProspectingSettings(next: ProspectingSettings, userId: string | null): Promise<void> {
  const { data: current, error: readError } = await supabase.from("app_settings").select("value").eq("key", "prospecting").maybeSingle();
  if (readError) throw new Error(readError.message);
  const existing = current?.value && typeof current.value === "object" && !Array.isArray(current.value) ? (current.value as Record<string, Json | undefined>) : {};
  const value: Json = { ...existing, autoPromoteScore: next.autoPromoteScore, weeklyPromoteCap: next.weeklyPromoteCap };
  const { error, count } = await supabase.from("app_settings").upsert({ key: "prospecting", value, updated_by: userId }, { count: "exact" });
  if (error) throw new Error(error.message);
  if (count === 0) throw new Error("Not saved. Only a manager can change the prospecting settings.");
}
