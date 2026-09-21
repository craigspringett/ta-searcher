// tick-follow-ups: the pass over every active follow-up sequence, every
// fifteen minutes from pg_cron (Follow-ups slice 2). It never sends
// anything; an email goes only when the consultant presses Approve and
// send. In order, for each active sequence:
//   1. stop it when a stopping outcome (spoke to, meeting booked, not
//      interested, replied) was logged after it started, when Resend
//      reported a bounce or a complaint for the contact, or when the address
//      is on the suppression list (stop.ts);
//   2. mark steps due (scheduled and due_at has passed); a due call step
//      after day 0 gets its two-line script from the emails that went;
//   3. attach a call outcome logged by hand since a call step fell due
//      (the step is done with that outcome);
//   4. write the draft of an email step that is due today or overdue when it
//      has none, or when something changed at the company since it was
//      written (draft.ts; a few drafts a pass, one model call each);
//   5. mark the sequence done when every step has ended.
//
// POST {} from the service role (pg_cron) or a manager with the flag
// (a manual run from the app). Optional { limitDrafts, sequenceId }.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { draftSequenceSteps } from '../_shared/follow-ups/draft.ts';
import { londonDate } from '../_shared/follow-ups/schedule.ts';
import { secondCallScript, stopDecision } from '../_shared/follow-ups/stop.ts';
import { finishIfDone, logNote, SEQUENCE_COLUMNS, stopSequence } from '../_shared/follow-ups/store.ts';
import type { SequenceRow, StepRow } from '../_shared/follow-ups/prompt.ts';
import { cors, json, requireFollowUpsCaller } from '../_shared/outreach/caller.ts';

