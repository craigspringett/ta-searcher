// The evidence pass: one structured extraction call whose output is a list
// of facts with verbatim quotes, plus the contact review and the
// page-grounded open-role titles. The model never writes the summary, the
// signals or the scripts.
//
// Gemini (via _shared/ai.ts) is the default because the output is validated
// mechanically (validate.ts). When Gemini refuses with a quota error the
// call falls back to Claude Sonnet, as the brief allows; both are logged to
// ai_usage by the caller through the returned usage block.

import { chatCompletion, resolveModel } from '../ai.ts';
import type { RawFact, SourcePage } from './types.ts';
import { FACT_KINDS } from './types.ts';

export interface ExtractionInput {
  companyName: string;
  /** The Companies House record as structured JSON: not for re-extraction, so the model does not contradict it. */
  record: Record<string, unknown> | null;
  /** Verified open roles as structured JSON (title, source, url, department, location). */
  vacancies: Array<Record<string, unknown>>;
  /** The contacts block from the contacts pass, unchanged. */
  contactsBlock: string;
  /** Pages in the order they should appear: contact, team and careers pages first. */
  pages: SourcePage[];
  /** Total character budget for the page text. */
  maxChars?: number;
}

export interface ExtractionOutput {
  facts: RawFact[];
  contactReview: Array<{ name: string; role: string; email: string; flag?: string }>;
  vacancies: Array<{ title: string; startDate?: string; endDate?: string; url?: string }>;
  usage: { provider: 'gemini' | 'anthropic'; model: string; inputTokens: number; outputTokens: number; cachedInputTokens: number; durationMs: number };
  /** Which pages (by URL) were actually included, after the budget cut. */
  pagesShown: string[];
}

/** The roles the contact review normalises to (docs/PORT-CONTRACTS.md, Facts). Extra detail may follow after a comma. */
export const CONTACT_REVIEW_ROLES = [
  'Founder / CEO', 'Co-founder', 'COO / Chief of Staff', 'CTO / VP Engineering', 'Head of People / CPO',
  'Head of Talent / Recruiter', 'Head of Operations', 'EA / Office Manager', 'Investor / Board', 'Other',
] as const;

export const EXTRACTION_SYSTEM = `You are an evidence extractor for a UK recruitment firm that places Heads of Talent into seed and Series A start-ups. You read a company's own web pages and record facts that a recruitment consultant could use in a phone call with a founder, each backed by a verbatim quote from the page it came from.

Rules:
- Every fact needs a quote copied exactly from the labelled page text (10 to 300 characters, no paraphrase, no ellipsis, keep the original spelling and punctuation). A fact whose quote is not on the page is worthless and will be discarded.
- source_url must be the exact URL label of the section the quote came from.
- statement: one sentence, present tense, plain British English, naming the company where natural. No adjectives the page did not use.
- date_hint: the date or period the page gives for the fact ("March 2026", "Q1 2026", "2025"), or null.
- Prefer facts about, in the company's own words:
  - the funding round: the amount and the round name as written (kind funding_round), and the lead or named investors separately (kind investor, one fact per investor or per list of investors);
  - the stage the company calls itself: pre-seed, seed, Series A, Series B (kind stage);
  - headcount or growth statements ("we are 40 people, doubling this year") (kind headcount);
  - hiring plans ("hiring 20 engineers this year", "growing the team from 30 to 60") (kind hiring_plan);
  - who runs people or talent today: a named Head of People, a Talent Partner, an office manager doing it, or a statement that nobody does yet (kind people_function); when a Head of Talent, recruiter, talent partner or in-house recruiting team is named as in post, record it as kind talent_team;
  - leadership changes: a new CEO, COO, CTO, CPO, CFO, VP or chief joining, stepping up or stepping down (kind leadership_change);
  - a new office (kind office), a new market or country (kind new_market), or a new team or site (kind expansion);
  - product launches (product_launch), awards in the last three years (award), and accelerator membership: Y Combinator with its batch name, Techstars, Entrepreneur First, Antler, Seedcamp, Founders Factory and the like (kind accelerator);
  - staffing pressure wording: scaling the team, hiring aggressively, doubling headcount, roles hard to fill, struggling to hire (kind staffing_pressure);
  - a recruitment agency or search firm named as recruiting for the company, or a statement about agencies on the careers page (kind agency_mention);
  - remote or hybrid policy (remote_policy), stated values (values), recent news (recent_news).
- Staff departures and arrivals (kinds staff_departure and staff_arrival), usually in blog or news posts: a named member of staff leaving, stepping down, moving to another company, or going on parental leave, or a named person joining or being appointed, with the role and the date when the page gives them ("Priya Shah joins as Head of People", "our CTO Tom Reed is stepping down in June"). Record the person's name and role as written. A customer, an investor, an adviser or a person at another company leaving or joining is not a staff departure or arrival.
- Do not record open roles as facts; they are handled separately. Do not record contact details as facts.
- Do not invent, infer or combine. If the pages contain nothing for a kind, return nothing for it. Fewer, well-quoted facts beat many weak ones. At most 40.
- The Companies House record and the verified open roles are given as JSON so you do not contradict them; do not re-extract them.

CONTACTS: a CONTACTS block lists the people and addresses already found on the company's own pages. Your only job with contacts is to confirm or correct name-to-role-to-email joins, normalise role wording, and flag anyone who looks like a customer, an author quoted in a testimonial, a job applicant, or an officer of another organisation. You may drop or relabel a contact; you may never add a person or an address that is not in the block, and you may never construct an address.

VACANCIES: list only job titles that appear word for word in the page text as a current open role at this company (not news stories, not the team page, not a customer's or a partner's roles). Copy the title exactly, include the closing date and URL only when they are in the text.`;

