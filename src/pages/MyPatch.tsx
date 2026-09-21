import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpDown, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { loadPatch, formatMoney, formatWhen, OUTCOME_LABELS, type PatchCompany } from "@/lib/patch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AppHeader } from "@/components/AppHeader";
import { NewCompaniesCard } from "@/components/NewCompaniesCard";
import { WarmNowCard } from "@/components/WarmNowCard";
import { FollowUpsDueCard } from "@/components/FollowUpsDueCard";
import { hasFeature } from "@/lib/features";
import { supabase } from "@/integrations/supabase/client";
import { BAND_CLASSES, scoreBand } from "@/lib/propensity";
import { DIRECTION_ARROW, DIRECTION_CLASS, DIRECTION_LABEL, pct } from "@/lib/spend";
import { SourceNote } from "@/components/SourceNote";

const PP_TAS_SOURCE = "Our estimate from the company's own pupil premium strategy statement: the full-time-equivalent teaching assistants, HLTAs, mentors, tutors and intervention staff its pupil premium lines amount to in a week. Bold when the company states hours, FTE or a number of staff; 'est.' when only a pound figure is given, divided by the day rate on the Alerts page and 190 company days; blank when the statement gives nothing to work from. Open the company for the arithmetic and the quotes.";

type SortKey = "name" | "openVacancies" | "agencySpend" | "spendChange" | "ppTas" | "lastAnalysed" | "nextCallback" | "propensity";

/**
 * My patch: the signed-in consultant's companies, sortable by what matters
 * for a call list. A manager sees everyone's with a consultant filter.
 */