const CALL_OUTCOME_KINDS = ['spoke_to', 'voicemail', 'callback', 'not_interested', 'meeting_booked'];
const DEFAULT_DRAFT_LIMIT = 6;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return cors();
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const who = await requireFollowUpsCaller(req, supabase, { managersOnly: true });
  if (who.reject) return who.reject;
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let body: { limitDrafts?: unknown; sequenceId?: unknown } = {};
  try { body = await req.json(); } catch { /* an empty body is fine */ }
  const draftBudgetTotal = typeof body.limitDrafts === 'number' && body.limitDrafts >= 0 ? Math.floor(body.limitDrafts) : DEFAULT_DRAFT_LIMIT;
  const onlySequence = typeof body.sequenceId === 'string' && /^[0-9a-f-]{36}$/i.test(body.sequenceId) ? body.sequenceId : null;
  const now = new Date();
  const nowIso = now.toISOString();
  const today = londonDate(now);
  const started = Date.now();

  let q = supabase.from('follow_up_sequences').select(SEQUENCE_COLUMNS).eq('status', 'active').order('started_at');
  if (onlySequence) q = q.eq('id', onlySequence);
  const { data: seqRows, error } = await q;
  if (error) return json({ error: error.message }, 500);
  const sequences = (seqRows || []) as SequenceRow[];
  const counts = { sequences: sequences.length, stopped: 0, markedDue: 0, callsAttached: 0, scripts: 0, drafted: 0, draftsFailed: 0, done: 0, errors: 0 };
  const log: string[] = [];
  let draftBudget = draftBudgetTotal;

  for (const seq of sequences) {
    try {
      const [{ data: stepRows }, { data: outcomeRows }, { data: eventRows }, { data: suppressed }] = await Promise.all([
        supabase.from('follow_up_steps').select('*').eq('sequence_id', seq.id).order('step_no'),
        supabase.from('outcomes').select('id, kind, created_at, contact_name, external_refs').eq('company_search_id', seq.company_search_id).gt('created_at', seq.started_at).order('created_at'),
        supabase.from('email_events').select('event_type, recipient_email, occurred_at').eq('recipient_email', seq.contact_email).gt('occurred_at', seq.started_at).in('event_type', ['bounced', 'complained']),
        supabase.from('suppressed_emails').select('reason').eq('email', seq.contact_email).maybeSingle(),
      ]);
      const steps = (stepRows || []) as StepRow[];
      const outcomes = (outcomeRows || []) as Array<{ id: string; kind: string; created_at: string; contact_name: string | null; external_refs: Record<string, unknown> | null }>;

      // 1. Stop?
      const stop = stopDecision({ startedAt: seq.started_at, contactEmail: seq.contact_email, outcomes, events: (eventRows || []) as Array<{ event_type: string; recipient_email: string; occurred_at: string }>, suppressedReason: (suppressed as { reason?: string } | null)?.reason || null });
      if (stop) {
        await stopSequence(supabase, seq.id, stop.reason, now);
        if (stop.because !== 'outcome') await logNote(supabase, seq, `Follow-ups stopped: ${stop.reason}.`, null, { action: 'auto_stop', because: stop.because });
        counts.stopped++;
        log.push(`${seq.id}: stopped (${stop.reason})`);
        continue;
      }

      // 2. Mark due; the day 8 call gets its script.
      const consultantName = await consultantDisplayName(supabase, seq);
      for (const step of steps) {
        if (step.status === 'scheduled' && step.due_at <= nowIso) {
          const update: Record<string, unknown> = { status: 'due' };
          if (step.kind === 'call' && step.day > 0 && !step.body) {
            const sent = steps.filter((s) => s.kind === 'email' && s.status === 'sent' && s.step_no < step.step_no).map((s) => ({ sentAt: s.completed_at || s.due_at, subject: s.subject, hook: s.hook }));
            update.body = secondCallScript(seq.contact_name, consultantName, sent);
            counts.scripts++;
          }
          const { error: upErr } = await supabase.from('follow_up_steps').update(update).eq('id', step.id).eq('status', 'scheduled');
          if (!upErr) { step.status = 'due'; counts.markedDue++; }
        }
      }

      // 3. A call logged by hand since the call step fell due counts as the step done.
      for (const step of steps) {
        if (step.kind !== 'call' || step.status !== 'due') continue;
        const claimed = new Set(steps.map((s) => s.outcome_id).filter(Boolean));
        const hit = outcomes.find((o) => CALL_OUTCOME_KINDS.includes(o.kind) && o.created_at >= step.due_at && !claimed.has(o.id));
        if (!hit) continue;
        const { error: upErr } = await supabase.from('follow_up_steps').update({ status: 'done', outcome_id: hit.id, completed_at: hit.created_at }).eq('id', step.id).eq('status', 'due');
        if (!upErr) { step.status = 'done'; step.outcome_id = hit.id; counts.callsAttached++; }
      }

      // 4. Drafts for the email steps due today or overdue (no draft, or the company changed).
      const dueToday = steps.filter((s) => s.kind === 'email' && ['scheduled', 'due'].includes(s.status) && londonDate(new Date(s.due_at)) <= today);
      if (dueToday.length && draftBudget > 0) {
        const result = await draftSequenceSteps(supabase, seq.id, { stepIds: dueToday.map((s) => s.id), limit: draftBudget, reason: 'tick', now });
        draftBudget -= result.drafted.length;
        counts.drafted += result.drafted.length;
        counts.draftsFailed += result.failed.length;
        if (result.drafted.length || result.failed.length) log.push(`${seq.id}: drafted ${result.drafted.map((d) => d.stepNo).join(',') || 'none'}${result.failed.length ? `, failed ${result.failed.map((f) => `${f.stepNo} (${f.error.slice(0, 80)})`).join('; ')}` : ''}`);
      }

      // 5. Done?
      if (await finishIfDone(supabase, seq.id, now)) { counts.done++; log.push(`${seq.id}: done`); }
    } catch (e) {
      counts.errors++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error('tick-follow-ups: sequence failed', { sequence: seq.id, message: msg });
      log.push(`${seq.id}: error ${msg.slice(0, 120)}`);
    }
  }

  const summary = { ok: counts.errors === 0, at: nowIso, ...counts, draftBudgetLeft: draftBudget, ms: Date.now() - started, log };
  console.log('tick-follow-ups', JSON.stringify({ ...summary, log: undefined }));
  return json(summary);
});

// deno-lint-ignore no-explicit-any
async function consultantDisplayName(supabase: any, seq: SequenceRow): Promise<string | null> {
  if (seq.created_by) {
    const { data } = await supabase.from('profiles').select('display_name').eq('id', seq.created_by).maybeSingle();
    if (data?.display_name) return String(data.display_name);
  }
  if (seq.consultant_id) {
    const { data } = await supabase.from('consultants').select('name').eq('id', seq.consultant_id).maybeSingle();
    if (data?.name) return String(data.name);
  }
  return null;
}
