/**
 * The role families and source names as the app shows them. The family of a
 * role is decided server-side (`_shared/vacancies/role-family.ts`) and
 * carried on each open role in analysis_result; this file only labels it.
 */

export type RoleFamily = "engineering" | "product_design" | "go_to_market" | "operations" | "people_talent" | "leadership" | "other";

export const ROLE_FAMILY_LABELS: Record<RoleFamily, string> = {
  engineering: "Engineering",
  product_design: "Product and design",
  go_to_market: "Go to market",
  operations: "Operations",
  people_talent: "People and talent",
  leadership: "Leadership",
  other: "Other",
};

/** People and talent first: the direct lead. Then the load, largest teams first. */
export const ROLE_FAMILY_ORDER: RoleFamily[] = ["people_talent", "leadership", "engineering", "product_design", "go_to_market", "operations", "other"];

/** The family a stored role carries, or "other" when it has none (an analysis from before the field existed). */
export function familyOf(value: unknown): RoleFamily {
  return typeof value === "string" && value in ROLE_FAMILY_LABELS ? (value as RoleFamily) : "other";
}

export function familyLabel(value: unknown): string {
  return ROLE_FAMILY_LABELS[familyOf(value)];
}

/** The vacancy sources (the contract's SOURCE_LABELS), for rows that carry no sourceLabel of their own. */
export const SOURCE_LABELS: Record<string, string> = {
  ashby: "Ashby",
  greenhouse: "Greenhouse",
  lever: "Lever",
  workable: "Workable",
  careers_page: "Careers page",
  llm: "Page read",
  consultant: "Typed in",
  other: "Other",
};

export function sourceLabel(source: string | null | undefined, stored?: string | null): string {
  if (stored) return stored;
  if (!source) return "";
  return SOURCE_LABELS[source] || source;
}

const WORKPLACE_LABELS: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On site" };

export function workplaceLabel(value: string | null | undefined): string {
  if (!value) return "";
  return WORKPLACE_LABELS[value.toLowerCase()] || value;
}
