// Assembles the copy input for a company and persona from the stored
// analysis and the database, picks the contact for the persona, decides
// which personas apply, and stores the generated copy.

import { mergedContactsFor } from '../contacts/edits.ts';
import { classifyRole, type RoleKey } from '../contacts/resolve.ts';
import type { Fact } from '../facts/types.ts';
import type { Signal } from '../signals/compute.ts';
import { ROLE_FAMILY_LABELS, type RoleFamily, roleFamily } from '../vacancies/role-family.ts';
import type { PersonaCopy } from './checks.ts';
import type { GenerateResult } from './generate.ts';
import { type CopyCompany, type CopyContact, type CopyInput, type CopyRecordLine, type CopyRoleGroup, type Persona, PERSONAS } from './prompt.ts';
import { consultantFromTag } from './reviews.ts';
import { logAiUsage } from './usage.ts';

// deno-lint-ignore no-explicit-any
type Supabase = any;

export interface CompanyRow {
  id: string;
  company_name: string;
  company_number: string | null;
  // deno-lint-ignore no-explicit-any
  analysis_result: any;
  evidence_fingerprint?: string | null;
}

export const COPY_MAX_AGE_DAYS = 30;

/** Which taxonomy keys each persona is written to, best first (docs/PORT-CONTRACTS.md, "Copy"). */
export const PERSONA_ROLE_KEYS: Record<Persona, RoleKey[]> = {
  founder: ['founder'],
  coo: ['coo', 'exec'],
  people: ['people', 'talent'],
  cto: ['cto'],
  investor: ['investor'],
};

/** What applicablePersonas needs to know: an investor fact or an investor contact switches the investor persona on. */
export interface PersonaContext {
  facts: Array<Pick<Fact, 'kind'>>;
  contacts: Array<Pick<CopyContact, 'role'>>;
}

/** Founder, COO, Head of People and CTO always; the investor talent partner only when the input names an investor. */
export function applicablePersonas(ctx: PersonaContext): Persona[] {
  const hasInvestor = ctx.facts.some((f) => f.kind === 'investor') || ctx.contacts.some((c) => classifyRole(c.role || '')?.key === 'investor');
  return PERSONAS.filter((p) => p !== 'investor' || hasInvestor);
}

function confidenceRank(c: string | undefined): number {
  return c === 'consultant_provided' ? 0 : c === 'found' ? 1 : c === 'role_only' ? 2 : c === 'pattern_guess' ? 3 : 4;
}

/** The named contact for a persona: best-ranked role match, real addresses first, never a reported one. */
export function contactForPersona(persona: Persona, contacts: CopyContact[]): CopyContact | null {
  const keys = PERSONA_ROLE_KEYS[persona];
  const candidates = contacts
    .filter((c) => c.name && !c.feedback)
    .map((c) => ({ c, cls: classifyRole(c.role || '') }))
    .filter((x) => x.cls && keys.includes(x.cls.key))
    .sort((a, b) => keys.indexOf(a.cls!.key) - keys.indexOf(b.cls!.key) || confidenceRank(a.c.confidence) - confidenceRank(b.c.confidence));
  return candidates[0]?.c ?? null;
}

/** The order the families are listed in: the direct lead first, then leadership, engineering, and the rest by count. */
const FAMILY_ORDER: RoleFamily[] = ['people_talent', 'leadership', 'engineering', 'product_design', 'go_to_market', 'operations', 'other'];

/** Open roles grouped by family with counts; the people-and-talent family first, then by count, then the fixed order. */
export function groupRolesByFamily(roles: Array<{ title: string; department?: string | null }>): CopyRoleGroup[] {
  const groups = new Map<RoleFamily, string[]>();
  for (const r of roles) {
    const title = (r.title || '').trim();
    if (!title) continue;
    const fam = roleFamily(title, r.department ?? null);
    groups.set(fam, [...(groups.get(fam) || []), title]);
  }
  return Array.from(groups.entries())
    .map(([family, titles]) => ({ family, label: ROLE_FAMILY_LABELS[family], count: titles.length, titles }))
    .sort((a, b) => {
      if (a.family === 'people_talent') return -1;
      if (b.family === 'people_talent') return 1;
      return (b.count - a.count) || (FAMILY_ORDER.indexOf(a.family as RoleFamily) - FAMILY_ORDER.indexOf(b.family as RoleFamily));
    });
}