export default function MyPatch() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  // Follow-ups slice 1, behind profiles.features.follow_ups: "Warm right now".
  const followUps = hasFeature(profile, "follow_ups");
  const { data, error, isLoading, refetch } = useQuery({ queryKey: ["patch"], queryFn: loadPatch, staleTime: 60_000 });
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "propensity", dir: "desc" });
  const [rescoring, setRescoring] = useState<string | null>(null);
  const rescore = async () => {
    setRescoring("Recomputing…");
    const { data, error } = await supabase.functions.invoke("refresh-scores", { body: {} });
    setRescoring(error ? `Could not recompute: ${error.message}` : `Scored ${data?.companies ?? 0} companies`);
    await refetch();
  };
  const [la, setLa] = useState("all");
  const [phase, setPhase] = useState("all");
  const [consultant, setConsultant] = useState<string>("mine");
  const [q, setQ] = useState("");

  // The consultant rows that belong to this person: the linked one, plus any
  // others with the same email (a patch and a cold-targets list, say).
  const myConsultantIds = useMemo(() => {
    if (!data || !profile) return [] as string[];
    const email = profile.email.toLowerCase();
    return data.consultants.filter((c) => c.id === profile.consultant_id || (c.email || "").toLowerCase() === email).map((c) => c.id);
  }, [data, profile]);
  useEffect(() => {
    if (data && myConsultantIds.length === 0 && consultant === "mine") setConsultant("all");
  }, [data, myConsultantIds.length]);

  const rows = useMemo(() => {
    if (!data) return [] as PatchCompany[];
    let list = data.companies;
    if (consultant === "mine") list = list.filter((s) => s.consultantIds.some((id) => myConsultantIds.includes(id)));
    else if (consultant !== "all") list = list.filter((s) => s.consultantIds.includes(consultant));
    if (la !== "all") list = list.filter((s) => s.laName === la);
    if (phase !== "all") list = list.filter((s) => s.phase === phase);
    if (q.trim()) { const needle = q.trim().toLowerCase(); list = list.filter((s) => s.name.toLowerCase().includes(needle)); }
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (s: PatchCompany): number | string => {
      switch (sort.key) {
        case "name": return s.name.toLowerCase();
        case "openVacancies": return s.openVacancies;
        case "agencySpend": return s.agencySpend ?? -1;
        case "spendChange": return s.spendChange === null ? -999 : Number.isFinite(s.spendChange) ? s.spendChange : 999;
        case "ppTas": return s.ppTasPerWeek ?? -1;
        case "lastAnalysed": return s.lastAnalysed || "";
        case "nextCallback": return s.nextCallback || (sort.dir === "asc" ? "9999" : "");
        case "propensity": return s.propensity ?? -1;
      }
    };
    return [...list].sort((a, b) => { const x = val(a), y = val(b); return x < y ? -dir : x > y ? dir : a.name.localeCompare(b.name); });
  }, [data, consultant, la, phase, q, sort, myConsultantIds]);

  const header = (key: SortKey, label: string, align = "text-left") => (
    <th className={`py-2 pr-3 ${align}`}>
      <button type="button" className="inline-flex items-center gap-1 font-medium hover:text-foreground" onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }))} aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
        {label}<ArrowUpDown className="h-3 w-3 opacity-60" aria-hidden="true" />
      </button>
    </th>
  );

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="My patch" subtitle={<>{profile?.display_name || profile?.email}{myConsultantIds.length === 0 && data ? " · no companies are assigned to your address yet, so this shows everyone's" : ""}</>} />

      <main className="container mx-auto px-6 py-5 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <label htmlFor="patch-search" className="text-xs text-muted-foreground">Find</label>
            <Input id="patch-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Company name" />
          </div>
          <div>
            <label htmlFor="patch-la" className="text-xs text-muted-foreground block">Local authority</label>
            <Select value={la} onValueChange={setLa}><SelectTrigger id="patch-la" className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All</SelectItem>{(data?.las || []).map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select>
          </div>
          <div>
            <label htmlFor="patch-phase" className="text-xs text-muted-foreground block">Phase</label>
            <Select value={phase} onValueChange={setPhase}><SelectTrigger id="patch-phase" className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All</SelectItem>{(data?.phases || []).map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select>
          </div>
          <div>
            <label htmlFor="patch-consultant" className="text-xs text-muted-foreground block">Consultant</label>
            <Select value={consultant} onValueChange={setConsultant}><SelectTrigger id="patch-consultant" className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {myConsultantIds.length > 0 && <SelectItem value="mine">Mine</SelectItem>}
                <SelectItem value="all">Everyone</SelectItem>
                {(data?.consultants || []).filter((c) => c.active !== false).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent></Select>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void refetch()}>Reload</Button>
          <Button variant="ghost" size="sm" onClick={() => void rescore()} disabled={rescoring === "Recomputing…"}>Recompute scores</Button>
          {rescoring && <span className="text-xs text-muted-foreground" role="status">{rescoring}</span>}
        </div>

        {isLoading && <p className="text-sm text-muted-foreground" role="status"><Loader2 className="inline h-4 w-4 animate-spin mr-2" aria-hidden="true" />Loading your companies…</p>}
        {error && <p className="text-sm text-destructive" role="alert">Could not load: {(error as Error).message}</p>}
        {data && rows.length === 0 && <p className="text-sm text-muted-foreground">No companies match. Assign companies from the Companies page, or widen the filters.</p>}

        {followUps && data && rows.length > 0 && <FollowUpsDueCard companies={rows} />}
        {followUps && data && rows.length > 0 && <WarmNowCard companies={rows} />}

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Companies in the patch</caption>
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  {header("name", "Company")}
                  <th className="py-2 pr-3 text-left font-medium">LA</th>
                  <th className="py-2 pr-3 text-left font-medium">Phase</th>
                  {consultant !== "mine" && <th className="py-2 pr-3 text-left font-medium">Consultants</th>}
                  {header("openVacancies", "Open vacancies", "text-right")}
                  {header("agencySpend", "Agency spend", "text-right")}
                  {header("spendChange", "Trend", "text-left")}
                  <th className="py-2 pr-2 text-right whitespace-nowrap">
                    <button type="button" className="inline-flex items-center gap-1 font-medium hover:text-foreground" onClick={() => setSort((s) => ({ key: "ppTas", dir: s.key === "ppTas" && s.dir === "desc" ? "asc" : "desc" }))} aria-sort={sort.key === "ppTas" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                      TAs a week (PP)<ArrowUpDown className="h-3 w-3 opacity-60" aria-hidden="true" />
                    </button>
                    <SourceNote text={PP_TAS_SOURCE} label="How TAs a week is worked out" />
                  </th>
                  {header("lastAnalysed", "Last analysed", "text-right")}
                  {header("nextCallback", "Next call", "text-right")}
                  {header("propensity", "Likely to buy", "text-right")}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="border-t border-border/60 hover:bg-muted/30">
                    <td className="py-2 pr-3 pl-3">
                      <button type="button" className="text-left font-medium text-foreground hover:underline" onClick={() => navigate(`/companies/${s.id}`)}>{s.name}</button>
                      {s.websiteAccess ? <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" title="The site challenges every automated reader; the DfE record, the job boards and the spend still come through">{s.websiteAccess}</span> : s.degraded && <span className="ml-2 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">website unreachable</span>}
                      {s.lastOutcome && <span className="block text-xs text-muted-foreground">{OUTCOME_LABELS[s.lastOutcome.kind] || s.lastOutcome.kind} {formatWhen(s.lastOutcome.at)}</span>}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{s.laName || ""}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{s.phase || ""}</td>
                    {consultant !== "mine" && <td className="py-2 pr-3 text-muted-foreground">{s.consultantNames.join(", ")}</td>}
                    <td className="py-2 pr-3 text-right tabular-nums">{s.openVacancies || ""}</td>
                    <td className="py-2 pr-3 text-right tabular-nums" title={s.agencySpendYear ? `Supply and agency teaching staff, ${s.agencySpendYear}${s.spendPerPupil ? `; ${formatMoney(s.spendPerPupil)} per pupil` : ""} (DfE benchmarking)` : undefined}>{formatMoney(s.agencySpend)}</td>
                    <td className="py-2 pr-3 text-xs" title={s.spendSummary || undefined}>
                      {s.spendDirection ? <span className={`font-semibold ${DIRECTION_CLASS[s.spendDirection]}`}><span aria-hidden="true">{DIRECTION_ARROW[s.spendDirection]} </span>{s.spendChange !== null && Number.isFinite(s.spendChange) ? pct(s.spendChange) : DIRECTION_LABEL[s.spendDirection]}{s.spendRisingTwoYears ? <span className="text-muted-foreground"> ×2</span> : ""}</span> : <span className="text-muted-foreground">–</span>}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap" title={s.ppTasPerWeek !== null ? `${s.ppWorking.join(" ")}${s.ppYear ? ` Statement ${s.ppYear}.` : ""}` : undefined}>
                      {s.ppTasPerWeek === null ? "" : s.ppConfidence === "high" ? <span className="font-semibold text-foreground">{s.ppTasPerWeek}</span> : <span className="text-foreground">{s.ppTasPerWeek}<span className="ml-0.5 text-[10px] text-muted-foreground">est.</span></span>}
                    </td>
                    <td className="py-2 pr-3 text-right text-muted-foreground">{formatWhen(s.lastAnalysed)}</td>
                    <td className="py-2 pr-3 text-right">{s.nextCallback ? <span className="text-primary font-medium">{formatWhen(s.nextCallback)}</span> : ""}</td>
                    <td className="py-2 pr-3 text-right">
                      {s.propensity === null ? <span className="text-muted-foreground">–</span> : (
                        <span className={`inline-block min-w-9 rounded-md border px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums ${BAND_CLASSES[scoreBand(s.propensity)!]}`} title={s.propensityReasons.join("\n") || undefined}>{s.propensity}</span>
                      )}
                      {s.propensityReason && <span className="block max-w-72 truncate text-[11px] text-muted-foreground" title={s.propensityReason}>{s.propensityReason}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && (
          <NewCompaniesCard
            las={consultant === "all" ? null : Array.from(new Set(rows.map((s) => s.laName).filter((x): x is string => !!x)))}
            trackedUrns={new Set(data.companies.map((s) => s.urn).filter((x): x is string => !!x))}
            title={consultant === "all" ? "New companies in the patch" : "New companies in your patch"}
          />
        )}
        <p className="text-xs text-muted-foreground">{rows.length} companies. "Agency spend" is supply plus agency supply teaching staff in the latest published year (DfE benchmarking); "Trend" is the change on the year before, with ×2 when it has risen two years running. "Likely to buy" is the propensity score (0 to 100) from the company's signals and your call outcomes, recomputed after each analysis and every morning; open the company to see every line that made it. "TAs a week (PP)" is our estimate from the company's own pupil premium statement (bold when the company states hours or numbers, "est." from a pound figure, blank when nothing is stated).</p>
      </main>
    </div>
  );
}
