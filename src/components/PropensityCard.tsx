import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { BAND_CLASSES, BAND_LABELS, orderedBreakdown, parseScoreRow, pointsText, scoreBand, type CompanyScore } from "@/lib/propensity";

/**
 * "Likely to buy" (Phase 5): the company's propensity score with every line
 * that made it, so a consultant can see why the company is on the list.
 */
export function PropensityCard({ companyId, refreshKey }: { companyId: string; refreshKey?: string | number | null }) {
  const [score, setScore] = useState<CompanyScore | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    setScore(undefined);
    supabase.from("company_scores").select("score, breakdown, top_reason, top_code, computed_at").eq("company_search_id", companyId).maybeSingle()
      .then(({ data, error }) => { if (active) setScore(error ? null : parseScoreRow(data)); });
    return () => { active = false; };
  }, [companyId, refreshKey]);
  const band = scoreBand(score?.score);
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold text-foreground">Likely to buy</h3>
        {score?.computedAt && <span className="text-xs text-muted-foreground">scored {new Date(score.computedAt).toLocaleDateString("en-GB")}</span>}
      </div>
      {score === undefined && <p className="text-sm text-muted-foreground" role="status">Loading…</p>}
      {score === null && <p className="text-sm text-muted-foreground">Not scored yet. The score is computed after each analysis and every morning at 06:00 UTC.</p>}
      {score && band && (
        <div>
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-baseline gap-1 rounded-lg border px-3 py-1.5 ${BAND_CLASSES[band]}`}>
              <span className="text-2xl font-bold tabular-nums">{score.score}</span>
              <span className="text-xs">/ 100</span>
            </span>
            <span className="text-sm text-foreground">{BAND_LABELS[band]}{score.topReason ? `: ${score.topReason}` : "."}</span>
          </div>
          {score.breakdown.length > 0 ? (
            <ul className="mt-3 space-y-1.5 border-t border-border/50 pt-3">
              {orderedBreakdown(score.breakdown).map((l, i) => (
                <li key={`${l.code}-${i}`} className="flex items-start gap-2 text-sm">
                  <span className={`shrink-0 w-12 text-right tabular-nums font-medium ${l.kind === "adjustment" ? "text-muted-foreground" : "text-foreground"}`}>{pointsText(l)}</span>
                  <span className="text-foreground"><span className="font-medium">{l.label}.</span> <span className="text-muted-foreground">{l.reason}</span></span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No signal today, so nothing to score. Signals combine so that several middling ones add up; a call outcome adjusts the result.</p>
          )}
        </div>
      )}
    </Card>
  );
}
