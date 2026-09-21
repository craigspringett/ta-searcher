// Post-generation checks on scripts and emails (docs/PHASE-3-BRIEF.md,
// deliverable 3). Each check returns quality flags; the generator regenerates
// once with a correction when any flag is raised and stores whatever flags
// remain.

export interface CallCopy {
  opener: string;
  discovery_questions: string[];
  objections: Array<{ objection: string; response: string }>;
  voicemail: string;
  close: string;
}

export interface EmailCopy {
  subject: string;
  body: string;
  followup: string;
}

export interface PersonaCopy {
  call: CallCopy;
  email: EmailCopy;
}

export const BANNED_PHRASES = [
  // Services we do not offer (Craig, 15 September 2026): long-term, fixed-term, permanent and planned cover only.
  'daily supply',
  'day-to-day supply',
  'day to day supply',
  'daily cover',
  'day-to-day cover',
  'same-day cover',
  'same day cover',
  'short-notice cover',
  'short notice cover',
  'last-minute cover',
  'last minute cover',
  'ad hoc cover',
  'ad-hoc cover',
  'emergency cover',
  '6.30am',
  '6:30am',
  'hope this finds you well',
  'hope this email finds you well',
  'hope you are well',
  'hope you\'re well',
  'reach out',
  'reaching out',
  'synergy',
  'synergies',
  'circle back',
  'touch base',
  'game-changer',
  'game changer',
  'leverage',
  'best-in-class',
  'world-class',
  'unlock',
  'seamless',
  'cutting-edge',
  'as a valued',
  'i wanted to',
];

export const WORD_LIMITS = {
  opener: { min: 90, max: 120 },
  voicemail: { min: 40, max: 60 },
  emailBody: { max: 150 },
  followup: { max: 80 },
  subjectChars: { max: 60 },
};

export function wordCount(s: string): number {
  return (s || '').trim().split(/\s+/).filter(Boolean).length;
}

