// "Wrong company" / "Closed" links in alert emails.
//
// GET  ?token=...  verifies the token and describes the vacancy. It never
//                  writes: mail security scanners (Safe Links, Mimecast,
//                  Proofpoint) pre-fetch every link in an email at delivery.
// POST             verifies the token again, records vacancy_feedback and marks
//                  the vacancy closed ("Closed") or rejected ("Wrong company",
//                  "Not a vacancy"). Only a person pressing the button reaches
//                  this path. POST with undo=1 puts the vacancy back.
//
// Tokens expire after 30 days. A consultant-closed vacancy stays closed for
// 30 days; if it is still advertised after that, the refresh reopens it as
// new (see persistVacancies).
//
// The email links point at the app's /feedback page, which calls this
// function with `Accept: application/json` and gets JSON back. A request
// without that header gets a plain HTML page (the gateway serves it as text
// on GET, so the page is the real front door).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { feedbackSecret, verifyFeedbackToken, type FeedbackKind, type FeedbackPayload } from '../_shared/feedback-token.ts';

const REASONS: Record<FeedbackKind, string> = {
  wrong_company: 'Consultant reported: wrong company',
  closed: 'Consultant reported: closed',
  not_a_vacancy: 'Consultant reported: not a vacancy',
};

/** "Closed" is a closed vacancy (it can come back after 30 days); the rest are rejected for good. */
const STATUS_FOR: Record<FeedbackKind, 'closed' | 'rejected'> = {
  wrong_company: 'rejected',
  closed: 'closed',
  not_a_vacancy: 'rejected',
};

/** Has a consultant already acted on this row? */
function recordedByConsultant(v: { status: string; rejected_reason: string | null }): boolean {
  return v.status === 'rejected' || (v.status === 'closed' && !!v.rejected_reason && v.rejected_reason.startsWith('Consultant reported'));
}

