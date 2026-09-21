import { useState, useEffect, useMemo, useRef } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Copy, CheckCircle2, Award, Search, RefreshCw, Plus, PoundSterling, Users, TrendingUp, TrendingDown, BarChart3, Building2, ArrowUpDown, Download, Filter, Mail, Briefcase, Info, Zap, ExternalLink, Bell, BellRing, Pencil, UserPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { CompetitorAnalysis } from "@/components/CompetitorAnalysis";
import { normalizeVacancyStartDate } from "@/lib/utils";
import { SignalsCard, type OfstedSummary, type Signal } from "@/components/SignalsCard";
import { ScriptsCard, type Persona, type StoredCopy } from "@/components/ScriptsCard";
import { AppHeader } from "@/components/AppHeader";
import { formatIsoDateUk, describeFunctionError } from "@/lib/format";
import { generateJobBoardUrl } from "@/lib/jobBoardUrl";
import { normalizeCompanyLookupKey, pickRicherCfrRow, mergeCfrYearMap, DEFAULT_CFR_YEARS, formatPounds, type CfrYearMap, type CfrRow } from "@/lib/cfrMetrics";
import { OutcomesCard } from "@/components/OutcomesCard";
import { PropensityCard } from "@/components/PropensityCard";
import { SpendCard } from "@/components/SpendCard";
import { PupilPremiumCard } from "@/components/PupilPremiumCard";
import { TrustLink } from "@/components/TrustLink";
import { TenderNotices } from "@/components/TenderNotices";
import { CompanyShortlists } from "@/components/CompanyShortlists";
import { VacancyHistory } from "@/components/VacancyHistory";
import { EmailContactDialog } from "@/components/EmailContactDialog";
import { ContactEngagement } from "@/components/ContactEngagement";
import { StartFollowUpsDialog } from "@/components/StartFollowUpsDialog";
import { FollowUpsCard } from "@/components/FollowUpsCard";
import { ContactEditDialog, type ContactEditMode } from "@/components/ContactEditDialog";
import { contactKeyOf, editTag, mergeContacts, removedContacts, shortUkDate } from "@/lib/contacts";
import { useCompanyContactEdits } from "@/lib/contactEditsData";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { hasFeature } from "@/lib/features";
import { useCompanyEmailEvents } from "@/lib/emailEventsData";
import { useAuth } from "@/lib/auth";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import type { Tables, Json } from "@/integrations/supabase/types";

interface DecisionMaker {
  name: string;
  role: string;
  email: string;
  // Phase 2 fields; older analyses lack them and render as before.
  confidence?: "found" | "pattern_guess" | "role_only" | "consultant_provided";
  source_url?: string;
  evidence?: string;
  phone?: string;
  level?: "company" | "trust";
  feedback?: "bounced" | "wrong_person" | "left";
  // Consultant-list import (September 2026): who typed the row in and when.
  provided_by?: string;
  provided_at?: string;
  sheet_status?: string;
  notes?: string;
}

type ContactFeedbackKind = "bounced" | "wrong_person" | "left";

/** "provided by Alexa, September 2026" for a contact typed in from a consultant's list. */
function providedLabel(p: { provided_by?: string; provided_at?: string }): string {
  const when = p.provided_at ? new Date(p.provided_at + (p.provided_at.length === 10 ? "T00:00:00Z" : "")) : null;
  const month = when && !Number.isNaN(when.getTime()) ? when.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : null;
  return `provided by ${p.provided_by || "a consultant"}${month ? `, ${month}` : ""}`;
}

interface CfrYearData {
  bae10: string | null;
  bae20: string | null;
  ba240: string | null;
  ba030: string | null;
  ba230: string | null;
  total: string | null;
  e02: string | null;
  e26: string | null;
}

interface GovernmentSpendData {
  laName: string;
  teachingStaffSupplyTeachers_2023_24: string;
  educationSupportStaffAgency_2023_24: string;
  totalCompanyExpenditure_2023_24: string;
  teachingStaffSupplyTeachers_2024_25: string;
  educationSupportStaffAgency_2024_25: string;
  totalCompanyExpenditure_2024_25: string;
  cfrData?: {
    bae10: string | null;
    bae20: string | null;
    ba240: string | null;
    ba030: string | null;
    ba230: string | null;
    total: string | null;
  };
  cfrByYear?: {
    [year: string]: CfrYearData | undefined;
  };
}

interface AnalysisResult {
  summary: string;
  buyerIntentSignals: string[];
  risks: string[];
  decisionMakers: DecisionMaker[];
  budgetAndAgencySpend: {
    tempAgencySpend: string;
    supplyStaffBudget: string;
    financialInsights: string[];
  };
  recruitmentInsights: {
    currentVacancies: Array<{
      title: string;
      startDate: string;
      url?: string;
      endDate?: string;
      source?: string;
      sourceLabel?: string;
      closingDate?: string;
      firstSeen?: string;
      vacancyId?: string;
    }>;
    recruitmentPatterns: string;
    supplyStaffingNeeds: string;
    estimatedSpend: string;
  };
  awardsAndAccolades: string[];
  coldCallScript: string;
  warmEmailScript: string;
  governmentSpendData?: GovernmentSpendData;
  consultant?: string;
  // Phase 3: computed signals, validated facts and per-persona copy. Older
  // analyses lack them and render the legacy fields.
  signals?: Signal[];
  facts?: Array<{ id: string; kind: string; statement: string; quote: string; source_url: string; date_hint?: string | null }>;
  copy?: Partial<Record<Persona, StoredCopy>>;
  evidenceFingerprint?: string;
  evidence?: { computedAt?: string; model?: string };
  companyRecord?: { name?: string; phase?: string; laName?: string; trustName?: string | null } | null;
  /** Phase 5: the Ofsted management-information row for the company, written on each analysis. */
  ofsted?: OfstedSummary | null;
}

interface SearchHistory {
  id: string;
  url: string;
  urn?: string;
  companyName: string;
  result: AnalysisResult;
  timestamp: number;
  /** The DfE record resolved for this company (company_records), when there is one. */
  record?: DfeRecord | null;
}

/** A row of company_records as the app reads it. */
interface DfeRecord {
  urn: string;
  resolvedUrn: string;
  name: string;
  laName: string | null;
  phase: string | null;
  trustName: string | null;
  website: string | null;
  postcode: string | null;
  status: 'verified' | 'unverified';
}

// Helper function to generate job board search URLs that will find the specific vacancy
// Phase 1: the server validates vacancies and closing dates on every refresh, so
// the manual "Validate All" and "Fix Missing Dates" tools are hidden. The code
// paths stay until the Phase 4 rewrite.
const SHOW_LEGACY_VACANCY_TOOLS = false;

/** League table metric names, shared by the list and the PDF export. */
const LEAGUE_METRIC_LABELS: Record<string, string> = {
  bae20: 'Agency Supply Teaching (BAE20)',
  ba240: 'Supply Staff Costs (BA240)',
  ba030: 'Education Support (BA030)',
  ba230: 'Other Staff Costs (BA230)',
  total: 'Total Expenditure',
  agencyTotal: 'Agency and supply teaching spend',
};

/** Stages analyze-company reports to company_refresh_runs.notes.stage, in order. */
const ANALYSIS_STAGES: Array<{ key: string; label: string }> = [
  { key: 'started', label: 'Fetching the website' },
  { key: 'record', label: 'Checking the DfE record' },
  { key: 'contacts', label: 'Reading contact pages' },
  { key: 'vacancies', label: 'Searching Teaching Vacancies, TES and the website' },
  { key: 'evidence', label: 'Reading the evidence' },
  { key: 'signals', label: 'Computing signals and spend' },
  { key: 'copy', label: 'Writing the headteacher script' },
  { key: 'finished', label: 'Saving' },
];

