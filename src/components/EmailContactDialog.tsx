import { useEffect, useState } from "react";
import { Check, Copy, Loader2, Mail, Send } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { clipboardText, greeting, rememberPhone, rememberedPhone, type OutreachReply } from "@/lib/outreach";
import { callFollowUps } from "@/lib/followUpsData";
import { supabase } from "@/integrations/supabase/client";
import { FIRM_NAME } from "@/lib/brand";
import { callOutreach } from "@/lib/outreachData";
import { companyEmailEventsKey } from "@/lib/emailEventsData";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  companyId: string;
  companyName: string;
  contact: { name: string; role?: string | null; email: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a send so the page can refresh the call history. */
  onSent?: () => void;
  /** Follow-ups slice 2: the draft to start from, and the step this send approves. */
  initial?: { subject: string; body: string } | null;
  sequenceStepId?: string | null;
  /** "Second email, tied to something real", for the title. */
  stepLabel?: string | null;
  /** When the step is due, as words ("Monday 21 Sep 12:00"), for a draft opened before its day: sending now is allowed and the later steps keep their dates. */
  scheduledFor?: string | null;
  /** Checks the draft did not pass, shown above it. */
  draftFlags?: string[];
}

/**
 * "Email this contact" (Follow-ups slice 1): the consultant writes or
 * pastes the email, previews it as the company will see it, and sends it
 * in their own name. The function applies the rules (no daily supply, no
 * fee figure, one a day, never a suppressed address) and this dialog shows
 * its answer in the function's own words.
 */
