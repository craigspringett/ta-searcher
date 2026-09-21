// The prospect score: how likely this company is to need its first Head of
// Talent now, from what qualification found (docs/PROSPECTING-BRIEF.md,
// "Qualification", step 4). Every line is kept in score_reasons as
// {points, text} so the page can show the score as chips.
//
//   +45 a talent lead role advertised (board or job API); +25 any other
//       talent or recruiting role; +10 a Head of People posting
//   +30 a raise within 6 months that reads pre-seed, seed, Series A, or
//       £1m to £25m with no round named; +15 the same 6 to 12 months old;
//       +5 Series B or later, or a raise outside that shape
//   +20 an SH01 allotment within 6 months when no raise is in the news
//   +5 / +15 / +25 for 3 to 5, 6 to 11, 12 to 39 open roles; -25 for 40 or
//       more (a scaled company, past its first Head of Talent; first live
//       run, 21 September 2026: Handshake, RELX, Shield AI)
//   +10 incorporated within 3 years; -30 more than ten years ago
//   -30 no website; -20 no board and no talent posting; -100 not active on
//       the register (a company not matched keeps its score, noted)

import { isTalentLeadRole, isTalentRole } from '../vacancies/role-family.ts';
import { isHeadOfPeopleRole } from './job-apis.ts';
import type { ProspectBoard, ProspectRaise, ProspectRegister, ScoreReason, TalentPosting } from './types.ts';

export interface ScoreInput {
  website: string | null;
  register: ProspectRegister | null;
  raise: ProspectRaise | null;
  boards: ProspectBoard[];
  talentPostings: TalentPosting[];
  /** When the raise carries no date: the day the prospect was first seen. */
  firstSeenAt?: string | null;
}

export interface ProspectScore {
  score: number;
  reasons: ScoreReason[];
}

const DAY = 86_400_000;
export const LARGE_BOARD_ROLES = 40;
export const OLD_COMPANY_MONTHS = 120;

function monthsBetween(iso: string | null | undefined, today: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (today.getTime() - t) / (30.4375 * DAY);
}

/** Whether a raise reads as the stage Craig sells into: pre-seed, seed, Series A, or an unnamed round of £1m to £25m. */
export function raiseReadsEarly(raise: ProspectRaise): boolean {
  const round = (raise.round || '').toLowerCase();
  if (/pre-?seed|^seed$|^seed\b|series a\b|angel/.test(round)) return true;
  if (!round && raise.amountGbp !== null && raise.amountGbp >= 1_000_000 && raise.amountGbp <= 25_000_000) return true;
  return false;
}

function raiseWords(raise: ProspectRaise): string {
  const bits = [raise.amountText, raise.round].filter(Boolean);
  return bits.length ? bits.join(' ') : 'a raise';
}

export function scoreProspect(input: ScoreInput, today: Date): ProspectScore {
  const reasons: ScoreReason[] = [];
  const add = (points: number, text: string) => reasons.push({ points, text });

  // Talent roles: the strongest line wins, from the boards and the job APIs.
  const boardTitles = input.boards.flatMap((b) => [...b.talentRoles, ...b.titles]);
  const postingTitles = input.talentPostings.map((p) => p.title);
  const allTitles = Array.from(new Set([...boardTitles, ...postingTitles]));
  const lead = allTitles.find((t) => isTalentLeadRole(t));
  const otherTalent = allTitles.find((t) => !isTalentLeadRole(t) && isTalentRole(t) && !isHeadOfPeopleRole(t));
  const headOfPeople = allTitles.find((t) => isHeadOfPeopleRole(t));
  const where = (title: string) => {
    const posting = input.talentPostings.find((p) => p.title === title);
    if (posting) return posting.source === 'adzuna' ? 'on Adzuna' : 'on Reed';
    const board = input.boards.find((b) => b.talentRoles.includes(title) || b.titles.includes(title));
    return board ? `on the ${board.provider} board` : 'advertised';
  };
  if (lead) add(45, `${lead} advertised ${where(lead)}`);
  else if (otherTalent) add(25, `${otherTalent} advertised ${where(otherTalent)}`);
  else if (headOfPeople) add(10, `${headOfPeople} advertised ${where(headOfPeople)}`);

  // The raise.
  let raiseScored = false;
  if (input.raise) {
    const months = monthsBetween(input.raise.date, today) ?? monthsBetween(input.firstSeenAt, today) ?? 0;
    const early = raiseReadsEarly(input.raise);
    const words = raiseWords(input.raise);
    if (early && months <= 6) add(30, `raised ${words} in the last six months`);
    else if (early && months <= 12) add(15, `raised ${words} six to twelve months ago`);
    else if (months <= 12) add(5, `raised ${words}, which reads later than Series A`);
    else add(0, `raised ${words} more than a year ago`);
    raiseScored = true;
  }

  // SH01 within six months when the news has nothing.
  if (!raiseScored && input.register) {
    const sh01 = input.register.capitalFilings.find((f) => /^SH01/i.test(f.type) && (monthsBetween(f.date, today) ?? 99) <= 6);
    if (sh01) add(20, `shares allotted on the register (${sh01.date}) with no raise in the news`);
  }

  // Open roles.
  const openRoles = input.boards.reduce((n, b) => n + (b.count || 0), 0);
  if (openRoles >= LARGE_BOARD_ROLES) add(-25, `${openRoles} open roles reads as a scaled company`);
  else if (openRoles >= 12) add(25, `${openRoles} open roles`);
  else if (openRoles >= 6) add(15, `${openRoles} open roles`);
  else if (openRoles >= 3) add(5, `${openRoles} open roles`);

  // Age.
  const age = monthsBetween(input.register?.incorporationDate, today);
  if (age !== null && age <= 36) add(10, `incorporated within three years (${input.register!.incorporationDate})`);
  else if (age !== null && age > OLD_COMPANY_MONTHS) add(-30, `incorporated more than ten years ago (${input.register!.incorporationDate})`);

  // Penalties.
  if (!input.website) add(-30, 'no website found');
  if (!input.boards.length && !input.talentPostings.length) add(-20, 'no job board and no talent posting');
  if (input.register?.matched) {
    if (input.register.status && input.register.status !== 'active') add(-100, `${input.register.status} on the register`);
  } else {
    add(0, 'not matched on the register');
  }

  const score = reasons.reduce((n, r) => n + r.points, 0);
  return { score, reasons };
}
