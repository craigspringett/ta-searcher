import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { SourceNote } from "@/components/SourceNote";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { BAND_CLASSES, scoreBand } from "@/lib/propensity";
import { formatWhen, OUTCOME_LABELS } from "@/lib/patch";
import { BOARD_COLUMNS, boardSummary, groupByStage, PIPELINE_STAGES, STAGE_HINTS, STAGE_LABELS, timeInStage, type PipelineCompany, type PipelineStage } from "@/lib/pipeline";
import { loadPipeline, moveCompanyStage } from "@/lib/pipelineData";

const SOURCE = "Every tracked company in one of four columns: Prospect (nothing said yet), Contacted (an email went or a call was made), Call booked, Search agreed. Logging a call or an email on a company moves it forward on its own; move it anywhere with the picker on its card. Not now keeps a company off the board without removing it.";

export default function Pipeline() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, error, isLoading, refetch } = useQuery({ queryKey: ["pipeline"], queryFn: loadPipeline, staleTime: 30_000 });
  const groups = useMemo(() => groupByStage(data || []), [data]);
  const [busy, setBusy] = useState<string | null>(null);
  const [showLost, setShowLost] = useState(false);

  const move = async (c: PipelineCompany, next: string) => {
    if (next === c.stage) return;
    setBusy(c.id);
    try {
      await moveCompanyStage(c.id, next as PipelineStage);
      toast({ title: "Moved", description: `${c.name} is now in ${STAGE_LABELS[next as PipelineStage]}.` });
      await refetch();
      void queryClient.invalidateQueries({ queryKey: ["patch"] });
    } catch (e) {
      toast({ title: "Not moved", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const card = (c: PipelineCompany) => {
    const band = scoreBand(c.score);
    return (
      <li key={c.id} className="rounded-md border border-border bg-card p-3 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <Link to={`/companies/${c.id}`} className="font-medium text-foreground hover:underline">{c.name}</Link>
          {c.score !== null && band ? <span className={`inline-block min-w-8 rounded-md border px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums ${BAND_CLASSES[band]}`} aria-label={`Score ${c.score}`}>{c.score}</span> : null}
        </div>
        <p className="text-xs text-muted-foreground">{[c.sector, c.fundingStage && c.fundingStage !== "unknown" ? c.fundingStage : null, c.openRoles ? `${c.openRoles} open role${c.openRoles === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") || "No sector or stage yet"}</p>
        {c.lastOutcome && <p className="text-xs text-muted-foreground">{OUTCOME_LABELS[c.lastOutcome.kind] || c.lastOutcome.kind} {formatWhen(c.lastOutcome.at)}</p>}
        {c.nextCallback && <p className="text-xs text-warning">Call back {formatWhen(c.nextCallback)}</p>}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">{timeInStage(c.movedAt) === "today" ? "moved today" : `here ${timeInStage(c.movedAt)}`}</span>
          <Select value={c.stage} onValueChange={(v) => void move(c, v)} disabled={busy === c.id}>
            <SelectTrigger className="h-7 w-36 text-xs" aria-label={`Move ${c.name}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {PIPELINE_STAGES.map((s) => <SelectItem key={s} value={s} title={STAGE_HINTS[s]}>{STAGE_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </li>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Pipeline" subtitle="Where each company stands, from first contact to a search agreed" actions={<Button variant="ghost" size="sm" onClick={() => void refetch()}>Reload</Button>} />
      <main className="container mx-auto px-6 py-5 space-y-4">
        {isLoading && <p className="text-sm text-muted-foreground" role="status"><Loader2 className="inline h-4 w-4 animate-spin mr-2" aria-hidden="true" />Loading the board…</p>}
        {error && <p className="text-sm text-destructive" role="alert">Could not load: {(error as Error).message}</p>}
        {data && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-muted-foreground">{boardSummary(data)}</p>
              <SourceNote text={SOURCE} />
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {BOARD_COLUMNS.map((s) => (
                <Card key={s} className="p-3">
                  <div className="mb-2 flex items-baseline justify-between">
                    <h2 className="text-sm font-bold text-foreground">{STAGE_LABELS[s]}</h2>
                    <span className="text-xs text-muted-foreground">{groups[s].length}</span>
                  </div>
                  <p className="mb-2 text-[11px] text-muted-foreground">{STAGE_HINTS[s]}</p>
                  {groups[s].length === 0 ? <p className="text-xs text-muted-foreground">Nothing here.</p> : <ul className="space-y-2" aria-label={STAGE_LABELS[s]}>{groups[s].map(card)}</ul>}
                </Card>
              ))}
            </div>
            <Card className="p-3">
              <button type="button" className="flex w-full items-baseline justify-between text-left" onClick={() => setShowLost((v) => !v)} aria-expanded={showLost}>
                <span className="text-sm font-bold text-foreground">{STAGE_LABELS.lost}</span>
                <span className="text-xs text-muted-foreground">{groups.lost.length} {showLost ? "(hide)" : "(show)"}</span>
              </button>
              {showLost && (groups.lost.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">Nothing here.</p> : <ul className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4" aria-label={STAGE_LABELS.lost}>{groups.lost.map(card)}</ul>)}
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
