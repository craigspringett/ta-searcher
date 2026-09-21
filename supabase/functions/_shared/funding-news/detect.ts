// Is a headline a raise story, and whose?
//
// Investigation of 21 September 2026 over the three fixtures (134 items):
// a raise headline is "<company> raises <amount> ..." nearly every time,
// with secures, lands, closes, bags, picks up and nets as the variants, the
// amount in the headline and the round often after it ("in seed funding
// round", "Series A"). What comes before the verb is the company, dressed
// up: "London's Metris Energy", "UK startup Outpost", "AI litigation
// legaltech start-up Crimson", "London-based Jack & Jill", "Ex-Palantir
// team behind Conduct", "DeepMind creative lead's AI writing startup
// Marker", "Exclusive: UK HealthTech startup Nul", "From cash deposits to
// everyday rewards: London-based Stoa". A colon or a descriptor word
// (startup, start-up, firm, company, behind, "-based") is the cue: the
// name is what follows the last of them. Fund closes ("closes $50m fund")
// use the same verbs and are not a start-up raising; they are refused when
// the word "fund" follows the amount. Nothing here is asked of a model.

import { amountFromText, roundFromText } from '../facts/derive.ts';

/** The verbs a raise headline uses, in the order a regex alternation tries them. */
const RAISE_VERBS = ['raises', 'raised', 'secures', 'secured', 'lands', 'landed', 'closes', 'closed', 'bags', 'bagged', 'picks up', 'picked up', 'nets', 'netted'];
const VERB_RE = new RegExp(`\\b(${RAISE_VERBS.join('|')})\\b`, 'i');
/** A round word, the second half of the test when the headline gives no amount. */
const ROUND_WORD_RE = /\b(?:pre[- ]?seed|seed|series[- ][a-h]|funding|round|investment)\b/i;
/** "closes $50m fund", "raises $100m second fund", "raises new fund": a fund manager, not a start-up. */
const FUND_CLOSE_RE = new RegExp(`\\b(?:${RAISE_VERBS.join('|')})\\b\\s+(?:a\\s+|an\\s+|its\\s+|new\\s+|the\\s+)?(?:[£$€]?[\\d.,]+\\s?(?:bn|billion|mn|m|million|k|thousand)?\\s+)?(?:\\w+\\s+){0,2}funds?\\b`, 'i');
/** "raises £5m from the UK Sovereign AI Fund" names a fund as an investor and is a raise. */
const FUND_AS_INVESTOR_RE = /\b(?:from|led by|backed by|with)\s+(?:[\w'’&.-]+\s+){0,5}funds?\b/i;

/** Whether the text (title, then summary) reads as a company raising money. */
export function isRaiseStory(title: string, summary: string | null | undefined = ''): boolean {
  const t = (title || '').trim();
  if (!t) return false;
  const verb = t.match(VERB_RE);
  if (!verb) return false;
  if (FUND_CLOSE_RE.test(t) && !FUND_AS_INVESTOR_RE.test(t)) return false;
  const both = `${t} ${summary || ''}`;
  if (amountFromText(both)) return true;
  return ROUND_WORD_RE.test(both);
}

/** Leading dressing on a company name: places, nationalities, a possessive place ("London's"). */
const LEADING_RE = /^(?:(?:[A-Z][\w.]*(?:’|')s)|uk|u\.k\.|british|english|scottish|welsh|irish|european|the|a|an|exclusive|breaking|report|reports)\s+/i;
/** A descriptor that ends the dressing: the name is what follows the last one. */
const DESCRIPTOR_RE = /(?:\b(?:startup|start-up|scaleup|scale-up|company|firm|business|brand|lab|maker|developer|provider|platform|unicorn|behind|fintech|healthtech|legaltech|insurtech|proptech|edtech|biotech|medtech|deeptech|climatetech|agritech|cleantech|regtech|adtech|martech|govtech|femtech|spacetech|foodtech)|-based)\s+/gi;

/**
 * The company a raise headline names: the words before the verb, after the
 * last colon and the last descriptor, with the leading place or
 * nationality and any trailing punctuation taken off. Null when nothing
 * is left, or when there is no raise verb to cut at.
 */
export function companyNameFromTitle(title: string): string | null {
  const t = (title || '').replace(/\s+/g, ' ').trim();
  const verb = t.match(VERB_RE);
  if (!verb || verb.index === undefined) return null;
  let head = t.slice(0, verb.index).trim();
  // "Exclusive: ..." and "From x to y: London-based Stoa": the name is after the last colon.
  const colon = Math.max(head.lastIndexOf(': '), head.lastIndexOf(' | '));
  if (colon >= 0) head = head.slice(colon + 2).trim();
  // "Augur, a ‘grey-zone’ national security startup,": the name is before the appositive.
  const appositive = head.match(/^([^,]{2,}?),\s+(?:a|an|the)\b/i);
  if (appositive) head = appositive[1].trim();
  // "AI litigation legaltech start-up Crimson": after the last descriptor.
  let last: RegExpMatchArray | null = null;
  for (const m of head.matchAll(DESCRIPTOR_RE)) last = m;
  if (last && last.index !== undefined) head = head.slice(last.index + last[0].length).trim();
  for (let i = 0; i < 4; i++) {
    const next = head.replace(LEADING_RE, '');
    if (next === head) break;
    head = next.trim();
  }
  head = head.replace(/^[\s,;:"'“”‘’(-]+/, '').replace(/[\s,;:"'“”‘’)-]+$/, '').trim();
  // What is left must be a name: not a descriptor on its own ("London startup"),
  // not a person by their role ("Forbes 30 Under 30 founder", "Nigerian drone
  // maker"), not the tail of a phrase ("from Manny Medina", "driven by Imperial alumni").
  if (!head) return null;
  if (/(?:^|\s)(?:startup|start-up|company|firm|business|founders?|researcher|veteran|woman|man|maker|team|alumni|programme|program|it|they)$/i.test(head)) return null;
  if (/^(?:from|on|by|with|for|in|at|of|driven|led|backed|founded)\b/i.test(head)) return null;
  return head;
}

export interface ParsedRaise {
  companyName: string | null;
  amountText: string | null;
  amountGbp: number | null;
  round: string | null;
}

/** The company, the amount and the round a raise story gives, headline first, summary second. */
export function parseRaise(title: string, summary: string | null | undefined = ''): ParsedRaise {
  const amount = amountFromText(title || '') ?? amountFromText(summary || '');
  return {
    companyName: companyNameFromTitle(title),
    amountText: amount?.amountText ?? null,
    amountGbp: amount?.amountGbp ?? null,
    round: roundFromText(title || '') ?? roundFromText(summary || ''),
  };
}
