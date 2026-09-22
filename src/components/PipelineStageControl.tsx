import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { loadCompanyStage, moveCompanyStage } from "@/lib/pipelineData";
import { PIPELINE_STAGES, STAGE_HINTS, STAGE_LABELS, timeInStage, type PipelineStage } from "@/lib/pipeline";

/** The company's place on the pipeline board, changeable in one pick. */
export function PipelineStageControl({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<PipelineStage | null>(null);
  const [movedAt, setMovedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setStage(null);
    loadCompanyStage(companyId).then((s) => { if (alive) { setStage(s.stage); setMovedAt(s.movedAt); } }).catch(() => { if (alive) setStage("prospect"); });
    return () => { alive = false; };
  }, [companyId]);

  const move = async (next: string) => {
    if (!next || next === stage) return;
    setBusy(true);
    try {
      await moveCompanyStage(companyId, next as PipelineStage);
      setStage(next as PipelineStage);
      setMovedAt(new Date().toISOString());
      toast({ title: "Moved", description: `Now in ${STAGE_LABELS[next as PipelineStage]}.` });
      void queryClient.invalidateQueries({ queryKey: ["pipeline"] });
    } catch (e) {
      toast({ title: "Not moved", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor="pipeline-stage" className="text-xs text-muted-foreground">Pipeline</label>
      {stage === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
      ) : (
        <Select value={stage} onValueChange={(v) => void move(v)} disabled={busy}>
          <SelectTrigger id="pipeline-stage" className="h-8 w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PIPELINE_STAGES.map((s) => <SelectItem key={s} value={s} title={STAGE_HINTS[s]}>{STAGE_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {stage !== null && movedAt && <span className="text-xs text-muted-foreground">{timeInStage(movedAt) === "today" ? "moved today" : `for ${timeInStage(movedAt)}`}</span>}
      <span className="text-xs text-muted-foreground">Logging a call or an email moves it forward on its own.</span>
    </div>
  );
}
