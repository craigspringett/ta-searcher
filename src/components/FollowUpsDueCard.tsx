import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2, Mail, PhoneCall } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CALL_OUTCOME_CHOICES, dueRows, hasDraft, stepLabel, whenWord, type DueRow } from "@/lib/followUps";
import { activeFollowUpsKey, callFollowUps, useActiveFollowUps } from "@/lib/followUpsData";
import type { PatchCompany } from "@/lib/patch";
import { EmailContactDialog } from "@/components/EmailContactDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SourceNote } from "@/components/SourceNote";

export const DUE_SOURCE = "Every follow-up step due today (or overdue) across the companies in the list: calls to make and emails to approve. Emails are drafted by TA Searcher from what it knows about the company and go only when you press Approve and send, or when you copy one into Outlook and tick it as sent. A reply, a \"spoke to\", a meeting or \"not interested\" stops a run; so does a bounce or a complaint.";

/**
 * "Follow-ups due today" on My patch (Follow-ups slice 2), above Warm
 * right now: due calls with a Log outcome shortcut, due emails with Approve
 * and send (the same dialog as Email this contact, pre-filled), and "They
 * replied" in one click. Only the companies passed in, like the warm list.
 */
export function FollowUpsDueCard({ companies }: { companies: PatchCompany[] }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, error, isLoading } = useActiveFollowUps(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [emailRow, setEmailRow] = useState<(DueRow & { company: PatchCompany }) | null>(null);
  const [logKind, setLogKind] = useState<Record<string, string>>({});

  const rows = useMemo(() => {
    if (!data) return [] as Array<DueRow & { company: PatchCompany }>;
    const byId = new Map(companies.map((s) => [s.id, s]));
    return dueRows(data).filter((r) => byId.has(r.sequence.company_search_id)).map((r) => ({ ...r, company: byId.get(r.sequence.company_search_id)! }));
  }, [data, companies]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: activeFollowUpsKey });
    void queryClient.invalidateQueries({ queryKey: ["follow-ups"] });
    void queryClient.invalidateQueries({ queryKey: ["patch"] });
  };

  const act = async (key: string, body: Record<string, unknown>, okTitle: string) => {
    setBusy(key);
    try {
      const { status, data: reply } = await callFollowUps(body);
      if (status >= 400) { toast({ title: "Not done", description: reply.error || `HTTP ${status}`, variant: "destructive" }); return; }
      toast({ title: okTitle, description: reply.message });
      refresh();
    } catch (e) {
      toast({ title: "Not done", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const empty = !isLoading && !error && rows.length === 0;
  const now = new Date();
  return (
    <Card className="p-4 border-primary/40">
      <div className="mb-1 flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="text-base font-bold text-foreground">Follow-ups due today</h2>
        <SourceNote text={DUE_SOURCE} label="How this list is made" />
      </div>
      {isLoading && <p className="text-sm text-muted-foreground" role="status">Checking what is due…</p>}
      {error && <p className="text-sm text-destructive" role="alert">Could not load: {(error as Error).message}</p>}
      {empty && <p className="text-sm text-muted-foreground">Nothing due today. Start follow-ups from a contact on a company page (Contacts tab) and the calls and emails will appear here on the day they are due.</p>}
      {rows.length > 0 && (
        <ul className="divide-y divide-border/60 text-sm">
          {rows.map((r) => {
            const key = r.step.id;
            const kind = logKind[key] || "voicemail";
            return (
              <li key={key} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
                {r.step.kind === "call" ? <PhoneCall className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> : <Mail className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
                <button type="button" className="font-medium text-foreground hover:underline" onClick={() => navigate(`/companies/${r.company.id}#follow-ups`)}>{r.company.name}</button>
                <span className="text-muted-foreground">{r.sequence.contact_name}</span>
                <span className="text-foreground/90">{stepLabel(r.step)}</span>
                <span className="text-xs text-muted-foreground">{whenWord(r.step.due_at, now)}</span>
                <span className="ml-auto flex flex-wrap items-center gap-1.5">
                  {r.step.kind === "email" && hasDraft(r.step) && (
                    <Button type="button" size="sm" className="h-7 gap-1 text-xs" onClick={() => setEmailRow(r)} disabled={!!busy}><Mail className="h-3.5 w-3.5" aria-hidden="true" />Approve and send</Button>
                  )}
                  {r.step.kind === "email" && !hasDraft(r.step) && (
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => void act(`redraft-${key}`, { action: "redraft", stepId: r.step.id }, "Written")} disabled={!!busy}>{busy === `redraft-${key}` && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}Write the draft</Button>
                  )}
                  {r.step.kind === "call" && (
                    <>
                      <Select value={kind} onValueChange={(v) => setLogKind((m) => ({ ...m, [key]: v }))}>
                        <SelectTrigger className="h-7 w-36 text-xs" aria-label="Call outcome"><SelectValue /></SelectTrigger>
                        <SelectContent>{CALL_OUTCOME_CHOICES.filter((c) => c.value !== "callback").map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button type="button" size="sm" className="h-7 text-xs" onClick={() => void act(`done-${key}`, { action: "done", stepId: r.step.id, outcomeKind: kind }, "Call logged")} disabled={!!busy}>{busy === `done-${key}` && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}Log outcome</Button>
                    </>
                  )}
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void act(`replied-${key}`, { action: "stop", sequenceId: r.sequence.id, outcomeKind: "replied" }, "Logged as replied")} disabled={!!busy} title="Logs a reply on the Calls tab and stops the follow-ups">{busy === `replied-${key}` && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}They replied</Button>
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void act(`skip-${key}`, { action: "skip", stepId: r.step.id }, "Skipped")} disabled={!!busy}>Skip</Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {emailRow && (
        <EmailContactDialog
          companyId={emailRow.company.id}
          companyName={emailRow.company.name}
          contact={{ name: emailRow.sequence.contact_name, role: emailRow.sequence.contact_role, email: emailRow.sequence.contact_email }}
          open={!!emailRow}
          onOpenChange={(o) => { if (!o) setEmailRow(null); }}
          onSent={refresh}
          initial={{ subject: emailRow.step.subject || "", body: emailRow.step.body || "" }}
          sequenceStepId={emailRow.step.id}
          stepLabel={stepLabel(emailRow.step)}
          draftFlags={emailRow.step.draft_flags || []}
        />
      )}
    </Card>
  );
}
