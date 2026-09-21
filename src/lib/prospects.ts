// Prospecting (slice 3): the companies the radar found on its own. The
// reads and the function calls are in prospectsData.ts; everything here is
// pure so the page's wording and grouping are testable.

export type ProspectStatus = "new" | "qualified" | "promoted" | "dismissed" | "unsuitable";

export type ProspectSourceKey = "funding_news" | "companies_house" | "adzuna" | "reed";

/** The order the sources are shown in: the ones that say "hiring now" first, the register pool last. */
export const SOURCE_ORDER: ProspectSourceKey[] = ["funding_news", "adzuna", "reed", "companies_house"];

export const SOURCE_LABELS: Record<ProspectSourceKey, string> = {
  funding_news: "Funding news",
  companies_house: "Companies House",
  adzuna: "Adzuna",
  reed: "Reed",
};

export interface ProspectSource {
  source: ProspectSourceKey | string;
  url: string | null;
  title: string | null;
  at: string | null;
  note: string | null;
}

export interface ProspectRaise {
  amountText: string | null;
  amountGbp: number | null;
  round: string | null;
  date: string | null;
  url: string | null;
}

export interface ProspectRegister {
  status: string | null;
  incorporationDate: string | null;
  sicCodes: string[];
  sector: string | null;
  locality: string | null;
  postcodeDistrict: string | null;
  capitalFilings: Array<{ date: string | null; type: string | null; description: string | null }>;
}

export interface ProspectBoard {
  provider: string;
  slug: string | null;
  count: number;
  talentRoles: string[];
  titles: string[];
}

export interface TalentPosting {
  title: string;
  employer: string | null;
  source: string | null;
  url: string | null;
  date: string | null;
}

/** A score line as the page reads it, whatever shape the function stored: a string or {points, reason}. */
export interface ScoreReason {
  points: number | null;
  text: string;
}

export interface Prospect {
  id: string;
  name: string;
  nameKey: string;
  website: string | null;
  companyNumber: string | null;
  status: ProspectStatus;
  sources: ProspectSource[];
  raise: ProspectRaise | null;
  register: ProspectRegister | null;
  boards: ProspectBoard[];
  talentPostings: TalentPosting[];
  score: number | null;
  scoreReasons: ScoreReason[];
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  qualifiedAt: string | null;
  promotedAt: string | null;
  dismissedAt: string | null;
  promotedCompanyId: string | null;
  dismissReason: string | null;
}

/** The raw row shape the page reads from `prospects`; every column optional so a slim read parses too. */
export interface ProspectRowLike {
  id: string;
  name?: string | null;
  name_key?: string | null;
  website?: string | null;
  company_number?: string | null;
  status?: string | null;
  sources?: unknown;
  raise?: unknown;
  register?: unknown;
  boards?: unknown;
  talent_postings?: unknown;
  prospect_score?: number | null;
  score_reasons?: unknown;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
  qualified_at?: string | null;
  promoted_at?: string | null;
  dismissed_at?: string | null;
  promoted_company_id?: string | null;
  dismiss_reason?: string | null;
}

const STATUSES: ProspectStatus[] = ["new", "qualified", "promoted", "dismissed", "unsuitable"];

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : x === null || x === undefined ? null : typeof x === "number" ? String(x) : null);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : typeof x === "string" && x.trim() && Number.isFinite(Number(x)) ? Number(x) : null);
const strList = (x: unknown): string[] => (Array.isArray(x) ? x.map((s) => str(s)).filter((s): s is string => !!s) : []);
const records = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter(isRecord) : []);

/** Parse one score line: "+45 a talent lead role advertised" or {points: 45, reason: "..."} (also label or text). */
export function parseScoreReason(line: unknown): ScoreReason | null {
  if (typeof line === "string") {
    const m = line.trim().match(/^([+−-]?\s*\d+)\s*[:,.]?\s*(.*)$/);
    if (m && m[2]) return { points: Number(m[1].replace(/\s+/g, "").replace("−", "-")), text: m[2].trim() };
    return line.trim() ? { points: null, text: line.trim() } : null;
  }
  if (isRecord(line)) {
    const text = str(line.reason) || str(line.label) || str(line.text) || str(line.line);
    if (!text) return null;
    return { points: num(line.points), text };
  }
  return null;
}

