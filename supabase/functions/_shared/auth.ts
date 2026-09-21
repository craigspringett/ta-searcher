// Who is calling an edge function (Phase 4, slice 1).
//
// Every function the app calls runs behind the gateway's JWT check
// (verify_jwt = true in config.toml), which only proves the bearer is a token
// this project signed. This helper says whose it is:
//   - the service role (cron jobs through pg_net, the queue dispatchers, one
//     function calling another): allowed, kind 'service';
//   - a signed-in user with a profile (a Big Fish Recruitment consultant): allowed,
//     kind 'user', with the profile;
//   - anything else (the anon key, a user outside the work domains): refused
//     with the response to return.
import { createClient } from 'npm:@supabase/supabase-js@2';

export interface CallerProfile {
  id: string;
  email: string;
  display_name: string | null;
  role: 'consultant' | 'manager' | 'admin';
  consultant_id: string | null;
}

export type Caller =
  | { kind: 'service'; userId: null; profile: null }
  | { kind: 'user'; userId: string; email: string; profile: CallerProfile };

function claimsOf(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

export function bearerOf(req: Request): string {
  const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (auth) return auth;
  // supabase-js's functions.invoke() sends the client's key in `apikey` and,
  // since functions-js 2.116, only sets Authorization for a signed-in user.
  // One function calling another with the service client therefore arrives
  // with no Authorization header at all (10 September 2026: every 07:30
  // alert failed with 401 for this reason). Fall back to apikey; the anon
  // key there is still refused below.
  return (req.headers.get('apikey') || '').trim();
}

/**
 * Identify the caller. `supabaseAdmin` is a service-role client (used to read
 * the profile). The token's signature is checked by asking Auth for the user,
 * not by decoding it here; the decoded role is only used to spot the service
 * role and the anon key cheaply.
 */
export async function identifyCaller(req: Request, supabaseAdmin: any): Promise<{ caller: Caller; reject: null } | { caller: null; reject: Response }> {
  const token = bearerOf(req);
  const refuse = (status: number, message: string) => ({ caller: null, reject: new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }) });
  if (!token) return refuse(401, 'Sign in to use TA Searcher.');
  // The project's own service key, in either format, is the service role.
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (serviceKey && token === serviceKey) return { caller: { kind: 'service', userId: null, profile: null }, reject: null };
  const claims = claimsOf(token);
  const role = typeof claims?.role === 'string' ? claims.role : null;
  if (role === 'anon') return refuse(401, 'Sign in to use TA Searcher.');

  const url = Deno.env.get('SUPABASE_URL') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: userData, error: userErr } = await asUser.auth.getUser(token);
  if (userErr || !userData?.user) {
    if (role === 'service_role') return { caller: { kind: 'service', userId: null, profile: null }, reject: null };
    return refuse(401, 'Your sign-in has expired. Sign in again.');
  }
  const user = userData.user;
  const { data: profile, error: profErr } = await supabaseAdmin.from('profiles').select('id, email, display_name, role, consultant_id').eq('id', user.id).maybeSingle();
  if (profErr) return refuse(500, `Could not read your profile: ${profErr.message}`);
  if (!profile) return refuse(403, 'This address is not set up for TA Searcher. Sign in with your work email or ask Craig.');
  return { caller: { kind: 'user', userId: user.id, email: String(user.email || profile.email), profile: profile as CallerProfile }, reject: null };
}

/** Shorthand for functions that only need "is this a signed-in user or the service role". */
export async function requireCaller(req: Request, supabaseAdmin: any): Promise<Caller> {
  const r = await identifyCaller(req, supabaseAdmin);
  if (r.reject) throw new CallerRejected(r.reject);
  return r.caller;
}

export class CallerRejected extends Error {
  response: Response;
  constructor(response: Response) {
    super('caller rejected');
    this.response = response;
  }
}
