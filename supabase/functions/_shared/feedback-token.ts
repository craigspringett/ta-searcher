// Signed tokens for the "Wrong company" / "Closed" links in alert emails.
// Token = base64url(payload JSON) + "." + base64url(HMAC-SHA256(payload)).
// Secret: VACANCY_FEEDBACK_SECRET, falling back to the service role key.

export type FeedbackKind = 'wrong_company' | 'closed' | 'not_a_vacancy';

export interface FeedbackPayload {
  v: string; // vacancy id
  k: FeedbackKind;
  e: string; // reporter email
  t: number; // issued at (epoch seconds)
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function feedbackSecret(): string {
  const s = Deno.env.get('VACANCY_FEEDBACK_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!s) throw new Error('No VACANCY_FEEDBACK_SECRET or SUPABASE_SERVICE_ROLE_KEY available to sign feedback tokens');
  return s;
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function signFeedbackToken(payload: Omit<FeedbackPayload, 't'>, secret: string, now: Date = new Date()): Promise<string> {
  const full: FeedbackPayload = { ...payload, t: Math.floor(now.getTime() / 1000) };
  const body = b64url(enc.encode(JSON.stringify(full)));
  const sig = b64url(await hmac(secret, body));
  return `${body}.${sig}`;
}

/** Links older than this are refused; a stale email cannot change anything. */
export const TOKEN_MAX_AGE_DAYS = 30;

export async function verifyFeedbackToken(token: string, secret: string, now: Date = new Date()): Promise<FeedbackPayload | null> {
  const [body, sig] = (token || '').split('.');
  if (!body || !sig) return null;
  const expected = b64url(await hmac(secret, body));
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as FeedbackPayload;
    if (!payload?.v || !payload?.k || !payload?.e) return null;
    if (typeof payload.t !== 'number' || !Number.isFinite(payload.t)) return null;
    const ageSeconds = Math.floor(now.getTime() / 1000) - payload.t;
    if (ageSeconds > TOKEN_MAX_AGE_DAYS * 86400) return null;
    return payload;
  } catch {
    return null;
  }
}


/** Sign any small JSON payload the same way (used by contact feedback). */
export async function signPayload(payload: Record<string, unknown>, secret: string, now: Date = new Date()): Promise<string> {
  const full = { ...payload, t: Math.floor(now.getTime() / 1000) };
  const body = b64url(enc.encode(JSON.stringify(full)));
  const sig = b64url(await hmac(secret, body));
  return `${body}.${sig}`;
}

/** Verify a payload signed by signPayload; null when the signature or age is wrong. */
export async function verifyPayload<T extends Record<string, unknown>>(token: string, secret: string, now: Date = new Date()): Promise<(T & { t: number }) | null> {
  const [body, sig] = (token || '').split('.');
  if (!body || !sig) return null;
  const expected = b64url(await hmac(secret, body));
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as T & { t: number };
    if (typeof payload.t !== 'number' || !Number.isFinite(payload.t)) return null;
    if (Math.floor(now.getTime() / 1000) - payload.t > TOKEN_MAX_AGE_DAYS * 86400) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * The confirmation page in the app. The link must not hit the edge function
 * directly: the Supabase gateway serves HTML on GET as text/plain, and mail
 * scanners pre-fetch links, so the page shows the details and POSTs the
 * token to handle-vacancy-feedback only when a person presses the button.
 */
export const FEEDBACK_PAGE_URL = 'https://ta-searcher.netlify.app/feedback';

export async function feedbackUrl(_supabaseUrl: string, secret: string, kind: FeedbackKind, vacancyId: string, email: string): Promise<string> {
  const token = await signFeedbackToken({ v: vacancyId, k: kind, e: email }, secret);
  return `${FEEDBACK_PAGE_URL}?token=${encodeURIComponent(token)}`;
}
