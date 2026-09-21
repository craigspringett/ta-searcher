// Drafting the follow-up emails with Claude (Follow-ups slice 2): the
// model call, the sequence's context from the database, and the pass over
// a sequence's email steps. The prompt and the checks are in prompt.ts.
// Same model as the scripts (COPY_MODEL); one call per draft, a second only
// when the checks fail; every call is logged to ai_usage.
//
// Drafts are written when the sequence starts (all three) and again on the
// day a step falls due when something changed at the company: the context
// key (open vacancies, active facts, outcomes) differs from the one the
// draft was written from.

import Anthropic from 'npm:@anthropic-ai/sdk@0.124.0';
import { loadCopyContext } from '../copy/assemble.ts';
import { COPY_MODEL } from '../copy/generate.ts';
import { loadValueProposition } from '../copy/prompt.ts';
import { logAiUsage, type UsageRecord } from '../copy/usage.ts';
import { type ApprovedScript, buildFollowUpInput, buildFollowUpSystemPrompt, buildCompanyBlock, buildStepMessage, type DraftOutcome, type DraftVacancy, draftContextKey, FOLLOW_UP_SCHEMA, type FollowUpDraft, followUpDraftFlags, type FollowUpInput, personaForRole, type SequenceContext, type SequenceRow, type StepRow, stripSignature } from './prompt.ts';

export * from './prompt.ts';

// deno-lint-ignore no-explicit-any
type Supabase = any;

export class FollowUpDraftError extends Error {
  retryable: boolean;
  constructor(msg: string, retryable = false) { super(msg); this.name = 'FollowUpDraftError'; this.retryable = retryable; }
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (client) return client;
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new FollowUpDraftError('ANTHROPIC_API_KEY not configured');
  client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  return client;
}

const BETAS = ['server-side-fallback-2026-07-01'];

async function callModel(system: Anthropic.Beta.BetaTextBlockParam[], messages: Anthropic.Beta.BetaMessageParam[], companySearchId: string | null, purpose: UsageRecord['purpose']): Promise<{ draft: FollowUpDraft; raw: string; usage: UsageRecord }> {
  const started = Date.now();
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await anthropic().beta.messages.create({
      model: COPY_MODEL,
      max_tokens: 2000,
      betas: BETAS,
      fallbacks: 'default',
      system,
      messages,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: FOLLOW_UP_SCHEMA } },
    });
  } catch (error) {
    const durationMs = Date.now() - started;
    const failed = (msg: string): UsageRecord => ({ provider: 'anthropic', model: COPY_MODEL, purpose, companySearchId, inputTokens: 0, outputTokens: 0, durationMs, ok: false, error: msg });
    if (error instanceof Anthropic.RateLimitError) throw Object.assign(new FollowUpDraftError(`Claude rate limit: ${error.message}`, true), { usage: failed(error.message) });
    if (error instanceof Anthropic.APIError) throw Object.assign(new FollowUpDraftError(`Claude API error ${error.status}: ${error.message}`, (error.status ?? 500) >= 500), { usage: failed(error.message) });
    throw error;
  }
  const usage: UsageRecord = {
    provider: 'anthropic',
    model: response.model || COPY_MODEL,
    purpose,
    companySearchId,
    inputTokens: response.usage.input_tokens,
    cachedInputTokens: response.usage.cache_read_input_tokens || 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens || 0,
    outputTokens: response.usage.output_tokens,
    durationMs: Date.now() - started,
    ok: true,
    details: { stopReason: response.stop_reason, kind: 'follow_up' },
  };
  if (response.stop_reason === 'refusal') {
    usage.ok = false; usage.error = `refusal: ${response.stop_details?.category ?? 'unknown'}`;
    throw Object.assign(new FollowUpDraftError(`Claude declined the request (${response.stop_details?.category ?? 'refusal'})`), { usage });
  }
  if (response.stop_reason === 'max_tokens') {
    usage.ok = false; usage.error = 'max_tokens';
    throw Object.assign(new FollowUpDraftError('Claude output was cut off (max_tokens)', true), { usage });
  }
  const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('');
  let draft: FollowUpDraft;
  try {
    const obj = JSON.parse(text);
    if (!obj?.subject || !obj?.body) throw new Error('missing subject or body');
    draft = { subject: String(obj.subject), body: String(obj.body), hook: String(obj.hook || '') };
  } catch (e) {
    usage.ok = false; usage.error = 'invalid json';
    throw Object.assign(new FollowUpDraftError(`Claude output was not valid draft JSON: ${e instanceof Error ? e.message : e}`, true), { usage });
  }
  return { draft, raw: text, usage };
}

