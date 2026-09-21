// The rules an outreach email must keep (Follow-ups slice 1, docs/FOLLOW-UPS-BRIEF.md).
//
// The consultant writes the email; TA Searcher checks it before it goes:
//   * never a margin, fee or retainer figure (feeFigureViolations), a
//     hard stop;
//   * the fluff the style guide bans ("reach out", "hope this finds you
//     well"): a warning the consultant sees and may send through;
//   * one send per contact per day: refused with a clear message;
//   * never to a suppressed address: refused.
// Everything here is pure and tested; send-outreach-email applies it.

import { BANNED_PHRASES, feeFigureViolations } from '../copy/checks.ts';

/** The bare words that only ever go with a figure a company must not see in writing. */
const FEE_WORDS = /\b(margins?|fees?|commission|mark-?ups?|retainers?|placement fees?)\b/i;

export interface BodyCheck {
  /** Reasons the email must not go as written. */
  blocked: string[];
  /** Things worth a second look; the consultant may send anyway. */
  warnings: string[];
}

function phraseHits(text: string, phrases: string[]): string[] {
  const t = ` ${(text || '').toLowerCase().replace(/\s+/g, ' ')} `;
  return phrases.filter((p) => t.includes(p.toLowerCase()));
}

/** Check the subject and body together. */
export function checkOutreachText(subject: string, body: string): BodyCheck {
  const all = `${subject || ''}\n${body || ''}`;
  const blocked: string[] = [];
  const warnings: string[] = [];
  const fee = feeFigureViolations(all);
  if (fee.length) blocked.push(`Never put a fee, margin or retainer figure in writing; talk it through on a call instead. Take out: "${fee[0].slice(0, 80)}".`);
  const style = phraseHits(all, BANNED_PHRASES);
  if (style.length) warnings.push(`Plain words read better than ${[...new Set(style)].map((s) => `"${s}"`).join(', ')}.`);
  if (!fee.length && FEE_WORDS.test(all)) warnings.push('This mentions a fee or margin. Keep it to how we work and an offer to talk figures on a call.');
  return { blocked, warnings };
}

/** The day (Europe/London) an instant falls on, for the one-a-day rule. */
export function londonDay(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

/**
 * The one-a-day rule: has this contact already had an outreach email
 * today? `earlier` are the send-log rows for the address that are pending
 * or sent (a failed or suppressed row does not count).
 */
export function alreadyEmailedToday(earlier: Array<{ created_at: string; status: string }>, now: Date = new Date()): boolean {
  const today = londonDay(now);
  return earlier.some((r) => (r.status === 'pending' || r.status === 'sent') && londonDay(r.created_at) === today);
}

const ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export function isAddress(v: unknown): v is string {
  return typeof v === 'string' && ADDRESS.test(v.trim()) && v.trim().length <= 254;
}

export interface OutreachRequest {
  companySearchId: string;
  contactName: string;
  contactRole: string | null;
  contactEmail: string;
  subject: string;
  body: string;
  /** Send despite warnings (never despite a block). */
  sendAnyway: boolean;
  /** Render only; nothing is queued or logged. */
  dryRun: boolean;
}

/** Read and tidy the request body; returns the first problem as a string. */
export function parseOutreachRequest(body: unknown): { ok: OutreachRequest; error: null } | { ok: null; error: string } {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const id = b.companySearchId ?? b.company_search_id;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return { ok: null, error: 'companySearchId (uuid) is required' };
  const email = b.contactEmail ?? b.contact_email;
  if (!isAddress(email)) return { ok: null, error: 'contactEmail must be an email address' };
  const name = b.contactName ?? b.contact_name;
  if (typeof name !== 'string' || !name.trim()) return { ok: null, error: 'contactName is required' };
  const subject = typeof b.subject === 'string' ? b.subject.replace(/[\r\n]+/g, ' ').trim() : '';
  if (!subject) return { ok: null, error: 'subject is required' };
  if (subject.length > 150) return { ok: null, error: 'subject is too long (150 characters at most)' };
  const text = typeof b.body === 'string' ? b.body.replace(/\r\n?/g, '\n').trim() : typeof b.text === 'string' ? b.text.replace(/\r\n?/g, '\n').trim() : '';
  if (!text) return { ok: null, error: 'body is required' };
  if (text.length > 6000) return { ok: null, error: 'body is too long (6,000 characters at most)' };
  const role = b.contactRole ?? b.contact_role;
  return {
    ok: {
      companySearchId: id,
      contactName: name.trim().slice(0, 200),
      contactRole: typeof role === 'string' && role.trim() ? role.trim().slice(0, 120) : null,
      contactEmail: (email as string).trim().toLowerCase(),
      subject,
      body: text,
      sendAnyway: b.sendAnyway === true,
      dryRun: b.dryRun === true,
    },
    error: null,
  };
}
