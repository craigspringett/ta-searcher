// Recompute a company's signals from what is already stored (its active
// facts, vacancy rows, the Companies House register and the contacts)
// without fetching the site or calling a model. Used by refresh-scores when
// the signal rules change, so every company's signals and score follow the
// new rules the same day rather than after its next analysis.

import type { Fact } from '../facts/types.ts';
import { computeSignals, type Signal } from './compute.ts';
import { contactsForSignals, loadFundingNewsFacts, loadRegisterForSignals, loadVacanciesForSignals } from './load.ts';

// deno-lint-ignore no-explicit-any
type Supabase = any;

export interface RecomputeResult {
  companySearchId: string;
  signals: Signal[];
  facts: number;
}

/** Recompute and store the signals for one company. */
export async function recomputeSignalsForCompany(supabase: Supabase, companySearchId: string, today: Date): Promise<RecomputeResult> {
  const { data: row, error } = await supabase.from('company_searches').select('id, company_number, analysis_result').eq('id', companySearchId).maybeSingle();
  if (error) throw new Error(`company_searches read failed: ${error.message}`);
  if (!row) throw new Error(`company ${companySearchId} not found`);
  // deno-lint-ignore no-explicit-any
  const ar = (row.analysis_result || {}) as Record<string, any>;
  const record = (ar.companyRecord || {}) as Record<string, unknown>;
  const companyNumber: string | null = row.company_number || (record.companyNumber as string) || null;

  const { data: factRows, error: fErr } = await supabase.from('company_facts').select('statement_key, kind, statement, quote, source_url, date_hint').eq('company_search_id', row.id).eq('active', true).order('last_seen', { ascending: false }).limit(120);
  if (fErr) throw new Error(`company_facts read failed: ${fErr.message}`);
  // deno-lint-ignore no-explicit-any
  const facts: Fact[] = (factRows || []).map((f: any, i: number) => ({ id: `f${i + 1}`, kind: f.kind, statement: f.statement, quote: f.quote || '', source_url: f.source_url || '', date_hint: f.date_hint ?? null, statement_key: f.statement_key }));

  // Matched funding news joins the facts (slice 2); it is read, never stored as a fact.
  facts.push(...await loadFundingNewsFacts(supabase, row.id, today));

  const vacancyRows = await loadVacanciesForSignals(supabase, row.id);
  const register = await loadRegisterForSignals(supabase, companyNumber);
  const contacts = contactsForSignals(Array.isArray(ar.decisionMakers) ? ar.decisionMakers : []);

  const signals = computeSignals({ today, facts, openVacancies: vacancyRows.open, closedVacancies: vacancyRows.closed, register, contacts });
  const { error: dErr } = await supabase.from('company_signals').delete().eq('company_search_id', row.id);
  if (dErr) throw new Error(`company_signals delete failed: ${dErr.message}`);
  if (signals.length) {
    const computedAt = new Date().toISOString();
    const { error: iErr } = await supabase.from('company_signals').insert(signals.map((s) => ({ company_search_id: row.id, code: s.code, label: s.label, strength: s.strength, evidence: s.evidence, explanation: s.explanation, computed_at: computedAt })));
    if (iErr) throw new Error(`company_signals insert failed: ${iErr.message}`);
  }
  return { companySearchId: row.id, signals, facts: facts.length };
}

/** Recompute several companies, a few at a time. Returns the failures beside the results. */
export async function recomputeSignals(supabase: Supabase, companyIds: string[], today: Date, concurrency = 4): Promise<{ results: RecomputeResult[]; failures: Array<{ companySearchId: string; error: string }> }> {
  const results: RecomputeResult[] = [];
  const failures: Array<{ companySearchId: string; error: string }> = [];
  let next = 0;
  const worker = async () => {
    while (next < companyIds.length) {
      const id = companyIds[next++];
      try { results.push(await recomputeSignalsForCompany(supabase, id, today)); }
      catch (e) { failures.push({ companySearchId: id, error: e instanceof Error ? e.message : String(e) }); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, companyIds.length) }, worker));
  return { results, failures };
}
