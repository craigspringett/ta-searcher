// Assembles the copy input for a company and persona from the stored
// analysis and the database, picks the contact for the persona, decides
// which personas apply, and stores the generated copy.

import { mergedContactsFor } from '../contacts/edits.ts';
import { classifyRole } from '../contacts/resolve.ts';
import type { Fact } from '../facts/types.ts';
import type { Signal } from '../signals/compute.ts';
import { loadSpendForSignals } from '../signals/load.ts';
import type { PersonaCopy } from './checks.ts';
import type { GenerateResult } from './generate.ts';
import { type CopyContact, type CopyInput, type CopyPupilPremium, type Persona, PERSONAS } from './prompt.ts';
import { consultantFromTag } from './reviews.ts';
import { logAiUsage } from './usage.ts';

// deno-lint-ignore no-explicit-any
type Supabase = any;

export interface CompanyRow {
  id: string;
  company_name: string;
  urn: string | null;
  // deno-lint-ignore no-explicit-any
  analysis_result: any;
  evidence_fingerprint?: string | null;
}

export const COPY_MAX_AGE_DAYS = 30;

const PERSONA_ROLE_KEYS: Record<Persona, string[]> = {
  headteacher: ['head'],
  sbm: ['sbm'],
  senco: ['senco'],
  trust_hr: ['hr', 'trust_exec'],
};

export function applicablePersonas(trustName: string | null | undefined): Persona[] {
  return PERSONAS.filter((p) => p !== 'trust_hr' || !!trustName);
}

function confidenceRank(c: string | undefined): number {
  return c === 'consultant_provided' ? 0 : c === 'found' ? 1 : c === 'role_only' ? 2 : c === 'pattern_guess' ? 3 : 4;
}

/** The named contact for a persona: best-ranked role match, real addresses first, never a reported one. */
export function contactForPersona(persona: Persona, contacts: CopyContact[]): CopyContact | null {
  const keys = PERSONA_ROLE_KEYS[persona];
  const candidates = contacts
    .filter((c) => c.name && !(c as { feedback?: string }).feedback)
    .map((c) => ({ c, cls: classifyRole(c.role || '') }))
    .filter((x) => x.cls && keys.includes(x.cls.key))
    .sort((a, b) => keys.indexOf(a.cls!.key) - keys.indexOf(b.cls!.key) || confidenceRank(a.c.confidence) - confidenceRank(b.c.confidence));
  return candidates[0]?.c ?? null;
}

export interface CopyContext {
  company: CopyInput['company'];
  contacts: CopyContact[];
  signals: Signal[];
  facts: Fact[];
  vacancies: CopyInput['vacancies'];
  spend: CopyInput['spend'];
  /** The "TAs a week" figure when the company stated it (pupil_premium_estimates, confidence high); null otherwise. */
  pupilPremium?: CopyPupilPremium | null;
  consultant: CopyInput['consultant'];
  fingerprint: string | null;
}

/** The pupil premium "TAs a week" figure for the writer: only when the company itself stated hours, FTE or a number of staff. */
export async function loadCopyPupilPremium(supabase: Supabase, companyId: string): Promise<CopyPupilPremium | null> {
  try {
    const { data } = await supabase.from('pupil_premium_estimates').select('tas_per_week, confidence, basis, academic_year').eq('company_search_id', companyId).maybeSingle();
    if (!data || data.confidence !== 'high' || data.tas_per_week == null) return null;
    return { tasPerWeek: Number(data.tas_per_week), basis: data.basis, academicYear: data.academic_year };
  } catch {
    return null;
  }
}

/** Everything the writer may use, from the stored analysis plus the spend tables. */
export async function loadCopyContext(supabase: Supabase, row: CompanyRow): Promise<CopyContext> {
  const ar = row.analysis_result || {};
  const rec = ar.companyRecord || {};
  const company = {
    name: rec.name || row.company_name,
    phase: rec.phase && rec.phase !== 'unknown' ? rec.phase : null,
    laName: rec.laName || ar.governmentSpendData?.laName || null,
    trustName: rec.trustName || null,
  };
  // The stored contacts with the consultants' edits laid over them (Contact edits, 18 September 2026), so the writer names the corrected person.
  const merged = await mergedContactsFor<Record<string, unknown>>(supabase, row.id, Array.isArray(ar.decisionMakers) ? ar.decisionMakers : []);
  const contacts: CopyContact[] = merged.filter((d) => d.confidence).map((d) => ({ name: String(d.name || ''), role: String(d.role || ''), email: d.email ? String(d.email) : undefined, confidence: d.confidence ? String(d.confidence) : undefined, feedback: d.feedback as string | undefined }));
  let signals: Signal[] = Array.isArray(ar.signals) ? ar.signals : [];
  let facts: Fact[] = Array.isArray(ar.facts) ? ar.facts : [];
  if (!signals.length && !facts.length) {
    const [{ data: s }, { data: f }] = await Promise.all([
      supabase.from('company_signals').select('code, label, strength, evidence, explanation').eq('company_search_id', row.id),
      supabase.from('company_facts').select('id, kind, statement, quote, source_url, date_hint, statement_key').eq('company_search_id', row.id).eq('active', true),
    ]);
    signals = (s || []) as Signal[];
    facts = ((f || []) as Array<Fact & { id: string }>).map((x, i) => ({ ...x, id: `f${i + 1}` }));
  }
  const vacancies = (Array.isArray(ar.recruitmentInsights?.currentVacancies) ? ar.recruitmentInsights.currentVacancies : [])
    .map((v: Record<string, unknown>) => ({ title: String(v.title || ''), source: String(v.sourceLabel || v.source || 'advert'), firstSeen: (v.firstSeen as string) || null, closingDate: (v.closingDate as string) || (v.endDate as string) || null, url: (v.url as string) || null }))
    .filter((v: { title: string }) => v.title);
  const urn = rec.resolvedUrn || row.urn || null;
  const spendLoaded = await loadSpendForSignals(supabase, urn, company.laName, company.phase);
  const spend = spendLoaded.latest
    ? { latestYear: spendLoaded.latest.fiscalYear, agencyAndSupply: spendLoaded.latest.agencyAndSupply, previousYear: spendLoaded.previous?.fiscalYear ?? null, previousAgencyAndSupply: spendLoaded.previous?.agencyAndSupply ?? null, comparison: spendLoaded.comparison }
    : null;
  const pupilPremium = await loadCopyPupilPremium(supabase, row.id);
  return { company, contacts, signals, facts, vacancies, spend, pupilPremium, consultant: consultantFromTag(ar.consultant), fingerprint: row.evidence_fingerprint ?? ar.evidenceFingerprint ?? null };
}

