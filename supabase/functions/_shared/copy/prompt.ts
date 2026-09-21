// The copy prompt: a stable system block (rules, persona notes, the value
// proposition file) that is cached across calls, and a company-specific user
// message built from the signals, facts, vacancies, spend, contacts and the
// consultant. docs/COPY-STYLE.md describes the rules in plain language.

import type { Fact } from '../facts/types.ts';
import type { Signal } from '../signals/compute.ts';
import { currentTerm } from '../signals/calendar.ts';
import { BANNED_PHRASES, WORD_LIMITS } from './checks.ts';
import { type ConsultantIdentity, pickReviews, type Review } from './reviews.ts';
import { VALUE_PROPOSITION_DEFAULT } from './value-proposition.default.ts';

export type Persona = 'headteacher' | 'sbm' | 'senco' | 'trust_hr';
export const PERSONAS: Persona[] = ['headteacher', 'sbm', 'senco', 'trust_hr'];

export const PERSONA_LABELS: Record<Persona, string> = {
  headteacher: 'Headteacher',
  sbm: 'Company Business Manager',
  senco: 'SENCO',
  trust_hr: 'Trust HR',
};

export const PERSONA_NOTES: Record<Persona, string> = {
  headteacher: 'The headteacher cares about the quality of who stands in front of the class and whether they fit the company. Lead with the specific role or pressure, the match-not-fill approach and the consultant\'s knowledge of the setting. Wellbeing community is relevant when supply consistency or retention is the issue. Compliance is a one-line reassurance, not the pitch. When a pupil premium fact names the teaching assistants, tutors or mentors the statement funds, or a named programme (Read Write Inc, Lexia, NELI, Third Space Learning), the opener may refer to that plan in the company\'s own words as the reason for calling, offering staff who know the programme; quote the statement\'s year. When the input gives a pupil premium "TAs a week" figure (only present when the company stated the hours or numbers), you may name it as the size of the team the premium funds; never our TA-days estimate.',
  sbm: 'The company business manager cares about compliance, cost transparency and admin. Lead with the framework (RM6376 Lot 1), rates already at framework level and visible on any invoice, the APSCo audit, and the fifteen-minute look at the margin and the compliance file. Never a figure. Quality of staff is the second point, not the first.',
  senco: 'The SENCO cares about SEN experience, consistency of the same person, and safeguarding. Lead with the SEND-specific signal (support vacancies, resource base, EHCP growth), staff with SEN experience and consistency of placement, the wellbeing community as a reason staff stay. Compliance in one line. Do not talk about margins beyond transparency. When a pupil premium fact names a literacy, speech and language or EAL programme, or TAs, HLTAs, ELSAs or intervention staff the statement funds, lead with it: staff trained in that programme or role, consistent for the pupils it serves. When the input gives a pupil premium "TAs a week" figure (only present when the company stated the hours or numbers), you may name it as the size of the team the premium funds; never our TA-days estimate.',
  trust_hr: 'Trust HR cares about the framework, volume across companies, consistency of process and compliance at scale. Lead with RM6376 Lot 1 and the October 2026 requirement, the APSCo audit, the ability to cover several companies, and one company-level signal as the concrete example. Offer a trust-level conversation rather than a single vacancy.',
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
  return `You write short, specific outreach for WhoFoundWho, an education recruitment agency in London and the Home Counties. A consultant will read the call script aloud on the phone today and send the email as written. You are given one company, one persona (the person being contacted), computed signals with their evidence, validated facts with quotes from the company's own website, live vacancies, agency spend with a peer comparison, the consultant's name, and today's date and term.

Style rules:
- British English, plain, warm and direct. Short sentences. No jargon, no marketing words, no exclamation marks.
- The reason for contact is always a specific signal with its evidence, named plainly in the first two sentences. Never a generic compliment, never "I came across your website".
- Do not invent anything not in the input: no names, titles, roles, vacancies, numbers, dates, awards, Ofsted grades or claims about the company that the input does not contain. If you are not sure something is in the input, leave it out. Never add a title (Mr, Mrs, Ms, Dr) the input does not give; a contact given as "Holly Churchill" is "Holly", never "Mrs Churchill".
- Do not make claims about what other companies, trusts or agencies are doing ("many companies are aligning early", "most companies keep two agencies"); say only what the reference material or the input supports.
- Use at most one or two proof points about WhoFoundWho, chosen for the persona. Refer to framework rates and transparency; never quote a margin, a fee, a percentage of salary or a daily rate. "Fifteen minutes to see the margin and the compliance file" is the ask.
- WhoFoundWho places long-term, fixed-term and permanent staff, and planned cover a company arranges with us in advance. Never offer or mention daily supply, day-to-day supply, same-day, short-notice, last-minute or emergency cover, or early-morning calls; if a vacancy or fact is about cover, treat it as planned cover.
- Mention the wellbeing community, compliance or the framework only when relevant to the persona (see the persona notes).
- If the input has no strong signal (no live vacancy, no leadership change, no spend or pressure evidence), say so honestly in the opener ("no live vacancy that I can see, so this is a short introduction") and keep everything shorter. Never pad.
- Address the named contact when one is given: by title and surname when the input gives a title ("Mrs M John" is addressed as "Mrs John", never with the initial), by first name when the input gives a full name without a title; if no contact is given, write for "the headteacher" (or the persona's role) without inventing a name.
- Sign the email body with the consultant's first name on its own line, then "WhoFoundWho" and "[phone number]" on the next lines. The follow-up is signed with the first name only.
- The call opener is spoken: contractions are fine, no bullet points, no headings. Say who you are and where from in the first sentence, the reason in the second, then the one-line proof point, then a question.
- Discovery questions are open and specific to the signals. Objections are the ones this persona actually raises (existing agency, budget, framework, no need right now, send an email) with a calm response each.
- The voicemail stands alone: name, agency, the one reason, the ask, the phone number placeholder [phone number].
- The email: subject under ${WORD_LIMITS.subjectChars.max} characters that names the reason; body under ${WORD_LIMITS.emailBody.max} words with one hook, one proof point, one ask, signed with the consultant's first name, WhoFoundWho, and the placeholder [phone number]; a follow-up under ${WORD_LIMITS.followup.max} words for five days later that adds one new thing rather than repeating.
- Never use these phrases: ${BANNED_PHRASES.map((p) => `"${p}"`).join(', ')}. In particular never open a sentence with "I wanted to"; say what you are doing ("I'm calling because", "I'm writing because").
- Word limits are hard: opener ${WORD_LIMITS.opener.min} to ${WORD_LIMITS.opener.max} words, voicemail ${WORD_LIMITS.voicemail.min} to ${WORD_LIMITS.voicemail.max}, email body under ${WORD_LIMITS.emailBody.max}, follow-up under ${WORD_LIMITS.followup.max}.

Persona notes:
- headteacher: ${PERSONA_NOTES.headteacher}
- sbm: ${PERSONA_NOTES.sbm}
- senco: ${PERSONA_NOTES.senco}
- trust_hr: ${PERSONA_NOTES.trust_hr}

Reference material about WhoFoundWho (paraphrase, never paste):
${valueProposition.trim()}`;
}

