/**
 * What Resend told us about the emails a consultant sent (Follow-ups slice
 * 1): the engagement line under a contact on the company page and the "Warm
 * right now" strip on My patch. Pure; the reads are in emailEventsData.ts.
 *
 * Honest limits (docs/FOLLOW-UPS-BRIEF.md): opens are undercounted because
 * Outlook and Apple Mail often block or pre-fetch the tracking image, so an
 * "opened" is reliable and a "not opened" is not. Clicks are reliable.
 */

export type EmailEventType = "sent" | "delivered" | "delivery_delayed" | "opened" | "clicked" | "bounced" | "complained";

export interface EmailEvent {
  event_type: string;
  recipient_email: string;
  occurred_at: string;
  url: string | null;
  company_search_id: string | null;
  contact_name: string | null;
  message_id: string | null;
}

/** An "emailed" outcome, for the date when the sent event has not arrived (or the webhook is not on yet). */
export interface EmailedOutcome {
  created_at: string;
  contact_name: string | null;
  contact_email: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "16 Sep", in the reader's local time (a fixed list, because ICU writes "Sept" for en-GB). */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "today", "yesterday", or "16 Sep", in the reader's local time. */
export function dayWord(iso: string, now: Date): string {
  const d = new Date(iso);
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return "today";
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, yesterday)) return "yesterday";
  return shortDate(iso);
}

export function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function times(n: number): string {
  return n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;
}

/** What a clicked link was, in plain words. */
export function linkWord(url: string | null): string {
  const u = (url || "").toLowerCase();
  if (!u) return "a link";
  if (/ashbyhq|greenhouse\.io|lever\.co|workable|\/careers?\b|\/jobs?\b|vacanc/.test(u)) return "the careers link";
  if (/bigfishrecruitment\.co\.uk|ta-searcher/.test(u)) return "the Big Fish Recruitment link";
  if (/gov\.uk|company-information/.test(u)) return "the register link";
  if (/calendly|calendar|meeting|book/.test(u)) return "the booking link";
  return "a link";
}

const byTimeDesc = (a: { occurred_at: string }, b: { occurred_at: string }) => b.occurred_at.localeCompare(a.occurred_at);

/**
 * The line under a contact: "Emailed 16 Sep. Opened twice, last 09:12
 * today. Clicked the vacancy link." Null when the contact has never been
 * emailed through TA Searcher. Only the latest email counts for opens and
 * clicks (events since the latest sent), so an old open never reads as new.
 */
export function engagementLine(email: string, events: EmailEvent[], emailed: EmailedOutcome[], now: Date = new Date()): string | null {
  const addr = email.trim().toLowerCase();
  const mine = events.filter((e) => e.recipient_email.toLowerCase() === addr).sort(byTimeDesc);
  const sentAt = mine.find((e) => e.event_type === "sent")?.occurred_at ?? null;
  const outcomeAt = emailed.filter((o) => (o.contact_email || "").toLowerCase() === addr).map((o) => o.created_at).sort().reverse()[0] ?? null;
  const emailedAt = sentAt && outcomeAt ? (sentAt > outcomeAt ? sentAt : outcomeAt) : sentAt || outcomeAt;
  if (!emailedAt && mine.length === 0) return null;

  // Events for the latest email only: everything at or after the latest
  // send, with a minute's grace because Resend's "sent" can lag the queue.
  const cutoff = sentAt ? new Date(new Date(sentAt).getTime() - 60_000).toISOString() : null;
  const recent = cutoff ? mine.filter((e) => e.occurred_at >= cutoff) : mine;
  const parts: string[] = [];
  // The send is always dated ("Emailed 16 Sep"), with the time when it was today.
  if (emailedAt) parts.push(`Emailed ${shortDate(emailedAt)}${dayWord(emailedAt, now) === "today" ? ` ${timeOfDay(emailedAt)}` : ""}.`);

  if (recent.some((e) => e.event_type === "bounced")) { parts.push("Bounced: the address does not work."); return parts.join(" "); }
  if (recent.some((e) => e.event_type === "complained")) { parts.push("Marked as spam; do not email again."); return parts.join(" "); }

  const opens = recent.filter((e) => e.event_type === "opened");
  const clicks = recent.filter((e) => e.event_type === "clicked");
  if (opens.length) parts.push(`Opened ${times(opens.length)}, last ${timeOfDay(opens[0].occurred_at)} ${dayWord(opens[0].occurred_at, now)}.`);
  if (clicks.length) {
    const links = [...new Set(clicks.map((c) => linkWord(c.url)))];
    parts.push(`Clicked ${links.length === 1 ? links[0] : `${clicks.length} links`}${clicks.length > 1 && links.length === 1 ? ` ${times(clicks.length)}` : ""}.`);
  }
  if (!opens.length && !clicks.length) {
    if (recent.some((e) => e.event_type === "delivered")) parts.push("Delivered, not opened yet (or opened in a mail app that hides it).");
    else if (recent.some((e) => e.event_type === "delivery_delayed")) parts.push("Delivery delayed; their mail server is slow to accept it.");
  }
  return parts.join(" ");
}

export interface WarmCompany {
  companyId: string;
  /** When the latest open or click happened. */
  lastAt: string;
  lastKind: "opened" | "clicked";
  contactName: string | null;
  opens: number;
  clicks: number;
  /** The link, when the latest event was a click. */
  url: string | null;
}

/**
 * "Warm right now": companies with an open or click in the window (24 hours)
 * and no outcome logged since, newest first. `lastOutcomeAt` is the latest
 * outcome per company (My patch already has it), so an "emailed" outcome
 * logged at send time never hides the open that follows it.
 */
export function warmCompanies(events: EmailEvent[], lastOutcomeAt: Map<string, string>, now: Date = new Date(), windowHours = 24): WarmCompany[] {
  const since = new Date(now.getTime() - windowHours * 3600_000).toISOString();
  const byCompany = new Map<string, WarmCompany>();
  for (const e of [...events].sort(byTimeDesc)) {
    if (!e.company_search_id || e.occurred_at < since || e.occurred_at > new Date(now.getTime() + 60_000).toISOString()) continue;
    if (e.event_type !== "opened" && e.event_type !== "clicked") continue;
    const cur = byCompany.get(e.company_search_id) || { companyId: e.company_search_id, lastAt: e.occurred_at, lastKind: e.event_type, contactName: e.contact_name, opens: 0, clicks: 0, url: e.event_type === "clicked" ? e.url : null };
    if (e.event_type === "opened") cur.opens++; else cur.clicks++;
    byCompany.set(e.company_search_id, cur);
  }
  return [...byCompany.values()]
    .filter((w) => { const o = lastOutcomeAt.get(w.companyId); return !o || o < w.lastAt; })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

/** "Opened twice, last 09:12 today" / "Clicked the vacancy link 08:40 today" for the strip. */
export function warmLine(w: WarmCompany, now: Date = new Date()): string {
  const when = `${timeOfDay(w.lastAt)} ${dayWord(w.lastAt, now)}`;
  if (w.lastKind === "clicked") return `Clicked ${linkWord(w.url)} ${when}${w.opens ? `, opened ${times(w.opens)}` : ""}`;
  return `Opened ${times(w.opens)}, last ${when}${w.clicks ? `, clicked ${times(w.clicks)}` : ""}`;
}
