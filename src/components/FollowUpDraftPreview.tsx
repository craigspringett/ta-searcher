import type { FollowUpStep } from "@/lib/followUps";
import { wordCount } from "@/lib/followUps";

/**
 * The draft of a follow-up email as plain text (subject, what it is about,
 * the checks it did not pass, the body), for a quick read before Approve
 * and send (6 October 2026, the Follow-ups due today card and the
 * Follow-ups page).
 */
export function FollowUpDraftPreview({ step }: { step: FollowUpStep }) {
  if (!step.body) return <p className="text-xs text-muted-foreground">No draft written yet.</p>;
  return (
    <div className="w-full rounded-md border border-border bg-muted/30 p-3 text-xs">
      <p className="font-medium text-foreground">{step.subject || "(no subject)"}</p>
      <p className="text-muted-foreground">{wordCount(step.body)} words{step.hook ? `, about ${step.hook}` : ""}{step.edited_at ? ` · edited by ${step.edited_by_name || "you"}` : ""}</p>
      {(step.draft_flags || []).length > 0 && <p className="mt-1 rounded bg-warning/10 px-2 py-1 text-foreground/90">Check before sending: {step.draft_flags.join("; ")}.</p>}
      <p className="mt-2 whitespace-pre-wrap text-foreground/90">{step.body}</p>
    </div>
  );
}
