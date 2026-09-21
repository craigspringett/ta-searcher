// The shapes the open-roles layer is built against (docs/PORT-CONTRACTS.md,
// "Open roles"). CompanyRecord is a type-only import: companies-house.ts is
// read at runtime by the register code, never by this layer.
import type { CompanyRecord } from '../companies-house.ts';
import type { DocumentKind } from './documents.ts';

export type VacancySource = 'ashby' | 'greenhouse' | 'lever' | 'workable' | 'careers_page' | 'llm' | 'consultant' | 'other';
export type AtsProvider = 'ashby' | 'greenhouse' | 'lever' | 'workable';

export interface AtsBoard {
  provider: AtsProvider;
  /** The board's identifier in the provider's public feed: Ashby job-board slug, Greenhouse board token, Lever site slug, Workable account subdomain. */
  slug: string;
  /** The public board page, when known. */
  boardUrl: string | null;
}

export interface CompanyContext {
  companySearchId: string | null;
  companyNumber: string | null;
  name: string;
  /** Other names the company is known by (stored name, register name, website title). */
  aliases: string[];
  /** Stored website URL. */
  url: string;
  postcodeDistrict: string | null;
  record: CompanyRecord | null;
  /** Confirmed boards from ats_boards; a feed is read only for a confirmed slug. */
  boards: AtsBoard[];
}

export interface CandidateVacancy {
  title: string;
  /** Direct link to the advert, when we have one. */
  url?: string | null;
  /** Page the advert was found on (listing page). */
  pageUrl?: string | null;
  source: VacancySource;
  employerName?: string | null;
  /** ISO YYYY-MM-DD */
  closingDate?: string | null;
  /** Free-text start date as written in the advert. */
  startText?: string | null;
  /** ISO date the feed says the role was posted (Ashby publishedAt, Greenhouse first_published, Lever createdAt, Workable published_on). Greenhouse updated_at is NOT a posting date. */
  datePosted?: string | null;
  /** Postcode of the job location when the feed tells us. */
  postcode?: string | null;
  department?: string | null;
  location?: string | null;
  /** 'remote' | 'hybrid' | 'onsite' | null */
  workplaceType?: string | null;
  employmentType?: string | null;
  /**
   * Set by the careers-page source when the title is a supporting document
   * about a post (job description, application form, pack). The merge
   * attaches it to the advert for the same post or drops it; it never becomes
   * a vacancy of its own.
   */
  document?: DocumentKind | null;
  /** ISO date the linked file last changed (Last-Modified header), asked for when a file carries no date of its own. */
  lastModified?: string | null;
  /** The post a supporting document is about (the title without the document words). */
  post?: string | null;
  /** Anything worth keeping for debugging or later phases. */
  raw?: Record<string, unknown>;
}

export interface SourceResult {
  source: VacancySource;
  ok: boolean;
  vacancies: CandidateVacancy[];
  /** Why the source failed or was skipped, when it did. */
  note?: string;
  ms: number;
}

export interface VacancyRunSummary {
  sourcesTried: string[];
  sourcesOk: string[];
  vacanciesFound: number;
  degraded: boolean;
  degradedReason?: string;
  notes: Record<string, unknown>;
}
