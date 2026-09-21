// The copy prompt: a stable system block (rules, persona notes, the value
// proposition file) that is cached across calls, and a company-specific user
// message built from the register line, the stage and the latest raise, the
// signals, facts, open roles, contacts and the consultant.
// docs/COPY-STYLE.md describes the rules in plain language.

import type { Fact } from '../facts/types.ts';
import type { StageGuess, LatestRaise } from '../facts/derive.ts';
import type { Signal } from '../signals/compute.ts';
import { BANNED_PHRASES, FIRM_NAME, WORD_LIMITS } from './checks.ts';
import { type ConsultantIdentity, pickReviews, type Review } from './reviews.ts';
import { VALUE_PROPOSITION_DEFAULT } from './value-proposition.default.ts';

export type Persona = 'founder' | 'coo' | 'people' | 'cto' | 'investor';
export const PERSONAS: Persona[] = ['founder', 'coo', 'people', 'cto', 'investor'];

export const PERSONA_LABELS: Record<Persona, string> = {
  founder: 'Founder / CEO',
  coo: 'COO / Chief of Staff',
  people: 'Head of People',
  cto: 'CTO / VP Engineering',
  investor: 'Investor talent partner',
};

export const PERSONA_NOTES: Record<Persona, string> = {
  founder: 'The founder is running the company and the hiring at the same time, and hiring is eating the calendar: every open role is screening, interviews and offers they are doing themselves or through whoever is nearest. What they want is their time back and a partner who has built a talent function before, not another agency sending CVs. Lead with the specific hiring load in the input (the open roles, the raise, the plan they stated) and the idea that one good Head of Talent is the hire that makes the other hires happen. Offer the Searchable placement as the one proof point when it is in the reference material. Do not tell them their hiring is broken; describe what they are doing and ask how it feels from the inside. Never quote a fee.',
  coo: 'The COO or chief of staff owns the process and the numbers: time to hire, cost per hire, offer acceptance, how many roles each person can carry, how the plan lands against the runway. Lead with process, speed and predictability: a Head of Talent who sets up the pipeline, the tooling and the reporting so hiring stops being a fire drill. Use the open-roles count and the raise as the concrete frame. Say nothing about fee levels or percentages; you may say the work can be contingent or retained and that the shape is agreed on the call.',
  people: 'The Head of People has usually inherited recruiting on top of everything else, or is about to. They want a peer who has done the build-out: someone who knows what a first talent hire at this stage looks like, what the role should own, how it fits beside them rather than under or over them. Lead with the shape of the team in the input (the roles open, the departments hiring, whether a talent person exists yet) and speak as one professional to another. Do not imply they are failing; the point is that the function is being built and the sequencing matters. Never a fee.',
  cto: 'The CTO wants engineers hired without losing their own calendar to it: sourcing, technical screens and closing take engineering time that should go on the product. Lead with the engineering roles in the input (count them, name the disciplines), how long they have been open, and the idea of a Head of Talent who can run technical hiring so the engineering leads only see the final loop. Keep it concrete and short; no marketing words. Say nothing about fees.',
  investor: 'The investor talent partner sits on a fund\'s platform team and wants the portfolio staffed and to be the person who made the useful introduction. Lead with the specific portfolio company in the input (the raise, the round, the roles open, no talent lead in post) and offer an introduction that makes them look good: a Head of Talent placement they can point to, and a short note they can forward to the founder. Speak about the company by name and by the facts; never claim to know the fund\'s other companies unless the input says so. No fee talk.',
};

export const COPY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    call: {
      type: 'object',
      additionalProperties: false,
      properties: {
        opener: { type: 'string', description: `${WORD_LIMITS.opener.min} to ${WORD_LIMITS.opener.max} words, spoken, one signal as the reason for calling.` },
        discovery_questions: { type: 'array', items: { type: 'string' }, description: 'Exactly three open questions, no more.' },
        objections: {
          type: 'array',
          items: { type: 'object', additionalProperties: false, properties: { objection: { type: 'string' }, response: { type: 'string' } }, required: ['objection', 'response'] },
          description: 'Exactly three likely objections with a short spoken response each, no more.',
        },
        voicemail: { type: 'string', description: `${WORD_LIMITS.voicemail.min} to ${WORD_LIMITS.voicemail.max} words.` },
        close: { type: 'string', description: 'One or two sentences with the fifteen-minute ask.' },
      },
      required: ['opener', 'discovery_questions', 'objections', 'voicemail', 'close'],
    },
    email: {
      type: 'object',
      additionalProperties: false,
      properties: {
        subject: { type: 'string', description: `Under ${WORD_LIMITS.subjectChars.max} characters, no clickbait.` },
        body: { type: 'string', description: `Under ${WORD_LIMITS.emailBody.max} words: one hook, one proof point, one ask, signed by the consultant. Plain text with blank lines between paragraphs.` },
        followup: { type: 'string', description: `Under ${WORD_LIMITS.followup.max} words, for five days later.` },
      },
      required: ['subject', 'body', 'followup'],
    },
  },
  required: ['call', 'email'],
};

