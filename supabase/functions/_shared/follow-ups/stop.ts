// When a follow-up sequence stops, when a company may start one, and the
// two-line script for the second call (Follow-ups slice 2). Pure and
// tested; tick-follow-ups and the follow-ups function apply it.
//
// A sequence stops at once when, after it started:
//   * an outcome of kind spoke_to, meeting_booked, not_interested or
//     replied is logged on the company (the consultant logs "replied" in one
//     click from the strip; inbox reply detection is later);
//   * Resend reports a bounce or a complaint for the contact's address;
//   * the address is on the suppression list for any reason.
// An email the consultant sends outside the sequence (kind emailed) does
// not stop it: they chose to send it, and the one-a-day rule still holds.
//
// The quiet period: a company whose sequence finished or stopped in the
// last eight weeks cannot start another unless a new vacancy or a new fact
// appeared at the company after the sequence ended.

export const STOP_OUTCOME_KINDS: Record<string, string> = {
  spoke_to: 'you spoke to them',
  meeting_booked: 'a meeting is booked',
  not_interested: 'not interested',
  replied: 'they replied',
};

export const QUIET_WEEKS = 8;

export interface OutcomeLike {
  kind: string;
  created_at: string;
  contact_name?: string | null;
}

export interface EmailEventLike {
  event_type: string;
  recipient_email: string;
  occurred_at: string;
}

export interface StopCheckInput {
  startedAt: string;
  contactEmail: string;
  outcomes: OutcomeLike[];
  events: EmailEventLike[];
  /** The suppressed_emails reason for the address, when it is listed. */
  suppressedReason?: string | null;
}

export interface StopDecision {
  reason: string;
  /** What decided it, for the log. */
  because: 'outcome' | 'bounce' | 'complaint' | 'suppressed';
  outcomeKind?: string;
}

/** Why the sequence should stop now, or null to carry on. */
export function stopDecision(input: StopCheckInput): StopDecision | null {
  const since = input.startedAt;
  const addr = input.contactEmail.trim().toLowerCase();
  const hit = [...input.outcomes]
    .filter((o) => o.created_at > since && STOP_OUTCOME_KINDS[o.kind])
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  if (hit) return { reason: STOP_OUTCOME_KINDS[hit.kind], because: 'outcome', outcomeKind: hit.kind };
  const mine = input.events.filter((e) => e.recipient_email.trim().toLowerCase() === addr && e.occurred_at > since);
  if (mine.some((e) => e.event_type === 'complained')) return { reason: 'they marked an email as spam', because: 'complaint' };
  if (mine.some((e) => e.event_type === 'bounced')) return { reason: 'the address bounced', because: 'bounce' };
  if (input.suppressedReason) {
    const why = input.suppressedReason === 'complaint' ? 'they marked an earlier email as spam' : input.suppressedReason === 'bounce' ? 'the address bounced before' : 'they asked not to be emailed';
    return { reason: why, because: 'suppressed' };
  }
  return null;
}

export interface PreviousSequence {
  status: string;
  ended_at: string | null;
  started_at: string;
}

export interface QuietPeriodInput {
  previous: PreviousSequence[];
  /** The newest open vacancy's first_seen and the newest active fact's first_seen (ISO dates), when there are any. */
  newestVacancySeen?: string | null;
  newestFactSeen?: string | null;
  now: Date;
}

/**
 * The quiet period. Returns the reason a sequence may not start, or null
 * when it may. Something new at the company (a vacancy or a fact first
 * seen after the last sequence ended) lifts it.
 */
export function quietPeriodBlock(input: QuietPeriodInput): string | null {
  const ended = input.previous
    .filter((p) => p.status !== 'active')
    .map((p) => p.ended_at || p.started_at)
    .sort()
    .reverse()[0];
  if (!ended) return null;
  const endedMs = new Date(ended).getTime();
  const weeksAgo = (input.now.getTime() - endedMs) / (7 * 86400000);
  if (weeksAgo >= QUIET_WEEKS) return null;
  const endedDay = ended.slice(0, 10);
  const fresh = [input.newestVacancySeen, input.newestFactSeen].filter((d): d is string => !!d).some((d) => d.slice(0, 10) > endedDay);
  if (fresh) return null;
  const until = new Date(endedMs + QUIET_WEEKS * 7 * 86400000);
  const untilWord = `${until.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][until.getUTCMonth()]}`;
  return `This company's last sequence ended ${Math.max(0, Math.floor(weeksAgo))} week${Math.floor(weeksAgo) === 1 ? '' : 's'} ago. It goes quiet for ${QUIET_WEEKS} weeks (until ${untilWord}) unless a new vacancy or a new fact appears there.`;
}

/** Whether every step has reached an end state, so the sequence is done. */
export function sequenceIsDone(steps: Array<{ status: string }>): boolean {
  return steps.length > 0 && steps.every((s) => ['sent', 'skipped', 'done', 'stopped'].includes(s.status));
}

export interface SentEmailSummary {
  /** ISO instant the email went. */
  sentAt: string;
  subject: string | null;
  hook: string | null;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function dayWord(iso: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'numeric' }).formatToParts(d);
  const dd = Number(day.find((p) => p.type === 'day')?.value || d.getUTCDate());
  const mm = Number(day.find((p) => p.type === 'month')?.value || d.getUTCMonth() + 1);
  return `${dd} ${MONTHS[mm - 1]}`;
}

/** "Mrs Patel" from "Mrs Patel", "Sam" from "Sam Jones", "there" when no name. */
export function spokenName(name: string | null | undefined): string {
  const n = (name || '').trim();
  if (!n) return 'there';
  const parts = n.split(/\s+/);
  if (/^(mr|mrs|ms|miss|dr|prof|professor|rev|sir|dame)\.?$/i.test(parts[0]) && parts.length >= 2) return `${parts[0]} ${parts[parts.length - 1]}`;
  return parts[0];
}

/**
 * The two-line script for the day 8 call, built from what was actually
 * sent (no model call): who you are, the emails you sent and what they were
 * about, one question.
 */
export function secondCallScript(contactName: string | null, consultantName: string | null, emails: SentEmailSummary[], companyName?: string | null): string {
  const me = (consultantName || '').trim() || 'the Big Fish Recruitment team';
  const sent = [...emails].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const about = sent.map((e) => (e.hook || e.subject || '').trim()).filter(Boolean);
  const first = `Hello ${spokenName(contactName)}, it's ${me} from Big Fish Recruitment.`;
  let second: string;
  if (sent.length === 0) {
    second = `I rang last week${companyName ? ` about ${companyName}` : ''} and have not managed to catch you. Is now a bad time, or could I have two minutes?`;
  } else if (sent.length === 1) {
    second = `I emailed you on ${dayWord(sent[0].sentAt)}${about[0] ? ` about ${about[0]}` : ''}. Did that land with you, and is it worth two minutes now?`;
  } else {
    second = `I emailed on ${dayWord(sent[0].sentAt)}${about[0] ? ` about ${about[0]}` : ''} and again on ${dayWord(sent[sent.length - 1].sentAt)}${about[about.length - 1] && about[about.length - 1] !== about[0] ? ` about ${about[about.length - 1]}` : ''}. Did either land with you, and is it worth two minutes now?`;
  }
  return `${first}\n${second}`;
}
