// send-outreach-email: one email from a consultant to one company contact
// (Follow-ups slice 1, docs/FOLLOW-UPS-BRIEF.md). No drafting here: the
// consultant writes or pastes the email in the app.
//
// POST {
//   companySearchId, contactName, contactRole?, contactEmail,
//   subject, body,             the consultant's words, plain text
//   sendAnyway?: boolean,      send despite warnings (never despite a block)
//   dryRun?: boolean,          render only: the HTML comes back, nothing is queued or logged
//   sequenceStepId?: string    Follow-ups slice 2: the step of a follow-up sequence
//                              this send approves; the step moves to sent and the
//                              outcome is tied to it. Refused when the sequence has
//                              stopped or the step is not an email still to go.
// }
//
// The caller must be a signed-in user whose profile carries the follow_ups
// flag (the service role is refused: an email in a person's name is sent
// by that person). The checks, in order:
//   1. the request is well formed (parseOutreachRequest);
//   2. the company exists and the consultant is on its list (a manager may
//      email for any company), and the address is one of the company's
//      contacts as the Contacts tab shows them (the stored list with the
//      consultants' edits laid over it, _shared/contacts.ts), so a
//      corrected address is what gets emailed and a removed person is not;
//   3. the address is not suppressed (bounced, complained, unsubscribed);
//   4. the text keeps the rules (checkOutreachText): daily supply and a
//      margin or fee figure are refused; style phrases are warnings the
//      consultant may send through with sendAnyway;
//   5. one send per contact per day (alreadyEmailedToday).
// Then it goes through send-transactional-email with the outreach-email
// template, from the consultant's own name and address (used as given only
// when the domain is in app_settings.sending_domains, otherwise the name
// with noreply@ on the notify sub-domain), reply_to the consultant, no
// unsubscribe link, and metadata (company, consultant, contact) on the send
// log so Resend's events can be tied back. An outcome of kind 'emailed' is
// logged on the company, which My patch and the Calls tab show.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { mergedContactsFor } from '../_shared/contacts/edits.ts';
import { cors, json, myConsultantIds, requireFollowUpsCaller } from '../_shared/outreach/caller.ts';
import { alreadyEmailedToday, checkOutreachText, parseOutreachRequest } from '../_shared/outreach/rules.ts';
import { cleanDisplayName } from '../_shared/sending-domains.ts';
import { signatureFor } from '../_shared/signature.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return cors();
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(supabaseUrl, serviceKey);
  const who = await requireFollowUpsCaller(req, supabase, { usersOnly: true });
  if (who.reject) return who.reject;
  const caller = who.ok.caller;
  if (caller.kind !== 'user') return json({ error: 'A signed-in consultant must send this.' }, 403);
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: 'Invalid JSON request body' }, 400); }
  const parsed = parseOutreachRequest(raw);
  if (parsed.ok === null) return json({ error: parsed.error }, 400);
  const r = parsed.ok;

  // 2. The company, and whether it is on the caller's list.
  const { data: company, error: companyErr } = await supabase.from('company_searches').select('id, company_name, analysis_result').eq('id', r.companySearchId).maybeSingle();
  if (companyErr) return json({ error: companyErr.message }, 500);
  if (!company) return json({ error: 'Company not found' }, 404);
  const companyName = ((company.analysis_result as { companyRecord?: { name?: string } } | null)?.companyRecord?.name) || company.company_name || 'the company';
  const mine = await myConsultantIds(supabase, caller);
  const { data: assigned } = await supabase.from('company_consultants').select('consultant_id').eq('company_search_id', company.id);
  const assignedIds = ((assigned || []) as Array<{ consultant_id: string }>).map((a) => a.consultant_id);
  const onMyList = assignedIds.some((id) => mine.includes(id));
  if (!onMyList && !who.ok.isManager) return json({ error: `${companyName} is not on your list. Ask a manager to assign it to you first.` }, 403);
  const consultantId = assignedIds.find((id) => mine.includes(id)) || caller.profile.consultant_id || mine[0] || null;

  // 2a. The address must belong to one of the company's contacts as edited (Contact edits, 18 September 2026).
  const contacts = await mergedContactsFor(supabase, company.id, (company.analysis_result as { decisionMakers?: unknown[] } | null)?.decisionMakers as Array<{ name?: string; email?: string }> | undefined);
  if (!contacts.some((c) => (c.email || '').toLowerCase() === r.contactEmail)) {
    return json({ error: `${r.contactEmail} is not one of ${companyName}'s contacts. On the Contacts tab, edit the person's address or add them, then send.`, code: 'not_a_contact' }, 400);
  }

  // 2b. Follow-up sequences are not ported to TA Searcher yet: a step id is refused.
  const sequenceStepId = typeof (raw as { sequenceStepId?: unknown })?.sequenceStepId === 'string' ? (raw as { sequenceStepId: string }).sequenceStepId : null;
  if (sequenceStepId) return json({ error: 'Follow-up sequences are not switched on in TA Searcher yet.' }, 400);
  // deno-lint-ignore prefer-const
  let stepInfo = null as { step: { id: string; step_no: number }; sequence: { id: string } } | null;

  // 3. Never to a suppressed address.
  const { data: suppressed, error: supErr } = await supabase.from('suppressed_emails').select('reason').eq('email', r.contactEmail).maybeSingle();
  if (supErr) return json({ error: 'Could not check the address; nothing sent.' }, 500);
  if (suppressed) {
    const why = suppressed.reason === 'complaint' ? 'marked an earlier email as spam' : suppressed.reason === 'bounce' ? 'bounced before' : 'asked not to be emailed';
    return json({ error: `This address ${why}, so TA Searcher will not email it. Phone instead.`, code: 'suppressed' }, 409);
  }

  // 4. The rules on the text.
  const check = checkOutreachText(r.subject, r.body);
  if (check.blocked.length) return json({ error: check.blocked.join(' '), code: 'blocked', blocked: check.blocked, warnings: check.warnings }, 422);
  if (check.warnings.length && !r.sendAnyway && !r.dryRun) return json({ error: 'Worth a second look before it goes.', code: 'warnings', warnings: check.warnings }, 422);

  // 5. One a day per contact.
  if (!r.dryRun) {
    const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    const { data: earlier, error: earlierErr } = await supabase.from('email_send_log').select('created_at, status, metadata').eq('recipient_email', r.contactEmail).gte('created_at', since).in('status', ['pending', 'sent']);
    if (earlierErr) return json({ error: 'Could not check today\'s sends; nothing sent.' }, 500);
    const outreach = ((earlier || []) as Array<{ created_at: string; status: string; metadata: { kind?: string } | null }>).filter((e) => e.metadata?.kind === 'outreach');
    if (alreadyEmailedToday(outreach)) return json({ error: `${r.contactName} has already had an email from the team today. One a day is the rule; try again tomorrow, or phone.`, code: 'one_a_day' }, 429);
  }

  // Who it is from: the signed-in person, in their own name.
  const { data: consultantRow } = consultantId ? await supabase.from('consultants').select('name, email').eq('id', consultantId).maybeSingle() : { data: null };
  const fromName = cleanDisplayName(caller.profile.display_name || consultantRow?.name || caller.email.split('@')[0]);
  const fromEmail = caller.email.toLowerCase();
  const phone = typeof (raw as { phone?: unknown })?.phone === 'string' ? String((raw as { phone?: string }).phone).trim().slice(0, 40) : '';
  // The house signature block with this consultant's details (email_signatures); the page's phone is the fallback mobile.
  const signature = await signatureFor(supabase, fromEmail, { name: fromName, phone });

  // The step is approved from here until the send is confirmed.
  if (stepInfo && !r.dryRun) {
    const { error: apprErr } = await supabase.from('follow_up_steps').update({ status: 'approved', subject: r.subject, body: r.body }).eq('id', stepInfo.step.id).in('status', ['scheduled', 'due', 'approved']);
    if (apprErr) return json({ error: `Could not mark the step approved: ${apprErr.message}` }, 500);
  }
  const revertStep = async () => {
    if (!stepInfo || r.dryRun) return;
    await supabase.from('follow_up_steps').update({ status: 'due' }).eq('id', stepInfo.step.id).eq('status', 'approved');
  };

  const messageIdempotency = `outreach:${crypto.randomUUID()}`;
  const { data: sent, error: sendErr } = await supabase.functions.invoke('send-transactional-email', {
    headers: { Authorization: `Bearer ${serviceKey}` },
    body: {
      templateName: 'outreach-email',
      recipientEmail: r.contactEmail,
      replyTo: fromEmail,
      from: { name: fromName, email: fromEmail },
      noUnsubscribe: true,
      dryRun: r.dryRun,
      idempotencyKey: messageIdempotency,
      metadata: {
        kind: 'outreach',
        purpose: 'outreach',
        company_search_id: company.id,
        company_name: companyName,
        consultant_id: consultantId,
        sent_by: caller.userId,
        contact_name: r.contactName,
        contact_role: r.contactRole,
        contact_email: r.contactEmail,
        subject: r.subject,
        ...(stepInfo ? { sequence_id: stepInfo.sequence.id, sequence_step_id: stepInfo.step.id, step_no: stepInfo.step.step_no } : {}),
      },
      templateData: { subject: r.subject, body: r.body, signature },
    },
  });
  if (sendErr || !sent?.success) {
    await revertStep();
    const reason = sendErr?.message || sent?.reason || sent?.error || 'send failed';
    if (sent?.reason === 'email_suppressed') return json({ error: 'This address is on the do-not-email list, so nothing was sent.', code: 'suppressed' }, 409);
    console.error('send-outreach-email: send failed', { reason: String(reason).slice(0, 300) });
    return json({ error: `Could not send: ${String(reason).slice(0, 300)}` }, 502);
  }

  if (r.dryRun) {
    return json({ ok: true, dryRun: true, html: sent.html, subject: sent.subject, from: sent.from, fromApplied: sent.fromApplied, fromReason: sent.fromReason, replyTo: sent.replyTo, warnings: check.warnings });
  }

  // 6. The outcome: "Emailed", on the company's Calls tab and My patch.
  const { data: outcome, error: outcomeErr } = await supabase.from('outcomes').insert({
    company_search_id: company.id,
    consultant_id: consultantId,
    created_by: caller.userId,
    contact_name: r.contactName,
    contact_role: r.contactRole,
    kind: 'emailed',
    note: r.subject,
    external_refs: { message_id: sent.messageId, contact_email: r.contactEmail, from: sent.from, ...(stepInfo ? { sequence_id: stepInfo.sequence.id, step_no: stepInfo.step.step_no } : {}) },
  }).select('id').maybeSingle();
  if (outcomeErr) console.warn('send-outreach-email: outcome not logged', { message: outcomeErr.message });

  // 7. No follow-up step to mark: sequences are not ported yet.
  const sequenceDone = false;

  console.log('send-outreach-email queued', { company: company.id, messageId: sent.messageId, fromApplied: sent.fromApplied, step: stepInfo?.step.id ?? null });
  return json({
    ok: true,
    messageId: sent.messageId,
    from: sent.from,
    fromApplied: sent.fromApplied,
    fromReason: sent.fromReason,
    replyTo: sent.replyTo,
    warnings: check.warnings,
    sequenceStepId: stepInfo?.step.id ?? null,
    sequenceDone,
    message: `${sent.fromApplied ? `Sent to ${r.contactName} from ${sent.from}; replies come to you.` : `Sent to ${r.contactName} as ${sent.from}; replies come to you. (Your own address is not a verified sending domain yet.)`}${sequenceDone ? ' That was the last step, so the follow-ups are finished.' : ''}`,
  });
});
