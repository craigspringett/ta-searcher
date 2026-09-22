/**
 * Investors page (22 September 2026): which funds back which tracked
 * companies, so a whole portfolio can be worked at once. The names come
 * from the latest raise the analysis derived (investors[]) and from the
 * investor facts ("Plural is an investor in Augur."). No table: it is a
 * read over analysis_result.
 */
import type { AnalysisResult } from "@/lib/analysis";

const FACT_RE = /^(.+?)\s+(?:is|are|was|were|became)\s+(?:an?\s+|the\s+)?(?:lead\s+|existing\s+|new\s+|early\s+|seed\s+)?(?:investors?|backers?|shareholders?)\b/i;
const LED_RE = /^(.+?)\s+(?:led|co-led|joined|backed|invested in|participated in)\b(?!\s+by\b)/i;
const NOT_A_FUND = /^(?:the company|it|they|we|the round|the raise|the round was|the raise was|the funding|angel investors?|angels?|investors?|existing investors?|new investors?|several|a number of|customers?|employees|founders?|management|family and friends|friends and family)$/i;

/** "Bessemer Venture Partners" from "Bessemer Venture Partners is an investor in Upwind."; null when the statement names no fund. */
export function investorFromStatement(statement: string): string | null {
  const s = (statement || "").replace(/\s+/g, " ").trim();
  const m = s.match(FACT_RE) || s.match(LED_RE);
  if (!m) return null;
  const name = m[1].replace(/^(?:the\s+)?(?:venture (?:capital )?firm|fund|investor|vc)\s+/i, "").replace(/[,.;:]+$/, "").trim();
  if (!name || name.length > 60 || NOT_A_FUND.test(name)) return null;
  return name;
}

export function investorKey(name: string): string {
  return name.toLowerCase().replace(/\b(?:ventures?|capital|partners|vc|fund|management|investments?|group|llp|ltd|limited)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Every investor name an analysis carries, once each. */
export function investorsOf(ar: Pick<AnalysisResult, "latestRaise" | "facts"> | null | undefined): string[] {
  if (!ar) return [];
  const names: string[] = [];
  for (const n of ar.latestRaise?.investors || []) if (n && n.trim()) names.push(n.trim());
  for (const f of ar.facts || []) if (f.kind === "investor") { const n = investorFromStatement(f.statement); if (n) names.push(n); }
  const seen = new Set<string>();
  return names.filter((n) => { const k = investorKey(n); if (!k || seen.has(k)) return false; seen.add(k); return true; });
}

export interface InvestorCompany {
  id: string;
  name: string;
  fundingStage: string | null;
  raise: string | null;
  score: number | null;
  pipelineStage: string | null;
}

export interface InvestorGroup {
  key: string;
  name: string;
  companies: InvestorCompany[];
}

/** Funds with their companies, most companies first, then by name. */
export function groupByInvestor(rows: Array<{ company: InvestorCompany; investors: string[] }>): InvestorGroup[] {
  const groups = new Map<string, InvestorGroup>();
  for (const r of rows) {
    for (const name of r.investors) {
      const key = investorKey(name);
      if (!key) continue;
      const g = groups.get(key) || { key, name, companies: [] };
      // The longest spelling wins ("Bessemer Venture Partners" over "Bessemer").
      if (name.length > g.name.length) g.name = name;
      if (!g.companies.some((c) => c.id === r.company.id)) g.companies.push(r.company);
      groups.set(key, g);
    }
  }
  const out = Array.from(groups.values());
  for (const g of out) g.companies.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));
  return out.sort((a, b) => b.companies.length - a.companies.length || a.name.localeCompare(b.name));
}

/** The groups whose fund name matches the search, case-insensitive. */
export function filterInvestors(groups: InvestorGroup[], query: string): InvestorGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups.filter((g) => g.name.toLowerCase().includes(q) || g.companies.some((c) => c.name.toLowerCase().includes(q)));
}
