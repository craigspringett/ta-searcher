// The Friday brief (Phase 5, slice 5): who gets what. Pure: the function
// loads the rows and this module ranks and words them.
//
// One email per person (a consultant address; several consultant rows can
// share one, as "Isobel" and "Isobel NEW Area" do) with their companies ranked
// by the propensity score, the strongest signal as the one-line reason and
// the best named contact. Managers get the whole picture: the top companies
// across every patch, then each consultant's top few.

import type { BriefContact, BriefCompany, BriefSection } from '../transactional-email-templates/friday-brief.tsx';
import { scoreBand } from '../score/propensity.ts';
import { SIGNAL_LABELS } from '../signals/compute.ts';

/**
 * How many companies an edition lists (Craig, 11 September 2026, replacing
 * the 10 September "worth a call, up to 25" cut): the top five by score,
 * always, so every consultant opens the same short list on a Monday and
 * works it in a morning. Five is the number of calls the brief asks for,
 * not a threshold: the fifth company is listed whether it scores 55 or 15,
 * because the point of the brief is the order, not the bar.
 */
export const BRIEF_TOP_COUNT = 5;
/**
 * The score at which a company is green, "call this week", the top band in
 * scoreBand (60 and up: two strong signals, or one strong and one middling).
 * When more than five of a consultant's companies are green, every green
 * company is listed, because each is a call that should happen this week
 * and a cap of five would hide the sixth. There is no other upper limit.
 * A test pins this to scoreBand so the two cannot drift apart.
 */
export const BRIEF_GREEN_SCORE = 60;

export interface BriefScoreLine {
  code: string;
  label: string;
  points: number;
  reason: string;
  kind: 'signal' | 'adjustment';
}

export interface BriefCompanyInput {
  id: string;
  name: string;
  /** The stage guess label: pre_seed, seed, series_a, series_b_plus, unknown. */
  stage: string | null;
  sector: string | null;
  website: string | null;
  score: number | null;
  breakdown: BriefScoreLine[];
  topReason: string | null;
  /** The code of the signal behind topReason (company_scores.top_code). */
  topCode?: string | null;
  contacts: Array<{ name?: string | null; role?: string | null; email?: string | null; confidence?: string | null }>;
  phone: string | null;
  openVacancies: number;
  lastOutcome: { kind: string; at: string } | null;
  nextCallback: string | null;
  consultantNames: string[];
}

export interface BriefPerson {
  email: string;
  /** Display name: the consultant's name (the first of several rows). */
  name: string;
  consultantIds: string[];
}

const ROLE_ORDER = ['founder', 'ceo', 'chief executive', 'coo', 'chief of staff', 'chief people', 'head of people', 'vp people', 'people', 'head of talent', 'talent', 'recruit', 'cto', 'chief technology', 'vp engineering', 'head of engineering', 'chief', 'director', 'vp', 'head of', 'operations', 'ea', 'executive assistant', 'office manager', 'investor', 'board'];

function roleRank(role: string | null | undefined): number {
  const r = (role || '').toLowerCase();
  const i = ROLE_ORDER.findIndex((k) => r.includes(k));
  return i < 0 ? ROLE_ORDER.length : i;
}

/**
 * The person to ask for on the phone: a named person beats a generic
 * mailbox; among named people a contact the consultant provided beats an
 * address found on the site beats a guess beats a name only; then the
 * senior role. A generic mailbox is the fallback.
 */
export function bestContact(contacts: BriefCompanyInput['contacts']): BriefContact | null {
  const conf = (c: string | null | undefined) => (c === 'consultant_provided' ? 0 : c === 'found' ? 1 : c === 'pattern_guess' ? 2 : c === 'role_only' ? 3 : 4);
  const usable = contacts.filter((c) => (c.name || '').trim() || (c.email || '').trim());
  if (!usable.length) return null;
  const hasName = (c: BriefCompanyInput['contacts'][number]) => ((c.name || '').trim() ? 0 : 1);
  const best = [...usable].sort((a, b) => hasName(a) - hasName(b) || conf(a.confidence) - conf(b.confidence) || roleRank(a.role) - roleRank(b.role))[0];
  return { name: (best.name || '').trim(), role: (best.role || '').trim(), email: (best.email || '').trim() || undefined, confidence: best.confidence || undefined };
}

/** A list name ("Anja Cold Targets", "House", "Isobel NEW Area") is not the person's name; prefer the plain one. */
export function personName(names: string[]): string {
  const plain = names.filter((n) => !/\b(cold|targets?|house|area|new|list|patch|old)\b/i.test(n));
  return (plain[0] || names[0] || '').trim();
}

/** "Tue 15 Sep", in London time, spelled the same on every runtime. */
export function ukShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'Europe/London' }).formatToParts(d);
  const get = (t: string) => parts.find((x) => x.type === t)?.value || '';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const weekday = days.find((x) => get('weekday').startsWith(x)) || get('weekday');
  return `${weekday} ${Number(get('day'))} ${months[Number(get('month')) - 1] || get('month')}`;
}

