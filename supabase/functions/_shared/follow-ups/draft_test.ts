import { assert, assertEquals } from '../test-assert.ts';
import { bannedPhraseHits, feeFigureViolations } from '../copy/checks.ts';
import { VALUE_PROPOSITION_DEFAULT } from '../copy/value-proposition.default.ts';
import { buildVoiceBlock, talentRolesOpen, buildFollowUpInput, buildFollowUpSystemPrompt, buildCompanyBlock, buildStepMessage, draftContextKey, followUpDraftFlags, type FollowUpInput, personaForRole, purposeForStep, stripSignature, type StepRow } from './prompt.ts';

const input: FollowUpInput = {
  ctx: {
    company: {
      name: 'Metris Energy',
      record: { companyNumber: '14567890', status: 'active', incorporationDate: '2023-02-14', locality: 'London', sector: 'Software' },
      stage: { label: 'seed', evidence: 'we closed our seed round in July', source_url: 'https://metris.example/blog/seed' },
      latestRaise: { amountText: '£2m', amountGbp: 2_000_000, round: 'seed', date: '2026-07', investors: ['Zinc'], source_url: 'https://metris.example/blog/seed', statement: 'we closed our £2m seed round' },
    },
    signals: [{ code: 'hiring_surge', label: 'Hiring surge', strength: 2, explanation: 'Six roles opened in the last month.', evidence: [{ type: 'vacancy', id: 'v1', text: 'Senior Engineer (Ashby)' }, { type: 'fact', id: 'f1', text: 'x', quote: 'we are doubling the team' }] }],
    facts: [{ id: 'f1', kind: 'hiring_plan', statement: 'The company plans to double the team by spring.', quote: 'we are doubling the team', source_url: 'https://metris.example/blog/seed', date_hint: '2026-07', statement_key: 'k' }, { id: 'f2', kind: 'funding_round', statement: 'The company closed a £2m seed round in July 2026.', quote: 'we closed our £2m seed round', source_url: 'https://metris.example/blog/seed', date_hint: '2026-07', statement_key: 'k2' }],
    openRoles: [{ family: 'engineering', label: 'Engineering', count: 4, titles: ['Senior Engineer', 'Platform Engineer'] }, { family: 'go_to_market', label: 'Go to market', count: 2, titles: ['Account Executive'] }],
  } as FollowUpInput['ctx'],
  contact: { name: 'Priya Shah', role: 'Co-founder and CEO', email: 'priya@metris.example' },
  persona: 'founder',
  consultant: { displayName: 'Craig Springett', firstName: 'Craig' },
  vacancy: { title: 'Senior Engineer', closingDate: null, url: 'https://jobs.ashbyhq.com/metris/1', source: 'ashby', firstSeen: '2026-08-01' },
  approvedScript: { opener: 'Hello Priya, this is Craig from Big Fish Recruitment...', emailSubject: 'Your first Head of Talent', emailBody: 'Dear Priya, ...' },
  outcomes: [{ kind: 'voicemail', created_at: '2026-09-15T09:40:00Z', note: null, contact_name: 'Priya Shah' }],
  earlierEmails: [{ stepNo: 2, sentAt: '2026-09-15T13:10:00Z', status: 'sent', subject: 'The six roles you opened since the seed', body: 'Dear Priya,\n\nI rang this morning...\n\nBest wishes,', hook: 'the six roles opened since the seed round' }],
  step: { stepNo: 3, day: 4, purpose: 'second', dueAt: '2026-09-18T12:30:00Z' },
  today: new Date('2026-09-18T08:00:00Z'),
};

const goodBody = `Hey Priya,

I rang on Tuesday and emailed the same afternoon about the six roles you have opened since the seed round. One more thing worth saying: your own blog says you are doubling the team by spring, and the Senior Engineer post has been open since August, which is the point where founders usually stop being able to run every loop themselves.

I am a founder too, so I know what that costs you. I placed the first Head of Talent at Searchable earlier this year and would be glad to talk through what that person should own at your stage. You can also send me the details of what you need and I will come back to arrange a call.

Would Thursday or Friday afternoon suit for that?

Best wishes,`;

