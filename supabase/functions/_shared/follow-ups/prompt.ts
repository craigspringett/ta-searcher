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
/** The last email carries Craig's five numbers on short lines (14 October 2026), so it may run longer. */
export const WORDS_LAST = { min: 90, max: 175 };
export function wordsFor(purpose: StepPurpose): { min: number; max: number } { return purpose === 'last' ? WORDS_LAST : WORDS; }
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
  /** What was pasted or typed for this rewrite (6 October 2026): buyer intent signals, likely-to-buy reasons, anything to work in. */
  instructions?: string | null;
}

export interface FollowUpDraft {
  subject: string;
  body: string;
  hook: string;
  /** When the notes held instructions (8 October 2026): any the email does not carry out, in the model's own words; empty when all are met or there were none. */
  notesMissed?: string;
}

export const FOLLOW_UP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    subject: { type: 'string', description: `Under ${SUBJECT_MAX} characters, plain, names the hook. No "Re:", no clickbait.` },
    body: { type: 'string', description: `${WORDS.min} to ${WORDS.max} words of plain text: a greeting line, two or three short paragraphs separated by blank lines, a final line that is a light question, then a sign-off line such as "Best wishes," on its own. No bullet points, no name under the sign-off.` },
    hook: { type: 'string', description: 'The one concrete thing this email is about, in a few words, e.g. "the three engineering roles open since July".' },
    notesFollowed: { type: 'string', description: "When the sender's notes contain instructions (mention this, lead with that, leave out the other), one short line per instruction saying which sentence of the email carries it out. 'none' when the notes contain no instruction." },
    notesMissed: { type: 'string', description: "Any instruction in the sender's notes that the email does NOT carry out, and why. An empty string when every instruction is carried out or there were none. Be honest: this is checked." },
  },
  required: ['subject', 'body', 'hook', 'notesFollowed', 'notesMissed'],
};

const SEND_DETAILS = 'Every email invites a one-line reply in plain words: "send me the details of what you need" (the role, the timing, as far as they know it) and you will come back and arrange a call. This sits beside the ask for a call, never instead of it.';

const PURPOSE_NOTES: Record<StepPurpose, string> = {
  first: `This is the first email and the opening of the sequence: nothing has been sent or said before it unless the outcomes below show a call or a message. It goes in this order. (1) The first sentence names Chris Donnelly so the name is familiar, in Craig's words from the reference material: "You may know Chris Donnelly: in my most recent search I have just helped place the first Head of Recruitment at Searchable, his £80m Series A valued AI start-up." Use exactly that description of the company and add nothing to it. Quote Chris's own line about the search only when the testimonial section carries a real quote (never invent one, never paraphrase a marker). (2) One sentence: you run every search yourself and speak to every candidate before a founder sees them. (3) The one thing you saw at this company, with its evidence. (4) A short paragraph in plain words, without naming any firm: there are a lot of fancy recruitment models around (subscription recruitment, fixed-term contracts, on-site talent partners) and in your experience they tend to come and go; what you offer is tried and trusted, exclusive contingent search for the permanent Head of Talent Acquisition or Head of Recruitment, with a rebate, and it does what it says on the tin. Never name a competitor, never say a named firm has failed, never give a rebate period. (5) The ask: say you will ring in the next day or two, and that they can send you the details of what they need and you will come back to arrange a call. Do not claim to have called or left a message unless an outcome says so. End with a light question. ${SEND_DETAILS}`,
  second: `This is the second email, four days after the first, and it is the "founder to founder" email. It must still be tied to something real at this company that the first email did not use: a role that has been open a while, a new role, the raise and what it will fund, a hiring plan in the company's own words, a departure or an arrival on the team. Do not repeat the first email; refer to it in half a sentence at most. When the contact is a founder or CEO the subject names it, for example "Founder to founder" or "Founder to founder: the three roles open since July" (under the subject limit). When the contact is someone else, keep the founder point in the body ("I run my own firm") and make the subject plain. In the body say you are a founder too, with five years running two start-ups, so you understand the stresses of the stage, how much the right early hires matter, the candidate experience, and how the business looks to the people it wants to attract; and that a Head of Recruitment or Talent Acquisition Manager is vital and worth getting in as soon as budgets permit. Say it as one person to another, never that their hiring is broken. Keep it tight: 115 to 135 words, with the founder paragraph at three sentences at most. Refer to the first email only if the earlier-emails list says it was sent, and then by the day it was sent; if it was not sent, do not mention it. End with a light question. ${SEND_DETAILS}`,
  last: `This is the last email, two weeks in, and it carries your five numbers, laid out as five short lines under one plain sentence that introduces them, in the style of a short card. Use exactly these figures from the reference material and no others: 50+ Talent Acquisition leaders and recruiters placed; 5 hand-picked candidates in every shortlist, on a bespoke, easy-to-use portal for easy management; 1 in 3 interview-to-placement ratio; 18 years recruiting; 5 years running 2 start-ups. Each line starts with the number, then a plain few words. The five lines are the one exception to "no bullet points": no dashes, bullets or numbering, just the number at the start of its line. After the lines, one sentence on the offer: exclusive contingent search for the permanent Head of Talent Acquisition or Head of Recruitment, with a rebate, nothing flashy. Leave the door open without pressing: say plainly that you will not keep emailing. Say they can send you the details of what they need whenever it comes up and you will arrange a call. End with a light question that is easy to say no to. This email does not need the one concrete hook the others have; name the hook as "five numbers". Say "I have written before" or how many emails went only as far as the earlier-emails list shows were sent; if none were sent, do not mention earlier emails. ${SEND_DETAILS}`,
};

