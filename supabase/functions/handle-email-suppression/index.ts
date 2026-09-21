import { createClient } from 'npm:@supabase/supabase-js@2'
import { WebhookError, verifyResendWebhook } from '../_shared/resend-webhook.ts'

// Receives Resend webhook events (https://resend.com/docs/dashboard/webhooks/event-types)
// and records bounces / complaints so those addresses are never emailed again.
// Configure the webhook in Resend to POST to:
//   https://<project-ref>.supabase.co/functions/v1/handle-email-suppression
// with the events `email.bounced` and `email.complained` enabled, and store its
// signing secret as the RESEND_WEBHOOK_SECRET Supabase secret.
interface SuppressionPayload {
  email: string
  reason: 'bounce' | 'complaint' | 'unsubscribe'
  message_id?: string
  metadata?: Record<string, unknown>
  is_retry: boolean
  retry_count: number
}

function parseSuppressionPayload(body: string): SuppressionPayload[] {
  const parsed = JSON.parse(body)
  const type: string = parsed?.type ?? ''
  const data = parsed?.data ?? {}
  let reason: SuppressionPayload['reason'] | null = null
  if (type === 'email.bounced') reason = 'bounce'
  else if (type === 'email.complained') reason = 'complaint'
  if (!reason) {
    throw new IgnoredEvent(type || 'unknown')
  }
  const recipients: string[] = Array.isArray(data.to) ? data.to : data.to ? [data.to] : []
  if (recipients.length === 0) {
    throw new Error('Missing recipient in payload')
  }
  // Resend only reports hard bounces as permanent; soft bounces should not suppress.
  if (reason === 'bounce' && data.bounce?.type && data.bounce.type !== 'Permanent') {
    throw new IgnoredEvent(`soft bounce (${data.bounce.type})`)
  }
  const messageId =
    Array.isArray(data.tags)
      ? data.tags.find((t: { name?: string }) => t?.name === 'message_id')?.value
      : data.tags?.message_id
  return recipients.map((email) => ({
    email: String(email),
    reason: reason as SuppressionPayload['reason'],
    message_id: typeof messageId === 'string' ? messageId : undefined,
    metadata: {
      provider: 'resend',
      event_type: type,
      email_id: data.email_id ?? null,
      bounce: data.bounce ?? null,
      created_at: parsed.created_at ?? null,
    },
    is_retry: false,
    retry_count: 0,
  }))
}

class IgnoredEvent extends Error {}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!webhookSecret || !supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required environment variables')
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  // Verify the Resend (Svix) signature before trusting the payload
  let payloads: SuppressionPayload[]
  try {
    const body = await verifyResendWebhook(req, webhookSecret)
    payloads = parseSuppressionPayload(body)
  } catch (error) {
    if (error instanceof IgnoredEvent) {
      console.log('Ignoring webhook event', { type: error.message })
      return jsonResponse({ success: true, ignored: true })
    }
    if (error instanceof WebhookError) {
      switch (error.code) {
        case 'invalid_signature':
          console.error('Invalid webhook signature')
          return jsonResponse({ error: 'Invalid signature' }, 401)
        case 'stale_timestamp':
          console.error('Stale webhook timestamp')
          return jsonResponse({ error: 'Stale timestamp' }, 401)
        case 'missing_headers':
          console.error('Missing webhook signature headers')
          return jsonResponse({ error: 'Missing signature' }, 401)
        default:
          console.error('Webhook verification failed', { code: error.code, message: error.message })
          return jsonResponse({ error: 'Verification failed' }, 401)
      }
    }
    if (error instanceof SyntaxError || error instanceof Error) {
      console.error('Invalid payload', { message: error.message })
      return jsonResponse({ error: 'Invalid payload' }, 400)
    }
    console.error('Unexpected error during verification', { error })
    return jsonResponse({ error: 'Internal error' }, 500)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  for (const payload of payloads) {
  const normalizedEmail = payload.email.toLowerCase()

  // 1. Upsert to suppressed_emails (idempotent — safe for retries)
  const { error: suppressError } = await supabase
    .from('suppressed_emails')
    .upsert(
      {
        email: normalizedEmail,
        reason: payload.reason,
        metadata: payload.metadata ?? null,
      },
      { onConflict: 'email' },
    )

  if (suppressError) {
    console.error('Failed to upsert suppressed email', {
      error: suppressError,
      email_redacted: normalizedEmail[0] + '***@' + normalizedEmail.split('@')[1],
    })
    return jsonResponse({ error: 'Failed to write suppression' }, 500)
  }

  // 2. Append a new log entry for the suppression event (never update existing rows)
  const sendLogStatus = mapReasonToStatus(payload.reason)
  const sendLogMessage = mapReasonToMessage(payload.reason)

  const { error: insertError } = await supabase
    .from('email_send_log')
    .insert({
      message_id: payload.message_id ?? null,
      template_name: 'system',
      recipient_email: normalizedEmail,
      status: sendLogStatus,
      error_message: sendLogMessage,
      metadata: payload.metadata ?? null,
    })

  if (insertError) {
    // Non-fatal — log and continue. The suppression was already recorded.
    console.warn('Failed to insert email_send_log', {
      error: insertError,
    })
  }

  console.log('Suppression processed', {
    email_redacted: normalizedEmail[0] + '***@' + normalizedEmail.split('@')[1],
    reason: payload.reason,
    is_retry: payload.is_retry,
    retry_count: payload.retry_count,
    has_message_id: !!payload.message_id,
  })
  }

  return jsonResponse({ success: true })
})

function mapReasonToStatus(
  reason: string,
): 'bounced' | 'complained' | 'suppressed' {
  switch (reason) {
    case 'bounce':
      return 'bounced'
    case 'complaint':
      return 'complained'
    default:
      return 'suppressed'
  }
}

function mapReasonToMessage(reason: string): string {
  switch (reason) {
    case 'bounce':
      return 'Permanent bounce — email address is invalid or rejected'
    case 'complaint':
      return 'Spam complaint — recipient marked email as spam'
    case 'unsubscribe':
      return 'Recipient unsubscribed'
    default:
      return 'Email suppressed'
  }
}
