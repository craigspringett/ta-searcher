// The follow-up email prompt and its checks (Follow-ups slice 2). Pure and
// tested; draft.ts makes the model call. Same checks as the scripts
// (_shared/copy: BANNED_PHRASES, feeFigureViolations, the named-people
// check), a different prompt.
//
// Each draft is one model call: a stable rules block (cached across every
// call), a per-company context block (cached across the three drafts of a
// sequence, written in the same words each time), and a short message for
// the step. The draft is checked (90 to 140 words, one concrete hook, no
// bullet list, no banned phrase, no fee figure, no exclamation mark, ends
// with a light question, a sign-off line and no invented name) and sent
// back once with the failures when it does not pass; the better of the two
// is kept with its remaining flags for the consultant to see.
//
// The consultant's name, "Big Fish Recruitment" and their phone number are added by
// the outreach-email template under the body (as in slice 1), so the draft
// ends with the sign-off line and never writes the name itself.

import { classifyRole } from '../contacts/resolve.ts';
import type { CopyContext } from '../copy/assemble.ts';
import { BANNED_PHRASES, bannedPhraseHits, feeFigureViolations, namedPeopleFlags, wordCount } from '../copy/checks.ts';
import { type Persona, PERSONA_LABELS, PERSONA_NOTES } from '../copy/prompt.ts';
import { describeDue } from './schedule.ts';

export const WORDS = { min: 90, max: 140 };
export const SUBJECT_MAX = 70;
export const STEP_PURPOSES = ['first', 'second', 'last'] as const;
export type StepPurpose = typeof STEP_PURPOSES[number];

export interface DraftContact { name: string; role: string | null; email: string }

export interface EarlierEmail {
  stepNo: number;
  /** When it went, null when only drafted or skipped. */
  sentAt: string | null;
  status: string;
  subject: string | null;
  body: string | null;
  hook: string | null;
}

export interface DraftOutcome { kind: string; created_at: string; note: string | null; contact_name: string | null }

export interface DraftVacancy { title: string; closingDate: string | null; url: string | null; source: string | null; firstSeen: string | null }

export interface ApprovedScript { opener: string | null; emailSubject: string | null; emailBody: string | null }

export interface FollowUpInput {
  ctx: Pick<CopyContext, 'company' | 'signals' | 'facts' | 'openRoles'>;
  contact: DraftContact;
  persona: Persona | null;
  consultant: { displayName: string; firstName: string };
  /** The vacancy the sequence is about, when one was chosen. */
  vacancy: DraftVacancy | null;
  approvedScript: ApprovedScript | null;
  /** The company's recent outcomes, newest first. */
  outcomes: DraftOutcome[];
  earlierEmails: EarlierEmail[];
  step: { stepNo: number; day: number; purpose: StepPurpose; dueAt: string };
  today: Date;
}

export interface FollowUpDraft { subject: string; body: string; hook: string }

export const FOLLOW_UP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    subject: { type: 'string', description: `Under ${SUBJECT_MAX} characters, plain, names the hook. No "Re:", no clickbait.` },
    body: { type: 'string', description: `${WORDS.min} to ${WORDS.max} words of plain text: a greeting line, two or three short paragraphs separated by blank lines, a final line that is a light question, then a sign-off line such as "Best wishes," on its own. No bullet points, no name under the sign-off.` },
    hook: { type: 'string', description: 'The one concrete thing this email is about, in a few words, e.g. "the three engineering roles open since July".' },
  },
  required: ['subject', 'body', 'hook'],
};

const PURPOSE_NOTES: Record<StepPurpose, string> = {
  first: 'This is the first email and the opening of the sequence: nothing has been sent or said before it unless the outcomes below show a call or a message. It sells, in this order: who you are and where from, and that you have just completed the search for Searchable\'s first Head of Recruitment (the reference material has the detail; say it in one sentence, not the whole story); Chris Donnelly\'s line about that search, quoted word for word, only when the reference material\'s testimonial section carries a real quote (never invent one, never paraphrase a marker); one sentence on why you are the person to find this company\'s early or founding Head of Talent or Head of Recruitment (you have placed the first talent leader at Searchable, Lottie and Attio and you run each search yourself); then the one thing you saw at this company, with its evidence, and the fifteen-minute call. Say you will ring in the next day or two. Do not claim to have called or left a message unless an outcome says so. End with a light question.',
  second: 'This is the second email, four days after the first. It must be tied to something real that the first email did not use: a role that has been open a while, a new role, the raise and what it will fund, a hiring plan in the company\'s own words, a departure or an arrival on the team. Do not repeat the first email; add one new thing and refer to the first in half a sentence at most. End with a light question.',
  last: 'This is the last email, two weeks in. Leave the door open without pressing: say plainly that you will not keep emailing, name the one thing you would help with if it comes up, and how to reach you. End with a light question that is easy to say no to.',
};