/** The stable rules. Cached; keep anything company-specific out of it. */
export function buildFollowUpSystemPrompt(valueProposition: string): string {
  return `You write short follow-up emails for Big Fish Recruitment, a recruitment firm that places Heads of Talent Acquisition and Heads of Recruitment into seed and Series A start-ups in the United Kingdom, London first. A consultant is following up one company over two weeks: an introduction email first, a call two days later, a second email on day four, a second call on day eight, a last email two weeks in. The consultant reads each draft and sends it as written, from their own address, in their own name. You are given one company, the contact the emails go to, the consultant's name, the Companies House register line, the stage and the latest raise as far as they are known, the company's computed signals with evidence, validated facts with quotes from the company's own website, the open roles grouped by family, the approved call script, the outcomes logged so far, the earlier emails in this sequence, and which email this is.

Style rules:
- British English, plain, warm and direct, as one person writing to another. Short sentences. No jargon, no marketing words, no exclamation marks, no bullet points, no headings (the last email's five number lines are the one exception, see its note).
- ${WORDS.min} to ${WORDS.max} words in the body (up to ${WORDS_LAST.max} for the last email). A greeting line ("Hey Priya," with the first name when the contact is given as a name, "Hello," when no name is given; never "Dear", never "Hi"), two or three short paragraphs with a blank line between them, then a final line that is a light question, then a sign-off line ("Best wishes," or "Kind regards,") on its own.
- Do not write the consultant's name, "Big Fish Recruitment" or a phone number under the sign-off: they are added automatically. Never write "[phone number]" or any placeholder.
- One concrete hook per email, named plainly in the first two sentences: a role open since a date, the number of roles open, the raise and what the company said it will fund, a hiring plan in the company's own words, a departure or an arrival, a signal with its evidence. Never "just checking in", never "following up on my email" as the reason. Each email in the sequence uses a different hook from the earlier ones.
- Open vacancies (Craig, 14 October 2026: keep these in): whenever the input lists open roles, every email mentions them plainly with how long they have been open, using the "open since" dates given (for example "the three engineering roles open since July" or "the Head of Sales role, open since 2 September"). Say how long in months or weeks from today's date, never invent a date, and when no date is given say they are open now. In the first email the open roles are the one thing you saw at this company whenever there are any. In the second and last emails they may be a supporting sentence while another hook leads, so the hooks still differ. When there are no open roles, do not mention any.
- Do not invent anything not in the input: no names, titles, roles, investors, numbers, dates, awards or claims about the company that the input does not contain. If you are not sure something is in the input, leave it out. Never add a title (Mr, Mrs, Ms, Dr) the input does not give.
- Do not make claims about what other companies, funds or agencies are doing; say only what the reference material or the input supports. The one allowed statement about the market is the reference material's: fancy recruitment models (subscription, fixed-term contracts, on-site talent partners) tend to come and go. Never name a firm.
- At most one proof point about Big Fish Recruitment per email, chosen for the person's role (the last email's five numbers are the exception). Never quote a fee, a margin, a percentage of salary or a retainer figure; you may say the work can be contingent or retained and that the shape is agreed on the call. The ask, when there is one, is fifteen minutes on the phone to talk through what their first Head of Talent should own.
- Big Fish Recruitment places one person: the first Head of Talent Acquisition or Head of Recruitment. Never offer contractors, interim cover, embedded recruiters or a pipeline of CVs for the open roles (you may name those models only in the first email's one sentence about what you do differently); the point is the hire who makes the other hires happen.
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
    for (const g of ctx.openRoles) lines.push(`- ${g.label}: ${g.count}${g.titles.length ? ` (${g.titles.slice(0, 6).map((t, i) => (g.firstSeen && g.firstSeen[i] ? `${t}, open since ${g.firstSeen[i]}` : t)).join('; ')})` : ''}`);
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
  const notes = (input.instructions || '').replace(/\r\n?/g, '\n').trim();
  if (notes) {
    lines.push('');
    lines.push("THE SENDER'S NOTES FOR THIS EMAIL. They may be two things, often both: material pasted from the company's page (a buyer intent signal, a likely-to-buy reason, a line about the latest raise), and instructions in the sender's own words (\"mention we have candidates who match this\", \"lead with the Series A\", \"don't mention the layoffs\").");
    lines.push("Rules of precedence: an instruction in the notes MUST be carried out, in the email itself, not just the subject. The notes are part of the input, so a claim the sender makes in them (that they have candidates who match, that they placed a Head of Talent at a similar company) may be stated plainly as their claim; it is not inventing. Pasted material is the hook and the evidence: build the email around it in the sender's voice. The only rules that still override the notes are the hard ones: never a margin, fee, percentage or day rate; never a banned phrase; nothing about the company beyond the input and the notes; the length and the shape above. If an instruction cannot be carried out because of one of those, say which in notesMissed.");
    lines.push('--- notes ---');
    lines.push(notes.slice(0, 4000));
    lines.push('--- end of notes ---');
  }
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
  const limit = wordsFor(input.step.purpose);
  if (words < limit.min || words > limit.max) flags.push(`body ${words} words (want ${limit.min} to ${limit.max})`);
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
  if (input.step.purpose !== 'last' && BULLET.test(body)) flags.push('bullet list');
  if (input.step.purpose === 'last' && BULLET.test(body)) flags.push('bullets or numbering on the number lines: start each line with the figure');
  if (/\[[^\]]*\]/.test(body)) flags.push('placeholder in square brackets');
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] || '';
  if (!SIGN_OFFS.test(last)) flags.push('no sign-off line at the end (e.g. "Best wishes,")');
  const beforeSignOff = SIGN_OFFS.test(last) ? lines.slice(0, -1) : lines;
  const question = beforeSignOff[beforeSignOff.length - 1] || '';
  if (!/\?\s*$/.test(question)) flags.push('does not end with a question');
  if (!/^(hey|dear|hello|hi|good (morning|afternoon))\b/i.test(lines[0] || '')) flags.push('no greeting line');
  if (/^dear\b/i.test(lines[0] || '')) flags.push('greeting is "Dear": start with "Hey <first name>,"');
  // Craig, 14 October 2026: every email invites the reader to send the details; each email carries its own idea.
  if (!/\bsend (?:me|over)\b[^.?\n]*\b(?:details|detail|brief|spec)\b/i.test(body)) flags.push('missing the invitation to send you the details of what they need');
  if (input.step.purpose === 'first' && !/chris donnelly/i.test(lines.slice(0, 3).join(' '))) flags.push('the first email should name Chris Donnelly and Searchable in its opening lines');
  if (input.step.purpose === 'second') {
    if (input.persona === 'founder' && !/founder to founder/i.test(subj)) flags.push('the second email to a founder or CEO should say "Founder to founder" in the subject');
    if (!/\bfounder\b/i.test(body)) flags.push('the second email should say you are a founder too');
  }
  if (input.step.purpose === 'last') {
    for (const [re, what] of [[/50\+/, '50+ placed'], [/18 years/i, '18 years recruiting'], [/1 in 3/i, '1 in 3 interview-to-placement']] as Array<[RegExp, string]>) if (!re.test(body)) flags.push(`the five numbers email is missing "${what}"`);
  }
  const earlierHooks = input.earlierEmails.filter((e) => e.stepNo < input.step.stepNo && e.hook).map((e) => e.hook!.trim().toLowerCase());
  if (earlierHooks.includes((draft.hook || '').trim().toLowerCase())) flags.push('same hook as an earlier email');
  // The sender's instructions (8 October 2026): the model says which it did not carry out; that is a failed check and gets the rewrite.
  const missed = (draft.notesMissed || '').trim();
  if ((input.instructions || '').trim() && missed && !/^(none|n\/a|nothing|-|no)\.?$/i.test(missed)) flags.push(`the sender's instruction was not carried out: ${missed.slice(0, 200)}`);
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
  auto_send?: boolean | null;
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
  edited_at?: string | null;
  edited_by_name?: string | null;
  notes?: string | null;
  sent_automatically?: boolean | null;
  auto_attempted_at?: string | null;
  auto_note?: string | null;
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

export function buildFollowUpInput(sc: SequenceContext, seq: SequenceRow, step: StepRow, steps: StepRow[], today: Date, instructions: string | null = null): FollowUpInput {
  return {
    instructions,
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

