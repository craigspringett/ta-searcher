import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpDown, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { loadPatch, formatWhen, latestRaiseDetail, latestRaiseLine, OUTCOME_LABELS, stageLabel, type PatchCompany } from "@/lib/patch";
import { companyIsClosed, companyStatusLabel, STAGE_LABELS, STAGE_ORDER } from "@/lib/analysis";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AppHeader } from "@/components/AppHeader";
import { supabase } from "@/integrations/supabase/client";
import { BAND_CLASSES, scoreBand } from "@/lib/propensity";
import { NewRaisesCard } from "@/components/NewRaisesCard";
import { RadarLine } from "@/components/RadarLine";
import { FollowUpsDueCard } from "@/components/FollowUpsDueCard";
import { RepliesDueCard } from "@/components/RepliesCard";
import { WarmNowCard } from "@/components/WarmNowCard";
import { hasFeature } from "@/lib/features";

type SortKey = "name" | "stage" | "openRoles" | "talentRoles" | "raise" | "lastAnalysed" | "nextCallback" | "propensity";

/**
 * My patch: the signed-in consultant's companies, sortable by what matters
 * for a call list. A manager sees everyone's with a consultant filter.
 */
export default function MyPatch() {
  const { profile } = useAuth();
  // Follow-ups, behind profiles.features.follow_ups: the due steps and "Warm right now".
  const followUps = hasFeature(profile, "follow_ups");
  const navigate = useNavigate();
  const { data, error, isLoading, refetch } = useQuery({ queryKey: ["patch"], queryFn: loadPatch, staleTime: 60_000 });
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "propensity", dir: "desc" });
  const [rescoring, setRescoring] = useState<string | null>(null);
  const rescore = async () => {
    setRescoring("Recomputing…");
    const { data, error } = await supabase.functions.invoke("refresh-scores", { body: {} });
    setRescoring(error ? `Could not recompute: ${error.message}` : `Scored ${data?.companies ?? 0} companies`);
    await refetch();
  };
  const [stage, setStage] = useState("all");
  const [sector, setSector] = useState("all");
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
    if (stage !== "all") list = list.filter((s) => s.stage === stage);
    if (sector !== "all") list = list.filter((s) => s.sector === sector);
    if (q.trim()) { const needle = q.trim().toLowerCase(); list = list.filter((s) => s.name.toLowerCase().includes(needle)); }
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (s: PatchCompany): number | string => {
      switch (sort.key) {
        case "name": return s.name.toLowerCase();
        case "stage": return STAGE_ORDER.indexOf(s.stage);
        case "openRoles": return s.openRoles;
        case "talentRoles": return s.talentRoles;
        case "raise": return s.latestRaise?.amountGbp ?? (s.latestRaise ? 0 : -1);
        case "lastAnalysed": return s.lastAnalysed || "";
        case "nextCallback": return s.nextCallback || (sort.dir === "asc" ? "9999" : "");
        case "propensity": return s.propensity ?? -1;
      }
    };
    return [...list].sort((a, b) => { const x = val(a), y = val(b); return x < y ? -dir : x > y ? dir : a.name.localeCompare(b.name); });
  }, [data, consultant, stage, sector, q, sort, myConsultantIds]);

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
            <label htmlFor="patch-stage" className="text-xs text-muted-foreground block">Stage</label>
            <Select value={stage} onValueChange={setStage}><SelectTrigger id="patch-stage" className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All</SelectItem>{STAGE_ORDER.map((x) => <SelectItem key={x} value={x}>{STAGE_LABELS[x]}</SelectItem>)}</SelectContent></Select>
          </div>
          <div>
            <label htmlFor="patch-sector" className="text-xs text-muted-foreground block">Sector</label>
            <Select value={sector} onValueChange={setSector}><SelectTrigger id="patch-sector" className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All</SelectItem>{(data?.sectors || []).map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select>
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

        <RadarLine />

        {followUps && data && <RepliesDueCard />}
        {followUps && data && rows.length > 0 && <FollowUpsDueCard companies={rows} />}
        {followUps && data && rows.length > 0 && <WarmNowCard companies={rows} />}

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Companies in the patch</caption>
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  {header("name", "Company")}
                  {header("stage", "Stage")}
                  <th className="py-2 pr-3 text-left font-medium">Sector</th>
                  {consultant !== "mine" && <th className="py-2 pr-3 text-left font-medium">Consultants</th>}
                  {header("openRoles", "Open roles", "text-right")}
                  {header("talentRoles", "Talent roles", "text-right")}
                  {header("raise", "Latest raise", "text-left")}
                  {header("lastAnalysed", "Last analysed", "text-right")}
                  {header("nextCallback", "Next call", "text-right")}
                  {header("propensity", "Likely to buy", "text-right")}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const raise = latestRaiseLine(s.latestRaise);
                  const raiseDetail = latestRaiseDetail(s.latestRaise);
                  return (
                    <tr key={s.id} className="border-t border-border/60 hover:bg-muted/30">
                      <td className="py-2 pr-3 pl-3">
                        <button type="button" className="text-left font-medium text-foreground hover:underline" onClick={() => navigate(`/companies/${s.id}`)}>{s.name}</button>
                        {companyIsClosed(s.status) ? <span className="ml-2 rounded bg-critical/15 px-1.5 py-0.5 text-[10px] text-critical" title="Companies House lists the company as closed; it is not refreshed, alerted or scored again">{companyStatusLabel(s.status).toLowerCase()}</span> : s.websiteAccess ? <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" title="The site challenges every automated reader; the register and the careers feeds still come through">{s.websiteAccess}</span> : s.degraded && <span className="ml-2 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">website unreachable</span>}
                        {s.lastOutcome && <span className="block text-xs text-muted-foreground">{OUTCOME_LABELS[s.lastOutcome.kind] || s.lastOutcome.kind} {formatWhen(s.lastOutcome.at)}</span>}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground" title={s.stageEvidence || undefined}>{s.stage === "unknown" ? "" : stageLabel(s.stage)}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{s.sector || ""}</td>
                      {consultant !== "mine" && <td className="py-2 pr-3 text-muted-foreground">{s.consultantNames.join(", ")}</td>}
                      <td className="py-2 pr-3 text-right tabular-nums">{s.openRoles || ""}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{s.talentRoles ? <span className="font-semibold text-warning">{s.talentRoles}</span> : ""}</td>
                      <td className="py-2 pr-3 text-xs whitespace-nowrap" title={raiseDetail || undefined}>{raise || (s.latestRaise ? <span className="text-muted-foreground">round, size not stated</span> : "")}</td>
                      <td className="py-2 pr-3 text-right text-muted-foreground">{formatWhen(s.lastAnalysed)}</td>
                      <td className="py-2 pr-3 text-right">{s.nextCallback ? <span className="text-primary font-medium">{formatWhen(s.nextCallback)}</span> : ""}</td>
                      <td className="py-2 pr-3 text-right">
                        {s.propensity === null ? <span className="text-muted-foreground">–</span> : (
                          <span className={`inline-block min-w-9 rounded-md border px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums ${BAND_CLASSES[scoreBand(s.propensity)!]}`} title={s.propensityReasons.join("\n") || undefined}>{s.propensity}</span>
                        )}
                        {s.propensityReason && <span className="block max-w-72 truncate text-[11px] text-muted-foreground" title={s.propensityReason}>{s.propensityReason}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{rows.length} companies. "Stage" is the round the company describes itself as being at, from its own words, the funding news and the register (hover for the evidence). "Open roles" counts every live role on its careers feeds and careers page; "Talent roles" counts the ones in the people and talent family (a recruiter, a talent partner, a head of people), the roles this team places. "Latest raise" is the most recent round the evidence found; hover for the date and the investors. "Likely to buy" is the propensity score (0 to 100) from the company's signals and your call outcomes, recomputed after each analysis and every morning; open the company to see every line that made it.</p>

        <NewRaisesCard />
      </main>
    </div>
  );
}
