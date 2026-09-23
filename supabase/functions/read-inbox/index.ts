// Read every connected Outlook inbox (22 September 2026): the replies from
// people the site knows are logged, follow-up runs stopped and answers
// drafted (_shared/inbox/run.ts). Every fifteen minutes on the schedule,
// but idle (no Graph call, no run row) until an email has gone to a
// contact in the last IDLE_AFTER_DAYS; Check now on the Alerts page reads
// regardless.
// a signed-in user reads their own mailbox through ms-connect {action:
// 'check'}. One pipeline_runs row per run, phase 'inbox'.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { identifyCaller } from '../_shared/auth.ts';
import { msConfig } from '../_shared/inbox/graph.ts';
import { hasRecentOutreach, IDLE_AFTER_DAYS, readInboxes } from '../_shared/inbox/run.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const ident = await identifyCaller(req, supabase);
  if (ident.reject) return ident.reject;
  if (ident.caller.kind !== 'service') return json({ error: 'The inbox is read on the schedule; from the app use Check now on the Alerts page.' }, 403);
  const cfg = msConfig(supabaseUrl);
  if (!cfg) return json({ ok: true, skipped: 'MS_CLIENT_ID and MS_TENANT_ID are not set', results: [] });
  const now = new Date();
  // Idle until a first email has gone to a contact: nothing to match, so the mailbox is not read and no run row is written.
  if (!(await hasRecentOutreach(supabase, now))) return json({ ok: true, skipped: `idle: no email has gone to a contact in the last ${IDLE_AFTER_DAYS} days`, results: [] });
  const { data: runRow } = await supabase.from('pipeline_runs').insert({ phase: 'inbox', started_at: now.toISOString(), status: 'running', details: {} }).select('id').maybeSingle();
  try {
    const results = await readInboxes(supabase, cfg, { now });
    const totals = { mailboxes: results.length, read: results.reduce((n, r) => n + r.read, 0), matched: results.reduce((n, r) => n + r.matched, 0), drafted: results.reduce((n, r) => n + r.drafted, 0), stopped: results.reduce((n, r) => n + r.stopped, 0), errors: results.filter((r) => r.error).map((r) => `${r.mailbox}: ${r.error}`) };
    if (runRow?.id) await supabase.from('pipeline_runs').update({ finished_at: new Date().toISOString(), status: totals.errors.length ? 'degraded' : 'ok', details: { ...totals, results }, new_count: totals.matched }).eq('id', runRow.id);
    console.log('[read-inbox]', JSON.stringify(totals));
    return json({ ok: totals.errors.length === 0, ...totals, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (runRow?.id) await supabase.from('pipeline_runs').update({ finished_at: new Date().toISOString(), status: 'failed', error: msg }).eq('id', runRow.id);
    return json({ ok: false, error: msg }, 500);
  }
});
