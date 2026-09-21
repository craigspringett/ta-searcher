// follow-ups: the consultant's actions on a follow-up sequence (Follow-ups
// slice 2, docs/FOLLOW-UPS-BRIEF.md). Nothing here sends an email; sending
// an approved step is send-outreach-email with sequenceStepId.
//
// POST { action, ... } from a signed-in user with the follow_ups flag
// (a manager may act on any company; a consultant on companies on their list):
//   plan    { companySearchId }                     the default plan with its dates,
//                                                   the quiet-period answer, the open
//                                                   vacancies and the active sequence
//   start   { companySearchId, contactName, contactEmail, contactRole?, vacancyId? }
//                                                   start a sequence and draft its
//                                                   three emails (one model call each)
//   skip    { stepId }                              skip a due or scheduled step
//   done    { stepId, outcomeKind, note?, callbackAt? }
//                                                   log the outcome of a call step
//   stop    { sequenceId, reason?, outcomeKind? }   stop it, logging the outcome
//                                                   (replied, not_interested,
//                                                   spoke_to, meeting_booked) or a note
//   redraft { stepId }                              write one email again now
// Every action writes a line to the Calls history (an outcome), so the
// Calls tab stays the single record.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { mergedContactsFor } from '../_shared/contacts/edits.ts';
import { draftSequenceSteps } from '../_shared/follow-ups/draft.ts';
import { buildPlan, planEndsAt } from '../_shared/follow-ups/plan.ts';
import { describeDue } from '../_shared/follow-ups/schedule.ts';
import { quietPeriodBlock, STOP_OUTCOME_KINDS } from '../_shared/follow-ups/stop.ts';
import { describeStep, finishIfDone, loadSequence, loadStep, logNote, SEQUENCE_COLUMNS, stopSequence } from '../_shared/follow-ups/store.ts';
import { cors, json, myConsultantIds, requireFollowUpsCaller } from '../_shared/outreach/caller.ts';
import { isAddress } from '../_shared/outreach/rules.ts';

const UUID = /^[0-9a-f-]{36}$/i;
const CALL_OUTCOME_KINDS = ['spoke_to', 'voicemail', 'callback', 'not_interested', 'meeting_booked', 'replied'];