const ACTION_LABEL: Record<FeedbackKind, string> = {
  wrong_company: 'Wrong company',
  closed: 'Closed',
  not_a_vacancy: 'Not a vacancy',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>body{font-family:Arial,sans-serif;max-width:560px;margin:60px auto;padding:0 20px;color:#122027}h1{font-size:22px}p{font-size:15px;line-height:1.5;color:#444}button{font:inherit;font-size:15px;padding:10px 18px;border:0;border-radius:6px;background:#122027;color:#fff;cursor:pointer}dl{font-size:15px;line-height:1.5;color:#444}dt{font-weight:bold;color:#122027;margin-top:8px}dd{margin:0}</style></head>
<body><h1>${escapeHtml(title)}</h1>${body}<p style="color:#999;font-size:12px">Big Fish Recruitment TA Searcher</p></body></html>`;
  return new Response(html, { status, headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function describe(kind: FeedbackKind): string {
  return kind === 'wrong_company' ? 'as belonging to a different company' : kind === 'closed' ? 'as closed' : 'as not a vacancy';
}

interface Incoming {
  token: string;
  /** Put the vacancy back as it was (a second press on the confirmation page). */
  undo: boolean;
}

async function readIncoming(req: Request, url: URL): Promise<Incoming> {
  let token = url.searchParams.get('token') || '';
  let undo = url.searchParams.get('undo') === '1';
  if (req.method === 'POST') {
    const ct = req.headers.get('content-type') || '';
    try {
      if (ct.includes('application/json')) {
        const body = await req.json();
        if (typeof body?.token === 'string') token = token || body.token;
        undo = undo || body?.undo === true;
      } else if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
        const form = await req.formData();
        const t = form.get('token');
        if (typeof t === 'string') token = token || t;
        undo = undo || form.get('undo') === '1';
      }
    } catch {
      // fall through with what the query string gave us
    }
  }
  return { token, undo };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const wantsJson = (req.headers.get('accept') || '').includes('application/json');
  if (req.method !== 'GET' && req.method !== 'POST') {
    return wantsJson ? json({ ok: false, reason: 'method_not_allowed' }, 405) : page('Method not allowed', '<p>Use the link from your alert email.</p>', 405);
  }
  const url = new URL(req.url);
  const { token, undo } = await readIncoming(req, url);
  let payload: FeedbackPayload | null;
  try {
    payload = await verifyFeedbackToken(token, feedbackSecret());
  } catch (e) {
    console.error('feedback secret missing', e);
    return wantsJson ? json({ ok: false, reason: 'not_configured' }, 500) : page('Something went wrong', '<p>The feedback service is not configured. Please tell Craig.</p>', 500);
  }
  if (!payload || !Object.hasOwn(REASONS, payload.k)) {
    return wantsJson ? json({ ok: false, reason: 'invalid_token' }, 400) : page('Link not recognised', '<p>This feedback link is invalid or has been altered. Please use the link from your alert email.</p>', 400);
  }
  const kind = payload.k as FeedbackKind;

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: vacancy, error } = await supabase.from('vacancies').select('id, title, status, rejected_reason, company_search_id').eq('id', payload.v).maybeSingle();
  if (error || !vacancy) {
    return wantsJson ? json({ ok: false, reason: 'not_found' }, 404) : page('Vacancy not found', '<p>This vacancy is no longer in the system, so there is nothing to change.</p>', 404);
  }

  const { data: company } = await supabase.from('company_searches').select('company_name').eq('id', vacancy.company_search_id).maybeSingle();
  const titleHtml = `"${escapeHtml(vacancy.title)}"${company?.company_name ? ` at ${escapeHtml(company.company_name)}` : ''}`;
  const summary = { vacancy: vacancy.title, company: company?.company_name || null, action: kind, actionLabel: ACTION_LABEL[kind], describe: describe(kind) };

  const action = `${url.pathname}?token=${encodeURIComponent(token)}`;
  const undoForm = `<form method="post" action="${escapeHtml(action)}"><input type="hidden" name="token" value="${escapeHtml(token)}"><input type="hidden" name="undo" value="1"><button type="submit">Undo: put it back</button></form>`;

  if (req.method === 'GET') {
    // Read-only: confirm before changing anything.
    if (recordedByConsultant(vacancy)) {
      if (wantsJson) return json({ ok: true, state: 'already', ...summary });
      return page('Already recorded', `<p>${titleHtml} has already been marked ${describe(kind)}. It will not appear in your alerts again.</p>${undoForm}`);
    }
    if (wantsJson) return json({ ok: true, state: 'confirm', ...summary });
    return page(
      `Confirm: ${ACTION_LABEL[kind]}`,
      `<dl><dt>Vacancy</dt><dd>${escapeHtml(vacancy.title)}</dd><dt>Company</dt><dd>${escapeHtml(company?.company_name || 'Unknown company')}</dd><dt>Action</dt><dd>Mark ${describe(kind)}</dd></dl>
<p>This will remove the vacancy from your alerts. Press the button to confirm.</p>
<form method="post" action="${escapeHtml(action)}"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit">${escapeHtml(ACTION_LABEL[kind])}: confirm</button></form>
<p>If you opened this by mistake, just close the page. Nothing has been changed.</p>`,
    );
  }

  if (undo) {
    // Put the row back as an ordinary open vacancy and forget the feedback,
    // so a later "Closed" starts a fresh 30-day clock.
    if (recordedByConsultant(vacancy)) {
      const { error: undoErr } = await supabase.from('vacancies').update({ status: 'open', rejected_reason: null }).eq('id', vacancy.id);
      if (undoErr) {
        console.error('vacancy undo failed', undoErr.message);
        return wantsJson ? json({ ok: false, reason: 'update_failed' }, 500) : page('Something went wrong', `<p>We could not update ${titleHtml}. Please try again or tell Craig.</p>`, 500);
      }
      await supabase.from('vacancy_feedback').delete().eq('vacancy_id', vacancy.id).eq('reporter_email', payload.e);
      console.log('vacancy feedback undone', { vacancy: vacancy.id, by: payload.e });
    }
    if (wantsJson) return json({ ok: true, state: 'undone', ...summary });
    return page('Put back', `<p>${titleHtml} is open again and will appear in your alerts as before.</p><p>You can close this page.</p>`);
  }

  // POST: record feedback and close or reject the vacancy.
  // Idempotent: the same person confirming twice records one feedback row.
  const { data: existing } = await supabase.from('vacancy_feedback').select('id').eq('vacancy_id', vacancy.id).eq('kind', kind).eq('reporter_email', payload.e).maybeSingle();
  if (!existing) {
    const { error: fbErr } = await supabase.from('vacancy_feedback').insert({ vacancy_id: vacancy.id, kind, reporter_email: payload.e, token });
    if (fbErr) console.error('vacancy_feedback insert failed', fbErr.message);
  }
  if (vacancy.status !== 'rejected') {
    const { error: updErr } = await supabase.from('vacancies').update({ status: STATUS_FOR[kind], rejected_reason: REASONS[kind] }).eq('id', vacancy.id);
    if (updErr) {
      console.error('vacancy update failed', updErr.message);
      return wantsJson ? json({ ok: false, reason: 'update_failed' }, 500) : page('Something went wrong', `<p>We could not update ${titleHtml}. Please try again or tell Craig.</p>`, 500);
    }
  }
  console.log('vacancy feedback', { vacancy: vacancy.id, kind, by: payload.e });

  if (wantsJson) return json({ ok: true, state: 'done', ...summary });
  return page('Thank you', `<p>${titleHtml} has been marked ${describe(kind)}. It will not appear in your alerts again.</p>${undoForm}`);
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
