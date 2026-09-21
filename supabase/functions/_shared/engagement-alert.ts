// "Tell me when they open or click" (Craig, 18 September 2026): when a
// contact first opens, and when they first click, an email a consultant
// sent from TA Searcher (company outreach, a follow-up step, a shortlist
// candidate email), the consultant gets a short alert with a link to the
// company page, where the engagement line and the contact sit.
//
// Pure decisions here; handle-email-events calls them. Rules:
//   * only opened and clicked, and only the first of each per email and
//     recipient (the count of stored events of that type is 1 after the
//     insert), so a contact who opens five times gets the consultant one
//     alert, not five;
//   * never for a test copy (metadata.test), never when the recipient is
//     one of our own addresses, never without a sender to tell;
//   * the alert goes to the address the email was sent from / replies go to
//     (metadata.reply_to), which is the consultant's own address;
//   * app_settings.engagement_alerts = {"enabled": true, "opens": true,
//     "clicks": true, "off_for": ["kim@bigfishrecruitment.co.uk"]} switches it off
//     for everyone, for one kind, or for one person, without a deploy.
//
// Honest limit, as everywhere: Outlook and Apple Mail often block or
// pre-fetch the tracking image, so an open alert is reliable when it comes
// and its absence means nothing; a click alert is reliable.

export interface EngagementSettings {
  enabled: boolean;
  opens: boolean;
  clicks: boolean;
  offFor: string[];
}

export const DEFAULT_ENGAGEMENT_SETTINGS: EngagementSettings = { enabled: true, opens: true, clicks: true, offFor: [] };

export function engagementSettingsFrom(value: unknown): EngagementSettings {
  const o = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const offFor = Array.isArray(o.off_for) ? o.off_for.filter((x): x is string => typeof x === 'string').map((x) => x.trim().toLowerCase()).filter(Boolean) : [];
  return { enabled: bool(o.enabled, true), opens: bool(o.opens, true), clicks: bool(o.clicks, true), offFor };
}

/** Our own domains: an open by one of us (a test copy, a forwarded look) is not news. */
export const OWN_DOMAINS = ['bigfishrecruitment.co.uk', 'notify.bigfishrecruitment.co.uk', 'whofoundwho.co.uk'];

export interface EngagementAlert {
  to: string;
  data: {
    action: 'opened' | 'clicked';
    contactName: string;
    contactEmail: string;
    companyName: string;
    companyUrl: string | null;
    subject: string | null;
    url: string | null;
    when: string;
    kind: string;
  };
}

export interface DecideInput {
  type: string;
  recipient: string;
  url: string | null;
  occurredAt: string;
  /** How many events of this type are stored for this message and recipient, counting the one just written. */
  countAfterInsert: number;
  metadata: unknown;
  settings: EngagementSettings;
  appBaseUrl: string;
}

/** The alert to send, or null with the reason it is not sent. */
export function decideEngagementAlert(input: DecideInput): { alert: EngagementAlert | null; reason: string } {
  const { type, settings } = input;
  if (type !== 'opened' && type !== 'clicked') return { alert: null, reason: 'not an open or a click' };
  if (!settings.enabled) return { alert: null, reason: 'engagement alerts are off' };
  if (type === 'opened' && !settings.opens) return { alert: null, reason: 'open alerts are off' };
  if (type === 'clicked' && !settings.clicks) return { alert: null, reason: 'click alerts are off' };
  if (input.countAfterInsert !== 1) return { alert: null, reason: `not the first ${type} (${input.countAfterInsert} stored)` };
  const m = input.metadata && typeof input.metadata === 'object' ? (input.metadata as Record<string, unknown>) : {};
  if (m.test === true) return { alert: null, reason: 'a test copy' };
  const kind = typeof m.kind === 'string' ? m.kind : '';
  if (!['outreach', 'shortlist', 'follow_up'].includes(kind)) return { alert: null, reason: `kind ${kind || 'unknown'} is not a consultant email` };
  const recipient = input.recipient.trim().toLowerCase();
  const domain = recipient.split('@')[1] || '';
  if (OWN_DOMAINS.includes(domain)) return { alert: null, reason: 'opened by one of our own addresses' };
  const to = (typeof m.reply_to === 'string' ? m.reply_to : '').trim().toLowerCase();
  if (!to || !to.includes('@')) return { alert: null, reason: 'no sender address to tell' };
  if (to === recipient) return { alert: null, reason: 'the sender opened their own email' };
  if (settings.offFor.includes(to)) return { alert: null, reason: `${to} has these alerts off` };
  const companyId = typeof m.company_search_id === 'string' && /^[0-9a-f-]{36}$/i.test(m.company_search_id) ? m.company_search_id : null;
  const contactName = (typeof m.contact_name === 'string' && m.contact_name.trim()) || recipient;
  return {
    alert: {
      to,
      data: {
        action: type,
        contactName: contactName.slice(0, 200),
        contactEmail: recipient,
        companyName: (typeof m.company_name === 'string' && m.company_name.trim()) || 'the company',
        companyUrl: companyId ? `${input.appBaseUrl}/companies/${companyId}#contacts` : null,
        subject: typeof m.subject === 'string' ? m.subject.slice(0, 200) : null,
        url: type === 'clicked' && typeof input.url === 'string' ? input.url.slice(0, 500) : null,
        when: input.occurredAt,
        kind,
      },
    },
    reason: 'first ' + type,
  };
}

/** "Mrs Patel at Hatch End opened your email" / "clicked the link in your email". */
export function engagementSubject(d: EngagementAlert['data']): string {
  const who = `${d.contactName} at ${d.companyName}`;
  return d.action === 'clicked' ? `${who} clicked a link in your email` : `${who} opened your email`;
}