const OUTCOME_WORDS: Record<string, string> = { spoke_to: 'Spoke to', voicemail: 'Left a voicemail', callback: 'Call back agreed', not_interested: 'Not interested', meeting_booked: 'Meeting booked' };

export function outcomeLine(s: Pick<BriefCompanyInput, 'lastOutcome' | 'nextCallback'>, today: Date): string | undefined {
  const todayMs = today.getTime();
  if (s.nextCallback) {
    const cb = new Date(s.nextCallback).getTime();
    if (cb >= todayMs - 86400000 && cb <= todayMs + 14 * 86400000) return `Call back due ${ukShort(s.nextCallback)}`;
  }
  if (s.lastOutcome) {
    const at = new Date(s.lastOutcome.at).getTime();
    if (todayMs - at <= 30 * 86400000) return `${OUTCOME_WORDS[s.lastOutcome.kind] || s.lastOutcome.kind} on ${ukShort(s.lastOutcome.at)}`;
  }
  return undefined;
}

/**
 * The codes whose explanation may be the one-line reason for calling. Every
 * computed signal qualifies: a spend figure, a vacancy, an advert, a head
 * change, an Ofsted line, or a fact of a signal-bearing kind (leadership,
 * Ofsted, SEND, expansion, trust, staffing pressure, a departure). A
 * "values" or "other" fact never becomes a signal, so it can never be the
 * reason; an unknown code in a stored breakdown is skipped rather than read.
 */
export const REASON_CODES: ReadonlySet<string> = new Set(Object.keys(SIGNAL_LABELS).filter((c) => c !== 'has_talent_lead'));

/** The strongest signal line the brief may quote, or null. */
export function reasonLine(s: Pick<BriefCompanyInput, 'breakdown' | 'topReason' | 'topCode'>): { reason: string; code: string } | null {
  const signals = s.breakdown.filter((l) => l.kind === 'signal' && REASON_CODES.has(l.code) && l.reason).sort((a, b) => b.points - a.points);
  if (s.topReason && s.topCode && REASON_CODES.has(s.topCode)) return { reason: s.topReason, code: s.topCode };
  if (s.topReason && !s.topCode && signals[0] && signals[0].reason === s.topReason) return { reason: s.topReason, code: signals[0].code };
  return signals[0] ? { reason: signals[0].reason, code: signals[0].code } : null;
}

export function toBriefCompany(s: BriefCompanyInput, rank: number, appBase: string, withConsultant = false): BriefCompany {
  const score = s.score ?? 0;
  const signals = s.breakdown.filter((l) => l.kind === 'signal' && REASON_CODES.has(l.code)).sort((a, b) => b.points - a.points);
  const lead = reasonLine(s);
  const reason = lead?.reason || (score > 0 ? 'Scored on adjustments only.' : 'No signal today; a routine call.');
  const also = signals.filter((l) => l.code !== lead?.code).slice(0, 2).map((l) => l.label);
  const adjustments = s.breakdown.filter((l) => l.kind === 'adjustment' && l.code !== 'stale').map((l) => l.label);
  return {
    rank,
    name: s.name,
    stage: stageWords(s.stage),
    sector: s.sector || undefined,
    appUrl: `${appBase}/companies/${s.id}`,
    website: s.website || undefined,
    score,
    band: scoreBand(score),
    reason,
    alsoSignals: [...also, ...adjustments].slice(0, 3),
    contact: bestContact(s.contacts),
    phone: s.phone || undefined,
    openVacancies: s.openVacancies,
    outcomeLine: outcomeLine(s, new Date()),
    consultant: withConsultant ? s.consultantNames.join(', ') || undefined : undefined,
  };
}

/** The stage label in words for the brief. */
export function stageWords(stage: string | null | undefined): string | undefined {
  switch (stage) {
    case 'pre_seed': return 'Pre-seed';
    case 'seed': return 'Seed';
    case 'series_a': return 'Series A';
    case 'series_b_plus': return 'Series B or later';
    default: return undefined;
  }
}

