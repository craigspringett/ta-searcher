import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Flame } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SourceNote } from "@/components/SourceNote";
import { loadRecentEngagement } from "@/lib/emailEventsData";
import { warmLine, warmCompanies } from "@/lib/emailEvents";
import type { PatchCompany } from "@/lib/patch";

export const WARM_SOURCE = "Resend tells TA Searcher when an email a consultant sent is opened or a link in it is clicked. A company is listed here when someone there opened or clicked in the last 24 hours and no call has been logged since, newest first. An open is reliable; a missing open is not, because some mail apps hide them. Clicks are reliable. Nothing here is shown to companies.";

/**
 * "Warm right now" (Follow-ups slice 1): who to ring first. Only the
 * companies in the list passed in (the consultant's own, or the filter on My
 * patch), so a manager filtering to one consultant sees that consultant's.
 */
export function WarmNowCard({ companies }: { companies: PatchCompany[] }) {
  const navigate = useNavigate();
  const { data, error, isLoading } = useQuery({ queryKey: ["warm-now"], queryFn: () => loadRecentEngagement(24), staleTime: 30_000, refetchInterval: 60_000 });
  const rows = useMemo(() => {
    if (!data) return [];
    const byId = new Map(companies.map((s) => [s.id, s]));
    const lastOutcome = new Map(companies.filter((s) => s.lastOutcome).map((s) => [s.id, s.lastOutcome!.at]));
    return warmCompanies(data, lastOutcome).filter((w) => byId.has(w.companyId)).map((w) => ({ ...w, company: byId.get(w.companyId)! }));
  }, [data, companies]);
  const empty = !isLoading && !error && rows.length === 0;
  return (
    <Card className="p-4 border-positive/40">
      <div className="mb-1 flex items-center gap-2">
        <Flame className="h-4 w-4 text-positive" aria-hidden="true" />
        <h2 className="text-base font-bold text-foreground">Warm right now</h2>
        <SourceNote text={WARM_SOURCE} label="How this list is made" />
      </div>
      {isLoading && <p className="text-sm text-muted-foreground" role="status">Checking for opens and clicks…</p>}
      {error && <p className="text-sm text-destructive" role="alert">Could not load: {(error as Error).message}</p>}
      {empty && <p className="text-sm text-muted-foreground">Nobody has opened or clicked an email from this list in the last 24 hours. Companies appear here as soon as they do.</p>}
      {rows.length > 0 && (
        <ul className="divide-y divide-border/60 text-sm">
          {rows.map((w) => (
            <li key={w.companyId} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
              <button type="button" className="font-medium text-foreground hover:underline" onClick={() => navigate(`/companies/${w.companyId}#contacts`)}>{w.company.name}</button>
              {w.contactName && <span className="text-muted-foreground">{w.contactName}</span>}
              <span className="text-positive">{warmLine(w)}</span>
              <span className="text-xs text-muted-foreground">No call logged since. Ring them.</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