/** The stable rules. Cached; keep anything company-specific out of it. */
export function buildFollowUpSystemPrompt(valueProposition: string): string {
  return `You write short follow-up emails for Big Fish Recruitment, a recruitment firm that places Heads of Talent Acquisition and Heads of Recruitment into seed and Series A start-ups in the United Kingdom, London first. A consultant is following up one company over two weeks: an introduction email first, a call two days later, a second email on day four, a second call on day eight, a last email two weeks in. The consultant reads each draft and sends it as written, from their own address, in their own name. You are given one company, the contact the emails go to, the consultant's name, the Companies House register line, the stage and the latest raise as far as they are known, the company's computed signals with evidence, validated facts with quotes from the company's own website, the open roles grouped by family, the approved call script, the outcomes logged so far, the earlier emails in this sequence, and which email this is.

Style rules:
- British English, plain, warm and direct, as one person writing to another. Short sentences. No jargon, no marketing words, no exclamation marks, no bullet points, no headings.
- ${WORDS.min} to ${WORDS.max} words in the body. A greeting line ("Dear Priya," when the contact is given as a full name, "Hello," when no name is given), two or three short paragraphs with a blank line between them, then a final line that is a light question, then a sign-off line ("Best wishes," or "Kind regards,") on its own.
- Do not write the consultant's name, "Big Fish Recruitment" or a phone number under the sign-off: they are added automatically. Never write "[phone number]" or any placeholder.
- One concrete hook per email, named plainly in the first two sentences: a role open since a date, the number of roles open, the raise and what the company said it will fund, a hiring plan in the company's own words, a departure or an arrival, a signal with its evidence. Never "just checking in", never "following up on my email" as the reason. Each email in the sequence uses a different hook from the earlier ones.
- Do not invent anything not in the input: no names, titles, roles, investors, numbers, dates, awards or claims about the company that the input does not contain. If you are not sure something is in the input, leave it out. Never add a title (Mr, Mrs, Ms, Dr) the input does not give.
- Do not make claims about what other companies, funds or agencies are doing; say only what the reference material or the input supports.
- At most one proof point about Big Fish Recruitment per email, chosen for the person's role. Never quote a fee, a margin, a percentage of salary or a retainer figure; you may say the work can be contingent or retained and that the shape is agreed on the call. The ask, when there is one, is fifteen minutes on the phone to talk through what their first Head of Talent should own.
- Big Fish Recruitment places one person: the first Head of Talent Acquisition or Head of Recruitment. Never offer contractors, interim cover, embedded recruiters or a pipeline of CVs for the open roles; the point is the hire who makes the other hires happen.
- Never use these phrases: ${BANNED_PHRASES.map((p) => `"${p}"`).join(', ')}. In particular never open a sentence with "I wanted to"; say what you are doing ("I'm writing because", "I rang on Tuesday").
- The subject line is under ${SUBJECT_MAX} characters, plain, and names the hook. No "Re:", no "Following up", no clickbait.

How the person's role shapes the email (use only the note for the role given):
- founder: ${PERSONA_NOTES.founder}
- coo: ${PERSONA_NOTES.coo}
- people: ${PERSONA_NOTES.people}
- cto: ${PERSONA_NOTES.cto}
- investor: ${PERSONA_NOTES.investor}
- other roles: a short, plain note from one professional to another; one proof point at most.

Reference material about Big Fish Recruitment (paraphrase, never paste):
${valueProposition.trim()}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return describeDue(d).replace(/ \d{2}:\d{2}$/, '');
}

/** The per-company block: everything the writer may use about the company. The same words for every step, so it caches across the three drafts. */
export function buildCompanyBlock(input: Pick<FollowUpInput, 'ctx' | 'contact' | 'persona' | 'consultant' | 'vacancy' | 'approvedScript'>): string {
  const { ctx } = input;
  const lines: string[] = [];
  const rec = ctx.company.record;
  lines.push(`Company: ${ctx.company.name}${rec ? ` (Companies House ${rec.companyNumber || 'number unknown'}, ${rec.status || 'status unknown'}${rec.incorporationDate ? `, incorporated ${rec.incorporationDate}` : ''}${rec.locality ? `, ${rec.locality}` : ''}${rec.sector ? `, ${rec.sector}` : ''})` : ' (not matched on the register)'}.`);
  const stage = ctx.company.stage;
  lines.push(`Stage: ${stage ? `${stage.label}${stage.evidence ? ` ("${stage.evidence}")` : ''}` : 'unknown'}.`);
  const raise = ctx.company.latestRaise;
  lines.push(`Latest raise: ${raise ? `${[raise.amountText, raise.round].filter(Boolean).join(' ') || 'a raise'}${raise.date ? `, ${raise.date}` : ''}${raise.investors?.length ? `, investors ${raise.investors.join(', ')}` : ''}` : 'none found'}.`);
  lines.push(`Contact the emails go to: ${input.contact.name}${input.contact.role ? `, ${input.contact.role}` : ''}. Role for the notes: ${input.persona ? `${input.persona} (${PERSONA_LABELS[input.persona]})` : 'other'}.`);
  lines.push(`Consultant writing: ${input.consultant.displayName}, Big Fish Recruitment (the sign-off adds the name; do not write it).`);
  lines.push('');
  if (input.vacancy) {
    lines.push(`The role this sequence is about: ${input.vacancy.title}${input.vacancy.source ? ` (${input.vacancy.source})` : ''}${input.vacancy.firstSeen ? `, open since ${input.vacancy.firstSeen}` : ''}${input.vacancy.closingDate ? `, closes ${input.vacancy.closingDate}` : ''}.`);
  } else {
    lines.push('The sequence is not about one particular role.');
  }
  const total = ctx.openRoles.reduce((n, g) => n + g.count, 0);
  if (total) {
    lines.push(`Open roles (${total}), by family:`);
    for (const g of ctx.openRoles) lines.push(`- ${g.label}: ${g.count}${g.titles.length ? ` (${g.titles.slice(0, 6).join('; ')})` : ''}`);
  } else {
    lines.push('Open roles: none found on the careers feeds or the website.');
  }
  lines.push('');
  if (ctx.signals.length) {
    lines.push('Signals, strongest first (strength 1 to 3):');
    for (const s of ctx.signals.slice(0, 8)) {
      lines.push(`- [${s.strength}] ${s.label}: ${s.explanation}`);
      for (const e of s.evidence.slice(0, 2)) lines.push(`    evidence: ${e.text}${e.quote ? ` | quote: "${e.quote}"` : ''}`);
    }
  } else {
    lines.push('Signals: none. There is no open role and no evidence of change or pressure.');
  }
  lines.push('');
  const backing = new Set<string>();
  for (const s of ctx.signals) for (const e of s.evidence) if (e.type === 'fact' && e.id) backing.add(e.id);
  const facts = [...ctx.facts.filter((f) => backing.has(f.id)), ...ctx.facts.filter((f) => !backing.has(f.id)).slice(0, 8)];
  if (facts.length) {
    lines.push('Validated facts from the company\'s website (statement | quote | page):');
    for (const f of facts) lines.push(`- ${f.statement} | "${f.quote}" | ${f.source_url}`);
  } else {
    lines.push('Validated facts: none.');
  }
  lines.push('');
  if (input.approvedScript && (input.approvedScript.opener || input.approvedScript.emailBody)) {
    lines.push('The approved call script for this role (keep the same tone and the same facts; do not paste it):');
    if (input.approvedScript.opener) lines.push(`- opener: ${input.approvedScript.opener}`);
    if (input.approvedScript.emailSubject) lines.push(`- its email subject: ${input.approvedScript.emailSubject}`);
    if (input.approvedScript.emailBody) lines.push(`- its email: ${input.approvedScript.emailBody.replace(/\s+/g, ' ').slice(0, 900)}`);
  } else {
    lines.push('No approved script is stored for this role yet.');
  }
  return lines.join('\n');
}

const OUTCOME_WORDS: Record<string, string> = {
  spoke_to: 'spoke to them', voicemail: 'left a voicemail', callback: 'they asked for a call back', not_interested: 'not interested', meeting_booked: 'meeting booked', emailed: 'emailed', replied: 'they replied', note: 'note',
};

/** The step-specific message: which email this is, the outcomes so far, the earlier emails and their hooks. */
export function buildStepMessage(input: FollowUpInput): string {
  const lines: string[] = [];
  lines.push(`Today: ${input.today.toISOString().slice(0, 10)}. This email is due ${fmtDate(input.step.dueAt)}.`);
  lines.push(`Which email: ${input.step.purpose} (step ${input.step.stepNo}, day ${input.step.day} of the plan). ${PURPOSE_NOTES[input.step.purpose]}`);
  lines.push('');
  const recent = input.outcomes.slice(0, 8);
  if (recent.length) {
    lines.push('Outcomes logged at this company, newest first:');
    for (const o of recent) lines.push(`- ${o.created_at.slice(0, 10)}: ${OUTCOME_WORDS[o.kind] || o.kind}${o.contact_name ? ` (${o.contact_name})` : ''}${o.note ? ` | note: ${o.note.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`);
  } else {
    lines.push('Outcomes logged at this company: none yet (no call has been made or logged).');
  }
  lines.push('');
  const earlier = input.earlierEmails.filter((e) => e.stepNo < input.step.stepNo);
  if (earlier.length) {
    lines.push('Earlier emails in this sequence (hook | subject | status):');
    for (const e of earlier) lines.push(`- step ${e.stepNo}: ${e.hook || '(no hook recorded)'} | ${e.subject || '(no subject)'} | ${e.status === 'sent' ? `sent ${e.sentAt ? e.sentAt.slice(0, 10) : ''}` : e.status === 'skipped' ? 'skipped, never sent' : 'drafted, not sent yet'}`);
    const sentBodies = earlier.filter((e) => e.status === 'sent' && e.body);
    if (sentBodies.length) {
      lines.push('What was actually sent, so you do not repeat it:');
      for (const e of sentBodies) lines.push(`--- step ${e.stepNo} ---\n${(e.body || '').trim().slice(0, 1200)}`);
    }
    lines.push('Use a different hook from every earlier email above.');
  } else {
    lines.push('Earlier emails in this sequence: none.');
  }
  lines.push('');
  lines.push(`Write the ${input.step.purpose} email now: subject, body and hook, following the schema.`);
  return lines.join('\n');
}