Deno.test('the stable blocks carry no banned phrase, no fee figure and no company text', () => {
  const rules = buildFollowUpSystemPrompt(VALUE_PROPOSITION_DEFAULT);
  assertEquals(feeFigureViolations(rules), []);
  assert(rules.includes('90 to 140 words'));
  assert(rules.includes('Never use these phrases'));
  assert(rules.includes('"reach out"'));
  assert(rules.includes('Never offer contractors'), 'the service rule is in the prompt');
  assert(rules.includes('- founder:') && rules.includes('- investor:'), 'the five persona notes');
  assert(!rules.includes('Metris'), 'nothing company-specific in the cached rules');
  assert(!/school|pupil|Ofsted|supply/i.test(rules), 'no school wording left');
  const company = buildCompanyBlock(input);
  assertEquals(feeFigureViolations(company), []);
  assert(company.includes('Company: Metris Energy (Companies House 14567890, active, incorporated 2023-02-14, London, Software).'), company.split('\n')[0]);
  assert(company.includes('Stage: seed ("we closed our seed round in July").'));
  assert(company.includes('Latest raise: £2m seed, 2026-07, investors Zinc.'));
  assert(company.includes('The role this sequence is about: Senior Engineer (ashby), open since 2026-08-01.'));
  assert(company.includes('Open roles (6), by family:'));
  assert(company.includes('- Engineering: 4 (Senior Engineer; Platform Engineer)'));
  assert(company.includes('Contact the emails go to: Priya Shah, Co-founder and CEO. Role for the notes: founder (Founder / CEO).'));
  assert(company.includes('Consultant writing: Craig Springett'));
  assert(company.includes('- [2] Hiring surge: Six roles opened in the last month.'));
  assert(company.includes('- The company plans to double the team by spring. | "we are doubling the team" | https://metris.example/blog/seed'));
  assert(company.includes('- opener: Hello Priya, this is Craig from Big Fish Recruitment...'));
  // The same words for every step: the block does not depend on the step.
  assertEquals(buildCompanyBlock({ ...input, step: { stepNo: 5, day: 14, purpose: 'last', dueAt: '2026-09-29T13:00:00Z' } }), company);
});

Deno.test('the step message says which email, the outcomes, the earlier emails and their hooks', () => {
  const text = buildStepMessage(input);
  assert(text.includes('Today: 2026-09-18. This email is due Friday 18 Sep.'), text.split('\n')[0]);
  assert(text.includes('Which email: second (step 3, day 4 of the plan).'));
  assert(text.includes('tied to something real at this company that the first email did not use'));
  assert(text.includes('- 2026-09-15: left a voicemail (Priya Shah)'));
  assert(text.includes('- step 2: the six roles opened since the seed round | The six roles you opened since the seed | sent 2026-09-15'));
  assert(text.includes('What was actually sent, so you do not repeat it:'));
  assert(text.includes('Use a different hook from every earlier email above.'));
  assert(text.endsWith('Write the second email now: subject, body and hook, following the schema.'));
  const first = buildStepMessage({ ...input, earlierEmails: [], outcomes: [], step: { stepNo: 2, day: 0, purpose: 'first', dueAt: '2026-09-15T13:00:00Z' } });
  assert(first.includes('Earlier emails in this sequence: none.'));
  assert(first.includes('Outcomes logged at this company: none yet'));
  assert(first.includes('the opening of the sequence'));
  assertEquals(bannedPhraseHits(first), []);
});

Deno.test('a good draft passes every check', () => {
  const inputText = `${buildFollowUpSystemPrompt(VALUE_PROPOSITION_DEFAULT)}\n${buildCompanyBlock(input)}\n${buildStepMessage(input)}`;
  const flags = followUpDraftFlags({ subject: 'Founder to founder: doubling the team', body: goodBody, hook: 'the plan to double the team by spring' }, input, inputText);
  assertEquals(flags, []);
});

Deno.test('a bad draft is flagged for each rule: banned phrase, fee figure, bullets, no question, no sign-off, same hook, invented name, length', () => {
  const inputText = `${buildCompanyBlock(input)}\n${buildStepMessage(input)}`;
  const bad = {
    subject: 'Re: Following up on my email',
    body: `Hope this finds you well. I wanted to reach out about our fee of 20% on the engineering roles.\n\n- We offer embedded recruiters\n- And retained search\n\nMr Jones at Fenwick Capital said we were great!\n\nCraig Springett\nBig Fish Recruitment\n[phone number]`,
    hook: 'the six roles opened since the seed round',
  };
  const flags = followUpDraftFlags(bad, input, inputText);
  const has = (s: string) => assert(flags.some((f) => f.includes(s)), `expected a flag containing "${s}" in: ${flags.join(' | ')}`);
  has('words (want 90 to 140)');
  has('subject reads as a reply or a chaser');
  has('fee figure');
  has('banned phrase');
  assert(flags.find((f) => f.includes('banned phrase'))!.includes('reach out'));
  has('exclamation mark');
  has('bullet list');
  has('placeholder in square brackets');
  has('no sign-off line');
  has('does not end with a question');
  has('no greeting line');
  has('same hook as an earlier email');
  has('named person not in input: Mr Jones');
});

