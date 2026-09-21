// Does a feed's employer name refer to this company?
//
// Names are compared as token sets after light normalisation: the legal and
// vanity suffixes a start-up wears on different pages (Ltd, Limited, Inc,
// Technologies, Labs, HQ, .io, .ai, .com) are stripped, so "Searchable
// Technologies Ltd" on Companies House, "Searchable" on the Ashby board and
// "searchable.ai" in the footer are one name. An exact match is accepted
// outright; a near match needs a high overlap. A trust rule is not needed:
// a company's own board carries its own name.

import { decodeEntities } from '../vacancy-identity.ts';

const GENERIC = new Set(['the', 'of', 'and', 'a', 'an', 'at', 'in', 'company', 'group', 'holdings', 'uk', 'europe', 'international', 'global']);

/** Suffixes that add nothing to the identity of a company name. */
const SUFFIX_RE = /\b(?:ltd|limited|plc|llp|llc|inc|incorporated|corp|corporation|co|gmbh|sas|bv|technologies|technology|tech|labs?|hq|software|systems|solutions|ventures|studios?|app)\b/g;

export function normaliseOrgName(name: string | null | undefined): string {
  if (!name) return '';
  let t = decodeEntities(String(name)).toLowerCase();
  t = t.replace(/&/g, ' and ');
  t = t.replace(/[’'`]/g, '');
  t = t.replace(/\(.*?\)/g, ' ');
  // Domain suffixes and the "www." prefix: "searchable.ai", "www.monzo.com".
  t = t.replace(/^www\./, '').replace(/\.(?:io|ai|com|co|co\.uk|org|net|dev|app|xyz|tech|uk)\b/g, ' ');
  t = t.replace(/[^a-z0-9]+/g, ' ');
  t = t.replace(SUFFIX_RE, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

export function orgTokens(name: string | null | undefined): Set<string> {
  return new Set(normaliseOrgName(name).split(' ').filter((w) => w && !GENERIC.has(w)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface CompanyIdentity {
  name: string;
  aliases?: string[];
  postcodeDistrict?: string | null;
}

export interface EmployerMatch {
  matched: boolean;
  score: number;
  reason: string;
}

export function employerMatches(employerName: string | null | undefined, company: CompanyIdentity): EmployerMatch {
  const emp = normaliseOrgName(employerName);
  if (!emp) return { matched: false, score: 0, reason: 'no employer name' };
  const empTokens = orgTokens(employerName);
  const names = [company.name, ...(company.aliases || [])].filter((n) => n && n.trim().length >= 2);
  for (const n of names) {
    if (normaliseOrgName(n) === emp) return { matched: true, score: 1, reason: 'exact name match' };
  }
  let best = 0;
  let bestContained = false;
  for (const n of names) {
    const tokens = orgTokens(n);
    const score = jaccard(tokens, empTokens);
    if (score > best) best = score;
    // "Monzo" against "Monzo Bank": the shorter name is the whole of the longer one.
    const [small, large] = tokens.size <= empTokens.size ? [tokens, empTokens] : [empTokens, tokens];
    if (small.size > 0 && Array.from(small).every((x) => large.has(x)) && large.size - small.size <= 1) bestContained = true;
  }
  if (best >= 0.8) return { matched: true, score: best, reason: `near name match (${best.toFixed(2)})` };
  if (bestContained) return { matched: true, score: Math.max(best, 0.5), reason: 'one name contains the other' };
  return { matched: false, score: best, reason: best > 0 ? `name overlap too low (${best.toFixed(2)})` : 'no name overlap' };
}