/** A `prospects` row as the page uses it. Unknown JSON shapes become empty lists rather than errors. */
export function parseProspectRow(row: ProspectRowLike): Prospect {
  const status = STATUSES.includes(row.status as ProspectStatus) ? (row.status as ProspectStatus) : "new";
  const raise = isRecord(row.raise) ? row.raise : null;
  const register = isRecord(row.register) ? row.register : null;
  return {
    id: row.id,
    name: str(row.name) || "A company",
    nameKey: str(row.name_key) || "",
    website: str(row.website),
    companyNumber: str(row.company_number),
    status,
    sources: records(row.sources).map((s) => ({ source: str(s.source) || "unknown", url: str(s.url), title: str(s.title), at: str(s.at), note: str(s.note) })),
    raise: raise ? { amountText: str(raise.amountText), amountGbp: num(raise.amountGbp), round: str(raise.round), date: str(raise.date), url: str(raise.url) } : null,
    register: register
      ? {
          status: str(register.status),
          incorporationDate: str(register.incorporationDate),
          sicCodes: strList(register.sicCodes),
          sector: str(register.sector),
          locality: str(register.locality),
          postcodeDistrict: str(register.postcodeDistrict),
          capitalFilings: records(register.capitalFilings).map((f) => ({ date: str(f.date), type: str(f.type), description: str(f.description) })),
        }
      : null,
    boards: records(row.boards).map((b) => ({ provider: str(b.provider) || "board", slug: str(b.slug), count: num(b.count) ?? 0, talentRoles: strList(b.talentRoles), titles: strList(b.titles) })),
    talentPostings: records(row.talent_postings)
      .map((p) => ({ title: str(p.title) || "", employer: str(p.employer), source: str(p.source), url: str(p.url), date: str(p.date) }))
      .filter((p) => p.title),
    score: num(row.prospect_score),
    scoreReasons: (Array.isArray(row.score_reasons) ? row.score_reasons : []).map(parseScoreReason).filter((r): r is ScoreReason => !!r),
    firstSeenAt: str(row.first_seen_at),
    lastSeenAt: str(row.last_seen_at),
    qualifiedAt: str(row.qualified_at),
    promotedAt: str(row.promoted_at),
    dismissedAt: str(row.dismissed_at),
    promotedCompanyId: str(row.promoted_company_id),
    dismissReason: str(row.dismiss_reason),
  };
}

export type ChipTone = "positive" | "critical" | "muted";

export interface ScoreChip {
  /** "+45 a talent lead role advertised", or the text alone when the line carries no points. */
  label: string;
  points: number | null;
  tone: ChipTone;
}

/** Semantic classes only, so dark mode stays right. */
export const CHIP_CLASSES: Record<ChipTone, string> = {
  positive: "bg-positive/15 text-positive border-positive/30",
  critical: "bg-critical/15 text-critical border-critical/30",
  muted: "bg-muted text-muted-foreground border-border",
};

/** The score's lines as chips, the biggest gains first, then the penalties, then the notes with no points. */
export function scoreChips(reasons: ScoreReason[] | unknown): ScoreChip[] {
  const lines = Array.isArray(reasons) ? reasons.map(parseScoreReason).filter((r): r is ScoreReason => !!r) : [];
  const chips = lines.map((r) => ({
    label: r.points === null ? r.text : `${r.points > 0 ? "+" : r.points < 0 ? "−" : ""}${Math.abs(r.points)} ${r.text}`,
    points: r.points,
    tone: (r.points === null || r.points === 0 ? "muted" : r.points > 0 ? "positive" : "critical") as ChipTone,
  }));
  const rank = (c: ScoreChip) => (c.points === null ? 2 : c.points < 0 ? 1 : 0);
  return chips.sort((a, b) => rank(a) - rank(b) || (b.points ?? 0) - (a.points ?? 0));
}

