import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, Loader2, Mail, PhoneCall } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { CALL_OUTCOME_CHOICES, groupByDay, hasDraft, isDueNow, isOpen, londonClock, STEP_STATUS_LABELS, stepLabel, whenWord, type DueRow } from "@/lib/followUps";
import { activeFollowUpsKey, allFollowUpsKey, callFollowUps, useAllFollowUps } from "@/lib/followUpsData";
import { AppHeader } from "@/components/AppHeader";
import { EmailContactDialog } from "@/components/EmailContactDialog";
import { SourceNote } from "@/components/SourceNote";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const SOURCE = "Every follow-up run you can see (your companies; managers see everyone's), step by step, on the day each is due: the introduction email the same afternoon you start, the first call two days later, a second email on day 4, a second call on day 8, a last email on day 14. Emails are drafted by TA Searcher from what it knows about the company and go only when you press Approve and send, or when you copy one into Outlook and tick it as sent. A reply, a \"spoke to\", a meeting or \"not interested\" stops a run; so does a bounce or a complaint. \"Everything\" adds the steps already done, sent or skipped, on the day they happened.";

type View = "coming" | "everything";

/**
 * The Follow-ups page (Craig, 18 September 2026: "a follow ups tab where
 * you can see a list of follow ups coming up by day"). What is due today
 * can be actioned here, exactly as on My patch; later days show what is
 * coming with a link to the company page.
 */