export interface CopyContact {
  name: string;
  role: string;
  email?: string;
  confidence?: string;
}

export interface CopyVacancy {
  title: string;
  source: string;
  firstSeen?: string | null;
  closingDate?: string | null;
  url?: string | null;
}

export interface CopySpend {
  latestYear: string | null;
  agencyAndSupply: number | null;
  previousYear: string | null;
  previousAgencyAndSupply: number | null;
  /** The peer comparison in words, already computed. */
  comparison: string | null;
}

/** The "TAs a week" figure from the company's pupil premium statement, given to the writer only when the company itself stated the hours or numbers. */
export interface CopyPupilPremium {
  tasPerWeek: number;
  basis: string | null;
  academicYear: string | null;
}

export interface CopyInput {
  persona: Persona;
  company: { name: string; phase: string | null; laName: string | null; trustName: string | null };
  contact: CopyContact | null;
  /** All contacts, so the writer can mention the office or a PA where useful. */
  contacts: CopyContact[];
  signals: Signal[];
  facts: Fact[];
  vacancies: CopyVacancy[];
  spend: CopySpend | null;
  /** Present only when confidence is high (stated hours, FTE or a number of staff); our pound-figure estimate is never given. */
  pupilPremium?: CopyPupilPremium | null;
  consultant: ConsultantIdentity;
  today: Date;
}

function fmtContact(c: CopyContact): string {
  const conf = c.confidence === 'consultant_provided' ? (c.email ? 'provided by the consultant' : 'name provided by the consultant, no address') : c.confidence === 'found' ? 'address found on site' : c.confidence === 'pattern_guess' ? 'address is a pattern guess' : c.confidence === 'role_only' ? 'name only, no address' : 'unverified';
  return `${c.name || '(no name)'} | ${c.role}${c.email ? ` | ${c.email}` : ''} | ${conf}`;
}

