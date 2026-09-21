// What the facts say about money and stage, derived in code so the company
// page, the brief and the copy prompt read one rule (docs/PORT-CONTRACTS.md,
// Facts). The stage is the company's own word for itself when it gives one,
// else the round of its latest raise; the latest raise is the newest dated
// funding_round fact with its amount, round, investors and date parsed from
// the statement and the quote. Nothing here is asked of the model.

import type { Fact } from './types.ts';
import { monthFromDateHint, yearFromDateHint } from './validate.ts';

export type StageLabel = 'pre_seed' | 'seed' | 'series_a' | 'series_b_plus' | 'unknown';

export interface StageGuess {
  label: StageLabel;
  /** The statement the label was read from, or null when unknown. */
  evidence: string | null;
  source_url: string | null;
}

export interface LatestRaise {
  /** The amount as the page wrote it ("£10.3 million"), or null when the statement gives none. */
  amountText: string | null;
  /** The amount in pounds, converted at a fixed rate (see GBP_PER_UNIT), or null. */
  amountGbp: number | null;
  /** The round as written, normalised ("Series A", "seed", "pre-seed", "angel", "bridge", "growth"), or null. */
  round: string | null;
  /** From the fact's date hint: YYYY-MM-DD, YYYY-MM or YYYY as far as the hint goes, else null. */
  date: string | null;
  investors: string[];
  statement: string;
  source_url: string;
}

/** The structural part of CompanyRecord the stage rule may read; CompanyRecord satisfies it. */
export interface RecordForStage {
  incorporationDate: string | null;
}

/** Words for the stage labels, for the summary and the pages. */
export const STAGE_LABELS: Record<StageLabel, string> = {
  pre_seed: 'pre-seed',
  seed: 'seed',
  series_a: 'Series A',
  series_b_plus: 'Series B or later',
  unknown: 'stage unknown',
};

/**
 * Pounds per unit of each currency, fixed on 21 September 2026 so the
 * figure is reproducible: 1 USD = 0.78 GBP, 1 EUR = 0.85 GBP. The stored
 * amountText keeps the currency as written, so a rate change only moves the
 * converted figure.
 */
export const GBP_PER_UNIT: Record<string, number> = { GBP: 1, USD: 0.78, EUR: 0.85 };

const CURRENCY_SYMBOLS: Record<string, string> = { '£': 'GBP', '$': 'USD', '€': 'EUR' };
const CURRENCY_WORDS: Record<string, string> = { gbp: 'GBP', pounds: 'GBP', sterling: 'GBP', usd: 'USD', dollars: 'USD', eur: 'EUR', euros: 'EUR', euro: 'EUR' };

