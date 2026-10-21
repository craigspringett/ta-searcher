// handle-email-events: Resend's webhook for everything that happens to an
// email we sent (Follow-ups slice 1, 17 September 2026).
//
// Point the Resend webhook at
//   https://<project-ref>.supabase.co/functions/v1/handle-email-events
// with email.sent, email.delivered, email.delivery_delayed, email.opened,
// email.clicked, email.bounced and email.complained enabled, and store its
// signing secret as RESEND_EVENTS_WEBHOOK_SECRET (RESEND_WEBHOOK_SECRET is
// read when that is not set, so the existing webhook can simply be
// re-pointed here with all seven events ticked).
//
// Every event is stored in email_events, tied to the company, the
// consultant and the contact through email_send_log.metadata (the outreach
// send path writes it). A permanent bounce or a complaint also suppresses
// the address exactly as handle-email-suppression does, so that function
// can stay as it is (or be retired once this one is live).

import { createClient } from 'npm:@supabase/supabase-js@2'
import { WebhookError, verifyResendWebhook } from '../_shared/resend-webhook.ts'
import { classifyEngagement, dedupeKey, engagementIp, IgnoredEvent, lookupIpOrg, linkFromMetadata, parseResendEvent, shouldSuppress, type ParsedEmailEvent } from '../_shared/email-events.ts'
import { decideEngagementAlert, engagementSettingsFrom, engagementSubject } from '../_shared/engagement-alert.ts'
import { APP_BASE_URL } from '../_shared/alerts.ts'

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

