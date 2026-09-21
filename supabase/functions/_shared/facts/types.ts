// The evidence pass: facts with verbatim quotes (docs/TA-SEARCHER-BRIEF.md,
// "Facts: what the evidence pass looks for").

export const FACT_KINDS = [
  'funding_round', 'investor', 'stage', 'headcount', 'hiring_plan', 'leadership_change', 'people_function',
  'talent_team', 'expansion', 'new_market', 'office', 'product_launch', 'award', 'accelerator',
  'staffing_pressure', 'agency_mention', 'remote_policy', 'values', 'recent_news', 'staff_departure',
  'staff_arrival', 'other',
] as const;
/**
 * A fact a consultant typed in (the intel column of a reviewed company
 * list). Never asked of the model (it is not in FACT_KINDS, so the evidence
 * pass cannot produce it) and never retired by a refresh; it feeds the
 * "From the team" signal.
 */
export const CONSULTANT_FACT_KIND = 'consultant_intel' as const;
export type FactKind = typeof FACT_KINDS[number] | typeof CONSULTANT_FACT_KIND;
/** Kinds that no web page backs and the website refresh must leave alone. */
export const CARRIED_FACT_KINDS: ReadonlySet<string> = new Set([CONSULTANT_FACT_KIND]);

/** A fact as the model returns it, before validation. */
export interface RawFact {
  kind: string;
  statement: string;
  quote: string;
  source_url: string;
  date_hint?: string | null;
}

/** A fact that passed validation: the quote is on the cited page. */
export interface Fact {
  id: string;
  kind: FactKind;
  statement: string;
  quote: string;
  source_url: string;
  date_hint: string | null;
  /** Normalised statement, the identity of the fact across runs. */
  statement_key: string;
}

/** A page the model was shown, keyed by the URL it was labelled with. */
export interface SourcePage {
  url: string;
  text: string;
}

export interface ValidationOutcome {
  facts: Fact[];
  dropped: Array<{ statement: string; reason: string }>;
}