export interface DraftResult {
  draft: FollowUpDraft;
  flags: string[];
  firstDraftFlags: string[];
  model: string;
  attempts: number;
  usage: UsageRecord[];
}

const CORRECTION = 'The previous draft failed these checks. Rewrite the whole email so that every check passes, keeping what was good:';

/** One draft, checked, rewritten once on a failure. Usage for every call comes back so the caller can log it even when the second attempt fails. */
export async function generateFollowUpDraft(input: FollowUpInput, companySearchId: string | null): Promise<DraftResult> {
  const vp = await loadValueProposition();
  const rules = buildFollowUpSystemPrompt(vp.text);
  const companyBlock = buildCompanyBlock(input);
  const stepText = buildStepMessage(input);
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: rules, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: companyBlock, cache_control: { type: 'ephemeral' } },
  ];
  const inputText = `${rules}\n${companyBlock}\n${stepText}`;
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: stepText }];
  const usage: UsageRecord[] = [];
  const tidy = (d: FollowUpDraft): FollowUpDraft => ({ ...d, subject: d.subject.replace(/[\r\n]+/g, ' ').trim(), body: stripSignature(d.body, input.consultant), hook: d.hook.trim() });
  let first: Awaited<ReturnType<typeof callModel>>;
  try {
    first = await callModel(system, messages, companySearchId, 'follow_up');
  } catch (e) {
    if ((e as { usage?: UsageRecord }).usage) usage.push((e as { usage: UsageRecord }).usage);
    throw Object.assign(e as Error, { usage });
  }
  usage.push(first.usage);
  const firstDraft = tidy(first.draft);
  const flags = followUpDraftFlags(firstDraft, input, inputText);
  if (flags.length === 0) return { draft: firstDraft, flags: [], firstDraftFlags: [], model: first.usage.model, attempts: 1, usage };
  console.log(`Follow-up draft step ${input.step.stepNo}: ${flags.length} flag(s) on the first draft, rewriting once:`, flags.join('; '));
  try {
    const second = await callModel(system, [...messages, { role: 'assistant', content: first.raw }, { role: 'user', content: `${CORRECTION}\n${flags.map((f) => `- ${f}`).join('\n')}` }], companySearchId, 'follow_up_retry');
    second.usage.details = { ...(second.usage.details || {}), firstDraftFlags: flags };
    usage.push(second.usage);
    const secondDraft = tidy(second.draft);
    const secondFlags = followUpDraftFlags(secondDraft, input, inputText);
    if (secondFlags.length <= flags.length) return { draft: secondDraft, flags: secondFlags, firstDraftFlags: flags, model: second.usage.model, attempts: 2, usage };
    return { draft: firstDraft, flags, firstDraftFlags: flags, model: first.usage.model, attempts: 2, usage };
  } catch (e) {
    if ((e as { usage?: UsageRecord }).usage) usage.push((e as { usage: UsageRecord }).usage);
    console.warn('Follow-up rewrite failed; keeping the first draft with its flags:', e instanceof Error ? e.message : e);
    return { draft: firstDraft, flags, firstDraftFlags: flags, model: first.usage.model, attempts: 2, usage };
  }
}

