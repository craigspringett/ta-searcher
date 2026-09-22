// Microsoft sends the browser here after the sign-in (22 September 2026):
// the code is exchanged for tokens, the mailbox is read from /me, the
// connection row is stored for the person the state belongs to, and the
// browser goes back to the Alerts page. Public (no JWT: the browser
// arrives from login.microsoftonline.com with nothing but the query).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { APP_BASE_URL } from '../_shared/alerts.ts';
import { exchangeCode, me, msConfig } from '../_shared/inbox/graph.ts';

function back(path: string, params: Record<string, string>): Response {
  const q = new URLSearchParams(params).toString();
  return new Response(null, { status: 302, headers: { Location: `${APP_BASE_URL}${path}${q ? `?${q}` : ''}` } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');
  if (oauthError) return back('/alerts', { outlook: 'error', reason: `${oauthError}: ${(url.searchParams.get('error_description') || '').split('\n')[0].slice(0, 160)}` });
  if (!code || !state) return back('/alerts', { outlook: 'error', reason: 'Microsoft sent no code back.' });
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const cfg = msConfig(supabaseUrl);
  if (!cfg) return back('/alerts', { outlook: 'error', reason: 'The Microsoft app is not set up on the project.' });
  try {
    const { data: st } = await supabase.from('oauth_states').select('profile_id, redirect_to, created_at').eq('state', state).maybeSingle();
    if (!st) return back('/alerts', { outlook: 'error', reason: 'That sign-in link has expired. Press Connect Outlook again.' });
    await supabase.from('oauth_states').delete().eq('state', state);
    if (Date.now() - Date.parse(st.created_at) > 15 * 60_000) return back('/alerts', { outlook: 'error', reason: 'That sign-in link has expired. Press Connect Outlook again.' });
    const tokens = await exchangeCode(cfg, code);
    const who = await me(tokens.accessToken);
    const { error } = await supabase.from('mail_connections').upsert({
      profile_id: st.profile_id, provider: 'microsoft', mailbox: who.mail, display_name: who.displayName, tenant_id: cfg.tenantId,
      access_token: tokens.accessToken, refresh_token: tokens.refreshToken, token_expires_at: tokens.expiresAt, scope: tokens.scope,
      status: 'connected', last_error: null, connected_at: new Date().toISOString(),
    }, { onConflict: 'profile_id' });
    if (error) return back('/alerts', { outlook: 'error', reason: `Could not store the connection: ${error.message}` });
    return back(st.redirect_to || '/alerts', { outlook: 'connected', mailbox: who.mail });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[ms-oauth-callback] failed:', msg);
    return back('/alerts', { outlook: 'error', reason: msg.slice(0, 200) });
  }
});
