// Follow-up campaigns, stage 1 (Craig, 18 November 2026; ported from He-Giveth): up to 15 contacts,
// at most 2 at any one company, started together with one shared plan. Pure:
// the request rules and the plan template. The writes are in campaigns/index.ts.

import type { PlanTemplateStep, StepKind } from './plan.ts';
import { isAddress } from '../outreach/rules.ts';

export const MAX_CAMPAIGN_CONTACTS = 15;
export const MAX_PER_COMPANY = 2;
export const MAX_CAMPAIGN_STEPS = 6;
const UUID = /^[0-9a-f-]{36}$/i;

/** An email stage may say what that email is about and carry an example email to base it on. */
export interface CampaignStage { kind: StepKind; day: number; note?: string; example?: string }
export const MAX_STAGE_NOTE = 600;
export const MAX_STAGE_EXAMPLE = 3000;
export const MAX_NOTES_TOTAL = 3900;
export interface CampaignContact { companySearchId: string; contactName: string; contactEmail: string; contactRole: string | null }
export interface CampaignRequest { name: string; angle: string; plan: CampaignStage[]; contacts: CampaignContact[]; autoAfterFirst: boolean; writeAlike: boolean }

/** The usual stages: the introduction email, a call two days on, an email on day 4, a call on day 8, the last email on day 14. */
export const DEFAULT_CAMPAIGN_PLAN: CampaignStage[] = [{ kind: 'email', day: 0 }, { kind: 'call', day: 2 }, { kind: 'email', day: 4 }, { kind: 'call', day: 8 }, { kind: 'email', day: 14 }];

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, max) : '');

export function parseCampaignRequest(raw: unknown): { ok: CampaignRequest; error: null } | { ok: null; error: string } {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = text(b.name, 80);
  if (!name) return { ok: null, error: 'Give the campaign a name.' };
  const planRaw = Array.isArray(b.plan) ? b.plan : DEFAULT_CAMPAIGN_PLAN;
  if (planRaw.length < 1 || planRaw.length > MAX_CAMPAIGN_STEPS) return { ok: null, error: `A campaign has 1 to ${MAX_CAMPAIGN_STEPS} stages.` };
  const plan: CampaignStage[] = [];
  for (const s of planRaw) {
    const kind = (s as { kind?: unknown })?.kind;
    const day = Number((s as { day?: unknown })?.day);
    if (kind !== 'email' && kind !== 'call') return { ok: null, error: 'Each stage is an email or a call.' };
    if (!Number.isInteger(day) || day < 0 || day > 60) return { ok: null, error: 'Each stage needs a day between 0 and 60.' };
    const note = kind === 'email' ? text((s as { note?: unknown })?.note, MAX_STAGE_NOTE) : '';
    const example = kind === 'email' ? text((s as { example?: unknown })?.example, MAX_STAGE_EXAMPLE) : '';
    plan.push({ kind, day, ...(note ? { note } : {}), ...(example ? { example } : {}) });
  }
  if (plan[0].kind !== 'email' || plan[0].day !== 0) return { ok: null, error: 'The first stage is the introduction email, on day 0.' };
  for (let i = 1; i < plan.length; i++) if (plan[i].day < plan[i - 1].day) return { ok: null, error: 'Stages must be in date order.' };
  const emailDays = plan.filter((p) => p.kind === 'email').map((p) => p.day);
  if (new Set(emailDays).size !== emailDays.length) return { ok: null, error: 'Two emails cannot go on the same day.' };

  const list = Array.isArray(b.contacts) ? b.contacts : [];
  if (list.length === 0) return { ok: null, error: 'Pick at least one contact.' };
  if (list.length > MAX_CAMPAIGN_CONTACTS) return { ok: null, error: `A campaign holds at most ${MAX_CAMPAIGN_CONTACTS} contacts.` };
  const contacts: CampaignContact[] = [];
  const perCompany = new Map<string, number>();
  const seen = new Set<string>();
  for (const c of list) {
    const companySearchId = (c as { companySearchId?: unknown })?.companySearchId;
    const email = text((c as { contactEmail?: unknown })?.contactEmail, 254).toLowerCase();
    const contactName = text((c as { contactName?: unknown })?.contactName, 200);
    if (typeof companySearchId !== 'string' || !UUID.test(companySearchId)) return { ok: null, error: 'Each contact needs a company.' };
    if (!contactName) return { ok: null, error: 'Each contact needs a name.' };
    if (!isAddress(email)) return { ok: null, error: `${contactName} has no usable email address.` };
    if (seen.has(email)) return { ok: null, error: `${email} is in the list twice.` };
    seen.add(email);
    const n = (perCompany.get(companySearchId) || 0) + 1;
    if (n > MAX_PER_COMPANY) return { ok: null, error: `At most ${MAX_PER_COMPANY} contacts at one company.` };
    perCompany.set(companySearchId, n);
    contacts.push({ companySearchId, contactName, contactEmail: email, contactRole: text((c as { contactRole?: unknown })?.contactRole, 120) || null });
  }
  return { ok: { name, angle: text(b.angle, 1500), plan, contacts, autoAfterFirst: b.autoAfterFirst !== false, writeAlike: b.writeAlike === true }, error: null };
}

