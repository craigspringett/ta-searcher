// Which tracked company a raise story is about, by name.
//
// Investigation of 21 September 2026: the headline's company name is the
// short trading name ("Searchable", "Metris Energy", "Jack & Jill") and
// the tracked company carries its Companies House name ("Searchable
// Technologies Ltd"), the name the consultant typed, the register's
// previous names and the website host. employerMatches in
// ../vacancies/employer-match.ts already compares those as token sets with
// the legal suffixes and domain endings stripped, so the same rule that
// says an ATS board is the company's says a headline is: an exact match
// wins, else the best near match, and "Metris" against "Metris Energy"
// matches because one name contains the other with a token to spare.

import { employerMatches, normaliseOrgName } from '../vacancies/employer-match.ts';

export interface TrackedCompany {
  id: string;
  name: string;
  aliases: string[];
}

export interface CompanyMatch {
  id: string;
  /** employerMatches's reason, kept on the row as match_note. */
  note: string;
  score: number;
}

/** The tracked company the name refers to, or null. */
export function matchCompany(name: string | null | undefined, companies: TrackedCompany[]): CompanyMatch | null {
  const normalised = normaliseOrgName(name);
  if (!normalised || normalised.length < 2) return null;
  let best: CompanyMatch | null = null;
  for (const c of companies) {
    const m = employerMatches(name, { name: c.name, aliases: c.aliases });
    if (!m.matched) continue;
    if (m.score === 1) return { id: c.id, note: m.reason, score: 1 };
    if (!best || m.score > best.score) best = { id: c.id, note: m.reason, score: m.score };
  }
  return best;
}

/** Whether a headline names the company outright (its normalised name as whole words), for the per-company feed. */
export function headlineNamesCompany(title: string, company: TrackedCompany): boolean {
  const text = ` ${normaliseOrgName(title)} `;
  for (const n of [company.name, ...company.aliases]) {
    const needle = normaliseOrgName(n);
    if (needle.length >= 3 && text.includes(` ${needle} `)) return true;
  }
  return false;
}