/** The stable part of the prompt. Cached; keep anything company-specific out of it. */
export function buildSystemPrompt(valueProposition: string): string {
  return `You write short, specific outreach for ${FIRM_NAME}, a recruitment firm that places Heads of Talent Acquisition and Heads of Recruitment into seed and Series A start-ups in the United Kingdom, London first. A consultant will read the call script aloud on the phone today and send the email as written. You are given one company, one persona (the person being contacted), the Companies House register line, the stage and the latest raise as far as they are known, computed signals with their evidence, validated facts with quotes from the company's own website, the open roles grouped by family, the consultant's name, and today's date.

Style rules:
- British English, plain, warm and direct. Short sentences. No jargon, no marketing words, no exclamation marks.
- The reason for contact is always a specific signal with its evidence, named plainly in the first two sentences. Never a generic compliment, never "I came across your website".
- Do not invent anything not in the input: no names, titles, roles, open roles, numbers, dates, funding figures, investors, awards or claims about the company that the input does not contain. If you are not sure something is in the input, leave it out. Never add a title (Mr, Mrs, Ms, Dr) the input does not give; a contact given as "Sarah Green" is "Sarah".
- Do not make claims about what other companies, funds or agencies are doing ("most Series A companies hire a Head of Talent within six months"); say only what the reference material or the input supports.
- Use at most one or two proof points about ${FIRM_NAME}, chosen for the persona. Never quote a fee, a percentage, a retainer figure, a rebate period or a day rate. You may say that we work on a contingent or a retained basis and that the shape is agreed on the call; never a number.
- Never promise a candidate, a shortlist or availability that is not in the input.
- Never imply the company is failing at hiring; say what they are doing (the roles open, the plan they stated, the raise) and ask how it is going.
- Lines in the reference material marked "[Craig to confirm]" are placeholders awaiting confirmation: do not use the claim they carry and never write the marker.
- If the input has no strong signal (no open roles, no raise, no leadership change, no stated hiring plan), say so honestly in the opener ("no open role that I can see, so this is a short introduction") and keep everything shorter. Never pad.
- Address the named contact when one is given: by title and surname when the input gives a title, by first name when the input gives a full name without a title; if no contact is given, write for "the founder" (or the persona's role) without inventing a name.
- Sign the email body with the consultant's first name on its own line, then "${FIRM_NAME}" and "[phone number]" on the next lines. The follow-up is signed with the first name only.
- The call opener is spoken: contractions are fine, no bullet points, no headings. Say who you are and where from in the first sentence, the reason in the second, then the one-line proof point, then a question.
- Discovery questions are open and specific to the signals. Objections are the ones this persona actually raises (we have an internal recruiter, we use an agency already, no budget until the next round, the founders do the hiring, send an email) with a calm response each.
- The voicemail stands alone: name, firm, the one reason, the ask, the phone number placeholder [phone number].
- The email: subject under ${WORD_LIMITS.subjectChars.max} characters that names the reason; body under ${WORD_LIMITS.emailBody.max} words with one hook, one proof point, one ask, signed with the consultant's first name, ${FIRM_NAME}, and the placeholder [phone number]; a follow-up under ${WORD_LIMITS.followup.max} words for five days later that adds one new thing rather than repeating.
- Never use these phrases: ${BANNED_PHRASES.map((p) => `"${p}"`).join(', ')}. In particular never open a sentence with "I wanted to"; say what you are doing ("I'm calling because", "I'm writing because").
- Word limits are hard: opener ${WORD_LIMITS.opener.min} to ${WORD_LIMITS.opener.max} words, voicemail ${WORD_LIMITS.voicemail.min} to ${WORD_LIMITS.voicemail.max}, email body under ${WORD_LIMITS.emailBody.max}, follow-up under ${WORD_LIMITS.followup.max}.

Persona notes:
- founder: ${PERSONA_NOTES.founder}
- coo: ${PERSONA_NOTES.coo}
- people: ${PERSONA_NOTES.people}
- cto: ${PERSONA_NOTES.cto}
- investor: ${PERSONA_NOTES.investor}

Reference material about ${FIRM_NAME} (paraphrase, never paste):
${valueProposition.trim()}`;
}

