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
