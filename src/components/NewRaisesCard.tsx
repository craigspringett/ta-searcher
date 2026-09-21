import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SourceNote } from "@/components/SourceNote";
import { loadNewRaises } from "@/lib/newRaisesData";
import { groupRaises, NEW_RAISE_DAYS, raiseLine, raiseName, type NewRaise } from "@/lib/newRaises";

export const NEW_RAISES_SOURCE = `UKTN, Sifted and a Google News search for raise stories, read every morning at 05:20 UTC, plus a Google News search for each tracked company. A headline is kept when it says a company raised, secured or closed money; the company, the amount and the round are read from the headline, and the story is matched to a tracked company by name. Open the story for the detail before a call.`;

/**
 * "New raises this week" (slice 2): the raise stories of the last fortnight,
 * companies not yet tracked first with one click to add them, then the
 * ones already in the patch.
 */
export function NewRaisesCard({ title = "New raises this week" }: { title?: string }) {
  const { data, error, isLoading } = useQuery({ queryKey: ["new-raises"], queryFn: () => loadNewRaises(), staleTime: 300_000 });
  const groups = useMemo(() => groupRaises(data || [], NEW_RAISE_DAYS), [data]);
  const storyLink = (r: NewRaise) => (
    <a href={r.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline" title={r.title}>
      {r.publisher || "story"}<ExternalLink className="ml-0.5 inline h-3 w-3" aria-hidden="true" />
    </a>
  );
  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-base font-bold text-foreground">{title}</h2>
        <SourceNote text={NEW_RAISES_SOURCE} />
      </div>
      {isLoading && <p className="text-sm text-muted-foreground" role="status">Reading the funding news…</p>}
      {error && <p className="text-sm text-destructive" role="alert">Could not load: {(error as Error).message}</p>}
      {data && groups.untracked.length === 0 && groups.tracked.length === 0 && (
        <p className="text-sm text-muted-foreground">No raise story has come through from UKTN, Sifted or Google News in the last {NEW_RAISE_DAYS} days. The feeds are read every morning.</p>
      )}
      {groups.untracked.length > 0 && (
        <ul className="divide-y divide-border/60 text-sm">
          {groups.untracked.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
              <span className="text-foreground">{raiseLine(r)}</span>
              {storyLink(r)}
              <Link to={`/companies?add=${encodeURIComponent(raiseName(r))}`} className="text-xs font-medium text-primary hover:underline" title={`Add ${raiseName(r)} to the patch`}>
                <Plus className="mr-0.5 inline h-3 w-3" aria-hidden="true" />Add
              </Link>
            </li>
          ))}
        </ul>
      )}
      {groups.tracked.length > 0 && (
        <div className={groups.untracked.length ? "mt-3" : ""}>
          <h3 className="text-xs font-medium text-muted-foreground">Already in the patch</h3>
          <ul className="divide-y divide-border/60 text-sm">
            {groups.tracked.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
                <Link to={`/companies/${r.matchedCompanyId}`} className="font-medium text-foreground hover:underline">{raiseName(r)}</Link>
                <span className="text-muted-foreground">{raiseLine(r).replace(`${raiseName(r)} `, "")}</span>
                {storyLink(r)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data && (groups.untracked.length > 0 || groups.tracked.length > 0) && (
        <p className="mt-2 text-xs text-muted-foreground">A raise is the moment a start-up starts hiring. "Add" opens the Companies page with the register search filled in; confirm the right company and its website there.</p>
      )}
    </Card>
  );
}
