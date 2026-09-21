// "Wrong / bounced / left" for a decision-maker contact.
//
// POST { companySearchId, email?, name?, role?, kind, reporterEmail?, undo? }
//   kind: 'bounced' | 'wrong_person' | 'left'
// Records contact_feedback and marks the contact in the stored analysis so
// the app shows it at once. On the next refresh a reported contact is
// suppressed and its address is never pattern-guessed again (see
// _shared/contacts/resolve.ts). undo=true removes the report.
//
// Also accepts POST { token } signed like the vacancy feedback links
// (payload { s: companySearchId, c: email, k: kind, e: reporter }) so a future
// email can carry a one-click report. The gateway requires a JWT
// (verify_jwt = true in config.toml); the app sends the anon key as the
// bearer until Phase 4 brings user sessions, and calls are rate limited per
// address. Without this anyone holding a company id could suppress contacts.
import { identifyCaller } from '../_shared/auth.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { feedbackSecret, signPayload, verifyPayload } from '../_shared/feedback-token.ts';

type Kind = 'bounced' | 'wrong_person' | 'left';
const KINDS: Kind[] = ['bounced', 'wrong_person', 'left'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const RATE: Map<string, { n: number; t: number }> = new Map();
function allowed(ip: string): boolean {
  const now = Date.now();
  const r = RATE.get(ip);
  if (!r || now - r.t > 3600000) { RATE.set(ip, { n: 1, t: now }); return true; }
  r.n++;
  return r.n <= 60;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const callerClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const ident = await identifyCaller(req, callerClient);
  if (ident.reject) return ident.reject;
  if (req.method !== 'POST') return json({ ok: false, reason: 'method' }, 405);
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('cf-connecting-ip') || 'unknown';
  if (!allowed(ip)) return json({ ok: false, reason: 'rate_limited' }, 429);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: 'bad_json' }, 400);
  }

  let companySearchId = '';
  let email = '';
  let name = '';
  let role = '';
  let kind: Kind | null = null;
  let reporter: string | null = null;
  const undo = body.undo === true;

  if (typeof body.token === 'string' && body.token) {
    const payload = await verifyPayload<{ s: string; c?: string; n?: string; k: string; e?: string }>(body.token, feedbackSecret());
    if (!payload?.s || !payload?.k) return json({ ok: false, reason: 'invalid_token' }, 400);
    companySearchId = payload.s;
    email = (payload.c || '').toLowerCase();
    name = payload.n || '';
    kind = KINDS.includes(payload.k as Kind) ? (payload.k as Kind) : null;
    reporter = payload.e || null;
  } else {
    companySearchId = String(body.companySearchId || '');
    email = String(body.email || '').trim().toLowerCase();
    name = String(body.name || '').trim();
    role = String(body.role || '').trim();
    kind = KINDS.includes(body.kind) ? body.kind : null;
    reporter = typeof body.reporterEmail === 'string' && body.reporterEmail.includes('@') ? body.reporterEmail.trim().toLowerCase() : null;
  }
  if (!/^[0-9a-f-]{36}$/i.test(companySearchId)) return json({ ok: false, reason: 'bad_company' }, 400);
  if (!kind) return json({ ok: false, reason: 'bad_kind' }, 400);
  if (!email && !name) return json({ ok: false, reason: 'no_contact' }, 400);
  if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return json({ ok: false, reason: 'bad_email' }, 400);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: company, error: companyErr } = await supabase.from('company_searches').select('id, company_name, analysis_result').eq('id', companySearchId).maybeSingle();
  if (companyErr) return json({ ok: false, reason: 'db', detail: companyErr.message }, 500);
  if (!company) return json({ ok: false, reason: 'not_found' }, 404);

  const byEmail = (dm: any) => !!email && String(dm?.email || '').toLowerCase() === email;
  const byName = (dm: any) => !!name && String(dm?.name || '').trim().toLowerCase() === name.toLowerCase() && (!role || String(dm?.role || '').trim().toLowerCase() === role.toLowerCase());
  const dms: any[] = Array.isArray(company.analysis_result?.decisionMakers) ? company.analysis_result.decisionMakers : [];
  // By address first; by name when the address is not the stored one (a
  // consultant may have corrected it in company_contact_edits, 18 September 2026).
  const target = dms.find(byEmail) || dms.find(byName);
  if (!target && !email) return json({ ok: false, reason: 'not_found' }, 404);

  if (undo) {
    let q = supabase.from('contact_feedback').delete().eq('company_search_id', companySearchId);
    q = email ? q.eq('email', email) : q.eq('contact_name', name);
    const { error } = await q;
    if (error) return json({ ok: false, reason: 'db', detail: error.message }, 500);
    if (target) {
      delete target.feedback;
      await supabase.from('company_searches').update({ analysis_result: { ...company.analysis_result, decisionMakers: dms } }).eq('id', companySearchId);
    }
    return json({ ok: true, state: 'undone', company: company.company_name });
  }

  const { error } = await supabase.from('contact_feedback').insert({
    company_search_id: companySearchId,
    email: email || null,
    contact_name: name || target?.name || null,
    contact_role: role || target?.role || null,
    kind,
    reporter_email: reporter,
  });
  if (error) return json({ ok: false, reason: 'db', detail: error.message }, 500);
  if (target) {
    target.feedback = kind;
    await supabase.from('company_searches').update({ analysis_result: { ...company.analysis_result, decisionMakers: dms } }).eq('id', companySearchId);
  }
  return json({ ok: true, state: 'recorded', kind, company: company.company_name });
});

// Exported for a future email link builder.
export async function contactFeedbackToken(companySearchId: string, email: string, kind: Kind, reporter: string): Promise<string> {
  return await signPayload({ s: companySearchId, c: email, k: kind, e: reporter }, feedbackSecret());
}
