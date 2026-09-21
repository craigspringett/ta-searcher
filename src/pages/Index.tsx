import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { BarChart3, Bell, BellRing, Briefcase, Building2, CheckCircle2, Coins, Loader2, RefreshCw, Search, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, Json } from "@/integrations/supabase/types";
import { AppHeader } from "@/components/AppHeader";
import { AddCompanyForm, type AnalyseInput } from "@/components/AddCompanyForm";
import { AllRolesTab, type PortfolioRole } from "@/components/AllRolesTab";
import { AnalysisProgress } from "@/components/AnalysisProgress";
import { CompanyRegisterCard } from "@/components/CompanyRegisterCard";
import { ContactEditDialog, type ContactEditMode } from "@/components/ContactEditDialog";
import { ContactsCard, type ContactFeedbackKind } from "@/components/ContactsCard";
import { OpenRolesCard } from "@/components/OpenRolesCard";
import { OutcomesCard } from "@/components/OutcomesCard";
import { PropensityCard } from "@/components/PropensityCard";
import { ScriptsCard, type Persona, type StoredCopy } from "@/components/ScriptsCard";
import { SignalsCard } from "@/components/SignalsCard";
import { VacancyHistory } from "@/components/VacancyHistory";
import type { AnalysisResult, DecisionMaker } from "@/lib/analysis";
import { contactKeyOf, mergeContacts, removedContacts, type MergedContact } from "@/lib/contacts";
import { useCompanyContactEdits } from "@/lib/contactEditsData";
import { describeFunctionError } from "@/lib/format";
import { countTalentRoles, raisedWithin, stageLabel } from "@/lib/patch";

interface SearchHistory {
  id: string;
  url: string;
  companyNumber: string | null;
  companyName: string;
  result: AnalysisResult;
  timestamp: number;
}

/** The personas written in the background after a manual analysis; the founder copy comes back inline. */
const OTHER_PERSONAS: Persona[] = ["coo", "people", "cto", "investor"];

const SECTION_LINKS: Array<[string, string]> = [["summary", "Summary"], ["signals", "Signals"], ["roles", "Open roles"], ["people", "People"], ["scripts", "Scripts"], ["calls", "Calls"]];

/** "Searchable" from https://www.searchable.ai when the analysis names nothing better. */
function extractCompanyName(url: string): string {
  try {
    const domain = new URL(url).hostname.replace("www.", "");
    return domain.split(".")[0].split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  } catch {
    return url;
  }
}

const displayName = (h: SearchHistory): string => h.result?.companyRecord?.name || h.companyName;

/**
 * The Companies page: the portfolio overview and every open role across it,
 * the list of tracked companies with refresh and assignment, the add form
 * (Companies House search, then the website), and the company page itself
 * on the right: summary and register, signals, open roles, people, scripts,
 * calls. /companies/:id opens one company directly.
 */