// Formats an ISO date (YYYY-MM-DD) as "Fri 4 Jul 2026" without timezone drift.
const Index = () => {
  const navigate = useNavigate();
  const { id: routeCompanyId } = useParams<{ id: string }>();
  const [url, setUrl] = useState("");
  const [urn, setUrn] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<SearchHistory[]>([]);
  const [historyFilter, setHistoryFilter] = useState("");
  const [currentSearchUrl, setCurrentSearchUrl] = useState("");
  const [analysisStage, setAnalysisStage] = useState<string | null>(null);
  const [analysisElapsed, setAnalysisElapsed] = useState(0);
  const analysisRunRef = useRef<number | null>(null);
  const [showLeagueTable, setShowLeagueTable] = useState(false);
  const [leagueTableMetric, setLeagueTableMetric] = useState<'bae20' | 'ba240' | 'ba030' | 'ba230' | 'total' | 'agencyTotal'>('bae20');
  const [leagueTableMode, setLeagueTableMode] = useState<'absolute' | 'change'>('absolute');
  // Fiscal years come from cfr_data (distinct fiscal_year, ascending); the
  // comparisons use the latest two and the league table can pick any.
  const [cfrYears, setCfrYears] = useState<string[]>(DEFAULT_CFR_YEARS);
  const currYear = cfrYears[cfrYears.length - 1];
  const prevYear = cfrYears.length > 1 ? cfrYears[cfrYears.length - 2] : cfrYears[0];
  // The year before that, for the three-year view of the year-on-year window (Craig, 15 September 2026).
  const earlierYear = cfrYears.length > 2 ? cfrYears[cfrYears.length - 3] : null;
  const [leagueTableYear, setLeagueTableYear] = useState<string>(DEFAULT_CFR_YEARS[1]);
  const [spendingFilter, setSpendingFilter] = useState<number>(0);
  const [selectedCompanyForCandidate, setSelectedCompanyForCandidate] = useState<SearchHistory | null>(null);
  const [candidateText, setCandidateText] = useState<string>("");
  const [isGeneratingCandidate, setIsGeneratingCandidate] = useState(false);
  const [laFilter, setLaFilter] = useState<string>("all");
  const [consultantFilter, setConsultantFilter] = useState<string>("all");
  const [vacancyRoleFilter, setVacancyRoleFilter] = useState<string>("all");
  const [vacancyDateFilter, setVacancyDateFilter] = useState<string>("all");
  const [vacancyCompanyFilter, setVacancyCompanyFilter] = useState<string>("all");
  const [vacancySourceFilter, setVacancySourceFilter] = useState<string>("all");
  const [showSpendCategoryInfo, setShowSpendCategoryInfo] = useState(false);
  const [companyCfrData, setCompanyCfrData] = useState<Record<string, CfrYearMap>>({});
  const [allAlertConfigs, setAllAlertConfigs] = useState<Array<{ id: string; name: string | null; email: string; daily_alerts: boolean; weekly_alerts: boolean; la_filter: string | null; consultant_filter: string | null; auto_refresh_enabled: boolean; alert_type: string; enabled: boolean }>>([]);
  
  const [lastVacancyValidation] = useState<number | null>(() => {
    const stored = localStorage.getItem('lastVacancyValidation');
    return stored ? parseInt(stored) : null;
  });
  const [bulkRefresh, setBulkRefresh] = useState<{ startedAt: string; ids: string[]; done: number; label: string; lastChangeAt: number } | null>(null);
  const isValidatingVacancies = bulkRefresh?.label === "vacancies";
  const { toast } = useToast();
  const { profile } = useAuth();
  const shortlister = hasFeature(profile, "crm_shortlister");
  // Follow-ups slice 1, behind profiles.features.follow_ups: "Email this
  // contact" and the opens-and-clicks line under each decision maker.
  const followUps = hasFeature(profile, "follow_ups");
  const activeCompanyId = searchHistory.find((h) => h.url === currentSearchUrl)?.id ?? null;
  const emailEvents = useCompanyEmailEvents(activeCompanyId, followUps);
  const [emailTarget, setEmailTarget] = useState<{ name: string; role?: string; email: string } | null>(null);
  // Follow-ups slice 2: "Start follow-ups" per contact and the Follow-ups panel.
  const [followUpTarget, setFollowUpTarget] = useState<{ name: string; role?: string; email: string } | null>(null);
  const [outcomesKey, setOutcomesKey] = useState(0);
  // Contact edits (18 September 2026): the consultants' corrections, laid
  // over the stored contacts at read time so the weekly refresh keeps them.
  // Every use of a contact on this page goes through mergedContacts.
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

  // Phase 4 slice 2: consultants and assignments are data (consultants,
  // company_consultants); a trigger keeps the legacy tag in step.
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

  // Phase 4 slice 2: find a company by name (DfE benchmarking suggest, via company-lookup).
  interface LookupResult { urn: string; name: string; town: string | null; postcode: string | null; laName: string | null; trustName: string | null; website: string | null }
  const [companyQuery, setCompanyQuery] = useState("");
  const [lookupResults, setLookupResults] = useState<LookupResult[]>([]);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [manualEntry, setManualEntry] = useState(false);
  const [selectedLookup, setSelectedLookup] = useState<LookupResult | null>(null);
  const [laHint, setLaHint] = useState<string | null>(null);
  useEffect(() => {
    const q = companyQuery.trim();
    if (q.length < 3) { setLookupResults([]); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLookupBusy(true);
      const { data, error } = await supabase.functions.invoke("company-lookup", { body: { q } });
      if (cancelled) return;
      setLookupBusy(false);
      if (error) { console.error("company-lookup failed:", error.message); setLookupResults([]); return; }
      setLookupResults((data?.results || []) as LookupResult[]);
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [companyQuery]);
  const chooseLookup = (r: LookupResult) => {
    setSelectedLookup(r);
    setUrl(r.website || "");
    setUrn(r.urn);
    setLaHint(r.laName);
    setLookupResults([]);
    setCompanyQuery(r.name);
    if (!r.website) setManualEntry(true);
  };

  // Load search history from database and migrate from localStorage if needed
  useEffect(() => {
    const migrateAndLoad = async () => {
      // First, check if we have localStorage data to migrate
      const localStorageData = localStorage.getItem("companySearchHistory");
      if (localStorageData) {
        try {
          const localHistory: SearchHistory[] = JSON.parse(localStorageData);
          
          // Migrate each item to the database
          for (const item of localHistory) {
            await supabase
              .from('company_searches')
              .insert([{
                url: item.url,
                urn: item.urn || null,
                company_name: item.companyName,
                analysis_result: item.result as unknown as Json,
              }]);
          }
          
          // Clear localStorage after successful migration
          localStorage.removeItem("companySearchHistory");
          
          toast({
            title: "Migration Complete",
            description: `Successfully migrated ${localHistory.length} searches to the shared database`,
          });
        } catch (error) {
          console.error('Error migrating localStorage data:', error);
        }
      }
      
      // Load all searches from database
      await loadSearchHistory();
    };
    
    migrateAndLoad();
    
    // Set up realtime subscription for new searches
    const channel = supabase
      .channel('company_searches_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'company_searches'
        },
        () => {
          // Reload history when any change occurs
          loadSearchHistory();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Load alert settings
  const loadAlertConfigs = async () => {
    const { data } = await supabase
      .from('vacancy_alert_settings')
      .select('*')
      .order('created_at', { ascending: true });
    if (data) {
      setAllAlertConfigs(data.map((d) => ({ id: d.id, name: d.name || null, email: d.email, daily_alerts: d.daily_alerts, weekly_alerts: d.weekly_alerts, la_filter: d.la_filter, consultant_filter: d.consultant_filter || null, auto_refresh_enabled: d.auto_refresh_enabled || false, alert_type: d.alert_type || 'deadline', enabled: d.enabled !== false })));
    }
  };

  useEffect(() => {
    loadAlertConfigs();
  }, []);

  // Load CFR data from database for all companies
  useEffect(() => {
    const loadCfrData = async () => {
      try {
        const { data, error } = await supabase
          .from('cfr_data')
          .select('*');
        if (error) throw error;
        const years = Array.from(new Set((data || []).map((r) => String(r.fiscal_year)).filter((y: string) => /^\d{4}-\d{2}$/.test(y)))).sort();
        if (years.length) {
          setCfrYears(years);
          setLeagueTableYear((y) => (years.includes(y) ? y : years[years.length - 1]));
        }

        const grouped: Record<string, CfrYearMap> = {};

        const addRowToGroup = (key: string | null | undefined, row: CfrRow) => {
          if (!key) return;
          const fiscalYear = String(row.fiscal_year);
          if (!/^\d{4}-\d{2}$/.test(fiscalYear)) return;

          if (!grouped[key]) grouped[key] = {};
          grouped[key][fiscalYear] = pickRicherCfrRow(grouped[key][fiscalYear], row);
        };

        (data || []).forEach((row) => {
          addRowToGroup(row.urn, row);
          addRowToGroup(row.company_name, row);
          addRowToGroup(normalizeCompanyLookupKey(row.company_name), row);
        });

        setCompanyCfrData(grouped);
      } catch (err) {
        console.error('Error loading CFR data:', err);
      }
    };
    loadCfrData();
  }, [searchHistory]);

  const loadSearchHistory = async () => {
    try {
      const [{ data, error }, recordsRes] = await Promise.all([
        supabase.from('company_searches').select('*').order('created_at', { ascending: false }),
        supabase.from('company_records').select('urn, resolved_urn, name, la_name, phase, trust_name, website, postcode, status'),
      ]);

      if (error) throw error;
      if (recordsRes.error) console.error('company_records load failed:', recordsRes.error.message);
      const recordsByUrn = new Map<string, DfeRecord>();
      for (const r of recordsRes.data || []) {
        recordsByUrn.set(r.urn, { urn: r.urn, resolvedUrn: r.resolved_urn || r.urn, name: r.name, laName: r.la_name, phase: r.phase, trustName: r.trust_name, website: r.website, postcode: r.postcode, status: r.status === 'verified' ? 'verified' : 'unverified' });
      }

      const formattedHistory: SearchHistory[] = (data || []).map((item) => {
        const record = recordFor(recordsByUrn.get(item.urn), item.url);
        return {
          id: item.id,
          url: item.url,
          urn: item.urn,
          companyName: item.company_name,
          result: applyRecordToResult(record, item.analysis_result as unknown as AnalysisResult),
          timestamp: new Date(item.updated_at || item.created_at).getTime(),
          record,
        };
      });

      setSearchHistory(formattedHistory);
    } catch (error) {
      console.error('Error loading search history:', error);
    }
  };

  // Save search history to database (update if exists, insert if new)
  const saveToHistory = async (url: string, urn: string, result: AnalysisResult) => {
    const companyName = extractCompanyName(url);
    let normalizedResult = result;
    
    try {
      // Validate that result has the expected structure
      if (!normalizedResult || typeof normalizedResult !== 'object') {
        throw new Error('Invalid analysis result structure');
      }

      // Check if this URL already exists
      const { data: existingSearch, error: searchError } = await supabase
        .from('company_searches')
        .select('id, analysis_result')
        .eq('url', url)
        .maybeSingle();

      if (searchError) {
        console.error('Error checking existing search:', searchError);
        throw searchError;
      }

      if (existingSearch) {
        // Preserve the consultant field from existing record
        const existingResult = existingSearch.analysis_result as { consultant?: string } | null;
        if (existingResult?.consultant && !normalizedResult.consultant) {
          normalizedResult = {
            ...normalizedResult,
            consultant: existingResult.consultant,
          };
        }

        // Update existing search
        const { error: updateError } = await supabase
          .from('company_searches')
          .update({
            company_name: companyName,
            urn: urn,
            analysis_result: normalizedResult as unknown as Json,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingSearch.id);

        if (updateError) {
          console.error('Error updating search:', updateError);
          throw updateError;
        }

        console.log('Successfully updated search for:', companyName);
      } else {
        // Insert new search
        const { error: insertError } = await supabase
          .from('company_searches')
          .insert([{
            url,
            urn: urn,
            company_name: companyName,
            analysis_result: normalizedResult as unknown as Json,
          }]);

        if (insertError) {
          // Check if it's a unique constraint violation
          if (insertError.code === '23505') {
            console.log('Duplicate URL detected, attempting to update instead');
            // Try updating instead (race condition handling)
            const { error: retryUpdateError } = await supabase
              .from('company_searches')
              .update({
                company_name: companyName,
                urn: urn,
                analysis_result: normalizedResult as unknown as Json,
                updated_at: new Date().toISOString(),
              })
              .eq('url', url);

            if (retryUpdateError) {
              console.error('Error on retry update:', retryUpdateError);
              throw retryUpdateError;
            }
            console.log('Successfully updated search after duplicate detection for:', companyName);
          } else {
            console.error('Error inserting search:', insertError);
            throw insertError;
          }
        } else {
          console.log('Successfully saved new search for:', companyName);
        }
      }
      
      // The realtime subscription will automatically update the UI
      return true;
    } catch (error) {
      console.error('Error saving to history:', error);
      // Log detailed error information
      if (error instanceof Error) {
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
      }
      throw error; // Re-throw so calling function can handle it
    }
  };

  // Extract company name from URL
  const extractCompanyName = (url: string): string => {
    try {
      const domain = new URL(url).hostname.replace("www.", "");
      return domain
        .split(".")[0]
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    } catch {
      return url;
    }
  };

  const handleAnalyze = async (urlToAnalyze?: string, urnToUse?: string) => {
    const targetUrl = urlToAnalyze || url;
    const targetUrn = urnToUse || urn;
    
    if (!targetUrl.trim()) {
      toast({
        title: "Error",
        description: "Please enter a valid URL",
        variant: "destructive",
      });
      return;
    }

    if (!targetUrn.trim()) {
      toast({
        title: "Error",
        description: "Please enter the company URN",
        variant: "destructive",
      });
      return;
    }

    // Check if this URL has already been analysed
    const existingSearch = searchHistory.find(
      (search) => search.url.toLowerCase() === targetUrl.toLowerCase()
    );

    if (existingSearch && !urlToAnalyze) {
      // Only show this dialog if user is manually analysing (not from refresh)
      toast({
        title: "Duplicate Detected",
        description: "This company has already been analysed. View it in Previous Searches or use Refresh to update.",
        variant: "destructive",
      });
      // Auto-load the existing search
      setResult(existingSearch.result);
      setCurrentSearchUrl(existingSearch.url);
      return;
    }

    setIsAnalyzing(true);
    setResult(null);
    setCurrentSearchUrl(targetUrl);

    // Real progress: the function writes its stage to company_refresh_runs as
    // it goes; poll that row for a company we already hold. A brand-new company
    // has no row until the end, so it only gets the elapsed time.
    const startedAtMs = Date.now();
    const progressCompanyId = existingSearch?.id || null;
    const runToken = startedAtMs;
    analysisRunRef.current = runToken;
    setAnalysisStage(null);
    setAnalysisElapsed(0);
    const progressInterval = setInterval(async () => {
      setAnalysisElapsed(Math.round((Date.now() - startedAtMs) / 1000));
      if (!progressCompanyId) return;
      const { data } = await supabase.from('company_refresh_runs').select('notes, finished_at').eq('company_search_id', progressCompanyId).gte('started_at', new Date(startedAtMs - 60000).toISOString()).order('started_at', { ascending: false }).limit(1).maybeSingle();
      if (analysisRunRef.current !== runToken) return;
      const stage = (data?.notes as { stage?: string } | null)?.stage;
      if (stage) setAnalysisStage(stage);
    }, 3000);

    try {
      const { data, error } = await supabase.functions.invoke("analyze-company", {
        body: { url: targetUrl, urn: targetUrn, knownLaName: laHint || undefined, companyName: selectedLookup?.name || undefined },
      });
      if (analysisRunRef.current !== runToken) { await loadSearchHistory(); return; }

      if (error) throw error;
      if (!data) throw new Error("No data returned from analysis");

      const normalizedData = data as AnalysisResult;

      setResult(normalizedData);
      
      // Save to history with proper error handling
      try {
        await saveToHistory(targetUrl, targetUrn, normalizedData);
        toast({
          title: "Analysis Complete",
          description: "Company analysis has been generated and saved successfully",
        });
        void requestOtherPersonas(targetUrl);
      } catch (saveError) {
        // Analysis succeeded but save failed - still show the result
        console.error('Failed to save to history:', saveError);
        toast({
          title: "Analysis Complete",
          description: "Analysis generated but could not be saved to history. Please try refreshing.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error analysing:", error);
      toast({
        title: "Analysis Failed",
        description: await describeFunctionError(error),
        variant: "destructive",
      });
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
    setUrl("");
    setUrn("");
    setResult(null);
    setCurrentSearchUrl("");
    if (routeCompanyId) navigate("/companies");
  };

  const handleViewPreviousSearch = (search: SearchHistory) => {
    setResult(search.result);
    setCurrentSearchUrl(search.url);
    setUrl(search.url);
    if (routeCompanyId !== search.id) navigate(`/companies/${search.id}`);
  };

  // /companies/:id opens that company once the history has loaded, so a reload
  // keeps its place and links can be shared.
  useEffect(() => {
    if (!routeCompanyId || searchHistory.length === 0) return;
    const match = searchHistory.find((h) => h.id === routeCompanyId);
    if (match && currentSearchUrl !== match.url) {
      setResult(match.result);
      setCurrentSearchUrl(match.url);
      setUrl(match.url);
    }
  }, [routeCompanyId, searchHistory]);

  const handleRefreshSearch = async (search: SearchHistory) => {
    await handleAnalyze(search.url, search.urn);
  };

  // Phase 4: bulk refresh runs on the server. refresh-all-companies queues the
  // companies and pg_cron dispatches ten a minute; progress is read from
  // company_refresh_runs, so closing the tab changes nothing.
  const isRefreshingAll = bulkRefresh !== null;
  const refreshProgress = { current: bulkRefresh?.done ?? 0, total: bulkRefresh?.ids.length ?? 0 };

  const startBulkRefresh = async (companies: SearchHistory[], label: string) => {
    const ids = companies.map((s) => s.id).filter(Boolean);
    if (ids.length === 0) return;
    const startedAt = new Date().toISOString();
    try {
      const { data, error } = await supabase.functions.invoke('refresh-all-companies', { body: { companyIds: ids } });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      setBulkRefresh({ startedAt, ids, done: 0, label, lastChangeAt: Date.now() });
      toast({ title: `Refreshing ${ids.length} ${ids.length === 1 ? 'company' : 'companies'}`, description: "Queued on the server, ten a minute. You can carry on working; the list updates as each finishes." });
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
        .from('company_refresh_runs')
        .select('company_search_id')
        .gte('started_at', bulkRefresh.startedAt)
        .not('finished_at', 'is', null)
        .limit(2000);
      if (cancelled || error) return;
      const wanted = new Set(bulkRefresh.ids);
      const done = new Set((finished || []).map((r) => r.company_search_id).filter((id) => wanted.has(id))).size;
      const stalledFor = Date.now() - bulkRefresh.lastChangeAt;
      if (done >= bulkRefresh.ids.length || stalledFor > 15 * 60 * 1000) {
        setBulkRefresh(null);
        await loadSearchHistory();
        toast({ title: done >= bulkRefresh.ids.length ? "Refresh finished" : "Refresh stopped", description: `${done} of ${bulkRefresh.ids.length} companies refreshed${done < bulkRefresh.ids.length ? '; the rest did not report back within 15 minutes (see Pipeline Monitoring)' : ''}.` });
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
    const isFiltered = laFilter !== "all" || consultantFilter !== "all" || historyFilter;
    await startBulkRefresh(isFiltered ? filteredHistory : searchHistory, isFiltered ? 'filtered' : 'all');
  };

  const handleRefreshMissingDates = async () => {
    const companiesWithMissingDates = searchHistory.filter((search) => {
      const vacancies = search.result.recruitmentInsights?.currentVacancies || [];
      return vacancies.some((v) => v.startDate === 'Date not specified' || !v.startDate);
    });
    if (companiesWithMissingDates.length === 0) {
      toast({ title: "No Updates Needed", description: "All vacancies already have start dates specified." });
      return;
    }
    await startBulkRefresh(companiesWithMissingDates, 'missing dates');
  };

  const handleValidateVacancies = async () => {
    const filteredCompanyUrls = new Set(sortedVacancies.map((v) => v.companyUrl));
    await startBulkRefresh(searchHistory.filter((s) => filteredCompanyUrls.has(s.url)), 'vacancies');
  };

  // "Wrong / bounced" on a decision-maker contact: recorded by handle-contact-feedback;
  // the contact is suppressed on the next refresh and its address is never guessed again.
  const reportContact = async (person: DecisionMaker & { contactKey?: string }, kind: ContactFeedbackKind) => {
    const companyId = searchHistory.find((h) => h.url === currentSearchUrl)?.id || "";
    if (!companyId) {
      toast({ title: "Cannot report this contact", description: "Open the company from the history list first.", variant: "destructive" });
      return;
    }
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/handle-contact-feedback`, {
        method: "POST",
        headers: await functionHeaders(),
        body: JSON.stringify({ companySearchId: companyId, email: person.email || undefined, name: person.name || undefined, role: person.role || undefined, kind }),
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

  // Phase 3: per-persona copy. generate-copy applies the evidence-fingerprint
  // rule unless force is set. The bearer is the signed-in user's token.
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
    const companyId = searchHistory.find((h) => h.url === currentSearchUrl)?.id || "";
    if (!companyId) {
      toast({ title: "Cannot regenerate yet", description: "Open the company from the history list first.", variant: "destructive" });
      return;
    }
    setRegenerating(persona);
    try {
      const out = await callGenerateCopy(companyId, [persona], true);
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
  // After a manual analysis the headteacher copy comes back inline; the other
  // personas are written in the background and appear on the next reload.
  const requestOtherPersonas = async (companyUrl: string) => {
    try {
      const { data } = await supabase.from("company_searches").select("id").eq("url", companyUrl).maybeSingle();
      if (data?.id) await callGenerateCopy(data.id, ["sbm", "senco", "trust_hr"], false);
      await loadSearchHistory();
    } catch (e) {
      console.warn("background copy generation failed:", e);
    }
  };

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast({
        title: "Copied!",
        description: "Text copied to clipboard",
      });
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast({
        title: "Copy Failed",
        description: "Failed to copy to clipboard",
        variant: "destructive",
      });
    }
  };

  const exportToCSV = () => {
    const metricKey = leagueTableMetric;
    const sortedList = [...dashboardMetrics.companySpendList].sort((a, b) => b[metricKey] - a[metricKey]);
    const filteredList = sortedList.filter(company => company[metricKey] >= spendingFilter);
    
    const metricLabels = {
      bae20: 'Agency Supply Teaching (BAE20)',
      ba240: 'Supply Staff Costs (BA240)',
      ba030: 'Education Support (BA030)',
      ba230: 'Other Staff Costs (BA230)',
      total: 'Total Expenditure',
      agencyTotal: 'Agency and supply teaching spend'
    };
    
    const headers = ["Rank", "Company Name", metricLabels[metricKey], "BAE20", "BA240", "BA030", "Total"];
    const rows = filteredList.map((company, index) => [
      index + 1,
      company.companyName,
      company[`${metricKey}Text`],
      company.bae20Text,
      company.ba240Text,
      company.ba030Text,
      company.totalText
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `company-${metricKey}-league-table-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Exported to CSV",
      description: "League table downloaded successfully",
    });
  };

  const exportToPDF = () => {
    const metricKey = leagueTableMetric;
    const metricLabels: Record<string, string> = {
      bae20: 'Agency Supply Teaching (BAE20)',
      ba240: 'Supply Staff Costs (BA240)',
      ba030: 'Education Support (BA030)',
      ba230: 'Other Staff Costs (BA230)',
      total: 'Total Expenditure',
      agencyTotal: 'Agency and supply teaching spend'
    };

    const formatMoney = (val: number) => `£${Math.round(Math.abs(val)).toLocaleString()}`;

    const doc = new jsPDF();
    doc.setTextColor(89, 192, 196);
    doc.setFontSize(9);
    doc.text('WhoFoundWho · He-Giveth', 14, 12);
    doc.setTextColor(18, 32, 39);
    const title = `${metricLabels[metricKey]} ${leagueTableMode === 'change' ? 'Year-on-Year Change' : 'League Table'}`;

    doc.setFontSize(16);
    doc.setTextColor(22, 163, 74);
    doc.text(title, 14, 20);

    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);

    if (leagueTableMode === 'change') {
      const changeKey = `${metricKey}Change` as keyof typeof dashboardMetrics.companySpendList[0];
      const changePctKey = `${metricKey}ChangePct` as keyof typeof dashboardMetrics.companySpendList[0];
      const prevKey = `${metricKey}Prev` as keyof typeof dashboardMetrics.companySpendList[0];
      const earlierKey = `${metricKey}Earlier` as keyof typeof dashboardMetrics.companySpendList[0];
      const change3PctKey = `${metricKey}Change3Pct` as keyof typeof dashboardMetrics.companySpendList[0];

      const companiesWithChange = dashboardMetrics.companySpendList.filter(company => {
        const change = company[changeKey] as number | null;
        const prev = company[prevKey] as number;
        return change !== null && prev > 0 && (company[metricKey] as number) > 0;
      }).filter(company => laFilter === 'all' || company.laName === laFilter);

      const sortedList = [...companiesWithChange].sort((a, b) => {
        return ((b[changeKey] as number) || 0) - ((a[changeKey] as number) || 0);
      });

      const subtitle = `Year-on-Year Change (${prevYear} to ${currYear}) - ${sortedList.length} companies${laFilter !== 'all' ? ` in ${laFilter}` : ''} | Generated ${new Date().toLocaleDateString()}`;
      doc.text(subtitle, 14, 28);

      const tableData = sortedList.map((company, index) => {
        const change = (company[changeKey] as number) || 0;
        const changePct = (company[changePctKey] as number) || 0;
        const prev = (company[prevKey] as number) || 0;
        const curr = (company[metricKey] as number) || 0;
        const earlier = (company[earlierKey] as number) || 0;
        const change3Pct = company[change3PctKey] as number | null;
        return [
          index + 1,
          company.companyName,
          company.laName || '',
          earlier > 0 ? `£${Math.round(earlier).toLocaleString()}` : '',
          `£${Math.round(prev).toLocaleString()}`,
          `£${Math.round(curr).toLocaleString()}`,
          `${change > 0 ? '+' : ''}${formatMoney(change)}`,
          `${changePct >= 0 ? '+' : ''}${changePct.toFixed(0)}%`,
          earlier > 0 && change3Pct !== null ? `${change3Pct >= 0 ? '+' : ''}${change3Pct.toFixed(0)}%` : ''
        ];
      });

      autoTable(doc, {
        startY: 34,
        head: [['#', 'Company Name', 'LA', earlierYear || '', prevYear, currYear, 'Change (£)', 'Change (%)', '3-year (%)']],
        body: tableData,
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [22, 163, 74], textColor: 255 },
        columnStyles: {
          0: { cellWidth: 10, halign: 'center' },
          3: { halign: 'right' },
          4: { halign: 'right' },
          5: { halign: 'right' },
          6: { halign: 'right' },
          7: { halign: 'right' },
          8: { halign: 'right' },
        },
        didParseCell: (data) => {
          if (data.section === 'body' && (data.column.index === 6 || data.column.index === 7 || data.column.index === 8)) {
            const text = String(data.cell.raw);
            if (text.startsWith('+')) {
              data.cell.styles.textColor = [22, 163, 74];
            } else if (text.startsWith('-')) {
              data.cell.styles.textColor = [220, 38, 38];
            }
          }
        }
      });
    } else {
      const prevKey = `${metricKey}Prev` as keyof typeof dashboardMetrics.companySpendList[0];
      const isCurrentYear = leagueTableYear === currYear;

      const getValue = (company: typeof dashboardMetrics.companySpendList[0]) => {
        if (isCurrentYear) return (company[metricKey] as number) || 0;
        return (company[prevKey] as number) || 0;
      };

      const sortedList = [...dashboardMetrics.companySpendList].sort((a, b) => getValue(b) - getValue(a));
      const filteredList = sortedList.filter(company =>
        getValue(company) >= spendingFilter &&
        getValue(company) > 0 &&
        (laFilter === 'all' || company.laName === laFilter)
      );

      const subtitle = `${leagueTableYear} - ${filteredList.length} companies${laFilter !== 'all' ? ` in ${laFilter}` : ''}${spendingFilter > 0 ? ` (£${spendingFilter.toLocaleString()}+ filter)` : ''} | Generated ${new Date().toLocaleDateString()}`;
      doc.text(subtitle, 14, 28);

      const tableData = filteredList.map((company, index) => [
        index + 1,
        company.companyName,
        company.laName || '',
        `£${Math.round(getValue(company)).toLocaleString()}`
      ]);

      autoTable(doc, {
        startY: 34,
        head: [['#', 'Company Name', 'LA', metricLabels[metricKey]]],
        body: tableData,
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [22, 163, 74], textColor: 255 },
        columnStyles: {
          0: { cellWidth: 12, halign: 'center' },
          3: { halign: 'right', fontStyle: 'bold' },
        },
      });
    }

    const filename = `${metricLabels[metricKey].replace(/[^a-zA-Z0-9]/g, '_')}_${leagueTableMode === 'change' ? 'YoY_Change' : leagueTableYear}${laFilter !== 'all' ? `_${laFilter}` : ''}.pdf`;
    doc.save(filename);

    toast({
      title: "PDF Downloaded",
      description: "League table PDF saved successfully",
    });
  };

  const handleGenerateCandidateText = async (company: SearchHistory) => {
    setSelectedCompanyForCandidate(company);
    setIsGeneratingCandidate(true);
    setCandidateText("");
    const normalizedUrn = company.urn && /^\d{5,7}$/.test(String(company.urn).trim())
      ? String(company.urn).trim()
      : undefined;

    try {
      const { data, error } = await supabase.functions.invoke('generate-candidate-text', {
        body: { 
          companyData: {
            company_name: company.companyName,
            ...(normalizedUrn ? { urn: normalizedUrn } : {}),
            analysis_result: company.result
          }
        }
      });

      if (error) throw error;
      if (!data?.candidateText) throw new Error("No candidate text was returned");

      setCandidateText(data.candidateText);
      toast({
        title: "Candidate Text Generated",
        description: "Review the recruitment text below.",
      });
    } catch (error) {
      console.error('Error generating candidate text:', error);
      const message = error instanceof Error && error.message
        ? error.message
        : "Failed to generate candidate text. Please try again.";
      toast({
        title: "Generation Failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsGeneratingCandidate(false);
    }
  };

  // URN to known LA mapping - authoritative LA data for all managed companies


  /**
   * The DfE record for a stored URN counts for this company only when its
   * website is the company's; two companies can store the same wrong URN.
   */
  const recordFor = (record: DfeRecord | undefined, url: string): DfeRecord | null => {
    if (!record) return null;
    if (record.status !== 'verified' || !record.website) return record;
    const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
    return host(record.website) === host(url) ? record : { ...record, status: 'unverified' };
  };

  /** Fill the name, local authority and trust from the DfE record when the analysis has none. */
  const applyRecordToResult = (record: DfeRecord | null, result: AnalysisResult): AnalysisResult => {
    if (!record || record.status !== 'verified' || !result || typeof result !== 'object') return result;
    const next: AnalysisResult = { ...result };
    if (!next.companyRecord?.name) next.companyRecord = { name: record.name, phase: record.phase || undefined, laName: record.laName || undefined, trustName: record.trustName };
    if (record.laName && (!next.governmentSpendData?.laName || /unknown/i.test(next.governmentSpendData.laName))) {
      next.governmentSpendData = { ...(next.governmentSpendData || ({} as NonNullable<typeof next.governmentSpendData>)), laName: record.laName };
    }
    return next;
  };

  // Consultants are data (Phase 4 slice 2): the filter lists the consultants table.
  // Retired lists (active = false) keep their history but are not offered as a filter.
  const uniqueConsultants = consultants.filter((c) => c.active).map((c) => c.name);

  // Extract unique LA names for filtering
  const uniqueLAs = Array.from(new Set(
    searchHistory
      .map(search => search.result.governmentSpendData?.laName)
      .filter((la): la is string => !!la)
  )).sort();

  // Apply LA filter and consultant filter, then search filter
  const laFilteredHistory = searchHistory.filter(search => {
    const la = search.result.governmentSpendData?.laName;
    const matchesLa = laFilter === "all" || la?.toLowerCase() === laFilter.toLowerCase();
    const names = consultantNamesFor(search.id);
    const legacy = (search.result.consultant || '').split(',').map((x) => x.trim()).filter(Boolean);
    const matchesConsultant = consultantFilter === "all" || names.includes(consultantFilter) || (names.length === 0 && legacy.includes(consultantFilter));
    return matchesLa && matchesConsultant;
  });

  const filteredHistory = laFilteredHistory.filter((search) =>
    search.companyName.toLowerCase().includes(historyFilter.toLowerCase())
  );

  const resolveCfrYearsForSearch = (search?: SearchHistory | null): CfrYearMap => {
    if (!search) return {};

    const urlDerivedName = extractCompanyName(search.url);
    const candidateKeys = Array.from(new Set([
      search.urn,
      search.record?.status === 'verified' ? search.record.resolvedUrn : null,
      search.companyName,
      urlDerivedName,
      normalizeCompanyLookupKey(search.companyName),
      normalizeCompanyLookupKey(urlDerivedName),
    ].filter((key): key is string => Boolean(key))));

    let merged: CfrYearMap = {};
    candidateKeys.forEach((key) => {
      merged = mergeCfrYearMap(merged, companyCfrData[key]);

      const normalized = normalizeCompanyLookupKey(key);
      if (normalized && normalized !== key) {
        merged = mergeCfrYearMap(merged, companyCfrData[normalized]);
      }
    });

    return merged;
  };

  // Calculate dashboard metrics using LA-filtered history
  const calculateDashboardMetrics = () => {
    const totalCompanies = laFilteredHistory.length;
    
    interface CompanySpendData {
      companyName: string;
      laName: string;
      url: string;
      urn?: string;
      bae20: number;
      ba240: number;
      ba030: number;
      ba230: number;
      total: number;
      agencyTotal: number;
      bae20Text: string;
      ba240Text: string;
      ba030Text: string;
      ba230Text: string;
      totalText: string;
      agencyTotalText: string;
      // Year-on-year change data
      bae20Change: number | null;
      ba240Change: number | null;
      ba030Change: number | null;
      ba230Change: number | null;
      totalChange: number | null;
      agencyTotalChange: number | null;
      bae20ChangePct: number | null;
      ba240ChangePct: number | null;
      ba030ChangePct: number | null;
      ba230ChangePct: number | null;
      totalChangePct: number | null;
      agencyTotalChangePct: number | null;
      bae20Prev: number;
      ba240Prev: number;
      ba030Prev: number;
      ba230Prev: number;
      totalPrev: number;
      agencyTotalPrev: number;
      // The year two before the latest, and the change from it (three-year view)
      bae20Earlier: number;
      ba240Earlier: number;
      ba030Earlier: number;
      ba230Earlier: number;
      totalEarlier: number;
      agencyTotalEarlier: number;
      bae20Change3Pct: number | null;
      ba240Change3Pct: number | null;
      ba030Change3Pct: number | null;
      ba230Change3Pct: number | null;
      totalChange3Pct: number | null;
      agencyTotalChange3Pct: number | null;
    }

    const companySpendList: CompanySpendData[] = [];
    let totalBae20 = 0;
    let totalBa240 = 0;
    let totalBa030 = 0;
    let totalBa230 = 0;
    let totalExpenditure = 0;
    let totalAgencySpend = 0;
    let companiesWithBae20 = 0;
    let companiesWithBa240 = 0;
    let companiesWithBa030 = 0;
    let companiesWithBa230 = 0;
    let companiesWithTotal = 0;
    let companiesWithAgencyTotal = 0;

    const parseAmount = (text: string | null | undefined): number => {
      if (!text) return 0;
      const cleaned = text.replace(/[£$,]/g, '');
      const value = parseFloat(cleaned);
      return isNaN(value) ? 0 : value;
    };

    const parseNumeric = (val: number | string | null | undefined): number => {
      if (val === null || val === undefined || val === '') return 0;
      const n = typeof val === 'number' ? val : Number(val);
      return Number.isFinite(n) ? n : 0;
    };

    laFilteredHistory.forEach((search) => {
      const cfrData = search.result.governmentSpendData?.cfrData;
      const cfrYears = resolveCfrYearsForSearch(search);
      const yr2324 = cfrYears[prevYear];
      const yr2425 = cfrYears[currYear];
      const yrEarlier = earlierYear ? cfrYears[earlierYear] : undefined;

      const govSpend = search.result.governmentSpendData;

      const govBae20Prev = parseAmount(govSpend?.teachingStaffSupplyTeachers_2023_24);
      const govBae20Curr = parseAmount(govSpend?.teachingStaffSupplyTeachers_2024_25);
      const govBa030Prev = parseAmount(govSpend?.educationSupportStaffAgency_2023_24);
      const govBa030Curr = parseAmount(govSpend?.educationSupportStaffAgency_2024_25);
      const govTotalPrev = parseAmount(govSpend?.totalCompanyExpenditure_2023_24);
      const govTotalCurr = parseAmount(govSpend?.totalCompanyExpenditure_2024_25);

      const bae20Prev = parseNumeric(yr2324?.bae20_supply_teaching_staff ?? yr2324?.e26_agency_staff) || govBae20Prev;
      const bae20Curr = parseNumeric(yr2425?.bae20_supply_teaching_staff ?? yr2425?.e26_agency_staff) || govBae20Curr;
      const ba240Prev = parseNumeric(yr2324?.ba240_supply_staff_costs ?? yr2324?.e27_other_supply_costs);
      const ba240Curr = parseNumeric(yr2425?.ba240_supply_staff_costs ?? yr2425?.e27_other_supply_costs);
      const ba030Prev = parseNumeric(yr2324?.ba030_education_support) || govBa030Prev;
      const ba030Curr = parseNumeric(yr2425?.ba030_education_support) || govBa030Curr;
      const totalPrev = parseNumeric(yr2324?.total_expenditure) || govTotalPrev;
      const totalCurr = parseNumeric(yr2425?.total_expenditure) || govTotalCurr;
      const ba230Prev = parseNumeric(yr2324?.ba230_other_staff_costs);
      const ba230Curr = parseNumeric(yr2425?.ba230_other_staff_costs);
      const bae20Earlier = parseNumeric(yrEarlier?.bae20_supply_teaching_staff ?? yrEarlier?.e26_agency_staff);
      const ba240Earlier = parseNumeric(yrEarlier?.ba240_supply_staff_costs ?? yrEarlier?.e27_other_supply_costs);
      const ba030Earlier = parseNumeric(yrEarlier?.ba030_education_support);
      const ba230Earlier = parseNumeric(yrEarlier?.ba230_other_staff_costs);
      const totalEarlier = parseNumeric(yrEarlier?.total_expenditure);
      const bae10Earlier = parseNumeric(yrEarlier?.bae10_teaching_staff ?? yrEarlier?.e02_supply_teachers);
      const agencyTotalEarlier = bae20Earlier + bae10Earlier;

      const bae20 = bae20Curr || parseAmount(cfrData?.bae20);
      const ba240 = ba240Curr || parseAmount(cfrData?.ba240);
      const ba030 = ba030Curr || parseAmount(cfrData?.ba030);
      const ba230 = ba230Curr || parseAmount(cfrData?.ba230);
      const total = totalCurr || parseAmount(cfrData?.total);
      // "Agency and supply teaching spend" is BAE10 + BAE20 everywhere in the app (Phase 6).
      const bae10Prev = parseNumeric(yr2324?.bae10_teaching_staff ?? yr2324?.e02_supply_teachers);
      const bae10Curr = parseNumeric(yr2425?.bae10_teaching_staff ?? yr2425?.e02_supply_teachers) || parseAmount(cfrData?.bae10);
      const agencyTotal = bae20 + bae10Curr;
      const agencyTotalPrev = bae20Prev + bae10Prev;

      if (bae20 > 0) {
        totalBae20 += bae20;
        companiesWithBae20++;
      }
      if (ba240 > 0) {
        totalBa240 += ba240;
        companiesWithBa240++;
      }
      if (ba030 > 0) {
        totalBa030 += ba030;
        companiesWithBa030++;
      }
      if (ba230 > 0) {
        totalBa230 += ba230;
        companiesWithBa230++;
      }
      if (total > 0) {
        totalExpenditure += total;
        companiesWithTotal++;
      }
      if (agencyTotal > 0) {
        totalAgencySpend += agencyTotal;
        companiesWithAgencyTotal++;
      }

      const calcChange = (prev: number, curr: number): number | null => {
        if (!prev && !curr) return null;
        return curr - prev;
      };
      const calcPct = (prev: number, curr: number): number | null => {
        if (!prev || prev === 0) return null;
        return ((curr - prev) / prev) * 100;
      };

      const hasAnyMetric = [bae20, ba240, ba030, ba230, total, bae20Prev, ba240Prev, ba030Prev, ba230Prev, totalPrev].some((val) => val > 0);

      if (hasAnyMetric) {
        companySpendList.push({
          companyName: search.companyName,
          laName: search.result.governmentSpendData?.laName || '',
          url: search.url,
          urn: search.urn,
          bae20,
          ba240,
          ba030,
          ba230,
          total,
          agencyTotal,
          bae20Text: bae20 > 0 ? formatPounds(bae20) : 'N/A',
          ba240Text: ba240 > 0 ? formatPounds(ba240) : 'N/A',
          ba030Text: ba030 > 0 ? formatPounds(ba030) : 'N/A',
          ba230Text: ba230 > 0 ? formatPounds(ba230) : 'N/A',
          totalText: total > 0 ? formatPounds(total) : 'N/A',
          agencyTotalText: agencyTotal > 0 ? formatPounds(agencyTotal) : 'N/A',
          bae20Change: calcChange(bae20Prev, bae20Curr),
          ba240Change: calcChange(ba240Prev, ba240Curr),
          ba030Change: calcChange(ba030Prev, ba030Curr),
          ba230Change: calcChange(ba230Prev, ba230Curr),
          totalChange: calcChange(totalPrev, totalCurr),
          agencyTotalChange: calcChange(agencyTotalPrev, agencyTotal),
          bae20ChangePct: calcPct(bae20Prev, bae20Curr),
          ba240ChangePct: calcPct(ba240Prev, ba240Curr),
          ba030ChangePct: calcPct(ba030Prev, ba030Curr),
          ba230ChangePct: calcPct(ba230Prev, ba230Curr),
          totalChangePct: calcPct(totalPrev, totalCurr),
          agencyTotalChangePct: calcPct(agencyTotalPrev, agencyTotal),
          bae20Prev,
          ba240Prev,
          ba030Prev,
          ba230Prev,
          totalPrev,
          agencyTotalPrev,
          bae20Earlier,
          ba240Earlier,
          ba030Earlier,
          ba230Earlier,
          totalEarlier,
          agencyTotalEarlier,
          bae20Change3Pct: calcPct(bae20Earlier, bae20Curr),
          ba240Change3Pct: calcPct(ba240Earlier, ba240Curr),
          ba030Change3Pct: calcPct(ba030Earlier, ba030Curr),
          ba230Change3Pct: calcPct(ba230Earlier, ba230Curr),
          totalChange3Pct: calcPct(totalEarlier, totalCurr),
          agencyTotalChange3Pct: calcPct(agencyTotalEarlier, agencyTotal),
        });
      }
    });

    const avgBae20 = companiesWithBae20 > 0 ? totalBae20 / companiesWithBae20 : 0;
    const avgBa240 = companiesWithBa240 > 0 ? totalBa240 / companiesWithBa240 : 0;
    const avgBa030 = companiesWithBa030 > 0 ? totalBa030 / companiesWithBa030 : 0;
    const avgBa230 = companiesWithBa230 > 0 ? totalBa230 / companiesWithBa230 : 0;
    const avgTotal = companiesWithTotal > 0 ? totalExpenditure / companiesWithTotal : 0;
    const avgAgencyTotal = companiesWithAgencyTotal > 0 ? totalAgencySpend / companiesWithAgencyTotal : 0;

    return {
      totalCompanies,
      companySpendList,
      bae20: { total: totalBae20, count: companiesWithBae20, avg: avgBae20 },
      ba240: { total: totalBa240, count: companiesWithBa240, avg: avgBa240 },
      ba030: { total: totalBa030, count: companiesWithBa030, avg: avgBa030 },
      ba230: { total: totalBa230, count: companiesWithBa230, avg: avgBa230 },
      totalExpenditure: { total: totalExpenditure, count: companiesWithTotal, avg: avgTotal },
      agencyTotal: { total: totalAgencySpend, count: companiesWithAgencyTotal, avg: avgAgencyTotal },
    };
  };

  const dashboardMetrics = calculateDashboardMetrics();

  // Blocked locations - non-London areas that should be filtered out client-side
  const blockedLocationKeywords = [
    'portsmouth', 'southampton', 'hull', 'manchester', 'birmingham', 'liverpool', 'leeds',
    'sheffield', 'bristol', 'newcastle', 'nottingham', 'leicester', 'coventry', 'bradford',
    'cardiff', 'belfast', 'edinburgh', 'glasgow', 'aberdeen', 'dundee', 'plymouth',
    'brighton', 'bournemouth', 'exeter', 'norwich', 'cambridge', 'oxford', 'york', 'derby',
    'stoke', 'wolverhampton', 'sunderland', 'middlesbrough', 'doncaster', 'rotherham',
    'barnsley', 'wakefield', 'wigan', 'bolton', 'stockport', 'oldham', 'blackpool',
    'blackburn', 'burnley', 'preston', 'warrington', 'st helens', 'rochdale', 'salford',
    'bury', 'telford', 'peterborough', 'luton', 'slough', 'northampton', 'swindon',
    'milton keynes', 'gloucester', 'cheltenham', 'bath', 'taunton', 'torquay', 'swansea',
    'newport', 'wrexham', 'ipswich', 'colchester', 'lincoln', 'grimsby', 'scunthorpe',
    'chesterfield', 'mansfield', 'worksop', 'basingstoke', 'cayman', 'dubai', 'qatar'
  ];

  // Helper function to detect if vacancy is from company website
  const isCompanyWebsiteVacancy = (title: string): boolean => {
    const lower = title.toLowerCase();
    return lower.includes('company website') || lower.includes('posted on company') || lower.includes('(company website)');
  };

  // Collect all vacancies from all searches, filtering out blocked locations
  const allVacancies = laFilteredHistory.flatMap(search => {
    const vacancies = search.result.recruitmentInsights?.currentVacancies || [];
    return vacancies
      .filter(vacancy => {
        const title = vacancy.title || '';
        const titleLower = title.toLowerCase();
        const textToCheck = `${title} ${vacancy.url || ''} ${search.result.governmentSpendData?.laName || ''}`.toLowerCase();
        
        // Block specific locations
        if (blockedLocationKeywords.some(blocked => textToCheck.includes(blocked))) return false;
        // Block Crinkle
        if (textToCheck.includes('crinkle')) return false;
        // Block "no current vacancies" messages
        if (titleLower.includes('no current vacanc') || titleLower.includes('no vacanc')) return false;
        // Block informational / non-vacancy content
        const blockedPhrases = [
          'expected behaviours', 'inclusion & belonging', 'inclusion &amp; belonging',
          'head office & support', 'head office &amp; support',
          'futures apprenticeships', 'apprenticeships overview', 'apprenticeships teacher',
          'national apprenticeship', 'apply-apprenticeship',
          'teacher development', 'responsible for', 'the successful candidate',
          'job information pack', 'where can subjects take you', 'traineeships',
          // Non-education roles blocked per user request
          'leisure assistant', 'head of finance', 'sous chef', 'finance assistant',
          'finance officer', 'mountain rescue', 'administrative and trips',
          'digital marketing', 'foundation studies work placement', 'work experience officer',
          'director of development', 'pa to group strategic director', 'pa to strategic director',
          'marketing and communications', 'college adviser', 'av and events',
          'hard services assistant', 'soft services supervisor', 'facility supervisor',
          'mealtime supervisor',
        ];
        if (blockedPhrases.some(phrase => titleLower.includes(phrase))) return false;
        // Block titles starting with non-vacancy patterns
        if (/^(how to|about |what is|secretary)/i.test(title)) return false;
        // Block titles ending with non-vacancy suffixes
        if (/\b(overview|handbook|framework)$/i.test(title.replace(/\s*\(.*\)\s*$/, ''))) return false;
        // Block cleaner unless combined with teaching context
        if (titleLower.includes('cleaner') && !titleLower.includes('teach')) return false;
        
        return true;
      })
      .map(vacancy => ({
        companyName: search.companyName,
        laName: search.result.governmentSpendData?.laName || '',
        companyUrl: search.url,
        consultants: consultantNamesFor(search.id).join(', ') || search.result.consultant || '',
        vacancy: vacancy,
        date: search.timestamp,
        isCompanyWebsite: isCompanyWebsiteVacancy(vacancy.title),
      }));
  });


  // Get unique LA names for league table filter
  const uniqueLANames = [...new Set(dashboardMetrics.companySpendList.map(s => s.laName).filter(Boolean))].sort();

  // Helper function to calculate urgency score (lower = more urgent)
  const getUrgencyScore = (startDate: string): number => {
    const lower = startDate.toLowerCase();
    // Most urgent - immediate/ASAP
    if (/(asap|immediate|urgent|immediately|as soon as possible|required as soon)/i.test(lower)) return 0;
    // Apply by dates (sooner deadline = more urgent)
    if (lower.startsWith('apply by')) {
      const dateMatch = lower.match(/apply by (\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (dateMatch) {
        const applyDate = new Date(parseInt(dateMatch[3]), parseInt(dateMatch[2]) - 1, parseInt(dateMatch[1]));
        return 1 + (applyDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 365);
      }
      return 1;
    }
    // Term-based dates
    if (/(january|jan|february|feb|spring term)/i.test(lower)) return 2;
    if (/(easter|april|apr)/i.test(lower)) return 3;
    if (/(september|sep|autumn term)/i.test(lower)) return 4;
    if (/(summer term|july|jul)/i.test(lower)) return 5;
    // Specific future dates
    if (/202[5-9]/.test(lower)) return 6;
    // Unknown dates go last
    if (lower.includes('unknown')) return 99;
    return 50;
  };

  // Sort vacancies by urgency (most urgent first)
  // Apply filters to vacancies
  const filteredVacancies = allVacancies.filter(v => {
    const roleMatch = vacancyRoleFilter === 'all' || (() => {
      const vacancy = v.vacancy.title.toLowerCase();
      switch (vacancyRoleFilter) {
        case 'teacher': return vacancy.includes('teacher') || vacancy.includes('teaching');
        case 'teaching-assistant': return vacancy.includes('teaching assistant') || vacancy.includes('ta ');
        case 'sen': return vacancy.includes('sendco') || vacancy.includes('sen ');
        case 'support-staff': return vacancy.includes('support') || vacancy.includes('assistant');
        case 'leadership': return vacancy.includes('head') || vacancy.includes('leadership');
        case 'other': return !(
          vacancy.includes('teacher') || vacancy.includes('teaching') ||
          vacancy.includes('teaching assistant') || vacancy.includes('ta ') ||
          vacancy.includes('sendco') || vacancy.includes('sen ') ||
          vacancy.includes('support') || vacancy.includes('assistant') ||
          vacancy.includes('head') || vacancy.includes('leadership')
        );
        default: return true;
      }
    })();

    const dateMatch = vacancyDateFilter === 'all' || (() => {
      const daysSincePosted = (Date.now() - v.date) / (1000 * 60 * 60 * 24);
      switch (vacancyDateFilter) {
        case 'week': return daysSincePosted <= 7;
        case 'month': return daysSincePosted <= 30;
        case 'two-months': return daysSincePosted <= 60;
        default: return true;
      }
    })();

    const companyMatch = vacancyCompanyFilter === 'all' || v.companyName === vacancyCompanyFilter;

    const sourceMatch = vacancySourceFilter === 'all' || (() => {
      switch (vacancySourceFilter) {
        case 'verified': return !v.isCompanyWebsite;
        case 'company-website': return v.isCompanyWebsite;
        default: return true;
      }
    })();

    return roleMatch && dateMatch && companyMatch && sourceMatch;
  });

  // Get unique company names with LA for filter dropdown
  const uniqueCompaniesWithLA = allVacancies.reduce((acc, v) => {
    const key = v.companyName;
    if (!acc.find(s => s.name === key)) {
      acc.push({ name: v.companyName, laName: v.laName || '' });
    }
    return acc;
  }, [] as { name: string; laName: string }[]).sort((a, b) => a.name.localeCompare(b.name));

  const sortedVacancies = [...filteredVacancies].sort((a, b) => {
    const scoreA = getUrgencyScore(a.vacancy.startDate || '');
    const scoreB = getUrgencyScore(b.vacancy.startDate || '');
    return scoreA - scoreB;
  });

  // Auto-refresh disabled — was causing unintended bulk refreshes on page load
  // Companies should be refreshed manually via the Refresh All button

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Companies" subtitle="Analyse a company, track it, and open its page for signals, spend, contacts, scripts and calls" />

      {/* Dashboard Summary */}
      {searchHistory.length > 0 && (
        <div className="border-b border-border bg-muted/20">
          <div className="container mx-auto px-6 py-6">
            <Tabs defaultValue="overview" className="w-full">
              <div className="flex items-center justify-between mb-4">
                <TabsList>
                  <TabsTrigger value="overview" className="gap-2">
                    <BarChart3 className="h-4 w-4" />
                    Portfolio Overview
                  </TabsTrigger>
                  <TabsTrigger value="vacancies" className="gap-2">
                    <Briefcase className="h-4 w-4" />
                    All Vacancies ({allVacancies.length})
                  </TabsTrigger>
                </TabsList>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate('/alerts')}
                    className="h-9 gap-1.5"
                  >
                    {allAlertConfigs.length > 0 ? <BellRing className="h-4 w-4 text-positive" /> : <Bell className="h-4 w-4" />}
                    Alerts {allAlertConfigs.length > 0 && `(${allAlertConfigs.length})`}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => navigate('/spend')} className="h-9 gap-1.5"><PoundSterling className="h-4 w-4" aria-hidden="true" />Spend league</Button>
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <Select value={laFilter} onValueChange={setLaFilter}>
                    <SelectTrigger className="w-[200px] h-9">
                      <SelectValue placeholder="Filter by LA" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Local Authorities</SelectItem>
                      {uniqueLAs.map((la) => (
                        <SelectItem key={la} value={la.toLowerCase()}>
                          {la.charAt(0).toUpperCase() + la.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                   </Select>
                  <Select value={consultantFilter} onValueChange={setConsultantFilter}>
                    <SelectTrigger className="w-[180px] h-9">
                      <SelectValue placeholder="Filter by Consultant" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Consultants</SelectItem>
                      {uniqueConsultants.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <TabsContent value="overview" className="mt-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-muted-foreground">Financial Overview</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowSpendCategoryInfo(true)}
                    className="h-8 px-2 text-muted-foreground hover:text-foreground"
                  >
                    <Info className="h-4 w-4 mr-1" />
                    What do these codes mean?
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card className="p-4 bg-background/50 border-positive/30">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-positive/10 flex items-center justify-center">
                    <Building2 className="h-5 w-5 text-positive" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Companies</p>
                    <p className="text-2xl font-bold text-foreground">{dashboardMetrics.totalCompanies}</p>
                  </div>
                </div>
              </Card>

              <Card 
                className="p-4 bg-background/50 border-positive/30 cursor-pointer focus-visible:ring-2 focus-visible:ring-ring hover:bg-positive/5 transition-colors"
                onClick={() => {
                  if (dashboardMetrics.bae20.count > 0) {
                    setLeagueTableMetric('bae20');
                    setShowLeagueTable(true);
                  }
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-positive/10 flex items-center justify-center">
                    <PoundSterling className="h-5 w-5 text-positive" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground">Agency Supply Teaching</p>
                    <p className="text-2xl font-bold text-positive">
                      £{dashboardMetrics.bae20.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                  {dashboardMetrics.bae20.count > 0 && (
                    <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </Card>

              <Card 
                className="p-4 bg-background/50 border-positive/30 cursor-pointer focus-visible:ring-2 focus-visible:ring-ring hover:bg-positive/5 transition-colors"
                onClick={() => {
                  if (dashboardMetrics.ba240.count > 0) {
                    setLeagueTableMetric('ba240');
                    setShowLeagueTable(true);
                  }
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-positive/10 flex items-center justify-center">
                    <TrendingUp className="h-5 w-5 text-positive" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground">Supply Staff Costs</p>
                    <p className="text-2xl font-bold text-foreground">
                      £{dashboardMetrics.ba240.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                  {dashboardMetrics.ba240.count > 0 && (
                    <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </Card>

              <Card 
                className="p-4 bg-background/50 border-positive/30 cursor-pointer focus-visible:ring-2 focus-visible:ring-ring hover:bg-positive/5 transition-colors"
                onClick={() => {
                  if (dashboardMetrics.ba030.count > 0) {
                    setLeagueTableMetric('ba030');
                    setShowLeagueTable(true);
                  }
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-positive/10 flex items-center justify-center">
                    <CheckCircle2 className="h-5 w-5 text-positive" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground">Education Support</p>
                    <p className="text-2xl font-bold text-foreground">
                      £{dashboardMetrics.ba030.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                  {dashboardMetrics.ba030.count > 0 && (
                    <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </Card>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <Card 
                className="p-4 bg-background/50 border-warning/30 cursor-pointer focus-visible:ring-2 focus-visible:ring-ring hover:bg-warning/5 transition-colors"
                onClick={() => {
                  if (dashboardMetrics.agencyTotal.count > 0) {
                    setLeagueTableMetric('agencyTotal');
                    setShowLeagueTable(true);
                  }
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-warning/10 flex items-center justify-center">
                    <Briefcase className="h-5 w-5 text-warning" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground">Agency and supply teaching spend</p>
                    <p className="text-xs text-muted-foreground/70">BAE20 + BAE10, the figure the signals and the brief use</p>
                    <p className="text-2xl font-bold text-warning">
                      £{dashboardMetrics.agencyTotal.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                  {dashboardMetrics.agencyTotal.count > 0 && (
                    <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </Card>

              <Card 
                className="p-4 bg-background/50 border-positive/30 cursor-pointer focus-visible:ring-2 focus-visible:ring-ring hover:bg-positive/5 transition-colors"
                onClick={() => {
                  if (dashboardMetrics.totalExpenditure.count > 0) {
                    setLeagueTableMetric('total');
                    setShowLeagueTable(true);
                  }
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-positive/10 flex items-center justify-center">
                    <BarChart3 className="h-5 w-5 text-positive" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground">Total Expenditure (All Categories)</p>
                    <p className="text-2xl font-bold text-foreground">
                      £{dashboardMetrics.totalExpenditure.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                  {dashboardMetrics.totalExpenditure.count > 0 && (
                    <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="vacancies" className="mt-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Select value={vacancyRoleFilter} onValueChange={setVacancyRoleFilter}>
                    <SelectTrigger className="w-[180px] h-9">
                      <SelectValue placeholder="Filter by role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Roles</SelectItem>
                      <SelectItem value="teacher">Teachers</SelectItem>
                      <SelectItem value="teaching-assistant">Teaching Assistants</SelectItem>
                      <SelectItem value="sen">SEN / SENDCO</SelectItem>
                      <SelectItem value="support-staff">Support Staff</SelectItem>
                      <SelectItem value="leadership">Leadership</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={vacancyDateFilter} onValueChange={setVacancyDateFilter}>
                    <SelectTrigger className="w-[160px] h-9">
                      <SelectValue placeholder="Filter by date" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Time</SelectItem>
                      <SelectItem value="week">Last Week</SelectItem>
                      <SelectItem value="month">Last Month</SelectItem>
                      <SelectItem value="two-months">Last 2 Months</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={vacancyCompanyFilter} onValueChange={setVacancyCompanyFilter}>
                    <SelectTrigger className="w-[280px] h-9">
                      <SelectValue placeholder="Filter by company" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Companies</SelectItem>
                      {uniqueCompaniesWithLA.map(company => (
                        <SelectItem key={company.name} value={company.name}>
                          {company.name}{company.laName && ` - ${company.laName}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={vacancySourceFilter} onValueChange={setVacancySourceFilter}>
                    <SelectTrigger className="w-[180px] h-9">
                      <SelectValue placeholder="Filter by source" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Sources</SelectItem>
                      <SelectItem value="verified">Job boards only</SelectItem>
                      <SelectItem value="company-website">Company website only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex flex-col items-end gap-1">
                    <div className="text-sm text-muted-foreground">
                      Showing {sortedVacancies.length} of {allVacancies.length} vacancies
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-positive" />
                        {allVacancies.filter(v => !v.isCompanyWebsite).length} job board
                      </span>
                      <span className="flex items-center gap-1">
                        <Search className="h-3 w-3 text-muted-foreground" />
                        {allVacancies.filter(v => v.isCompanyWebsite).length} from company website
                      </span>
                    </div>
                    {lastVacancyValidation && (
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        Last validated: {new Date(lastVacancyValidation).toLocaleDateString()} at {new Date(lastVacancyValidation).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                  </div>
                  {SHOW_LEGACY_VACANCY_TOOLS && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleValidateVacancies}
                    disabled={isValidatingVacancies || isRefreshingAll || sortedVacancies.length === 0}
                    className="h-8"
                  >
                    {isValidatingVacancies ? (
                      <>
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        Validating ({refreshProgress.current}/{refreshProgress.total})
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-3 w-3 mr-1" />
                        Validate All
                      </>
                    )}
                  </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const headers = ['Company Name', 'Local Authority', 'Consultant', 'Vacancy Title', 'Start Date', 'End Date', 'URL', 'Date Added'];
                      const rows = sortedVacancies.map(v => [
                        v.companyName,
                        v.laName || '',
                        v.consultants || '',
                        v.vacancy.title,
                        v.vacancy.startDate || '',
                        (v.vacancy as { endDate?: string }).endDate || '',
                        v.vacancy.url || '',
                        new Date(v.date).toLocaleDateString()
                      ]);
                      const csvContent = [headers, ...rows]
                        .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
                        .join('\n');
                      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                      const link = document.createElement('a');
                      link.href = URL.createObjectURL(blob);
                      link.download = `vacancies-export-${new Date().toISOString().split('T')[0]}.csv`;
                      link.click();
                      URL.revokeObjectURL(link.href);
                    }}
                    className="h-8"
                  >
                    <Download className="h-3 w-3 mr-1" />
                    CSV
                  </Button>
                </div>
              </div>

              {sortedVacancies.length > 0 ? (
                <div className="grid gap-3">
                  {sortedVacancies.map((vacancy, index) => {
                    const normalizedStartDate = normalizeVacancyStartDate(
                      vacancy.vacancy.title,
                      vacancy.vacancy.startDate
                    );
                    const isUrgent = /(asap|immediate|urgent|immediately|required as soon)/i.test(normalizedStartDate);
                    // Use verified URL directly - only show vacancies with working links
                    const jobBoardUrl = vacancy.vacancy.url || generateJobBoardUrl(vacancy.vacancy.title, vacancy.companyName, vacancy.companyUrl);
                    
                    return (
                      <Card key={index} className={`p-4 hover:bg-muted/50 transition-colors ${isUrgent ? 'border-warning/50 dark:border-orange-400/50' : ''}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-semibold text-foreground">
                                {vacancy.vacancy.url ? (
                                  <a href={vacancy.vacancy.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{vacancy.vacancy.title}</a>
                                ) : vacancy.vacancy.title}
                              </p>
                              {vacancy.vacancy.sourceLabel && (
                                <Badge variant="outline" className="text-xs">{vacancy.vacancy.sourceLabel}</Badge>
                              )}
                              {isUrgent && (
                                <Badge variant="destructive" className="bg-warning hover:bg-warning flex items-center gap-1">
                                  <Zap className="h-3 w-3" />
                                  Urgent
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mb-1">
                              Start Date: <span className={`font-medium ${isUrgent ? 'text-warning dark:text-warning' : ''}`}>{normalizedStartDate}</span>
                              {(vacancy.vacancy.closingDate || (vacancy.vacancy as { endDate?: string }).endDate) && (
                                <span className="ml-3">| Closing: <span className="font-medium">{vacancy.vacancy.closingDate ? formatIsoDateUk(vacancy.vacancy.closingDate) : (vacancy.vacancy as { endDate?: string }).endDate}</span></span>
                              )}
                              {vacancy.vacancy.firstSeen && (
                                <span className="ml-3">| New since: <span className="font-medium">{formatIsoDateUk(vacancy.vacancy.firstSeen)}</span></span>
                              )}
                            </p>
                            <p className="text-sm text-primary hover:underline cursor-pointer" onClick={() => {
                              const search = searchHistory.find(s => s.url === vacancy.companyUrl);
                              if (search) handleViewPreviousSearch(search);
                            }}>
                              {vacancy.companyName}
                              {vacancy.laName && <span className="text-muted-foreground"> - {vacancy.laName}</span>}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Last refreshed: {new Date(vacancy.date).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <div className="flex items-center gap-1.5">
                              {vacancy.isCompanyWebsite ? (
                                <Badge variant="outline" className="border-primary/50 text-primary dark:text-primary bg-primary dark:bg-primary/30 flex items-center gap-1">
                                  Company website
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="border-positive/50 text-positive dark:text-positive bg-positive dark:bg-positive/30 flex items-center gap-1">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Job Board
                                </Badge>
                              )}
                              <Badge variant="secondary">
                                {(() => {
                                  const v = vacancy.vacancy.title.toLowerCase();
                                  if (v.includes('teacher') || v.includes('teaching')) return 'Teacher';
                                  if (v.includes('teaching assistant') || v.includes('ta ')) return 'TA';
                                  if (v.includes('sendco') || v.includes('sen ')) return 'SEN';
                                  if (v.includes('support') || v.includes('assistant')) return 'Support';
                                  if (v.includes('head') || v.includes('leadership')) return 'Leadership';
                                  return 'Other';
                                })()}
                              </Badge>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => window.open(jobBoardUrl, '_blank')}
                            >
                              <ExternalLink className="h-4 w-4 mr-1" />
                              View Advert
                            </Button>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <Card className="p-8 text-center">
                  <p className="text-muted-foreground">No vacancies match your filters</p>
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="container mx-auto px-6 py-8">
        <div className="grid lg:grid-cols-12 gap-8">
          {/* Left Sidebar - Previous Searches */}
          <div className="lg:col-span-3 space-y-4">
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-bold text-foreground">Previous Searches</h2>
                {searchHistory.length > 0 && (
                  <div className="flex gap-2">
                    {(() => {
                      const companiesWithMissingDates = searchHistory.filter(search => {
                        const vacancies = search.result.recruitmentInsights?.currentVacancies || [];
                        return vacancies.some(v => v.startDate === 'Date not specified' || !v.startDate);
                      });
                      
                      return SHOW_LEGACY_VACANCY_TOOLS && companiesWithMissingDates.length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleRefreshMissingDates}
                          disabled={isRefreshingAll || isAnalyzing}
                          className="h-8 text-xs border-warning/50 hover:bg-warning/10"
                        >
                          {isRefreshingAll ? (
                            <>
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              {refreshProgress.current}/{refreshProgress.total}
                            </>
                          ) : (
                            <>
                              <RefreshCw className="h-3 w-3 mr-1" />
                              Fix Missing Dates ({companiesWithMissingDates.length})
                            </>
                          )}
                        </Button>
                      );
                    })()}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRefreshAll}
                      disabled={isRefreshingAll || isAnalyzing}
                      className="h-8 text-xs"
                    >
                      {isRefreshingAll ? (
                        <>
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          {refreshProgress.current}/{refreshProgress.total}
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-3 w-3 mr-1" />
                          {laFilter !== "all" || consultantFilter !== "all" || historyFilter
                            ? `Refresh Filtered (${filteredHistory.length})`
                            : `Refresh All (${searchHistory.length})`
                          }
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
              
              {searchHistory.length > 0 && (
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search companies..."
                    value={historyFilter}
                    onChange={(e) => setHistoryFilter(e.target.value)}
                    className="pl-9 h-9"
                  />
                </div>
              )}

              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {filteredHistory.length > 0 ? (
                  filteredHistory.map((search) => (
                    <div
                      key={search.id}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        currentSearchUrl === search.url
                          ? "bg-primary/10 border-primary"
                          : "bg-muted/30 border-border/50 hover:border-primary/50"
                      }`}
                    >
                      <button type="button" className="w-full text-left" onClick={() => handleViewPreviousSearch(search)} aria-current={currentSearchUrl === search.url ? 'true' : undefined}>
                        <p className="font-semibold text-sm text-foreground">
                          {search.companyName}
                          {search.result.governmentSpendData?.laName && (
                            <span className="text-muted-foreground font-normal"> - {search.result.governmentSpendData.laName}</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          <span className="text-primary/80 font-medium">{consultantNamesFor(search.id).join(', ') || search.result.consultant || 'Unassigned'}</span>
                          {' · '}
                          {new Date(search.timestamp).toLocaleDateString()}
                        </p>
                      </button>
                      {currentSearchUrl === search.url && (
                        <div className="space-y-2 mt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRefreshSearch(search)}
                            disabled={isAnalyzing || isRefreshingAll}
                            className="w-full"
                          >
                            <RefreshCw className="h-3 w-3 mr-1" />
                            Refresh
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleGenerateCandidateText(search)}
                            disabled={isGeneratingCandidate}
                            className="w-full"
                          >
                            <Mail className="h-3 w-3 mr-1" />
                            Candidate Text
                          </Button>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" size="sm" className="w-full" aria-label="Assign consultants">
                                <Users className="h-3 w-3 mr-1" />
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
                              <p className="text-[11px] text-muted-foreground mt-2">Alerts follow the assignment from the next morning.</p>
                            </PopoverContent>
                          </Popover>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    {searchHistory.length === 0 ? "No searches yet" : "No matches found"}
                  </p>
                )}
              </div>
            </Card>
          </div>

          {/* Middle - Input */}
          <div className="lg:col-span-4 space-y-6">
            <Card className="p-6 space-y-4">
              <div>
                <h2 className="text-2xl font-bold text-foreground mb-2">Company Analysis</h2>
                <p className="text-sm text-muted-foreground">
                  Enter a company website URL and URN to automatically extract buyer intent insights and financial data
                </p>
              </div>

              <div className="space-y-4">
                {!result && (
                  <div>
                    <label htmlFor="company-search" className="text-sm font-medium text-foreground block mb-2">
                      Find a company by name
                    </label>
                    <div className="relative">
                      <Input
                        id="company-search"
                        type="search"
                        placeholder="e.g. Verulam Company"
                        value={companyQuery}
                        onChange={(e) => { setCompanyQuery(e.target.value); setSelectedLookup(null); }}
                        disabled={isRefreshingAll}
                        className="h-12"
                        autoComplete="off"
                        aria-autocomplete="list"
                        aria-expanded={lookupResults.length > 0}
                      />
                      {lookupBusy && <Loader2 className="absolute right-3 top-4 h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
                      {lookupResults.length > 0 && (
                        <ul role="listbox" className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
                          {lookupResults.map((r) => (
                            <li key={r.urn} role="option" aria-selected={false}>
                              <button type="button" className="w-full text-left px-3 py-2 hover:bg-muted focus:bg-muted focus:outline-none" onClick={() => chooseLookup(r)}>
                                <span className="block text-sm font-medium">{r.name}</span>
                                <span className="block text-xs text-muted-foreground">
                                  URN {r.urn}{r.laName ? ` · ${r.laName}` : ''}{r.postcode ? ` · ${r.postcode}` : ''}{r.website ? '' : ' · no website on the DfE record'}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {selectedLookup && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {selectedLookup.name}, URN {selectedLookup.urn}{selectedLookup.laName ? `, ${selectedLookup.laName}` : ''}{selectedLookup.trustName ? `, part of ${selectedLookup.trustName}` : ''}. Website: {url || 'none on record, enter it below'}.
                      </p>
                    )}
                    {companyQuery.trim().length >= 3 && !lookupBusy && lookupResults.length === 0 && !selectedLookup && (
                      <p className="mt-2 text-xs text-muted-foreground">No DfE record found for that name. Independent companies are not listed; enter the address and URN below.</p>
                    )}
                    <button type="button" className="mt-2 text-xs text-primary underline" onClick={() => setManualEntry((v) => !v)}>
                      {manualEntry ? "Hide the address and URN fields" : "Enter the address and URN yourself"}
                    </button>
                  </div>
                )}
                <div className={manualEntry || result || !!selectedLookup ? "" : "hidden"}>
                  <label htmlFor="url" className="text-sm font-medium text-foreground block mb-2">
                    Website URL
                  </label>
                  <Input
                    id="url"
                    type="url"
                    placeholder="https://example-company.co.uk"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && !isRefreshingAll && handleAnalyze()}
                    disabled={isRefreshingAll}
                    className="h-12"
                  />
                </div>

                <div className={manualEntry || result || !!selectedLookup ? "" : "hidden"}>
                  <label htmlFor="urn" className="text-sm font-medium text-foreground block mb-2">
                    Company URN (Unique Reference Number)
                  </label>
                  <Input
                    id="urn"
                    type="text"
                    placeholder="e.g. 145280"
                    value={urn}
                    onChange={(e) => setUrn(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && !isRefreshingAll && handleAnalyze()}
                    disabled={isRefreshingAll}
                    className="h-12"
                  />
                </div>

                {result ? (
                  <Button
                    onClick={handleNewSearch}
                    className="w-full h-12 text-base font-semibold"
                  >
                    <Plus className="mr-2 h-5 w-5" />
                    New Search
                  </Button>
                ) : (
                  <Button
                    onClick={() => handleAnalyze()}
                    disabled={isAnalyzing || isRefreshingAll}
                    className="w-full h-12 text-base font-semibold"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Analyzing...
                      </>
                    ) : isRefreshingAll ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Refreshing All...
                      </>
                    ) : (
                      "Analyse company"
                    )}
                  </Button>
                )}
              </div>
            </Card>

            {isAnalyzing && (
              <Card className="p-6 bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20 animate-fade-in">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      <div className="absolute inset-0 h-6 w-6 animate-ping text-primary/30">
                        <Loader2 className="h-6 w-6" />
                      </div>
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-foreground text-lg">Analysing the company</p>
                      <p className="text-sm text-muted-foreground mt-1" aria-live="polite">
                        {analysisStage ? (ANALYSIS_STAGES.find((x) => x.key === analysisStage)?.label || analysisStage) : 'Starting'}
                        {' · '}{analysisElapsed}s{analysisElapsed > 120 ? ' (a company with large pages can take three minutes)' : ''}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={cancelWaitingForAnalysis}>Stop waiting</Button>
                  </div>
                  <ol className="grid grid-cols-2 gap-1 text-xs sm:grid-cols-4">
                    {ANALYSIS_STAGES.filter((x) => x.key !== 'finished').map((step, index) => {
                      const current = ANALYSIS_STAGES.findIndex((x) => x.key === analysisStage);
                      const state = current < 0 ? (index === 0 ? 'now' : 'todo') : index < current ? 'done' : index === current ? 'now' : 'todo';
                      return (
                        <li key={step.key} className={`rounded p-2 ${state === 'now' ? 'bg-primary/10 text-primary font-medium' : state === 'done' ? 'bg-muted text-foreground' : 'bg-muted text-muted-foreground'}`}>
                          {state === 'done' && <CheckCircle2 className="h-3 w-3 inline mr-1" aria-hidden="true" />}
                          {step.label}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </Card>
            )}
          </div>

          {/* Right Panel - Results */}
          <div className="lg:col-span-5 space-y-6">
            {result ? (
              <>
                <nav aria-label="Sections" className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-1 rounded-md border border-border bg-background/95 px-2 py-1.5 text-xs backdrop-blur">
                  {[['summary', 'Summary'], ['signals', 'Signals'], ['vacancies', 'Vacancies'], ['contacts', 'Contacts'], ['scripts', 'Scripts'], ['spend', 'Spend'], ['calls', 'Calls']].map(([id, label]) => (
                    <a key={id} href={`#${id}`} className="rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">{label}</a>
                  ))}
                </nav>
                {/* Summary */}
                <Card className="p-6 scroll-mt-14" id="summary">
                  <h3 className="text-lg font-bold text-foreground mb-3">Summary</h3>
                  <p className="text-sm text-foreground leading-relaxed">{result.summary}</p>
                  {(() => {
                    const rec = searchHistory.find((h) => h.url === currentSearchUrl)?.record;
                    if (!rec) return <p className="mt-3 text-xs text-muted-foreground">DfE record not matched yet.</p>;
                    if (rec.status !== 'verified') return <p className="mt-3 text-xs text-warning">DfE record not matched: the stored URN {rec.urn} belongs to {rec.name}{rec.laName ? ` (${rec.laName})` : ''}. Vacancies by URN and spend are not shown until it is corrected.</p>;
                    return (
                      <p className="mt-3 text-xs text-muted-foreground">
                        DfE record: {rec.name}, URN {rec.resolvedUrn}{rec.laName ? `, ${rec.laName}` : ''}{rec.phase && rec.phase !== 'unknown' ? `, ${rec.phase}` : ''}<TrustLink urn={rec.resolvedUrn || rec.urn} fallbackName={rec.trustName} />{rec.resolvedUrn !== rec.urn ? ` (stored URN ${rec.urn} is out of date)` : ''}.
                      </p>
                    );
                  })()}
                </Card>

                <div id="spend" className="scroll-mt-14" />
                {(() => {
                  const rec = searchHistory.find((h) => h.url === currentSearchUrl)?.record;
                  const ok = !!rec && rec.status === 'verified';
                  const mentions = result.budgetAndAgencySpend;
                  return (
                    <SpendCard urn={ok && rec ? rec.resolvedUrn || rec.urn : null} laName={ok && rec ? rec.laName : (result.governmentSpendData?.laName || null)} phase={ok && rec && rec.phase !== 'unknown' ? rec.phase : null}>
                      {mentions && (mentions.financialInsights?.length || 0) > 0 && (
                        <details className="rounded-lg border border-border/50 bg-background/30">
                          <summary className="cursor-pointer p-3 text-sm font-medium text-muted-foreground hover:text-foreground">What the website and the analysis say about money</summary>
                          <ul className="space-y-1 px-3 pb-3">
                            {mentions.financialInsights.map((insight, idx) => (
                              <li key={idx} className="text-sm text-muted-foreground">• {insight}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </SpendCard>
                  );
                })()}

                {/* Pupil premium (15 September 2026): the company's own strategy statement, quoted line by line, and our TA-days estimate. */}
                {(() => { const id = searchHistory.find((h) => h.url === currentSearchUrl)?.id; return id ? <PupilPremiumCard companyId={id} /> : null; })()}

                <div id="vacancies" className="scroll-mt-14" />
                {/* Recruitment Insights */}
                {result.recruitmentInsights && (
                <Card className="p-6">
                  <h3 className="text-lg font-bold text-foreground mb-4">Recruitment Intelligence</h3>
                  <div className="space-y-4">
                    {(result.recruitmentInsights?.currentVacancies?.length || 0) > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-foreground mb-2">Current Vacancies</h4>
                        <ul className="space-y-2">
                          {result.recruitmentInsights.currentVacancies.map((vacancy, idx) => {
                            const normalizedStartDate = normalizeVacancyStartDate(
                              vacancy.title,
                              vacancy.startDate
                            );
                            const isUrgent = /(asap|immediate|urgent|immediately)/i.test(normalizedStartDate);
                            // Use verified URL directly - only show vacancies with working links
                            const jobBoardUrl = vacancy.url || generateJobBoardUrl(vacancy.title, extractCompanyName(currentSearchUrl), currentSearchUrl);
                            
                            return (
                              <li key={idx} className="text-sm text-muted-foreground pl-4 flex items-start justify-between gap-2 group">
                                <div className="flex-1">
                                  <span className="flex items-center gap-2 flex-wrap">
                                    • {vacancy.url ? (
                                      <a href={vacancy.url} target="_blank" rel="noopener noreferrer" className="text-foreground hover:underline">{vacancy.title}</a>
                                    ) : vacancy.title}
                                    {vacancy.sourceLabel && (
                                      <Badge variant="outline" className="text-xs py-0 px-1.5 h-5">{vacancy.sourceLabel}</Badge>
                                    )}
                                    {isUrgent && (
                                      <Badge variant="destructive" className="bg-warning hover:bg-warning flex items-center gap-1 text-xs py-0 px-1.5 h-5">
                                        <Zap className="h-2.5 w-2.5" />
                                        Urgent
                                      </Badge>
                                    )}
                                  </span>
                                  <span className={`text-xs ml-2 ${isUrgent ? 'text-warning dark:text-warning' : 'text-muted-foreground/80'}`}>
                                    (Start: {normalizedStartDate}
                                    {vacancy.closingDate ? ` · Closing: ${formatIsoDateUk(vacancy.closingDate)}` : ''}
                                    {vacancy.firstSeen ? ` · New since: ${formatIsoDateUk(vacancy.firstSeen)}` : ''})
                                  </span>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={() => window.open(jobBoardUrl, '_blank')}
                                >
                                  <ExternalLink className="h-3 w-3 mr-1" />
                                  View
                                </Button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                    {result.recruitmentInsights?.recruitmentPatterns && (
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-2">Recruitment Patterns</h4>
                      <p className="text-sm text-muted-foreground">{result.recruitmentInsights.recruitmentPatterns}</p>
                    </div>
                    )}
                    {result.recruitmentInsights?.supplyStaffingNeeds && (
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-2">Supply Staffing Analysis</h4>
                      <p className="text-sm text-muted-foreground">{result.recruitmentInsights.supplyStaffingNeeds}</p>
                    </div>
                    )}
                    {result.recruitmentInsights?.estimatedSpend && (
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-2">Financial Insights</h4>
                      <p className="text-sm text-muted-foreground">{result.recruitmentInsights.estimatedSpend}</p>
                    </div>
                    )}
                  </div>
                </Card>
                )}

                {(() => {
                  const activeCompany = searchHistory.find((h) => h.url === currentSearchUrl);
                  if (!activeCompany) return null;
                  const contacts = mergedContacts.filter((d) => d.name).map((d) => ({ name: d.name, role: d.role }));
                  return (
                    <>
                      <Card className="p-6">
                        <h3 className="text-lg font-bold text-foreground mb-3">Vacancy history</h3>
                        <VacancyHistory companyId={activeCompany.id} />
                      </Card>
                      {followUps && <FollowUpsCard companyId={activeCompany.id} companyName={result.companyRecord?.name || activeCompany.companyName || "the company"} onChange={() => setOutcomesKey((k) => k + 1)} />}
                      <OutcomesCard key={outcomesKey} companyId={activeCompany.id} contacts={contacts} />
                    </>
                  );
                })()}

                {/* Competitor Analysis */}
                {result.governmentSpendData?.laName && searchHistory.length > 1 && (
                  <CompetitorAnalysis
                    searchHistory={searchHistory.map(h => ({
                      id: h.id,
                      url: h.url,
                      companyName: h.companyName,
                      result: h.result,
                      createdAt: new Date(h.timestamp).toISOString()
                    }))}
                    currentCompanyId={searchHistory.find(h => h.url === currentSearchUrl)?.id || ""}
                    laName={result.governmentSpendData.laName}
                  />
                )}

                {/* Awards & Accolades */}
                {(result.awardsAndAccolades?.length || 0) > 0 && (
                  <Card className="p-6">
                    <h3 className="text-lg font-bold text-foreground mb-3">Awards & Accolades</h3>
                    <ul className="space-y-2">
                      {result.awardsAndAccolades.map((award, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <Award className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                          <span className="text-sm text-foreground">{award}</span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                <div id="signals" className="scroll-mt-14" />
                {(() => { const h = searchHistory.find((x) => x.url === currentSearchUrl); const id = h?.id; const rec = h?.record; return id ? <><PropensityCard companyId={id} refreshKey={result.evidence?.computedAt} /><TenderNotices companyId={id} urn={rec && rec.status === 'verified' ? rec.resolvedUrn || rec.urn : null} laName={rec?.laName || result.governmentSpendData?.laName || null} />{shortlister && <div className="mb-6"><CompanyShortlists companyId={id} companyName={h?.companyName || null} /></div>}</> : null; })()}
                {/* Buyer Intent Signals: computed (Phase 3) when present, the old free-text list otherwise */}
                {result.signals ? (
                  <SignalsCard signals={result.signals} computedAt={result.evidence?.computedAt} ofsted={result.ofsted} />
                ) : (result.buyerIntentSignals?.length || 0) > 0 && (
                <Card className="p-6">
                  <h3 className="text-lg font-bold text-foreground mb-3">Buyer Intent Signals</h3>
                  <ul className="space-y-2">
                    {result.buyerIntentSignals?.map((signal, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                        <span className="text-sm text-foreground">{signal}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
                )}

                {/* Risks */}
                {(result.risks?.length || 0) > 0 && (
                  <Card className="p-6">
                    <h3 className="text-lg font-bold text-foreground mb-3">Risks & Considerations</h3>
                    <ul className="space-y-2">
                      {result.risks.map((risk, idx) => (
                        <li key={idx} className="text-sm text-muted-foreground">
                          • {risk}
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                <div id="contacts" className="scroll-mt-14" />
                {/* Decision Makers */}
                <Card className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-foreground">Decision Makers</h3>
                    {(result as { contactsRun?: { pagesFetched?: unknown[] } }).contactsRun?.pagesFetched && (
                      <span className="text-xs text-muted-foreground">{(result as { contactsRun?: { pagesFetched?: unknown[] } }).contactsRun?.pagesFetched?.length} pages read</span>
                    )}
                  </div>
                  {mergedContacts.length === 0 && (
                    <p className="text-sm text-muted-foreground">No named decision makers were found on the company's website. Phone the company office and ask for the headteacher's PA, then add them here.</p>
                  )}
                  <div className="space-y-3">
                    {mergedContacts.map((person, idx) => {
                      // An entry without a confidence predates the 8 September 2026 contacts
                      // rewrite: its address may have been invented by the old regex step.
                      // A contact a consultant edited or added carries its own tag instead.
                      const label = person.edited ? editTag(person.edited) : person.confidence === "consultant_provided" ? providedLabel(person) : person.confidence === "found" ? "found on site" : person.confidence === "pattern_guess" ? (person.provided_by ? `pattern guess (${providedLabel(person)})` : "pattern guess") : person.confidence === "role_only" ? "name only" : "unverified (before 8 Sep)";
                      const labelClass = person.edited ? "bg-primary/10 text-primary" : person.confidence === "found" || person.confidence === "consultant_provided" ? "bg-positive text-positive" : person.confidence === "pattern_guess" || !person.confidence ? "bg-warning text-warning" : "bg-muted text-muted-foreground";
                      const isPage = !!person.source_url && /^https?:/.test(person.source_url);
                      const editNote = person.edited ? [person.edited.note, person.edited.from?.email && person.edited.from.email !== person.email ? `The website says ${person.edited.from.email}.` : null, person.edited.kind === "kept" ? "The website no longer lists this person; the edit is kept." : null].filter(Boolean).join(" ") : "";
                      return (
                        <div key={person.contactKey || idx} className={`p-3 bg-muted/30 rounded-lg border border-border/50 ${person.feedback ? "opacity-60" : ""}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground flex items-center gap-1.5">
                                {person.name || <span className="text-muted-foreground font-normal">No name</span>}
                                {person.level === "trust" && <span className="ml-2 text-xs font-normal text-muted-foreground">trust</span>}
                                {activeCompanyId && (
                                  <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground" aria-label={`Edit ${person.name || "this contact"}`} title="Edit this contact" onClick={() => setContactEditMode({ kind: "edit", contact: person })}>
                                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                  </Button>
                                )}
                              </p>
                              <p className="text-sm text-muted-foreground">{person.role}</p>
                              {person.email ? (
                                <a href={`mailto:${person.email}`} className="text-sm text-primary hover:underline break-all">{person.email}</a>
                              ) : (
                                <span className="text-sm text-muted-foreground">No email on the site. Phone the office and ask by name.</span>
                              )}
                              {person.phone && <p className="text-sm text-muted-foreground">{person.phone}</p>}
                              {followUps && person.email && activeCompanyId && (
                                <ContactEngagement email={person.email} events={emailEvents.data?.events || []} emailed={emailEvents.data?.emailed || []} />
                              )}
                              {followUps && person.email && person.name && !person.feedback && activeCompanyId && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setEmailTarget({ name: person.name, role: person.role, email: person.email })}>
                                    <Mail className="h-3.5 w-3.5" aria-hidden="true" />Email this contact
                                  </Button>
                                  <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setFollowUpTarget({ name: person.name, role: person.role, email: person.email })} title="Two weeks of calls and emails, drafted for you to approve">
                                    <BellRing className="h-3.5 w-3.5" aria-hidden="true" />Start follow-ups
                                  </Button>
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              {label && (person.edited && editNote ? (
                                <Tooltip>
                                  <TooltipTrigger asChild><span tabIndex={0} className={`text-xs px-2 py-0.5 rounded cursor-help ${labelClass}`}>{label}</span></TooltipTrigger>
                                  <TooltipContent side="left" className="max-w-xs text-xs">{editNote}</TooltipContent>
                                </Tooltip>
                              ) : (
                                <span className={`text-xs px-2 py-0.5 rounded ${labelClass}`}>{label}</span>
                              ))}
                              {isPage && (
                                <a href={person.source_url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">source page</a>
                              )}
                              {person.source_url && !isPage && <span className="text-xs text-muted-foreground">{person.source_url}</span>}
                            </div>
                          </div>
                          {person.evidence && (
                            <details className="mt-1">
                              <summary className="text-xs text-muted-foreground cursor-pointer">evidence</summary>
                              <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{person.evidence}</p>
                            </details>
                          )}
                          <div className="mt-2">
                            {person.feedback ? (
                              <span className="text-xs text-muted-foreground">Reported: {person.feedback === "wrong_person" ? "wrong person" : person.feedback === "left" ? "has left" : "bounced"}</span>
                            ) : (
                              <select
                                className="text-xs bg-transparent border border-border/50 rounded px-1 py-0.5 text-muted-foreground"
                                defaultValue=""
                                onChange={(e) => {
                                  const v = e.target.value as ContactFeedbackKind | "";
                                  e.target.value = "";
                                  if (v) reportContact(person, v);
                                }}
                              >
                                <option value="">Wrong / bounced...</option>
                                <option value="bounced">Email bounced</option>
                                <option value="wrong_person">Wrong person</option>
                                <option value="left">Has left the company</option>
                              </select>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {activeCompanyId && (
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setContactEditMode({ kind: "add" })}>
                        <UserPlus className="h-4 w-4" aria-hidden="true" />Add a contact
                      </Button>
                      {contactEdits.isError && <span className="text-xs text-critical">Could not load the team's edits: {contactEdits.error instanceof Error ? contactEdits.error.message : "unknown error"}</span>}
                    </div>
                  )}
                  {removedList.length > 0 && (
                    <details className="mt-3">
                      <summary className="text-xs text-muted-foreground cursor-pointer">{removedList.length === 1 ? "1 contact removed" : `${removedList.length} contacts removed`}</summary>
                      <ul className="mt-2 space-y-1">
                        {removedList.map((r) => (
                          <li key={r.contactKey} className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                            <span className="text-foreground">{r.name}{r.role ? `, ${r.role}` : ""}</span>
                            <span>removed by {r.by}, {shortUkDate(r.at)}{r.reason ? `: ${r.reason}` : ""}</span>
                            {activeCompanyId && <button type="button" className="text-primary hover:underline" onClick={() => setContactEditMode({ kind: "restore", removed: r })}>Put back</button>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </Card>

                <div id="scripts" className="scroll-mt-14" />
                {/* Scripts (Phase 3): per-persona tabs; legacy text for older analyses */}
                <ScriptsCard
                  copy={result.copy}
                  legacyCall={result.coldCallScript}
                  legacyEmail={result.warmEmailScript}
                  inTrust={!!result.companyRecord?.trustName}
                  currentFingerprint={result.evidenceFingerprint}
                  evidenceComputedAt={result.evidence?.computedAt}
                  regenerating={regenerating}
                  onRegenerate={regenerateCopy}
                  onCopy={copyToClipboard}
                  copiedField={copiedField}
                />
              </>
            ) : (
              <Card className="p-12">
                <div className="text-center text-muted-foreground">
                  <p className="text-lg font-medium mb-2">No Analysis Yet</p>
                  <p className="text-sm">Enter a company URL and click Analyse to get started</p>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Email this contact (Follow-ups slice 1, behind the flag) */}
      {followUps && activeCompanyId && emailTarget && (
        <EmailContactDialog
          companyId={activeCompanyId}
          companyName={result?.companyRecord?.name || searchHistory.find((h) => h.id === activeCompanyId)?.companyName || "the company"}
          contact={emailTarget}
          open={!!emailTarget}
          onOpenChange={(open) => { if (!open) setEmailTarget(null); }}
          onSent={() => void emailEvents.refetch()}
        />
      )}

      {/* Edit, add or remove a contact (Contact edits, 18 September 2026; everyone signed in) */}
      {activeCompanyId && contactEditMode && (
        <ContactEditDialog
          companyId={activeCompanyId}
          companyName={result?.companyRecord?.name || searchHistory.find((h) => h.id === activeCompanyId)?.companyName || "the company"}
          mode={contactEditMode}
          open={!!contactEditMode}
          onOpenChange={(open) => { if (!open) setContactEditMode(null); }}
          onSaved={() => setOutcomesKey((k) => k + 1)}
        />
      )}

      {/* Start follow-ups (Follow-ups slice 2, behind the flag) */}
      {followUps && activeCompanyId && followUpTarget && (
        <StartFollowUpsDialog
          companyId={activeCompanyId}
          companyName={result?.companyRecord?.name || searchHistory.find((h) => h.id === activeCompanyId)?.companyName || "the company"}
          contact={followUpTarget}
          open={!!followUpTarget}
          onOpenChange={(open) => { if (!open) { setFollowUpTarget(null); setOutcomesKey((k) => k + 1); } }}
        />
      )}

      {/* League Table Dialog */}
      <Dialog open={showLeagueTable} onOpenChange={setShowLeagueTable}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-positive" />
              {leagueTableMode === 'absolute' ? (
                <>
                  {leagueTableMetric === 'bae20' && 'Agency Supply Teaching League Table'}
                  {leagueTableMetric === 'ba240' && 'Supply Staff Costs League Table'}
                  {leagueTableMetric === 'ba030' && 'Education Support League Table'}
                  {leagueTableMetric === 'total' && 'Total Expenditure League Table'}
                </>
              ) : (
                <>
                  {leagueTableMetric === 'bae20' && 'Agency Supply Teaching – Year-on-Year Change'}
                  {leagueTableMetric === 'ba240' && 'Supply Staff Costs – Year-on-Year Change'}
                  {leagueTableMetric === 'ba030' && 'Education Support – Year-on-Year Change'}
                  {leagueTableMetric === 'total' && 'Total Expenditure – Year-on-Year Change'}
                </>
              )}
            </DialogTitle>
          </DialogHeader>

          {/* Mode Toggle */}
          <div className="flex gap-2 mb-2">
            <Button
              variant={leagueTableMode === 'absolute' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLeagueTableMode('absolute')}
            >
              <PoundSterling className="h-3 w-3 mr-1" />
              Absolute Spend
            </Button>
            <Button
              variant={leagueTableMode === 'change' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLeagueTableMode('change')}
            >
              <ArrowUpDown className="h-3 w-3 mr-1" />
              Year-on-Year Change
            </Button>
          </div>

          {/* Year Toggle (for absolute mode) */}
          {leagueTableMode === 'absolute' && (
            <div className="flex gap-2 mb-2">
              <span className="text-sm font-medium text-muted-foreground self-center mr-1">Fiscal Year:</span>
              {[...cfrYears].reverse().map((year) => (
                <Button key={year} variant={leagueTableYear === year ? 'default' : 'outline'} size="sm" onClick={() => setLeagueTableYear(year)}>
                  {year}
                </Button>
              ))}
            </div>
          )}
          
          {/* Metric Tabs */}
          <div className="flex gap-2 flex-wrap">
            <Button
              variant={leagueTableMetric === 'bae20' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLeagueTableMetric('bae20')}
            >
              BAE20 - Agency Supply
            </Button>
            <Button
              variant={leagueTableMetric === 'ba240' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLeagueTableMetric('ba240')}
            >
              BA240 - Supply Costs
            </Button>
            <Button
              variant={leagueTableMetric === 'ba030' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLeagueTableMetric('ba030')}
            >
              BA030 - Education Support
            </Button>
            <Button
              variant={leagueTableMetric === 'agencyTotal' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLeagueTableMetric('agencyTotal')}
              className={leagueTableMetric === 'agencyTotal' ? 'bg-warning hover:bg-warning' : 'border-warning/50 text-warning hover:bg-warning/10'}
            >
              Agency and supply teaching
            </Button>
            <Button
              variant={leagueTableMetric === 'total' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLeagueTableMetric('total')}
            >
              Total Expenditure
            </Button>
          </div>
          
          {/* Filters and Export */}
          <div className="flex flex-wrap items-center justify-between gap-4 mt-4 pb-4 border-b">
            <div className="flex items-center gap-2 flex-wrap">
              <Filter className="h-4 w-4 text-muted-foreground" />
              {leagueTableMode === 'absolute' && (
                <>
                  <span className="text-sm font-medium text-foreground">Filter by spend:</span>
                  <div className="flex gap-2">
                    <Button
                      variant={spendingFilter === 0 ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSpendingFilter(0)}
                      className="h-8"
                    >
                      All
                    </Button>
                    <Button
                      variant={spendingFilter === 50000 ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSpendingFilter(50000)}
                      className="h-8"
                    >
                      £50k+
                    </Button>
                    <Button
                      variant={spendingFilter === 100000 ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSpendingFilter(100000)}
                      className="h-8"
                    >
                      £100k+
                    </Button>
                    <Button
                      variant={spendingFilter === 200000 ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSpendingFilter(200000)}
                      className="h-8"
                    >
                      £200k+
                    </Button>
                  </div>
                </>
              )}
              <Select value={laFilter} onValueChange={setLaFilter}>
                <SelectTrigger className="w-[200px] h-8">
                  <SelectValue placeholder="Filter by LA" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Boroughs</SelectItem>
                  {uniqueLANames.map(la => (
                    <SelectItem key={la} value={la}>{la}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={exportToCSV}
                className="h-8"
              >
                <Download className="h-3 w-3 mr-1" />
                CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={exportToPDF}
                className="h-8"
              >
                <Download className="h-3 w-3 mr-1" />
                PDF
              </Button>
            </div>
          </div>

          <div className="mt-4">
            {leagueTableMode === 'absolute' ? (
              (() => {
                const metricKey = leagueTableMetric;
                const prevKey = `${metricKey}Prev` as keyof typeof dashboardMetrics.companySpendList[0];
                const isCurrentYear = leagueTableYear === currYear;
                
                // Get the value for the selected year
                const getValue = (company: typeof dashboardMetrics.companySpendList[0]) => {
                  if (isCurrentYear) return company[metricKey] as number;
                  return (company[prevKey] as number) || 0;
                };
                
                const formatCurrency = (val: number) => {
                  if (val === 0) return 'N/A';
                  return `£${val.toLocaleString()}`;
                };

                const sortedList = [...dashboardMetrics.companySpendList].sort((a, b) => getValue(b) - getValue(a));
                const filteredList = sortedList.filter(company => 
                  getValue(company) >= spendingFilter && 
                  getValue(company) > 0 &&
                  (laFilter === 'all' || company.laName === laFilter)
                );
                
                
                
                return filteredList.length > 0 ? (
                  <div className="space-y-2">
                    {filteredList.map((company) => {
                      const originalIndex = sortedList.indexOf(company);
                      const value = getValue(company);
                      return (
                        <Card 
                          key={company.url} 
                          className={`p-4 ${originalIndex === 0 ? 'border-positive bg-positive/5' : 'bg-muted/30'}`}
                        >
                          <div className="flex items-center gap-4">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                              originalIndex === 0 ? 'bg-positive text-white' :
                              originalIndex === 1 ? 'bg-positive/50 text-foreground' :
                              originalIndex === 2 ? 'bg-positive/50 text-foreground' :
                              'bg-muted text-muted-foreground'
                            }`}>
                              {originalIndex + 1}
                            </div>
                            <div className="flex-1">
                              <p className="font-semibold text-foreground">
                                {company.companyName}
                                {company.laName && <span className="text-muted-foreground font-normal"> - {company.laName}</span>}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">{LEAGUE_METRIC_LABELS[metricKey]} ({leagueTableYear})</p>
                            </div>
                            <div className="text-right">
                              <p className="text-2xl font-bold text-positive">
                                {isCurrentYear ? (company[`${metricKey}Text`] as string) : formatCurrency(value)}
                              </p>
                              <p className="text-xs text-muted-foreground">{leagueTableYear}</p>
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>No companies match the selected filter</p>
                    <p className="text-sm mt-2">Try adjusting the spending threshold</p>
                  </div>
                );
              })()
            ) : (
              (() => {
                const metricKey = leagueTableMetric;
                const changeKey = `${metricKey}Change` as keyof typeof dashboardMetrics.companySpendList[0];
                const changePctKey = `${metricKey}ChangePct` as keyof typeof dashboardMetrics.companySpendList[0];
                const prevKey = `${metricKey}Prev` as keyof typeof dashboardMetrics.companySpendList[0];
                const earlierKey = `${metricKey}Earlier` as keyof typeof dashboardMetrics.companySpendList[0];
                const change3PctKey = `${metricKey}Change3Pct` as keyof typeof dashboardMetrics.companySpendList[0];

                // Filter to companies with both years of data (must have non-zero spend in BOTH years)
                const companiesWithChange = dashboardMetrics.companySpendList.filter(company => {
                  const change = company[changeKey] as number | null;
                  const prev = company[prevKey] as number;
                  return change !== null && prev > 0 && (company[metricKey] as number) > 0;
                }).filter(company => laFilter === 'all' || company.laName === laFilter);

                // Sort by change amount (biggest increase at top, biggest decrease at bottom)
                const sortedByIncrease = [...companiesWithChange].sort((a, b) => {
                  const aChange = (a[changeKey] as number) || 0;
                  const bChange = (b[changeKey] as number) || 0;
                  return bChange - aChange;
                });

                const formatMoney = (val: number) => {
                  if (!val) return '£0';
                  return `£${Math.round(Math.abs(val)).toLocaleString()}`;
                };
                
                return sortedByIncrease.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground mb-3">
                      Showing {sortedByIncrease.length} companies with year-on-year data ({prevYear} to {currYear}), sorted by largest increase first{earlierYear ? `; the ${earlierYear} figure and the three-year change are shown where published` : ''}
                    </p>
                    {sortedByIncrease.map((company, index) => {
                      const change = (company[changeKey] as number) || 0;
                      const changePct = (company[changePctKey] as number) || 0;
                      const prev = (company[prevKey] as number) || 0;
                      const curr = company[metricKey] || 0;
                      const earlier = (company[earlierKey] as number) || 0;
                      const change3Pct = company[change3PctKey] as number | null;
                      const isIncrease = change > 0;
                      const isDecrease = change < 0;
                      
                      return (
                        <Card 
                          key={company.url} 
                          className={`p-4 ${isIncrease ? 'border-positive/30 bg-positive/5' : isDecrease ? 'border-critical/30 bg-critical/5' : 'bg-muted/30'}`}
                        >
                          <div className="flex items-center gap-4">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                              isIncrease ? 'bg-positive text-white' : isDecrease ? 'bg-critical text-white' : 'bg-muted text-muted-foreground'
                            }`}>
                              {index + 1}
                            </div>
                            <div className="flex-1">
                              <p className="font-semibold text-foreground">
                                {company.companyName}
                                {company.laName && <span className="text-muted-foreground font-normal"> - {company.laName}</span>}
                              </p>
                              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                {earlierYear && earlier > 0 && (<><span>{earlierYear}: £{Math.round(earlier).toLocaleString()}</span><span>→</span></>)}
                                <span>{prevYear}: £{Math.round(prev).toLocaleString()}</span>
                                <span>→</span>
                                <span>{currYear}: £{Math.round(curr).toLocaleString()}</span>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className={`flex items-center gap-1 text-lg font-bold ${
                                isIncrease ? 'text-positive' : isDecrease ? 'text-critical' : 'text-muted-foreground'
                              }`}>
                                {isIncrease ? <TrendingUp className="h-5 w-5" /> : isDecrease ? <TrendingDown className="h-5 w-5" /> : null}
                                {isIncrease ? '+' : ''}{formatMoney(change)}
                              </div>
                              <p className={`text-sm font-semibold ${
                                isIncrease ? 'text-positive' : isDecrease ? 'text-critical' : 'text-muted-foreground'
                              }`}>
                                {changePct !== null ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(0)}%` : 'N/A'}
                              </p>
                              {earlierYear && earlier > 0 && change3Pct !== null && (
                                <p className="text-xs text-muted-foreground" title={`${earlierYear} to ${currYear}`}>3 years: {change3Pct >= 0 ? '+' : ''}{change3Pct.toFixed(0)}%</p>
                              )}
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>No companies have both {prevYear} and {currYear} data for comparison</p>
                    <p className="text-sm mt-2">Refresh companies to fetch the latest financial data</p>
                  </div>
                );
              })()
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Candidate Text Dialog */}
      <Dialog open={!!selectedCompanyForCandidate} onOpenChange={() => setSelectedCompanyForCandidate(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Candidate Recruitment Text - {selectedCompanyForCandidate?.companyName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {isGeneratingCandidate ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-center">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                  <p className="text-muted-foreground">Generating candidate recruitment text...</p>
                </div>
              </div>
            ) : candidateText ? (
              <div className="space-y-4">
                <div className="bg-muted/50 p-4 rounded-lg max-h-[500px] overflow-y-auto">
                  <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                    {candidateText}
                  </p>
                </div>
                <Button
                  onClick={() => {
                    navigator.clipboard.writeText(candidateText);
                    toast({
                      title: "Copied to Clipboard",
                      description: "Candidate text copied successfully.",
                    });
                  }}
                  className="w-full"
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copy to Clipboard
                </Button>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {/* Spend Category Info Dialog */}
      <Dialog open={showSpendCategoryInfo} onOpenChange={setShowSpendCategoryInfo}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Understanding Spend Categories</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="bg-positive/10 border border-positive/30 p-4 rounded-lg">
                <h4 className="font-semibold text-foreground mb-2 flex items-center gap-2">
                  <PoundSterling className="h-5 w-5 text-positive" />
                  BAE20 - Agency Supply Teaching Staff
                </h4>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  This code captures costs for supply teachers, including where a company uses an agency rather than directly employed substitutes. 
                  In other words: when a company pays for temporary or cover teaching staff via an agency rather than its regular staff.
                </p>
              </div>

              <div className="bg-background border border-border p-4 rounded-lg">
                <h4 className="font-semibold text-foreground mb-2 flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-muted-foreground" />
                  BA240 - Supply Staff Costs
                </h4>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  This is a more aggregated or alternative classification also related to supply staff and temporary staffing. 
                  On some companies' publicly-available spending breakdowns, BA240 appears alongside BAE20 under "Teaching and teaching support staff costs."
                </p>
              </div>

              <div className="bg-background border border-border p-4 rounded-lg">
                <h4 className="font-semibold text-foreground mb-2 flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
                  BA030 - Educational Support Staff
                </h4>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  This covers staff who support teaching but aren't classroom teachers: e.g., teaching assistants, SEN support staff, 
                  classroom support staff, learning support, and other "education support staff."
                </p>
              </div>
            </div>

            <div className="bg-muted/50 p-4 rounded-lg">
              <p className="text-xs text-muted-foreground">
                <strong>Source:</strong> Financial data extracted from the UK Government's Financial Benchmarking and Insights Tool 
                (financial-benchmarking-and-insights-tool.education.gov.uk)
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>




    </div>
  );
};

export default Index;
