// The weekly raises digest: every raise the radar saw last week in the
// sectors and at the stages Craig chose (app_settings.raises_digest), one
// email per recipient on Monday at 07:00 UTC (_shared/digest/build.ts,
// template raises-digest). One pipeline_runs row per run, phase
// 'raises_digest'.
//
// Service role (the schedule) sends to the recipients in the settings, or
// every active consultant when none are named. A signed-in user may run it
// with {"dryRun":true,"render":true} (the HTML comes back, nothing is
// queued) or {"testEmail": their own address} for one real email to
// themselves. Body: { dryRun?, render?, testEmail? }.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { identifyCaller } from '../_shared/auth.ts';
import { APP_BASE_URL, fold, sendAlertEmail } from '../_shared/alerts.ts';
import { buildDigest, DIGEST_DAYS, DIGEST_SETTINGS_KEY, digestSettingsFromValue, type DigestProspectRow } from '../_shared/digest/build.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const PHASE = 'raises_digest';
const PROSPECT_COLUMNS = 'id, name, website, status, sources, raise, register, talent_postings, prospect_score, first_seen_at, promoted_company_id';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const ident = await identifyCaller(req, supabase);
  if (ident.reject) return ident.reject;

  let body: { dryRun?: boolean; render?: boolean; testEmail?: string } = {};
  try { body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}; } catch { body = {}; }
  const dryRun = body.dryRun === true;
  const render = body.render === true;
  const testEmail = typeof body.testEmail === 'string' && body.testEmail.includes('@') ? fold(body.testEmail) : null;
  if (testEmail && (ident.caller.kind !== 'user' || fold(ident.caller.email) !== testEmail)) return json({ error: 'A test digest can only be sent to your own address.' }, 403);
  if (ident.caller.kind === 'user' && !testEmail && !dryRun) return json({ error: 'From the app, the digest can only be dry-run or test-sent to your own address.' }, 403);

  const now = new Date();
  const since = new Date(now.getTime() - (DIGEST_DAYS + 1) * 86_400_000).toISOString();
  let runId: string | null = null;
  if (!dryRun) {
    const { data: runRow } = await supabase.from('pipeline_runs').insert({ phase: PHASE, started_at: now.toISOString(), status: 'running', details: { testEmail: !!testEmail, caller: ident.caller.kind } }).select('id').maybeSingle();
    runId = runRow?.id ?? null;
  }
  const finish = async (status: string, details: Record<string, unknown>, error?: string) => {
    if (runId) await supabase.from('pipeline_runs').update({ finished_at: new Date().toISOString(), status, error: error ?? null, details, new_count: (details.count as number | undefined) ?? null }).eq('id', runId);
  };

  try {
    const [{ data: settingsRow }, { data: prospects, error: pErr }, { data: consultants }] = await Promise.all([
      supabase.from('app_settings').select('value').eq('key', DIGEST_SETTINGS_KEY).maybeSingle(),
      supabase.from('prospects').select(PROSPECT_COLUMNS).not('raise', 'is', null).or(`first_seen_at.gte.${since},last_seen_at.gte.${since}`).limit(2000),
      supabase.from('consultants').select('email, name, active').eq('active', true),
    ]);
    if (pErr) throw new Error(`prospects read failed: ${pErr.message}`);
    const settings = digestSettingsFromValue(settingsRow?.value);
    if (!settings.enabled && !testEmail && !dryRun) {
      await finish('ok', { skipped: 'switched off', count: 0 });
      return json({ ok: true, skipped: 'The digest is switched off on the Alerts page.', count: 0 });
    }
    const digest = buildDigest((prospects || []) as DigestProspectRow[], settings, APP_BASE_URL, now);
    const sectorsLine = settings.sectors.length ? settings.sectors.join(', ') : 'every sector';
    const people: Array<{ email: string; name: string }> = testEmail
      ? [{ email: testEmail, name: ident.caller.kind === 'user' ? (ident.caller.profile.display_name || testEmail) : testEmail }]
      : settings.recipients.length
      ? settings.recipients.map((email) => ({ email, name: (consultants || []).find((c) => fold(String(c.email || '')) === email)?.name || email }))
      : (consultants || []).filter((c) => c.email).map((c) => ({ email: fold(String(c.email)), name: String(c.name) }));
    const week = digest.weekEnding;
    const results: Array<{ email: string; status: string; error?: string; subject?: string; html?: string }> = [];
    for (const p of people) {
      const templateData = { recipientName: p.name, weekEnding: week, sections: digest.sections, count: digest.count, filteredOut: digest.filteredOut, sectorsLine, appUrl: APP_BASE_URL };
      const idempotencyKey = testEmail ? `raises-digest-test-${p.email}-${now.toISOString()}` : `raises-digest-${p.email}-${week}`;
      const outcome = await sendAlertEmail(supabase, { templateName: 'raises-digest', recipientEmail: p.email, idempotencyKey, templateData, dryRun, render: dryRun && render });
      results.push({ email: p.email, status: outcome.status, error: outcome.error, subject: outcome.subject || digest.subject, html: dryRun && render ? outcome.html : undefined });
    }
    const failed = results.filter((r) => r.status === 'failed').length;
    const details = { count: digest.count, filteredOut: digest.filteredOut, sections: digest.sections.map((s) => ({ sector: s.sector, items: s.items.length })), recipients: results.map((r) => ({ email: r.email, status: r.status, error: r.error })), settings: { sectors: settings.sectors, stages: settings.stages } };
    console.log('[send-raises-digest]', JSON.stringify(details));
    await finish(failed ? 'degraded' : 'ok', details, failed ? `${failed} send(s) failed` : undefined);
    return json({ ok: !failed, ...details, subject: digest.subject, message: testEmail ? `Test digest sent to ${testEmail}: ${digest.subject}.` : undefined, results: dryRun ? results : undefined, digest: dryRun ? digest : undefined });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[send-raises-digest] failed:', msg);
    await finish('failed', {}, msg);
    return json({ ok: false, error: msg }, 500);
  }
});
