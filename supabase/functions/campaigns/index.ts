// campaigns: follow-up campaigns, stage 1 (Craig, 18 November 2026; ported from
// He-Giveth). A batch of up to 15 contacts (2 at most at one company) started together, each with its
// own follow-up sequence on the ordinary engine, so replies, calls, stop rules
// and auto-send all work as they do for one contact.
//
// POST { action, ... } from a signed-in user whose profile carries BOTH the
// follow_ups and the follow_up_campaigns flags (off for everyone until Craig
// switches them on):
//   create       { name, angle?, plan?: [{kind, day}], contacts: [{companySearchId, contactName,
//                  contactEmail, contactRole?}], autoAfterFirst? }  (autoAfterFirst: approved emails go by themselves on their days)
//                makes the campaign and one sequence per contact (auto-send OFF, the emails
//                not yet written: the app asks draft-follow-up for each, then the consultant
//                approves every first email one at a time). Contacts that cannot start
//                (not on their list, not a listed contact, suppressed, already running,
//                in the quiet period) come back in `skipped` with the reason.
//   set_auto     { campaignId, enabled }   after the first email goes, do the later emails go by themselves
//   align        { campaignId, modelSequenceId }  other contacts' open emails will follow this contact's (returns what to write again)
//   approve_step { campaignId, stepId }    read and approve one later email; it then goes by itself on its day
//   unapprove_step { campaignId, stepId }
//   pause        { campaignId }            nothing goes by itself until resumed
//   resume       { campaignId }
//   stop         { campaignId }            stops every run still going
// Nothing is sent here. The first email of every contact is sent by the consultant
// pressing Approve and send on that one email (send-outreach-email). Every later
// email is read and approved the same way, one at a time (approve_step), and then
// goes out by itself on its day (tick-follow-ups holds any campaign email nobody approved).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { mergedContactsFor } from '../_shared/contacts/edits.ts';
import { buildPlan } from '../_shared/follow-ups/plan.ts';
import { describeDue } from '../_shared/follow-ups/schedule.ts';
import { quietPeriodBlock } from '../_shared/follow-ups/stop.ts';
import { logNote, SEQUENCE_COLUMNS, stopSequence } from '../_shared/follow-ups/store.ts';
import { emailStageAt, parseCampaignRequest, planTemplateFrom, stepNotes, type CampaignStage } from '../_shared/follow-ups/campaign.ts';
import { cors, json, myConsultantIds, requireFollowUpsCaller } from '../_shared/outreach/caller.ts';

const UUID = /^[0-9a-f-]{36}$/i;

