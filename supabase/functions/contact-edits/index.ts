// contact-edits: a consultant corrects, adds or removes a company contact
// (Contact edits, 18 September 2026; Craig: "if the guys manage to get a
// new email address for a contact, can there be a way for them to edit
// and add the new correct email address?").
//
// POST { action: 'edit' | 'add' | 'remove', companySearchId, contactKey?,
//        name, role?, email?, phone?, note? }
//   edit    contactKey is the key the app got from the merged list (the
//           person as first read); name, role, email and phone replace
//           what the site said (an empty field keeps the site's value);
//   add     a person the site did not name; keyed by the name;
//   remove  note is the reason, required.
// POST { action: 'check', email }
//   says whether the address is on the do-not-email list, so the dialog
//   can warn before saving (the send path refuses such an address anyway).
//
// The caller is any signed-in user (no feature flag): a manager for any
// company, a consultant for a company on their list. Every save is one new
// row in company_contact_edits (history is never deleted; the newest row
// per person wins, _shared/contacts.ts). The rules are in
// _shared/contacts/edit-rules.ts. When an edit gives the person an
// active follow-up run is with a new address, the run's contact_email
// moves too and a note is written to the Calls history.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { identifyCaller } from '../_shared/auth.ts';
import { mergeContacts, removedContacts } from '../_shared/contacts.ts';
import { activeRunWarning, checkContactEdit, editorName, parseContactEditRequest, savedMessage, type ActiveSequence } from '../_shared/contacts/edit-rules.ts';
import { CONTACT_EDIT_COLUMNS, loadContactEdits } from '../_shared/contacts/edits.ts';
import { cors, json, myConsultantIds } from '../_shared/outreach/caller.ts';

const suppressedWords = (reason: string) => (reason === 'complaint' ? 'marked an earlier email as spam' : reason === 'bounce' ? 'bounced before' : 'asked not to be emailed');

Deno.serve(async (req): Promise<Response> => {
  if (req.method === 'OPTIONS') return cors();
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const ident = await identifyCaller(req, supabase);
  if (ident.reject) return ident.reject;
  const caller = ident.caller;
  if (caller.kind !== 'user') return json({ error: 'A signed-in consultant must do this.' }, 403);
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: 'Invalid JSON request body' }, 400); }

  /** Is the address on the do-not-email list? null when not, else the reason in plain words. */
  const suppression = async (email: string | null): Promise<string | null> => {
    if (!email) return null;
    const { data } = await supabase.from('suppressed_emails').select('reason').eq('email', email).maybeSingle();
    return data ? `This address ${suppressedWords(String(data.reason))}, so TA Searcher will not email it. Phone instead. You can still save it.` : null;
  };

  try {
    if (b.action === 'check') {
      const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
      if (!email) return json({ ok: true, suppressed: null });
      return json({ ok: true, suppressed: await suppression(email) });
    }

    const parsed = parseContactEditRequest(b);
    if (parsed.ok === null) return json({ error: parsed.error }, 400);
    const r = parsed.ok;

    // The company, and whether the caller may act on it (the follow-ups rule).
    const { data: company, error: companyErr } = await supabase.from('company_searches').select('id, company_name, analysis_result').eq('id', r.companySearchId).maybeSingle();
    if (companyErr) return json({ error: companyErr.message }, 500);
    if (!company) return json({ error: 'Company not found' }, 404);
    const companyName = ((company.analysis_result as { companyRecord?: { name?: string } } | null)?.companyRecord?.name) || company.company_name || 'the company';
    const isManager = caller.profile.role === 'manager' || caller.profile.role === 'admin';
    const mine = await myConsultantIds(supabase, caller);
    const { data: assigned } = await supabase.from('company_consultants').select('consultant_id').eq('company_search_id', company.id);
    const assignedIds = ((assigned || []) as Array<{ consultant_id: string }>).map((a) => a.consultant_id);
    if (!assignedIds.some((id) => mine.includes(id)) && !isManager) return json({ error: `${companyName} is not on your list. Ask a manager to assign it to you first.` }, 403);

    // The contacts as they stand, and the rules.
    const stored = Array.isArray(company.analysis_result?.decisionMakers) ? company.analysis_result.decisionMakers : [];
    const edits = (await loadContactEdits(supabase, [company.id])).get(company.id) || [];
    const contacts = mergeContacts(stored, edits);
    const removed = removedContacts(stored, edits);
    const problem = checkContactEdit(r, contacts, removed);
    if (problem) return json({ error: problem, code: 'rule' }, 409);
    const current = contacts.find((c) => c.contactKey === r.contactKey) || null;

    // Who is doing it, by name.
    const consultantId = assignedIds.find((id) => mine.includes(id)) || caller.profile.consultant_id || mine[0] || null;
    const { data: consultantRow } = consultantId ? await supabase.from('consultants').select('name').eq('id', consultantId).maybeSingle() : { data: null };
    const byName = editorName({ display_name: caller.profile.display_name, email: caller.email }, consultantRow?.name ?? null);

    // The row. For a remove the name is kept for the removed list.
    const { data: row, error: insErr } = await supabase.from('company_contact_edits').insert({
      company_search_id: company.id,
      contact_key: r.contactKey,
      name: r.name || current?.name || null,
      role: r.role,
      email: r.email,
      phone: r.phone,
      note: r.note,
      action: r.action,
      edited_by: caller.userId,
      edited_by_name: byName,
    }).select(CONTACT_EDIT_COLUMNS).single();
    if (insErr) return json({ error: `Could not save: ${insErr.message}` }, 500);

    // Follow-ups are not ported to TA Searcher yet: no sequence to move.
    const sequences: Array<ActiveSequence & { company_search_id: string; consultant_id: string | null }> = [];
    // deno-lint-ignore prefer-const
    let sequenceUpdated = null as { sequenceId: string; note: string } | null;
    const warning = activeRunWarning(r, current, sequences);
    const suppressed = await suppression(r.email);

    console.log('contact-edits saved', { company: company.id, action: r.action, key: r.contactKey, by: caller.userId, sequenceUpdated: sequenceUpdated?.sequenceId ?? null });
    return json({
      ok: true,
      edit: row,
      contact: mergeContacts(stored, [...edits, row]).find((c) => c.contactKey === r.contactKey) ?? null,
      suppressed,
      sequenceUpdated,
      warning,
      message: savedMessage(r, null),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('contact-edits failed:', { message: msg });
    return json({ error: msg }, 500);
  }
});