/** "£10.3 million", "$4M", "€2.5m", "USD 12 million", "10 million dollars", "£750,000", "£750k". */
const AMOUNT_RE = /(?:([£$€])\s?|\b(gbp|usd|eur)\s?)(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(bn|billion|mn|m|million|k|thousand)?\b|\b(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(bn|billion|mn|m|million|k|thousand)?\s(pounds|dollars|euros?|sterling)\b/i;

function multiplier(unit: string | undefined): number {
  const u = (unit || '').toLowerCase();
  if (u === 'bn' || u === 'billion') return 1e9;
  if (u === 'm' || u === 'mn' || u === 'million') return 1e6;
  if (u === 'k' || u === 'thousand') return 1e3;
  return 1;
}

/** The first money amount in a text: as written, its currency and the pounds it converts to. */
export function amountFromText(text: string): { amountText: string; currency: string; amountGbp: number } | null {
  const m = text.match(AMOUNT_RE);
  if (!m) return null;
  let currency: string;
  let number: string;
  let unit: string | undefined;
  if (m[3]) {
    currency = m[1] ? CURRENCY_SYMBOLS[m[1]] : CURRENCY_WORDS[(m[2] || '').toLowerCase()];
    number = m[3];
    unit = m[4];
  } else {
    currency = CURRENCY_WORDS[(m[7] || '').toLowerCase()] || 'GBP';
    number = m[5];
    unit = m[6];
  }
  const value = Number(number.replace(/,/g, '')) * multiplier(unit);
  if (!Number.isFinite(value) || value <= 0) return null;
  // A bare "£10" is not a raise; the smallest raise worth recording is a thousand.
  if (value < 1000) return null;
  const rate = GBP_PER_UNIT[currency] ?? 1;
  return { amountText: m[0].trim(), currency, amountGbp: Math.round(value * rate) };
}

/** The round named in a text, normalised; null when none. Pre-seed is tested before seed, and a Series letter keeps its letter. */
export function roundFromText(text: string): string | null {
  const t = text.toLowerCase();
  if (/\bpre[- ]?seed\b/.test(t)) return 'pre-seed';
  const series = t.match(/\bseries[- ]([a-h])\b/);
  if (series) return `Series ${series[1].toUpperCase()}`;
  if (/\bseed(?:[- ]stage|[- ]round|[- ]funding|[- ]investment|[- ]extension|[- ]capital| plus|\+)?\b/.test(t)) return 'seed';
  if (/\bangel(?:s| round| investment| investors| funding| backed)?\b/.test(t)) return 'angel';
  if (/\bbridge(?: round| financing| funding)?\b/.test(t)) return 'bridge';
  if (/\b(?:growth|late[- ]stage)(?: round| equity| funding| investment| capital)\b/.test(t)) return 'growth';
  return null;
}

/** The stage a round name implies; null when the round says nothing about it (a bridge, an angel top-up with no named stage). */
export function stageFromRound(round: string | null): StageLabel | null {
  if (!round) return null;
  const r = round.toLowerCase();
  if (r === 'pre-seed' || r === 'angel') return 'pre_seed';
  if (r === 'seed') return 'seed';
  if (r === 'series a') return 'series_a';
  if (/^series [b-h]$/.test(r) || r === 'growth') return 'series_b_plus';
  return null;
}

/** The stage the company calls itself in a text ("a seed-stage company", "at Series A"), else null. */
export function stageFromText(text: string): StageLabel | null {
  return stageFromRound(roundFromText(text));
}

const LIST_TRIGGER_RE = /\b(?:led by|co-led by|from|with participation from|with support from|alongside|backed by|joined by|including|investors? (?:include|included|are|were|such as)|with)\s+/gi;
const LIST_STOP_RE = /\s+(?:to|in|as|for|at|on|with|alongside|following|bringing|taking|valuing|which|that|who|announced|today|this|last|earlier|will|via)\b|[.;:()!?]|$/;
/** "angels from Monzo", "operators at Stripe": people, not a fund; the company name after them is not an investor. */
const PEOPLE_FROM_RE = /\b(angels?|angel investors?|founders?|operators?|executives?|execs|leaders|alumni|people|team|veterans) (?:from|at|of) [A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*)*/g;
/** "existing investors Seedcamp" and "new investor Headline" carry the name after the label. */
const INVESTOR_LABEL_RE = /^(?:(?:its |our |the |several |a number of |other )?(?:existing|new|previous|current|returning|strategic|lead|angel|prominent|leading|notable|institutional)?\s*(?:investors?|backers?|funds?|angels?|vcs?)\s+)/i;
const NOT_A_NAME_RE = /^(?:existing investors?|new investors?|angels?|angel investors?|others?|several|a number of|our|the|its|strategic investors?|investors?|backers?|funds?|vcs?|family and friends|friends and family|customers?|employees|founders?|management)$/i;
const NAME_RE = /^[A-Z0-9][\w&.'’-]*(?:\s+(?:[A-Z0-9][\w&.'’-]*|&|of|de|the))*$/;
/** "Headline led the round", "Seedcamp backed the company". */
const LEAD_NAME_RE = /^([A-Z][\w&.'’-]*(?:\s+(?:[A-Z][\w&.'’-]*|&))*)\s+(?:led|leads|co-led|backed|backs|invested|joined|participated|has invested|is leading|is investing)\b/;

function cleanName(part: string): string | null {
  let s = part.trim().replace(/^(?:and|&)\s+/i, '').replace(/\s+(?:and|&)$/i, '').replace(/[,.]$/, '').trim();
  s = s.replace(INVESTOR_LABEL_RE, '').trim();
  if (!s || NOT_A_NAME_RE.test(s)) return null;
  if (!NAME_RE.test(s)) return null;
  if (s.split(/\s+/).length > 6) return null;
  return s;
}

/** Investor names in a text, from "led by X", "from X, Y and Z", "with participation from X" and "X led the round". */
export function investorsFromText(raw: string): string[] {
  const text = raw.replace(PEOPLE_FROM_RE, '$1');
  const out: string[] = [];
  const add = (n: string | null) => { if (n && !out.some((o) => o.toLowerCase() === n.toLowerCase())) out.push(n); };
  const lead = text.match(LEAD_NAME_RE);
  if (lead) add(cleanName(lead[1]));
  for (const m of text.matchAll(LIST_TRIGGER_RE)) {
    const rest = text.slice(m.index! + m[0].length);
    const stop = rest.search(LIST_STOP_RE);
    const region = stop >= 0 ? rest.slice(0, stop) : rest;
    if (!/^[A-Z0-9]/.test(region.replace(INVESTOR_LABEL_RE, ''))) continue;
    for (const part of region.split(/,|\s+and\s+/)) {
      const name = cleanName(part);
      // A lower-case part is prose after the list ("...and will use the funds").
      if (!name) { if (part.trim() && !/^[A-Z0-9]/.test(part.trim().replace(INVESTOR_LABEL_RE, ''))) break; continue; }
      add(name);
    }
  }
  return out.slice(0, 8);
}

