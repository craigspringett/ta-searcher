// Resend webhook events, parsed (Follow-ups slice 1, 17 September 2026).
//
// Resend posts one JSON body per event
// (https://resend.com/docs/dashboard/webhooks/event-types):
//   { type: "email.opened", created_at, data: { email_id, to: [..], tags, click?: { link, timestamp } } }
// `tags` arrives as an object ({ message_id: "..." }) or, on older
// payloads, an array of { name, value }; both are read. Our message id is
// the tag `message_id` that _shared/email.ts sets on every send, which is
// how an event is tied back to email_send_log and, through its metadata,
// to the company, the consultant and the contact.
//
// parseResendEvent() is pure and tested; handle-email-events does the
// writes. handle-email-suppression (bounces and complaints) is unchanged
// and still works on its own if the webhook is left pointing at it.

export type EmailEventType = 'sent' | 'delivered' | 'delivery_delayed' | 'opened' | 'clicked' | 'bounced' | 'complained';

const TYPES: Record<string, EmailEventType> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delivery_delayed',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
};

export interface ParsedEmailEvent {
  type: EmailEventType;
  /** Resend's id for the email. */
  emailId: string | null;
  /** Our message id from the tags, when present. */
  messageId: string | null;
  recipients: string[];
  /** The link, for clicks. */
  url: string | null;
  /** When it happened (the click's own timestamp, else the event's created_at, else now). */
  occurredAt: string;
  /** "Permanent" / "Transient" / "Undetermined" for bounces. */
  bounceType: string | null;
  /** Everything Resend sent, for the record. */
  raw: unknown;
}

export class IgnoredEvent extends Error {}

function readMessageId(tags: unknown): string | null {
  if (Array.isArray(tags)) {
    const t = tags.find((x) => x && typeof x === 'object' && (x as { name?: unknown }).name === 'message_id') as { value?: unknown } | undefined;
    return typeof t?.value === 'string' && t.value ? t.value : null;
  }
  if (tags && typeof tags === 'object') {
    const v = (tags as Record<string, unknown>).message_id;
    return typeof v === 'string' && v ? v : null;
  }
  return null;
}