export interface SourceLine {
  key: string;
  /** "Funding news", "Adzuna", "Reed", "Companies House". */
  label: string;
  /** The headline, the posting title or the note, else the label. */
  text: string;
  url: string | null;
  at: string | null;
}

function sourceLabel(key: string): string {
  return SOURCE_LABELS[key as ProspectSourceKey] || key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** One line per source entry, newest first, the same link never twice. */
export function sourceLines(sources: ProspectSource[] | unknown): SourceLine[] {
  const list = records(sources).map((s) => ({ source: str(s.source) || "unknown", url: str(s.url), title: str(s.title), at: str(s.at), note: str(s.note) }));
  const seen = new Set<string>();
  const out: SourceLine[] = [];
  for (const s of list) {
    const dedupe = `${s.source}|${s.url || s.title || s.note || ""}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({ key: dedupe, label: sourceLabel(s.source), text: s.title || s.note || sourceLabel(s.source), url: s.url, at: s.at });
  }
  return out.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
}

const PROVIDER_LABELS: Record<string, string> = { ashby: "Ashby", greenhouse: "Greenhouse", lever: "Lever", workable: "Workable", careers_page: "Careers page" };

/** "Ashby: 13 roles, talent: Head of Talent" per board, joined with "; "; "" with no board. */
export function boardsLine(boards: ProspectBoard[]): string {
  return boards
    .map((b) => {
      const label = PROVIDER_LABELS[b.provider.toLowerCase()] || b.provider;
      const roles = `${b.count} ${b.count === 1 ? "role" : "roles"}`;
      return b.talentRoles.length ? `${label}: ${roles}, talent: ${b.talentRoles.join(", ")}` : `${label}: ${roles}`;
    })
    .join("; ");
}

/** "Head of Talent (Adzuna, 18 Sep)" per posting from the job APIs. */
export function postingLine(p: TalentPosting): string {
  const bits = [p.source ? sourceLabel(p.source) : null, p.date ? shortDate(p.date) : null].filter(Boolean);
  return bits.length ? `${p.title} (${bits.join(", ")})` : p.title;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "21 Sep" in UTC; "" when it does not parse. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "05:30, 21 Sep" in UTC, for the run times. */
export function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC, ${shortDate(iso)}`;
}

/** The host of a website for the link text: "metris.energy" from "https://www.metris.energy/". */
export function websiteHost(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A website as the function wants it: with a scheme, no spaces; "" when the text is not a host. */
export function normaliseWebsite(text: string): string {
  const t = text.trim();
  if (!t || /\s/.test(t)) return "";
  const withScheme = t.includes("://") ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname.includes(".")) return "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export const DISMISS_REASONS: Array<{ value: string; label: string }> = [
  { value: "not_a_startup", label: "Not a start-up" },
  { value: "agency", label: "An agency" },
  { value: "already_client", label: "Already a client" },
  { value: "wrong_country", label: "Wrong country" },
  { value: "other", label: "Other" },
];

/** Promoted this month: the window for "Added by the radar". */
export const PROMOTED_DAYS = 31;

export interface WatchingCount {
  source: ProspectSourceKey;
  label: string;
  count: number;
}

export interface GroupedProspects {
  /** Qualified, best score first. */
  ready: Prospect[];
  /** Promoted in the last PROMOTED_DAYS days, newest first. */
  promoted: Prospect[];
  /** Status new, counted under every source that found the prospect, in SOURCE_ORDER. */
  watchingBySource: WatchingCount[];
  /** Status new, each prospect once. */
  watching: number;
}

/** The page's three groups from the rows the loader read. */
export function groupProspects(rows: Prospect[], today: Date = new Date()): GroupedProspects {
  const since = today.getTime() - PROMOTED_DAYS * 86_400_000;
  const ready = rows.filter((p) => p.status === "qualified").sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));
  const promoted = rows
    .filter((p) => p.status === "promoted" && p.promotedAt && new Date(p.promotedAt).getTime() >= since)
    .sort((a, b) => (b.promotedAt || "").localeCompare(a.promotedAt || "") || a.name.localeCompare(b.name));
  const fresh = rows.filter((p) => p.status === "new");
  const counts = new Map<string, number>();
  for (const p of fresh) {
    for (const key of new Set(p.sources.map((s) => s.source))) counts.set(key, (counts.get(key) || 0) + 1);
  }
  const watchingBySource = SOURCE_ORDER.map((source) => ({ source, label: SOURCE_LABELS[source], count: counts.get(source) || 0 }));
  return { ready, promoted, watchingBySource, watching: fresh.length };
}