export default function FollowUps() {
  const { isManager, profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [view, setView] = useState<View>("coming");
  const [consultant, setConsultant] = useState<string>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [emailRow, setEmailRow] = useState<DueRow | null>(null);
  const [logKind, setLogKind] = useState<Record<string, string>>({});
  const { data, error, isLoading } = useAllFollowUps(true);

  const companyIds = useMemo(() => Array.from(new Set((data || []).map((s) => s.company_search_id))), [data]);
  const { data: companies } = useQuery({
    queryKey: ["follow-ups-companies", companyIds.join(",")],
    enabled: companyIds.length > 0,
    staleTime: 300_000,
    queryFn: async () => {
      const out = new Map<string, string>();
      for (let i = 0; i < companyIds.length; i += 100) {
        const r = await supabase.from("company_searches").select("id, company_name").in("id", companyIds.slice(i, i + 100));
        if (r.error) throw new Error(r.error.message);
        for (const s of r.data || []) out.set(s.id, s.company_name || "Company");
      }
      return out;
    },
  });
  const { data: consultants } = useQuery({
    queryKey: ["follow-ups-consultants"],
    enabled: isManager,
    staleTime: 300_000,
    queryFn: async () => {
      const r = await supabase.from("consultants").select("id, name").eq("active", true).order("name");
      if (r.error) throw new Error(r.error.message);
      return r.data || [];
    },
  });

  const now = new Date();
  const groups = useMemo(() => {
    const seqs = (data || []).filter((s) => consultant === "all" || s.consultant_id === consultant || (consultant === "mine" && s.created_by === profile?.id));
    return groupByDay(seqs, now, view === "everything");
  }, [data, consultant, view, profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: allFollowUpsKey });
    void qc.invalidateQueries({ queryKey: activeFollowUpsKey });
    void qc.invalidateQueries({ queryKey: ["follow-ups"] });
    void qc.invalidateQueries({ queryKey: ["patch"] });
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

  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  // Runs that ended in the last 30 days (a reply, a "spoke to", a meeting, "not interested", or every step done) stay on the page so it is clear which follow-ups came good.
  const finished = useMemo(() => {
    const since = new Date(now.getTime() - 30 * 86400000).toISOString();
    return (data || [])
      .filter((s) => s.status !== "active" && (s.ended_at || s.started_at) >= since)
      .filter((s) => consultant === "all" || s.consultant_id === consultant || (consultant === "mine" && s.created_by === profile?.id))
      .sort((a, b) => (b.ended_at || b.started_at).localeCompare(a.ended_at || a.started_at));
  }, [data, consultant, profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const companyName = (id: string) => companies?.get(id) || "Company";

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Follow-ups" subtitle="Every follow-up coming up, by day: calls to make and emails to approve" />
      <main className="container mx-auto space-y-4 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-muted-foreground" htmlFor="fu-view">Show</label>
            <Select value={view} onValueChange={(v) => setView(v as View)}>
              <SelectTrigger id="fu-view" className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="coming">Coming up</SelectItem><SelectItem value="everything">Everything, including done</SelectItem></SelectContent>
            </Select>
          </div>
          {isManager && (
            <div>
              <label className="block text-xs text-muted-foreground" htmlFor="fu-consultant">Whose</label>
              <Select value={consultant} onValueChange={setConsultant}>
                <SelectTrigger id="fu-consultant" className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone</SelectItem>
                  <SelectItem value="mine">Started by me</SelectItem>
                  {(consultants || []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <p className="flex items-center gap-1 text-xs text-muted-foreground">How this list is made <SourceNote text={SOURCE} /></p>
          <span className="ml-auto text-xs text-muted-foreground">{total} step{total === 1 ? "" : "s"}</span>
        </div>
        {isLoading && <p className="text-sm text-muted-foreground" role="status"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />Loading follow-ups…</p>}
        {error && <p className="text-sm text-destructive" role="alert">Could not load: {(error as Error).message}</p>}
        {!isLoading && !error && total === 0 && (
          <p className="text-sm text-muted-foreground">{view === "coming" ? "Nothing coming up. Start follow-ups from a contact on a company page (Contacts tab) and each call and email will appear here on its day." : "No follow-ups yet."}</p>
        )}
        {view === "coming" && finished.length > 0 && (
          <section className="rounded-lg border border-border" aria-labelledby="finished-runs">
            <h2 id="finished-runs" className="flex items-center gap-2 border-b border-border/60 px-4 py-2 text-sm font-semibold text-foreground"><CheckCircle2 className="h-4 w-4 text-positive" aria-hidden="true" />Finished in the last 30 days<span className="font-normal text-muted-foreground">· {finished.length}</span></h2>
            <ul className="divide-y divide-border/60 px-4 text-sm">
              {finished.map((s) => {
                const done = s.steps.filter((st) => st.status === "sent" || st.status === "done").length;
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
                    <span className="w-28 text-xs text-muted-foreground">{whenWord(s.ended_at || s.started_at, now).replace(/ \d{2}:\d{2}.*$/, "")}</span>
                    <Link to={`/companies/${s.company_search_id}#follow-ups`} className="font-medium text-foreground hover:underline">{companyName(s.company_search_id)}</Link>
                    <span className="text-muted-foreground">{s.contact_name}{s.contact_role ? `, ${s.contact_role}` : ""}</span>
                    <span className={s.stop_reason && /repl/i.test(s.stop_reason) ? "font-medium text-positive" : "text-foreground/90"}>{s.status === "done" ? "Every step done, no reply" : s.stop_reason ? `Stopped: ${s.stop_reason}` : "Stopped"}</span>
                    <span className="text-xs text-muted-foreground">{done} of {s.steps.length} step{s.steps.length === 1 ? "" : "s"} made</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {groups.map((g) => (
          <section key={g.key} className="rounded-lg border border-border" aria-labelledby={`day-${g.key}`}>
            <h2 id={`day-${g.key}`} className={`flex items-center gap-2 border-b border-border/60 px-4 py-2 text-sm font-semibold ${g.key === "overdue" ? "text-critical" : "text-foreground"}`}>
              <CalendarClock className="h-4 w-4" aria-hidden="true" />{g.heading}<span className="font-normal text-muted-foreground">· {g.rows.length}</span>
            </h2>
            <ul className="divide-y divide-border/60 px-4 text-sm">
              {g.rows.map((r) => {
                const key = r.step.id;
                const open = isOpen(r.step) && r.sequence.status === "active";
                const dueNow = open && isDueNow(r.step, now);
                const kind = logKind[key] || "voicemail";
                return (
                  <li key={key} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
                    <span className="w-12 text-xs tabular-nums text-muted-foreground">{londonClock(open ? r.step.due_at : r.step.completed_at || r.step.due_at)}</span>
                    {r.step.kind === "call" ? <PhoneCall className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> : <Mail className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
                    <Link to={`/companies/${r.sequence.company_search_id}#follow-ups`} className="font-medium text-foreground hover:underline">{companyName(r.sequence.company_search_id)}</Link>
                    <span className="text-muted-foreground">{r.sequence.contact_name}{r.sequence.contact_role ? `, ${r.sequence.contact_role}` : ""}</span>
                    <span className="text-foreground/90">{stepLabel(r.step)}</span>
                    <span className="text-xs text-muted-foreground">step {r.step.step_no} of {r.sequence.steps.length}{open ? "" : ` · ${STEP_STATUS_LABELS[r.step.status] || r.step.status}`}{r.sequence.status !== "active" ? ` · run ${r.sequence.status}${r.sequence.stop_reason ? `: ${r.sequence.stop_reason}` : ""}` : ""}</span>
                    {r.step.kind === "email" && open && !hasDraft(r.step) && <span className="text-xs text-warning">draft not written yet</span>}
                    {open && (
                      <span className="ml-auto flex flex-wrap items-center gap-1.5">
                        {dueNow && r.step.kind === "email" && hasDraft(r.step) && (
                          <Button type="button" size="sm" className="h-7 gap-1 text-xs" onClick={() => setEmailRow(r)} disabled={!!busy}><Mail className="h-3.5 w-3.5" aria-hidden="true" />Approve and send</Button>
                        )}
                        {r.step.kind === "email" && !hasDraft(r.step) && (
                          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => void act(`redraft-${key}`, { action: "redraft", stepId: r.step.id }, "Written")} disabled={!!busy}>{busy === `redraft-${key}` && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}Write the draft</Button>
                        )}
                        {!dueNow && r.step.kind === "email" && hasDraft(r.step) && (
                          <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => setEmailRow(r)} disabled={!!busy} title="Read the draft; send it now if you would rather not wait"><Mail className="h-3.5 w-3.5" aria-hidden="true" />Read the draft</Button>
                        )}
                        {dueNow && r.step.kind === "call" && (
                          <>
                            <Select value={kind} onValueChange={(v) => setLogKind((m) => ({ ...m, [key]: v }))}>
                              <SelectTrigger className="h-7 w-36 text-xs" aria-label="Call outcome"><SelectValue /></SelectTrigger>
                              <SelectContent>{CALL_OUTCOME_CHOICES.filter((c) => c.value !== "callback").map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                            </Select>
                            <Button type="button" size="sm" className="h-7 text-xs" onClick={() => void act(`done-${key}`, { action: "done", stepId: r.step.id, outcomeKind: kind }, "Call logged")} disabled={!!busy}>{busy === `done-${key}` && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}Log outcome</Button>
                          </>
                        )}
                        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void act(`replied-${key}`, { action: "stop", sequenceId: r.sequence.id, outcomeKind: "replied" }, "Logged as replied")} disabled={!!busy} title="Logs a reply on the Calls tab and stops the follow-ups">They replied</Button>
                        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void act(`skip-${key}`, { action: "skip", stepId: r.step.id }, "Skipped")} disabled={!!busy}>Skip</Button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </main>
      {emailRow && (
        <EmailContactDialog
          companyId={emailRow.sequence.company_search_id}
          companyName={companyName(emailRow.sequence.company_search_id)}
          contact={{ name: emailRow.sequence.contact_name, role: emailRow.sequence.contact_role, email: emailRow.sequence.contact_email }}
          open={!!emailRow}
          onOpenChange={(o) => { if (!o) setEmailRow(null); }}
          onSent={refresh}
          initial={{ subject: emailRow.step.subject || "", body: emailRow.step.body || "" }}
          sequenceStepId={emailRow.step.id}
          stepLabel={stepLabel(emailRow.step)}
          draftFlags={emailRow.step.draft_flags || []}
          scheduledFor={isDueNow(emailRow.step, now) ? null : whenWord(emailRow.step.due_at, now)}
        />
      )}
    </div>
  );
}