Deno.test('a name, Big Fish Recruitment or a phone number the model adds under the sign-off is taken off', () => {
  const c = { displayName: 'Craig Springett', firstName: 'Craig' };
  assertEquals(stripSignature('Dear Priya,\n\nText.\n\nWould Friday suit?\n\nBest wishes,\nCraig Springett\nBig Fish Recruitment\n020 3000 0000', c), 'Dear Priya,\n\nText.\n\nWould Friday suit?\n\nBest wishes,');
  assertEquals(stripSignature('Text?\n\nKind regards,\nCraig', c), 'Text?\n\nKind regards,');
  assertEquals(stripSignature('Text?\n\nKind regards,\n[phone number]', c), 'Text?\n\nKind regards,');
  assertEquals(stripSignature('Text?\n\nKind regards,', c), 'Text?\n\nKind regards,', 'nothing to strip');
});

Deno.test('the context key changes with the roles, the facts and the outcomes, and not with their order', () => {
  const a = draftContextKey({ vacancies: [{ vacancy_key: 'se', title: 'Senior Engineer', closing_date: '2026-09-20' }, { vacancy_key: 'ae', title: 'AE', closing_date: null }], factKeys: ['k1', 'k2'], outcomeCount: 3 });
  const b = draftContextKey({ vacancies: [{ vacancy_key: 'ae', title: 'AE', closing_date: null }, { vacancy_key: 'se', title: 'Senior Engineer', closing_date: '2026-09-20' }], factKeys: ['k2', 'k1'], outcomeCount: 3 });
  assertEquals(a, b);
  assert(a.endsWith(':2v2f3o'));
  assert(a !== draftContextKey({ vacancies: [{ vacancy_key: 'se', title: 'Senior Engineer', closing_date: '2026-09-27' }, { vacancy_key: 'ae', title: 'AE', closing_date: null }], factKeys: ['k1', 'k2'], outcomeCount: 3 }), 'a moved closing date');
  assert(a !== draftContextKey({ vacancies: [{ vacancy_key: 'se', title: 'Senior Engineer', closing_date: '2026-09-20' }], factKeys: ['k1', 'k2'], outcomeCount: 3 }), 'a role gone');
  assert(a !== draftContextKey({ vacancies: [{ vacancy_key: 'se', title: 'Senior Engineer', closing_date: '2026-09-20' }, { vacancy_key: 'ae', title: 'AE', closing_date: null }], factKeys: ['k1', 'k2', 'k3'], outcomeCount: 3 }), 'a new fact');
  assert(a !== draftContextKey({ vacancies: [{ vacancy_key: 'se', title: 'Senior Engineer', closing_date: '2026-09-20' }, { vacancy_key: 'ae', title: 'AE', closing_date: null }], factKeys: ['k1', 'k2'], outcomeCount: 4 }), 'a new outcome');
});

Deno.test('the contact role picks the persona notes, and the step number picks the purpose', () => {
  assertEquals(personaForRole('Co-founder and CEO'), 'founder');
  assertEquals(personaForRole('Chief Operating Officer'), 'coo');
  assertEquals(personaForRole('CTO'), 'cto');
  assertEquals(personaForRole('Head of People'), 'people');
  assertEquals(personaForRole('Talent Partner'), 'people');
  assertEquals(personaForRole('Partner, Talent, Zinc VC'), 'investor');
  assertEquals(personaForRole('Executive Assistant to the CEO'), null);
  assertEquals(personaForRole(''), null);
  const steps = [
    { step_no: 1, kind: 'call', day: 0 }, { step_no: 2, kind: 'email', day: 0 }, { step_no: 3, kind: 'email', day: 4 }, { step_no: 4, kind: 'call', day: 8 }, { step_no: 5, kind: 'email', day: 14 },
  ] as Array<Pick<StepRow, 'day' | 'kind' | 'step_no'>>;
  assertEquals(purposeForStep({ day: 0, kind: 'email' }, steps), 'first');
  assertEquals(purposeForStep({ day: 4, kind: 'email' }, steps), 'second');
  assertEquals(purposeForStep({ day: 14, kind: 'email' }, steps), 'last');
});

