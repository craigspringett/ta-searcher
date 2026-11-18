import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { CampaignStepDialog } from "@/components/CampaignStepDialog";
import { EmailContactDialog } from "@/components/EmailContactDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { contactState, formatDue, needsWriting, summarise } from "@/lib/campaigns";
import { callCampaigns, callDraft, campaignKey, campaignsKey, useCampaign, type CampaignContactRow, type CampaignStepFull } from "@/lib/campaignsData";

const chip: Record<string, string> = {
  writing: "bg-muted text-muted-foreground",
  approve: "bg-warning/15 text-warning",
  approve_later: "bg-warning/15 text-warning",
  running: "bg-positive/15 text-positive",
  done: "bg-muted text-muted-foreground",
  stopped: "bg-critical/15 text-critical",
};

type Row = CampaignContactRow;

/**
 * One follow-up campaign (Craig, 18 November 2026): every contact with their
 * first email to read and approve one at a time. Nothing is sent until you
 * press Approve and send on that contact's email. The later steps follow on
 * their days, and the emails go by themselves only if the campaign says so.
 */
export default function Campaign() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const skipped = ((location.state as { skipped?: Array<{ contactName: string; companyName: string; reason: string }> } | null)?.skipped) || [];
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, error, isLoading, refetch } = useCampaign(id);
  const [review, setReview] = useState<Row | null>(null);
  const [laterStep, setLaterStep] = useState<{ row: Row; step: CampaignStepFull } | null>(null);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [writingNow, setWritingNow] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const started = useRef<Set<string>>(new Set());

  // The emails are written for each contact as soon as the page opens, two at a time. The queue lives outside the effect so a refresh of the
  // page's data never abandons contacts waiting in it (that stalled a test on 18 November 2026: the effect's cleanup stopped the loop while
  // the rest of the queue was already marked as started). A contact that fails is marked, with a button to try again.
  const [tick, setTick] = useState(0);
  const queue = useRef<Row[]>([]);
  const workers = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const aligned = useRef(false);
  useEffect(() => {
    if (!data) return;
    const alike = data.campaign.write_alike;
    const model = data.contacts[0];
    const enqueue = (c: Row) => { if (needsWriting(c) && !started.current.has(c.id)) { started.current.add(c.id); queue.current.push(c); } };
    const work = async () => {
      workers.current++;
      try {
        for (let c = queue.current.shift(); c && mounted.current; c = queue.current.shift()) {
          const id = c.id;
          setWritingNow((s) => new Set(s).add(id));
          const r = await callDraft(id).catch((e) => ({ status: 500, error: e instanceof Error ? e.message : String(e) }));
          if (r.status >= 400) setFailed((s) => new Set(s).add(id));
          setWritingNow((s) => { const n = new Set(s); n.delete(id); return n; });
          await refetchRef.current();
        }
      } finally { workers.current--; }
    };
    if (alike && model && data.contacts.length > 1) {
      // All alike: the first contact is written alone; the others are told to follow it, then written.
      enqueue(model);
      const modelWritten = !needsWriting(model) && model.steps.some((x) => x.kind === "email" && x.body);
      if (modelWritten && !aligned.current && data.contacts.slice(1).some(needsWriting)) {
        aligned.current = true;
        void callCampaigns({ action: "align", campaignId: id, modelSequenceId: model.id }).then(() => { setTick((n) => n + 1); });
        return;
      }
      if (aligned.current || !data.contacts.slice(1).some(needsWriting)) data.contacts.slice(1).forEach(enqueue);
    } else {
      data.contacts.forEach(enqueue);
    }
    while (workers.current < 2 && queue.current.length > 0) void work();
  }, [data, tick, id]);

  // "Make the others match this one": the others' unsent, unapproved, unedited emails are rewritten around this contact's.
  const [matching, setMatching] = useState(false);
  const matchOthers = async (model: Row) => {
    if (!window.confirm(`Rewrite the other contacts' emails to match ${model.contact_name}'s? Anything you have approved, edited or sent is left alone.`)) return;
    setMatching(true);
    try {
      const { status, data: r } = await callCampaigns({ action: "align", campaignId: id, modelSequenceId: model.id });
      if (status >= 400) { toast({ title: "Not done", description: r.error, variant: "destructive" }); return; }
      const targets = r.targets || [];
      for (const t of targets) {
        setWritingNow((s) => new Set(s).add(t.sequenceId));
        await callDraft(t.sequenceId, { stepIds: t.stepIds, force: true }).catch(() => null);
        setWritingNow((s) => { const n = new Set(s); n.delete(t.sequenceId); return n; });
        await refetchRef.current();
      }
      toast({ title: targets.length ? "Done" : "Nothing to change", description: targets.length ? `${targets.length} contact${targets.length === 1 ? "" : "s"} rewritten to match.` : r.message });
    } finally { setMatching(false); }
  };

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      const { status, data: r } = await callCampaigns({ action, campaignId: id, ...extra });
      toast({ title: status >= 400 ? "Not done" : "Done", description: r.error || r.message, variant: status >= 400 ? "destructive" : undefined });
      await refetch();
      void queryClient.invalidateQueries({ queryKey: campaignsKey });
      void queryClient.invalidateQueries({ queryKey: ["follow-ups-active"] });
    } finally { setBusy(null); }
  };
  const retry = (c: Row) => {
    setFailed((s) => { const n = new Set(s); n.delete(c.id); return n; });
    started.current.delete(c.id);
    queue.current = queue.current.filter((x) => x.id !== c.id);
    setTick((n) => n + 1);
  };

  const camp = data?.campaign;
  const counts = data ? summarise(data.contacts) : null;
  const stepLabel = (s: CampaignStepFull) => s.label || (s.kind === "call" ? "Call" : "Email");

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title={camp?.name || "Campaign"} subtitle={camp?.angle ? `About: ${camp.angle}` : undefined} />
      <main className="container mx-auto max-w-5xl space-y-4 px-4 py-5 sm:px-6">
        <p><Link to="/campaigns" className="text-sm text-muted-foreground underline hover:text-foreground">All campaigns</Link></p>
        {isLoading && <p className="text-sm text-muted-foreground" role="status"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />Loading…</p>}
        {error && <p className="text-sm text-critical" role="alert">Could not load: {(error as Error).message}</p>}
        {data === null && <p className="text-sm text-muted-foreground">No campaign with that reference. <button type="button" className="text-primary hover:underline" onClick={() => navigate("/campaigns")}>Back to campaigns</button>.</p>}
        {skipped.length > 0 && (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground" role="note">
            <p className="font-medium">Left out of the campaign</p>
            <ul className="mt-1 list-disc pl-5 text-xs">{skipped.map((s, i) => <li key={i}>{s.contactName}, {s.companyName}: {s.reason}</li>)}</ul>
          </div>
        )}
        {camp && counts && (
          <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
            <span className="text-foreground"><strong>{counts.approve}</strong> first email{counts.approve === 1 ? "" : "s"} to approve{counts.approve_later > 0 ? <>, <strong>{counts.approve_later}</strong> contact{counts.approve_later === 1 ? "" : "s"} with later emails to approve</> : null}</span>
            <span className="text-muted-foreground">{counts.writing} being written · {counts.running} sent · {counts.done + counts.stopped} finished or stopped</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{camp.status === "active" ? "Running" : camp.status === "paused" ? "Paused" : "Stopped"}</span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" className="h-4 w-4" checked={camp.auto_after_first} disabled={busy !== null || camp.status === "stopped"} onChange={(e) => void act("set_auto", { enabled: e.target.checked })} />Approved emails go out by themselves on their day</label>
              {camp.status === "active" && <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void act("pause")}>Pause</Button>}
              {camp.status === "paused" && <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void act("resume")}>Resume</Button>}
              {camp.status !== "stopped" && <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => { if (window.confirm("Stop every follow-up still running in this campaign?")) void act("stop"); }}>Stop campaign</Button>}
            </div>
          </Card>
        )}

        <ul className="space-y-3">
          {(data?.contacts || []).map((c) => {
            const st = contactState(c);
            const first = c.steps.find((s) => s.step_no === 1);
            const isWriting = writingNow.has(c.id) || (st.state === "writing" && !failed.has(c.id));
            return (
              <li key={c.id}>
                <Card className="p-4 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{c.contact_name}{c.contact_role ? <span className="font-normal text-muted-foreground">, {c.contact_role}</span> : null}</p>
                      <p className="text-xs text-muted-foreground"><Link to={`/companies/${c.company_search_id}`} className="hover:underline">{c.companyName}</Link> · {c.contact_email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${chip[st.state]}`}>{isWriting ? "Writing the emails…" : st.label}</span>
                      {st.state === "approve" && first && <Button type="button" size="sm" disabled={camp?.status === "stopped"} onClick={() => setReview(c)}>Read and approve</Button>}
                      {st.state === "writing" && failed.has(c.id) && <Button type="button" size="sm" variant="outline" onClick={() => retry(c)}>Try writing again</Button>}
                      {(data?.contacts.length || 0) > 1 && !needsWriting(c) && c.steps.some((x) => x.kind === "email" && x.body) && camp?.status !== "stopped" && <Button type="button" size="sm" variant="ghost" disabled={matching} onClick={() => void matchOthers(c)} title="Rewrite the other contacts' unsent emails to follow this one">Make the others like this</Button>}
                    </div>
                  </div>
                  {first?.body && (
                    <div className="mt-3 rounded-md border border-border bg-muted/20 p-3">
                      <p className="text-xs text-muted-foreground">First email{first.status === "sent" ? " (sent)" : ""}</p>
                      <p className="font-medium text-foreground">{first.subject}</p>
                      <p className="mt-1 line-clamp-4 whitespace-pre-line text-xs text-muted-foreground">{first.body}</p>
                      {(first.draft_flags || []).length > 0 && <p className="mt-1 text-xs text-warning">Check before sending: {(first.draft_flags || []).join("; ")}</p>}
                    </div>
                  )}
                  <ol className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                    {c.steps.filter((s) => s.step_no > 1).map((s) => {
                      const isEmail = s.kind === "email";
                      const open = isEmail && ["scheduled", "due"].includes(s.status);
                      return (
                        <li key={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-foreground">{stepLabel(s)}</span> · {formatDue(s.due_at)}{s.status === "sent" ? " · sent" : s.status === "stopped" ? " · stopped" : ""}
                          {isEmail && s.subject && <span className="truncate text-muted-foreground">· {s.subject}</span>}
                          {open && !s.body && <span>· being written</span>}
                          {open && s.body && s.campaign_approved_at && <span className="rounded bg-positive/15 px-1.5 py-0.5 font-medium text-positive">Approved, goes on its day</span>}
                          {open && s.body && !s.campaign_approved_at && <span className="rounded bg-warning/15 px-1.5 py-0.5 font-medium text-warning">Waiting for your approval</span>}
                          {open && s.body && <Button type="button" size="sm" variant={s.campaign_approved_at ? "ghost" : "outline"} className="h-6 px-2 text-xs" disabled={camp?.status === "stopped"} onClick={() => setLaterStep({ row: c, step: s })}>{s.campaign_approved_at ? "Read or change" : "Read and approve"}</Button>}
                        </li>
                      );
                    })}
                  </ol>
                </Card>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">Every email is read and approved by you: the first one is sent when you approve it (or when you send it from Outlook and tick it as sent), the later ones go out by themselves on their days, as you approved them. Changing an email takes its approval back. A reply, a call that goes well or a "not interested" stops that contact's run.</p>
      </main>

      {laterStep && (
        <CampaignStepDialog
          campaignId={id}
          step={laterStep.step}
          contactName={laterStep.row.contact_name}
          companyName={laterStep.row.companyName}
          goesByItself={camp?.auto_after_first === true && camp.status === "active"}
          open
          onOpenChange={(o) => { if (!o) setLaterStep(null); }}
          onChanged={() => { void refetch(); }}
        />
      )}

      {review && (() => {
        const first = review.steps.find((s) => s.step_no === 1);
        return first ? (
          <EmailContactDialog
            companyId={review.company_search_id}
            companyName={review.companyName}
            contact={{ name: review.contact_name, role: review.contact_role, email: review.contact_email }}
            open
            onOpenChange={(o) => { if (!o) setReview(null); }}
            onSent={() => { void queryClient.invalidateQueries({ queryKey: campaignKey(id) }); void refetch(); }}
            initial={{ subject: first.subject || "", body: first.body || "" }}
            sequenceStepId={first.id}
            stepLabel="First email, an introduction"
            draftFlags={first.draft_flags || []}
          />
        ) : null;
      })()}
    </div>
  );
}
