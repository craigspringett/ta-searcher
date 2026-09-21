import { useState } from "react";
import { CalendarClock, Loader2, Mail, PhoneCall, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { CALL_OUTCOME_CHOICES, hasDraft, isDueNow, isOpen, sequenceLine, STEP_STATUS_LABELS, stepLabel, STOP_CHOICES, whenWord, wordCount, type FollowUpSequence, type FollowUpStep } from "@/lib/followUps";
import { callFollowUps, companyFollowUpsKey, useCompanyFollowUps } from "@/lib/followUpsData";
import { EmailContactDialog } from "@/components/EmailContactDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  companyId: string;
  companyName: string;
  /** Called after an action that logged an outcome, so the Calls history refreshes. */
  onChange?: () => void;
}

/**
 * The Follow-ups panel on the company page (Follow-ups slice 2): the
 * sequence's steps with their dates and status; for a due email the draft
 * with Edit, Approve and send, Skip and Write it again; for a due call the
 * script and Log outcome; a Stop button with a reason. Every action goes
 * through the follow-ups function, which writes the Calls history.
 */
export function FollowUpsCard({ companyId, companyName, onChange }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, error, isLoading } = useCompanyFollowUps(companyId, true);
  const [busy, setBusy] = useState<string | null>(null);
  const [emailStep, setEmailStep] = useState<{ seq: FollowUpSequence; step: FollowUpStep } | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [stopChoice, setStopChoice] = useState("replied");
  const [stopReason, setStopReason] = useState("");
  const [logging, setLogging] = useState<string | null>(null);
  const [logKind, setLogKind] = useState("voicemail");
  const [logNote, setLogNote] = useState("");
  const [logCallback, setLogCallback] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: companyFollowUpsKey(companyId) });
    void queryClient.invalidateQueries({ queryKey: ["follow-ups-active"] });
    void queryClient.invalidateQueries({ queryKey: ["patch"] });
    onChange?.();
  };

  const act = async (key: string, body: Record<string, unknown>, okTitle: string) => {
    setBusy(key);
    try {
      const { status, data: reply } = await callFollowUps(body);
      if (status >= 400) { toast({ title: "Not done", description: reply.error || `HTTP ${status}`, variant: "destructive" }); return false; }
      toast({ title: okTitle, description: reply.message });
      refresh();
      return true;
    } catch (e) {
      toast({ title: "Not done", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const sequences = data || [];
  const active = sequences.find((s) => s.status === "active") || null;
  const latest = active || sequences[0] || null;
  if (!isLoading && !error && !latest) return null;

  const now = new Date();
  return (
    <Card className="p-6" id="follow-ups">
      <h3 className="text-lg font-bold text-foreground mb-1 flex items-center gap-2"><CalendarClock className="h-5 w-5 text-primary" aria-hidden="true" />Follow-ups</h3>
      {isLoading && <p className="text-xs text-muted-foreground" role="status">Loading…</p>}
      {error && <p className="text-sm text-destructive" role="alert">Could not load: {(error as Error).message}</p>}
      {latest && (
        <>
          <p className="text-sm text-foreground">{sequenceLine(latest, now)}</p>
          <p className="text-xs text-muted-foreground mb-3">
            {latest.contact_email}{latest.contact_role ? `, ${latest.contact_role}` : ""}. Started {whenWord(latest.started_at, now).replace(" (overdue)", "")}. Emails go only when you press Approve and send; a reply, a "spoke to", a meeting, "not interested", a bounce or a complaint stops the run.
          </p>

          <ol className="space-y-2">
            {latest.steps.map((step) => {
              const dueNow = latest.status === "active" && isDueNow(step, now);
              const open = latest.status === "active" && isOpen(step);
              const tone = dueNow ? "border-primary/60 bg-primary/5" : step.status === "sent" || step.status === "done" ? "border-positive/40" : step.status === "skipped" || step.status === "stopped" ? "border-border/40 opacity-70" : "border-border/60";
              return (
                <li key={step.id} className={`rounded-md border p-3 text-sm ${tone}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="font-medium text-foreground flex items-center gap-1.5">
                      {step.kind === "call" ? <PhoneCall className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> : <Mail className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
                      {step.step_no}. {stepLabel(step)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {open ? `Due ${whenWord(step.due_at, now)}` : `${STEP_STATUS_LABELS[step.status] || step.status}${step.completed_at ? ` ${whenWord(step.completed_at, now).replace(" (overdue)", "")}` : ""}`}
                      {dueNow && <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">due now</span>}
                    </span>
                  </div>

                  {step.kind === "email" && step.body && (open || step.status === "sent") && (
                    <details className="mt-2" open={dueNow}>
                      <summary className="cursor-pointer text-xs text-muted-foreground">{step.status === "sent" ? "What was sent" : "The draft"}{step.subject ? `: ${step.subject}` : ""} ({wordCount(step.body)} words{step.hook ? `, about ${step.hook}` : ""})</summary>
                      {(step.draft_flags || []).length > 0 && open && (
                        <p className="mt-1 rounded bg-warning/10 px-2 py-1 text-xs text-foreground/90">Check before sending: {step.draft_flags.join("; ")}.</p>
                      )}
                      <p className="mt-1 whitespace-pre-wrap rounded bg-muted/40 p-2 text-xs text-foreground/90">{step.body}</p>
                    </details>
                  )}
                  {step.kind === "email" && open && !step.body && (
                    <p className="mt-1 text-xs text-muted-foreground">No draft yet. It is written when the step falls due, or press Write it now.</p>
                  )}
                  {step.kind === "call" && open && step.body && (
                    <p className="mt-2 whitespace-pre-wrap rounded bg-muted/40 p-2 text-xs text-foreground/90">{step.body}</p>
                  )}
                  {step.kind === "call" && open && !step.body && (
                    <p className="mt-1 text-xs text-muted-foreground">Use the approved script on the Scripts tab, then log the outcome here.</p>
                  )}

                  {open && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {step.kind === "email" && hasDraft(step) && (
                        <Button type="button" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setEmailStep({ seq: latest, step })} disabled={!!busy}>
                          <Mail className="h-3.5 w-3.5" aria-hidden="true" />{dueNow ? "Approve and send" : "Edit, approve and send early"}
                        </Button>
                      )}
                      {step.kind === "email" && (
                        <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void act(`redraft-${step.id}`, { action: "redraft", stepId: step.id }, "Written again")} disabled={!!busy}>
                          {busy === `redraft-${step.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}{step.body ? "Write it again" : "Write it now"}
                        </Button>
                      )}
                      {step.kind === "call" && (
                        <Button type="button" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => { setLogging(logging === step.id ? null : step.id); setLogNote(""); setLogCallback(""); }} disabled={!!busy}>
                          <PhoneCall className="h-3.5 w-3.5" aria-hidden="true" />Log outcome
                        </Button>
                      )}
                      <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void act(`skip-${step.id}`, { action: "skip", stepId: step.id }, "Skipped")} disabled={!!busy}>
                        {busy === `skip-${step.id}` && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}Skip
                      </Button>
                    </div>
                  )}

                  {logging === step.id && open && step.kind === "call" && (
                    <form className="mt-2 grid gap-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void act(`done-${step.id}`, { action: "done", stepId: step.id, outcomeKind: logKind, note: logNote, callbackAt: logKind === "callback" && logCallback ? new Date(logCallback).toISOString() : null }, "Call logged").then((ok) => { if (ok) setLogging(null); }); }}>
                      <div>
                        <Label htmlFor={`log-kind-${step.id}`}>Outcome</Label>
                        <Select value={logKind} onValueChange={setLogKind}>
                          <SelectTrigger id={`log-kind-${step.id}`}><SelectValue /></SelectTrigger>
                          <SelectContent>{CALL_OUTCOME_CHOICES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      {logKind === "callback" && (
                        <div>
                          <Label htmlFor={`log-callback-${step.id}`}>Call back on</Label>
                          <Input id={`log-callback-${step.id}`} type="datetime-local" value={logCallback} onChange={(e) => setLogCallback(e.target.value)} required />
                        </div>
                      )}
                      <div className="sm:col-span-2">
                        <Label htmlFor={`log-note-${step.id}`}>Note</Label>
                        <Textarea id={`log-note-${step.id}`} value={logNote} onChange={(e) => setLogNote(e.target.value)} rows={2} placeholder="What was said, what to do next" />
                      </div>
                      <div className="sm:col-span-2 flex gap-2">
                        <Button type="submit" size="sm" className="h-7 text-xs" disabled={!!busy}>{busy === `done-${step.id}` && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}Log it</Button>
                        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setLogging(null)}>Cancel</Button>
                      </div>
                      <p className="sm:col-span-2 text-xs text-muted-foreground">"Spoke to", "meeting booked", "not interested" or "replied" stops the follow-ups as well.</p>
                    </form>
                  )}
                </li>
              );
            })}
          </ol>

          {latest.status === "active" && (
            <div className="mt-3">
              {stopping === latest.id ? (
                <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void act(`stop-${latest.id}`, { action: "stop", sequenceId: latest.id, outcomeKind: stopChoice === "other" ? null : stopChoice, reason: stopReason }, "Follow-ups stopped").then((ok) => { if (ok) setStopping(null); }); }}>
                  <div>
                    <Label htmlFor="stop-choice">Why stop?</Label>
                    <Select value={stopChoice} onValueChange={setStopChoice}>
                      <SelectTrigger id="stop-choice"><SelectValue /></SelectTrigger>
                      <SelectContent>{STOP_CHOICES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="stop-reason">{stopChoice === "other" ? "Reason" : "Note (optional)"}</Label>
                    <Input id="stop-reason" value={stopReason} onChange={(e) => setStopReason(e.target.value)} maxLength={200} required={stopChoice === "other"} placeholder={stopChoice === "other" ? "Head on leave until half-term" : "What they said"} />
                  </div>
                  <div className="sm:col-span-2 flex gap-2">
                    <Button type="submit" size="sm" variant="destructive" className="h-7 text-xs" disabled={!!busy}>{busy === `stop-${latest.id}` && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}Stop the follow-ups</Button>
                    <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setStopping(null)}>Cancel</Button>
                  </div>
                  <p className="sm:col-span-2 text-xs text-muted-foreground">The first four log that outcome on the Calls tab; "Something else" logs a note with your reason.</p>
                </form>
              ) : (
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setStopping(latest.id); setStopChoice("replied"); setStopReason(""); }} disabled={!!busy}>Stop the follow-ups</Button>
              )}
            </div>
          )}

          {sequences.length > 1 && (
            <div className="mt-3">
              <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setShowHistory((v) => !v)}>{showHistory ? "Hide" : "Show"} earlier follow-ups ({sequences.length - 1})</button>
              {showHistory && (
                <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {sequences.filter((s) => s.id !== latest.id).map((s) => <li key={s.id}>{sequenceLine(s, now)} Started {whenWord(s.started_at, now).replace(" (overdue)", "")}; {s.steps.filter((x) => x.status === "sent").length} email{s.steps.filter((x) => x.status === "sent").length === 1 ? "" : "s"} sent.</li>)}
                </ul>
              )}
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">A company that finished or stopped its follow-ups goes quiet for eight weeks unless a new vacancy or a new fact appears there.</p>
        </>
      )}

      {emailStep && (
        <EmailContactDialog
          companyId={companyId}
          companyName={companyName}
          contact={{ name: emailStep.seq.contact_name, role: emailStep.seq.contact_role, email: emailStep.seq.contact_email }}
          open={!!emailStep}
          onOpenChange={(o) => { if (!o) setEmailStep(null); }}
          onSent={() => { refresh(); }}
          initial={{ subject: emailStep.step.subject || "", body: emailStep.step.body || "" }}
          sequenceStepId={emailStep.step.id}
          stepLabel={stepLabel(emailStep.step)}
          draftFlags={emailStep.step.draft_flags || []}
        />
      )}
    </Card>
  );
}