/** The date a hint gives, as far as it goes: "12 March 2026" is 2026-03-12, "March 2026" is 2026-03, "2025" is 2025. */
export function dateFromHint(hint: string | null | undefined): string | null {
  const year = yearFromDateHint(hint);
  if (year === null) return null;
  const month = monthFromDateHint(hint);
  if (month === null) {
    const q = (hint || '').match(/\bq([1-4])\b/i);
    if (q) return `${year}-${String((Number(q[1]) - 1) * 3 + 1).padStart(2, '0')}`;
    return String(year);
  }
  const day = (hint || '').match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?[A-Za-z]{3,9}\b|\b[A-Za-z]{3,9}\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+\d{4}\b/);
  const d = day ? Number(day[1] || day[2]) : null;
  const ym = `${year}-${String(month + 1).padStart(2, '0')}`;
  return d && d >= 1 && d <= 31 ? `${ym}-${String(d).padStart(2, '0')}` : ym;
}

function parseRaise(f: Fact): LatestRaise {
  const text = `${f.statement} ${f.quote}`;
  const amount = amountFromText(f.statement) ?? amountFromText(f.quote);
  return {
    amountText: amount?.amountText ?? null,
    amountGbp: amount?.amountGbp ?? null,
    round: roundFromText(f.statement) ?? roundFromText(f.quote),
    date: dateFromHint(f.date_hint),
    investors: investorsFromText(text),
    statement: f.statement,
    source_url: f.source_url,
  };
}

/**
 * The latest raise: funding_round facts sorted newest dated first (undated
 * ones after every dated one, an amount breaking ties), plus the investors
 * the investor facts name, when they are not dated before the raise.
 * `today` is unused for now: a raise is not aged out, the funding_round
 * signal applies its own window.
 */
export function deriveLatestRaise(facts: Fact[], _today: Date): LatestRaise | null {
  const rounds = facts.filter((f) => f.kind === 'funding_round').map(parseRaise);
  if (!rounds.length) return null;
  rounds.sort((a, b) => {
    if (a.date && b.date && a.date !== b.date) return b.date.localeCompare(a.date);
    if (!!a.date !== !!b.date) return a.date ? -1 : 1;
    if ((a.amountGbp !== null) !== (b.amountGbp !== null)) return a.amountGbp !== null ? -1 : 1;
    return 0;
  });
  const latest = { ...rounds[0], investors: [...rounds[0].investors] };
  const raiseYear = latest.date ? Number(latest.date.slice(0, 4)) : null;
  for (const f of facts.filter((x) => x.kind === 'investor')) {
    const y = yearFromDateHint(f.date_hint);
    if (raiseYear !== null && y !== null && y < raiseYear) continue;
    for (const n of investorsFromText(`${f.statement} ${f.quote}`)) {
      if (!latest.investors.some((o) => o.toLowerCase() === n.toLowerCase())) latest.investors.push(n);
    }
  }
  latest.investors = latest.investors.slice(0, 8);
  return latest;
}

/**
 * The stage: what the company calls itself (a stage fact) first, then the
 * round of the latest raise, then any funding_round fact with a stage word.
 * The register's incorporation date is deliberately not a stage: a company
 * incorporated last year with no round on its site is unknown, not
 * pre-seed, because the site may simply not mention money.
 */
export function deriveStage(facts: Fact[], _record: RecordForStage | null, today: Date): StageGuess {
  for (const f of facts.filter((x) => x.kind === 'stage')) {
    const label = stageFromText(f.statement) ?? stageFromText(f.quote);
    if (label) return { label, evidence: f.statement, source_url: f.source_url };
  }
  const raise = deriveLatestRaise(facts, today);
  if (raise) {
    const label = stageFromRound(raise.round);
    if (label) return { label, evidence: raise.statement, source_url: raise.source_url };
  }
  for (const f of facts.filter((x) => x.kind === 'funding_round')) {
    const label = stageFromText(f.statement) ?? stageFromText(f.quote);
    if (label) return { label, evidence: f.statement, source_url: f.source_url };
  }
  return { label: 'unknown', evidence: null, source_url: null };
}
