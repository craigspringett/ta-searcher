// The shapes the prospecting pass is built against (docs/PROSPECTING-BRIEF.md,
// "The prospect"). A prospect is a company the site found on its own: a raise
// headline nobody tracks, a young technology company from the register, or an
// employer advertising the role Craig places. Discovery writes the row,
// qualification fills the register, website, boards and score, promotion
// turns it into a company_searches row.

export type ProspectSourceKind = 'funding_news' | 'companies_house' | 'adzuna' | 'reed';

export type ProspectStatus = 'new' | 'qualified' | 'promoted' | 'dismissed' | 'unsuitable' | 'parked';

export interface ProspectSourceEntry {
  source: ProspectSourceKind;
  /** The headline, the posting, the register entry. */
  url: string;
  title: string;
  /** ISO instant the source dated it (the story, the posting), else when it was found. */
  at: string | null;
  note: string | null;
}

export interface ProspectRaise {
  amountText: string | null;
  amountGbp: number | null;
  round: string | null;
  /** ISO date of the story. */
  date: string | null;
  url: string | null;
}

export interface ProspectCapitalFiling {
  date: string;
  type: string;
  description: string;
}

export interface ProspectRegister {
  /** The register's company_status; null when the company was not matched. */
  status: string | null;
  incorporationDate: string | null;
  sicCodes: string[];
  sector: string | null;
  locality: string | null;
  postcodeDistrict: string | null;
  capitalFilings: ProspectCapitalFiling[];
  /** True once the qualification read the profile (a walk entry alone is not a match by name). */
  matched: boolean;
  note?: string | null;
}

export interface ProspectBoard {
  provider: 'ashby' | 'greenhouse' | 'lever' | 'workable';
  slug: string;
  boardUrl: string | null;
  count: number;
  talentRoles: string[];
  /** The first 20 titles on the board. */
  titles: string[];
  note?: string | null;
}

export interface TalentPosting {
  title: string;
  employer: string;
  source: 'adzuna' | 'reed';
  url: string;
  /** ISO date. */
  date: string | null;
}

export interface ScoreReason {
  points: number;
  text: string;
}

/** A prospects row as the code reads and writes it. */
export interface ProspectRow {
  id: string;
  name: string;
  name_key: string;
  website: string | null;
  company_number: string | null;
  status: ProspectStatus;
  sources: ProspectSourceEntry[];
  raise: ProspectRaise | null;
  register: ProspectRegister | null;
  boards: ProspectBoard[];
  talent_postings: TalentPosting[];
  prospect_score: number | null;
  score_reasons: ScoreReason[];
  first_seen_at: string;
  last_seen_at: string;
  qualified_at: string | null;
  promoted_at: string | null;
  dismissed_at: string | null;
  promoted_company_id: string | null;
  dismiss_reason: string | null;
  /** Parked (23 September 2026): set aside until a newer raise or a talent posting brings it back. */
  parked_at?: string | null;
  wake_note?: string | null;
}

/** What a discovery source hands the pass: enough to make or extend a row. */
export interface ProspectCandidate {
  name: string;
  website?: string | null;
  companyNumber?: string | null;
  source: ProspectSourceEntry;
  raise?: ProspectRaise | null;
  /** From the register walk: the fields the advanced search gives, not yet a match by name. */
  register?: Partial<ProspectRegister> | null;
  talentPosting?: TalentPosting | null;
}

/** app_settings.prospecting. */
export interface ProspectingSettings {
  autoPromoteScore: number;
  weeklyPromoteCap: number;
  /** `${sic}|${place}` to the next start_index of the register walk. */
  watermarks: Record<string, number>;
  /** Which (sic, place) pair the register walk takes next. */
  registerCursor: number;
}
