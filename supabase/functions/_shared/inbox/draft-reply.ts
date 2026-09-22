// A reply drafted in the consultant's tone (22 September 2026): one Claude
// call with the rules the outreach emails already follow, the company's
// context, what the consultant sent before, and the reply that came in.
// The consultant copies it into Outlook; nothing is sent from here.

import Anthropic from 'npm:@anthropic-ai/sdk@0.124.0';
import { BANNED_PHRASES, bannedPhraseHits, feeFigureViolations, wordCount } from '../copy/checks.ts';
import { COPY_MODEL } from '../copy/generate.ts';
import { loadValueProposition } from '../copy/prompt.ts';
import type { UsageRecord } from '../copy/usage.ts';

export interface ReplyDraftInput {
  companyName: string;
  companyLine: string;
  contactName: string | null;
  consultant: { displayName: string; firstName: string };
  /** The emails the consultant sent this contact, newest first, subject and body. */
  sentBefore: Array<{ subject: string | null; body: string | null; sentAt: string | null }>;
  reply: { subject: string | null; text: string; receivedAt: string };
  today: Date;
}

export interface ReplyDraft { subject: string; body: string; read: string }

export const REPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    read: { type: 'string', description: 'One line on what the reply says and wants: interested, a question, a not now, a referral, a bounce-back.' },
    subject: { type: 'string', description: 'The subject to reply with, usually the original with Re: in front.' },
    body: { type: 'string', description: '40 to 120 words of plain text: a greeting line, one or two short paragraphs, a final line that answers or asks, then a sign-off line on its own. No bullet points, no name under the sign-off.' },
  },
  required: ['read', 'subject', 'body'],
};

export function buildReplySystemPrompt(valueProposition: string): string {
  return `You write replies for Craig Springett of Big Fish Recruitment, a recruitment firm that places the first Head of Talent Acquisition or Head of Recruitment into seed and Series A start-ups. A founder or a people lead has replied to an email Craig sent; Craig reads your draft and sends it from Outlook as written.

Rules:
- British English, plain, warm and direct, in Craig's voice: short sentences, no jargon, no marketing words, no exclamation marks, no bullet points.
- 40 to 120 words. A greeting line ("Hi Priya," when the reply is signed with a first name, "Hello," when it is not), one or two short paragraphs, a last line that answers what they asked or asks one easy question, then a sign-off line ("Best wishes," or "Thanks,") on its own. Never write Craig's name or a phone number under the sign-off.
- Answer what the reply actually says. If they want a call, offer two slots in plain words ("Thursday afternoon or Friday morning") without inventing a diary. If they ask a question, answer it from the reference material or say you will find out. If it is a not now, thank them, leave the door open in one sentence, and stop. If they refer you to someone else, thank them and say you will write to that person.
- Never quote a fee, a margin, a percentage of salary or a retainer figure; you may say the work can be contingent or retained and that the shape is agreed on the call.
- Do not invent anything not in the input: no names, dates, numbers or claims about the company. Never write "[phone number]" or any placeholder.
- Never use these phrases: ${BANNED_PHRASES.map((p) => `"${p}"`).join(', ')}.

Reference material about Big Fish Recruitment (paraphrase, never paste):
${valueProposition.trim()}`;
}

export function buildReplyMessage(input: ReplyDraftInput): string {
  const lines: string[] = [];
  lines.push(`Today: ${input.today.toISOString().slice(0, 10)}.`);
  lines.push(`Company: ${input.companyName}. ${input.companyLine}`.trim());
  lines.push(`Contact who replied: ${input.contactName || 'unknown, use the sign-off of the reply'}.`);
  lines.push('');
  if (input.sentBefore.length) {
    lines.push('What Craig sent this person before (newest first):');
    for (const e of input.sentBefore.slice(0, 3)) lines.push(`--- ${e.sentAt ? e.sentAt.slice(0, 10) : 'undated'} | ${e.subject || '(no subject)'} ---\n${(e.body || '').trim().slice(0, 1500)}`);
  } else {
    lines.push('What Craig sent before: not on record.');
  }
  lines.push('');
  lines.push(`The reply (${input.reply.receivedAt.slice(0, 10)}, subject "${input.reply.subject || ''}"):`);
  lines.push(input.reply.text.trim().slice(0, 3000) || '(empty)');
  lines.push('');
  lines.push('Write the reply now: read, subject and body, following the schema.');
  return lines.join('\n');
}