// ---------------------------------------------------------------------------
// Loading a sequence's context from the database.

export async function loadSequenceContext(supabase: Supabase, seq: SequenceRow): Promise<SequenceContext> {
  const { data: company, error } = await supabase.from('company_searches').select('id, company_name, company_number, analysis_result, evidence_fingerprint').eq('id', seq.company_search_id).maybeSingle();
  if (error || !company) throw new FollowUpDraftError(`company not found: ${error?.message || seq.company_search_id}`);
  const ctx = await loadCopyContext(supabase, company);
  const persona = personaForRole(seq.contact_role);
  const [{ data: profile }, { data: consultantRow }, { data: vacancyRow }, { data: copyRow }, { data: outcomeRows }, { data: openVacancies }, { data: factRows }] = await Promise.all([
    seq.created_by ? supabase.from('profiles').select('display_name, email').eq('id', seq.created_by).maybeSingle() : Promise.resolve({ data: null }),
    seq.consultant_id ? supabase.from('consultants').select('name').eq('id', seq.consultant_id).maybeSingle() : Promise.resolve({ data: null }),
    seq.vacancy_id ? supabase.from('vacancies').select('title, closing_date, url, source, first_seen').eq('id', seq.vacancy_id).maybeSingle() : Promise.resolve({ data: null }),
    persona ? supabase.from('company_copy').select('copy').eq('company_search_id', seq.company_search_id).eq('persona', persona).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('outcomes').select('kind, created_at, note, contact_name').eq('company_search_id', seq.company_search_id).order('created_at', { ascending: false }).limit(12),
    supabase.from('vacancies').select('vacancy_key, title, closing_date').eq('company_search_id', seq.company_search_id).eq('status', 'open'),
    supabase.from('company_facts').select('statement_key').eq('company_search_id', seq.company_search_id).eq('active', true),
  ]);
  const displayName = (profile?.display_name || consultantRow?.name || (profile?.email ? String(profile.email).split('@')[0] : '') || 'Big Fish Recruitment').trim();
  const consultant = { displayName, firstName: displayName.split(/\s+/)[0] || displayName };
  const vacancy: DraftVacancy | null = vacancyRow ? { title: vacancyRow.title, closingDate: vacancyRow.closing_date, url: vacancyRow.url, source: vacancyRow.source, firstSeen: vacancyRow.first_seen } : null;
  const copy = copyRow?.copy as { call?: { opener?: string }; email?: { subject?: string; body?: string } } | null;
  const approvedScript: ApprovedScript | null = copy ? { opener: copy.call?.opener || null, emailSubject: copy.email?.subject || null, emailBody: copy.email?.body || null } : null;
  const outcomes = (outcomeRows || []) as DraftOutcome[];
  const contextKey = draftContextKey({ vacancies: (openVacancies || []) as Array<{ vacancy_key: string; title: string; closing_date: string | null }>, factKeys: ((factRows || []) as Array<{ statement_key: string }>).map((f) => f.statement_key), outcomeCount: outcomes.length });
  return { ctx, persona, consultant, vacancy, approvedScript, outcomes, companyName: ctx.company.name, contextKey };
}

export interface DraftSequenceOptions {
  /** Only these steps (else every email step that is scheduled or due). */
  stepIds?: string[];
  /** Write again even when a draft exists and nothing changed. */
  force?: boolean;
  /** At most this many drafts in one go (the tick keeps it small). */
  limit?: number;
  /** Why, for the log: 'start', 'tick', 'redraft'. */
  reason?: string;
  now?: Date;
}

export interface DraftSequenceResult {
  sequenceId: string;
  drafted: Array<{ stepId: string; stepNo: number; attempts: number; flags: string[] }>;
  reused: Array<{ stepId: string; stepNo: number; reason: string }>;
  failed: Array<{ stepId: string; stepNo: number; error: string }>;
}