/** The company-specific message. Everything the writer may use is here and nothing else. */
export function buildUserMessage(input: CopyInput): { text: string; reviews: Review[] } {
  const reviews = pickReviews(input.consultant, input.company.phase);
  const backing = new Set<string>();
  for (const s of input.signals) for (const e of s.evidence) if (e.type === 'fact' && e.id) backing.add(e.id);
  const backingFacts = input.facts.filter((f) => backing.has(f.id));
  const otherFacts = input.facts.filter((f) => !backing.has(f.id)).slice(0, 8);
  const lines: string[] = [];
  lines.push(`Persona: ${input.persona} (${PERSONA_LABELS[input.persona]})`);
  lines.push(`Today: ${input.today.toISOString().slice(0, 10)}, ${currentTerm(input.today)}.`);
  lines.push(`Consultant: ${input.consultant.firstName ? `${input.consultant.fullName || input.consultant.firstName}, ${input.consultant.role}` : 'not assigned; sign as "the WhoFoundWho team" with first name "WhoFoundWho"'}, WhoFoundWho.`);
  lines.push('');
  lines.push(`Company (DfE record): ${input.company.name}; phase ${input.company.phase || 'unknown'}; local authority ${input.company.laName || 'unknown'}; trust ${input.company.trustName || 'none (maintained company or standalone)'}.`);
  lines.push('');
  lines.push(`Named contact for this persona: ${input.contact ? fmtContact(input.contact) : 'none found on the site; do not invent one'}.`);
  if (input.contacts.length) lines.push(`Other contacts found: ${input.contacts.slice(0, 6).map(fmtContact).join('; ')}.`);
  lines.push('');
  if (input.signals.length) {
    lines.push('Signals, strongest first (strength 1 to 3):');
    for (const s of input.signals) {
      lines.push(`- [${s.strength}] ${s.label}: ${s.explanation}`);
      for (const e of s.evidence.slice(0, 3)) lines.push(`    evidence: ${e.text}${e.quote ? ` | quote: "${e.quote}"` : ''}`);
    }
  } else {
    lines.push('Signals: none. There is no live vacancy and no evidence of change or pressure; write the honest short introduction.');
  }
  lines.push('');
  if (backingFacts.length || otherFacts.length) {
    lines.push('Validated facts from the company\'s website (statement | quote | page):');
    for (const f of [...backingFacts, ...otherFacts]) lines.push(`- ${f.statement} | "${f.quote}" | ${f.source_url}`);
  } else {
    lines.push('Validated facts: none.');
  }
  lines.push('');
  if (input.vacancies.length) {
    lines.push('Live vacancies:');
    for (const v of input.vacancies) lines.push(`- ${v.title} (${v.source}${v.firstSeen ? `, first seen ${v.firstSeen}` : ''}${v.closingDate ? `, closes ${v.closingDate}` : ''})`);
  } else {
    lines.push('Live vacancies: none on Teaching Vacancies, TES or the company website.');
  }
  lines.push('');
  if (input.spend && input.spend.agencyAndSupply != null) {
    lines.push(`Agency and supply teaching spend (DfE financial benchmarking): £${Math.round(input.spend.agencyAndSupply).toLocaleString('en-GB')} in ${input.spend.latestYear}${input.spend.previousAgencyAndSupply != null ? `, £${Math.round(input.spend.previousAgencyAndSupply).toLocaleString('en-GB')} in ${input.spend.previousYear}` : ''}. ${input.spend.comparison || ''}`.trim());
  } else {
    lines.push('Agency and supply spend: not available for this company.');
  }
  if (input.pupilPremium) {
    lines.push('');
    lines.push(`Pupil premium staffing, from the company's own statement${input.pupilPremium.academicYear ? ` for ${input.pupilPremium.academicYear}` : ''}: about ${input.pupilPremium.tasPerWeek} full-time-equivalent teaching assistants, mentors or tutors a week funded by the premium (${input.pupilPremium.basis || 'stated by the company'}). You may say this is the scale of the team the statement funds; never present it as a vacancy.`);
  }
  lines.push('');
  lines.push('Client and candidate reviews you may paraphrase as a proof point (attribute as "a company we work with" or "a candidate", never by name):');
  for (const r of reviews) lines.push(`- ${r.type}${r.author !== r.type ? ` (${r.author})` : ''}, consultant ${r.consultant}: "${r.quote}"`);
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