export const EXTRACTION_TOOL = {
  type: 'function',
  function: {
    name: 'record_evidence',
    description: 'Record facts with verbatim quotes, the reviewed contacts and any open-role titles found verbatim in the text.',
    parameters: {
      type: 'object',
      properties: {
        facts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: [...FACT_KINDS] },
              statement: { type: 'string', description: 'One sentence, present tense.' },
              quote: { type: 'string', description: 'Verbatim from the page text, 10 to 300 characters.' },
              source_url: { type: 'string', description: 'The URL label of the section the quote is in.' },
              date_hint: { type: 'string', description: 'Date or period given by the page, or empty.' },
            },
            required: ['kind', 'statement', 'quote', 'source_url'],
          },
        },
        contactReview: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              role: { type: 'string' },
              email: { type: 'string', description: 'Exactly as it appears in the CONTACTS block, or empty when the block has no address for this person.' },
              flag: { type: 'string', description: 'Short reason when this entry should be dropped (customer, testimonial author, applicant, another organisation). Empty otherwise.' },
            },
            required: ['name', 'role', 'email'],
          },
          description: `The CONTACTS block, reviewed: joins confirmed or corrected, roles normalised to one of ${CONTACT_REVIEW_ROLES.join(', ')} (extra detail after a comma), doubtful entries flagged. Empty when the block is empty.`,
        },
        vacancies: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Exactly as written in the page text. No source suffix.' },
              startDate: { type: 'string', description: 'Start date phrase as written ("January 2027", "ASAP"), or empty.' },
              endDate: { type: 'string', description: 'Closing date exactly as written, or empty.' },
              url: { type: 'string', description: 'Direct advert URL only if in the text, else empty.' },
            },
            required: ['title'],
          },
        },
      },
      required: ['facts', 'contactReview', 'vacancies'],
    },
  },
};

/** Lays the pages out as labelled sections inside the character budget. */
export function buildPagesText(pages: SourcePage[], maxChars: number): { text: string; shown: string[] } {
  const shown: string[] = [];
  let out = '';
  let remaining = maxChars;
  for (const p of pages) {
    const header = `\n\n=== PAGE ${p.url} ===\n`;
    if (remaining < header.length + 100) break;
    const body = p.text.replace(/\s+\n/g, '\n').trim();
    if (!body) continue;
    const slice = body.length + header.length > remaining ? body.slice(0, remaining - header.length) : body;
    out += header + slice;
    remaining -= header.length + slice.length;
    shown.push(p.url);
    if (slice.length < body.length) break;
  }
  return { text: out.trim(), shown };
}

export function buildUserMessage(input: ExtractionInput): { text: string; shown: string[] } {
  const { text, shown } = buildPagesText(input.pages, input.maxChars ?? 60000);
  const msg = [
    `Company: ${input.companyName}`,
    `Companies House record (JSON, for context only): ${JSON.stringify(input.record ?? null)}`,
    `Verified open roles (JSON, for context only): ${JSON.stringify(input.vacancies)}`,
    `CONTACTS (already extracted from the company's own pages; every address below was found on the cited page):\n${input.contactsBlock}`,
    `PAGE TEXT (each section is labelled with its URL; quote only from these sections and cite the label):`,
    text,
  ].join('\n\n');
  return { text: msg, shown };
}

/** Structured outputs require every object schema to forbid extra properties. */
export function strictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (schema && typeof schema === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema as Record<string, unknown>)) out[k] = k === 'enum' ? v : strictSchema(v);
    if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
      out.additionalProperties = false;
      out.required = Object.keys(out.properties as Record<string, unknown>);
    }
    return out;
  }
  return schema;
}

export class ExtractionQuotaError extends Error {
  constructor(msg: string) { super(msg); this.name = 'ExtractionQuotaError'; }
}

function parseToolArguments(raw: unknown): { facts: RawFact[]; contactReview: ExtractionOutput['contactReview']; vacancies: ExtractionOutput['vacancies'] } {
  const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const facts = Array.isArray(obj?.facts) ? obj.facts : [];
  const contactReview = Array.isArray(obj?.contactReview) ? obj.contactReview : [];
  const vacancies = Array.isArray(obj?.vacancies) ? obj.vacancies : [];
  return { facts, contactReview, vacancies };
}