/**
 * Draft the email steps of a sequence that need it: no draft yet, or the
 * company context changed since the draft (or force). Sequential, so the
 * second and third calls read the cached company block. Every model call is
 * logged to ai_usage; a failure on one step does not stop the others.
 */
export async function draftSequenceSteps(supabase: Supabase, sequenceId: string, opts: DraftSequenceOptions = {}): Promise<DraftSequenceResult> {
  const now = opts.now || new Date();
  const result: DraftSequenceResult = { sequenceId, drafted: [], reused: [], failed: [] };
  const { data: seq, error } = await supabase.from('follow_up_sequences').select('id, company_search_id, consultant_id, created_by, contact_name, contact_email, contact_role, vacancy_id, status, started_at').eq('id', sequenceId).maybeSingle();
  if (error || !seq) throw new FollowUpDraftError(`sequence not found: ${error?.message || sequenceId}`);
  if (seq.status !== 'active') return result;
  const { data: stepRows, error: stepErr } = await supabase.from('follow_up_steps').select('*').eq('sequence_id', sequenceId).order('step_no');
  if (stepErr) throw new FollowUpDraftError(`steps: ${stepErr.message}`);
  const steps = (stepRows || []) as StepRow[];
  const candidates = steps.filter((s) => s.kind === 'email' && ['scheduled', 'due'].includes(s.status) && (!opts.stepIds || opts.stepIds.includes(s.id)));
  if (!candidates.length) return result;
  const sc = await loadSequenceContext(supabase, seq as SequenceRow);
  let budget = opts.limit ?? candidates.length;
  for (const step of candidates) {
    const needs = opts.force ? 'forced' : !step.body ? 'no draft yet' : step.draft_context_key !== sc.contextKey ? 'something changed at the company' : null;
    if (!needs) { result.reused.push({ stepId: step.id, stepNo: step.step_no, reason: 'nothing changed' }); continue; }
    if (budget <= 0) { result.reused.push({ stepId: step.id, stepNo: step.step_no, reason: 'left for the next pass' }); continue; }
    budget--;
    // Earlier steps as they are now (a draft written a moment ago counts).
    const input = buildFollowUpInput(sc, seq as SequenceRow, step, steps, now);
    try {
      const gen = await generateFollowUpDraft(input, seq.company_search_id);
      for (const u of gen.usage) await logAiUsage(supabase, { ...u, companySearchId: seq.company_search_id, details: { ...(u.details || {}), sequenceId, stepNo: step.step_no, reason: opts.reason || 'draft', attempts: gen.attempts } });
      const { error: upErr } = await supabase.from('follow_up_steps').update({
        subject: gen.draft.subject,
        body: gen.draft.body,
        hook: gen.draft.hook,
        draft_generated_at: now.toISOString(),
        draft_context_key: sc.contextKey,
        draft_flags: gen.flags,
      }).eq('id', step.id).in('status', ['scheduled', 'due']);
      if (upErr) throw new FollowUpDraftError(`could not store the draft: ${upErr.message}`);
      step.subject = gen.draft.subject; step.body = gen.draft.body; step.hook = gen.draft.hook;
      result.drafted.push({ stepId: step.id, stepNo: step.step_no, attempts: gen.attempts, flags: gen.flags });
      console.log(`Follow-up draft written: sequence ${sequenceId} step ${step.step_no} (${needs}), ${gen.attempts} attempt(s), flags: ${gen.flags.join('; ') || 'none'}`);
    } catch (e) {
      const usage = (e as { usage?: UsageRecord[] }).usage || [];
      for (const u of usage) await logAiUsage(supabase, { ...u, companySearchId: seq.company_search_id, details: { ...(u.details || {}), sequenceId, stepNo: step.step_no, reason: opts.reason || 'draft' } });
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Follow-up draft failed: sequence ${sequenceId} step ${step.step_no}:`, msg);
      result.failed.push({ stepId: step.id, stepNo: step.step_no, error: msg });
    }
  }
  return result;
}