export function splitSentences(text: string): string[] {
  return (text || '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * A pound sign next to a number, with "margin", "fee" or "%" in the same
 * sentence, is a fee figure. So is a percentage next to "margin", "fee",
 * "rate" or "charge". Both are refused whatever the wording around them.
 */
export function feeFigureViolations(text: string): string[] {
  const out: string[] = [];
  const FEE = '(?:margins?|fees?|commission|mark-?up|our rates?|daily rate|day rate|charge rate|we charge|placement (?:fee|rate))';
  const NEAR = '(?:\\W+\\w+){0,6}\\W+';
  // A pound figure with margin, fee or a percentage anywhere in the sentence.
  const poundRule = (s: string) => (/£\s?\d/.test(s) || /\d\s?(?:pounds|gbp)\b/i.test(s)) && /\b(margin|margins|fee|fees|%)/i.test(s);
  // A percentage within six words of a fee word, either way round, so
  // "99% APSCo compliance ... our margin is visible" in one sentence passes.
  const pctNearFee = new RegExp(`\\b${FEE}${NEAR}\\d+(?:\\.\\d+)?\\s?(?:%|per ?cent)|\\d+(?:\\.\\d+)?\\s?(?:%|per ?cent)${NEAR}${FEE}\\b`, 'i');
  for (const s of splitSentences(text)) {
    if (poundRule(s) || pctNearFee.test(s)) out.push(s);
  }
  return out;
}

export function bannedPhraseHits(text: string): string[] {
  const lower = (text || '').toLowerCase();
  return BANNED_PHRASES.filter((p) => lower.includes(p));
}

/**
 * The model often offers four or five objections or questions; the first
 * three are kept rather than sending the draft back for that alone.
 */
export function trimToThree(copy: PersonaCopy): PersonaCopy {
  const c = copy.call || ({} as CallCopy);
  return { ...copy, call: { ...c, discovery_questions: (c.discovery_questions || []).slice(0, 3), objections: (c.objections || []).slice(0, 3) } };
}

/** Every field of the copy joined, for whole-output checks. */
export function flattenCopy(copy: PersonaCopy): string {
  const c = copy.call || ({} as CallCopy);
  const e = copy.email || ({} as EmailCopy);
  return [c.opener, ...(c.discovery_questions || []), ...(c.objections || []).flatMap((o) => [o.objection, o.response]), c.voicemail, c.close, e.subject, e.body, e.followup].filter(Boolean).join('\n');
}

export function wordLimitFlags(copy: PersonaCopy): string[] {
  const flags: string[] = [];
  const c = copy.call || ({} as CallCopy);
  const e = copy.email || ({} as EmailCopy);
  const opener = wordCount(c.opener);
  if (opener < WORD_LIMITS.opener.min || opener > WORD_LIMITS.opener.max) flags.push(`opener ${opener} words (want ${WORD_LIMITS.opener.min} to ${WORD_LIMITS.opener.max})`);
  const vm = wordCount(c.voicemail);
  if (vm < WORD_LIMITS.voicemail.min || vm > WORD_LIMITS.voicemail.max) flags.push(`voicemail ${vm} words (want ${WORD_LIMITS.voicemail.min} to ${WORD_LIMITS.voicemail.max})`);
  const body = wordCount(e.body);
  if (body > WORD_LIMITS.emailBody.max) flags.push(`email body ${body} words (limit ${WORD_LIMITS.emailBody.max})`);
  const fu = wordCount(e.followup);
  if (fu > WORD_LIMITS.followup.max) flags.push(`follow-up ${fu} words (limit ${WORD_LIMITS.followup.max})`);
  const subj = (e.subject || '').length;
  if (subj === 0 || subj > WORD_LIMITS.subjectChars.max) flags.push(`subject ${subj} characters (limit ${WORD_LIMITS.subjectChars.max})`);
  if ((c.discovery_questions || []).length !== 3) flags.push(`${(c.discovery_questions || []).length} discovery questions (want 3)`);
  if ((c.objections || []).length !== 3) flags.push(`${(c.objections || []).length} objections (want 3)`);
  if (!c.close?.trim()) flags.push('close missing');
  return flags;
}

export function styleFlags(copy: PersonaCopy): string[] {
  const flags: string[] = [];
  const all = flattenCopy(copy);
  const fee = feeFigureViolations(all);
  if (fee.length) flags.push(`fee figure: ${fee[0].slice(0, 80)}`);
  const banned = bannedPhraseHits(all);
  if (banned.length) flags.push(`banned phrase: ${banned.join(', ')}`);
  if (/!/.test(all)) flags.push('exclamation mark');
  return flags;
}

const TITLE_NAME_RE = /\b(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof|Professor|Sir|Dame|Rev|Fr)\.?[ \t]+(?:[A-Z][a-z'’-]+[ \t]+(?=[A-Z]))?([A-Z][A-Za-z'’-]+)/g;
const PAIR_RE = /\b([A-Z][a-z'’-]{1,})[ \t]+([A-Z][a-z'’-]{1,})\b/g;

const NOT_A_NAME = new Set(['The', 'This', 'That', 'These', 'Those', 'Our', 'Your', 'We', 'If', 'When', 'What', 'Which', 'Who', 'How', 'Why', 'Where', 'One', 'Two', 'Three', 'Head', 'Deputy', 'Assistant', 'Teaching', 'Teacher', 'Company', 'Business', 'Manager', 'Senco', 'SENCO', 'Trust', 'Ofsted', 'DfE', 'Good', 'Outstanding', 'Requires', 'Improvement', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'Autumn', 'Spring', 'Summer', 'Term', 'Lot', 'Framework', 'Best', 'Kind', 'Many', 'Thanks', 'Thank', 'Dear', 'Hello', 'Hi', 'Morning', 'Afternoon', 'Subject', 'Re', 'From', 'To', 'On', 'In', 'At', 'For', 'With', 'Of', 'And', 'But', 'Or', 'Not', 'No', 'Yes', 'It', 'Is', 'Are', 'Was', 'Were', 'Have', 'Has', 'Had', 'Will', 'Would', 'Could', 'Should', 'Can', 'May', 'Might', 'Do', 'Does', 'Did', 'Also', 'Just', 'Only', 'Very', 'Every', 'Each', 'Some', 'Any', 'All', 'Most', 'More', 'Less', 'Fifteen', 'Ten', 'Five', 'A', 'An', 'I', 'You', 'They', 'He', 'She', 'Then', 'Now', 'Today', 'Tomorrow', 'Next', 'Last', 'First', 'Second', 'Third', 'New', 'Old', 'Live', 'Open', 'Long', 'Short', 'Please', 'Sorry', 'Great', 'Happy', 'Glad', 'Warm', 'Regards', 'Sincerely', 'Cheers', 'Ps', 'PS', 'Nb', 'NB']);

function words(s: string): Set<string> {
  return new Set((s || '').toLowerCase().replace(/[’']/g, "'").split(/[^a-z0-9']+/).filter(Boolean));
}

/**
 * Every named person in the copy must be in the input. "Mr Sear" needs a
 * contact whose surname is Sear (or the consultant); any other capitalised
 * pair such as "Jane Smith" needs both words somewhere in the input text.
 */
export function namedPeopleFlags(copy: PersonaCopy, input: { contactNames: string[]; consultantName: string | null; inputText: string }): string[] {
  const all = flattenCopy(copy);
  const allowedSurnames = new Set<string>();
  for (const n of [...input.contactNames, input.consultantName || '']) {
    for (const w of n.split(/\s+/)) if (w) allowedSurnames.add(w.toLowerCase().replace(/[^a-z'’-]/g, ''));
  }
  const inputWords = words(input.inputText + ' ' + input.contactNames.join(' ') + ' ' + (input.consultantName || ''));
  const flags = new Set<string>();
  for (const m of all.matchAll(TITLE_NAME_RE)) {
    const surname = m[1].toLowerCase().replace(/[^a-z'’-]/g, '');
    if (!allowedSurnames.has(surname)) flags.add(`named person not in input: ${m[0]}`);
  }
  for (const m of all.matchAll(PAIR_RE)) {
    const [a, b] = [m[1], m[2]];
    if (NOT_A_NAME.has(a) || NOT_A_NAME.has(b)) continue;
    const la = a.toLowerCase().replace(/[’']/g, "'");
    const lb = b.toLowerCase().replace(/[’']/g, "'");
    if (inputWords.has(la) && inputWords.has(lb)) continue;
    // Only flag pairs that read as a person: neither word is a common noun in the input.
    if (inputWords.has(la) || inputWords.has(lb)) continue;
    flags.add(`possible invented name: ${a} ${b}`);
  }
  return Array.from(flags);
}

/** The email must be signed with the consultant's first name (or "WhoFoundWho" when no consultant is assigned). */
export function signatureFlags(copy: PersonaCopy, consultantFirstName: string | null): string[] {
  const body = copy.email?.body || '';
  const tail = body.trim().split('\n').slice(-4).join('\n').toLowerCase();
  const name = (consultantFirstName || 'WhoFoundWho').toLowerCase();
  return tail.includes(name) ? [] : [`email not signed by ${consultantFirstName || 'WhoFoundWho'}`];
}

export function allFlags(copy: PersonaCopy, input: { contactNames: string[]; consultantName: string | null; consultantFirstName?: string | null; inputText: string }): string[] {
  return [...wordLimitFlags(copy), ...styleFlags(copy), ...namedPeopleFlags(copy, input), ...signatureFlags(copy, input.consultantFirstName ?? null)];
}