const SIGN_OFFS = /^(best wishes|kind regards|regards|best|many thanks|thanks|thank you|all the best|warm regards|cheers)[,.]?$/i;

export function replyFlags(draft: ReplyDraft): string[] {
  const flags: string[] = [];
  const body = (draft.body || '').trim();
  const words = wordCount(body);
  if (words < 40 || words > 120) flags.push(`body ${words} words (want 40 to 120)`);
  if (!(draft.subject || '').trim()) flags.push('subject missing');
  const fee = feeFigureViolations(`${draft.subject}\n${body}`);
  if (fee.length) flags.push(`fee figure: ${fee[0].slice(0, 80)}`);
  const banned = bannedPhraseHits(body);
  if (banned.length) flags.push(`banned phrase: ${banned.join(', ')}`);
  if (/!/.test(body)) flags.push('exclamation mark');
  if (/\[[^\]]*\]/.test(body)) flags.push('placeholder in square brackets');
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!SIGN_OFFS.test(lines[lines.length - 1] || '')) flags.push('no sign-off line at the end');
  if (!/^(dear|hello|hi|good (morning|afternoon))\b/i.test(lines[0] || '')) flags.push('no greeting line');
  return flags;
}

export function stripReplySignature(body: string, consultant: { displayName: string; firstName: string }): string {
  const lines = body.replace(/\r\n?/g, '\n').trim().split('\n');
  const names = [consultant.displayName, consultant.firstName].map((n) => n.trim().toLowerCase());
  while (lines.length) {
    const last = lines[lines.length - 1].trim().toLowerCase();
    if (!last) { lines.pop(); continue; }
    if (names.includes(last) || last === 'big fish recruitment' || /^\[?phone number\]?$/.test(last) || /^\+?[\d\s()]{7,}$/.test(last)) { lines.pop(); continue; }
    break;
  }
  return lines.join('\n').trim();
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (client) return client;
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  client = new Anthropic({ apiKey, maxRetries: 2, timeout: 90_000 });
  return client;
}

export interface ReplyDraftResult { draft: ReplyDraft; flags: string[]; usage: UsageRecord }

/** One call; the flags come back for the consultant to see, the draft is kept either way. */
export async function generateReplyDraft(input: ReplyDraftInput, companySearchId: string | null): Promise<ReplyDraftResult> {
  const vp = await loadValueProposition();
  const started = Date.now();
  const response = await anthropic().beta.messages.create({
    model: COPY_MODEL,
    max_tokens: 1200,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [{ type: 'text', text: buildReplySystemPrompt(vp.text), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildReplyMessage(input) }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: REPLY_SCHEMA } },
  });
  const usage: UsageRecord = {
    provider: 'anthropic', model: response.model || COPY_MODEL, purpose: 'other', companySearchId,
    inputTokens: response.usage.input_tokens, cachedInputTokens: response.usage.cache_read_input_tokens || 0, cacheWriteTokens: response.usage.cache_creation_input_tokens || 0,
    outputTokens: response.usage.output_tokens, durationMs: Date.now() - started, ok: true, details: { kind: 'inbox_reply', stopReason: response.stop_reason },
  };
  const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('');
  let obj: any;
  try { obj = JSON.parse(text); } catch { usage.ok = false; usage.error = 'invalid json'; throw Object.assign(new Error('Claude output was not valid reply JSON'), { usage }); }
  const draft: ReplyDraft = { read: String(obj.read || ''), subject: String(obj.subject || '').replace(/[\r\n]+/g, ' ').trim(), body: stripReplySignature(String(obj.body || ''), input.consultant) };
  return { draft, flags: replyFlags(draft), usage };
}
