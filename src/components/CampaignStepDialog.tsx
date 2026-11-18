import { useEffect, useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { callFollowUps } from "@/lib/followUpsData";
import { callCampaigns, type CampaignStepFull } from "@/lib/campaignsData";
import { formatDue } from "@/lib/campaigns";

interface Props {
  campaignId: string;
  step: CampaignStepFull;
  contactName: string;
  companyName: string;
  /** Do approved emails go by themselves on their days in this campaign? (The campaign's option, and not paused.) */
  goesByItself?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after anything is saved or approved so the page can refresh. */
  onChanged: () => void;
}

/**
 * Read, change and approve one later email of a campaign (Craig, 18
 * November 2026). Approving does not send it: it goes out by itself on its
 * day, as you left it. Changing the words takes the approval back until you
 * approve it again.
 */
export function CampaignStepDialog({ campaignId, step, contactName, companyName, goesByItself = true, open, onOpenChange, onChanged }: Props) {
  const [subject, setSubject] = useState(step.subject || "");
  const [body, setBody] = useState(step.body || "");
  const [busy, setBusy] = useState<"save" | "approve" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { if (open) { setSubject(step.subject || ""); setBody(step.body || ""); setProblem(null); } }, [open, step.id, step.subject, step.body]);

  const changed = subject !== (step.subject || "") || body !== (step.body || "");
  const run = async (approve: boolean) => {
    setBusy(approve ? "approve" : "save"); setProblem(null);
    try {
      if (changed || !approve) {
        const saved = await callFollowUps({ action: "save_draft", stepId: step.id, subject, body });
        if (saved.status >= 400) { setProblem(saved.data.error || `HTTP ${saved.status}`); return; }
      }
      if (approve) {
        const r = await callCampaigns({ action: "approve_step", campaignId, stepId: step.id });
        if (r.status >= 400) { setProblem(r.data.error || `HTTP ${r.status}`); return; }
      }
      onChanged();
      onOpenChange(false);
    } catch (e) { setProblem(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-primary" aria-hidden="true" />{step.label || "Email"} to {contactName}</DialogTitle>
          <DialogDescription>
            {companyName}. Due {formatDue(step.due_at)}. Read it, change anything you like, then approve it. It does not go now. {goesByItself ? "It goes out by itself on its day, exactly as you leave it." : "Approved emails are not going by themselves in this campaign, so you send it yourself on its day."} Nothing unapproved ever goes by itself.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {(step.draft_flags || []).length > 0 && <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-foreground" role="note">Check before approving: {(step.draft_flags || []).join("; ")}</p>}
          <div><Label htmlFor="cs-subject">Subject</Label><Input id="cs-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} /></div>
          <div><Label htmlFor="cs-body">Email</Label><Textarea id="cs-body" value={body} onChange={(e) => setBody(e.target.value)} rows={12} maxLength={8000} /></div>
          {problem && <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-foreground" role="alert">{problem}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void run(true)} disabled={busy !== null || !subject.trim() || !body.trim()} className="gap-2">{busy === "approve" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Approve for {formatDue(step.due_at)}</Button>
            {changed && <Button type="button" size="sm" variant="outline" onClick={() => void run(false)} disabled={busy !== null}>Save without approving</Button>}
            <Button type="button" size="sm" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
