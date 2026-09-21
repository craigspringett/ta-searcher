import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { TEMPLATES } from '../_shared/transactional-email-templates/registry.ts'
import { identifyCaller } from '../_shared/auth.ts'
import { loadSendingDomains, resolveFrom, type Sender } from '../_shared/sending-domains.ts'

// Configuration baked in at scaffold time
const SITE_NAME = "who-finds-leads"
// The sending sub-domain: the SENDER_DOMAIN secret (notify.whofoundwho.co.uk, verified in Resend, until notify.bigfishrecruitment.co.uk is verified).
const SENDER_DOMAIN = Deno.env.get("SENDER_DOMAIN") || "notify.bigfishrecruitment.co.uk"
const FROM_DOMAIN = SENDER_DOMAIN
// notify.bigfishrecruitment.co.uk has no mailbox, so a consultant who replies to an alert gets a bounce.
// Replies go to a person instead (REPLY_TO_EMAIL secret, Craig by default).
const REPLY_TO = Deno.env.get("REPLY_TO_EMAIL") || "craig@bigfishrecruitment.co.uk"
const APP_BASE_URL = "https://ta-searcher.netlify.app"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

// Generate a cryptographically random 32-byte hex token
function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Auth: verify_jwt = true at the gateway only proves the bearer is one of the
// project's tokens, and the anon key is public. Since the Phase 4 hotfix
// (9 September 2026) only the service role may send: process-email-queue and
// the other functions call this with the service key.

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required environment variables')
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  const ident = await identifyCaller(req, createClient(supabaseUrl, supabaseServiceKey))
  if (ident.reject) return ident.reject
  if (ident.caller.kind !== 'service') {
    return new Response(JSON.stringify({ error: 'Only the service role can send email.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  // Parse request body
  let templateName: string
  let recipientEmail: string
  let idempotencyKey: string
  let messageId: string
  let templateData: Record<string, any> = {}
  let dryRun = false
  // Where a human reply lands. Default: REPLY_TO_EMAIL (Craig). A caller may
  // name another work address (CRM Shortlister: the consultant who owns the
  // company, so a candidate's reply reaches them); anything that is not a
  // plain address is ignored and the default stands.
  let replyTo = REPLY_TO
  // Follow-ups slice 1: a caller may ask for the email to go out in a named
  // person's name from their own address ({ from: { name, email } }). The
  // address is used only when its domain is in app_settings.sending_domains
  // (resolveFrom); otherwise the name is kept and the address falls back to
  // noreply@ on the notify sub-domain. `metadata` is written on the send-log
  // row (company, consultant, contact) so Resend's events can be tied back.
  // `noUnsubscribe` drops the List-Unsubscribe header for a one-to-one email.
  let requestedFrom: Sender | null = null
  let metadata: Record<string, unknown> | null = null
  let noUnsubscribe = false
  try {
    const body = await req.json()
    dryRun = body.dryRun === true
    if (typeof body.replyTo === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.replyTo.trim())) replyTo = body.replyTo.trim()
    if (body.from && typeof body.from === 'object' && typeof body.from.email === 'string') {
      requestedFrom = { name: typeof body.from.name === 'string' ? body.from.name : '', email: body.from.email }
    }
    if (body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)) metadata = body.metadata
    noUnsubscribe = body.noUnsubscribe === true
    templateName = body.templateName || body.template_name
    recipientEmail = body.recipientEmail || body.recipient_email
    messageId = crypto.randomUUID()
    idempotencyKey = body.idempotencyKey || body.idempotency_key || messageId
    if (body.templateData && typeof body.templateData === 'object') {
      templateData = body.templateData
    }
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON in request body' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  if (!templateName) {
    return new Response(
      JSON.stringify({ error: 'templateName is required' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // 1. Look up template from registry (early — needed to resolve recipient)
  const template = TEMPLATES[templateName]

  if (!template) {
    console.error('Template not found in registry', { templateName })
    return new Response(
      JSON.stringify({
        error: `Template '${templateName}' not found. Available: ${Object.keys(TEMPLATES).join(', ')}`,
      }),
      {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // Resolve effective recipient: template-level `to` takes precedence over
  // the caller-provided recipientEmail. This allows notification templates
  // to always send to a fixed address (e.g., site owner from env var).
  const effectiveRecipient = template.to || recipientEmail

  if (!effectiveRecipient) {
    return new Response(
      JSON.stringify({
        error: 'recipientEmail is required (unless the template defines a fixed recipient)',
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // Create Supabase client with service role (bypasses RLS)
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Who the email is from: the default sender unless a named person on a
  // verified domain was asked for.
  const sender = resolveFrom(requestedFrom, requestedFrom ? await loadSendingDomains(supabase) : [], { name: SITE_NAME, email: `noreply@${FROM_DOMAIN}` })
  if (requestedFrom && !sender.applied) console.log('Requested sender not applied', { reason: sender.reason })

  // dryRun: render only. Nothing is queued, logged or sent.
  if (dryRun) {
    const previewData = { ...templateData, unsubscribeUrl: templateData.unsubscribeUrl ?? `${APP_BASE_URL}/unsubscribe?token=dry-run` }
    const html = await renderAsync(React.createElement(template.component, previewData))
    const subject = typeof template.subject === 'function' ? template.subject(previewData) : template.subject
    return new Response(JSON.stringify({ success: true, dryRun: true, to: effectiveRecipient, replyTo, from: sender.from, fromApplied: sender.applied, fromReason: sender.reason ?? null, subject, html }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 2. Check suppression list (fail-closed: if we can't verify, don't send)
  const { data: suppressed, error: suppressionError } = await supabase
    .from('suppressed_emails')
    .select('id')
    .eq('email', effectiveRecipient.toLowerCase())
    .maybeSingle()

  if (suppressionError) {
    console.error('Suppression check failed — refusing to send', {
      error: suppressionError,
      effectiveRecipient,
    })
    return new Response(
      JSON.stringify({ error: 'Failed to verify suppression status' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  if (suppressed) {
    // Log the suppressed attempt
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'suppressed',
    })

    console.log('Email suppressed', { effectiveRecipient, templateName })
    return new Response(
      JSON.stringify({ success: false, reason: 'email_suppressed' }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // 3. Get or create unsubscribe token (one token per email address)
  const normalizedEmail = effectiveRecipient.toLowerCase()
  let unsubscribeToken: string

  // Check for existing token for this email
  const { data: existingToken, error: tokenLookupError } = await supabase
    .from('email_unsubscribe_tokens')
    .select('token, used_at')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (tokenLookupError) {
    console.error('Token lookup failed', {
      error: tokenLookupError,
      email: normalizedEmail,
    })
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'failed',
      error_message: 'Failed to look up unsubscribe token',
    })
    return new Response(
      JSON.stringify({ error: 'Failed to prepare email' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  if (existingToken && !existingToken.used_at) {
    // Reuse existing unused token
    unsubscribeToken = existingToken.token
  } else if (!existingToken) {
    // Create new token — upsert handles concurrent inserts gracefully
    unsubscribeToken = generateToken()
    const { error: tokenError } = await supabase
      .from('email_unsubscribe_tokens')
      .upsert(
        { token: unsubscribeToken, email: normalizedEmail },
        { onConflict: 'email', ignoreDuplicates: true }
      )

    if (tokenError) {
      console.error('Failed to create unsubscribe token', {
        error: tokenError,
      })
      await supabase.from('email_send_log').insert({
        message_id: messageId,
        template_name: templateName,
        recipient_email: effectiveRecipient,
        status: 'failed',
        error_message: 'Failed to create unsubscribe token',
      })
      return new Response(
        JSON.stringify({ error: 'Failed to prepare email' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // If another request raced us, our upsert was silently ignored.
    // Re-read to get the actual stored token.
    const { data: storedToken, error: reReadError } = await supabase
      .from('email_unsubscribe_tokens')
      .select('token')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (reReadError || !storedToken) {
      console.error('Failed to read back unsubscribe token after upsert', {
        error: reReadError,
        email: normalizedEmail,
      })
      await supabase.from('email_send_log').insert({
        message_id: messageId,
        template_name: templateName,
        recipient_email: effectiveRecipient,
        status: 'failed',
        error_message: 'Failed to confirm unsubscribe token storage',
      })
      return new Response(
        JSON.stringify({ error: 'Failed to prepare email' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }
    unsubscribeToken = storedToken.token
  } else {
    // Token exists but is already used — email should have been caught by suppression check above.
    // This is a safety fallback; log and skip sending.
    console.warn('Unsubscribe token already used but email not suppressed', {
      email: normalizedEmail,
    })
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'suppressed',
      error_message:
        'Unsubscribe token used but email missing from suppressed list',
    })
    return new Response(
      JSON.stringify({ success: false, reason: 'email_suppressed' }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // 4. Render React Email template to HTML and plain text.
  // The body carries an unsubscribe link as well as the List-Unsubscribe header.
  templateData = { ...templateData, unsubscribeUrl: `${APP_BASE_URL}/unsubscribe?token=${unsubscribeToken}` }
  const html = await renderAsync(
    React.createElement(template.component, templateData)
  )
  const plainText = await renderAsync(
    React.createElement(template.component, templateData),
    { plainText: true }
  )

  // Resolve subject — supports static string or dynamic function
  const resolvedSubject =
    typeof template.subject === 'function'
      ? template.subject(templateData)
      : template.subject

  // 5. Enqueue the pre-rendered email for async processing by the dispatcher.
  // The dispatcher (process-email-queue) handles sending, retries, and rate-limit backoff.

  // Log pending BEFORE enqueue so we have a record even if enqueue crashes
  await supabase.from('email_send_log').insert({
    message_id: messageId,
    template_name: templateName,
    recipient_email: effectiveRecipient,
    status: 'pending',
    metadata: metadata ? { ...metadata, from: sender.from, from_applied: sender.applied, reply_to: replyTo } : null,
  })

  const { error: enqueueError } = await supabase.rpc('enqueue_email', {
    queue_name: 'transactional_emails',
    payload: {
      message_id: messageId,
      to: effectiveRecipient,
      from: sender.from,
      reply_to: replyTo,
      sender_domain: sender.domain || SENDER_DOMAIN,
      subject: resolvedSubject,
      html,
      text: plainText,
      purpose: typeof metadata?.purpose === 'string' ? metadata.purpose : 'transactional',
      label: templateName,
      idempotency_key: idempotencyKey,
      unsubscribe_token: unsubscribeToken,
      no_unsubscribe: noUnsubscribe,
      queued_at: new Date().toISOString(),
    },
  })

  if (enqueueError) {
    console.error('Failed to enqueue email', {
      error: enqueueError,
      templateName,
      effectiveRecipient,
    })

    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'failed',
      error_message: 'Failed to enqueue email',
    })

    return new Response(JSON.stringify({ error: 'Failed to enqueue email' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  console.log('Transactional email enqueued', { templateName, effectiveRecipient })

  return new Response(
    JSON.stringify({ success: true, queued: true, messageId, from: sender.from, fromApplied: sender.applied, fromReason: sender.reason ?? null, replyTo }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  )
})