Deno.test('the input for a step carries only the earlier emails, as they stand', () => {
  const sc = { ctx: input.ctx as SequenceContextCtx, persona: 'founder' as const, consultant: input.consultant, vacancy: input.vacancy, approvedScript: input.approvedScript, outcomes: input.outcomes, companyName: 'Metris Energy', contextKey: 'k' };
  const seq = { id: 's', company_search_id: 'co', consultant_id: null, created_by: null, contact_name: 'Priya Shah', contact_email: 'priya@metris.example', contact_role: 'Co-founder and CEO', vacancy_id: null, status: 'active', started_at: '2026-09-15T09:00:00Z' };
  const mk = (step_no: number, kind: 'call' | 'email', day: number, status: string, extra: Partial<StepRow> = {}): StepRow => ({ id: `st${step_no}`, sequence_id: 's', step_no, kind, day, label: null, due_at: '2026-09-15T13:00:00Z', status, subject: null, body: null, hook: null, draft_generated_at: null, draft_context_key: null, draft_flags: [], sent_message_id: null, outcome_id: null, completed_at: null, ...extra });
  const steps = [mk(1, 'call', 0, 'done'), mk(2, 'email', 0, 'sent', { subject: 'A', hook: 'h1', body: 'b', completed_at: '2026-09-15T13:10:00Z' }), mk(3, 'email', 4, 'due', { subject: 'B', hook: 'h2', body: 'c' }), mk(4, 'call', 8, 'scheduled'), mk(5, 'email', 14, 'scheduled')];
  const forLast = buildFollowUpInput(sc, seq, steps[4], steps, new Date('2026-09-29T08:00:00Z'));
  assertEquals(forLast.step, { stepNo: 5, day: 14, purpose: 'last', dueAt: '2026-09-15T13:00:00Z' });
  assertEquals(forLast.earlierEmails.map((e) => `${e.stepNo}:${e.status}:${e.sentAt || '-'}`), ['2:sent:2026-09-15T13:10:00Z', '3:due:-']);
  const forFirst = buildFollowUpInput(sc, seq, steps[1], steps, new Date());
  assertEquals(forFirst.earlierEmails, []);
  assertEquals(forFirst.step.purpose, 'first');
});

Deno.test("the sender's notes: an instruction is binding; a draft that admits it did not carry one out is flagged for the rewrite (8 October 2026)", () => {
  const withNotes: FollowUpInput = { ...input, instructions: 'Mention we have candidates who match this.' };
  const msg = buildStepMessage(withNotes);
  assert(/MUST be carried out/.test(msg), 'the notes block states the precedence');
  assert(/may be stated plainly as their claim/.test(msg));
  assert(/Mention we have candidates/.test(msg));
  const inputText = `${buildCompanyBlock(withNotes)}\n${msg}`;
  const draft = { subject: 'Founder to founder: doubling the team', body: goodBody, hook: 'the plan to double the team by spring' };
  const missed = followUpDraftFlags({ ...draft, notesMissed: 'The email does not say that matching candidates are available.' }, withNotes, inputText);
  assert(missed.some((f) => f.startsWith("the sender's instruction was not carried out")), missed.join('; '));
  const met = followUpDraftFlags({ ...draft, notesMissed: '' }, withNotes, inputText);
  assert(!met.some((f) => f.includes('instruction')), met.join('; '));
  const noNotes = followUpDraftFlags({ ...draft, notesMissed: 'anything' }, input, inputText);
  assert(!noNotes.some((f) => f.includes('instruction')), noNotes.join('; '));
});

type SequenceContextCtx = Parameters<typeof buildFollowUpInput>[0]['ctx'];

