// Database helpers the follow-up functions share (Follow-ups slice 2):
// loading a sequence with its steps, stopping one, finishing one, and the
// "note" outcome that keeps the Calls tab the single record. Service role
// only; the rules themselves are in stop.ts and schedule.ts.

import { describeDue } from './schedule.ts';
import { sequenceIsDone } from './stop.ts';
import type { SequenceRow, StepRow } from './prompt.ts';

// deno-lint-ignore no-explicit-any
type Supabase = any;

export const SEQUENCE_COLUMNS = 'id, company_search_id, consultant_id, created_by, contact_name, contact_email, contact_role, vacancy_id, status, stop_reason, started_at, ended_at, plan, created_at, updated_at';

export interface SequenceWithSteps extends SequenceRow {
  stop_reason: string | null;
  ended_at: string | null;
  plan: unknown;
  steps: StepRow[];
}

export async function loadSequence(supabase: Supabase, sequenceId: string): Promise<SequenceWithSteps | null> {
  const { data: seq, error } = await supabase.from('follow_up_sequences').select(SEQUENCE_COLUMNS).eq('id', sequenceId).maybeSingle();
  if (error) throw new Error(`sequence: ${error.message}`);
  if (!seq) return null;
  const { data: steps, error: stepErr } = await supabase.from('follow_up_steps').select('*').eq('sequence_id', sequenceId).order('step_no');
  if (stepErr) throw new Error(`steps: ${stepErr.message}`);
  return { ...(seq as SequenceRow & { stop_reason: string | null; ended_at: string | null; plan: unknown }), steps: (steps || []) as StepRow[] };
}

export async function loadStep(supabase: Supabase, stepId: string): Promise<{ step: StepRow; sequence: SequenceWithSteps } | null> {
  const { data: step, error } = await supabase.from('follow_up_steps').select('*').eq('id', stepId).maybeSingle();
  if (error) throw new Error(`step: ${error.message}`);
  if (!step) return null;
  const sequence = await loadSequence(supabase, step.sequence_id);
  if (!sequence) return null;
  return { step: step as StepRow, sequence };
}

/** A line in the Calls history (kind 'note'), so the tab stays the single record of what happened. */
export async function logNote(supabase: Supabase, seq: Pick<SequenceRow, 'company_search_id' | 'consultant_id' | 'contact_name' | 'contact_role' | 'id'>, note: string, createdBy: string | null, extra: Record<string, unknown> = {}): Promise<string | null> {
  const { data, error } = await supabase.from('outcomes').insert({
    company_search_id: seq.company_search_id,
    consultant_id: seq.consultant_id,
    created_by: createdBy,
    contact_name: seq.contact_name,
    contact_role: seq.contact_role,
    kind: 'note',
    note,
    external_refs: { sequence_id: seq.id, ...extra },
  }).select('id').maybeSingle();
  if (error) { console.warn('follow-ups: note not logged', { message: error.message }); return null; }
  return data?.id ?? null;
}

/** Stop a sequence: status, reason, ended_at, and every step still to come. */
export async function stopSequence(supabase: Supabase, sequenceId: string, reason: string, now: Date = new Date()): Promise<void> {
  const at = now.toISOString();
  const { error } = await supabase.from('follow_up_sequences').update({ status: 'stopped', stop_reason: reason.slice(0, 200), ended_at: at }).eq('id', sequenceId).eq('status', 'active');
  if (error) throw new Error(`could not stop the sequence: ${error.message}`);
  const { error: stepErr } = await supabase.from('follow_up_steps').update({ status: 'stopped', completed_at: at }).eq('sequence_id', sequenceId).in('status', ['scheduled', 'due', 'approved']);
  if (stepErr) throw new Error(`could not stop the steps: ${stepErr.message}`);
}

/** Mark a sequence done when every step has ended. Returns true when it did. */
export async function finishIfDone(supabase: Supabase, sequenceId: string, now: Date = new Date()): Promise<boolean> {
  const { data: steps } = await supabase.from('follow_up_steps').select('status').eq('sequence_id', sequenceId);
  if (!sequenceIsDone((steps || []) as Array<{ status: string }>)) return false;
  const { error } = await supabase.from('follow_up_sequences').update({ status: 'done', ended_at: now.toISOString() }).eq('id', sequenceId).eq('status', 'active');
  if (error) { console.warn('follow-ups: could not mark the sequence done', { message: error.message }); return false; }
  return true;
}

/** "step 3, the second email, due Friday 18 Sep 13:30" for notes. */
export function describeStep(step: Pick<StepRow, 'step_no' | 'kind' | 'label' | 'due_at'>): string {
  return `step ${step.step_no} (${step.label || step.kind}, due ${describeDue(new Date(step.due_at))})`;
}
