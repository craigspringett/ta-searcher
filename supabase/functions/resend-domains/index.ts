// resend-domains: Resend's domains API for the coordinator (Follow-ups
// slice 1). Managers with the follow_ups flag, or the service role.
//
//   POST { "action": "list" }
//     Every domain on the Resend account with its verification status and
//     whether open and click tracking are on, and which of them are on
//     TA Searcher's allow-list (app_settings.sending_domains).
//   POST { "action": "add", "domain": "bigfishrecruitment.co.uk" }
//     Adds the domain (region eu-west-1) and returns the DNS records Resend
//     wants (DKIM TXT, the SPF include on the return-path sub-domain, the
//     MX for bounces) plus a DMARC suggestion, to hand to whoever manages
//     the domain. Adding a domain that is already there returns its records.
//   POST { "action": "records", "domain": "bigfishrecruitment.co.uk" }
//     The records and status of a domain already added (to check on it).
//   POST { "action": "verify", "domain": "..." }
//     Asks Resend to check the DNS now.
//   POST { "action": "tracking", "domain": "...", "open": true, "click": true }
//     Switches open and click tracking on (or off) for the domain. Resend
//     tracks per domain, not per email, so this is what makes
//     email.opened and email.clicked arrive.
//
// Nothing here writes app_settings: adding a verified domain to the
// allow-list is a deliberate SQL step in scripts/follow-ups-apply.md. The
// API key is read from the RESEND_API_KEY secret and never logged.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { cors, json, requireFollowUpsCaller } from '../_shared/outreach/caller.ts';
import { loadSendingDomains } from '../_shared/sending-domains.ts';

const API = Deno.env.get('RESEND_API_URL') || 'https://api.resend.com';

interface ResendDomain {
  id: string;
  name: string;
  status: string;
  created_at?: string;
  region?: string;
  open_tracking?: boolean;
  click_tracking?: boolean;
  records?: Array<{ record: string; name: string; type: string; value: string; ttl?: string; status?: string; priority?: number }>;
}

async function resend(apiKey: string, method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
  return { status: res.status, data };
}

function tidyDomain(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const d = v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : null;
}

