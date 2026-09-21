// Promotion: a qualified prospect becomes a tracked company (docs/
// PROSPECTING-BRIEF.md, "Qualification", step 5). The rule is pure and
// tested; the write inserts company_searches, the consultant assignment
// and the confirmed boards, then queues analyze-company through
// enqueue_analyze_company_batch with isRefresh so the run takes the
// existing row. One user, one patch: the single active consultant row is
// the assignee; with none or several the promotion is refused and the run
// says why.

import type { ProspectBoard } from './types.ts';

// deno-lint-ignore no-explicit-any
type Supabase = any;

export const WEEK_DAYS = 7;

export interface PromotionInput {
  score: number;
  threshold: number;
  website: string | null;
  promotedThisWeek: number;
  cap: number;
  /** The website host is a tracked company's. */
  tracked: boolean;
  /** Dismissed within the quiet period. */
  dismissedRecently: boolean;
  /** The page's Add button: the threshold and the cap do not apply. */
  forced?: boolean;
  /** Not active on the register. */
  defunct?: boolean;
}

export interface PromotionDecision {
  promote: boolean;
  reason: string;
}

/** Whether to promote, and why not. */
export function promotionDecision(i: PromotionInput): PromotionDecision {
  if (!i.website) return { promote: false, reason: 'no website known' };
  if (i.tracked) return { promote: false, reason: 'already tracked' };
  if (i.defunct) return { promote: false, reason: 'not active on the register' };
  if (i.dismissedRecently && !i.forced) return { promote: false, reason: 'dismissed recently' };
  if (!i.forced && i.score < i.threshold) return { promote: false, reason: `score ${i.score} is under the threshold of ${i.threshold}` };
  if (!i.forced && i.promotedThisWeek >= i.cap) return { promote: false, reason: `the weekly cap of ${i.cap} is reached` };
  return { promote: true, reason: i.forced ? 'added by hand' : `score ${i.score} reaches ${i.threshold}` };
}

/** The one active consultant, or why there is not exactly one. */
export async function singleActiveConsultant(supabase: Supabase): Promise<{ id: string; name: string } | { id: null; error: string }> {
  const { data, error } = await supabase.from('consultants').select('id, name').eq('active', true).limit(5);
  if (error) return { id: null, error: `consultants read failed: ${error.message}` };
  const rows = data || [];
  if (rows.length === 1) return { id: String(rows[0].id), name: String(rows[0].name) };
  if (!rows.length) return { id: null, error: 'no active consultant to assign the company to' };
  return { id: null, error: `${rows.length} active consultants; the radar assigns to one only` };
}

/** How many prospects were promoted in the last seven days. */
export async function promotedThisWeek(supabase: Supabase, today: Date): Promise<number> {
  const since = new Date(today.getTime() - WEEK_DAYS * 86_400_000).toISOString();
  const { count, error } = await supabase.from('prospects').select('id', { count: 'exact', head: true }).eq('status', 'promoted').gte('promoted_at', since);
  if (error) throw new Error(`prospects count failed: ${error.message}`);
  return count ?? 0;
}

export interface PromoteInput {
  prospectId: string;
  name: string;
  website: string;
  companyNumber: string | null;
  boards: ProspectBoard[];
  consultantId: string;
  supabaseUrl: string;
  today: Date;
}

export interface Promoted {
  companyId: string;
  queued: number;
  note: string;
}

/** The writes. Throws with the failing step in the message; the prospect row is left as it was when the company row could not be made. */
export async function promoteProspect(supabase: Supabase, input: PromoteInput): Promise<Promoted> {
  const now = input.today.toISOString();
  const { data: company, error: insErr } = await supabase
    .from('company_searches')
    .insert({ url: input.website, company_number: input.companyNumber, company_name: input.name, analysis_result: {} })
    .select('id')
    .maybeSingle();
  if (insErr || !company?.id) throw new Error(`company_searches insert failed: ${insErr?.message || 'no id'}`);
  const companyId = String(company.id);
  const { error: assignErr } = await supabase.from('company_consultants').insert({ company_search_id: companyId, consultant_id: input.consultantId });
  if (assignErr) throw new Error(`company_consultants insert failed: ${assignErr.message}`);
  const seen = new Set<string>();
  for (const b of input.boards) {
    if (seen.has(b.provider)) continue;
    seen.add(b.provider);
    const { error: boardErr } = await supabase.from('ats_boards').upsert({
      company_search_id: companyId, provider: b.provider, slug: b.slug, board_url: b.boardUrl,
      confirmed_at: now, last_checked_at: now, last_ok_at: now, last_count: b.count, note: `from the prospect radar; ${b.note || 'confirmed'}`,
    }, { onConflict: 'company_search_id,provider' });
    if (boardErr) throw new Error(`ats_boards upsert failed: ${boardErr.message}`);
  }
  const payload = { companyId, url: input.website, companyName: input.name, companyNumber: input.companyNumber, isRefresh: true };
  const { data: queued, error: rpcErr } = await supabase.rpc('enqueue_analyze_company_batch', { payloads: [payload], target_url: `${input.supabaseUrl}/functions/v1/analyze-company`, auth_token: '' });
  if (rpcErr) throw new Error(`analyze-company not queued: ${rpcErr.message}`);
  const { error: updErr } = await supabase.from('prospects').update({ status: 'promoted', promoted_at: now, promoted_company_id: companyId, last_seen_at: now }).eq('id', input.prospectId);
  if (updErr) throw new Error(`prospects update failed: ${updErr.message}`);
  return { companyId, queued: Number(queued || 0), note: `added as company ${companyId}${Number(queued || 0) ? ', analysis queued' : ', already queued'}` };
}
