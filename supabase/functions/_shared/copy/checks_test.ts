import { assert, assertEquals } from '../test-assert.ts';
import { allFlags, BANNED_PHRASES, bannedPhraseHits, feeFigureViolations, FIRM_NAME, namedPeopleFlags, signatureFlags, styleFlags, trimToThree, wordCount, wordLimitFlags, type PersonaCopy } from './checks.ts';

const w = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

function good(): PersonaCopy {
  return {
    call: {
      opener: w(100),
      discovery_questions: ['Who is running the hiring for the nine open roles at the moment?', 'How much of the founders\' week goes on interviews?', 'What does the plan for the next twelve months look like?'],
      objections: [{ objection: 'We have an internal recruiter.', response: 'Understood.' }, { objection: 'No budget until the next round.', response: 'That is the right order.' }, { objection: 'Send an email.', response: 'Happy to.' }],
      voicemail: w(50),
      close: 'Fifteen minutes next week to talk through the hiring plan for the next twelve months?',
    },
    email: { subject: 'Your nine open roles', body: w(115) + `\n\nCraig\n${FIRM_NAME}\n[phone number]`, followup: w(60) },
  };
}

Deno.test('fee-figure check: pounds or a percentage with fee, margin, retainer or per hire in the same sentence', () => {
  assertEquals(feeFigureViolations('Our fee never exceeds £4,500.').length, 1);
  assertEquals(feeFigureViolations('Permanent fees never exceed 15%.').length, 1);
  assertEquals(feeFigureViolations('Most firms charge 20 per cent as a fee.').length, 1);
  assertEquals(feeFigureViolations('Our rate is 14% lower than most.').length, 1);
  assertEquals(feeFigureViolations('A retainer of £5,000 up front.').length, 1);
  assertEquals(feeFigureViolations('Our retainer is 30% of the fee.').length, 1);
  assertEquals(feeFigureViolations('A placement fee of 18% on the first-year salary.').length, 1);
  assertEquals(feeFigureViolations('Around £3,000 per hire once the function is in place.').length, 1);
  assertEquals(feeFigureViolations('Cost per hire fell 40% at a company we work with.').length, 1);
  assertEquals(feeFigureViolations('We charge 10 per cent on permanent placements.').length, 1);
  assertEquals(feeFigureViolations('Headcount grew 61% year on year.').length, 0);
  assertEquals(feeFigureViolations('Raised £8m in a Series A led by Headline. Nine roles are open.').length, 0);
  assertEquals(feeFigureViolations('Thirteen open roles on the Ashby board, 40% of them in engineering.').length, 0);
  assertEquals(feeFigureViolations('Fifteen minutes is all it takes to talk through the fee model.').length, 0);
});

Deno.test('banned phrases: the model tells, the start-up cliches, the placeholder marker, and exclamation marks', () => {
  assertEquals(bannedPhraseHits('I hope this finds you well. I wanted to reach out to touch base.'), ['hope this finds you well', 'reach out', 'touch base', 'i wanted to']);
  assertEquals(bannedPhraseHits('We find rockstar engineers and 10x ninjas in the war for talent.'), ['rockstar', 'ninja', '10x', 'war for talent']);
  assertEquals(bannedPhraseHits('I\'d love to help you become a unicorn with world-class talent.'), ['world-class', 'world-class talent', 'i\'d love to', 'unicorn']);
  assertEquals(bannedPhraseHits('I’d love to chat.'), ['i\'d love to'], 'a curly apostrophe still matches');
  assertEquals(bannedPhraseHits('A game-changer with cutting-edge tooling.'), ['game-changer', 'cutting-edge']);
  assertEquals(bannedPhraseHits('We placed a Head of Recruitment [Craig to confirm].'), ['craig to confirm']);
  assertEquals(bannedPhraseHits('A short note about your open engineering roles.'), []);
  assert(!BANNED_PHRASES.some((p) => /supply|cover|6[.:]30am/.test(p)), 'the supply-teaching entries are gone');
  const c = good();
  c.email.body = 'Great news!';
  assert(styleFlags(c).includes('exclamation mark'));
  assertEquals(styleFlags(good()), []);
});

