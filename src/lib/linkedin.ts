/**
 * LinkedIn links for one-click research (22 September 2026). A person's
 * link is the profile the analysis stored (from Hunter), else a LinkedIn
 * people search for their name and the company; a company's is the page
 * linked from its website, else a company search. Mirrors
 * supabase/functions/_shared/contacts/linkedin.ts.
 */
export function linkedInPeopleSearchUrl(name: string, company: string | null | undefined): string {
  const q = [name, company].filter((x) => x && x.trim()).join(" ").replace(/\s+/g, " ").trim();
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`;
}

export function linkedInCompanySearchUrl(company: string): string {
  return `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(company.trim())}`;
}

/** The link to open for a contact, and whether it is their profile or a search. */
export function contactLinkedIn(person: { name?: string | null; linkedin?: string | null }, company: string | null | undefined): { url: string; kind: "profile" | "search" } | null {
  if (person.linkedin) return { url: person.linkedin, kind: "profile" };
  if (!person.name || !person.name.trim()) return null;
  return { url: linkedInPeopleSearchUrl(person.name, company), kind: "search" };
}

/** The link to open for a company, and whether it is its page or a search. */
export function companyLinkedIn(stored: string | null | undefined, name: string | null | undefined): { url: string; kind: "page" | "search" } | null {
  if (stored) return { url: stored, kind: "page" };
  if (!name || !name.trim()) return null;
  return { url: linkedInCompanySearchUrl(name), kind: "search" };
}
