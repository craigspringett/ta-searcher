import { assert, assertEquals } from '../test-assert.ts';
import { buildSystemPrompt, buildUserMessage, type CopyInput, PERSONA_LABELS, PERSONAS, raiseLine, recordLine, stageLine } from './prompt.ts';
import { consultantFromTag, pickReviews, PROOF_POINTS } from './reviews.ts';
import { VALUE_PROPOSITION_DEFAULT } from './value-proposition.default.ts';
import { estimateCostUsd } from './usage.ts';
import { bannedPhraseHits, feeFigureViolations, FIRM_NAME } from './checks.ts';

const here = new URL('.', import.meta.url).pathname;

Deno.test('the embedded value proposition matches the editable file', () => {
  const file = Deno.readTextFileSync(`${here}value-proposition.md`);
  assertEquals(VALUE_PROPOSITION_DEFAULT, file, 'run: node scripts/embed-value-proposition.mjs');
});

Deno.test('the value proposition and the system prompt contain no fee figure, and the prompt carries the firm, the personas and the new rules', () => {
  assertEquals(feeFigureViolations(VALUE_PROPOSITION_DEFAULT), []);
  const system = buildSystemPrompt(VALUE_PROPOSITION_DEFAULT);
  assertEquals(feeFigureViolations(system), []);
  assert(system.includes(FIRM_NAME));
  for (const p of PERSONAS) assert(system.includes(`- ${p}: `), p);
  assert(system.includes('Never quote a fee, a percentage, a retainer figure, a rebate period or a day rate'));
  assert(system.includes('Never promise a candidate, a shortlist or availability that is not in the input'));
  assert(system.includes('Never imply the company is failing at hiring'));
  assert(!/supply|pupil premium|Ofsted|headteacher/i.test(system), 'no school wording');
  assert(system.includes('[Craig to confirm]'), 'the writer is told what the marker means');
});

