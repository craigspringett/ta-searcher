// Copy generation with Claude (docs/PHASE-3-BRIEF.md, deliverable 3).
//
// One call per company per persona. The stable system prompt (rules, persona
// notes, value proposition) carries a cache breakpoint so repeated calls pay
// for the company-specific part only. Output is structured JSON via
// output_config.format, then checked (checks.ts); on any flag the draft is
// sent back once with a correction message, and the surviving flags are
// stored with the copy.

import Anthropic from 'npm:@anthropic-ai/sdk@0.124.0';
import { allFlags, trimToThree, type PersonaCopy } from './checks.ts';
import { buildSystemPrompt, buildUserMessage, COPY_SCHEMA, CORRECTION_PREAMBLE, type CopyInput, loadValueProposition } from './prompt.ts';
import type { UsageRecord } from './usage.ts';

export const COPY_MODEL = Deno.env.get('COPY_MODEL') || 'claude-opus-5';
const BETAS = ['server-side-fallback-2026-07-01'];

export interface GenerateResult {
  copy: PersonaCopy;
  qualityFlags: string[];
  /** Flags on the first draft when a second was needed; for diagnosis. */
  firstDraftFlags: string[];
  model: string;
  attempts: number;
  usage: UsageRecord[];
  valuePropositionSource: 'file' | 'embedded';
  /** The user message, kept for the named-person check and for debugging. */
  inputText: string;
}

export class CopyGenerationError extends Error {
  retryable: boolean;
  constructor(msg: string, retryable = false) { super(msg); this.name = 'CopyGenerationError'; this.retryable = retryable; }
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (client) return client;
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new CopyGenerationError('ANTHROPIC_API_KEY not configured');
  client = new Anthropic({ apiKey, maxRetries: 2, timeout: 180_000 });
  return client;
}

function parseCopy(text: string): PersonaCopy {
  const obj = JSON.parse(text);
  if (!obj?.call || !obj?.email) throw new CopyGenerationError('Model output missing call or email');
  return obj as PersonaCopy;
}

async function callModel(system: string, messages: Anthropic.Beta.BetaMessageParam[], effort: 'medium' | 'high', companySearchId: string | null, purpose: UsageRecord['purpose']): Promise<{ copy: PersonaCopy; raw: string; usage: UsageRecord; model: string }> {
  const started = Date.now();
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await anthropic().beta.messages.create({
      model: COPY_MODEL,
      max_tokens: 8000,
      betas: BETAS,
      fallbacks: 'default',
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages,
      output_config: { effort, format: { type: 'json_schema', schema: COPY_SCHEMA } },
    });
  } catch (error) {
    const durationMs = Date.now() - started;
    if (error instanceof Anthropic.RateLimitError) throw Object.assign(new CopyGenerationError(`Claude rate limit: ${error.message}`, true), { usage: failedUsage(companySearchId, purpose, durationMs, error.message) });
    if (error instanceof Anthropic.APIError) throw Object.assign(new CopyGenerationError(`Claude API error ${error.status}: ${error.message}`, (error.status ?? 500) >= 500), { usage: failedUsage(companySearchId, purpose, durationMs, error.message) });
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
    details: { stopReason: response.stop_reason, effort },
  };
  if (response.stop_reason === 'refusal') {
    usage.ok = false;
    usage.error = `refusal: ${response.stop_details?.category ?? 'unknown'}`;
    throw Object.assign(new CopyGenerationError(`Claude declined the request (${response.stop_details?.category ?? 'refusal'})`), { usage });
  }
  if (response.stop_reason === 'max_tokens') {
    usage.ok = false;
    usage.error = 'max_tokens';
    throw Object.assign(new CopyGenerationError('Claude output was cut off (max_tokens)', true), { usage });
  }
  const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('');
  let copy: PersonaCopy;
  try {
    copy = trimToThree(parseCopy(text));
  } catch (e) {
    usage.ok = false;
    usage.error = 'invalid json';
    throw Object.assign(new CopyGenerationError(`Claude output was not valid copy JSON: ${e instanceof Error ? e.message : e}`, true), { usage });
  }
  return { copy, raw: text, usage, model: usage.model };
}

function failedUsage(companySearchId: string | null, purpose: UsageRecord['purpose'], durationMs: number, error: string): UsageRecord {
  return { provider: 'anthropic', model: COPY_MODEL, purpose, companySearchId, inputTokens: 0, outputTokens: 0, durationMs, ok: false, error };
}

/**
 * Generate one persona's copy, check it, and regenerate once with a
 * correction message when a check fails. Usage for every call is returned
 * so the caller can log it even when the second attempt fails.
 */
export async function generatePersonaCopy(input: CopyInput, companySearchId: string | null, opts: { effort?: 'medium' | 'high' } = {}): Promise<GenerateResult> {
  const vp = await loadValueProposition();
  const system = buildSystemPrompt(vp.text);
  const { text: userText } = buildUserMessage(input);
  const checkInput = { contactNames: input.contacts.map((c) => c.name).filter(Boolean), consultantName: input.consultant.fullName || input.consultant.firstName, consultantFirstName: input.consultant.firstName, inputText: userText + '\n' + system };
  const usage: UsageRecord[] = [];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: userText }];
  let first: Awaited<ReturnType<typeof callModel>>;
  try {
    first = await callModel(system, messages, opts.effort || 'medium', companySearchId, 'copy');
  } catch (e) {
    if ((e as { usage?: UsageRecord }).usage) usage.push((e as { usage: UsageRecord }).usage);
    throw Object.assign(e as Error, { usage });
  }
  usage.push(first.usage);
  let flags = allFlags(first.copy, checkInput);
  if (flags.length === 0) return { copy: first.copy, qualityFlags: [], firstDraftFlags: [], model: first.model, attempts: 1, usage, valuePropositionSource: vp.source, inputText: userText };

  console.log(`Copy for ${input.persona}: ${flags.length} flag(s) on first draft, regenerating once:`, flags.join('; '));
  const correction = `${CORRECTION_PREAMBLE}\n${flags.map((f) => `- ${f}`).join('\n')}`;
  const retryMessages: Anthropic.Beta.BetaMessageParam[] = [
    ...messages,
    { role: 'assistant', content: first.raw },
    { role: 'user', content: correction },
  ];
  try {
    const second = await callModel(system, retryMessages, opts.effort || 'medium', companySearchId, 'copy_retry');
    second.usage.details = { ...(second.usage.details || {}), firstDraftFlags: flags };
    usage.push(second.usage);
    const secondFlags = allFlags(second.copy, checkInput);
    // Keep the better of the two drafts.
    if (secondFlags.length <= flags.length) return { copy: second.copy, qualityFlags: secondFlags, firstDraftFlags: flags, model: second.model, attempts: 2, usage, valuePropositionSource: vp.source, inputText: userText };
    return { copy: first.copy, qualityFlags: flags, firstDraftFlags: flags, model: first.model, attempts: 2, usage, valuePropositionSource: vp.source, inputText: userText };
  } catch (e) {
    if ((e as { usage?: UsageRecord }).usage) usage.push((e as { usage: UsageRecord }).usage);
    console.warn('Copy regeneration failed; keeping the first draft with its flags:', e instanceof Error ? e.message : e);
    return { copy: first.copy, qualityFlags: flags, firstDraftFlags: flags, model: first.model, attempts: 2, usage, valuePropositionSource: vp.source, inputText: userText };
  }
}
