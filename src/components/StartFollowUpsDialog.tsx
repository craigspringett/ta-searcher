import { useEffect, useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { draftingLine, type FollowUpsReply } from "@/lib/followUps";
import { callFollowUps, companyFollowUpsKey } from "@/lib/followUpsData";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  companyId: string;
  companyName: string;
  contact: { name: string; role?: string | null; email: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Start follow-ups" (Follow-ups slice 2): shows the plan with its dates
 * for this contact, lets the consultant pick the vacancy it is about, and
 * starts it. The three emails are drafted on the spot; nothing is sent
 * until each is approved.
 */
export function StartFollowUpsDialog({ companyId, companyName, contact, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [plan, setPlan] = useState<FollowUpsReply | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [vacancyId, setVacancyId] = useState<string>("none");
  const [busy, setBusy] = useState<"plan" | "start" | null>(null);
  const [started, setStarted] = useState<FollowUpsReply | null>(null);

  useEffect(() => {
    if (!open) return;
    setPlan(null); setProblem(null); setStarted(null); setVacancyId("none");
    setBusy("plan");
    callFollowUps({ action: "plan", companySearchId: companyId })
      .then(({ status, data }) => { if (status >= 400) setProblem(data.error || `HTTP ${status}`); else { setPlan(data); if ((data.vacancies || []).length === 1) setVacancyId(data.vacancies![0].id); } })
      .catch((e) => setProblem(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  }, [open, companyId]);

  const start = async () => {
    setBusy("start");
    setProblem(null);
    try {
      const { status, data } = await callFollowUps({ action: "start", companySearchId: companyId, contactName: contact.name, contactEmail: contact.email, contactRole: contact.role || null, vacancyId: vacancyId === "none" ? null : vacancyId });
      if (status >= 400) { setProblem(data.error || `HTTP ${status}`); return; }
      setStarted(data);
      toast({ title: "Follow-ups started", description: data.message });
      void queryClient.invalidateQueries({ queryKey: companyFollowUpsKey(companyId) });
      void queryClient.invalidateQueries({ queryKey: ["follow-ups-active"] });
      void queryClient.invalidateQueries({ queryKey: ["patch"] });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const blocked = plan?.active ? `${companyName} already has follow-ups running with ${plan.active.contact_name}. Stop those first.` : plan?.quiet || null;
  const chosen = (plan?.vacancies || []).find((v) => v.id === vacancyId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-primary" aria-hidden="true" />Start follow-ups with {contact.name}</DialogTitle>
          <DialogDescription>
            Two weeks of touches at {companyName}: a call and an email today, an email on day 4, a call on day 8, a last email on day 14. TA Searcher drafts the emails from what it knows about the company; you approve each one before it goes. Any reply, a "spoke to", a meeting or "not interested" stops it.
          </DialogDescription>
        </DialogHeader>

        {busy === "plan" && <p className="text-sm text-muted-foreground" role="status"><Loader2 className="inline h-4 w-4 animate-spin mr-2" aria-hidden="true" />Working out the dates…</p>}
        {problem && <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-foreground" role="alert">{problem}</p>}

        {started ? (
          <div className="space-y-2 text-sm">
            <p className="text-foreground">{started.message}</p>
            <p className="text-muted-foreground">{draftingLine(started.drafting)}</p>
            <p className="text-xs text-muted-foreground">The plan is in the Follow-ups panel on this page, and what is due each day is on My patch.</p>
            <Button size="sm" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        ) : plan ? (
          <div className="space-y-3 text-sm">
            {blocked && <p className="rounded-md border border-warning/50 bg-warning/10 p-3 text-foreground" role="note">{blocked}</p>}
            <ol className="divide-y divide-border/60 rounded-md border border-border">
              {(plan.plan || []).map((p) => (
                <li key={p.stepNo} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                  <span className="text-foreground">{p.stepNo}. {p.label}</span>
                  <span className="whitespace-nowrap text-muted-foreground">{p.when}</span>
                </li>
              ))}
            </ol>
            <p className="text-xs text-muted-foreground">Emails go in the afternoon, Friday afternoons where the plan allows, never on a Monday morning or at a weekend. Dates move to the next working day when they land on one.</p>
            {(plan.vacancies || []).length > 0 && (
              <div>
                <Label htmlFor="follow-ups-vacancy">Which vacancy is this about?</Label>
                <Select value={vacancyId} onValueChange={setVacancyId}>
                  <SelectTrigger id="follow-ups-vacancy"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No one vacancy in particular</SelectItem>
                    {plan.vacancies!.map((v) => <SelectItem key={v.id} value={v.id}>{v.title}{v.closing_date ? ` (closes ${v.closing_date})` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
                {chosen && <p className="mt-1 text-xs text-muted-foreground">The emails will be about this post{chosen.closing_date ? ` and its closing date` : ""}.</p>}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => void start()} disabled={!!busy || !!blocked} className="gap-2">
                {busy === "start" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{busy === "start" ? "Starting and drafting the emails…" : "Start follow-ups"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
