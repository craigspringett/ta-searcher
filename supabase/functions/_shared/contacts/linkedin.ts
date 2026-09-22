// LinkedIn links for one-click research (22 September 2026, Craig's list).
// A company's own page is the linkedin.com/company/... link on its
// website (or the one Hunter knows); a person's is the one Hunter gives,
// else a LinkedIn people search for their name and the company, which
// opens the right profile nine times in ten without any scraping. The same
// rules are mirrored in src/lib/linkedin.ts for the app.

const COMPANY_RE = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/company\/([A-Za-z0-9._%-]+)\/?/gi;

/** The company's LinkedIn page linked from its site, normalised, or null. */
export function findCompanyLinkedIn(html: string | null | undefined): string | null {
  if (!html) return null;
  const seen = new Map<string, number>();
  for (const m of html.matchAll(COMPANY_RE)) {
    const slug = m[1].replace(/%20/g, '').toLowerCase();
    if (!slug || /^(?:login|signup|share|shareArticle|feed|in|pub|jobs|company)$/i.test(slug)) continue;
    seen.set(slug, (seen.get(slug) || 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [slug, count] of seen) if (count > n) { best = slug; n = count; }
  return best ? `https://www.linkedin.com/company/${best}/` : null;
}

/** A LinkedIn people search for a named person at a company. */
export function linkedInPeopleSearchUrl(name: string, company: string | null | undefined): string {
  const q = [name, company].filter((x) => x && x.trim()).join(' ').replace(/\s+/g, ' ').trim();
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`;
}

/** A LinkedIn company search for a name. */
export function linkedInCompanySearchUrl(company: string): string {
  return `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(company.trim())}`;
}

/** A profile URL as Hunter or a page gives it, tidied; null when it is not a LinkedIn profile. */
export function tidyProfileUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = String(url).match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([A-Za-z0-9._%-]+)/i);
  return m ? `https://www.linkedin.com/in/${m[1]}/` : null;
}
