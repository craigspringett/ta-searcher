// Who may use the Follow-ups functions: a signed-in user whose profile
// carries the follow_ups flag (profiles.features), or the service role.
// Managers without the flag are refused too, so nothing is reachable for
// anyone until Craig turns it on per person. Same shape as the CRM
// Shortlister's requireShortlisterCaller (_shared/shortlist/caller.ts).

import { identifyCaller, type Caller } from '../auth.ts';

export interface FlagCaller {
  caller: Caller;
  /** The profile's features, {} for the service role. */
  features: Record<string, unknown>;
  isManager: boolean;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

export function cors(): Response {
  return new Response(null, { headers: corsHeaders });
}

// deno-lint-ignore no-explicit-any
export async function requireFollowUpsCaller(req: Request, supabaseAdmin: any, opts: { managersOnly?: boolean; usersOnly?: boolean } = {}): Promise<{ ok: FlagCaller; reject: null } | { ok: null; reject: Response }> {
  const ident = await identifyCaller(req, supabaseAdmin);
  if (ident.reject) return { ok: null, reject: ident.reject };
  const caller = ident.caller;
  if (caller.kind === 'service') {
    if (opts.usersOnly) return { ok: null, reject: json({ error: 'A signed-in consultant must send this.' }, 403) };
    return { ok: { caller, features: {}, isManager: true }, reject: null };
  }
  const { data, error } = await supabaseAdmin.from('profiles').select('features').eq('id', caller.userId).maybeSingle();
  if (error) return { ok: null, reject: json({ error: `Could not read your profile: ${error.message}` }, 500) };
  const features = (data?.features && typeof data.features === 'object' ? data.features : {}) as Record<string, unknown>;
  if (features.follow_ups !== true) return { ok: null, reject: json({ error: 'Not found' }, 404) };
  const isManager = caller.profile.role === 'manager' || caller.profile.role === 'admin';
  if (opts.managersOnly && !isManager) return { ok: null, reject: json({ error: 'Managers only' }, 403) };
  return { ok: { caller, features, isManager }, reject: null };
}

/** The consultant rows that belong to a signed-in person (the rule My patch applies). */
// deno-lint-ignore no-explicit-any
export async function myConsultantIds(supabaseAdmin: any, caller: Extract<Caller, { kind: 'user' }>): Promise<string[]> {
  const { data } = await supabaseAdmin.from('consultants').select('id, email, profile_id');
  const email = caller.email.toLowerCase();
  return ((data || []) as Array<{ id: string; email: string | null; profile_id: string | null }>)
    .filter((c) => c.id === caller.profile.consultant_id || c.profile_id === caller.userId || (c.email || '').toLowerCase() === email)
    .map((c) => c.id);
}