export function buildCopyInput(ctx: CopyContext, persona: Persona, today: Date): CopyInput {
  return { persona, company: ctx.company, contact: contactForPersona(persona, ctx.contacts), contacts: ctx.contacts, signals: ctx.signals, facts: ctx.facts, vacancies: ctx.vacancies, spend: ctx.spend, pupilPremium: ctx.pupilPremium ?? null, consultant: ctx.consultant, today };
}

export interface StoredCopy {
  persona: Persona;
  copy: PersonaCopy;
  contact: CopyContact | null;
  evidence_fingerprint: string | null;
  quality_flags: string[];
  model: string;
  trigger: string;
  generated_at: string;
}

/** The legacy fields the old frontend reads: headteacher opener plus questions, and the email body. */
export function legacyScripts(copy: PersonaCopy): { coldCallScript: string; warmEmailScript: string } {
  const c = copy.call;
  const coldCallScript = [c.opener, '', 'Questions to ask:', ...c.discovery_questions.map((q) => `- ${q}`), '', 'If they say...', ...c.objections.map((o) => `- "${o.objection}" ${o.response}`), '', `Close: ${c.close}`, '', `Voicemail: ${c.voicemail}`].join('\n');
  const warmEmailScript = `Subject: ${copy.email.subject}\n\n${copy.email.body}`;
  return { coldCallScript, warmEmailScript };
}

/** Upsert company_copy, write analysis_result.copy[persona] atomically, log usage. */
export async function storeCopy(supabase: Supabase, companyId: string, persona: Persona, result: GenerateResult, contact: CopyContact | null, fingerprint: string | null, trigger: string): Promise<StoredCopy> {
  const generatedAt = new Date().toISOString();
  const stored: StoredCopy = { persona, copy: result.copy, contact, evidence_fingerprint: fingerprint, quality_flags: result.qualityFlags, model: result.model, trigger, generated_at: generatedAt };
  const { error } = await supabase.from('company_copy').upsert({
    company_search_id: companyId,
    persona,
    copy: result.copy,
    contact,
    evidence_fingerprint: fingerprint,
    quality_flags: result.qualityFlags,
    model: result.model,
    trigger,
    generated_at: generatedAt,
  }, { onConflict: 'company_search_id,persona' });
  if (error) console.error('company_copy upsert failed:', error.message);
  const legacy = persona === 'headteacher' ? legacyScripts(result.copy) : null;
  const { error: e2 } = await supabase.rpc('set_company_copy', { p_company_id: companyId, p_persona: persona, p_copy: stored, p_cold_call: legacy?.coldCallScript ?? null, p_warm_email: legacy?.warmEmailScript ?? null });
  if (e2) console.error('set_company_copy failed:', e2.message);
  for (const u of result.usage) await logAiUsage(supabase, { ...u, companySearchId: companyId });
  return stored;
}

/** Whether a stored persona copy needs regenerating under the fingerprint rule. */
export function copyIsStale(existing: { evidence_fingerprint?: string | null; generated_at?: string | null } | null | undefined, fingerprint: string | null, today: Date): { stale: boolean; reason: string } {
  if (!existing) return { stale: true, reason: 'no copy stored' };
  if (existing.evidence_fingerprint !== fingerprint) return { stale: true, reason: 'evidence changed' };
  const age = existing.generated_at ? (today.getTime() - new Date(existing.generated_at).getTime()) / 86400000 : Infinity;
  if (age > COPY_MAX_AGE_DAYS) return { stale: true, reason: `copy is ${Math.round(age)} days old` };
  return { stale: false, reason: 'evidence unchanged' };
}
