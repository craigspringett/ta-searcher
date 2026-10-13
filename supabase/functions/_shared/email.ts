// Shared transactional email sender.
//
// Replaces `@lovable.dev/email-js` (which relayed through Lovable's email API).
// Sends via the Resend REST API. The error shape mirrors the previous library's
// EmailAPIError so process-email-queue's rate-limit / forbidden handling is unchanged.
//
// Secrets (set with `supabase secrets set ...`):
//   RESEND_API_KEY  required — https://resend.com/api-keys
//   EMAIL_SEND_URL  optional — override the API endpoint (tests / local dev)

export interface EmailPayload {
  run_id?: string
  to: string
  from: string
  sender_domain?: string
  subject: string
  html: string
  text?: string
  purpose?: string
  label?: string
  idempotency_key?: string
  unsubscribe_token?: string
  message_id?: string
  /** Where a human reply lands. The sending domain has no inbox, so replies to noreply@ bounce (Luke, 12 September 2026). */
  reply_to?: string
  /**
   * True for a one-to-one business email (an outreach email from a
   * consultant, Follow-ups slice 1): no List-Unsubscribe header, because a
   * mail client would show "Unsubscribe" on a personal note. Alerts and the
   * brief keep the header.
   */
  no_unsubscribe?: boolean
}

/** Where the signature images are served from; the same constant as SIGNATURE_ASSET_BASE in signature.ts. */
const SIGNATURE_IMAGE_BASE = 'https://ta-searcher.netlify.app/email/'

/**
 * Outlook holds back pictures on a web address until the reader presses
 * "download pictures", so the signature looked broken (Craig, 13 October
 * 2026). Pictures attached to the message and pointed at with cid: show at
 * once. Every signature image on the app's own site becomes an inline
 * attachment; Resend fetches each file from its address.
 */
export function inlineSignatureImages(html: string): { html: string; attachments: Array<{ filename: string; path: string; content_id: string }> } {
  const found = new Map<string, string>()
  const out = html.replace(/(src=")(https:\/\/ta-searcher\.netlify\.app\/email\/([A-Za-z0-9_-]+\.(?:png|jpg|jpeg|gif)))(")/g, (_m, a, url, file, z) => {
    const id = file.replace(/\.[^.]+$/, '')
    found.set(id, url)
    return `${a}cid:${id}${z}`
  })
  const attachments = [...found].map(([id, url]) => ({ filename: url.split('/').pop() as string, path: url, content_id: id }))
  return { html: out, attachments }
}

export class EmailAPIError extends Error {
  status: number
  retryAfterSeconds: number | null
  constructor(status: number, message: string, retryAfterSeconds: number | null = null) {
    super(message)
    this.name = 'EmailAPIError'
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export async function sendEmail(payload: EmailPayload): Promise<{ id: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) {
    throw new EmailAPIError(500, 'RESEND_API_KEY not configured')
  }
  const sendUrl = Deno.env.get('EMAIL_SEND_URL') || 'https://api.resend.com/emails'

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
  if (payload.idempotency_key) {
    headers['Idempotency-Key'] = payload.idempotency_key
  }

  const emailHeaders: Record<string, string> = {}
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  if (payload.unsubscribe_token && supabaseUrl && !payload.no_unsubscribe) {
    const unsubscribeUrl = `${supabaseUrl}/functions/v1/handle-email-unsubscribe?token=${payload.unsubscribe_token}`
    emailHeaders['List-Unsubscribe'] = `<${unsubscribeUrl}>`
    emailHeaders['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
  }

  const tags: Array<{ name: string; value: string }> = []
  if (payload.label) tags.push({ name: 'template', value: sanitizeTag(payload.label) })
  if (payload.purpose) tags.push({ name: 'purpose', value: sanitizeTag(payload.purpose) })
  if (payload.message_id) tags.push({ name: 'message_id', value: sanitizeTag(payload.message_id) })

  const inline = inlineSignatureImages(payload.html)

  const response = await fetch(sendUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      from: payload.from,
      to: [payload.to],
      reply_to: payload.reply_to || undefined,
      subject: payload.subject,
      html: inline.html,
      text: payload.text,
      attachments: inline.attachments.length ? inline.attachments : undefined,
      headers: Object.keys(emailHeaders).length ? emailHeaders : undefined,
      tags: tags.length ? tags : undefined,
    }),
  })

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    const retryAfterHeader = response.headers.get('retry-after')
    const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : NaN
    throw new EmailAPIError(
      response.status,
      `Email API error ${response.status}: ${bodyText.slice(0, 500)}`,
      Number.isFinite(retryAfter) ? retryAfter : null,
    )
  }

  const data = (await response.json().catch(() => ({}))) as { id?: string }
  return { id: data.id ?? '' }
}

// Resend tag values only allow ASCII letters, numbers, underscores and dashes.
function sanitizeTag(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256)
}