Deno.test('the first and last emails carry the checks Craig asked for (14 October 2026)', () => {
  const firstInput = { ...input, earlierEmails: [], step: { stepNo: 1, day: 0, purpose: 'first' as const, dueAt: '2026-09-15T13:00:00Z' } };
  const text = `${buildFollowUpSystemPrompt(VALUE_PROPOSITION_DEFAULT)}\n${buildCompanyBlock(firstInput)}\n${buildStepMessage(firstInput)}`;
  assert(text.includes('You may know Chris Donnelly'));
  assert(text.includes('£80m Series A valued AI start-up'));
  assertEquals(feeFigureViolations(text), []);
  const okFirst = `Hey Priya,\n\nYou may know Chris Donnelly: in my most recent search I have just helped place the first Head of Recruitment at Searchable, his £80m Series A valued AI start-up. I run every search myself.\n\nI saw the six roles you have opened since the seed round, which is usually the point where someone needs to own hiring. There are a lot of fancy recruitment models around and I have watched several come and go. I offer exclusive contingent search for the permanent Head of Talent, with a rebate. It does what it says on the tin. I will ring in the next day or two, or send me the details of what you need and I will arrange a call.\n\nWould that work?\n\nBest wishes,`;
  assertEquals(followUpDraftFlags({ subject: 'First Head of Talent at Fenwick', body: okFirst, hook: 'the six roles opened since the seed round' }, firstInput, text), []);
  const noChris = followUpDraftFlags({ subject: 'First Head of Talent at Fenwick', body: okFirst.replace('You may know Chris Donnelly: in my most recent search I', 'I'), hook: 'x' }, firstInput, text);
  assert(noChris.some((f) => f.includes('Chris Donnelly')), noChris.join(' | '));
  const lastInput = { ...input, step: { stepNo: 5, day: 14, purpose: 'last' as const, dueAt: '2026-09-29T13:00:00Z' } };
  const lastText = `${buildFollowUpSystemPrompt(VALUE_PROPOSITION_DEFAULT)}\n${buildCompanyBlock(lastInput)}\n${buildStepMessage(lastInput)}`;
  const lastBody = `Hey Priya,\n\nFive numbers that sum up how I recruit, and then I will stop emailing.\n\n50+ Talent Acquisition leaders and recruiters placed.\n5 hand-picked candidates in every shortlist, on a bespoke and easy-to-use portal.\n1 in 3 interview-to-placement ratio.\n18 years recruiting.\n5 years running 2 start-ups.\n\nExclusive contingent search for the permanent Head of Talent, with a rebate and nothing flashy. Send me the details of what you need whenever it comes up and I will arrange a call.\n\nShall I keep you in mind for when budgets allow?\n\nBest wishes,`;
  assertEquals(followUpDraftFlags({ subject: 'Five numbers, then I will leave you alone', body: lastBody, hook: 'five numbers' }, lastInput, lastText), []);
  const missing = followUpDraftFlags({ subject: 'Five numbers', body: lastBody.replace('18 years recruiting.\n', ''), hook: 'five numbers' }, lastInput, lastText);
  assert(missing.some((f) => f.includes('18 years')), missing.join(' | '));
});

Deno.test('the company block says how long each open role has been open', () => {
  const withDates = { ...input, ctx: { ...input.ctx, openRoles: [{ family: 'engineering', label: 'Engineering', count: 2, titles: ['Senior Engineer', 'Staff Engineer'], firstSeen: ['2026-08-03', null] }] } };
  const block = buildCompanyBlock(withDates);
  assert(block.includes('Senior Engineer, open since 2026-08-03'), block);
  assert(block.includes('Staff Engineer'));
  assert(!block.includes('Staff Engineer, open since'));
});

Deno.test('a talent role already open switches the brief to Craig\'s Talent Partner approach', () => {
  const withTalent = { ...input, ctx: { ...input.ctx, openRoles: [{ family: 'people_talent', label: 'People and talent', count: 1, titles: ['Talent Partner'] }, { family: 'engineering', label: 'Engineering', count: 1, titles: ['Senior Engineer'] }] } };
  assertEquals(talentRolesOpen(withTalent.ctx), ['Talent Partner']);
  const text = buildStepMessage(withTalent);
  assert(text.includes('A TALENT ROLE IS ALREADY OPEN AT THIS COMPANY (Talent Partner)'));
  assert(text.includes('could I work it?'));
  assertEquals(talentRolesOpen({ openRoles: [{ family: 'engineering', label: 'Engineering', count: 1, titles: ['Senior Engineer'] }] }), []);
  assert(!buildStepMessage(input).includes('A TALENT ROLE IS ALREADY OPEN'));
});

Deno.test('Craig\'s edited emails become voice examples for the same email only, with the draft he started from when kept', () => {
  const ex = [
    { purpose: 'second' as const, subject: 'Founder to founder: six roles', body: 'Hey A,\n\nI can help here.', original: { subject: 'x', body: 'Hey A,\n\nGlad to talk it through.' } },
    { purpose: 'first' as const, subject: 'First', body: 'Hey B,\n\nText.', original: null },
  ];
  const block = buildVoiceBlock({ ...input, voiceExamples: ex });
  assert(block.includes('HOW CRAIG ACTUALLY WRITES'));
  assert(block.includes('I can help here.'));
  assert(block.includes('Glad to talk it through.'));
  assert(!block.includes('Hey B,'), 'a first-email example is not shown for the second email');
  assertEquals(buildVoiceBlock({ ...input, voiceExamples: [] }), '');
});