Deno.serve(async (req): Promise<Response> => {
  if (req.method === 'OPTIONS') return cors();
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const who = await requireFollowUpsCaller(req, supabase, { usersOnly: true });
  if (who.reject) return who.reject;
  if (who.ok.features.follow_up_campaigns !== true) return json({ error: 'Not found' }, 404);
  const caller = who.ok.caller;
  if (caller.kind !== 'user') return json({ error: 'A signed-in consultant must do this.' }, 403);
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: 'Invalid JSON request body' }, 400); }
  const action = typeof b.action === 'string' ? b.action : '';
  const now = new Date();

  type Camp = { id: string; name: string; status: string; auto_after_first: boolean; created_by: string };
  const ownCampaign = async (id: unknown): Promise<{ error: Response; campaign: null } | { error: null; campaign: Camp }> => {
    if (typeof id !== 'string' || !UUID.test(id)) return { error: json({ error: 'campaignId (uuid) is required' }, 400), campaign: null };
    const { data } = await supabase.from('follow_up_campaigns').select('id, name, status, auto_after_first, created_by').eq('id', id).maybeSingle();
    if (!data) return { error: json({ error: 'Campaign not found' }, 404), campaign: null };
    if (data.created_by !== caller.userId && !who.ok.isManager) return { error: json({ error: 'That is not your campaign.' }, 403), campaign: null };
    return { error: null, campaign: data as Camp };
  };

  try {
    if (action === 'create') {
      const parsed = parseCampaignRequest(b);
      if (parsed.ok === null) return json({ error: parsed.error }, 400);
      const r = parsed.ok;
      const mine = await myConsultantIds(supabase, caller);
      const template = planTemplateFrom(r.plan);
      const plan = buildPlan(now, {}, template);

      const companyIds = Array.from(new Set(r.contacts.map((c) => c.companySearchId)));
      const { data: companies } = await supabase.from('company_searches').select('id, company_name, analysis_result').in('id', companyIds);
      const companyById = new Map(((companies || []) as Array<{ id: string; company_name: string; analysis_result: { decisionMakers?: unknown; companyRecord?: { name?: string } } | null }>).map((s) => [s.id, s]));
      const { data: assigned } = await supabase.from('company_consultants').select('company_search_id, consultant_id').in('company_search_id', companyIds);
      const consultantsByCompany = new Map<string, string[]>();
      for (const a of (assigned || []) as Array<{ company_search_id: string; consultant_id: string }>) (consultantsByCompany.get(a.company_search_id) ?? consultantsByCompany.set(a.company_search_id, []).get(a.company_search_id)!).push(a.consultant_id);

      const skipped: Array<{ contactName: string; companyName: string; reason: string }> = [];
      type Ok = { c: (typeof r.contacts)[number]; companyName: string; consultantId: string | null };
      const ready: Ok[] = [];
      for (const c of r.contacts) {
        const s = companyById.get(c.companySearchId);
        const companyName = s?.analysis_result?.companyRecord?.name || s?.company_name || 'the company';
        const skip = (reason: string) => skipped.push({ contactName: c.contactName, companyName, reason });
        if (!s) { skip('Company not found.'); continue; }
        const ids = consultantsByCompany.get(c.companySearchId) || [];
        if (!ids.some((id) => mine.includes(id)) && !who.ok.isManager) { skip('Not on your list.'); continue; }
        const consultantId = ids.find((id) => mine.includes(id)) || caller.profile.consultant_id || mine[0] || null;
        const dms = (s.analysis_result as { decisionMakers?: unknown } | null)?.decisionMakers;
        const contacts = await mergedContactsFor(supabase, s.id, Array.isArray(dms) ? dms as Array<{ name?: string; email?: string }> : []);
        if (!contacts.some((x) => (x.email || '').toLowerCase() === c.contactEmail)) { skip('Not one of the company\'s listed contacts.'); continue; }
        const { data: suppressed } = await supabase.from('suppressed_emails').select('reason').eq('email', c.contactEmail).maybeSingle();
        if (suppressed) { skip('This address bounced, complained or opted out. Phone instead.'); continue; }
        const [{ data: previous }, { data: newestVacancy }, { data: newestFact }] = await Promise.all([
          supabase.from('follow_up_sequences').select('id, status, started_at, ended_at, contact_name, contact_email, stop_reason').eq('company_search_id', s.id).order('started_at', { ascending: false }),
          supabase.from('vacancies').select('first_seen').eq('company_search_id', s.id).eq('status', 'open').order('first_seen', { ascending: false }).limit(1).maybeSingle(),
          supabase.from('company_facts').select('first_seen').eq('company_search_id', s.id).eq('active', true).order('first_seen', { ascending: false }).limit(1).maybeSingle(),
        ]);
        // Only this person's earlier runs count (23 October 2026): another person at the company can be started beside any other run.
        const rows = ((previous || []) as Array<{ id: string; status: string; started_at: string; ended_at: string | null; contact_name: string; contact_email: string; stop_reason: string | null }>).filter((x) => (x.contact_email || '').toLowerCase() === c.contactEmail);
        if (rows.some((x) => x.status === 'active' && (x.contact_email || '').toLowerCase() === c.contactEmail)) { skip('Already has follow-ups running.'); continue; }
        const quiet = quietPeriodBlock({ previous: rows, newestVacancySeen: (newestVacancy as { first_seen?: string } | null)?.first_seen || null, newestFactSeen: (newestFact as { first_seen?: string } | null)?.first_seen || null, now });
        if (quiet) { skip(quiet); continue; }
        ready.push({ c, companyName, consultantId });
      }
      if (ready.length === 0) return json({ ok: false, error: 'None of those contacts could be started.', skipped }, 409);

      const { data: campaign, error: cErr } = await supabase.from('follow_up_campaigns').insert({
        name: r.name, angle: r.angle || null, plan: r.plan, created_by: caller.userId, consultant_id: ready[0].consultantId, auto_after_first: r.autoAfterFirst, write_alike: r.writeAlike, status: 'active',
      }).select('id').single();
      if (cErr) return json({ error: `Could not create the campaign: ${cErr.message}` }, 500);

      const created: Array<{ sequenceId: string; contactName: string; companyName: string }> = [];
      for (const { c, companyName, consultantId } of ready) {
        const { data: seq, error: seqErr } = await supabase.from('follow_up_sequences').insert({
          company_search_id: c.companySearchId, consultant_id: consultantId, created_by: caller.userId,
          contact_name: c.contactName, contact_email: c.contactEmail, contact_role: c.contactRole,
          campaign_id: campaign.id, status: 'active', started_at: now.toISOString(), auto_send: r.autoAfterFirst,
          plan: plan.map((p) => ({ step_no: p.stepNo, kind: p.kind, day: p.day, due_at: p.dueAt, label: p.label })),
        }).select(SEQUENCE_COLUMNS).single();
        if (seqErr) { skipped.push({ contactName: c.contactName, companyName, reason: /one_active/.test(seqErr.message) ? 'Already has follow-ups running.' : `Could not start: ${seqErr.message}` }); continue; }
        let emailNo = -1;
        const { error: stepErr } = await supabase.from('follow_up_steps').insert(plan.map((p) => {
          if (p.kind === 'email') emailNo++;
          return {
            sequence_id: seq.id, step_no: p.stepNo, kind: p.kind, day: p.day, label: p.label, due_at: p.dueAt,
            status: new Date(p.dueAt).getTime() <= now.getTime() ? 'due' : 'scheduled',
            notes: p.kind === 'email' ? stepNotes(r.angle, emailStageAt(r.plan, emailNo), null) : null,
          };
        }));
        if (stepErr) { await supabase.from('follow_up_sequences').delete().eq('id', seq.id); skipped.push({ contactName: c.contactName, companyName, reason: `Could not start: ${stepErr.message}` }); continue; }
        await logNote(supabase, seq, `Follow-ups started for ${c.contactName} in the campaign "${r.name}": ${plan.length} steps to ${describeDue(new Date(plan[plan.length - 1].dueAt)).replace(/ \d{2}:\d{2}$/, '')}. Every email waits for your approval.`, caller.userId, { action: 'campaign_start', campaign_id: campaign.id });
        created.push({ sequenceId: seq.id, contactName: c.contactName, companyName });
      }
      if (created.length === 0) {
        await supabase.from('follow_up_campaigns').delete().eq('id', campaign.id);
        return json({ ok: false, error: 'None of those contacts could be started.', skipped }, 409);
      }
      console.log('campaign created', { campaign: campaign.id, contacts: created.length, by: caller.userId });
      return json({ ok: true, campaignId: campaign.id, created, skipped, message: `Campaign "${r.name}" started with ${created.length} contact${created.length === 1 ? '' : 's'}. The emails are being written; approve each first email yourself.` });
    }

    const own = await ownCampaign(b.campaignId);
    if (own.error) return own.error;
    const camp = own.campaign;

    // Do approved emails go by themselves on their days? (Nothing unapproved ever does: the tick holds it.)
    const syncAuto = async (enabled: boolean) => {
      await supabase.from('follow_up_sequences').update({ auto_send: enabled }).eq('campaign_id', camp.id).eq('status', 'active');
    };

    // Make the other contacts' emails follow one contact's (Craig, 18 November 2026): their unsent, unapproved, unedited emails get the model
    // contact's matching email as a template in their notes, and the ids to write again come back (the app asks draft-follow-up for each).
    if (action === 'align') {
      const modelId = typeof b.modelSequenceId === 'string' && UUID.test(b.modelSequenceId) ? b.modelSequenceId : null;
      if (!modelId) return json({ error: 'modelSequenceId (uuid) is required' }, 400);
      const { data: cfull } = await supabase.from('follow_up_campaigns').select('angle, plan').eq('id', camp.id).maybeSingle();
      const plan = (Array.isArray(cfull?.plan) ? cfull!.plan : []) as CampaignStage[];
      const { data: seqs } = await supabase.from('follow_up_sequences').select('id').eq('campaign_id', camp.id).eq('status', 'active');
      const ids = ((seqs || []) as Array<{ id: string }>).map((x) => x.id);
      if (!ids.includes(modelId)) return json({ error: 'That contact is not in this campaign.' }, 400);
      const { data: allSteps } = await supabase.from('follow_up_steps').select('id, sequence_id, step_no, kind, status, subject, body, edited_at, campaign_approved_at').in('sequence_id', ids).eq('kind', 'email').order('step_no');
      type S = { id: string; sequence_id: string; step_no: number; status: string; subject: string | null; body: string | null; edited_at: string | null; campaign_approved_at: string | null };
      const steps = (allSteps || []) as S[];
      const model = steps.filter((x) => x.sequence_id === modelId);
      if (model.some((x) => !x.body)) return json({ error: 'That contact\'s emails have not all been written yet.' }, 409);
      const targets: Array<{ sequenceId: string; stepIds: string[] }> = [];
      for (const id of ids) {
        if (id === modelId) continue;
        const mine = steps.filter((x) => x.sequence_id === id);
        const stepIds: string[] = [];
        for (let i = 0; i < mine.length; i++) {
          const st = mine[i];
          if (!['scheduled', 'due'].includes(st.status) || st.edited_at || st.campaign_approved_at) continue; // sent, approved or changed by hand: left alone
          const tpl = model[i];
          if (!tpl?.body) continue;
          const notes = stepNotes((cfull?.angle as string | null) || '', emailStageAt(plan, i), { subject: tpl.subject || '', body: tpl.body });
          await supabase.from('follow_up_steps').update({ notes }).eq('id', st.id);
          stepIds.push(st.id);
        }
        if (stepIds.length) targets.push({ sequenceId: id, stepIds });
      }
      return json({ ok: true, targets, message: targets.length ? `Writing ${targets.length} contact${targets.length === 1 ? '' : 's'}' emails to match.` : 'Nothing to change: the others are sent, approved or edited by hand.' });
    }

    // Read and approve (or take the approval back from) one email: it then goes out by itself on its day.
    if (action === 'approve_step' || action === 'unapprove_step') {
      const stepId = typeof b.stepId === 'string' && UUID.test(b.stepId) ? b.stepId : null;
      if (!stepId) return json({ error: 'stepId (uuid) is required' }, 400);
      const { data: step } = await supabase.from('follow_up_steps').select('id, sequence_id, step_no, kind, status, subject, body, edited_at').eq('id', stepId).maybeSingle();
      if (!step) return json({ error: 'Step not found' }, 404);
      const { data: seq } = await supabase.from('follow_up_sequences').select('id, campaign_id, status').eq('id', step.sequence_id).maybeSingle();
      if (!seq || seq.campaign_id !== camp.id) return json({ error: 'That email is not in this campaign.' }, 400);
      if (step.kind !== 'email' || !['scheduled', 'due'].includes(step.status)) return json({ error: 'Only an email that has not gone yet can be approved.' }, 409);
      if (action === 'unapprove_step') {
        await supabase.from('follow_up_steps').update({ campaign_approved_at: null }).eq('id', step.id);
        return json({ ok: true, message: 'Approval taken back: it will not go until you approve it again.' });
      }
      if (!step.subject || !step.body) return json({ error: 'That email has not been written yet.' }, 409);
      // Approval also marks the text as yours, so a later refresh of the company never rewrites what you approved.
      const editor = (caller.profile.display_name || caller.email || 'a consultant').trim();
      const { error } = await supabase.from('follow_up_steps').update({ campaign_approved_at: now.toISOString(), ...(step.edited_at ? {} : { edited_at: now.toISOString(), edited_by_name: editor }) }).eq('id', step.id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, message: 'Approved. It goes out by itself on its day.' });
    }

    if (action === 'set_auto') {
      const enabled = b.enabled === true;
      await supabase.from('follow_up_campaigns').update({ auto_after_first: enabled }).eq('id', camp.id);
      if (camp.status === 'active') await syncAuto(enabled);
      return json({ ok: true, message: enabled ? 'After each first email goes, the later emails go by themselves.' : 'Every email will wait for your approval.' });
    }
    if (action === 'pause') {
      await supabase.from('follow_up_campaigns').update({ status: 'paused' }).eq('id', camp.id);
      await syncAuto(false);
      return json({ ok: true, message: 'Paused: nothing goes by itself until you resume.' });
    }
    if (action === 'resume') {
      if (camp.status === 'stopped') return json({ error: 'A stopped campaign cannot be resumed.' }, 409);
      await supabase.from('follow_up_campaigns').update({ status: 'active' }).eq('id', camp.id);
      await syncAuto(camp.auto_after_first);
      return json({ ok: true, message: 'Resumed.' });
    }
    if (action === 'stop') {
      const { data: seqs } = await supabase.from('follow_up_sequences').select('id').eq('campaign_id', camp.id).eq('status', 'active');
      for (const s of (seqs || []) as Array<{ id: string }>) await stopSequence(supabase, s.id, 'campaign stopped', now);
      await supabase.from('follow_up_campaigns').update({ status: 'stopped' }).eq('id', camp.id);
      return json({ ok: true, message: `Campaign stopped: ${(seqs || []).length} run${(seqs || []).length === 1 ? '' : 's'} ended.` });
    }
    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (e) {
    console.error('campaigns failed', e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