/** "3 companies", "1 company", "no companies". */
function companies(n: number): string {
  return n === 0 ? "no companies" : n === 1 ? "1 company" : `${n} companies`;
}

/**
 * The line above the table on My patch: "The radar added 3 companies this
 * week and has 7 more ready." With nothing added: "The radar has 7 ready to
 * add." With nothing at all: "The radar has added nothing this week and has
 * nothing ready yet."
 */
export function radarLine(counts: { addedThisWeek: number; ready: number }): string {
  const { addedThisWeek, ready } = counts;
  if (addedThisWeek === 0 && ready === 0) return "The radar has added nothing this week and has nothing ready yet.";
  if (addedThisWeek === 0) return `The radar has ${ready} ready to add.`;
  if (ready === 0) return `The radar added ${companies(addedThisWeek)} this week and has nothing more ready.`;
  return `The radar added ${companies(addedThisWeek)} this week and has ${ready} more ready.`;
}

/** The minimal pipeline_runs row the page reads. */
export interface RunRow {
  phase: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  new_count: number | null;
  error: string | null;
  details: unknown;
}

export interface RunSummary {
  when: string;
  status: string;
  /** "12 new prospects; funding news 4, Companies House 300, Adzuna 3, Reed key not set" or the qualify counts. */
  text: string;
}

const count = (details: Record<string, unknown> | null, ...keys: string[]): number | null => {
  for (const k of keys) {
    const v = details ? num(details[k]) : null;
    if (v !== null) return v;
  }
  return null;
};

/** What the last discovery run found, from `new_count` and `details.sources[source].{found, inserted, skipped}`. */
export function discoverySummary(run: RunRow | null): RunSummary | null {
  if (!run) return null;
  const details = isRecord(run.details) ? run.details : null;
  const total = run.new_count ?? count(details, "inserted", "new");
  const sources = details && isRecord(details.sources) ? details.sources : null;
  const perSource = SOURCE_ORDER.map((key) => {
    const s = sources && isRecord(sources[key]) ? sources[key] : null;
    if (!s) return null;
    if (s.skipped === true) return `${SOURCE_LABELS[key]} key not set`;
    const n = count(s, "inserted", "found", "count");
    return n === null ? null : `${SOURCE_LABELS[key]} ${n}`;
  }).filter((x): x is string => !!x);
  const head = run.status === "running" ? "still running" : run.status === "failed" ? `failed${run.error ? `: ${run.error}` : ""}` : total === null ? "finished" : `${total} new ${total === 1 ? "prospect" : "prospects"}`;
  return { when: shortDateTime(run.finished_at || run.started_at), status: run.status, text: perSource.length ? `${head}; ${perSource.join(", ")}` : head };
}

