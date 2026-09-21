// Who an email may be sent "from" (Follow-ups slice 1, 17 September 2026).
//
// Every email leaves through Resend from notify.bigfishrecruitment.co.uk, a
// sub-domain with no mailbox. Craig has agreed that outreach emails go out
// in the consultant's own name from their own address
// (anja@bigfishrecruitment.co.uk), which Resend can only do once that domain is
// verified. The allow-list is app_settings.sending_domains, a JSON array of
// domains (default ["notify.bigfishrecruitment.co.uk"]); bigfishrecruitment.co.uk is
// added by the apply script once Resend reports it verified.
//
// resolveFrom() is the one rule: a requested sender whose domain is on the
// list is used as given; otherwise the display name is kept and the
// address falls back to the default sender, so the company still sees the
// consultant's name and a reply (reply_to) still reaches them.

export interface Sender {
  /** Display name, e.g. "Anja Micic". */
  name: string;
  /** Address, e.g. "anja@bigfishrecruitment.co.uk". */
  email: string;
}

export interface ResolvedFrom {
  /** The RFC 5322 mailbox to send with, e.g. `Anja Micic <anja@bigfishrecruitment.co.uk>`. */
  from: string;
  /** The domain the message is sent from. */
  domain: string;
  /** True when the requested address was used as given. */
  applied: boolean;
  /** Why the requested address was not used, when it was not. */
  reason?: string;
}

export const DEFAULT_SENDING_DOMAINS = ['notify.bigfishrecruitment.co.uk'];

const ADDRESS = /^[^\s@<>"]+@([^\s@<>"]+\.[^\s@<>"]+)$/;

export function domainOf(email: string): string | null {
  const m = ADDRESS.exec((email || '').trim());
  return m ? m[1].toLowerCase() : null;
}

/** Parse app_settings.sending_domains: an array of domain strings, lower-cased; anything else is the default. */
export function parseSendingDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_SENDING_DOMAINS];
  const out = value.map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : '')).filter((v) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(v));
  return out.length ? [...new Set(out)] : [...DEFAULT_SENDING_DOMAINS];
}

/** A display name safe inside a mailbox: quotes and angle brackets removed, at most 80 characters. */
export function cleanDisplayName(name: string): string {
  return (name || '').replace(/[<>"\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function formatMailbox(name: string, email: string): string {
  const n = cleanDisplayName(name);
  return n ? `${n} <${email}>` : email;
}

/**
 * Decide the From mailbox.
 *   requested   what the caller asked for (the consultant), or null for the default
 *   allowed     the allow-list (app_settings.sending_domains)
 *   fallback    the default sender: name and address on the default domain
 */
export function resolveFrom(requested: Sender | null | undefined, allowed: string[], fallback: Sender): ResolvedFrom {
  const fallbackDomain = domainOf(fallback.email) || '';
  if (!requested || !requested.email) {
    return { from: formatMailbox(fallback.name, fallback.email), domain: fallbackDomain, applied: false, reason: 'no sender requested' };
  }
  const email = requested.email.trim().toLowerCase();
  const domain = domainOf(email);
  const name = cleanDisplayName(requested.name) || fallback.name;
  if (!domain) {
    return { from: formatMailbox(name, fallback.email), domain: fallbackDomain, applied: false, reason: `not an address: ${requested.email.slice(0, 60)}` };
  }
  if (!allowed.map((d) => d.toLowerCase()).includes(domain)) {
    return { from: formatMailbox(name, fallback.email), domain: fallbackDomain, applied: false, reason: `${domain} is not a verified sending domain` };
  }
  return { from: formatMailbox(name, email), domain, applied: true };
}

/** Read the allow-list from app_settings; the default when the row is missing or unreadable. */
// deno-lint-ignore no-explicit-any
export async function loadSendingDomains(supabase: any): Promise<string[]> {
  try {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'sending_domains').maybeSingle();
    if (error) return [...DEFAULT_SENDING_DOMAINS];
    return parseSendingDomains(data?.value);
  } catch {
    return [...DEFAULT_SENDING_DOMAINS];
  }
}
