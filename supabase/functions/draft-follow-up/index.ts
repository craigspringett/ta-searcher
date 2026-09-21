// draft-follow-up: write (or write again) the emails of a follow-up
// sequence from the company context already held (Follow-ups slice 2).
//
// POST { sequenceId, stepIds?: string[], force?: boolean }
//   stepIds  only these email steps (default: every email step that is
//            scheduled or due)
//   force    write again even when a draft exists and nothing changed
//
// Callers: the app's "Write it again" button (a signed-in user with the
// follow_ups flag, for a company on their list or as a manager) and the
// service role. The follow-ups function and tick-follow-ups call the same
// module (_shared/follow-ups/draft.ts) in-process. One model call per
// draft, a second only when the checks fail; every call is logged to
// ai_usage. Nothing is sent from here.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { draftSequenceSteps, FollowUpDraftError } from '../_shared/follow-ups/draft.ts';
import { cors, json, myConsultantIds, requireFollowUpsCaller } from '../_shared/outreach/caller.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return cors();
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const who = await requireFollowUpsCaller(req, supabase);
  if (who.reject) return who.reject;
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: { sequenceId?: string; stepIds?: unknown; force?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON request body' }, 400); }
  const sequenceId = typeof body.sequenceId === 'string' && /^[0-9a-f-]{36}$/i.test(body.sequenceId) ? body.sequenceId : null;
  if (!sequenceId) return json({ error: 'sequenceId (uuid) is required' }, 400);
  const stepIds = Array.isArray(body.stepIds) ? body.stepIds.filter((s): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s)) : undefined;

  // A signed-in user may only draft for a company on their list (a manager for any).
  const caller = who.ok.caller;
  if (caller.kind === 'user' && !who.ok.isManager) {
    const { data: seq } = await supabase.from('follow_up_sequences').select('company_search_id').eq('id', sequenceId).maybeSingle();
    if (!seq) return json({ error: 'Sequence not found' }, 404);
    const mine = await myConsultantIds(supabase, caller);
    const { data: assigned } = await supabase.from('company_consultants').select('consultant_id').eq('company_search_id', seq.company_search_id);
    if (!((assigned || []) as Array<{ consultant_id: string }>).some((a) => mine.includes(a.consultant_id))) return json({ error: 'This company is not on your list.' }, 403);
  }

  try {
    const result = await draftSequenceSteps(supabase, sequenceId, { stepIds, force: body.force === true, reason: caller.kind === 'user' ? 'redraft' : 'service' });
    const status = result.failed.length && !result.drafted.length ? 502 : 200;
    return json({ ok: status === 200, ...result }, status);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('draft-follow-up failed:', msg);
    return json({ error: msg, retryable: e instanceof FollowUpDraftError ? e.retryable : false }, 500);
  }
});
