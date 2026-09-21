import { engagementLine, type EmailEvent, type EmailedOutcome } from "@/lib/emailEvents";

/**
 * The line under a contact on the company page (Follow-ups slice 1):
 * "Emailed 16 Sep. Opened twice, last 09:12 today. Clicked the vacancy
 * link." Nothing when the contact has never been emailed through TA Searcher.
 */
export function ContactEngagement({ email, events, emailed }: { email: string; events: EmailEvent[]; emailed: EmailedOutcome[] }) {
  const line = engagementLine(email, events, emailed);
  if (!line) return null;
  const warm = /Opened|Clicked/.test(line);
  return (
    <p className={`mt-1 text-xs ${warm ? "text-positive" : "text-muted-foreground"}`} title="From Resend's open and click events. An open is reliable; a missing open is not (some mail apps hide them). Clicks are reliable.">
      {line}
    </p>
  );
}