/** The records with a plain description, plus the DMARC record Resend does not require but inboxes like. */
function describeRecords(d: ResendDomain) {
  const records = (d.records || []).map((r) => ({
    purpose: r.record === 'DKIM' ? 'DKIM: proves the email was signed by this domain' : r.record === 'SPF' ? 'SPF: lets Resend send the bounce (return-path) sub-domain' : r.record === 'MX' ? 'MX: where bounces for the return-path sub-domain go' : r.record,
    type: r.type,
    name: r.name,
    value: r.value,
    ttl: r.ttl || 'Auto',
    priority: r.priority ?? null,
    status: r.status || 'not_started',
  }));
  const dmarc = {
    purpose: 'DMARC (optional but recommended): tells inboxes what to do when SPF or DKIM fail, and where to send reports. Only add it if the domain has no _dmarc record yet.',
    type: 'TXT',
    name: `_dmarc.${d.name}`,
    value: 'v=DMARC1; p=none; rua=mailto:dmarc@' + d.name,
    ttl: 'Auto',
  };
  return { records, dmarc };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return cors();
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const who = await requireFollowUpsCaller(req, supabase, { managersOnly: true });
  if (who.reject) return who.reject;
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  // The project's RESEND_API_KEY is a sending-only key (Resend answered
  // "This API key is restricted to only send emails", 17 September 2026).
  // Domains and webhooks need a full-access key, kept as RESEND_ADMIN_API_KEY.
  const apiKey = Deno.env.get('RESEND_ADMIN_API_KEY') || Deno.env.get('RESEND_API_KEY');
  if (!apiKey) return json({ error: 'RESEND_ADMIN_API_KEY (or RESEND_API_KEY) is not set on the project.' }, 500);

  let body: { action?: string; domain?: string; open?: boolean; click?: boolean; webhookId?: string; endpoint?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON request body' }, 400); }
  const action = body.action || 'list';
  const allowed = await loadSendingDomains(supabase);

  // Webhooks: list them, or point one at handle-email-events with every
  // event. Updating keeps the webhook's signing secret, so nothing secret
  // ever comes back from here; creating a webhook would, so this never
  // creates one (do that once in the Resend dashboard).
  const ALL_EVENTS = ['email.sent', 'email.delivered', 'email.delivery_delayed', 'email.opened', 'email.clicked', 'email.bounced', 'email.complained'];
  const describeWebhook = (w: Record<string, unknown>) => ({ id: w.id, endpoint: w.endpoint, events: w.events, status: w.status, createdAt: w.created_at ?? null });
  if (action === 'webhooks') {
    const list = await resend(apiKey, 'GET', '/webhooks');
    if (list.status !== 200) return json({ error: `Resend answered ${list.status} listing webhooks`, detail: list.data }, 502);
    const rows: Record<string, unknown>[] = Array.isArray(list.data?.data) ? list.data.data : [];
    return json({ webhooks: rows.map(describeWebhook) });
  }
  if (action === 'webhook') {
    const list = await resend(apiKey, 'GET', '/webhooks');
    if (list.status !== 200) return json({ error: `Resend answered ${list.status} listing webhooks`, detail: list.data }, 502);
    const rows: Record<string, unknown>[] = Array.isArray(list.data?.data) ? list.data.data : [];
    const target = body.webhookId ? rows.find((w) => w.id === body.webhookId) : rows.find((w) => String(w.endpoint || '').includes('/functions/v1/handle-email-')) || rows[0];
    if (!target) return json({ error: 'No webhook on the Resend account to update. Create one in the Resend dashboard pointing at handle-email-events, then store its signing secret as RESEND_EVENTS_WEBHOOK_SECRET.' }, 404);
    const endpoint = body.endpoint || `${Deno.env.get('SUPABASE_URL')}/functions/v1/handle-email-events`;
    const upd = await resend(apiKey, 'PATCH', `/webhooks/${target.id}`, { endpoint, events: ALL_EVENTS, status: 'enabled' });
    if (upd.status < 200 || upd.status >= 300) return json({ error: `Resend answered ${upd.status} updating the webhook`, detail: upd.data }, 502);
    const after = await resend(apiKey, 'GET', `/webhooks/${target.id}`);
    return json({ before: describeWebhook(target), after: after.status === 200 ? describeWebhook(after.data || {}) : { id: target.id, endpoint, events: ALL_EVENTS, status: 'enabled' }, note: 'The signing secret is unchanged, so RESEND_WEBHOOK_SECRET keeps working for handle-email-events.' });
  }

  const findDomain = async (name: string): Promise<ResendDomain | null> => {
    const list = await resend(apiKey, 'GET', '/domains');
    if (list.status !== 200) throw new Error(`Resend answered ${list.status} listing domains: ${JSON.stringify(list.data).slice(0, 300)}`);
    const rows: ResendDomain[] = Array.isArray(list.data?.data) ? list.data.data : [];
    return rows.find((d) => d.name.toLowerCase() === name) || null;
  };

  try {
    if (action === 'list') {
      const list = await resend(apiKey, 'GET', '/domains');
      if (list.status !== 200) return json({ error: `Resend answered ${list.status}`, detail: list.data }, 502);
      const rows: ResendDomain[] = Array.isArray(list.data?.data) ? list.data.data : [];
      return json({
        domains: rows.map((d) => ({ id: d.id, name: d.name, status: d.status, region: d.region ?? null, openTracking: d.open_tracking ?? null, clickTracking: d.click_tracking ?? null, createdAt: d.created_at ?? null, onAllowList: allowed.includes(d.name.toLowerCase()) })),
        allowList: allowed,
      });
    }

    const domain = tidyDomain(body.domain);
    if (!domain) return json({ error: 'domain is required, e.g. "bigfishrecruitment.co.uk"' }, 400);

    if (action === 'add') {
      const existing = await findDomain(domain);
      let d: ResendDomain;
      if (existing) {
        const got = await resend(apiKey, 'GET', `/domains/${existing.id}`);
        if (got.status !== 200) return json({ error: `Resend answered ${got.status}`, detail: got.data }, 502);
        d = got.data;
      } else {
        const made = await resend(apiKey, 'POST', '/domains', { name: domain, region: 'eu-west-1' });
        if (made.status < 200 || made.status >= 300) return json({ error: `Resend refused the domain (${made.status})`, detail: made.data }, 502);
        d = made.data;
      }
      return json({ domain: d.name, id: d.id, status: d.status, alreadyExisted: !!existing, ...describeRecords(d), next: 'Add the records at the DNS host, then call { "action": "verify" }. When status is "verified", add the domain to app_settings.sending_domains (scripts/follow-ups-apply.md) and switch tracking on with { "action": "tracking" }.' });
    }

    const found = await findDomain(domain);
    if (!found) return json({ error: `${domain} is not on the Resend account. Add it with { "action": "add" }.` }, 404);

    if (action === 'records') {
      const got = await resend(apiKey, 'GET', `/domains/${found.id}`);
      if (got.status !== 200) return json({ error: `Resend answered ${got.status}`, detail: got.data }, 502);
      const d: ResendDomain = got.data;
      // raw: Resend's whole domain object (no secrets in it), so an odd
      // tracking state can be read without guessing at field names.
      return json({ domain: d.name, id: d.id, status: d.status, openTracking: d.open_tracking ?? null, clickTracking: d.click_tracking ?? null, onAllowList: allowed.includes(d.name.toLowerCase()), ...describeRecords(d), raw: d });
    }
    if (action === 'verify') {
      const v = await resend(apiKey, 'POST', `/domains/${found.id}/verify`);
      if (v.status < 200 || v.status >= 300) return json({ error: `Resend answered ${v.status}`, detail: v.data }, 502);
      const got = await resend(apiKey, 'GET', `/domains/${found.id}`);
      const d: ResendDomain = got.status === 200 ? got.data : found;
      return json({ domain: d.name, status: d.status, ...describeRecords(d), note: 'Verification can take a few minutes after the records are added; call again to re-read the status.' });
    }
    if (action === 'tracking') {
      const patch = { open_tracking: body.open !== false, click_tracking: body.click !== false };
      const p = await resend(apiKey, 'PATCH', `/domains/${found.id}`, patch);
      if (p.status < 200 || p.status >= 300) return json({ error: `Resend answered ${p.status}`, detail: p.data }, 502);
      const got = await resend(apiKey, 'GET', `/domains/${found.id}`);
      const d: ResendDomain = got.status === 200 ? got.data : found;
      return json({ domain: d.name, status: d.status, openTracking: d.open_tracking ?? patch.open_tracking, clickTracking: d.click_tracking ?? patch.click_tracking, patchStatus: p.status, patchResponse: p.data, raw: d });
    }
    return json({ error: `Unknown action "${action}". One of: list, add, records, verify, tracking, webhooks, webhook.` }, 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('resend-domains failed', { action, message: message.slice(0, 300) });
    return json({ error: message.slice(0, 500) }, 502);
  }
});