/** The stages as plan template steps (labels and purposes for the drafter), emails numbered first, second and last. */
export function planTemplateFrom(plan: CampaignStage[]): PlanTemplateStep[] {
  const emails = plan.filter((p) => p.kind === 'email').length;
  let n = 0;
  return plan.map((p) => {
    if (p.kind === 'call') return { day: p.day, kind: 'call' as const, label: p.day <= 3 ? 'First call, after the email' : 'Call again', purpose: 'A short call that refers to the emails already sent. Log the outcome when you have made it.' };
    n++;
    const purpose = n === 1 ? 'first' : n === emails && emails > 2 ? 'last' : 'second';
    return { day: p.day, kind: 'email' as const, label: n === 1 ? 'First email, an introduction' : purpose === 'last' ? 'Last email, the door left open' : 'Second email, tied to something real', purpose };
  });
}

/**
 * The notes written onto one email step: the campaign's overall brief, what this
 * particular email is about, an example email to base it on, and (when the
 * campaign is written all alike) the first contact's email to follow. The writer
 * treats notes as instructions to carry out (prompt.ts).
 */
export function stepNotes(angle: string, stage: CampaignStage | undefined, template?: { subject: string; body: string } | null): string | null {
  const parts: string[] = [];
  if (angle.trim()) parts.push(`The campaign is about: ${angle.trim()}`);
  if (stage?.note) parts.push(`This email should be about: ${stage.note}`);
  if (stage?.example) parts.push(`Base this email on the example below: follow its structure, tone and wording where it fits, and change whatever has to differ for this company and this person.\n--- example ---\n${stage.example}\n--- end of example ---`);
  if (template) parts.push(`Write this email as a close match to the one below, which was written for another contact in the same campaign: keep its structure and wording, and change only what has to differ for this person and this company (the greeting, the company's name, and one detail that is true of this company).\n--- model email ---\nSubject: ${template.subject}\n\n${template.body}\n--- end of model email ---`);
  if (parts.length === 0) return null;
  // The campaign adds to Craig's voice and the usual rules for these emails (the opener, the numbers, the Talent Partner approach when a talent role is open); it never replaces them.
  parts.push("These notes sit on top of the usual voice and rules for these emails: keep them, and use the notes to decide what this email says.");
  let out = parts.join('\n\n');
  if (out.length > MAX_NOTES_TOTAL) out = out.slice(0, MAX_NOTES_TOTAL - 1) + '…';
  return out;
}

/** The n-th email stage (0-based) of a plan, so a step can be matched to what its stage asked for. */
export function emailStageAt(plan: CampaignStage[], emailIndex: number): CampaignStage | undefined {
  return plan.filter((p) => p.kind === 'email')[emailIndex];
}

/** A campaign email nobody has read and approved is never sent by itself. An email outside a campaign is not held here. */
export function campaignHoldsEmail(campaignId: string | null | undefined, approvedAt: string | null | undefined): boolean {
  return !!campaignId && !approvedAt;
}

/**
 * Is a due email clean enough to go by itself? No flags, or a person edited it, or (in a campaign)
 * a person approved it: they saw the flags, so an approved email goes even if its checks flagged something.
 */
export function emailIsClean(flags: string[] | null | undefined, editedAt: string | null | undefined, approvedAt: string | null | undefined): boolean {
  return !(flags || []).length || !!editedAt || !!approvedAt;
}