const Index = () => {
  const navigate = useNavigate();
  const { id: routeCompanyId } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<SearchHistory[]>([]);
  const [historyFilter, setHistoryFilter] = useState("");
  const [currentSearchUrl, setCurrentSearchUrl] = useState("");
  const [analysisStage, setAnalysisStage] = useState<string | null>(null);
  const [analysisElapsed, setAnalysisElapsed] = useState(0);
  const analysisRunRef = useRef<number | null>(null);
  const [consultantFilter, setConsultantFilter] = useState<string>("all");
  const [alertCount, setAlertCount] = useState(0);
  const [bulkRefresh, setBulkRefresh] = useState<{ startedAt: string; ids: string[]; done: number; label: string; lastChangeAt: number } | null>(null);
  const [outcomesKey, setOutcomesKey] = useState(0);

  const activeCompany = searchHistory.find((h) => h.url === currentSearchUrl) ?? null;
  const activeCompanyId = activeCompany?.id ?? null;

  // Contact edits: the consultants' corrections, laid over the stored
  // contacts at read time so the weekly refresh keeps them. Every use of a
  // contact on this page goes through mergedContacts.
  const contactEdits = useCompanyContactEdits(activeCompanyId);
  const mergedContacts = useMemo(() => mergeContacts(result?.decisionMakers || [], contactEdits.data || []), [result, contactEdits.data]);
  const removedList = useMemo(() => removedContacts(result?.decisionMakers || [], contactEdits.data || []), [result, contactEdits.data]);
  const [contactEditMode, setContactEditMode] = useState<ContactEditMode | null>(null);

  /** Headers for a direct call to an edge function: the signed-in user's token, never the anon key. */
  const functionHeaders = async (): Promise<Record<string, string>> => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("You are signed out. Sign in again.");
    return { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string, Authorization: `Bearer ${token}` };
  };

  // Consultants and assignments are data (consultants, company_consultants).
  const [consultants, setConsultants] = useState<Tables<"consultants">[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const loadConsultantsAndAssignments = async () => {
    const [c, a] = await Promise.all([
      supabase.from("consultants").select("*").order("name"),
      supabase.from("company_consultants").select("company_search_id, consultant_id"),
    ]);
    if (c.error) console.error("consultants load failed:", c.error.message); else setConsultants(c.data || []);
    if (a.error) console.error("assignments load failed:", a.error.message);
    else {
      const map: Record<string, string[]> = {};
      for (const row of a.data || []) (map[row.company_search_id] ||= []).push(row.consultant_id);
      setAssignments(map);
    }
  };
  useEffect(() => { void loadConsultantsAndAssignments(); }, []);
  const consultantNamesFor = (companyId: string): string[] =>
    (assignments[companyId] || []).map((id) => consultants.find((c) => c.id === id)?.name).filter((n): n is string => !!n).sort();
  const toggleAssignment = async (companyId: string, consultantId: string, assigned: boolean) => {
    const { error, count } = assigned
      ? await supabase.from("company_consultants").delete({ count: "exact" }).eq("company_search_id", companyId).eq("consultant_id", consultantId)
      : await supabase.from("company_consultants").insert({ company_search_id: companyId, consultant_id: consultantId });
    if (error) {
      toast({ title: "Could not change the assignment", description: error.message, variant: "destructive" });
      return;
    }
    if (assigned && count === 0) {
      // Row security refused it silently: only the consultant themselves or a manager can unassign.
      toast({ title: "Not removed", description: "Only that consultant or a manager can remove this assignment.", variant: "destructive" });
      return;
    }
    await Promise.all([loadConsultantsAndAssignments(), loadSearchHistory()]);
  };

  const loadSearchHistory = async () => {
    const { data, error } = await supabase.from("company_searches").select("id, url, company_number, company_name, analysis_result, created_at, updated_at").order("created_at", { ascending: false });
    if (error) { console.error("company_searches load failed:", error.message); return; }
    setSearchHistory((data || []).map((item) => ({
      id: item.id,
      url: item.url,
      companyNumber: item.company_number ?? null,
      companyName: item.company_name,
      result: (item.analysis_result || {}) as unknown as AnalysisResult,
      timestamp: new Date(item.updated_at || item.created_at).getTime(),
    })));
  };

  // The list, kept live: any change to company_searches reloads it.
  useEffect(() => {
    void loadSearchHistory();
    const channel = supabase
      .channel("company_searches_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "company_searches" }, () => { void loadSearchHistory(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    supabase.from("vacancy_alert_settings").select("id").then(({ data }) => setAlertCount(data?.length || 0));
  }, []);

  /** Insert or update the company_searches row for this URL. Assignments live in company_consultants, not the JSON. */
  const saveToHistory = async (url: string, companyNumber: string | null, companyName: string | null, analysis: AnalysisResult) => {
    if (!analysis || typeof analysis !== "object") throw new Error("Invalid analysis result structure");
    const name = analysis.companyRecord?.name || companyName || extractCompanyName(url);
    const { data: existing, error: searchError } = await supabase.from("company_searches").select("id, analysis_result").eq("url", url).maybeSingle();
    if (searchError) throw searchError;
    const row = { company_name: name, company_number: companyNumber, analysis_result: analysis as unknown as Json, updated_at: new Date().toISOString() };
    if (existing) {
      const { error } = await supabase.from("company_searches").update(row).eq("id", existing.id);
      if (error) throw error;
      return;
    }
    const { error: insertError } = await supabase.from("company_searches").insert([{ url, company_number: companyNumber, company_name: name, analysis_result: analysis as unknown as Json }]);
    if (insertError) {
      // A unique violation means another tab or the nightly run got there first: update instead.
      if (insertError.code !== "23505") throw insertError;
      const { error } = await supabase.from("company_searches").update(row).eq("url", url);
      if (error) throw error;
    }
  };

  const handleAnalyze = async (input: AnalyseInput, refresh = false) => {
    const targetUrl = input.url.trim();
    if (!targetUrl) {
      toast({ title: "No website", description: "Enter the company's website address.", variant: "destructive" });
      return;
    }
    const existingSearch = searchHistory.find((search) => search.url.toLowerCase() === targetUrl.toLowerCase());
    if (existingSearch && !refresh) {
      toast({ title: "Already tracked", description: "This company is in the list. Open it there, or press Refresh to analyse it again.", variant: "destructive" });
      setResult(existingSearch.result);
      setCurrentSearchUrl(existingSearch.url);
      navigate(`/companies/${existingSearch.id}`);
      return;
    }

    setIsAnalyzing(true);
    setResult(null);
    setCurrentSearchUrl(targetUrl);

    // Real progress: the function writes its stage to company_refresh_runs as
    // it goes; poll that row for a company we already hold. A brand-new
    // company has no row until the end, so it only gets the elapsed time.
    const startedAtMs = Date.now();
    const progressCompanyId = existingSearch?.id || null;
    const runToken = startedAtMs;
    analysisRunRef.current = runToken;
    setAnalysisStage(null);
    setAnalysisElapsed(0);
    const progressInterval = setInterval(async () => {
      setAnalysisElapsed(Math.round((Date.now() - startedAtMs) / 1000));
      if (!progressCompanyId) return;
      const { data } = await supabase.from("company_refresh_runs").select("notes, finished_at").eq("company_search_id", progressCompanyId).gte("started_at", new Date(startedAtMs - 60000).toISOString()).order("started_at", { ascending: false }).limit(1).maybeSingle();
      if (analysisRunRef.current !== runToken) return;
      const stage = (data?.notes as { stage?: string } | null)?.stage;
      if (stage) setAnalysisStage(stage);
    }, 3000);

    try {
      const { data, error } = await supabase.functions.invoke("analyze-company", {
        body: { url: targetUrl, companyNumber: input.companyNumber || undefined, companyName: input.companyName || undefined },
      });
      if (analysisRunRef.current !== runToken) { await loadSearchHistory(); return; }
      if (error) throw error;
      if (!data) throw new Error("No data returned from analysis");

      const analysis = data as AnalysisResult;
      setResult(analysis);
      try {
        await saveToHistory(targetUrl, input.companyNumber, input.companyName, analysis);
        toast({ title: "Analysis complete", description: "The company has been analysed and saved." });
        void requestOtherPersonas(targetUrl);
      } catch (saveError) {
        console.error("Failed to save to history:", saveError);
        toast({ title: "Analysis complete", description: "The analysis could not be saved to the list. Try again in a moment.", variant: "destructive" });
      }
    } catch (error) {
      console.error("Error analysing:", error);
      toast({ title: "Analysis failed", description: await describeFunctionError(error), variant: "destructive" });
    } finally {
      clearInterval(progressInterval);
      if (analysisRunRef.current === runToken) {
        analysisRunRef.current = null;
        setIsAnalyzing(false);
      }
    }
  };

  /** Stop waiting. The analysis carries on server-side and the list updates when it lands. */
  const cancelWaitingForAnalysis = () => {
    analysisRunRef.current = null;
    setIsAnalyzing(false);
    toast({ title: "Stopped waiting", description: "The analysis carries on in the background; the company updates in the list when it finishes." });
  };

  const handleNewSearch = () => {
    setResult(null);
    setCurrentSearchUrl("");
    if (routeCompanyId) navigate("/companies");
  };

  const handleViewPreviousSearch = (search: SearchHistory) => {
    setResult(search.result);
    setCurrentSearchUrl(search.url);
    if (routeCompanyId !== search.id) navigate(`/companies/${search.id}`);
  };

  // /companies/:id opens that company once the history has loaded, so a
  // reload keeps its place and links can be shared.
  useEffect(() => {
    if (!routeCompanyId || searchHistory.length === 0) return;
    const match = searchHistory.find((h) => h.id === routeCompanyId);
    if (match && currentSearchUrl !== match.url) {
      setResult(match.result);
      setCurrentSearchUrl(match.url);
    }
  }, [routeCompanyId, searchHistory]);

  const handleRefreshSearch = (search: SearchHistory) =>
    handleAnalyze({ url: search.url, companyNumber: search.companyNumber, companyName: displayName(search) }, true);

  // Bulk refresh runs on the server: refresh-all-companies queues the
  // companies and pg_cron dispatches ten a minute; progress is read from
  // company_refresh_runs, so closing the tab changes nothing.
  const isRefreshingAll = bulkRefresh !== null;
  const refreshProgress = { current: bulkRefresh?.done ?? 0, total: bulkRefresh?.ids.length ?? 0 };

  const startBulkRefresh = async (companies: SearchHistory[], label: string) => {
    const ids = companies.map((s) => s.id).filter(Boolean);
    if (ids.length === 0) return;
    const startedAt = new Date().toISOString();
    try {
      const { data, error } = await supabase.functions.invoke("refresh-all-companies", { body: { companyIds: ids } });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      setBulkRefresh({ startedAt, ids, done: 0, label, lastChangeAt: Date.now() });
      toast({ title: `Refreshing ${ids.length} ${ids.length === 1 ? "company" : "companies"}`, description: "Queued on the server, ten a minute. You can carry on working; the list updates as each finishes." });
    } catch (e) {
      toast({ title: "Could not start the refresh", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  useEffect(() => {
    if (!bulkRefresh) return;
    let cancelled = false;
    const tick = async () => {
      // Finished runs since the refresh started, counted here against the
      // selected ids (an .in() with hundreds of ids would exceed the URL limit).
      const { data: finished, error } = await supabase
        .from("company_refresh_runs")
        .select("company_search_id")
        .gte("started_at", bulkRefresh.startedAt)
        .not("finished_at", "is", null)
        .limit(2000);
      if (cancelled || error) return;
      const wanted = new Set(bulkRefresh.ids);
      const done = new Set((finished || []).map((r) => r.company_search_id).filter((id) => wanted.has(id))).size;
      const stalledFor = Date.now() - bulkRefresh.lastChangeAt;
      if (done >= bulkRefresh.ids.length || stalledFor > 15 * 60 * 1000) {
        setBulkRefresh(null);
        await loadSearchHistory();
        toast({ title: done >= bulkRefresh.ids.length ? "Refresh finished" : "Refresh stopped", description: `${done} of ${bulkRefresh.ids.length} companies refreshed${done < bulkRefresh.ids.length ? "; the rest did not report back within 15 minutes (see Monitoring)" : ""}.` });
        return;
      }
      if (done !== bulkRefresh.done) {
        setBulkRefresh({ ...bulkRefresh, done, lastChangeAt: Date.now() });
        await loadSearchHistory();
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 6000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [bulkRefresh?.startedAt, bulkRefresh?.done]);

  const handleRefreshAll = async () => {
    const isFiltered = consultantFilter !== "all" || historyFilter;
    await startBulkRefresh(isFiltered ? filteredHistory : searchHistory, isFiltered ? "filtered" : "all");
  };

  // "Wrong or bounced" on a decision-maker contact: recorded by
  // handle-contact-feedback; the contact is suppressed on the next refresh
  // and its address is never guessed again.
  const reportContact = async (person: MergedContact<DecisionMaker>, kind: ContactFeedbackKind) => {
    if (!activeCompanyId) {
      toast({ title: "Cannot report this contact", description: "Open the company from the list first.", variant: "destructive" });
      return;
    }
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/handle-contact-feedback`, {
        method: "POST",
        headers: await functionHeaders(),
        body: JSON.stringify({ companySearchId: activeCompanyId, email: person.email || undefined, name: person.name || undefined, role: person.role || undefined, kind }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.reason || `HTTP ${res.status}`);
      // The list shown is the merged one, so match the stored entry by its key, not by identity.
      const key = person.contactKey || contactKeyOf(person);
      setResult((prev) => prev ? { ...prev, decisionMakers: (prev.decisionMakers || []).map((p) => (contactKeyOf(p) === key ? { ...p, feedback: kind } : p)) } : prev);
      toast({ title: "Thanks, recorded", description: "This contact will be left out of the next refresh." });
    } catch (e) {
      toast({ title: "Could not record feedback", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  // Per-persona copy. generate-copy applies the evidence-fingerprint rule
  // unless force is set. The bearer is the signed-in user's token.
  const [regenerating, setRegenerating] = useState<Persona | null>(null);
  const callGenerateCopy = async (companyId: string, personas: Persona[], force: boolean) => {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-copy`, {
      method: "POST",
      headers: await functionHeaders(),
      body: JSON.stringify({ companyId, personas, force, trigger: force ? "regenerate" : "manual" }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || `generate-copy failed (${res.status})`);
    return body as { personas: Record<string, { status: string; error?: string; copy?: StoredCopy }> };
  };
  const regenerateCopy = async (persona: Persona) => {
    if (!activeCompanyId) {
      toast({ title: "Cannot regenerate yet", description: "Open the company from the list first.", variant: "destructive" });
      return;
    }
    setRegenerating(persona);
    try {
      const out = await callGenerateCopy(activeCompanyId, [persona], true);
      const r = out.personas?.[persona];
      if (r?.status === "generated" && r.copy) {
        setResult((prev) => (prev ? { ...prev, copy: { ...(prev.copy || {}), [persona]: r.copy } } : prev));
        toast({ title: "Scripts rewritten", description: r.copy.quality_flags?.length ? `Check before use: ${r.copy.quality_flags.join("; ")}` : "Written from today's evidence." });
        await loadSearchHistory();
      } else {
        throw new Error(r?.error || "The writer did not return anything");
      }
    } catch (e) {
      toast({ title: "Could not regenerate", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setRegenerating(null);
    }
  };
  // After a manual analysis the founder copy comes back inline; the other
  // personas are written in the background and appear on the next reload.
  const requestOtherPersonas = async (companyUrl: string) => {
    try {
      const { data } = await supabase.from("company_searches").select("id").eq("url", companyUrl).maybeSingle();
      if (data?.id) await callGenerateCopy(data.id, OTHER_PERSONAS, false);
      await loadSearchHistory();
    } catch (e) {
      console.warn("background copy generation failed:", e);
    }
  };

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast({ title: "Copied", description: "The text is on your clipboard." });
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast({ title: "Could not copy", description: "The browser refused the clipboard.", variant: "destructive" });
    }
  };

  // The consultant filter lists the consultants table; retired lists
  // (active = false) keep their history but are not offered.
  const uniqueConsultants = consultants.filter((c) => c.active).map((c) => c.name);
  const consultantFilteredHistory = searchHistory.filter((search) => {
    const names = consultantNamesFor(search.id);
    const legacy = (search.result.consultant || "").split(",").map((x) => x.trim()).filter(Boolean);
    return consultantFilter === "all" || names.includes(consultantFilter) || (names.length === 0 && legacy.includes(consultantFilter));
  });
  const filteredHistory = consultantFilteredHistory.filter((search) => displayName(search).toLowerCase().includes(historyFilter.toLowerCase()));

  // The portfolio overview and the roles list, over the consultant-filtered companies.
  const overview = useMemo(() => {
    let openRoles = 0, talentRoles = 0, hiringForTalent = 0, raised = 0;
    for (const s of consultantFilteredHistory) {
      const roles = s.result.recruitmentInsights?.currentVacancies || [];
      const talent = countTalentRoles(roles);
      openRoles += roles.length;
      talentRoles += talent;
      if (talent > 0) hiringForTalent += 1;
      if (raisedWithin(s.result.latestRaise, 12)) raised += 1;
    }
    return { companies: consultantFilteredHistory.length, openRoles, talentRoles, hiringForTalent, raised };
  }, [consultantFilteredHistory]);
  const portfolioRoles: PortfolioRole[] = useMemo(() => consultantFilteredHistory.flatMap((s) =>
    (s.result.recruitmentInsights?.currentVacancies || []).map((role) => ({ companyId: s.id, companyName: displayName(s), consultants: consultantNamesFor(s.id).join(", "), role, refreshedAt: s.timestamp }))
  ), [consultantFilteredHistory, assignments, consultants]);

  const hasInvestor = !!result && (!!result.facts?.some((f) => f.kind === "investor") || mergedContacts.some((c) => /investor|board/i.test(c.role || "")));
  const openRoles = result?.recruitmentInsights?.currentVacancies || [];

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Companies" subtitle="Add a start-up, track it, and open its page for the register, signals, open roles, people, scripts and calls" />

      {searchHistory.length > 0 && (
        <div className="border-b border-border bg-muted/20">
          <div className="container mx-auto px-6 py-6">
            <Tabs defaultValue="overview" className="w-full">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <TabsList>
                  <TabsTrigger value="overview" className="gap-2"><BarChart3 className="h-4 w-4" aria-hidden="true" />Portfolio overview</TabsTrigger>
                  <TabsTrigger value="roles" className="gap-2"><Briefcase className="h-4 w-4" aria-hidden="true" />All roles ({portfolioRoles.length})</TabsTrigger>
                </TabsList>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => navigate("/alerts")} className="h-9 gap-1.5">
                    {alertCount > 0 ? <BellRing className="h-4 w-4 text-positive" aria-hidden="true" /> : <Bell className="h-4 w-4" aria-hidden="true" />}
                    Alerts {alertCount > 0 && `(${alertCount})`}
                  </Button>
                  <Select value={consultantFilter} onValueChange={setConsultantFilter}>
                    <SelectTrigger className="w-[180px] h-9" aria-label="Consultant"><SelectValue placeholder="Consultant" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All consultants</SelectItem>
                      {uniqueConsultants.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <TabsContent value="overview" className="mt-4">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                  {[
                    { label: "Companies", value: overview.companies, icon: Building2, tone: "" },
                    { label: "Open roles", value: overview.openRoles, icon: Briefcase, tone: "" },
                    { label: "Talent roles open", value: overview.talentRoles, icon: Users, tone: "text-warning" },
                    { label: "Companies hiring for talent", value: overview.hiringForTalent, icon: CheckCircle2, tone: "text-warning" },
                    { label: "Raised in the last year", value: overview.raised, icon: Coins, tone: "text-positive" },
                  ].map((t) => (
                    <Card key={t.label} className="p-4 bg-background/50">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center"><t.icon className={`h-5 w-5 ${t.tone || "text-primary"}`} aria-hidden="true" /></div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t.label}</p>
                          <p className={`text-2xl font-bold ${t.tone || "text-foreground"}`}>{t.value}</p>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">"Talent roles" are open roles in the people and talent family (a recruiter, a talent partner, a head of people): the company is hiring the person this team places. "Raised in the last year" counts companies whose latest round is dated within twelve months.</p>
              </TabsContent>

              <TabsContent value="roles" className="mt-4">
                <AllRolesTab rows={portfolioRoles} onOpenCompany={(id) => { const s = searchHistory.find((x) => x.id === id); if (s) handleViewPreviousSearch(s); }} />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      )}

      <div className="container mx-auto px-6 py-8">
        <div className="grid lg:grid-cols-12 gap-8">
          {/* Left: the tracked companies */}
          <div className="lg:col-span-3 space-y-4">
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-bold text-foreground">Tracked companies</h2>
                {searchHistory.length > 0 && (
                  <Button variant="outline" size="sm" onClick={handleRefreshAll} disabled={isRefreshingAll || isAnalyzing} className="h-8 text-xs">
                    {isRefreshingAll ? (
                      <><Loader2 className="h-3 w-3 mr-1 animate-spin" aria-hidden="true" />{refreshProgress.current}/{refreshProgress.total}</>
                    ) : (
                      <><RefreshCw className="h-3 w-3 mr-1" aria-hidden="true" />{consultantFilter !== "all" || historyFilter ? `Refresh filtered (${filteredHistory.length})` : `Refresh all (${searchHistory.length})`}</>
                    )}
                  </Button>
                )}
              </div>

              {searchHistory.length > 0 && (
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <Input placeholder="Find a company" value={historyFilter} onChange={(e) => setHistoryFilter(e.target.value)} className="pl-9 h-9" aria-label="Find a company" />
                </div>
              )}

              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {filteredHistory.length > 0 ? (
                  filteredHistory.map((search) => (
                    <div key={search.id} className={`p-3 rounded-lg border cursor-pointer transition-all ${currentSearchUrl === search.url ? "bg-primary/10 border-primary" : "bg-muted/30 border-border/50 hover:border-primary/50"}`}>
                      <button type="button" className="w-full text-left" onClick={() => handleViewPreviousSearch(search)} aria-current={currentSearchUrl === search.url ? "true" : undefined}>
                        <p className="font-semibold text-sm text-foreground">
                          {displayName(search)}
                          {search.result.stage?.label && search.result.stage.label !== "unknown" && <span className="text-muted-foreground font-normal"> · {stageLabel(search.result.stage.label)}</span>}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          <span className="text-primary/80 font-medium">{consultantNamesFor(search.id).join(", ") || search.result.consultant || "Unassigned"}</span>
                          {" · "}
                          {new Date(search.timestamp).toLocaleDateString("en-GB")}
                        </p>
                      </button>
                      {currentSearchUrl === search.url && (
                        <div className="space-y-2 mt-2">
                          <Button variant="outline" size="sm" onClick={() => void handleRefreshSearch(search)} disabled={isAnalyzing || isRefreshingAll} className="w-full">
                            <RefreshCw className="h-3 w-3 mr-1" aria-hidden="true" />Refresh
                          </Button>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" size="sm" className="w-full" aria-label="Assign consultants">
                                <Users className="h-3 w-3 mr-1" aria-hidden="true" />
                                {consultantNamesFor(search.id).length ? `Consultants (${consultantNamesFor(search.id).length})` : "Assign consultant"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-64 p-3">
                              <p className="text-xs font-medium mb-2">Who covers this company</p>
                              <div className="space-y-2 max-h-64 overflow-y-auto">
                                {consultants.filter((c) => c.active || (assignments[search.id] || []).includes(c.id)).map((c) => {
                                  const assigned = (assignments[search.id] || []).includes(c.id);
                                  return (
                                    <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                                      <Checkbox checked={assigned} onCheckedChange={() => void toggleAssignment(search.id, c.id, assigned)} />
                                      <span>{c.name}{!c.active ? " (inactive)" : ""}</span>
                                    </label>
                                  );
                                })}
                                {consultants.length === 0 && <p className="text-xs text-muted-foreground">No consultants yet.</p>}
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-2">Alerts and the Friday brief follow the assignment from the next run.</p>
                            </PopoverContent>
                          </Popover>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    {searchHistory.length === 0 ? "No companies yet" : "No matches"}
                  </p>
                )}
              </div>
            </Card>
          </div>

          {/* Middle: the add form and the progress panel */}
          <div className="lg:col-span-4 space-y-6">
            <AddCompanyForm
              disabled={isRefreshingAll}
              analysing={isAnalyzing}
              current={result && activeCompany ? { url: activeCompany.url, companyNumber: activeCompany.companyNumber, name: displayName(activeCompany) } : result ? { url: currentSearchUrl, companyNumber: result.companyRecord?.companyNumber || null, name: result.companyRecord?.name || extractCompanyName(currentSearchUrl) } : null}
              onAnalyse={(input) => void handleAnalyze(input)}
              onNewSearch={handleNewSearch}
            />
            {isAnalyzing && <AnalysisProgress stage={analysisStage} elapsed={analysisElapsed} onStop={cancelWaitingForAnalysis} />}
          </div>

          {/* Right: the company page */}
          <div className="lg:col-span-5 space-y-6">
            {result ? (
              <>
                <nav aria-label="Sections" className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-1 rounded-md border border-border bg-background/95 px-2 py-1.5 text-xs backdrop-blur">
                  {SECTION_LINKS.map(([id, label]) => (
                    <a key={id} href={`#${id}`} className="rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">{label}</a>
                  ))}
                </nav>

                <CompanyRegisterCard summary={result.summary} url={currentSearchUrl} record={result.companyRecord} stage={result.stage} raise={result.latestRaise} websiteAccess={result.websiteAccess} />

                <div id="signals" className="scroll-mt-14" />
                {activeCompanyId && <PropensityCard companyId={activeCompanyId} refreshKey={result.evidence?.computedAt} />}
                {result.signals ? (
                  <SignalsCard signals={result.signals} computedAt={result.evidence?.computedAt} />
                ) : (result.buyerIntentSignals?.length || 0) > 0 && (
                  <Card className="p-6">
                    <h3 className="text-lg font-bold text-foreground mb-3">Buyer intent signals</h3>
                    <ul className="space-y-2">
                      {result.buyerIntentSignals?.map((signal, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                          <span className="text-sm text-foreground">{signal}</span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                <div id="roles" className="scroll-mt-14" />
                <OpenRolesCard roles={openRoles} boards={result.boards} run={result.vacancyRun} />
                {activeCompanyId && (
                  <Card className="p-6">
                    <h3 className="text-lg font-bold text-foreground mb-3">Role history</h3>
                    <VacancyHistory companyId={activeCompanyId} />
                  </Card>
                )}

                <ContactsCard
                  companyId={activeCompanyId}
                  officers={result.officers}
                  contacts={mergedContacts}
                  removed={removedList}
                  pagesRead={result.contactsRun?.pagesFetched?.length ?? null}
                  editsError={contactEdits.isError ? (contactEdits.error instanceof Error ? contactEdits.error.message : "unknown error") : null}
                  onEdit={setContactEditMode}
                  onReport={reportContact}
                />

                <div id="scripts" className="scroll-mt-14" />
                <ScriptsCard
                  copy={result.copy}
                  hasInvestor={hasInvestor}
                  currentFingerprint={result.evidenceFingerprint}
                  evidenceComputedAt={result.evidence?.computedAt}
                  regenerating={regenerating}
                  onRegenerate={regenerateCopy}
                  onCopy={copyToClipboard}
                  copiedField={copiedField}
                />

                {activeCompanyId && (
                  <OutcomesCard key={outcomesKey} companyId={activeCompanyId} contacts={mergedContacts.filter((d) => d.name).map((d) => ({ name: d.name, role: d.role }))} />
                )}
              </>
            ) : (
              <Card className="p-12">
                <div className="text-center text-muted-foreground">
                  <p className="text-lg font-medium mb-2">No company open</p>
                  <p className="text-sm">Pick a company from the list, or add one to analyse it.</p>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Edit, add or remove a contact (everyone signed in) */}
      {activeCompanyId && contactEditMode && (
        <ContactEditDialog
          companyId={activeCompanyId}
          companyName={result?.companyRecord?.name || activeCompany?.companyName || "the company"}
          mode={contactEditMode}
          open={!!contactEditMode}
          onOpenChange={(open) => { if (!open) setContactEditMode(null); }}
          onSaved={() => setOutcomesKey((k) => k + 1)}
        />
      )}
    </div>
  );
};

export default Index;
