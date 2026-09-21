import { assert, assertEquals } from '../test-assert.ts';
import { allFlags, bannedPhraseHits, signatureFlags, trimToThree, feeFigureViolations, namedPeopleFlags, styleFlags, wordCount, wordLimitFlags, type PersonaCopy } from './checks.ts';

const w = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

function good(): PersonaCopy {
  return {
    call: {
      opener: w(100),
      discovery_questions: ['How are you covering the maths post at the moment?', 'What has the agency experience been like this year?', 'Who else is involved in the decision?'],
      objections: [{ objection: 'We have an agency.', response: 'Understood.' }, { objection: 'No budget.', response: 'Framework rates apply.' }, { objection: 'Send an email.', response: 'Happy to.' }],
      voicemail: w(50),
      close: 'Fifteen minutes next week to look at the margin and the compliance file?',
    },
    email: { subject: 'Your Teacher of Maths advert', body: w(115) + '\n\nKim\nWhoFoundWho\n[phone number]', followup: w(60) },
  };
}

Deno.test('fee-figure check: pounds with margin, fee or percent in the same sentence', () => {
  assertEquals(feeFigureViolations('Our daily margin never exceeds £45.').length, 1);
  assertEquals(feeFigureViolations('Permanent fees never exceed 15%.').length, 1);
  assertEquals(feeFigureViolations('Most companies pay 12 per cent as a fee.').length, 1);
  assertEquals(feeFigureViolations('Our rate is 14% lower than most.').length, 1);
  assertEquals(feeFigureViolations('A 61% rise means it is worth checking what sits inside the rate you are paying.').length, 0);
  assertEquals(feeFigureViolations('Spend rose 61% year on year.').length, 0);
  assertEquals(feeFigureViolations('Our margin is visible on any invoice we send, and our safeguarding and vetting file is audited by APSCo at 99%.').length, 0);
  assertEquals(feeFigureViolations('Our safeguarding file was independently audited by APSCo at 99 per cent, in the top 5% of the body.').length, 0);
  assertEquals(feeFigureViolations('Our margin is just 12% of the day rate.').length, 1);
  assertEquals(feeFigureViolations('We charge 10 per cent on permanent placements.').length, 1);
  assertEquals(feeFigureViolations('Spent £96,000 on supply teaching in 2024-25. Framework rates apply.').length, 0);
  assertEquals(feeFigureViolations('99% APSCo compliance score, in the top 5% of the body.').length, 0);
  assertEquals(feeFigureViolations('Fifteen minutes is all it takes to see our margin.').length, 0);
});

Deno.test('banned phrases and exclamation marks', () => {
  assertEquals(bannedPhraseHits('I hope this finds you well. I wanted to reach out to touch base.'), ['hope this finds you well', 'reach out', 'touch base', 'i wanted to']);
  assertEquals(bannedPhraseHits('A short note about your maths vacancy.'), []);
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
  const input = { contactNames: ['Mr Sear', 'Ms S Jarada'], consultantName: 'Kim Webb', consultantFirstName: 'Kim', inputText: 'Kingsdale Foundation Company in Southwark. Teacher of Maths. Ofsted Good.' };
  const c = good();
  c.email.body = 'Dear Mr Sear, Kim Webb here. Your Teacher of Maths advert on Teaching Vacancies caught my eye. Ofsted Good is a fair reflection.\n\nKim\nWhoFoundWho';
  assertEquals(namedPeopleFlags(c, input), []);
  c.email.body = 'Dear Mrs Patel, I saw that John Appleby has left.';
  const flags = namedPeopleFlags(c, input);
  assert(flags.includes('named person not in input: Mrs Patel'));
  assert(flags.includes('possible invented name: John Appleby'));
  // A surname followed by a line break is not a first name.
  c.email.body = 'Dear Mr Sear\n\nYou have two roles closing.';
  assertEquals(namedPeopleFlags(c, input), []);
  c.email.body = 'Dear Mr Nicholls\n\nOne thing.';
  assertEquals(namedPeopleFlags(c, input), ['named person not in input: Mr Nicholls']);
  const four = good();
  four.call.objections = [...four.call.objections, { objection: 'x', response: 'y' }];
  assertEquals(trimToThree(four).call.objections.length, 3);
  assertEquals(allFlags(good(), input), []);
});

Deno.test('the email must be signed by the consultant', () => {
  const c = good();
  c.email.body = 'Dear Mr Sear,\n\nYour Teacher of Maths advert.\n\nKim\nWhoFoundWho\n[phone number]';
  assertEquals(signatureFlags(c, 'Kim'), []);
  c.email.body = 'Dear Mr Sear,\n\nYour Teacher of Maths advert.\n\nBest wishes';
  assertEquals(signatureFlags(c, 'Kim'), ['email not signed by Kim']);
  c.email.body = 'Dear Mr Sear,\n\nThe WhoFoundWho team\n[phone number]';
  assertEquals(signatureFlags(c, null), []);
});
