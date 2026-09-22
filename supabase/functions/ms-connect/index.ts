// Start the Outlook connection (22 September 2026): the signed-in person
// asks for the Microsoft sign-in link; a state row ties the callback to
// them. Body: { action?: 'start' | 'status' | 'disconnect' | 'check' }.
//   start       → { url }: open it, sign in, approve Mail.Read; Microsoft
//                 sends the browser to ms-oauth-callback, which stores the
//                 tokens and returns to the Alerts page.
//   status      → { connection } (mailbox, status, last read, error) or null.
//   disconnect  → forgets the tokens (Microsoft's consent stays until it is
//                 revoked at https://myapps.microsoft.com).
//   check       → reads the inbox now for this person's mailbox.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { identifyCaller } from '../_shared/auth.ts';
import { authorizeUrl, msConfig } from '../_shared/inbox/graph.ts';
import { readInboxes } from '../_shared/inbox/run.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const ident = await identifyCaller(req, supabase);
  if (ident.reject) return ident.reject;
  if (ident.caller.kind !== 'user') return json({ error: 'A signed-in person connects their own mailbox.' }, 403);
  const userId = ident.caller.userId;
  let body: any = {};
  try { body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}; } catch { body = {}; }
  const action = typeof body.action === 'string' ? body.action : 'status';
  const cfg = msConfig(supabaseUrl);

  try {
    if (action === 'start') {
      if (!cfg) return json({ error: 'The Microsoft app is not set up yet (MS_CLIENT_ID and MS_TENANT_ID).' }, 400);
      if (!cfg.clientSecret) return json({ error: 'MS_CLIENT_SECRET is not set on the project yet. Add it under Edge Functions secrets, then try again.' }, 400);
      const state = crypto.randomUUID();
      const { error } = await supabase.from('oauth_states').insert({ state, profile_id: userId, redirect_to: typeof body.redirectTo === 'string' ? body.redirectTo.slice(0, 200) : null });
      if (error) return json({ error: `Could not start: ${error.message}` }, 500);
      return json({ ok: true, url: authorizeUrl(cfg, state) });
    }
    if (action === 'disconnect') {
      const { error } = await supabase.from('mail_connections').update({ status: 'disconnected', access_token: null, refresh_token: null, token_expires_at: null }).eq('profile_id', userId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, message: 'Outlook disconnected. TA Searcher no longer reads your inbox.' });
    }
    if (action === 'check') {
      if (!cfg) return json({ error: 'The Microsoft app is not set up yet.' }, 400);
      const { data: conn } = await supabase.from('mail_connections').select('id').eq('profile_id', userId).neq('status', 'disconnected').maybeSingle();
      if (!conn) return json({ error: 'Outlook is not connected yet.' }, 400);
      const [r] = await readInboxes(supabase, cfg, { now: new Date(), connectionId: conn.id });
      return json({ ok: !r?.error, result: r, message: r ? (r.error ? `Could not read the inbox: ${r.error}` : `Read ${r.read} new ${r.read === 1 ? 'message' : 'messages'}, ${r.matched} from ${r.matched === 1 ? 'a company' : 'companies'} on the patch, ${r.drafted} ${r.drafted === 1 ? 'reply' : 'replies'} drafted.`) : 'Nothing to read.' });
    }
    const { data: conn } = await supabase.from('mail_connections').select('id, mailbox, display_name, status, last_error, watermark, connected_at, last_checked_at').eq('profile_id', userId).maybeSingle();
    return json({ ok: true, configured: !!cfg && !!cfg.clientSecret, connection: conn && conn.status !== 'disconnected' ? conn : null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[ms-connect] failed:', msg);
    return json({ error: msg }, 500);
  }
});