export interface CopyContact {
  name: string;
  role: string;
  email?: string;
  confidence?: string;
  /** A reported contact is never the named contact; kept here so the picker can skip it. */
  feedback?: string;
}

/** The register line: what the Companies House record says about the company, already reduced to what the writer may name. */
export interface CopyRecordLine {
  companyNumber: string | null;
  /** 'active', 'dissolved', 'liquidation', ... */
  status: string | null;
  /** ISO YYYY-MM-DD */
  incorporationDate: string | null;
  /** The registered office's town or district. */
  locality: string | null;
  /** The sector label from the SIC codes ('Software', 'Fintech', ...). */
  sector: string | null;
}

/** One family of open roles: the family label, how many, and the titles. */
export interface CopyRoleGroup {
  family: string;
  label: string;
  count: number;
  titles: string[];
}

export interface CopyCompany {
  name: string;
  record: CopyRecordLine | null;
  stage: StageGuess | null;
  latestRaise: LatestRaise | null;
}

export interface CopyInput {
  persona: Persona;
  company: CopyCompany;
  /** The person this persona's copy is written to, or null when none was found. */
  contact: CopyContact | null;
  /** The other contacts found, so the writer can mention the founders or the general mailbox where useful. */
  otherContacts: CopyContact[];
  signals: Signal[];
  facts: Fact[];
  /** Open roles grouped by family, the direct lead (people and talent) first. */
  openRoles: CopyRoleGroup[];
  consultant: ConsultantIdentity;
  today: Date;
}

function fmtContact(c: CopyContact): string {
  const conf = c.confidence === 'consultant_provided' ? (c.email ? 'provided by the consultant' : 'name provided by the consultant, no address') : c.confidence === 'found' ? 'address found on site' : c.confidence === 'pattern_guess' ? 'address is a pattern guess' : c.confidence === 'role_only' ? 'name only, no address' : 'unverified';
  return `${c.name || '(no name)'} | ${c.role}${c.email ? ` | ${c.email}` : ''} | ${conf}`;
}

const STAGE_WORDS: Record<string, string> = { pre_seed: 'pre-seed', seed: 'seed', series_a: 'Series A', series_b_plus: 'Series B or later', unknown: 'unknown' };

/** The register line as the writer sees it. */
export function recordLine(r: CopyRecordLine | null): string {
  if (!r) return 'Companies House record: none (no company number, or the register could not be read).';
  const parts = [
    r.companyNumber ? `number ${r.companyNumber}` : 'no number',
    r.status ? `status ${r.status}` : null,
    r.incorporationDate ? `incorporated ${r.incorporationDate}` : null,
    r.locality ? `registered office ${r.locality}` : null,
    r.sector ? `sector ${r.sector}` : null,
  ].filter(Boolean);
  return `Companies House record: ${parts.join('; ')}.`;
}

/** The stage guess as the writer sees it. */
export function stageLine(s: StageGuess | null): string {
  if (!s || s.label === 'unknown') return 'Stage: unknown; do not name a stage.';
  return `Stage: ${STAGE_WORDS[s.label] || s.label}${s.evidence ? ` (${s.evidence}${s.source_url ? `, ${s.source_url}` : ''})` : ''}.`;
}

/** The latest raise as the writer sees it. */
export function raiseLine(r: LatestRaise | null): string {
  if (!r) return 'Latest raise: none in the input; do not mention funding.';
  const bits = [r.round ? r.round : null, r.amountText ? r.amountText : null, r.date ? `dated ${r.date}` : null, r.investors?.length ? `investors ${r.investors.join(', ')}` : null].filter(Boolean);
  return `Latest raise: ${bits.length ? bits.join(', ') : 'a round the company mentioned'}${r.statement ? ` | "${r.statement}"` : ''}${r.source_url ? ` | ${r.source_url}` : ''}.`;
}