const redact = (email: string) => email[0] + '***@' + (email.split('@')[1] || '')

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const webhookSecret = Deno.env.get('RESEND_EVENTS_WEBHOOK_SECRET') || Deno.env.get('RESEND_WEBHOOK_SECRET')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!webhookSecret || !supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required environment variables')
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  let event: ParsedEmailEvent
  try {
    const body = await verifyResendWebhook(req, webhookSecret)
    event = parseResendEvent(body)
  } catch (error) {
    if (error instanceof IgnoredEvent) {
      console.log('Ignoring webhook event', { type: error.message })
      return jsonResponse({ success: true, ignored: true })
    }
    if (error instanceof WebhookError) {
      console.error('Webhook verification failed', { code: error.code })
      return jsonResponse({ error: error.code === 'stale_timestamp' ? 'Stale timestamp' : error.code === 'missing_headers' ? 'Missing signature' : 'Invalid signature' }, 401)
    }
    if (error instanceof Error) {
      console.error('Invalid payload', { message: error.message })
      return jsonResponse({ error: 'Invalid payload' }, 400)
    }
    return jsonResponse({ error: 'Internal error' }, 500)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Which email was this? The send log row that carries the metadata (the
  // 'pending' row the send path wrote), by our message id.
  let link = linkFromMetadata(null)
  let kind: string | null = null
  let meta: unknown = null
  if (event.messageId) {
    const { data: rows } = await supabase.from('email_send_log').select('metadata').eq('message_id', event.messageId).not('metadata', 'is', null).limit(5)
    meta = (rows || []).map((r: { metadata: unknown }) => r.metadata).find((m) => m && typeof m === 'object' && (m as Record<string, unknown>).company_search_id) ?? null
    if (meta) {
      link = linkFromMetadata(meta)
      kind = typeof (meta as Record<string, unknown>).kind === 'string' ? String((meta as Record<string, unknown>).kind) : null
    }
  }

  // Is this one of our own emails? Every send of this project has a send log row under its message id.
  let ours = false
  if (event.messageId) {
    const { count: own } = await supabase.from('email_send_log').select('id', { count: 'exact', head: true }).eq('message_id', event.messageId)
    ours = (own ?? 0) > 0
  }

  let stored = 0
  let suppressed = 0
  let alerted = 0
  for (const recipient of event.recipients) {
    // Only this project's own emails are recorded (15 October 2026): Resend sends every event on the account to every webhook, and the WhoFoundWho schools site shares it. A bounce or complaint still suppresses the address below.
    if (ours) {
    // Is this open or click a machine? (21 October 2026) Worked out here, once, and stored with its reason.
    let verdict = { automatic: false, reason: null as string | null }
    let ipOrg: string | null = null
    if ((event.type === 'opened' || event.type === 'clicked') && event.messageId) {
      const { data: deliveredRow } = await supabase.from('email_events').select('occurred_at').eq('message_id', event.messageId).eq('recipient_email', recipient).eq('event_type', 'delivered').order('occurred_at', { ascending: true }).limit(1).maybeSingle()
      ipOrg = await lookupIpOrg(engagementIp(event.raw))
      verdict = classifyEngagement(event.type, event.occurredAt, deliveredRow?.occurred_at, ipOrg)
    }
    const { error: insertError } = await supabase.from('email_events').upsert({
      message_id: event.messageId,
      email_id: event.emailId,
      event_type: event.type,
      recipient_email: recipient,
      url: event.url,
      occurred_at: event.occurredAt,
      company_search_id: link.company_search_id,
      consultant_id: link.consultant_id,
      contact_name: link.contact_name,
      dedupe_key: dedupeKey(event, recipient),
      raw: event.raw,
      automatic: verdict.automatic,
      automatic_reason: verdict.reason,
      ip_org: ipOrg,
    }, { onConflict: 'dedupe_key', ignoreDuplicates: true })
    if (insertError) {
      console.error('Failed to store email event', { type: event.type, error: insertError.message })
      return jsonResponse({ error: 'Failed to store event' }, 500)
    }
    stored++

    // "Tell me when they open or click" (Craig, 18 September 2026): the
    // first open and the first click of a consultant's email alert the
    // consultant. Never fatal: an alert that fails is logged, the event stays.
    if ((event.type === 'opened' || event.type === 'clicked') && meta && event.messageId) {
      try {
        // Only people count: the first human open or click alerts, whatever scans came before it.
        const { count } = await supabase.from('email_events').select('id', { count: 'exact', head: true }).eq('message_id', event.messageId).eq('recipient_email', recipient).eq('event_type', event.type).eq('automatic', false)
        const automatic = verdict.automatic
        const { data: settingRow } = await supabase.from('app_settings').select('value').eq('key', 'engagement_alerts').maybeSingle()
        const decision = decideEngagementAlert({ type: event.type, recipient, url: event.url, occurredAt: event.occurredAt, countAfterInsert: count ?? 0, metadata: meta, automatic, settings: engagementSettingsFrom(settingRow?.value), appBaseUrl: APP_BASE_URL })
        if (decision.alert) {
          const a = decision.alert
          const { data: sent, error: sendErr } = await supabase.functions.invoke('send-transactional-email', {
            body: {
              templateName: 'engagement-alert',
              recipientEmail: a.to,
              noUnsubscribe: true,
              idempotencyKey: `engagement:${event.messageId}:${event.type}:${recipient}`,
              metadata: { kind: 'engagement_alert', purpose: 'transactional', about_message_id: event.messageId, company_search_id: link.company_search_id, consultant_id: link.consultant_id, contact_name: link.contact_name, subject: engagementSubject(a.data) },
              templateData: a.data,
            },
            headers: { Authorization: `Bearer ${supabaseServiceKey}` },
          })
          if (sendErr || !sent?.success) console.warn('Engagement alert not sent', { to: redact(a.to), error: sendErr?.message || sent?.error || 'send failed' })
          else alerted++
        } else {
          console.log('Engagement alert skipped', { type: event.type, reason: decision.reason })
        }
      } catch (e) {
        console.warn('Engagement alert failed', { error: e instanceof Error ? e.message : String(e) })
      }
    }

    }

    if (shouldSuppress(event)) {
      const reason = event.type === 'complained' ? 'complaint' : 'bounce'
      const data = (event.raw as { data?: Record<string, unknown> })?.data || {}
      const metadata = { provider: 'resend', event_type: `email.${event.type}`, email_id: event.emailId, bounce: data.bounce ?? null, created_at: (event.raw as { created_at?: string })?.created_at ?? null }
      const { error: suppressError } = await supabase.from('suppressed_emails').upsert({ email: recipient, reason, metadata }, { onConflict: 'email' })
      if (suppressError) {
        console.error('Failed to upsert suppressed email', { error: suppressError.message, email_redacted: redact(recipient) })
        return jsonResponse({ error: 'Failed to write suppression' }, 500)
      }
      const { error: logError } = await supabase.from('email_send_log').insert({
        message_id: event.messageId,
        template_name: 'system',
        recipient_email: recipient,
        status: reason === 'complaint' ? 'complained' : 'bounced',
        error_message: reason === 'complaint' ? 'Spam complaint — recipient marked email as spam' : 'Permanent bounce — email address is invalid or rejected',
        metadata,
      })
      if (logError) console.warn('Failed to insert email_send_log', { error: logError.message })
      suppressed++
    }
  }

  console.log('Email event stored', { type: event.type, stored, suppressed, alerted, kind, linked: !!link.company_search_id, has_message_id: !!event.messageId, recipients: event.recipients.map(redact) })
  return jsonResponse({ success: true, type: event.type, stored, suppressed, alerted })
})