Deno.serve(async (req): Promise<Response> => {
  if (req.method === 'OPTIONS') return cors();
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const who = await requireFollowUpsCaller(req, supabase, { usersOnly: true });
  if (who.reject) return who.reject;
  const caller = who.ok.caller;
  if (caller.kind !== 'user') return json({ error: 'A signed-in consultant must do this.' }, 403);
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: 'Invalid JSON request body' }, 400); }
  const action = typeof b.action === 'string' ? b.action : '';
  const now = new Date();
  const mine = await myConsultantIds(supabase, caller);

  /** The company, and whether the caller may act on it. */
  type CompanyAccess = { ok: false; response: Response } | { ok: true; id: string; name: string; consultantId: string | null; decisionMakers: Array<{ name?: string; email?: string }> };
  const company = async (companySearchId: string): Promise<CompanyAccess> => {
    const { data, error } = await supabase.from('company_searches').select('id, company_name, analysis_result').eq('id', companySearchId).maybeSingle();
    if (error) return { ok: false, response: json({ error: error.message }, 500) };
    if (!data) return { ok: false, response: json({ error: 'Company not found' }, 404) };
    const name = ((data.analysis_result as { companyRecord?: { name?: string } } | null)?.companyRecord?.name) || data.company_name || 'the company';
    const { data: assigned } = await supabase.from('company_consultants').select('consultant_id').eq('company_search_id', data.id);
    const assignedIds = ((assigned || []) as Array<{ consultant_id: string }>).map((a) => a.consultant_id);
    const onMyList = assignedIds.some((id) => mine.includes(id));
    if (!onMyList && !who.ok.isManager) return { ok: false, response: json({ error: `${name} is not on your list. Ask a manager to assign it to you first.` }, 403) };
    const consultantId = assignedIds.find((id) => mine.includes(id)) || caller.profile.consultant_id || mine[0] || null;
    const dms = (data.analysis_result as { decisionMakers?: unknown } | null)?.decisionMakers;
    return { ok: true, id: data.id as string, name, consultantId, decisionMakers: Array.isArray(dms) ? dms as Array<{ name?: string; email?: string }> : [] };
  };

  try {
    if (action === 'plan') {
      const companySearchId = typeof b.companySearchId === 'string' && UUID.test(b.companySearchId) ? b.companySearchId : null;
      if (!companySearchId) return json({ error: 'companySearchId (uuid) is required' }, 400);
      const s = await company(companySearchId);
      if (!s.ok) return s.response;
      const [{ data: previous }, { data: vacancies }, { data: newestFact }] = await Promise.all([
        supabase.from('follow_up_sequences').select(SEQUENCE_COLUMNS).eq('company_search_id', s.id).order('started_at', { ascending: false }),
        supabase.from('vacancies').select('id, title, closing_date, first_seen, source, url').eq('company_search_id', s.id).eq('status', 'open').order('first_seen', { ascending: false }),
        supabase.from('company_facts').select('first_seen').eq('company_search_id', s.id).eq('active', true).order('first_seen', { ascending: false }).limit(1).maybeSingle(),
      ]);
      const rows = (previous || []) as Array<{ id: string; status: string; started_at: string; ended_at: string | null; contact_name: string; stop_reason: string | null }>;
      const active = rows.find((r) => r.status === 'active') || null;
      const openVacancies = (vacancies || []) as Array<{ id: string; title: string; closing_date: string | null; first_seen: string; source: string; url: string | null }>;
      const quiet = quietPeriodBlock({ previous: rows, newestVacancySeen: openVacancies[0]?.first_seen || null, newestFactSeen: (newestFact as { first_seen?: string } | null)?.first_seen || null, now });
      const plan = buildPlan(now).map((p) => ({ ...p, when: describeDue(new Date(p.dueAt)) }));
      return json({ ok: true, company: s.name, plan, endsAt: planEndsAt(buildPlan(now)), quiet, active, vacancies: openVacancies, previous: rows.slice(0, 5) });
    }

    if (action === 'start') {
      const companySearchId = typeof b.companySearchId === 'string' && UUID.test(b.companySearchId) ? b.companySearchId : null;
      if (!companySearchId) return json({ error: 'companySearchId (uuid) is required' }, 400);
      const contactName = typeof b.contactName === 'string' ? b.contactName.trim().slice(0, 200) : '';
      if (!contactName) return json({ error: 'contactName is required' }, 400);
      if (!isAddress(b.contactEmail)) return json({ error: 'contactEmail must be an email address' }, 400);
      const contactEmail = (b.contactEmail as string).trim().toLowerCase();
      const contactRole = typeof b.contactRole === 'string' && b.contactRole.trim() ? b.contactRole.trim().slice(0, 120) : null;
      const vacancyId = typeof b.vacancyId === 'string' && UUID.test(b.vacancyId) ? b.vacancyId : null;
      const s = await company(companySearchId);
      if (!s.ok) return s.response;

      // The address must belong to one of the company's contacts as edited (Contact edits, 18 September 2026).
      const contacts = await mergedContactsFor(supabase, s.id, s.decisionMakers);
      if (!contacts.some((c) => (c.email || '').toLowerCase() === contactEmail)) return json({ error: `${contactEmail} is not one of ${s.name}'s contacts. On the Contacts tab, edit the person's address or add them, then start again.`, code: 'not_a_contact' }, 400);

      const { data: suppressed } = await supabase.from('suppressed_emails').select('reason').eq('email', contactEmail).maybeSingle();
      if (suppressed) return json({ error: `This address ${suppressed.reason === 'complaint' ? 'marked an earlier email as spam' : suppressed.reason === 'bounce' ? 'bounced before' : 'asked not to be emailed'}, so TA Searcher will not email it. Phone instead.`, code: 'suppressed' }, 409);
      const [{ data: previous }, { data: newestVacancy }, { data: newestFact }] = await Promise.all([
        supabase.from('follow_up_sequences').select('id, status, started_at, ended_at, contact_name').eq('company_search_id', s.id).order('started_at', { ascending: false }),
        supabase.from('vacancies').select('first_seen').eq('company_search_id', s.id).eq('status', 'open').order('first_seen', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('company_facts').select('first_seen').eq('company_search_id', s.id).eq('active', true).order('first_seen', { ascending: false }).limit(1).maybeSingle(),
      ]);
      const rows = (previous || []) as Array<{ id: string; status: string; started_at: string; ended_at: string | null; contact_name: string }>;
      const active = rows.find((r) => r.status === 'active');
      if (active) return json({ error: `${s.name} already has follow-ups running for ${active.contact_name}. Stop those first.`, code: 'active', sequenceId: active.id }, 409);
      const quiet = quietPeriodBlock({ previous: rows, newestVacancySeen: (newestVacancy as { first_seen?: string } | null)?.first_seen || null, newestFactSeen: (newestFact as { first_seen?: string } | null)?.first_seen || null, now });
      if (quiet) return json({ error: quiet, code: 'quiet' }, 409);
      if (vacancyId) {
        const { data: v } = await supabase.from('vacancies').select('id').eq('id', vacancyId).eq('company_search_id', s.id).maybeSingle();
        if (!v) return json({ error: 'That vacancy is not one of this company\'s.' }, 400);
      }

      const plan = buildPlan(now);
      const { data: seq, error: seqErr } = await supabase.from('follow_up_sequences').insert({
        company_search_id: s.id,
        consultant_id: s.consultantId,
        created_by: caller.userId,
        contact_name: contactName,
        contact_email: contactEmail,
        contact_role: contactRole,
        vacancy_id: vacancyId,
        status: 'active',
        started_at: now.toISOString(),
        plan: plan.map((p) => ({ step_no: p.stepNo, kind: p.kind, day: p.day, due_at: p.dueAt, label: p.label })),
      }).select(SEQUENCE_COLUMNS).single();
      if (seqErr) {
        if (/follow_up_sequences_one_active_per_company/.test(seqErr.message)) return json({ error: `${s.name} already has follow-ups running. Stop those first.`, code: 'active' }, 409);
        return json({ error: `Could not start: ${seqErr.message}` }, 500);
      }
      const { error: stepErr } = await supabase.from('follow_up_steps').insert(plan.map((p) => ({
        sequence_id: seq.id,
        step_no: p.stepNo,
        kind: p.kind,
        day: p.day,
        label: p.label,
        due_at: p.dueAt,
        status: new Date(p.dueAt).getTime() <= now.getTime() ? 'due' : 'scheduled',
      })));
      if (stepErr) {
        await supabase.from('follow_up_sequences').delete().eq('id', seq.id);
        return json({ error: `Could not start: ${stepErr.message}` }, 500);
      }
      const ends = planEndsAt(plan);
      await logNote(supabase, seq, `Follow-ups started for ${contactName}: ${plan.length} steps to ${ends ? describeDue(new Date(ends)).replace(/ \d{2}:\d{2}$/, '') : 'the end of the plan'}.`, caller.userId, { action: 'start' });
      // The three emails, one model call each, in order so the company block is cached.
      let drafting: unknown = null;
      try {
        drafting = await draftSequenceSteps(supabase, seq.id, { reason: 'start', now });
      } catch (e) {
        console.error('follow-ups start: drafting failed', e instanceof Error ? e.message : e);
        drafting = { error: e instanceof Error ? e.message : String(e) };
      }
      const full = await loadSequence(supabase, seq.id);
      console.log('follow-ups started', { sequence: seq.id, company: s.id, by: caller.userId });
      return json({ ok: true, sequence: full, drafting, message: `Follow-ups started for ${contactName}. The first call is due now; the emails are drafted for you to approve.` });
    }

    if (action === 'skip' || action === 'done' || action === 'redraft') {
      const stepId = typeof b.stepId === 'string' && UUID.test(b.stepId) ? b.stepId : null;
      if (!stepId) return json({ error: 'stepId (uuid) is required' }, 400);
      const found = await loadStep(supabase, stepId);
      if (!found) return json({ error: 'Step not found' }, 404);
      const { step, sequence } = found;
      const s = await company(sequence.company_search_id);
      if (!s.ok) return s.response;
      if (sequence.status !== 'active') return json({ error: `These follow-ups have ${sequence.status === 'done' ? 'finished' : `stopped (${sequence.stop_reason || 'no reason given'})`}.`, code: 'inactive' }, 409);

      if (action === 'skip') {
        if (!['scheduled', 'due'].includes(step.status)) return json({ error: `This step is already ${step.status}.` }, 409);
        const { error } = await supabase.from('follow_up_steps').update({ status: 'skipped', completed_at: now.toISOString() }).eq('id', step.id);
        if (error) return json({ error: error.message }, 500);
        await logNote(supabase, sequence, `Skipped follow-up ${describeStep(step)}.`, caller.userId, { action: 'skip', step_no: step.step_no });
        const done = await finishIfDone(supabase, sequence.id, now);
        return json({ ok: true, sequence: await loadSequence(supabase, sequence.id), message: done ? 'Skipped. That was the last step, so the follow-ups are finished.' : 'Skipped.' });
      }

      if (action === 'done') {
        if (step.kind !== 'call') return json({ error: 'Only a call step is logged this way; an email is sent with Approve and send.' }, 400);
        if (!['scheduled', 'due'].includes(step.status)) return json({ error: `This step is already ${step.status}.` }, 409);
        const kind = typeof b.outcomeKind === 'string' && CALL_OUTCOME_KINDS.includes(b.outcomeKind) ? b.outcomeKind : null;
        if (!kind) return json({ error: `outcomeKind must be one of ${CALL_OUTCOME_KINDS.join(', ')}` }, 400);
        const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 2000) : null;
        const callbackAt = typeof b.callbackAt === 'string' && !Number.isNaN(new Date(b.callbackAt).getTime()) ? new Date(b.callbackAt).toISOString() : null;
        if (kind === 'callback' && !callbackAt) return json({ error: 'When should they be called back? (callbackAt)' }, 400);
        const { data: outcome, error } = await supabase.from('outcomes').insert({
          company_search_id: sequence.company_search_id,
          consultant_id: sequence.consultant_id,
          created_by: caller.userId,
          contact_name: sequence.contact_name,
          contact_role: sequence.contact_role,
          kind,
          note,
          callback_at: callbackAt,
          external_refs: { sequence_id: sequence.id, step_no: step.step_no },
        }).select('id').single();
        if (error) return json({ error: `Could not log the call: ${error.message}` }, 500);
        const { error: upErr } = await supabase.from('follow_up_steps').update({ status: 'done', outcome_id: outcome.id, completed_at: now.toISOString() }).eq('id', step.id);
        if (upErr) return json({ error: upErr.message }, 500);
        let message = 'Call logged.';
        if (STOP_OUTCOME_KINDS[kind]) {
          await stopSequence(supabase, sequence.id, STOP_OUTCOME_KINDS[kind], now);
          message = `Call logged. The follow-ups have stopped: ${STOP_OUTCOME_KINDS[kind]}.`;
        } else if (await finishIfDone(supabase, sequence.id, now)) {
          message = 'Call logged. That was the last step, so the follow-ups are finished.';
        }
        return json({ ok: true, sequence: await loadSequence(supabase, sequence.id), message });
      }

      // redraft
      if (step.kind !== 'email' || !['scheduled', 'due'].includes(step.status)) return json({ error: 'Only an email that has not gone yet can be written again.' }, 409);
      const result = await draftSequenceSteps(supabase, sequence.id, { stepIds: [step.id], force: true, reason: 'redraft', now });
      const failed = result.failed[0];
      return json({ ok: !failed, sequence: await loadSequence(supabase, sequence.id), drafting: result, message: failed ? `Could not write it again: ${failed.error}` : 'Written again.' }, failed ? 502 : 200);
    }

    if (action === 'stop') {
      const sequenceId = typeof b.sequenceId === 'string' && UUID.test(b.sequenceId) ? b.sequenceId : null;
      if (!sequenceId) return json({ error: 'sequenceId (uuid) is required' }, 400);
      const sequence = await loadSequence(supabase, sequenceId);
      if (!sequence) return json({ error: 'Sequence not found' }, 404);
      const s = await company(sequence.company_search_id);
      if (!s.ok) return s.response;
      if (sequence.status !== 'active') return json({ error: 'These follow-ups have already ended.', code: 'inactive' }, 409);
      const outcomeKind = typeof b.outcomeKind === 'string' && STOP_OUTCOME_KINDS[b.outcomeKind] ? b.outcomeKind : null;
      const reasonText = typeof b.reason === 'string' && b.reason.trim() ? b.reason.trim().slice(0, 200) : null;
      const reason = outcomeKind ? STOP_OUTCOME_KINDS[outcomeKind] : reasonText || 'stopped by the consultant';
      if (outcomeKind) {
        const { error } = await supabase.from('outcomes').insert({
          company_search_id: sequence.company_search_id,
          consultant_id: sequence.consultant_id,
          created_by: caller.userId,
          contact_name: sequence.contact_name,
          contact_role: sequence.contact_role,
          kind: outcomeKind,
          note: reasonText,
          external_refs: { sequence_id: sequence.id, action: 'stop' },
        });
        if (error) return json({ error: `Could not log the outcome: ${error.message}` }, 500);
      } else {
        await logNote(supabase, sequence, `Follow-ups stopped: ${reason}.`, caller.userId, { action: 'stop' });
      }
      await stopSequence(supabase, sequence.id, reason, now);
      return json({ ok: true, sequence: await loadSequence(supabase, sequence.id), message: `Follow-ups stopped: ${reason}.` });
    }

    return json({ error: 'action must be one of plan, start, skip, done, stop, redraft' }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('follow-ups failed:', { action, message: msg });
    return json({ error: msg }, 500);
  }
});