/** What the last qualification run did, from `details.{qualified, promoted, unsuitable, checked}`. */
export function qualifySummary(run: RunRow | null): RunSummary | null {
  if (!run) return null;
  const details = isRecord(run.details) ? run.details : null;
  if (run.status === "running") return { when: shortDateTime(run.started_at), status: run.status, text: "still running" };
  if (run.status === "failed") return { when: shortDateTime(run.finished_at || run.started_at), status: run.status, text: `failed${run.error ? `: ${run.error}` : ""}` };
  const checked = count(details, "checked", "qualifiedCount", "processed");
  const qualified = count(details, "qualified");
  const promoted = run.new_count ?? count(details, "promoted");
  const unsuitable = count(details, "unsuitable");
  const bits = [
    checked !== null ? `${checked} checked` : null,
    qualified !== null ? `${qualified} ready` : null,
    promoted !== null ? `${promoted} added` : null,
    unsuitable !== null ? `${unsuitable} unsuitable` : null,
  ].filter((x): x is string => !!x);
  return { when: shortDateTime(run.finished_at || run.started_at), status: run.status, text: bits.length ? bits.join(", ") : "finished" };
}

export type SourceKeyState = "on" | "key not set" | "not run yet";

/** Adzuna and Reed need a key; the last discovery run says whether each was skipped for want of one. */
export function sourceKeyStates(run: RunRow | null): Record<"adzuna" | "reed", SourceKeyState> {
  const details = run && isRecord(run.details) ? run.details : null;
  const sources = details && isRecord(details.sources) ? details.sources : null;
  const state = (key: "adzuna" | "reed"): SourceKeyState => {
    if (!run) return "not run yet";
    const s = sources && isRecord(sources[key]) ? sources[key] : null;
    return s?.skipped === true ? "key not set" : "on";
  };
  return { adzuna: state("adzuna"), reed: state("reed") };
}

export interface ProspectingSettings {
  autoPromoteScore: number;
  weeklyPromoteCap: number;
}

export const DEFAULT_PROSPECTING_SETTINGS: ProspectingSettings = { autoPromoteScore: 60, weeklyPromoteCap: 15 };

/** The two numbers from `app_settings.prospecting`, with the brief's defaults for anything missing. */
export function settingsFromValue(value: unknown): ProspectingSettings {
  const v = isRecord(value) ? value : {};
  return {
    autoPromoteScore: num(v.autoPromoteScore) ?? DEFAULT_PROSPECTING_SETTINGS.autoPromoteScore,
    weeklyPromoteCap: num(v.weeklyPromoteCap) ?? DEFAULT_PROSPECTING_SETTINGS.weeklyPromoteCap,
  };
}

/** A whole number in range, else null: the score 0 to 100, the cap 0 to 200. */
export function parseSettingInput(text: string, max: number): number | null {
  const n = Number(text.trim());
  if (!text.trim() || !Number.isInteger(n) || n < 0 || n > max) return null;
  return n;
}

// ---------------------------------------------------------------------------
// Sector and stage (21 September 2026: Craig wants both on every row and
// filters for them). The sector is read from the words in the headlines
// and postings that found the company, the website's domain, and last the
// register's SIC class; the stage from the round the news named, else an
// SH01 allotment on the register within six months ("unannounced raise").

export const SECTORS = [
  "Fintech",
  "AI",
  "Healthtech",
  "Climate and energy",
  "Legaltech",
  "Proptech",
  "Edtech",
  "Insurtech",
  "Biotech",
  "Cybersecurity",
  "B2B SaaS",
  "Deeptech",
  "Ecommerce and consumer",
  "HR and recruitment tech",
  "Media and marketing",
  "Software",
  "Other",
] as const;

export type Sector = (typeof SECTORS)[number];

