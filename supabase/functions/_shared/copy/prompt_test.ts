import { assert, assertEquals } from '../test-assert.ts';
import { buildSystemPrompt, buildUserMessage, type CopyInput } from './prompt.ts';
import { consultantFromTag, pickReviews } from './reviews.ts';
import { VALUE_PROPOSITION_DEFAULT } from './value-proposition.default.ts';
import { estimateCostUsd } from './usage.ts';
import { feeFigureViolations } from './checks.ts';

const here = new URL('.', import.meta.url).pathname;

Deno.test('the embedded value proposition matches the editable file', () => {
  const file = Deno.readTextFileSync(`${here}value-proposition.md`);
  assertEquals(VALUE_PROPOSITION_DEFAULT, file, 'run: node scripts/embed-value-proposition.mjs');
});

Deno.test('the value proposition and the system prompt contain no fee figure', () => {
  assertEquals(feeFigureViolations(VALUE_PROPOSITION_DEFAULT), []);
  assertEquals(feeFigureViolations(buildSystemPrompt(VALUE_PROPOSITION_DEFAULT)), []);
});

Deno.test('consultant identity from the app tag', () => {
  assertEquals(consultantFromTag('Kim Webb'), { firstName: 'Kim', fullName: 'Kim Webb', role: 'Associate Director' });
  assertEquals(consultantFromTag('Anja Cold Targets, Isobel NEW Area').firstName, 'Anja');
  assertEquals(consultantFromTag('Isobel NEW Area'), { firstName: 'Isobel', fullName: null, role: 'Education Recruitment Consultant' });
  assertEquals(consultantFromTag('House').firstName, null);
  assertEquals(consultantFromTag(null).firstName, null);
  assertEquals(consultantFromTag('Nikki, Nikki Cold Targets').fullName, 'Nikki Webber');
});

Deno.test('reviews: the consultant\'s own first, clients preferred, at most three', () => {
  const r = pickReviews(consultantFromTag('Anja Micic'), 'secondary');
  assertEquals(r.length, 3);
  assertEquals(r[0].consultant, 'Anja Micic');
  assertEquals(r[1].consultant, 'Anja Micic');
  const k = pickReviews(consultantFromTag('Kim Webb'), 'special', 2);
  assertEquals(k[0].consultant, 'Kim Webb');
  assertEquals(k.length, 2);
});

Deno.test('the user message carries the persona, contact, signals with evidence, facts, vacancies and spend', () => {
  const input: CopyInput = {
    persona: 'sbm',
    company: { name: 'Stanborough Company', phase: 'secondary', laName: 'Hertfordshire', trustName: 'STANBOROUGH COMPANY' },
    contact: { name: 'Mrs M John', role: 'Headteacher', email: 'head@stanborough.herts.sch.uk', confidence: 'found' },
    contacts: [{ name: 'Mrs M John', role: 'Headteacher', email: 'head@stanborough.herts.sch.uk', confidence: 'found' }],
    signals: [{ code: 'open_teaching_vacancies', label: 'Open teaching vacancies', strength: 2, explanation: 'Two teaching vacancies are live.', evidence: [{ type: 'vacancy', id: 'v1', text: 'Teacher of Maths (TES)' }, { type: 'fact', id: 'f1', text: 'x', quote: 'we are recruiting' }] }],
    facts: [{ id: 'f1', kind: 'staffing_pressure', statement: 'The company is recruiting for September.', quote: 'we are recruiting', source_url: 'https://s/x', date_hint: null, statement_key: 'k' }, { id: 'f2', kind: 'values', statement: 'The company values kindness.', quote: 'kindness', source_url: 'https://s/y', date_hint: null, statement_key: 'k2' }],
    vacancies: [{ title: 'Teacher of Maths', source: 'TES', firstSeen: '2026-09-01', closingDate: '2026-09-20' }],
    spend: { latestYear: '2024-25', agencyAndSupply: 96000, previousYear: '2023-24', previousAgencyAndSupply: 60000, comparison: 'Above the median of 9 secondary companies in Hertfordshire.' },
    consultant: consultantFromTag('Isobel NEW Area'),
    today: new Date('2026-09-08T12:00:00Z'),
  };
  const { text, reviews } = buildUserMessage(input);
  assert(text.includes('Persona: sbm (Company Business Manager)'));
  assert(text.includes('Today: 2026-09-08, autumn term 2026.'));
  assert(text.includes('Consultant: Isobel, Education Recruitment Consultant'));
  assert(text.includes('Mrs M John | Headteacher | head@stanborough.herts.sch.uk | address found on site'));
  assert(text.includes('- [2] Open teaching vacancies: Two teaching vacancies are live.'));
  assert(text.includes('evidence: x | quote: "we are recruiting"'));
  assert(text.includes('- The company is recruiting for September. | "we are recruiting" | https://s/x'));
  assert(text.includes('- Teacher of Maths (TES, first seen 2026-09-01, closes 2026-09-20)'));
  assert(text.includes('£96,000 in 2024-25, £60,000 in 2023-24. Above the median'));
  assertEquals(reviews.length, 3);
  const none = buildUserMessage({ ...input, signals: [], vacancies: [], spend: null, contact: null, contacts: [], facts: [] }).text;
  assert(none.includes('Signals: none.'));
  assert(none.includes('none found on the site; do not invent one'));
  assert(none.includes('Live vacancies: none'));
});

Deno.test('cost estimates', () => {
  assertEquals(estimateCostUsd({ model: 'claude-opus-5', inputTokens: 1_000_000, outputTokens: 0 }), 5);
  assertEquals(estimateCostUsd({ model: 'claude-opus-5', inputTokens: 0, cachedInputTokens: 1_000_000, outputTokens: 0 }), 0.5);
  assertEquals(estimateCostUsd({ model: 'claude-opus-5', inputTokens: 3000, cachedInputTokens: 4000, cacheWriteTokens: 0, outputTokens: 1500 }), 0.0545);
  assertEquals(estimateCostUsd({ model: 'gemini-3.6-flash', inputTokens: 20000, outputTokens: 2000 }), 0.011);
});