/** The register line from a stored companyRecord (the CompanyRecord shape in docs/PORT-CONTRACTS.md); `sector` is the label for its SIC codes when the caller has one. */
export function recordLineFrom(rec: Record<string, unknown> | null | undefined, fallbackNumber: string | null, sector: string | null = null): CopyRecordLine | null {
  if (!rec || typeof rec !== 'object') return fallbackNumber ? { companyNumber: fallbackNumber, status: null, incorporationDate: null, locality: null, sector } : null;
  const office = (rec.registeredOffice && typeof rec.registeredOffice === 'object' ? rec.registeredOffice : null) as { locality?: string | null; region?: string | null } | null;
  return {
    companyNumber: (rec.companyNumber as string) || fallbackNumber || null,
    status: (rec.status as string) || null,
    incorporationDate: (rec.incorporationDate as string) || null,
    locality: office?.locality || office?.region || null,
    sector: (rec.sector as string) || sector || null,
  };
}

/** The sector label for a record's SIC codes, from the Companies House module (docs/PORT-CONTRACTS.md, sectorFromSic); null when the module is not there. */
async function sectorFor(rec: Record<string, unknown> | null | undefined): Promise<string | null> {
  const codes = Array.isArray(rec?.sicCodes) ? (rec!.sicCodes as string[]) : [];
  if (!codes.length) return null;
  try {
    const m = await import('../companies-house.ts');
    return m.sectorFromSic(codes) ?? null;
  } catch {
    return null;
  }
}

export interface CopyContext {
  company: CopyCompany;
  contacts: CopyContact[];
  signals: Signal[];
  facts: Fact[];
  openRoles: CopyRoleGroup[];
  consultant: CopyInput['consultant'];
  fingerprint: string | null;
}

/** Everything the writer may use, from the stored analysis plus the database. */
export async function loadCopyContext(supabase: Supabase, row: CompanyRow): Promise<CopyContext> {
  const ar = row.analysis_result || {};
  const rec = ar.companyRecord || null;
  const company: CopyCompany = {
    name: rec?.name || row.company_name,
    record: recordLineFrom(rec, row.company_number, await sectorFor(rec)),
    stage: ar.stage && typeof ar.stage === 'object' ? ar.stage : null,
    latestRaise: ar.latestRaise && typeof ar.latestRaise === 'object' ? ar.latestRaise : null,
  };
  // The stored contacts with the consultants' edits laid over them, so the writer names the corrected person.
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
  const openRoles = groupRolesByFamily(await loadOpenRoles(supabase, row));
  return { company, contacts, signals, facts, openRoles, consultant: consultantFromTag(ar.consultant), fingerprint: row.evidence_fingerprint ?? ar.evidenceFingerprint ?? null };
}

/** The open roles from the vacancies table (fresh daily from the ATS feeds), else the stored analysis's list. */
async function loadOpenRoles(supabase: Supabase, row: CompanyRow): Promise<Array<{ title: string; department: string | null }>> {
  try {
    const { data, error } = await supabase.from('vacancies').select('title, raw').eq('company_search_id', row.id).eq('status', 'open').limit(300);
    if (!error && Array.isArray(data) && data.length) {
      return data.map((v: { title: string; raw: Record<string, unknown> | null }) => ({ title: String(v.title || ''), department: (v.raw?.department as string) || null })).filter((v: { title: string }) => v.title);
    }
  } catch (e) {
    console.warn('vacancies read failed for copy; using the stored list:', e instanceof Error ? e.message : e);
  }
  const ar = row.analysis_result || {};
  return (Array.isArray(ar.recruitmentInsights?.currentVacancies) ? ar.recruitmentInsights.currentVacancies : [])
    .map((v: Record<string, unknown>) => ({ title: String(v.title || ''), department: (v.department as string) || null }))
    .filter((v: { title: string }) => v.title);
}

export function buildCopyInput(ctx: CopyContext, persona: Persona, today: Date): CopyInput {
  const contact = contactForPersona(persona, ctx.contacts);
  return { persona, company: ctx.company, contact, otherContacts: ctx.contacts.filter((c) => c !== contact), signals: ctx.signals, facts: ctx.facts, openRoles: ctx.openRoles, consultant: ctx.consultant, today };
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

/** The legacy fields the old frontend reads: the founder opener plus questions, and the email body. */
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
  const legacy = persona === 'founder' ? legacyScripts(result.copy) : null;
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