/** Tested in order: the more specific sector wins over "AI" and "Software". */
const SECTOR_RULES: Array<[Sector, RegExp]> = [
  ["Fintech", /\b(?:fintech|payments?|banking|bank|lending|lender|mortgage|savings|wealth|invest(?:ing|ment)? platform|trading|crypto|insurance premium|treasury|accounting software|expense|invoic|neobank|open banking|remittance|pension)\b/i],
  ["Insurtech", /\b(?:insurtech|insurance|insurer|underwriting)\b/i],
  ["Legaltech", /\b(?:legaltech|legal tech|legal ai|law firm|lawyers?|litigation|contract (?:review|management)|compliance platform|regtech)\b/i],
  ["Proptech", /\b(?:proptech|property|real estate|landlords?|tenants?|rental|mortgage broker|construction tech|contech|buildings?)\b/i],
  ["Edtech", /\b(?:edtech|education|learning platform|tutoring|students?|schools?|universit)\b/i],
  ["Healthtech", /\b(?:healthtech|health ?tech|digital health|health(?:care)?|medical|medtech|clinic(?:al|s)?|patients?|nhs|mental health|wellness|femtech|pharma(?:cy)?|diagnostics?|drug discovery|therapeutics?)\b/i],
  ["Biotech", /\b(?:biotech|bioscience|biosciences|life sciences?|genomics?|biolog(?:y|ical)|cell therapy|synthetic biology|lab-grown|molecul)\b/i],
  ["Climate and energy", /\b(?:climate(?:tech| tech)?|clean ?tech|cleantech|carbon|net zero|renewable|solar|wind|battery|batteries|energy|ev charging|electric vehicle|grid|hydrogen|sustainab|recycling|waste)\b/i],
  ["Cybersecurity", /\b(?:cyber ?security|cybersecurity|security startup|infosec|threat|hackers?|identity verification|fraud (?:detection|prevention)|anti-fraud)\b/i],
  ["HR and recruitment tech", /\b(?:hr ?tech|hrtech|recruitment tech|hiring platform|jobseekers?|talent platform|workforce|payroll|employee (?:benefits|engagement)|people platform)\b/i],
  ["Media and marketing", /\b(?:martech|adtech|marketing|advertising|media|creator|influencer|podcast|publishing|video platform|content platform)\b/i],
  ["Ecommerce and consumer", /\b(?:e-?commerce|retail(?:er|ers)?|marketplace|consumer|d2c|dtc|fashion|food|drinks?|coffee|beauty|grocery|delivery|restaurant|travel|hospitality|padel|fitness|gaming|games?)\b/i],
  ["Deeptech", /\b(?:deep ?tech|deeptech|quantum|robotics?|semiconductor|chips?|photonics?|space ?tech|satellites?|drones?|hardware|materials?|humanoid|autonomous|physical ai|wireless power)\b/i],
  ["B2B SaaS", /\b(?:b2b saas|saas|enterprise software|workflow|automation platform|productivity|analytics platform|developer tools?|devtools?|infrastructure|data platform|api platform|crm|erp)\b/i],
  ["AI", /\b(?:\bai\b|artificial intelligence|machine learning|\bml\b|llm|agents?|agentic|generative|copilot)\b/i],
];

const REGISTER_SECTORS: Record<string, Sector> = {
  "Financial services": "Fintech",
  "Health": "Healthtech",
  "Biotech": "Biotech",
  "Online retail": "Ecommerce and consumer",
  "Marketing": "Media and marketing",
  "Software": "Software",
  "Data and platforms": "Software",
  "Engineering": "Deeptech",
  "Energy": "Climate and energy",
  "Education": "Edtech",
  "Property": "Proptech",
  "Insurance": "Insurtech",
};

/** The sector, from the words that found the company, then the domain, then the register. */
export function prospectSector(p: Pick<Prospect, "sources" | "talentPostings" | "website" | "register" | "name">): Sector {
  const text = [
    ...p.sources.map((s) => `${s.title || ""} ${s.note || ""}`),
    ...p.talentPostings.map((t) => t.title),
  ].join(" \n ");
  for (const [sector, re] of SECTOR_RULES) if (re.test(text)) return sector;
  const host = websiteHost(p.website).toLowerCase();
  if (/\.ai$/.test(host) || /\bai\b/i.test(p.name)) return "AI";
  if (/\.(?:health|bio|energy|finance|legal|insure|earth|eco)$/.test(host)) {
    const tld = host.slice(host.lastIndexOf(".") + 1);
    return ({ health: "Healthtech", bio: "Biotech", energy: "Climate and energy", finance: "Fintech", legal: "Legaltech", insure: "Insurtech", earth: "Climate and energy", eco: "Climate and energy" } as Record<string, Sector>)[tld];
  }
  const fromRegister = p.register?.sector ? REGISTER_SECTORS[p.register.sector] : null;
  return fromRegister ?? "Other";
}

