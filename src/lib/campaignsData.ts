import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mergeContacts, type ContactEditRow } from "@/lib/contacts";
import { fundingStage, sectorOf, type CampaignSeq, type CampaignStep, type FundingStage, type Stage } from "@/lib/campaigns";

async function headers(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("You are signed out. Sign in again.");
  return { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string, Authorization: `Bearer ${token}` };
}

export interface CampaignsReply {
  ok?: boolean;
  targets?: Array<{ sequenceId: string; stepIds: string[] }>;
  error?: string;
  message?: string;
  campaignId?: string;
  created?: Array<{ sequenceId: string; contactName: string; companyName: string }>;
  skipped?: Array<{ contactName: string; companyName: string; reason: string }>;
}

export async function callCampaigns(body: Record<string, unknown>): Promise<{ status: number; data: CampaignsReply }> {
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/campaigns`, { method: "POST", headers: await headers(), body: JSON.stringify(body) });
  return { status: res.status, data: (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as CampaignsReply };
}

/** Write (or write again) the emails of one sequence: draft-follow-up, one model call per email. */
export async function callDraft(sequenceId: string, opts: { stepIds?: string[]; force?: boolean } = {}): Promise<{ status: number; error?: string }> {
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/draft-follow-up`, { method: "POST", headers: await headers(), body: JSON.stringify({ sequenceId, ...opts }) });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return { status: res.status, error: data.error };
}

export const stagesToPlan = (stages: Stage[]) => stages.map((s) => ({ kind: s.kind, day: s.day, ...(s.kind === "email" && s.note?.trim() ? { note: s.note.trim() } : {}), ...(s.kind === "email" && s.example?.trim() ? { example: s.example.trim() } : {}) }));

// ---- the picker ------------------------------------------------------------

export interface PickerContact { name: string; role: string | null; email: string | null; running: boolean }
export interface PickerCompany {
  id: string;
  name: string;
  stage: FundingStage;
  sector: string;
  pipelineStage: string;
  openRoles: number;
  roles: Array<{ title: string; firstSeen: string | null }>;
  mine: boolean;
  consultantIds: string[];
  contacts: PickerContact[];
}
export interface Picker { companies: PickerCompany[]; consultants: Array<{ id: string; name: string }> }

const chunks = <T,>(xs: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };

// The select string with JSON paths is too deep for the client's own types, so it goes through a narrow shape.
interface RawSelect { select(cols: string): PromiseLike<{ data: unknown; error: { message: string } | null }> }