const SIGN_OFFS = /^(best wishes|kind regards|regards|best|many thanks|thanks|thank you|all the best|warm regards|yours sincerely|with best wishes)[,.]?$/i;
const BULLET = /^\s*(?:[-*•▪]|\d+[.)])\s+/m;

/** Take the consultant's name, "Big Fish Recruitment" or a phone line off the end when the model added them anyway (the template adds them). */
export function stripSignature(body: string, consultant: { displayName: string; firstName: string }): string {
  const lines = body.replace(/\r\n?/g, '\n').trim().split('\n');
  const names = [consultant.displayName, consultant.firstName].map((n) => n.trim().toLowerCase()).filter(Boolean);
  while (lines.length) {
    const last = lines[lines.length - 1].trim().toLowerCase();
    if (!last) { lines.pop(); continue; }
    if (names.includes(last) || last === 'big fish recruitment' || last === 'big fish' || /^\[?phone number\]?$/.test(last) || /^\+?[\d\s()]{7,}$/.test(last) || /^(\d{5}\s?\d{6}|0\d{2,4}\s?\d{3,4}\s?\d{3,4})$/.test(last)) { lines.pop(); continue; }
    break;
  }
  return lines.join('\n').trim();
}

/** The checks on a draft; empty when it passes. */
export function followUpDraftFlags(draft: FollowUpDraft, input: FollowUpInput, inputText: string): string[] {
  const flags: string[] = [];
  const body = (draft.body || '').trim();
  const words = wordCount(body);
  if (words < WORDS.min || words > WORDS.max) flags.push(`body ${words} words (want ${WORDS.min} to ${WORDS.max})`);
  const subj = (draft.subject || '').trim();
  if (!subj || subj.length > SUBJECT_MAX) flags.push(`subject ${subj.length} characters (want 1 to ${SUBJECT_MAX})`);
  if (/^(re|fwd?):/i.test(subj) || /following up/i.test(subj)) flags.push('subject reads as a reply or a chaser');
  if (!(draft.hook || '').trim()) flags.push('hook missing');
  const all = `${subj}\n${body}`;
  const fee = feeFigureViolations(all);
  if (fee.length) flags.push(`fee figure: ${fee[0].slice(0, 80)}`);
  const banned = bannedPhraseHits(all);
  if (banned.length) flags.push(`banned phrase: ${banned.join(', ')}`);
  if (/!/.test(all)) flags.push('exclamation mark');
  if (BULLET.test(body)) flags.push('bullet list');
  if (/\[[^\]]*\]/.test(body)) flags.push('placeholder in square brackets');
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] || '';
  if (!SIGN_OFFS.test(last)) flags.push('no sign-off line at the end (e.g. "Best wishes,")');
  const beforeSignOff = SIGN_OFFS.test(last) ? lines.slice(0, -1) : lines;
  const question = beforeSignOff[beforeSignOff.length - 1] || '';
  if (!/\?\s*$/.test(question)) flags.push('does not end with a question');
  if (!/^(dear|hello|hi|good (morning|afternoon))\b/i.test(lines[0] || '')) flags.push('no greeting line');
  const earlierHooks = input.earlierEmails.filter((e) => e.stepNo < input.step.stepNo && e.hook).map((e) => e.hook!.trim().toLowerCase());
  if (earlierHooks.includes((draft.hook || '').trim().toLowerCase())) flags.push('same hook as an earlier email');
  const named = namedPeopleFlags({ call: { opener: '', discovery_questions: [], objections: [], voicemail: '', close: '' }, email: { subject: subj, body, followup: '' } }, { contactNames: [input.contact.name], consultantName: input.consultant.displayName, inputText });
  flags.push(...named);
  return flags;
}

