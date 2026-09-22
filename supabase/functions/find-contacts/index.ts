// find-contacts: addresses for the name-only people on a company (22
// September 2026; Craig: "it's really important I have the correct name
// and emails for these businesses"). The analysis does this on every run;
// this is the page's "Find addresses" button, and the backfill.
//
// POST { companySearchId, force?: boolean }
//   Runs the enrichment (_shared/contacts/enrich.ts: Hunter's Email
//   Finder for each name-only person with a ranked role, else a guess
//   verified by Hunter) over the stored decisionMakers, writes them back
//   with contactsRun.enrichment, and answers { ok, filled, summary,
//   contacts, account }. force ignores the thirty-day cache.
// POST { action: 'account' }
//   { ok, account, line }: the Hunter plan and what is left.
//
// The caller is a signed-in user (any, no flag) or the service role (the
// backfill script). Every call that reaches Hunter spends credits.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { identifyCaller } from '../_shared/auth.ts';
import { enrichContacts, enrichSummary, mailDomain, type EnrichmentEntry } from '../_shared/contacts/enrich.ts';
import { hunterAccount, hunterAccountLine, hunterConfigured } from '../_shared/contacts/hunter.ts';
import type { DecisionMaker } from '../_shared/contacts/review.ts';
import { cors, json } from '../_shared/outreach/caller.ts';

Deno.serve(async (req): Promise<Response> => {
  if (req.method === 'OPTIONS') return cors();
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const ident = await identifyCaller(req, supabase);
  if (ident.reject) return ident.reject;
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { b = {}; }
  if (!hunterConfigured()) return json({ error: 'HUNTER_API_KEY is not set on the project.' }, 400);

  try {
    if (b.action === 'account') {
      const account = await hunterAccount();
      return json({ ok: account.ok, account, line: hunterAccountLine(account) });
    }
    const companySearchId = typeof b.companySearchId === 'string' ? b.companySearchId : '';
    if (!/^[0-9a-f-]{36}$/i.test(companySearchId)) return json({ error: 'companySearchId is required' }, 400);
    const { data: row, error } = await supabase.from('company_searches').select('id, url, company_name, analysis_result').eq('id', companySearchId).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!row) return json({ error: 'No such company' }, 404);
    const analysis = (row.analysis_result && typeof row.analysis_result === 'object' ? row.analysis_result : {}) as Record<string, any>;
    const contacts: DecisionMaker[] = Array.isArray(analysis.decisionMakers) ? analysis.decisionMakers : [];
    const cache = (analysis.contactsRun?.enrichment ?? null) as Record<string, EnrichmentEntry> | null;
    const now = new Date();
    const en = await enrichContacts(contacts, { domain: mailDomain(row.url), now, cache, force: b.force === true });
    const summary = `${enrichSummary(en.entries)}${en.finderCalls + en.verifyCalls ? ` (${en.finderCalls} Finder and ${en.verifyCalls} Verifier calls)` : ' (from the last run)'}${en.notes.length ? `; ${en.notes.join('; ')}` : ''}`;
    const nextAnalysis = { ...analysis, decisionMakers: en.contacts, contactsRun: { ...(analysis.contactsRun || {}), enrichment: en.entries, enrichmentNote: summary, enrichedAt: now.toISOString() } };
    const { error: upErr } = await supabase.from('company_searches').update({ analysis_result: nextAnalysis }).eq('id', row.id);
    if (upErr) return json({ error: `Could not save: ${upErr.message}` }, 500);
    console.log(`[find-contacts] ${row.company_name}: ${summary}; ${en.filled} filled this pass`);
    const account = en.finderCalls + en.verifyCalls ? await hunterAccount() : null;
    return json({ ok: true, filled: en.filled, summary, contacts: en.contacts, account, line: account ? hunterAccountLine(account) : null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[find-contacts] failed:', msg);
    return json({ error: msg }, 500);
  }
});