Deno.test('word limits', () => {
  assertEquals(wordLimitFlags(good()), []);
  assertEquals(wordCount('  one two\nthree '), 3);
  const c = good();
  c.call.opener = w(130);
  c.call.voicemail = w(30);
  c.email.body = w(160);
  c.email.followup = w(90);
  c.email.subject = 'A subject line that runs on and on and on for far too many characters';
  c.call.discovery_questions = ['one'];
  c.call.objections = [];
  c.call.close = '';
  const flags = wordLimitFlags(c);
  assert(flags.some((f) => f.startsWith('opener 130')));
  assert(flags.some((f) => f.startsWith('voicemail 30')));
  assert(flags.some((f) => f.startsWith('email body 160')));
  assert(flags.some((f) => f.startsWith('follow-up 90')));
  assert(flags.some((f) => f.startsWith('subject ')));
  assert(flags.some((f) => f.includes('discovery questions')));
  assert(flags.some((f) => f.includes('objections')));
  assert(flags.includes('close missing'));
});

Deno.test('named people must be in the contacts or the input text', () => {
  const input = { contactNames: ['Sarah Green', 'Dr Amy Jones'], consultantName: 'Craig Springett', consultantFirstName: 'Craig', inputText: 'Lumenly in London. Senior Backend Engineer. Series A led by Headline.' };
  const c = good();
  c.email.body = `Hi Sarah, Craig Springett here from ${FIRM_NAME}. Your Senior Backend Engineer advert on Ashby caught my eye, and the Series A led by Headline.\n\nCraig\n${FIRM_NAME}`;
  assertEquals(namedPeopleFlags(c, input), []);
  c.email.body = 'Dear Mrs Patel, I saw that John Appleby has left.';
  const flags = namedPeopleFlags(c, input);
  assert(flags.includes('named person not in input: Mrs Patel'));
  assert(flags.includes('possible invented name: John Appleby'));
  // A surname followed by a line break is not a first name.
  c.email.body = 'Dear Dr Jones\n\nYou have nine roles open.';
  assertEquals(namedPeopleFlags(c, input), []);
  c.email.body = 'Dear Mr Nicholls\n\nOne thing.';
  assertEquals(namedPeopleFlags(c, input), ['named person not in input: Mr Nicholls']);
  // The firm's own name is never an invented person, whatever the input says.
  c.email.body = `Big Fish Recruitment placed a Head of Recruitment at a company we work with.`;
  assertEquals(namedPeopleFlags(c, { ...input, inputText: '' }), []);
  const four = good();
  four.call.objections = [...four.call.objections, { objection: 'x', response: 'y' }];
  assertEquals(trimToThree(four).call.objections.length, 3);
  assertEquals(allFlags(good(), input), []);
});

Deno.test('the email must be signed by the consultant\'s first name or the firm', () => {
  const c = good();
  c.email.body = `Hi Sarah,\n\nYour nine open roles.\n\nCraig\n${FIRM_NAME}\n[phone number]`;
  assertEquals(signatureFlags(c, 'Craig'), []);
  c.email.body = 'Hi Sarah,\n\nYour nine open roles.\n\nBest wishes';
  assertEquals(signatureFlags(c, 'Craig'), ['email not signed by Craig']);
  c.email.body = `Hi Sarah,\n\nThe ${FIRM_NAME} team\n[phone number]`;
  assertEquals(signatureFlags(c, null), []);
  assertEquals(signatureFlags(c, 'Isobel'), [], 'the firm name alone satisfies the check');
  c.email.body = 'Hi Sarah,\n\nThe team\n[phone number]';
  assertEquals(signatureFlags(c, null), [`email not signed by ${FIRM_NAME}`]);
});