export interface SequenceRow {
  id: string;
  company_search_id: string;
  consultant_id: string | null;
  created_by: string | null;
  contact_name: string;
  contact_email: string;
  contact_role: string | null;
  vacancy_id: string | null;
  status: string;
  started_at: string;
}

export interface StepRow {
  id: string;
  sequence_id: string;
  step_no: number;
  kind: 'call' | 'email';
  day: number;
  label: string | null;
  due_at: string;
  status: string;
  subject: string | null;
  body: string | null;
  hook: string | null;
  draft_generated_at: string | null;
  draft_context_key: string | null;
  draft_flags: string[] | null;
  sent_message_id: string | null;
  outcome_id: string | null;
  completed_at: string | null;
}

export interface SequenceContext {
  ctx: CopyContext;
  persona: Persona | null;
  consultant: { displayName: string; firstName: string };
  vacancy: DraftVacancy | null;
  approvedScript: ApprovedScript | null;
  outcomes: DraftOutcome[];
  companyName: string;
  /** What the drafts are written from; a change means a due draft is written again. */
  contextKey: string;
}

/** A short, stable key for the state a draft was written from: open vacancies, active facts, outcomes. */
export function draftContextKey(parts: { vacancies: Array<{ vacancy_key?: string; title: string; closing_date?: string | null; closingDate?: string | null }>; factKeys: string[]; outcomeCount: number }): string {
  const v = parts.vacancies.map((x) => `${x.vacancy_key || x.title}@${x.closing_date || x.closingDate || ''}`).sort().join('|');
  const f = [...parts.factKeys].sort().join('|');
  const text = `${v}#${f}#${parts.outcomeCount}`;
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(16)}:${parts.vacancies.length}v${parts.factKeys.length}f${parts.outcomeCount}o`;
}

export function personaForRole(role: string | null | undefined): Persona | null {
  const cls = classifyRole(role || '');
  if (!cls) return null;
  if (cls.key === 'founder') return 'founder';
  if (cls.key === 'coo' || cls.key === 'exec') return 'coo';
  if (cls.key === 'cto') return 'cto';
  if (cls.key === 'people' || cls.key === 'talent') return 'people';
  if (cls.key === 'investor') return 'investor';
  return null;
}

export function purposeForStep(step: Pick<StepRow, 'day' | 'kind'>, steps: Array<Pick<StepRow, 'day' | 'kind' | 'step_no'>>): StepPurpose {
  const emails = steps.filter((s) => s.kind === 'email').sort((a, b) => a.step_no - b.step_no);
  const idx = emails.findIndex((s) => s.day === step.day);
  if (idx <= 0) return 'first';
  if (idx === emails.length - 1) return 'last';
  return 'second';
}

export function buildFollowUpInput(sc: SequenceContext, seq: SequenceRow, step: StepRow, steps: StepRow[], today: Date): FollowUpInput {
  return {
    ctx: sc.ctx,
    contact: { name: seq.contact_name, role: seq.contact_role, email: seq.contact_email },
    persona: sc.persona,
    consultant: sc.consultant,
    vacancy: sc.vacancy,
    approvedScript: sc.approvedScript,
    outcomes: sc.outcomes,
    earlierEmails: steps.filter((s) => s.kind === 'email' && s.step_no < step.step_no).map((s) => ({ stepNo: s.step_no, sentAt: s.status === 'sent' ? s.completed_at : null, status: s.status, subject: s.subject, body: s.body, hook: s.hook })),
    step: { stepNo: step.step_no, day: step.day, purpose: purposeForStep(step, steps), dueAt: step.due_at },
    today,
  };
}