export const STAGES = ["Pre-seed", "Seed", "Series A", "Series B or later", "Unannounced raise", "Unknown"] as const;

export type Stage = (typeof STAGES)[number];

const SH01_MONTHS = 6;

/** The funding stage, from the round the news named, else a recent share allotment on the register. */
export function prospectStage(p: Pick<Prospect, "raise" | "register">, today: Date = new Date()): Stage {
  const round = (p.raise?.round || "").toLowerCase().trim();
  if (round) {
    if (/pre-?seed|angel/.test(round)) return "Pre-seed";
    if (/^seed\b|\bseed\b/.test(round)) return "Seed";
    if (/series a\b/.test(round)) return "Series A";
    if (/series [b-z]\b|growth|late/.test(round)) return "Series B or later";
  }
  if (p.raise) {
    const gbp = p.raise.amountGbp;
    if (gbp !== null) {
      if (gbp < 1_500_000) return "Pre-seed";
      if (gbp <= 8_000_000) return "Seed";
      if (gbp <= 30_000_000) return "Series A";
      return "Series B or later";
    }
    return "Unknown";
  }
  const since = today.getTime() - SH01_MONTHS * 30.4375 * 86_400_000;
  const sh01 = (p.register?.capitalFilings || []).some((f) => /^SH01/i.test(f.type || "") && f.date && new Date(f.date).getTime() >= since);
  return sh01 ? "Unannounced raise" : "Unknown";
}

/** "£2m seed, Sep 2026" or "Series A" or "shares allotted 2026-07-23": the raise in a few words for the row. */
export function stageLine(p: Pick<Prospect, "raise" | "register">, today: Date = new Date()): string {
  const stage = prospectStage(p, today);
  if (p.raise) {
    const bits = [p.raise.amountText, p.raise.round].filter((x): x is string => !!x);
    const when = p.raise.date ? shortDate(p.raise.date) : "";
    const words = bits.length ? bits.join(" ") : stage === "Unknown" ? "a raise" : stage.toLowerCase();
    return when ? `${words}, ${when}` : words;
  }
  if (stage === "Unannounced raise") {
    const f = (p.register?.capitalFilings || []).find((x) => /^SH01/i.test(x.type || ""));
    return `shares allotted${f?.date ? ` ${shortDate(f.date)}` : ""}, no raise in the news`;
  }
  return "no raise found";
}

export interface ProspectFilters {
  sectors: Sector[];
  stages: Stage[];
}

export const NO_FILTERS: ProspectFilters = { sectors: [], stages: [] };

/** The rows that pass the filters; an empty list on either side means "any". */
export function filterProspects(rows: Prospect[], filters: ProspectFilters, today: Date = new Date()): Prospect[] {
  return rows.filter((p) => (filters.sectors.length === 0 || filters.sectors.includes(prospectSector(p))) && (filters.stages.length === 0 || filters.stages.includes(prospectStage(p, today))));
}

/** How many rows each sector and stage has, in the display order, zeros left out. */
export function filterCounts(rows: Prospect[], today: Date = new Date()): { sectors: Array<{ value: Sector; count: number }>; stages: Array<{ value: Stage; count: number }> } {
  const sectorCounts = new Map<Sector, number>();
  const stageCounts = new Map<Stage, number>();
  for (const p of rows) {
    const s = prospectSector(p);
    sectorCounts.set(s, (sectorCounts.get(s) || 0) + 1);
    const st = prospectStage(p, today);
    stageCounts.set(st, (stageCounts.get(st) || 0) + 1);
  }
  return {
    sectors: SECTORS.map((value) => ({ value, count: sectorCounts.get(value) || 0 })).filter((x) => x.count > 0),
    stages: STAGES.map((value) => ({ value, count: stageCounts.get(value) || 0 })).filter((x) => x.count > 0),
  };
}