export function EmailContactDialog({ companyId, companyName, contact, open, onOpenChange, onSent, initial, sequenceStepId, stepLabel, draftFlags, scheduledFor }: Props) {
  const { profile, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [phone, setPhone] = useState(rememberedPhone());
  const [preview, setPreview] = useState<OutreachReply | null>(null);
  const [problem, setProblem] = useState<OutreachReply | null>(null);
  const [busy, setBusy] = useState<"preview" | "send" | "outlook" | null>(null);
  const [done, setDone] = useState<OutreachReply | null>(null);
  const [copied, setCopied] = useState(false);

  // A fresh draft each time the dialog opens for a contact (or the
  // sequence's draft, when this send approves a follow-up step).
  useEffect(() => {
    if (!open) return;
    setSubject(initial?.subject ?? "");
    setBody(initial?.body ?? `${greeting(contact.name)}\n\n\n\nBest wishes,`);
    setPreview(null);
    setProblem(null);
    setDone(null);
    setBusy(null);
    setCopied(false);
  }, [open, contact.email, contact.name, initial?.subject, initial?.body, sequenceStepId]);

  const request = (extra: { dryRun?: boolean; sendAnyway?: boolean }) => ({
    companySearchId: companyId,
    contactName: contact.name,
    contactRole: contact.role || null,
    contactEmail: contact.email,
    subject,
    body,
    phone,
    ...(sequenceStepId ? { sequenceStepId } : {}),
    ...extra,
  });

  const runPreview = async () => {
    setBusy("preview");
    setProblem(null);
    try {
      const { status, data } = await callOutreach(request({ dryRun: true }));
      if (status >= 400) setProblem(data);
      else setPreview(data);
    } catch (e) {
      setProblem({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const send = async (sendAnyway = false) => {
    setBusy("send");
    setProblem(null);
    rememberPhone(phone);
    try {
      const { status, data } = await callOutreach(request({ sendAnyway }));
      if (status >= 400) { setProblem(data); return; }
      setDone(data);
      toast({ title: sequenceStepId ? "Approved and sent" : "Email sent", description: data.message });
      void queryClient.invalidateQueries({ queryKey: companyEmailEventsKey(companyId) });
      void queryClient.invalidateQueries({ queryKey: ["patch"] });
      void queryClient.invalidateQueries({ queryKey: ["follow-ups"] });
      void queryClient.invalidateQueries({ queryKey: ["follow-ups-active"] });
      onSent?.();
    } catch (e) {
      setProblem({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  // The Outlook path: copy the email, send it from Outlook, tick it as sent.
  // The step (or the company's Calls history) records it as emailed; opens
  // and clicks are not tracked for it.
  const copyForOutlook = async () => {
    rememberPhone(phone);
    const text = clipboardText(subject, body, { name: profile?.display_name || profile?.email || "", firm: FIRM_NAME, phone });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ title: "Copied", description: "Paste it into a new Outlook email to " + contact.email + ", send it, then press \"I have sent this from Outlook\"." });
    } catch {
      toast({ title: "Could not copy", description: "Select the text and copy it by hand.", variant: "destructive" });
    }
  };

  const markSentFromOutlook = async () => {
    setBusy("outlook");
    setProblem(null);
    try {
      if (sequenceStepId) {
        const { status, data } = await callFollowUps({ action: "mark_sent", stepId: sequenceStepId, subject, body });
        if (status >= 400) { setProblem({ error: data.error || `HTTP ${status}` }); return; }
        setDone({ message: data.message || "Marked as sent from Outlook." });
      } else {
        if (!user) { setProblem({ error: "You are signed out. Sign in again." }); return; }
        const { error } = await supabase.from("outcomes").insert({
          company_search_id: companyId,
          consultant_id: profile?.consultant_id ?? null,
          created_by: user.id,
          contact_name: contact.name,
          contact_role: contact.role || null,
          kind: "emailed",
          note: `Sent from Outlook: ${subject.trim()}`,
        });
        if (error) { setProblem({ error: error.message }); return; }
        setDone({ message: `Logged as emailed from Outlook to ${contact.name}.` });
      }
      toast({ title: "Marked as sent", description: "Logged on the company's Calls." });
      void queryClient.invalidateQueries({ queryKey: ["patch"] });
      void queryClient.invalidateQueries({ queryKey: ["follow-ups"] });
      void queryClient.invalidateQueries({ queryKey: ["follow-ups-active"] });
      void queryClient.invalidateQueries({ queryKey: ["follow-ups-all"] });
      onSent?.();
    } catch (e) {
      setProblem({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const signedAs = profile?.display_name || profile?.email || "you";
  const canSend = subject.trim().length > 0 && body.trim().length > 0 && !busy && !done;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail className="h-5 w-5 text-primary" aria-hidden="true" />{sequenceStepId ? `Approve and send: ${stepLabel || "follow-up email"}` : `Email ${contact.name}`}</DialogTitle>
          <DialogDescription>
            To {contact.email}{contact.role ? ` (${contact.role})` : ""} at {companyName}. Sent as {signedAs}; replies come to your inbox. Long-term, permanent and planned cover only; never a margin or fee figure; one email per contact per day.{sequenceStepId ? " This is TA Searcher's draft: change anything you like, then approve it. Nothing goes until you do." : ""} Or press Copy for Outlook, send it from your own inbox, and tick it as sent here.{sequenceStepId && scheduledFor ? ` It is scheduled for ${scheduledFor}; press Approve and send to send it now instead, and the later steps keep their dates.` : ""}
          </DialogDescription>
        </DialogHeader>
        {!done && sequenceStepId && (draftFlags || []).length > 0 && (
          <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm" role="note">
            <p className="font-medium text-foreground">Check before sending</p>
            {draftFlags!.map((f, i) => <p key={i} className="text-foreground/90">{f}</p>)}
          </div>
        )}

        {done ? (
          <div className="space-y-3">
            <p className="text-sm text-foreground">{done.message}</p>
            {done.fromApplied === false && done.fromReason && <p className="text-xs text-muted-foreground">Why not your own address: {done.fromReason}.</p>}
            <p className="text-xs text-muted-foreground">Logged as "Emailed" on this company's Calls.{sequenceStepId ? " The follow-up step is marked sent." : ""}{done.html === undefined && !done.from ? " Sent from Outlook, so opens and clicks are not tracked for this one." : " Opens and clicks will show under the contact as they happen."}</p>
            <Button size="sm" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        ) : (
          <div className="grid gap-3">
            <div>
              <Label htmlFor="outreach-subject">Subject</Label>
              <Input id="outreach-subject" value={subject} onChange={(e) => { setSubject(e.target.value); setPreview(null); }} placeholder="The Year 4 post that closes on Friday" maxLength={150} />
            </div>
            <div>
              <Label htmlFor="outreach-body">Email</Label>
              <Textarea id="outreach-body" value={body} onChange={(e) => { setBody(e.target.value); setPreview(null); }} rows={12} placeholder="Write it as you would to one person: what you saw, the one thing you can help with, one line on us, a question." />
              <p className="mt-1 text-xs text-muted-foreground">Plain text; a blank line starts a new paragraph. Your name, Big Fish Recruitment and your phone number are added underneath.</p>
            </div>
            <div className="sm:w-64">
              <Label htmlFor="outreach-phone">Your phone number (for the signature)</Label>
              <Input id="outreach-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xxx xxxxxx" maxLength={40} />
            </div>

            {problem && (
              <div className={`rounded-md border p-3 text-sm ${problem.code === "warnings" ? "border-warning/50 bg-warning/10" : "border-destructive/50 bg-destructive/10"}`} role="alert">
                <p className="font-medium text-foreground">{problem.code === "warnings" ? "Worth a second look" : problem.code === "blocked" ? "This cannot go as written" : "Not sent"}</p>
                {problem.code !== "blocked" && problem.code !== "warnings" && problem.error && <p className="mt-1 text-foreground/90">{problem.error}</p>}
                {(problem.blocked || []).map((b, i) => <p key={`b${i}`} className="mt-1 text-foreground/90">{b}</p>)}
                {(problem.warnings || []).map((w, i) => <p key={`w${i}`} className="mt-1 text-foreground/90">{w}</p>)}
                {problem.code === "warnings" && (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setProblem(null)}>Edit it</Button>
                    <Button size="sm" onClick={() => void send(true)} disabled={!!busy}>Send anyway</Button>
                  </div>
                )}
              </div>
            )}

            {preview?.html && (
              <div className="rounded-md border border-border">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <span>From {preview.from}{preview.fromApplied === false ? " (your own address is not a verified sending domain yet, so it goes as your name on TA Searcher's address)" : ""}</span>
                  <span>Reply to {preview.replyTo}</span>
                </div>
                <div className="px-3 py-1 text-sm font-medium text-foreground">{preview.subject}</div>
                <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-72 w-full bg-white" />
                {(preview.warnings || []).length > 0 && (
                  <div className="border-t border-border bg-warning/10 px-3 py-2 text-xs text-foreground/90">{preview.warnings!.map((w, i) => <p key={i}>{w}</p>)}</div>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void runPreview()} disabled={!subject.trim() || !body.trim() || !!busy} className="gap-2">
                {busy === "preview" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Preview
              </Button>
              <Button type="button" size="sm" onClick={() => void send(false)} disabled={!canSend} className="gap-2">
                {busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}{sequenceStepId ? "Approve and send" : "Send"}
              </Button>
              <span className="mx-1 self-center text-xs text-muted-foreground">or</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void copyForOutlook()} disabled={!subject.trim() || !body.trim() || !!busy} className="gap-2" title="Copies the subject, the email and your signature to paste into Outlook">
                {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}{copied ? "Copied" : "Copy for Outlook"}
              </Button>
              <Button type="button" variant={copied ? "default" : "outline"} size="sm" onClick={() => void markSentFromOutlook()} disabled={!canSend} className="gap-2" title="Tick this once the email has gone from Outlook">
                {busy === "outlook" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}I have sent this from Outlook
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
