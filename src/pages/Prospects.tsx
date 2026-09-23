import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, ParkingSquare, Plus, Radar, Undo2, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { SourceNote } from "@/components/SourceNote";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ToastAction } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { BAND_CLASSES, scoreBand } from "@/lib/propensity";
import {
  boardsLine,
  CHIP_CLASSES,
  DISMISS_REASONS,
  discoverySummary,
  groupProspects,
  normaliseWebsite,
  postingLine,
  PROMOTED_DAYS,
  qualifySummary,
  scoreChips,
  shortDate,
  sourceKeyStates,
  sourceLines,
  websiteHost,
  prospectSector,
  stageLine,
  prospectStage,
  filterProspects,
  filterCounts,
  NO_FILTERS,
  type ProspectFilters,
  type Sector,
  type Stage,
  type Prospect,
} from "@/lib/prospects";
import { discoverProspects, dismissProspect, loadProspect, loadProspectsPage, parkProspect, qualifyProspects, replyError, unparkProspect } from "@/lib/prospectsData";

const PROSPECTS_SOURCE = `Every night at 05:30 UTC the radar reads the funding news (UKTN, Sifted and Google News searches for seed, pre-seed and Series A raises), walks the Companies House register for young technology companies in London and the Home Counties, and asks Adzuna and Reed for companies advertising a Head of Talent. At 05:40 it qualifies the newest sixty: the register, the website, the careers board, then a score. Nothing is added to the patch on its own: every prospect waits here until you add it.`;

/**
 * The Prospects page (Prospecting, slice 3): the companies the radar found
 * and qualified, ready to add or dismiss; the ones it added this month; what
 * it is still watching.
 */
