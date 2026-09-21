// The propensity score: one 0 to 100 "likely to buy now" number per
// company, built from the computed signals and the call outcomes so a list
// ranks itself, with every point explained (docs/TA-SEARCHER-BRIEF.md,
// "Signals and the score").
//
// Each signal contributes a probability-like share by code and strength
// (the table below). Shares combine as 1 - (1 - a)(1 - b)..., so a company
// with three middling signals scores well but no single signal reaches 100,
// and adding a weak signal never lowers the score. Call outcomes then adjust
// it: "not interested" in the last 90 days cuts it, a conversation in the
// last fortnight cools it, a callback due this week lifts it. Signals older
// than a fortnight fade. A Head of Talent already in post halves it. The
// breakdown lists every contribution in words.

export interface SignalForScore {
  code: string;
  label: string;
  strength: number;
  explanation: string;
  computedAt?: string | null;
}

export interface OutcomeForScore {
  kind: string;
  createdAt: string;
  callbackAt?: string | null;
}

export interface ScoreInput {
  today: Date;
  signals: SignalForScore[];
  outcomes: OutcomeForScore[];
  /** When the signals were last computed (company_signals.computed_at or the analysis time). */
  computedAt?: string | null;
}

export interface ScoreLine {
  code: string;
  label: string;
  /** Points this line is worth on its own (0 to 100 for a signal; a multiplier or bonus for an adjustment). */
  points: number;
  reason: string;
  kind: 'signal' | 'adjustment';
}

export interface Propensity {
  score: number;
  breakdown: ScoreLine[];
  /** The strongest signal's explanation, for the brief's one-line reason. */
  topReason: string | null;
  topCode: string | null;
}

/** Points at each strength (1, 2, 3), the brief's table. A code missing here scores nothing. */
export const SIGNAL_POINTS: Record<string, [number, number, number]> = {
  talent_role_open: [36, 40, 44],
  hiring_surge: [14, 24, 34],
  engineering_hiring: [8, 12, 16],
  no_people_function: [22, 22, 22],
  funding_round: [22, 30, 38],
  shares_allotted: [12, 18, 24],
  new_senior_officer: [12, 16, 20],
  long_open_role: [22, 22, 24],
  readvertised_role: [30, 30, 32],
  staffing_pressure_stated: [20, 22, 25],
  agency_advertising: [16, 20, 26],
  staff_departure: [20, 26, 36],
  expansion: [8, 12, 14],
  accelerator: [6, 6, 6],
  new_company: [8, 12, 12],
  consultant_intel: [10, 10, 10],
};

export const NOT_INTERESTED_DAYS = 90;
export const SPOKE_RECENTLY_DAYS = 14;
export const CALLBACK_WINDOW_DAYS = 7;
export const STALE_AFTER_DAYS = 14;
/** A company with a Head of Talent, Head of Recruitment or Talent Acquisition lead in post has the function; the conversation is different and the score says so. */
export const HAS_TALENT_LEAD_FACTOR = 0.5;

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(Number(fromIso.slice(0, 4)), Number(fromIso.slice(5, 7)) - 1, Number(fromIso.slice(8, 10)));
  const b = Date.UTC(Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7)) - 1, Number(toIso.slice(8, 10)));
  return Math.round((b - a) / 86400000);
}

function ukDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]}`;
}

export function computePropensity(input: ScoreInput): Propensity {
  const todayIso = input.today.toISOString().slice(0, 10);
  const breakdown: ScoreLine[] = [];
  let miss = 1;
  const seen = new Set<string>();
  const ranked = [...input.signals].filter((s) => SIGNAL_POINTS[s.code]).sort((a, b) => pointsFor(b) - pointsFor(a));
  for (const s of ranked) {
    if (seen.has(s.code)) continue;
    seen.add(s.code);
    const p = pointsFor(s);
    if (p <= 0) continue;
    miss *= 1 - p / 100;
    breakdown.push({ code: s.code, label: s.label, points: p, reason: s.explanation, kind: 'signal' });
  }
  let score = 100 * (1 - miss);

  // Fade: signals computed more than a fortnight ago are less certain.
  const computedAt = input.computedAt ? input.computedAt.slice(0, 10) : null;
  if (computedAt && score > 0) {
    const age = daysBetween(computedAt, todayIso);
    if (age > STALE_AFTER_DAYS) {
      const factor = age > 60 ? 0.6 : 0.85;
      score *= factor;
      breakdown.push({ code: 'stale', label: 'Analysis is not fresh', points: factor, reason: `The signals were computed ${age} days ago (${ukDate(computedAt)}); refresh the company to be sure.`, kind: 'adjustment' });
    }
  }

  // A Head of Talent is already in post: the company has the function, so
  // the score halves. Never a signal in its own right (it scores nothing
  // above); the code stays in the signals list so the page can show why.
  if (score > 0 && input.signals.some((s) => s.code === 'has_talent_lead')) {
    const s = input.signals.find((x) => x.code === 'has_talent_lead')!;
    score *= HAS_TALENT_LEAD_FACTOR;
    breakdown.push({ code: 'has_talent_lead', label: 'A Head of Talent is already in post', points: HAS_TALENT_LEAD_FACTOR, reason: s.explanation, kind: 'adjustment' });
  }

  // Outcomes, newest first.
  const outcomes = [...input.outcomes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const notInterested = outcomes.find((o) => o.kind === 'not_interested' && daysBetween(o.createdAt.slice(0, 10), todayIso) <= NOT_INTERESTED_DAYS);
  if (notInterested) {
    score *= 0.4;
    breakdown.push({ code: 'not_interested', label: 'Said not interested', points: 0.4, reason: `The company said it was not interested on ${ukDate(notInterested.createdAt)}; give it ${NOT_INTERESTED_DAYS} days.`, kind: 'adjustment' });
  }
  const spoke = outcomes.find((o) => (o.kind === 'spoke_to' || o.kind === 'meeting_booked') && daysBetween(o.createdAt.slice(0, 10), todayIso) <= SPOKE_RECENTLY_DAYS);
  if (spoke && !notInterested) {
    score *= 0.7;
    breakdown.push({ code: 'spoke_recently', label: spoke.kind === 'meeting_booked' ? 'Meeting already booked' : 'Spoken to recently', points: 0.7, reason: `${spoke.kind === 'meeting_booked' ? 'A meeting was booked' : 'Someone spoke to the company'} on ${ukDate(spoke.createdAt)}; it is in hand.`, kind: 'adjustment' });
  }
  const callback = outcomes
    .filter((o) => o.callbackAt && daysBetween(todayIso, o.callbackAt.slice(0, 10)) >= -1 && daysBetween(todayIso, o.callbackAt.slice(0, 10)) <= CALLBACK_WINDOW_DAYS)
    .sort((a, b) => (a.callbackAt || '').localeCompare(b.callbackAt || ''))[0];
  if (callback && !notInterested) {
    score = Math.min(100, score + 15);
    breakdown.push({ code: 'callback_due', label: 'Callback due', points: 15, reason: `A callback was promised for ${ukDate(callback.callbackAt!)}.`, kind: 'adjustment' });
  }

  const rounded = Math.max(0, Math.min(100, Math.round(score)));
  const top = breakdown.find((b) => b.kind === 'signal') ?? null;
  return { score: rounded, breakdown, topReason: top?.reason ?? null, topCode: top?.code ?? null };
}

export function pointsFor(s: SignalForScore): number {
  const row = SIGNAL_POINTS[s.code];
  if (!row) return 0;
  const i = Math.max(1, Math.min(3, Math.round(s.strength))) - 1;
  return row[i];
}

/** A band for the list: "hot" 60+, "warm" 30 to 59, "cool" below. */
export function scoreBand(score: number): 'hot' | 'warm' | 'cool' {
  return score >= 60 ? 'hot' : score >= 30 ? 'warm' : 'cool';
}
