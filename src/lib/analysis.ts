/**
 * The shape of company_searches.analysis_result as the app reads it
 * (docs/PORT-CONTRACTS.md, "analysis_result"), and the small pure helpers
 * that present the Companies House record. Nothing here talks to the
 * database.
 */
import type { Persona, StoredCopy } from "@/components/ScriptsCard";
import type { Signal } from "@/components/SignalsCard";
import type { RoleFamily } from "@/lib/roleFamily";

export interface CompanyRecord {
  companyNumber: string;
  name: string;
  previousNames?: string[];
  /** Companies House company_status: 'active', 'dissolved', 'liquidation', 'administration', ... */
  status: string | null;
  /** ISO YYYY-MM-DD */
  incorporationDate: string | null;
  sicCodes?: string[];
  registeredOffice?: { line1: string | null; locality: string | null; region: string | null; postcode: string | null; country: string | null } | null;
  postcodeDistrict?: string | null;
  accountsType?: string | null;
  lastAccountsMadeUpTo?: string | null;
  lastConfirmationStatement?: string | null;
  fetchedAt?: string;
  /** false when the key is missing, the number is unknown or the read failed; `note` says why. */
  verified?: boolean;
  note?: string | null;
}

export type StageLabel = "pre_seed" | "seed" | "series_a" | "series_b_plus" | "unknown";

export interface StageGuess {
  label: StageLabel;
  evidence: string | null;
  source_url: string | null;
}

export interface LatestRaise {
  amountText: string | null;
  amountGbp: number | null;
  round: string | null;
  /** ISO YYYY-MM-DD when the evidence dates the round. */
  date: string | null;
  investors: string[];
  statement: string;
  source_url: string;
}

export interface Officer {
  officerId?: string | null;
  name: string;
  /** officer_role: 'director', 'secretary', 'llp-member', ... */
  role: string;
  appointedOn: string | null;
  resignedOn: string | null;
}

export interface AtsBoard {
  provider: "ashby" | "greenhouse" | "lever" | "workable";
  slug: string;
  boardUrl: string | null;
}

/** One open role as analysis_result.recruitmentInsights.currentVacancies carries it. */
export interface OpenRole {
  title: string;
  url?: string | null;
  source?: string | null;
  sourceLabel?: string | null;
  firstSeen?: string | null;
  datePosted?: string | null;
  department?: string | null;
  location?: string | null;
  workplaceType?: string | null;
  family?: RoleFamily | string | null;
  vacancyId?: string | null;
}

export interface DecisionMaker {
  name: string;
  role: string;
  email: string;
  confidence?: "found" | "pattern_guess" | "role_only" | "consultant_provided";
  source_url?: string;
  evidence?: string;
  phone?: string;
  /** 'careers' when the person was read from a careers site on another host. */
  level?: "company" | "careers";
  feedback?: "bounced" | "wrong_person" | "left";
  provided_by?: string;
  provided_at?: string;
  notes?: string;
  /** The person's LinkedIn profile when Hunter gave one. */
  linkedin?: string | null;
  /** Addresses for name-only people (22 September 2026): Hunter's verdict on a Finder answer or a guess. */
  verification?: "deliverable" | "risky" | "undeliverable" | "unknown" | null;
  email_source?: "finder" | "guess";
}

export interface Fact {
  id: string;
  kind: string;
  statement: string;
  quote: string;
  source_url: string;
  date_hint?: string | null;
}

export interface AnalysisResult {
  summary: string;
  buyerIntentSignals?: string[];
  decisionMakers: DecisionMaker[];
  /** The company's LinkedIn page, from its website or Hunter. */
  linkedin?: string | null;
  recruitmentInsights?: { currentVacancies?: OpenRole[] } | null;
  companyRecord?: CompanyRecord | null;
  stage?: StageGuess | null;
  latestRaise?: LatestRaise | null;
  officers?: Officer[];
  boards?: AtsBoard[];
  vacancyRun?: { at?: string; degraded?: boolean; degradedReason?: string | null; sourcesOk?: string[]; sourcesTried?: string[] } | null;
  contactsRun?: { pagesFetched?: unknown[]; enrichmentNote?: string | null } | null;
  propensity?: { score: number; topReason: string | null; topCode: string | null } | null;
  facts?: Fact[];
  signals?: Signal[];
  evidenceFingerprint?: string;
  evidence?: { computedAt?: string; model?: string };
  copy?: Partial<Record<Persona, StoredCopy>>;
  consultant?: string;
  /** "blocks automated reading" when the site challenges every server. */
  websiteAccess?: string | null;
}

export const STAGE_LABELS: Record<StageLabel, string> = {
  pre_seed: "Pre-seed",
  seed: "Seed",
  series_a: "Series A",
  series_b_plus: "Series B and later",
  unknown: "Unknown",
};

export const STAGE_ORDER: StageLabel[] = ["pre_seed", "seed", "series_a", "series_b_plus", "unknown"];

/** The register's status in plain words: "Active", "Dissolved", "In liquidation", "In administration". */
export function companyStatusLabel(status: string | null | undefined): string {
  if (!status) return "";
  const s = status.toLowerCase().replace(/[-_]/g, " ");
  if (s === "active") return "Active";
  if (s === "dissolved") return "Dissolved";
  if (s === "liquidation") return "In liquidation";
  if (s === "administration") return "In administration";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A dissolved or liquidating company is never refreshed, alerted or scored again. */
export function companyIsClosed(status: string | null | undefined): boolean {
  const s = (status || "").toLowerCase();
  return s === "dissolved" || s === "liquidation" || s.includes("liquidation") || s === "closed";
}

export function companiesHouseUrl(companyNumber: string): string {
  return `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(companyNumber)}`;
}

/** "Shoreditch, London (EC2A)": the registered office's locality and district, whatever the record has. */
export function registeredOfficeLine(record: Pick<CompanyRecord, "registeredOffice" | "postcodeDistrict"> | null | undefined): string {
  if (!record) return "";
  const office = record.registeredOffice;
  const place = [office?.locality, office?.region].filter((x): x is string => !!x && x.trim().length > 0);
  const unique = place.filter((x, i) => place.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
  const district = record.postcodeDistrict || (office?.postcode ? office.postcode.trim().split(/\s+/)[0] : null);
  const head = unique.join(", ");
  if (head && district) return `${head} (${district})`;
  return head || district || office?.country || "";
}