export default function Prospects() {
  const { isManager } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, error, isLoading, refetch } = useQuery({ queryKey: ["prospects-page"], queryFn: () => loadProspectsPage(), staleTime: 60_000 });
  const groups = useMemo(() => groupProspects(data?.prospects || []), [data]);
  // Sector and stage filters over the ready list (21 September 2026).
  const [filters, setFilters] = useState<ProspectFilters>(NO_FILTERS);
  const counts = useMemo(() => filterCounts(groups.ready), [groups.ready]);
  const ready = useMemo(() => filterProspects(groups.ready, filters), [groups.ready, filters]);
  const toggleSector = (v: Sector) => setFilters((f) => ({ ...f, sectors: f.sectors.includes(v) ? f.sectors.filter((x) => x !== v) : [...f.sectors, v] }));
  const toggleStage = (v: Stage) => setFilters((f) => ({ ...f, stages: f.stages.includes(v) ? f.stages.filter((x) => x !== v) : [...f.stages, v] }));
  const filtering = filters.sectors.length > 0 || filters.stages.length > 0;
  const reload = async () => {
    await refetch();
    void queryClient.invalidateQueries({ queryKey: ["radar-counts"] });
  };

  // One prospect at a time is being added, dismissed or given a website.
  const [busy, setBusy] = useState<{ id: string; what: "add" | "dismiss" | "website" | "park" } | null>(null);
  const [dismissing, setDismissing] = useState<Prospect | null>(null);
  const [dismissReason, setDismissReason] = useState(DISMISS_REASONS[0].value);
  const [websiteDrafts, setWebsiteDrafts] = useState<Record<string, string>>({});

  /** Qualify one prospect again and add it; the company id when it went in, else the reason it did not. */
  const addOne = async (p: Prospect): Promise<{ companyId: string } | { reason: string }> => {
    const { status, data: reply } = await qualifyProspects({ prospectIds: [p.id], promote: true });
    const failure = replyError(status, reply);
    if (failure) return { reason: failure };
    const after = await loadProspect(p.id);
    if (after?.status === "promoted" && after.promotedCompanyId) return { companyId: after.promotedCompanyId };
    const note = reply.results?.find((r) => r.prospectId === p.id)?.note;
    return { reason: note || (after ? `${p.name} is ${after.status} after the check, with no company created.` : "The prospect could not be read back.") };
  };

  // Adding stays on this list (22 September 2026): the toast offers Open.
  const add = async (p: Prospect) => {
    setBusy({ id: p.id, what: "add" });
    try {
      const r = await addOne(p);
      if ("companyId" in r) {
        const companyId = r.companyId;
        toast({ title: "Added to your patch", description: `${p.name} is being analysed now; the scripts follow in a minute or two.`, action: <ToastAction altText={`Open ${p.name}`} onClick={() => navigate(`/companies/${companyId}`)}>Open</ToastAction> });
        setSelected((sel) => { const next = new Set(sel); next.delete(p.id); return next; });
      } else {
        toast({ title: "Not added", description: r.reason, variant: "destructive" });
      }
      await reload();
    } catch (e) {
      toast({ title: "Could not add", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  // Tick several and add them in one go, one after another so each gets
  // its own qualification and its own analysis run.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const toggleSelected = (id: string) => setSelected((sel) => { const next = new Set(sel); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const shownSelected = ready.filter((p) => selected.has(p.id));
  const allShownSelected = ready.length > 0 && shownSelected.length === ready.length;
  const toggleAllShown = () => setSelected((sel) => {
    const next = new Set(sel);
    if (allShownSelected) ready.forEach((p) => next.delete(p.id)); else ready.forEach((p) => next.add(p.id));
    return next;
  });

  const addSelected = async () => {
    const picked = shownSelected;
    if (picked.length === 0) return;
    setBulk({ done: 0, total: picked.length });
    const added: string[] = [];
    const failed: string[] = [];
    try {
      for (const p of picked) {
        setBusy({ id: p.id, what: "add" });
        try {
          const r = await addOne(p);
          if ("companyId" in r) added.push(p.name); else failed.push(`${p.name} (${r.reason})`);
        } catch (e) {
          failed.push(`${p.name} (${(e as Error).message})`);
        }
        setBulk((b) => (b ? { ...b, done: b.done + 1 } : b));
      }
    } finally {
      setBusy(null);
      setBulk(null);
    }
    setSelected(new Set());
    if (added.length > 0) toast({ title: `Added ${added.length} of ${picked.length} to your patch`, description: `${added.join(", ")}. Each is being analysed now; the scripts follow in a minute or two.${failed.length ? ` Not added: ${failed.join("; ")}.` : ""}` });
    else toast({ title: "Nothing added", description: failed.join("; "), variant: "destructive" });
    await reload();
  };

  // Park (23 September 2026): set aside; the radar brings it back on a
  // newer raise or a Head of Talent posting, or Bring back does by hand.
  const park = async (p: Prospect) => {
    setBusy({ id: p.id, what: "park" });
    try {
      await parkProspect(p.id);
      setSelected((sel) => { const next = new Set(sel); next.delete(p.id); return next; });
      toast({ title: "Parked", description: `${p.name} is set aside. It comes back on its own when the radar sees a new round or a talent role.` });
      await reload();
    } catch (e) {
      toast({ title: "Could not park", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };
  const unpark = async (p: Prospect) => {
    setBusy({ id: p.id, what: "park" });
    try {
      await unparkProspect(p.id);
      toast({ title: "Brought back", description: `${p.name} is back in the queue and will be qualified again on the next pass (05:40 UTC, or Run the radar now).` });
      await reload();
    } catch (e) {
      toast({ title: "Could not bring back", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };
  const parkSelected = async () => {
    const picked = shownSelected;
    if (picked.length === 0) return;
    setBulk({ done: 0, total: picked.length });
    let parked = 0;
    const failed: string[] = [];
    try {
      for (const p of picked) {
        setBusy({ id: p.id, what: "park" });
        try { await parkProspect(p.id); parked++; } catch (e) { failed.push(`${p.name} (${(e as Error).message})`); }
        setBulk((b) => (b ? { ...b, done: b.done + 1 } : b));
      }
    } finally {
      setBusy(null);
      setBulk(null);
    }
    setSelected(new Set());
    toast({ title: `Parked ${parked} of ${picked.length}`, description: failed.length ? `Not parked: ${failed.join("; ")}.` : "They come back on their own when the radar sees a new round or a talent role.", variant: failed.length && !parked ? "destructive" : undefined });
    await reload();
  };

  const saveWebsite = async (p: Prospect) => {
    const website = normaliseWebsite(websiteDrafts[p.id] || "");
    if (!website) { toast({ title: "Not a website", description: "Type the company's website, like metris.energy.", variant: "destructive" }); return; }
    setBusy({ id: p.id, what: "website" });
    try {
      const { status, data: reply } = await qualifyProspects({ prospectIds: [p.id], website, promote: false });
      const failure = replyError(status, reply);
      if (failure) throw new Error(failure);
      toast({ title: "Website saved", description: `${p.name} has been checked again with ${websiteHost(website)}.` });
      setWebsiteDrafts((d) => ({ ...d, [p.id]: "" }));
      await reload();
    } catch (e) {
      toast({ title: "Could not save the website", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const confirmDismiss = async () => {
    const p = dismissing;
    if (!p) return;
    setDismissing(null);
    setBusy({ id: p.id, what: "dismiss" });
    try {
      await dismissProspect(p.id, dismissReason);
      toast({ title: "Dismissed", description: `${p.name} will not come back for six months.` });
      await reload();
    } catch (e) {
      toast({ title: "Could not dismiss", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  // Run the radar now: discover, then qualify with the default limit.
  const [confirmRun, setConfirmRun] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const runRadar = async () => {
    setRunning("Reading the sources…");
    try {
      const discover = await discoverProspects();
      const dFail = replyError(discover.status, discover.data);
      if (dFail) throw new Error(`Discovery failed: ${dFail}`);
      setRunning("Qualifying the newest prospects…");
      const qualify = await qualifyProspects({});
      const qFail = replyError(qualify.status, qualify.data);
      if (qFail) throw new Error(`Qualification failed: ${qFail}`);
      const found = discover.data.inserted ?? 0;
      toast({ title: "The radar has run", description: `${found} new ${found === 1 ? "prospect" : "prospects"} found, ${qualify.data.qualified ?? 0} ready to add.` });
    } catch (e) {
      toast({ title: "The radar did not finish", description: (e as Error).message, variant: "destructive" });
    } finally {
      setRunning(null);
      await reload();
    }
  };

  const discovery = discoverySummary(data?.lastDiscovery ?? null);
  const qualify = qualifySummary(data?.lastQualify ?? null);
  const keys = sourceKeyStates(data?.lastDiscovery ?? null);
  const watchingTotal = data ? Math.max(data.newCount, groups.watching) : 0;
  const isBusy = (p: Prospect) => busy?.id === p.id;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Prospects" subtitle="The companies the radar found on its own, ready to add or dismiss" actions={<Button variant="ghost" size="sm" onClick={() => void reload()}>Reload</Button>} />

      <main className="container mx-auto px-6 py-5 space-y-5">
        {isLoading && <p className="text-sm text-muted-foreground" role="status"><Loader2 className="inline h-4 w-4 animate-spin mr-2" aria-hidden="true" />Loading the prospects…</p>}
        {error && <p className="text-sm text-destructive" role="alert">Could not load: {(error as Error).message}</p>}

        {data && (
          <>
            <Card className="p-5">
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-base font-bold text-foreground">Ready to add</h2>
                <SourceNote text={PROSPECTS_SOURCE} />
                <span className="text-xs text-muted-foreground">{filtering ? `${ready.length} of ${groups.ready.length}` : groups.ready.length} qualified, best first</span>
              </div>
              {groups.ready.length > 0 && (
                <div className="mb-3 space-y-2" aria-label="Filters">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-xs text-muted-foreground">Sector</span>
                    {counts.sectors.map((c) => {
                      const on = filters.sectors.includes(c.value);
                      return (
                        <button key={c.value} type="button" aria-pressed={on} onClick={() => toggleSector(c.value)} className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-muted"}`}>
                          {c.value} <span className={on ? "opacity-80" : "text-muted-foreground"}>{c.count}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-xs text-muted-foreground">Stage</span>
                    {counts.stages.map((c) => {
                      const on = filters.stages.includes(c.value);
                      return (
                        <button key={c.value} type="button" aria-pressed={on} onClick={() => toggleStage(c.value)} className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-muted"}`}>
                          {c.value} <span className={on ? "opacity-80" : "text-muted-foreground"}>{c.count}</span>
                        </button>
                      );
                    })}
                    {filtering && (
                      <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setFilters(NO_FILTERS)}>Clear filters</Button>
                    )}
                  </div>
                </div>
              )}
              {groups.ready.length === 0 && (
                <p className="text-sm text-muted-foreground">Nothing is waiting. The radar qualifies its newest prospects every morning at 05:40 UTC and adds the best on its own; the rest appear here.</p>
              )}
              {groups.ready.length > 0 && ready.length === 0 && (
                <p className="text-sm text-muted-foreground">No prospect matches those filters.</p>
              )}
              {ready.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <Checkbox checked={allShownSelected} onCheckedChange={toggleAllShown} disabled={!!bulk || !!running} aria-label="Select every prospect shown" />
                    {allShownSelected ? "Clear the selection" : `Select all ${ready.length} shown`}
                  </label>
                  <span className="text-xs text-muted-foreground">{shownSelected.length === 0 ? "Tick prospects to add several at once." : `${shownSelected.length} selected`}</span>
                  {shownSelected.length > 0 && (
                    <Button size="sm" onClick={() => void addSelected()} disabled={!!bulk || !!busy || !!running}>
                      {bulk ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
                      {bulk ? `Adding ${Math.min(bulk.done + 1, bulk.total)} of ${bulk.total}…` : `Add ${shownSelected.length} to my patch`}
                    </Button>
                  )}
                  {shownSelected.length > 0 && (
                    <Button size="sm" variant="outline" onClick={() => void parkSelected()} disabled={!!bulk || !!busy || !!running} title="Set these aside; the radar brings each back when it sees a new round or a talent role">
                      <ParkingSquare className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Park {shownSelected.length}
                    </Button>
                  )}
                </div>
                )}
              {ready.length > 0 && (
                <ul className="divide-y divide-border/60" aria-label="Prospects ready to add">
                  {ready.map((p) => {
                    const band = scoreBand(p.score);
                    const chips = scoreChips(p.scoreReasons);
                    const sources = sourceLines(p.sources);
                    const boards = boardsLine(p.boards);
                    const inputId = `website-${p.id}`;
                    return (
                      <li key={p.id} className="py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <Checkbox className="mt-1" checked={selected.has(p.id)} onCheckedChange={() => toggleSelected(p.id)} disabled={!!bulk || !!running} aria-label={`Select ${p.name}`} />
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-foreground">{p.name}</span>
                              {p.score !== null && band ? (
                                <span className={`inline-block min-w-9 rounded-md border px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums ${BAND_CLASSES[band]}`} aria-label={`Score ${p.score} out of 100`}>{p.score}</span>
                              ) : (
                                <span className="text-xs text-muted-foreground">not scored</span>
                              )}
                              {p.website ? (
                                <a href={p.website} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                                  {websiteHost(p.website)}<ExternalLink className="ml-0.5 inline h-3 w-3" aria-hidden="true" />
                                </a>
                              ) : (
                                <span className="text-xs text-warning">website not found</span>
                              )}
                              {p.companyNumber && p.register?.status && <span className="text-xs text-muted-foreground">{p.register.status} on the register{p.register.incorporationDate ? `, incorporated ${p.register.incorporationDate.slice(0, 4)}` : ""}</span>}
                            </div>
                            {p.wakeNote && <p className="text-xs font-medium text-primary">{p.wakeNote}</p>}
                            <div className="flex flex-wrap items-center gap-1.5 text-xs">
                              <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-medium text-foreground">{prospectSector(p)}</span>
                              <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-medium text-foreground">{prospectStage(p)}</span>
                              <span className="text-muted-foreground">{stageLine(p)}</span>
                            </div>
                            {!p.website && (
                              <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void saveWebsite(p); }}>
                                <label htmlFor={inputId} className="text-xs text-muted-foreground">Add the website</label>
                                <Input id={inputId} className="h-8 w-64" placeholder="company.com" value={websiteDrafts[p.id] || ""} onChange={(e) => setWebsiteDrafts((d) => ({ ...d, [p.id]: e.target.value }))} disabled={isBusy(p)} />
                                <Button type="submit" size="sm" variant="outline" disabled={isBusy(p) || !(websiteDrafts[p.id] || "").trim()}>
                                  {busy?.id === p.id && busy.what === "website" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}Save
                                </Button>
                              </form>
                            )}
                            {chips.length > 0 && (
                              <ul className="flex flex-wrap gap-1" aria-label={`Why ${p.name} scores ${p.score ?? "nothing"}`}>
                                {chips.map((c) => (
                                  <li key={c.label} className={`rounded-full border px-2 py-0.5 text-[11px] ${CHIP_CLASSES[c.tone]}`}>{c.label}</li>
                                ))}
                              </ul>
                            )}
                            {sources.length > 0 && (
                              <ul className="space-y-0.5 text-xs" aria-label={`Where ${p.name} came from`}>
                                {sources.map((s) => (
                                  <li key={s.key} className="text-muted-foreground">
                                    <span className="font-medium text-foreground">{s.label}</span>
                                    {": "}
                                    {s.url ? (
                                      <a href={s.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{s.text}<ExternalLink className="ml-0.5 inline h-3 w-3" aria-hidden="true" /></a>
                                    ) : s.text}
                                    {s.at ? ` (${shortDate(s.at)})` : ""}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {boards && <p className="text-xs text-muted-foreground">Board: {boards}</p>}
                            {p.talentPostings.length > 0 && (
                              <p className="text-xs text-muted-foreground">
                                Advertising: {p.talentPostings.map((t, i) => (
                                  <span key={`${t.title}-${i}`}>
                                    {i > 0 ? "; " : ""}
                                    {t.url ? <a href={t.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{postingLine(t)}</a> : postingLine(t)}
                                  </span>
                                ))}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Button size="sm" onClick={() => void add(p)} disabled={isBusy(p) || !!bulk || !!running} title={p.website ? undefined : "The radar adds a company from its website; save one first."}>
                              {busy?.id === p.id && busy.what === "add" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}Add to my patch
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => void park(p)} disabled={isBusy(p) || !!bulk} title="Set aside; the radar brings it back when it sees a new round or a talent role">
                              {busy?.id === p.id && busy.what === "park" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ParkingSquare className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}Park
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => { setDismissReason(DISMISS_REASONS[0].value); setDismissing(p); }} disabled={isBusy(p) || !!bulk}>
                              <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Dismiss
                            </Button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {groups.ready.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">"Add to my patch" qualifies the company again, adds it with its website and its board, and starts the full analysis; you stay here, and the message offers Open. Tick several and press "Add … to my patch" or "Park …" to do them in one go. "Park" sets a company aside (too early, say) and the radar brings it back here on its own when it sees a newer round or a Head of Talent role. A dismissed company stays away for six months.</p>
              )}
            </Card>

            <Card className="p-5">
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-base font-bold text-foreground">Parked</h2>
                <span className="text-xs text-muted-foreground">{groups.parked.length} set aside, newest first</span>
              </div>
              {groups.parked.length === 0 && <p className="text-sm text-muted-foreground">Nothing parked. Park a company that is too early, and the radar brings it back when it sees a newer round or a Head of Talent role.</p>}
              {groups.parked.length > 0 && (
                <ul className="divide-y divide-border/60 text-sm" aria-label="Parked prospects">
                  {groups.parked.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="font-medium text-foreground">{p.name}</span>
                        <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">{prospectStage(p)}</span>
                        <span className="text-xs text-muted-foreground">{stageLine(p)}</span>
                        {p.website && <a href={p.website} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">{websiteHost(p.website)}</a>}
                        <span className="text-xs text-muted-foreground">parked {shortDate(p.parkedAt)}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => void unpark(p)} disabled={isBusy(p) || !!bulk}>
                          {busy?.id === p.id && busy.what === "park" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Undo2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}Bring back
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setDismissReason(DISMISS_REASONS[0].value); setDismissing(p); }} disabled={isBusy(p) || !!bulk}>
                          <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Dismiss
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-5">
              <h2 className="mb-2 text-base font-bold text-foreground">Added from the radar</h2>
              {groups.promoted.length === 0 && <p className="text-sm text-muted-foreground">No prospect has been added to the patch in the last {PROMOTED_DAYS} days. The radar never adds one on its own; they wait above until you add them.</p>}
              {groups.promoted.length > 0 && (
                <ul className="divide-y divide-border/60 text-sm" aria-label="Companies the radar added this month">
                  {groups.promoted.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
                      {p.promotedCompanyId ? (
                        <Link to={`/companies/${p.promotedCompanyId}`} className="font-medium text-foreground hover:underline">{p.name}</Link>
                      ) : (
                        <span className="font-medium text-foreground">{p.name}</span>
                      )}
                      {p.score !== null && <span className="text-xs text-muted-foreground">scored {p.score}</span>}
                      <span className="text-xs text-muted-foreground">added {shortDate(p.promotedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-5">
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <h2 className="text-base font-bold text-foreground">Watching</h2>
                <Button size="sm" variant="outline" onClick={() => setConfirmRun(true)} disabled={!!running || !!busy}>
                  {running ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Radar className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}Run the radar now
                </Button>
                {running && <span className="text-xs text-muted-foreground" role="status">{running}</span>}
              </div>
              <p className="text-sm text-foreground">
                {watchingTotal === 0 ? "Nothing is waiting to be qualified." : `${watchingTotal} ${watchingTotal === 1 ? "prospect is" : "prospects are"} waiting to be qualified.`}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4" aria-label="New prospects by source">
                {groups.watchingBySource.map((w) => (
                  <div key={w.source} className="flex items-baseline justify-between gap-2 sm:block">
                    <dt className="text-xs text-muted-foreground">{w.label}</dt>
                    <dd className="tabular-nums text-foreground">{w.count}</dd>
                  </div>
                ))}
              </dl>
              {data.newCount > groups.watching && <p className="mt-1 text-xs text-muted-foreground">The counts by source cover the newest {groups.watching} of {data.newCount}.</p>}
              <dl className="mt-3 space-y-1 border-t border-border/50 pt-3 text-sm" aria-label="Last runs">
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-muted-foreground">Last discovery run</dt>
                  <dd className="text-foreground">{discovery ? `${discovery.when}: ${discovery.text}` : "not run yet"}</dd>
                </div>
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-muted-foreground">Last qualification run</dt>
                  <dd className="text-foreground">{qualify ? `${qualify.when}: ${qualify.text}` : "not run yet"}</dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-muted-foreground">Discovery reads the sources at 05:30 UTC and qualification follows at 05:40, sixty prospects a night. "Run the radar now" does both at once and takes a few minutes.</p>
            </Card>

            <Card className="p-5">
              <h2 className="mb-2 text-base font-bold text-foreground">Sources</h2>
              <p className="text-xs text-muted-foreground">The radar only fills this page; nothing joins the patch until you add it. Each company you add costs about a penny on Gemini and a few pence on Claude for the scripts.</p>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4" aria-label="Sources">
                <div><dt className="text-xs text-muted-foreground">Funding news</dt><dd className="text-foreground">on</dd></div>
                <div><dt className="text-xs text-muted-foreground">Companies House</dt><dd className="text-foreground">on</dd></div>
                <div><dt className="text-xs text-muted-foreground">Adzuna</dt><dd className={keys.adzuna === "on" ? "text-foreground" : "text-warning"}>{keys.adzuna}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Reed</dt><dd className={keys.reed === "on" ? "text-foreground" : "text-warning"}>{keys.reed}</dd></div>
              </dl>
              {(keys.adzuna !== "on" || keys.reed !== "on") && <p className="mt-1 text-xs text-muted-foreground">Adzuna and Reed need a free API key each, set as the ADZUNA_APP_ID, ADZUNA_APP_KEY and REED_API_KEY secrets on the project; a source with no key is skipped and the run says so.</p>}
            </Card>
          </>
        )}
      </main>

      <AlertDialog open={!!dismissing} onOpenChange={(open) => { if (!open) setDismissing(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dismiss {dismissing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>The radar will not list this company again for six months. Say why, so the sources can be tuned.</AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <label htmlFor="dismiss-reason" className="block text-xs text-muted-foreground">Reason</label>
            <Select value={dismissReason} onValueChange={setDismissReason}>
              <SelectTrigger id="dismiss-reason" className="w-60"><SelectValue /></SelectTrigger>
              <SelectContent>{DISMISS_REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDismiss()}>Dismiss</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmRun} onOpenChange={setConfirmRun}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run the radar now?</AlertDialogTitle>
            <AlertDialogDescription>This reads every source (the funding news, the register, Adzuna and Reed), then qualifies the newest sixty prospects and adds the ones that clear the score, up to the weekly cap. It takes a few minutes and each company added costs a few pence to analyse.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmRun(false); void runRadar(); }}>Run it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