/** The company-specific message. Everything the writer may use is here and nothing else. */
export function buildUserMessage(input: CopyInput): { text: string; reviews: Review[] } {
  const reviews = pickReviews(input.consultant, { stage: input.company.stage?.label ?? null, sector: input.company.record?.sector ?? null });
  const backing = new Set<string>();
  for (const s of input.signals) for (const e of s.evidence) if (e.type === 'fact' && e.id) backing.add(e.id);
  const backingFacts = input.facts.filter((f) => backing.has(f.id));
  const otherFacts = input.facts.filter((f) => !backing.has(f.id)).slice(0, 8);
  const lines: string[] = [];
  lines.push(`Persona: ${input.persona} (${PERSONA_LABELS[input.persona]})`);
  lines.push(`Today: ${input.today.toISOString().slice(0, 10)}.`);
  lines.push(`Consultant: ${input.consultant.firstName ? `${input.consultant.fullName || input.consultant.firstName}, ${input.consultant.role}` : `not assigned; sign as "the ${FIRM_NAME} team" with first name "${FIRM_NAME}"`}, ${FIRM_NAME}.`);
  lines.push('');
  lines.push(`Company: ${input.company.name}.`);
  lines.push(recordLine(input.company.record));
  lines.push(stageLine(input.company.stage));
  lines.push(raiseLine(input.company.latestRaise));
  lines.push('');
  lines.push(`Named contact for this persona: ${input.contact ? fmtContact(input.contact) : 'none found on the site; do not invent one'}.`);
  if (input.otherContacts.length) lines.push(`Other contacts found: ${input.otherContacts.slice(0, 6).map(fmtContact).join('; ')}.`);
  lines.push('');
  if (input.signals.length) {
    lines.push('Signals, strongest first (strength 1 to 3):');
    for (const s of input.signals) {
      lines.push(`- [${s.strength}] ${s.label}: ${s.explanation}`);
      for (const e of s.evidence.slice(0, 3)) lines.push(`    evidence: ${e.text}${e.quote ? ` | quote: "${e.quote}"` : ''}`);
    }
  } else {
    lines.push('Signals: none. There is no open role and no evidence of change or pressure; write the honest short introduction.');
  }
  lines.push('');
  if (backingFacts.length || otherFacts.length) {
    lines.push('Validated facts from the company\'s website (statement | quote | page):');
    for (const f of [...backingFacts, ...otherFacts]) lines.push(`- ${f.statement} | "${f.quote}" | ${f.source_url}`);
  } else {
    lines.push('Validated facts: none.');
  }
  lines.push('');
  const total = input.openRoles.reduce((n, g) => n + g.count, 0);
  if (total > 0) {
    lines.push(`Open roles: ${total} in total, by family:`);
    for (const g of input.openRoles) lines.push(`- ${g.label}: ${g.count} (${g.titles.slice(0, 8).join('; ')}${g.titles.length > 8 ? '; ...' : ''})`);
  } else {
    lines.push('Open roles: none on the company\'s careers page or its applicant tracking system.');
  }
  lines.push('');
  lines.push(`Proof points about ${FIRM_NAME} you may paraphrase (attribute as "a company we work with", never by name unless the reference material names it; skip any line marked [Craig to confirm]):`);
  for (const r of reviews) lines.push(`- ${r.type} (${r.author}), consultant ${r.consultant}: "${r.quote}"`);
  lines.push('');
  lines.push('Write the call script and the email for this persona now, following the schema: exactly three discovery questions and exactly three objections.');
  return { text: lines.join('\n'), reviews };
}

export const CORRECTION_PREAMBLE = 'The previous draft failed these checks. Rewrite the whole response so that every check passes, keeping what was good:';

/** Read the editable value-proposition file, falling back to the embedded copy. */
export async function loadValueProposition(): Promise<{ text: string; source: 'file' | 'embedded' }> {
  try {
    const url = new URL('./value-proposition.md', import.meta.url);
    const text = await Deno.readTextFile(url);
    if (text.trim()) return { text, source: 'file' };
  } catch (_e) {
    // Fall through: the file is not bundled with this function.
  }
  return { text: VALUE_PROPOSITION_DEFAULT, source: 'embedded' };
}