/** Every company the signed-in person can read with its merged contacts, whether it is on their list, its open roles, and who already has a run going. */
export async function loadPicker(myEmail: string, myProfileId: string, myConsultantId: string | null): Promise<Picker> {
  const res = await (supabase.from("company_searches") as unknown as RawSelect).select("id, company_name, pipeline_stage, stage:analysis_result->stage->>label, summary:analysis_result->>summary, dms:analysis_result->decisionMakers");
  if (res.error) throw new Error(res.error.message);
  const rows = (res.data || []) as Array<{ id: string; company_name: string | null; pipeline_stage: string | null; stage: string | null; summary: string | null; dms: unknown }>;
  const ids = rows.map((s) => s.id);

  const [consultants, assigned, runs] = await Promise.all([
    supabase.from("consultants").select("id, name, email, profile_id"),
    supabase.from("company_consultants").select("company_search_id, consultant_id"),
    supabase.from("follow_up_sequences").select("company_search_id, contact_email").eq("status", "active").limit(2000),
  ]);
  const consultantRows = (consultants.data || []) as Array<{ id: string; name: string; email: string | null; profile_id: string | null }>;
  const mine = new Set(consultantRows.filter((c) => c.id === myConsultantId || c.profile_id === myProfileId || (c.email || "").toLowerCase() === myEmail.toLowerCase()).map((c) => c.id));
  const assignedRows = (assigned.data || []) as Array<{ company_search_id: string; consultant_id: string }>;
  const myCompanies = new Set(assignedRows.filter((a) => mine.has(a.consultant_id)).map((a) => a.company_search_id));
  const byConsultant = new Map<string, string[]>();
  for (const a of assignedRows) (byConsultant.get(a.company_search_id) ?? byConsultant.set(a.company_search_id, []).get(a.company_search_id)!).push(a.consultant_id);
  const running = new Set(((runs.data || []) as Array<{ company_search_id: string; contact_email: string }>).map((r) => `${r.company_search_id}|${r.contact_email.toLowerCase()}`));

  const edits = new Map<string, ContactEditRow[]>();
  const roles = new Map<string, Array<{ title: string; firstSeen: string | null }>>();
  for (const part of chunks(ids, 150)) {
    const [e, v] = await Promise.all([
      supabase.from("company_contact_edits").select("id, company_search_id, contact_key, name, role, email, phone, note, action, edited_by, edited_by_name, created_at").in("company_search_id", part).order("created_at", { ascending: true }),
      supabase.from("vacancies").select("company_search_id, title, first_seen").eq("status", "open").order("first_seen", { ascending: true, nullsFirst: false }).in("company_search_id", part),
    ]);
    for (const r of (e.data || []) as ContactEditRow[]) (edits.get(r.company_search_id as string) ?? edits.set(r.company_search_id as string, []).get(r.company_search_id as string)!).push(r);
    for (const r of (v.data || []) as Array<{ company_search_id: string; title: string; first_seen: string | null }>) (roles.get(r.company_search_id) ?? roles.set(r.company_search_id, []).get(r.company_search_id)!).push({ title: r.title, firstSeen: r.first_seen });
  }

  const list = rows.map((s) => {
    const merged = mergeContacts(Array.isArray(s.dms) ? (s.dms as Array<{ name?: string | null; role?: string | null; email?: string | null }>) : [], edits.get(s.id) || []);
    return {
      id: s.id, name: s.company_name || "Company", stage: fundingStage(s.stage), sector: sectorOf(s.summary), pipelineStage: s.pipeline_stage || "prospect",
      openRoles: (roles.get(s.id) || []).length, roles: roles.get(s.id) || [], mine: myCompanies.has(s.id), consultantIds: byConsultant.get(s.id) || [],
      contacts: merged.filter((c) => (c.name || "").trim()).map((c) => ({ name: (c.name || "").trim(), role: c.role || null, email: c.email ? c.email.toLowerCase() : null, running: !!c.email && running.has(`${s.id}|${c.email.toLowerCase()}`) })),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { companies: list, consultants: consultantRows.map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)) };
}

export function usePicker(myEmail: string, myProfileId: string, myConsultantId: string | null) {
  return useQuery({ queryKey: ["campaign-picker", myProfileId], queryFn: () => loadPicker(myEmail, myProfileId, myConsultantId), staleTime: 120_000, enabled: !!myProfileId });
}

// ---- campaigns and their contacts -----------------------------------------

export interface Campaign { id: string; name: string; angle: string | null; status: string; auto_after_first: boolean; write_alike: boolean; created_at: string }
export interface CampaignStepFull extends CampaignStep { id: string; sequence_id: string }
export interface CampaignContactRow extends Omit<CampaignSeq, "steps"> {
  id: string;
  steps: CampaignStepFull[];
  company_search_id: string;
  contact_name: string;
  contact_email: string;
  contact_role: string | null;
  companyName: string;
}

const STEP_COLUMNS = "id, sequence_id, step_no, kind, status, subject, body, due_at, label, draft_flags, campaign_approved_at";

export async function loadCampaigns(): Promise<Array<Campaign & { contacts: number; sent: number }>> {
  const { data, error } = await supabase.from("follow_up_campaigns").select("id, name, angle, status, auto_after_first, write_alike, created_at").order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  const campaigns = (data || []) as Campaign[];
  if (!campaigns.length) return [];
  const seqs = await supabase.from("follow_up_sequences").select("id, campaign_id").in("campaign_id", campaigns.map((c) => c.id));
  const seqRows = (seqs.data || []) as Array<{ id: string; campaign_id: string }>;
  const steps = seqRows.length ? await supabase.from("follow_up_steps").select("sequence_id").eq("step_no", 1).eq("status", "sent").in("sequence_id", seqRows.map((s) => s.id)) : { data: [] };
  const sentSeq = new Set(((steps.data || []) as Array<{ sequence_id: string }>).map((s) => s.sequence_id));
  return campaigns.map((c) => ({ ...c, contacts: seqRows.filter((s) => s.campaign_id === c.id).length, sent: seqRows.filter((s) => s.campaign_id === c.id && sentSeq.has(s.id)).length }));
}

export async function loadCampaign(id: string): Promise<{ campaign: Campaign; contacts: CampaignContactRow[] } | null> {
  const { data: campaign, error } = await supabase.from("follow_up_campaigns").select("id, name, angle, status, auto_after_first, write_alike, created_at").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!campaign) return null;
  const { data: seqs, error: sErr } = await supabase.from("follow_up_sequences").select("id, company_search_id, contact_name, contact_email, contact_role, status, stop_reason").eq("campaign_id", id).order("contact_name");
  if (sErr) throw new Error(sErr.message);
  const rows = (seqs || []) as Array<{ id: string; company_search_id: string; contact_name: string; contact_email: string; contact_role: string | null; status: string; stop_reason: string | null }>;
  const companyIds = Array.from(new Set(rows.map((r) => r.company_search_id)));
  const [companies, steps] = await Promise.all([
    companyIds.length ? supabase.from("company_searches").select("id, company_name").in("id", companyIds) : Promise.resolve({ data: [] }),
    rows.length ? supabase.from("follow_up_steps").select(STEP_COLUMNS).in("sequence_id", rows.map((r) => r.id)).order("step_no") : Promise.resolve({ data: [] }),
  ]);
  const names = new Map(((companies.data || []) as Array<{ id: string; company_name: string }>).map((s) => [s.id, s.company_name]));
  const stepRows = (steps.data || []) as CampaignStepFull[];
  return { campaign: campaign as Campaign, contacts: rows.map((r) => ({ ...r, companyName: names.get(r.company_search_id) || "Company", steps: stepRows.filter((s) => s.sequence_id === r.id) })) };
}

export const campaignKey = (id: string) => ["campaign", id] as const;
export const campaignsKey = ["campaigns"] as const;
export function useCampaign(id: string) { return useQuery({ queryKey: campaignKey(id), queryFn: () => loadCampaign(id), enabled: !!id, staleTime: 5_000, refetchInterval: 30_000 }); }
export function useCampaigns() { return useQuery({ queryKey: campaignsKey, queryFn: loadCampaigns, staleTime: 15_000 }); }
