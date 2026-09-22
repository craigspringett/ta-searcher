// The sector and stage rules for a prospect, the same words as
// src/lib/prospects.ts (change both; the digest and the page must agree).
// 22 September 2026, for the weekly raises digest.

function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

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
export function prospectSector(p: { sources: Array<{ title?: string | null; note?: string | null }>; talentPostings: Array<{ title: string }>; website: string | null; register: { sector?: string | null } | null; name: string }): Sector {
  const text = [
    ...p.sources.map((s) => `${s.title || ""} ${s.note || ""}`),
    ...p.talentPostings.map((t) => t.title),
  ].join(" \n ");
  for (const [sector, re] of SECTOR_RULES) if (re.test(text)) return sector;
  const host = hostOf(p.website);
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
export function prospectStage(p: { raise: { round?: string | null; amountGbp?: number | null } | null; register: { capitalFilings?: Array<{ type?: string | null; date?: string | null }> } | null }, today: Date = new Date()): Stage {
  const round = (p.raise?.round || "").toLowerCase().trim();
  if (round) {
    if (/pre-?seed|angel/.test(round)) return "Pre-seed";
    if (/^seed\b|\bseed\b/.test(round)) return "Seed";
    if (/series a\b/.test(round)) return "Series A";
    if (/series [b-z]\b|growth|late/.test(round)) return "Series B or later";
  }
  if (p.raise) {
    const gbp = p.raise.amountGbp ?? null;
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