function isoOrNull(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Parse one webhook body. Throws IgnoredEvent for a type we do not store, Error for a malformed body. */
export function parseResendEvent(body: string, now: Date = new Date()): ParsedEmailEvent {
  const parsed = JSON.parse(body);
  const typeName: string = typeof parsed?.type === 'string' ? parsed.type : '';
  const type = TYPES[typeName];
  if (!type) throw new IgnoredEvent(typeName || 'unknown');
  const data = parsed?.data && typeof parsed.data === 'object' ? parsed.data : {};
  const recipients: string[] = (Array.isArray(data.to) ? data.to : data.to ? [data.to] : [])
    .map((x: unknown) => String(x).trim().toLowerCase())
    .filter((x: string) => x.includes('@'));
  if (recipients.length === 0) throw new Error('Missing recipient in payload');
  const click = data.click && typeof data.click === 'object' ? data.click : null;
  const url = click && typeof click.link === 'string' && click.link ? click.link.slice(0, 2000) : null;
  const occurredAt = (click ? isoOrNull(click.timestamp) : null) || isoOrNull(parsed.created_at) || isoOrNull(data.created_at) || now.toISOString();
  return {
    type,
    emailId: typeof data.email_id === 'string' && data.email_id ? data.email_id : null,
    messageId: readMessageId(data.tags),
    recipients,
    url,
    occurredAt,
    bounceType: data.bounce && typeof data.bounce === 'object' && typeof data.bounce.type === 'string' ? data.bounce.type : null,
    raw: parsed,
  };
}

/** One key per Resend event so a retried webhook does not count twice. */
export function dedupeKey(e: ParsedEmailEvent, recipient: string): string {
  return [e.type, e.emailId || e.messageId || 'no-id', recipient, e.occurredAt, e.url || ''].join('|');
}

/** A bounce suppresses only when Resend calls it permanent (or does not say); a complaint always does. */
export function shouldSuppress(e: ParsedEmailEvent): boolean {
  if (e.type === 'complained') return true;
  if (e.type === 'bounced') return !e.bounceType || e.bounceType === 'Permanent';
  return false;
}

/** The send-log metadata an outreach email carries, as far as an event needs it. */
export interface OutreachLink {
  company_search_id: string | null;
  consultant_id: string | null;
  contact_name: string | null;
}

export function linkFromMetadata(metadata: unknown): OutreachLink {
  const m = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {};
  const uuid = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
  return {
    company_search_id: uuid(m.company_search_id),
    consultant_id: uuid(m.consultant_id),
    contact_name: typeof m.contact_name === 'string' && m.contact_name ? m.contact_name.slice(0, 200) : null,
  };
}

/** An open or click this soon after delivery is a mail security scan or an image proxy, not a person (Craig, 20 October 2026). Same limits as src/lib/emailEvents.ts. */
export const AUTOMATIC_OPEN_SECONDS = 60;
export const AUTOMATIC_CLICK_SECONDS = 120;

export function isAutomaticEngagement(type: string, occurredAt: string, deliveredAt: string | null | undefined): boolean {
  if ((type !== 'opened' && type !== 'clicked') || !deliveredAt) return false;
  const secs = (Date.parse(occurredAt) - Date.parse(deliveredAt)) / 1000;
  if (!Number.isFinite(secs) || secs < 0) return false;
  return secs <= (type === 'opened' ? AUTOMATIC_OPEN_SECONDS : AUTOMATIC_CLICK_SECONDS);
}

/** The address that opened or clicked, from Resend's payload. */
export function engagementIp(raw: unknown): string | null {
  const d = (raw && typeof raw === 'object' ? (raw as { data?: Record<string, unknown> }).data : null) || {};
  for (const k of ['open', 'click']) {
    const o = d[k];
    if (o && typeof o === 'object' && typeof (o as { ipAddress?: unknown }).ipAddress === 'string') return String((o as { ipAddress: string }).ipAddress);
  }
  return null;
}

// Networks no person reads email from: clouds, hosting, CDNs and privacy relays that load pictures and follow links for a scanner or a mail app.
const HOSTING_ASN = /^AS(?:16509|14618|396982|16276|14061|24940|63949|54113|13335|20940|31898|45102|20473|12876|8100|36351|46606|19551)\b/;
const MICROSOFT_ASN = /^AS8075\b/;
export const MICROSOFT_SCAN_SECONDS = 300;

export interface EngagementVerdict { automatic: boolean; reason: string | null }

/**
 * Is this open or click a machine? (a) seconds after delivery, (b) from a cloud, hosting or relay network at
 * any time, (c) from Microsoft's network within five minutes of delivery (Defender and Safe Links scan on
 * arrival; a person on Outlook on the web later also shows a Microsoft address, so later ones still count).
 * `ipOrg` is the owner line from an address lookup ("AS8075 Microsoft Corporation"); null when unknown.
 */
export function classifyEngagement(type: string, occurredAt: string, deliveredAt: string | null | undefined, ipOrg: string | null | undefined): EngagementVerdict {
  if (type !== 'opened' && type !== 'clicked') return { automatic: false, reason: null };
  if (isAutomaticEngagement(type, occurredAt, deliveredAt)) return { automatic: true, reason: 'seconds after delivery: a mail security scan' };
  const org = (ipOrg || '').trim();
  if (org && HOSTING_ASN.test(org)) return { automatic: true, reason: `from a cloud or relay network (${org.slice(0, 60)}), not a person` };
  if (org && MICROSOFT_ASN.test(org) && deliveredAt) {
    const secs = (Date.parse(occurredAt) - Date.parse(deliveredAt)) / 1000;
    if (Number.isFinite(secs) && secs >= 0 && secs <= MICROSOFT_SCAN_SECONDS) return { automatic: true, reason: 'Microsoft link scanning within minutes of delivery' };
  }
  return { automatic: false, reason: null };
}

/** Who owns an address ("AS8075 Microsoft Corporation"), or null. Free lookup, three seconds, never throws. */
export async function lookupIpOrg(ip: string | null, fetcher: typeof fetch = fetch): Promise<string | null> {
  if (!ip || !/^[0-9a-f:.]{3,45}$/i.test(ip)) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3000);
    const res = await fetcher(`https://ipinfo.io/${encodeURIComponent(ip)}/json`, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json() as { org?: unknown };
    return typeof j.org === 'string' ? j.org.slice(0, 120) : null;
  } catch {
    return null;
  }
}