Deno.test('the placeholder value proposition marks every unconfirmed claim and the marker is banned in drafts', () => {
  assert(/\[Craig to confirm/.test(VALUE_PROPOSITION_DEFAULT));
  assert(/Searchable/.test(VALUE_PROPOSITION_DEFAULT));
  assertEquals(bannedPhraseHits('We placed a Head of Recruitment at Searchable [Craig to confirm].'), ['craig to confirm']);
  assertEquals(PROOF_POINTS.length >= 1, true);
});

Deno.test('consultant identity from the app tag', () => {
  assertEquals(consultantFromTag('Craig Springett'), { firstName: 'Craig', fullName: 'Craig Springett', role: 'Founder' });
  assertEquals(consultantFromTag('Anja Cold Targets, Isobel NEW Area').firstName, 'Anja');
  assertEquals(consultantFromTag('Isobel NEW Area'), { firstName: 'Isobel', fullName: null, role: 'Talent Search Consultant' });
  assertEquals(consultantFromTag('House').firstName, null);
  assertEquals(consultantFromTag(null).firstName, null);
});

Deno.test('proof points: the consultant\'s own first, stage and sector matches next, at most three', () => {
  const r = pickReviews(consultantFromTag('Craig Springett'), { stage: 'series_a', sector: 'AI' });
  assert(r.length >= 1 && r.length <= 3);
  assertEquals(r[0].consultant, 'Craig Springett');
  assertEquals(pickReviews(consultantFromTag('Isobel'), null, 1).length, 1);
});

Deno.test('the register, stage and raise lines', () => {
  assertEquals(recordLine(null), 'Companies House record: none (no company number, or the register could not be read).');
  assertEquals(recordLine({ companyNumber: '12345678', status: 'active', incorporationDate: '2023-04-12', locality: 'London', sector: 'Software' }), 'Companies House record: number 12345678; status active; incorporated 2023-04-12; registered office London; sector Software.');
  assertEquals(recordLine({ companyNumber: null, status: null, incorporationDate: null, locality: null, sector: null }), 'Companies House record: no number.');
  assertEquals(stageLine(null), 'Stage: unknown; do not name a stage.');
  assertEquals(stageLine({ label: 'unknown', evidence: null, source_url: null }), 'Stage: unknown; do not name a stage.');
  assertEquals(stageLine({ label: 'series_a', evidence: 'we closed our Series A', source_url: 'https://s/blog' }), 'Stage: Series A (we closed our Series A, https://s/blog).');
  assertEquals(raiseLine(null), 'Latest raise: none in the input; do not mention funding.');
  assertEquals(raiseLine({ amountText: '£8m', amountGbp: 8_000_000, round: 'Series A', date: '2026-03', investors: ['Headline', 'Seedcamp'], statement: 'We raised £8m led by Headline', source_url: 'https://s/blog/raise' }), 'Latest raise: Series A, £8m, dated 2026-03, investors Headline, Seedcamp | "We raised £8m led by Headline" | https://s/blog/raise.');
});

function input(): CopyInput {
  return {
    persona: 'coo',
    company: {
      name: 'Lumenly',
      record: { companyNumber: '12345678', status: 'active', incorporationDate: '2023-04-12', locality: 'London', sector: 'Software' },
      stage: { label: 'series_a', evidence: 'we closed our Series A', source_url: 'https://s/blog' },
      latestRaise: { amountText: '£8m', amountGbp: 8_000_000, round: 'Series A', date: '2026-03', investors: ['Headline'], statement: 'We raised £8m led by Headline', source_url: 'https://s/blog/raise' },
    },
    contact: { name: 'Amy Jones', role: 'Chief of Staff', email: 'amy.jones@lumenly.ai', confidence: 'pattern_guess' },
    otherContacts: [{ name: 'Sarah Green', role: 'Co-founder and CEO', email: 'sarah.green@lumenly.ai', confidence: 'found' }],
    signals: [{ code: 'hiring_surge', label: 'Many open roles', strength: 2, explanation: 'Nine roles are open.', evidence: [{ type: 'vacancy', id: 'v1', text: 'Senior Backend Engineer (Ashby)' }, { type: 'fact', id: 'f1', text: 'x', quote: 'we are doubling the team' }] }],
    facts: [{ id: 'f1', kind: 'hiring_plan', statement: 'The company plans to double its team this year.', quote: 'we are doubling the team', source_url: 'https://s/x', date_hint: null, statement_key: 'k' }, { id: 'f2', kind: 'values', statement: 'The company values candour.', quote: 'candour', source_url: 'https://s/y', date_hint: null, statement_key: 'k2' }],
    openRoles: [
      { family: 'people_talent', label: 'People and talent', count: 1, titles: ['Talent Partner'] },
      { family: 'engineering', label: 'Engineering', count: 3, titles: ['Senior Backend Engineer', 'ML Engineer', 'Platform Engineer'] },
    ],
    consultant: consultantFromTag('Isobel NEW Area'),
    today: new Date('2026-09-21T12:00:00Z'),
  } as CopyInput;
}

Deno.test('the user message carries the persona, the register, stage and raise lines, the contacts, signals with evidence, facts and the roles by family', () => {
  const { text, reviews } = buildUserMessage(input());
  assert(text.includes(`Persona: coo (${PERSONA_LABELS.coo})`));
  assert(text.includes('Today: 2026-09-21.'));
  assert(!/term/i.test(text.split('\n')[1]), 'no school term on the date line');
  assert(text.includes(`Consultant: Isobel, Talent Search Consultant, ${FIRM_NAME}.`));
  assert(text.includes('Company: Lumenly.'));
  assert(text.includes('Companies House record: number 12345678; status active; incorporated 2023-04-12; registered office London; sector Software.'));
  assert(text.includes('Stage: Series A (we closed our Series A, https://s/blog).'));
  assert(text.includes('Latest raise: Series A, £8m, dated 2026-03, investors Headline'));
  assert(text.includes('Amy Jones | Chief of Staff | amy.jones@lumenly.ai | address is a pattern guess'));
  assert(text.includes('Other contacts found: Sarah Green | Co-founder and CEO | sarah.green@lumenly.ai | address found on site.'));
  assert(text.includes('- [2] Many open roles: Nine roles are open.'));
  assert(text.includes('evidence: x | quote: "we are doubling the team"'));
  assert(text.includes('- The company plans to double its team this year. | "we are doubling the team" | https://s/x'));
  assert(text.includes('Open roles: 4 in total, by family:'));
  assert(text.includes('- People and talent: 1 (Talent Partner)'));
  assert(text.includes('- Engineering: 3 (Senior Backend Engineer; ML Engineer; Platform Engineer)'));
  assert(!/spend|pupil premium|term/i.test(text), 'no spend, pupil premium or term');
  assert(reviews.length >= 1);
  const none = buildUserMessage({ ...input(), signals: [], openRoles: [], contact: null, otherContacts: [], facts: [], company: { name: 'Lumenly', record: null, stage: null, latestRaise: null } }).text;
  assert(none.includes('Signals: none.'));
  assert(none.includes('none found on the site; do not invent one'));
  assert(none.includes('Open roles: none'));
  assert(none.includes('Companies House record: none'));
  assert(none.includes('Stage: unknown; do not name a stage.'));
  assert(none.includes('Latest raise: none in the input; do not mention funding.'));
});

Deno.test('cost estimates', () => {
  assertEquals(estimateCostUsd({ model: 'claude-opus-5', inputTokens: 1_000_000, outputTokens: 0 }), 5);
  assertEquals(estimateCostUsd({ model: 'claude-opus-5', inputTokens: 0, cachedInputTokens: 1_000_000, outputTokens: 0 }), 0.5);
  assertEquals(estimateCostUsd({ model: 'claude-opus-5', inputTokens: 3000, cachedInputTokens: 4000, cacheWriteTokens: 0, outputTokens: 1500 }), 0.0545);
  assertEquals(estimateCostUsd({ model: 'gemini-3.6-flash', inputTokens: 20000, outputTokens: 2000 }), 0.011);
});