/** Gemini extraction with the same retry behaviour analyze-company used. */
export async function extractWithGemini(input: ExtractionInput): Promise<ExtractionOutput> {
  const { text, shown } = buildUserMessage(input);
  const started = Date.now();
  const MAX = 3;
  let response: Response | null = null;
  for (let attempt = 1; attempt <= MAX; attempt++) {
    response = await chatCompletion({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM },
        { role: 'user', content: text },
      ],
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: 'function', function: { name: 'record_evidence' } },
      max_tokens: 8000,
    });
    if (response.ok) break;
    const body = await response.text();
    console.error(`Evidence pass: AI API error (attempt ${attempt}/${MAX}):`, response.status, body.slice(0, 300));
    if (response.status === 429) {
      if (attempt < MAX) { await new Promise((r) => setTimeout(r, 20000 * attempt)); continue; }
      throw new ExtractionQuotaError('AI rate limit exceeded after retries');
    }
    if (response.status === 402) throw new ExtractionQuotaError('AI API billing error (402)');
    if (response.status >= 500 && attempt < MAX) { await new Promise((r) => setTimeout(r, attempt * 5000)); continue; }
    throw new Error(`AI API error: ${response.status}`);
  }
  if (!response || !response.ok) throw new Error('AI API failed after all retries');
  const data = await response.json();
  const choice = data.choices?.[0];
  const toolCall = choice?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.function?.name !== 'record_evidence') throw new Error('Unexpected AI response format (no record_evidence call)');
  if (choice.finish_reason && choice.finish_reason !== 'stop' && choice.finish_reason !== 'tool_calls') console.warn('Evidence pass finish_reason:', choice.finish_reason);
  let parsed;
  try {
    parsed = parseToolArguments(toolCall.function.arguments);
  } catch {
    throw new Error('AI returned invalid JSON for record_evidence');
  }
  return {
    ...parsed,
    usage: {
      provider: 'gemini',
      model: resolveModel('google/gemini-2.5-flash'),
      inputTokens: Number(data.usage?.prompt_tokens ?? 0),
      outputTokens: Number(data.usage?.completion_tokens ?? 0),
      cachedInputTokens: Number(data.usage?.prompt_tokens_details?.cached_tokens ?? 0),
      durationMs: Date.now() - started,
    },
    pagesShown: shown,
  };
}

/**
 * Claude Sonnet fallback for the evidence pass, used when Gemini refuses on
 * quota (the brief allows it and notes the cost). Same schema, same
 * validation afterwards.
 */
export function extractionFallbackCap(): number {
  return Number(Deno.env.get('EXTRACTION_FALLBACK_CAP') || 40);
}

/** How many Claude extractions have run since 04:00 UTC today (the nightly window). */
// deno-lint-ignore no-explicit-any
export async function claudeExtractionsTonight(supabase: any): Promise<number> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 4));
  if (now < start) start.setUTCDate(start.getUTCDate() - 1);
  const { count, error } = await supabase.from('ai_usage').select('id', { count: 'exact', head: true }).eq('provider', 'anthropic').eq('purpose', 'evidence').gte('created_at', start.toISOString());
  if (error) { console.warn('ai_usage count failed:', error.message); return 0; }
  return count ?? 0;
}

export async function extractWithClaude(input: ExtractionInput): Promise<ExtractionOutput> {
  const { default: Anthropic } = await import('npm:@anthropic-ai/sdk@0.124.0');
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  const model = Deno.env.get('EXTRACTION_FALLBACK_MODEL') || 'claude-sonnet-5';
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 180_000 });
  const { text, shown } = buildUserMessage(input);
  const started = Date.now();
  const schema = strictSchema(EXTRACTION_TOOL.function.parameters) as Record<string, unknown>;
  // Sonnet does not take the server-side fallback parameter; a refusal here
  // simply fails the evidence pass for this run.
  const response = await client.messages.create({
    model,
    max_tokens: 8000,
    system: [{ type: 'text', text: EXTRACTION_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: text }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
  });
  if (response.stop_reason === 'refusal') throw new Error(`Claude declined the extraction (${response.stop_details?.category ?? 'refusal'})`);
  if (response.stop_reason === 'max_tokens') throw new Error('Claude extraction was cut off (max_tokens)');
  const out = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  let parsed;
  try {
    parsed = parseToolArguments(out);
  } catch {
    throw new Error('Claude returned invalid JSON for the evidence pass');
  }
  return {
    ...parsed,
    usage: {
      provider: 'anthropic',
      model: response.model || model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cachedInputTokens: response.usage.cache_read_input_tokens || 0,
      durationMs: Date.now() - started,
    },
    pagesShown: shown,
  };
}
