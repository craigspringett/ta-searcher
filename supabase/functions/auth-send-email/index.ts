// Supabase Auth "send email" hook. Auth POSTs every email it wants to send
// (magic link / sign-in code, and the rarer confirmation, invite, recovery
// and email-change messages) here, signed with the Standard Webhooks
// scheme; we render a Big Fish Recruitment email and send it through Resend from
// notify.bigfishrecruitment.co.uk, so sign-in codes do not depend on Supabase's
// shared mailer (two an hour) and arrive from a domain consultants know.
//
// Secrets: SEND_EMAIL_HOOK_SECRET (the "v1,whsec_..." value registered as
// hook_send_email_secrets on the Auth config) and RESEND_API_KEY.
import { Webhook } from 'npm:standardwebhooks@1.0.0';
import { sendEmail } from '../_shared/email.ts';

const FROM = 'TA Searcher <noreply@notify.bigfishrecruitment.co.uk>';
const APP_URL = Deno.env.get('APP_URL') || 'https://ta-searcher.netlify.app';

interface HookPayload {
  user: { id: string; email: string };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string; // signup | magiclink | recovery | invite | email_change | email_change_new
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function verifyLink(tokenHash: string, type: string, redirectTo: string): string {
  const base = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
  const params = new URLSearchParams({ token: tokenHash, type, redirect_to: redirectTo || APP_URL });
  return `${base}/auth/v1/verify?${params.toString()}`;
}

function render(p: HookPayload): { subject: string; html: string; text: string } {
  const { token, token_hash, redirect_to, email_action_type } = p.email_data;
  const code = escapeHtml(token);
  const to = redirect_to || APP_URL;
  const kind = email_action_type;
  const isSignIn = kind === 'magiclink' || kind === 'signup' || kind === 'invite';
  const link = verifyLink(token_hash, kind === 'signup' ? 'signup' : kind === 'invite' ? 'invite' : kind === 'recovery' ? 'recovery' : kind.startsWith('email_change') ? 'email_change' : 'magiclink', to);
  const subject = isSignIn ? `${token} is your TA Searcher sign-in code` : kind === 'recovery' ? 'TA Searcher: reset your sign-in' : 'TA Searcher: confirm your new email address';
  const lead = isSignIn
    ? 'Enter this code on the TA Searcher sign-in page, or use the button below. It expires in an hour and works once.'
    : kind === 'recovery'
      ? 'Use the code or the button below to sign in.'
      : 'Use the code or the button below to confirm the change of email address.';
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#F5F9FA;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#122027">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F5F9FA"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#ffffff;border-radius:12px;border:1px solid #dbe6e8">
<tr><td style="padding:28px 32px 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#59C0C4;font-weight:600">TA Searcher · Big Fish Recruitment</td></tr>
<tr><td style="padding:0 32px;font-size:22px;font-weight:700">Your sign-in code</td></tr>
<tr><td style="padding:12px 32px 0;font-size:15px;line-height:1.5">${lead}</td></tr>
<tr><td style="padding:20px 32px 0"><div style="font-size:32px;letter-spacing:.35em;font-weight:700;padding:16px 20px;background:#F5F9FA;border-radius:8px;text-align:center;color:#122027">${code}</div></td></tr>
<tr><td style="padding:20px 32px 0" align="left"><a href="${link}" style="display:inline-block;background:#59C0C4;color:#122027;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">Sign in to TA Searcher</a></td></tr>
<tr><td style="padding:24px 32px 28px;font-size:12px;line-height:1.5;color:#5b6b71">If you did not ask for this, ignore it; nobody can sign in without the code. TA Searcher is Big Fish Recruitment's internal company-intelligence tool.</td></tr>
</table></td></tr></table></body></html>`;
  const text = `Your TA Searcher sign-in code is ${token}\n\n${lead}\n\nOr open: ${link}\n\nIf you did not ask for this, ignore it.`;
  return { subject, html, text };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const secret = Deno.env.get('SEND_EMAIL_HOOK_SECRET') || '';
  if (!secret) return Response.json({ error: { http_code: 500, message: 'hook secret not configured' } }, { status: 500 });
  const raw = await req.text();
  const headers = Object.fromEntries(req.headers);
  let payload: HookPayload;
  try {
    const wh = new Webhook(secret.replace(/^v1,whsec_/, ''));
    payload = wh.verify(raw, headers) as HookPayload;
  } catch (e) {
    console.warn('auth-send-email: signature rejected:', (e as Error).message);
    return Response.json({ error: { http_code: 401, message: 'invalid signature' } }, { status: 401 });
  }
  const email = payload?.user?.email;
  if (!email || !payload.email_data?.token) return Response.json({ error: { http_code: 400, message: 'no recipient' } }, { status: 400 });
  try {
    const { subject, html, text } = render(payload);
    const res = await sendEmail({ to: email, from: FROM, subject, html, text, purpose: 'auth', label: payload.email_data.email_action_type });
    console.log(`auth-send-email: ${payload.email_data.email_action_type} to ${email.replace(/^(.).*@/, '$1***@')} sent (${res.id})`);
    return Response.json({});
  } catch (e) {
    console.error('auth-send-email: send failed:', (e as Error).message);
    return Response.json({ error: { http_code: 500, message: 'email could not be sent' } }, { status: 500 });
  }
});