/** One line per company even when it is tracked twice (same name). */
function dedupeCompanies(sorted: BriefCompanyInput[]): BriefCompanyInput[] {
  const seen = new Set<string>();
  const out: BriefCompanyInput[] = [];
  for (const s of sorted) {
    const key = s.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function byScore(companies: BriefCompanyInput[]): BriefCompanyInput[] {
  return [...companies].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.name.localeCompare(b.name));
}

/** A company with a score above zero: a null or zero score has nothing to point to on the phone, so it is never listed. */
function scored(companies: BriefCompanyInput[]): BriefCompanyInput[] {
  return dedupeCompanies(byScore(companies)).filter((s) => (s.score ?? 0) > 0);
}

/**
 * The list: score first, then name, one line per company; the top
 * BRIEF_TOP_COUNT, or every green company when more than that many are
 * green. A consultant with fewer than five scored companies gets what there
 * is; nothing is padded with unscored companies.
 */
export function rankCompanies(companies: BriefCompanyInput[]): BriefCompanyInput[] {
  const list = scored(companies);
  const green = list.filter((s) => (s.score ?? 0) >= BRIEF_GREEN_SCORE).length;
  return list.slice(0, Math.max(BRIEF_TOP_COUNT, green));
}

/** "Your 12 companies to call, week of 14 September 2026"; the manager's subject is unchanged. */
export function briefSubject(count: number, weekOf: string): string {
  return count === 1 ? `Your 1 company to call, week of ${weekOf}` : `Your ${count} companies to call, week of ${weekOf}`;
}

/** A director's copy of a consultant's brief: "[Anja] Your 12 companies to call, week of ...", so an inbox sorts by consultant. */
export function copySubject(personName: string, subject: string): string {
  const first = (personName || '').trim().split(/\s+/)[0] || 'Consultant';
  return `[${first}] ${subject}`;
}

/**
 * Who receives a consultant's edition besides the consultant: the directors
 * (the global list, `app_settings.brief_copy_recipients`) and anyone on
 * the consultant rows' own copy lists. Never the consultant twice, never an
 * address without an @, case-folded, in a stable order.
 */
export function briefCopies(person: BriefPerson, directors: string[], copiesByConsultant: Map<string, string[]>): string[] {
  const out: string[] = [];
  const add = (e: string | null | undefined) => {
    const v = (e || '').trim().toLowerCase();
    if (v && v.includes('@') && v !== person.email && !out.includes(v)) out.push(v);
  };
  for (const d of directors) add(d);
  for (const id of person.consultantIds) for (const e of copiesByConsultant.get(id) || []) add(e);
  return out;
}

/**
 * A one-line note for the week. Schools had a resignation-deadline
 * countdown here; start-ups have no calendar, so the line is empty until
 * there is something worth saying every week.
 */
export function countdownLine(_today: Date): string {
  return '';
}

/** The Monday after the brief goes out, as "14 September 2026". */
export function weekOfLabel(today: Date): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const day = d.getUTCDay();
  const toMonday = day === 1 ? 7 : (8 - day) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + toMonday);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export interface BriefTotals { hot: number; warm: number; cool: number; companies: number }

export function totalsOf(companies: BriefCompanyInput[]): BriefTotals {
  const t = { hot: 0, warm: 0, cool: 0, companies: companies.length };
  for (const s of companies) t[scoreBand(s.score ?? 0)]++;
  return t;
}

/**
 * A consultant's edition: the top five by score, or every green company
 * when more than five are green; the count in the title. Fewer than five
 * scored companies and the subtitle says so in one line.
 */
export function buildPersonBrief(person: BriefPerson, companies: BriefCompanyInput[], appBase: string): { sections: BriefSection[]; totals: BriefTotals; count: number } {
  const ranked = rankCompanies(companies);
  const totals = totalsOf(companies);
  const n = ranked.length;
  const title = n === 0 ? 'No company to call this week' : n === 1 ? 'Your 1 company to call' : `Your ${n} companies to call`;
  const subtitle = n === 0
    ? `None of your ${companies.length} companies has a score on today's signals.`
    : n < BRIEF_TOP_COUNT
    ? `Only ${n} of your ${companies.length} companies ${n === 1 ? 'has' : 'have'} a score on today's signals, so the list is shorter than the usual five.`
    : totals.hot > BRIEF_TOP_COUNT
    ? `Every one of the ${totals.hot} companies on your patch to call this week, ranked; the other ${companies.length - totals.hot} have nothing as pressing.`
    : `The ${n} of your ${companies.length} companies most likely to buy now (${totals.hot} to call this week, ${totals.warm} worth a call).`;
  return { sections: [{ title, subtitle, companies: ranked.map((s, i) => toBriefCompany(s, i + 1, appBase)) }], totals, count: n };
}

/** The manager's edition: the same rule across every patch, with the consultant named, then per consultant. */
export function buildManagerBrief(people: BriefPerson[], companiesByPerson: Map<string, BriefCompanyInput[]>, allCompanies: BriefCompanyInput[], appBase: string): { sections: BriefSection[]; totals: BriefTotals; count: number } {
  const totals = totalsOf(allCompanies);
  const top = rankCompanies(allCompanies);
  const sections: BriefSection[] = [{ title: `Top ${top.length} across the patch`, subtitle: `Of ${allCompanies.length} tracked companies: ${totals.hot} to call this week, ${totals.warm} worth a call, ${totals.cool} quiet.`, companies: top.map((s, i) => toBriefCompany(s, i + 1, appBase, true)) }];
  for (const p of [...people].sort((a, b) => a.name.localeCompare(b.name))) {
    const mine = companiesByPerson.get(p.email) || [];
    const t = totalsOf(mine);
    const ranked = rankCompanies(mine);
    const tail = ranked.length === 0 ? ' None has a score.' : ranked.length < BRIEF_TOP_COUNT ? ` Only ${ranked.length} scored:` : ` Top ${ranked.length}:`;
    sections.push({ title: p.name, subtitle: `${mine.length} companies: ${t.hot} to call this week, ${t.warm} worth a call.${tail}`, companies: ranked.map((s, i) => toBriefCompany(s, i + 1, appBase)) });
  }
  return { sections, totals, count: top.length };
}
