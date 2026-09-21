// Verifies Resend webhook signatures (Resend signs with Svix).
// Docs: https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests
//
// Secret: RESEND_WEBHOOK_SECRET — the "Signing secret" shown when you create the
// webhook in the Resend dashboard (starts with `whsec_`).

export class WebhookError extends Error {
  code: 'invalid_signature' | 'stale_timestamp' | 'invalid_payload' | 'invalid_json' | 'missing_headers'
  constructor(code: WebhookError['code'], message: string) {
    super(message)
    this.name = 'WebhookError'
    this.code = code
  }
}

const TOLERANCE_SECONDS = 5 * 60

export async function verifyResendWebhook(req: Request, secret: string): Promise<string> {
  const msgId = req.headers.get('svix-id')
  const timestamp = req.headers.get('svix-timestamp')
  const signatureHeader = req.headers.get('svix-signature')
  if (!msgId || !timestamp || !signatureHeader) {
    throw new WebhookError('missing_headers', 'Missing svix-id / svix-timestamp / svix-signature headers')
  }

  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) {
    throw new WebhookError('stale_timestamp', 'Webhook timestamp outside tolerance')
  }

  const body = await req.text()
  const secretBytes = base64Decode(secret.replace(/^whsec_/, ''))
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${msgId}.${timestamp}.${body}`))
  const expected = base64Encode(new Uint8Array(signed))

  // Header format: "v1,<base64sig> v1,<base64sig> ..."
  const candidates = signatureHeader
    .split(' ')
    .map((part) => part.trim().split(',', 2))
    .filter(([version]) => version === 'v1')
    .map(([, sig]) => sig)

  if (!candidates.some((sig) => timingSafeEqual(sig, expected))) {
    throw new WebhookError('invalid_signature', 'Webhook signature mismatch')
  }
  return body
}

function base64Decode(value: string): Uint8Array<ArrayBuffer> {
  const bin = atob(value)
  const bytes = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function base64Encode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
