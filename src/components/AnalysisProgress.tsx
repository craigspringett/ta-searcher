import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** Stages analyze-company reports to company_refresh_runs.notes.stage, in order. */
export const ANALYSIS_STAGES: Array<{ key: string; label: string }> = [
  { key: "started", label: "Reading the website" },
  { key: "record", label: "Checking Companies House" },
  { key: "vacancies", label: "Reading the careers page and job boards" },
  { key: "contacts", label: "Finding the people" },
  { key: "evidence", label: "Reading the evidence" },
  { key: "signals", label: "Computing the signals" },
  { key: "copy", label: "Writing the scripts" },
  { key: "finished", label: "Saving" },
];

/** The "Analysing the company" panel: the current stage, the elapsed time and a way to stop waiting. */
export function AnalysisProgress({ stage, elapsed, onStop }: { stage: string | null; elapsed: number; onStop: () => void }) {
  const current = ANALYSIS_STAGES.findIndex((x) => x.key === stage);
  return (
    <Card className="p-6 bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20 animate-fade-in">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
          <div className="flex-1">
            <p className="font-semibold text-foreground text-lg">Analysing the company</p>
            <p className="text-sm text-muted-foreground mt-1" aria-live="polite">
              {stage ? (ANALYSIS_STAGES.find((x) => x.key === stage)?.label || stage) : "Starting"}
              {" · "}{elapsed}s{elapsed > 120 ? " (a company with large pages can take three minutes)" : ""}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onStop}>Stop waiting</Button>
        </div>
        <ol className="grid grid-cols-2 gap-1 text-xs sm:grid-cols-4">
          {ANALYSIS_STAGES.filter((x) => x.key !== "finished").map((step, index) => {
            const state = current < 0 ? (index === 0 ? "now" : "todo") : index < current ? "done" : index === current ? "now" : "todo";
            return (
              <li key={step.key} className={`rounded p-2 ${state === "now" ? "bg-primary/10 text-primary font-medium" : state === "done" ? "bg-muted text-foreground" : "bg-muted text-muted-foreground"}`}>
                {state === "done" && <CheckCircle2 className="h-3 w-3 inline mr-1" aria-hidden="true" />}
                {step.label}
              </li>
            );
          })}
        </ol>
      </div>
    </Card>
  );
}
