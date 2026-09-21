import { assert, assertEquals } from '../test-assert.ts';
import { computeSignals, normaliseTitle, roleFamily, SIGNAL_FACT_KINDS, SIGNAL_LABELS, type ContactForSignals, type RegisterForSignals, type SignalInput, type VacancyForSignals } from './compute.ts';
import { daysBetween, describeDate, monthsBetween } from './calendar.ts';
import { contactsForSignals, roleKeyFromText } from './load.ts';
import type { Fact } from '../facts/types.ts';

const TODAY = new Date('2026-09-21T12:00:00Z');

function base(over: Partial<SignalInput> = {}): SignalInput {
  return { today: TODAY, facts: [], openVacancies: [], closedVacancies: [], register: null, contacts: [], ...over };
}
function vac(over: Partial<VacancyForSignals>): VacancyForSignals {
  return { id: 'v1', title: 'Senior Backend Engineer', firstSeen: '2026-09-10', closingDate: null, source: 'ashby', ...over };
}
function fact(over: Partial<Fact>): Fact {
  return { id: 'f1', kind: 'other', statement: 'A statement.', quote: 'a quote from the page', source_url: 'https://www.searchable.com/blog', date_hint: null, statement_key: 'k', ...over };
}
function contact(name: string, role: string, roleKey: string | null = roleKeyFromText(role)): ContactForSignals {
  return { name, role, roleKey };
}
const codes = (input: SignalInput) => computeSignals(input).map((s) => s.code);
const find = (input: SignalInput, code: string) => computeSignals(input).find((s) => s.code === code);

/** Searchable, 21 September 2026: 13 open roles on its Ashby board across engineering, sales, marketing, design and operations. */
const SEARCHABLE_ROLES: VacancyForSignals[] = [
  vac({ id: 'v1', title: 'Senior Backend Engineer', department: 'Engineering', location: 'London', firstSeen: '2026-09-10' }),
  vac({ id: 'v2', title: 'Staff Software Engineer', department: 'Engineering', location: 'London', firstSeen: '2026-09-10' }),
  vac({ id: 'v3', title: 'Machine Learning Engineer', department: 'Engineering', location: 'London', firstSeen: '2026-09-01' }),
  vac({ id: 'v4', title: 'Frontend Engineer', department: 'Engineering', location: 'London', firstSeen: '2026-09-10' }),
  vac({ id: 'v5', title: 'Platform Engineer', department: 'Engineering', location: 'Remote (UK)', firstSeen: '2026-09-15' }),
  vac({ id: 'v6', title: 'Account Executive', department: 'Sales', location: 'London', firstSeen: '2026-09-10' }),
  vac({ id: 'v7', title: 'Sales Development Representative', department: 'Sales', location: 'Salt Lake City', firstSeen: '2026-09-10' }),
  vac({ id: 'v8', title: 'Head of Marketing', department: 'Marketing', location: 'London', firstSeen: '2026-09-10' }),
  vac({ id: 'v9', title: 'Product Designer', department: 'Design', location: 'London', firstSeen: '2026-09-10' }),
  vac({ id: 'v10', title: 'Senior Product Manager', department: 'Product', location: 'London', firstSeen: '2026-09-10' }),
  vac({ id: 'v11', title: 'Finance Manager', department: 'Operations', location: 'London', firstSeen: '2026-09-10' }),
  vac({ id: 'v12', title: 'Executive Assistant to the CEO', department: 'Operations', location: 'London', firstSeen: '2026-09-10' }),
  vac({ id: 'v13', title: 'Customer Success Manager', department: 'Customer', location: 'London', firstSeen: '2026-09-10' }),
];
const SERIES_A = fact({ id: 'f1', kind: 'funding_round', statement: 'Searchable secured £10.3 million Series A investment led by Headline in March 2026.', quote: 'Searchable secures £10.3 million Series A investment led by Headline', date_hint: 'March 2026', source_url: 'https://www.searchable.com/blog/series-a' });
const SEARCHABLE_REGISTER: RegisterForSignals = {
  status: 'active',
  incorporationDate: '2025-03-12',
  officers: [
    { name: 'Tom Reed', role: 'director', appointedOn: '2025-03-12', resignedOn: null },
    { name: 'Anna Kowalski', role: 'director', appointedOn: '2025-03-12', resignedOn: null },
    { name: 'Jonathan Userovici', role: 'director', appointedOn: '2026-04-02', resignedOn: null },
  ],
  capitalFilings: [{ date: '2026-03-30', type: 'SH01', description: 'Statement of capital following an allotment of shares on 27 March 2026' }],
};

Deno.test('calendar helpers: days, months and the date words', () => {
  assertEquals(daysBetween('2026-09-01', '2026-09-21'), 20);
  assertEquals(monthsBetween('2025-03-12', '2026-09-21'), 18);
  assertEquals(monthsBetween('2026-09-30', '2026-10-01'), 1);
  assertEquals(monthsBetween('2026-10-01', '2026-09-21'), -1);
  assertEquals(describeDate('2026-06-15'), '15 Jun 2026');
  assertEquals(describeDate('soon'), 'soon');
});

Deno.test('normaliseTitle drops the source suffix, parentheticals, locations and workplace words but keeps seniority', () => {
  assertEquals(normaliseTitle('Senior Backend Engineer - London (Hybrid)'), 'senior backend engineer');
  assertEquals(normaliseTitle('Senior Backend Engineer (Remote, UK)'), 'senior backend engineer');
  assertEquals(normaliseTitle('Account Executive | Salt Lake City'), 'account executive salt lake city');
  assertEquals(normaliseTitle('Head of Talent (via Ashby)'), 'head of talent');
  assert(normaliseTitle('Senior Engineer') !== normaliseTitle('Engineer'));
  assertEquals(roleFamily('Senior Backend Engineer'), 'engineering');
});

Deno.test('Searchable: 13 roles and a Series A make hiring_surge 2, engineering_hiring 2, funding_round 3, no_people_function, shares_allotted, new_senior_officer and new_company', () => {
  const input = base({ openVacancies: SEARCHABLE_ROLES, facts: [SERIES_A], register: SEARCHABLE_REGISTER, contacts: [contact('Tom Reed', 'Co-founder and CEO'), contact('Anna Kowalski', 'Co-founder and CTO')] });
  const signals = computeSignals(input);
  assertEquals(signals.map((s) => s.code), ['funding_round', 'hiring_surge', 'engineering_hiring', 'no_people_function', 'shares_allotted', 'new_senior_officer', 'new_company']);
  const surge = signals.find((s) => s.code === 'hiring_surge')!;
  assertEquals(surge.strength, 2);
  assertEquals(surge.explanation, '13 open roles: 5 engineering, 3 go to market, 2 product and design, 2 operations, 1 leadership; that is a lot of hiring for a team without a recruiter.');
  assertEquals(surge.evidence.length, 13);
  assertEquals(surge.evidence[0], { type: 'vacancy', id: 'v1', text: 'Senior Backend Engineer (ashby, first seen 2026-09-10, Engineering, London)', source_url: undefined });
  const eng = signals.find((s) => s.code === 'engineering_hiring')!;
  assertEquals(eng.strength, 2);
  assert(eng.explanation.startsWith('5 engineering roles are open: Senior Backend Engineer, Staff Software Engineer, Machine Learning Engineer, Frontend Engineer, Platform Engineer;'));
  const funding = signals.find((s) => s.code === 'funding_round')!;
  assertEquals(funding.strength, 3);
  assertEquals(funding.explanation, 'Searchable secured £10.3 million Series A investment led by Headline in March 2026; new money is spent on people first.');
  assertEquals(funding.evidence[0].type, 'fact');
  assertEquals(funding.evidence[0].quote, SERIES_A.quote);
  const nobody = signals.find((s) => s.code === 'no_people_function')!;
  assertEquals(nobody.explanation, '13 roles are open and nobody found on the site or the register runs people or talent: the founders are doing the hiring themselves.');
  assertEquals(nobody.evidence[0].text, '13 open roles and no people or talent person among the 2 contacts found, the facts or the officers');
  const shares = signals.find((s) => s.code === 'shares_allotted')!;
  assertEquals(shares.strength, 1, 'six months ago and the website mentions the round');
  assertEquals(shares.explanation, 'Companies House recorded an allotment of shares on 30 Mar 2026, which is money coming in.');
  assertEquals(shares.evidence[0], { type: 'register', text: 'Companies House SH01 30 Mar 2026: Statement of capital following an allotment of shares on 27 March 2026' });
  const officer = signals.find((s) => s.code === 'new_senior_officer')!;
  assertEquals(officer.strength, 1, 'a director appointed five months ago, no fact');
  assertEquals(officer.explanation, 'Companies House shows Jonathan Userovici appointed director on 2 Apr 2026; a new director often means a new investor or a new leader, and either reviews how the team is hired.');
  const young = signals.find((s) => s.code === 'new_company')!;
  assertEquals(young.strength, 1);
  assertEquals(young.explanation, 'Incorporated on 12 Mar 2025 and already has 13 open roles: a young company building its first team, usually with nobody to run hiring.');
  assertEquals(young.evidence[0].text, 'Companies House: incorporated 12 Mar 2025 (18 months ago), active; 13 open roles');
  // Every signal has a label and an explanation that is a sentence.
  for (const s of signals) {
    assertEquals(s.label, SIGNAL_LABELS[s.code]);
    assert(/[.]$/.test(s.explanation), s.explanation);
    assert(s.evidence.length > 0, s.code);
  }
});

Deno.test('talent_role_open: a recruiter is 1, two talent roles 2, a Head of Talent 3; and the talent role is not "no one runs hiring" cover', () => {
  const recruiter = base({ openVacancies: [vac({ id: 'v1', title: 'Technical Recruiter' })] });
  const one = find(recruiter, 'talent_role_open')!;
  assertEquals(one.strength, 1);
  assertEquals(one.explanation, 'One talent role is open: Technical Recruiter (ashby, first seen 2026-09-10); the company is building its hiring capacity.');
  const two = find(base({ openVacancies: [vac({ id: 'v1', title: 'Technical Recruiter' }), vac({ id: 'v2', title: 'People Partner' })] }), 'talent_role_open')!;
  assertEquals(two.strength, 2);
  assertEquals(two.explanation, '2 talent roles are open: Technical Recruiter, People Partner; the company is building its hiring capacity.');
  const head = find(base({ openVacancies: [vac({ id: 'v1', title: 'Technical Recruiter' }), vac({ id: 'v2', title: 'Head of Talent Acquisition', firstSeen: '2026-09-01' })] }), 'talent_role_open')!;
  assertEquals(head.strength, 3);
  assertEquals(head.explanation, 'Head of Talent Acquisition is open (ashby, first seen 2026-09-01): the company is hiring the person who would run its recruiting.');
  assertEquals(head.evidence[0].id, 'v2', 'the lead role first');
  assertEquals(find(base({ openVacancies: [vac({ title: 'Head of Engineering' })] }), 'talent_role_open'), undefined);
  // Advertising for a Head of Talent with four roles open: both fire; the company has nobody today.
  const both = base({ openVacancies: [vac({ id: 'v1', title: 'Head of Talent' }), ...SEARCHABLE_ROLES.slice(0, 3)] });
  assert(codes(both).includes('talent_role_open') && codes(both).includes('no_people_function'));
});

Deno.test('hiring_surge by count: 3 is nothing, 4 to 7 is 1, 8 to 14 is 2, 15 or more is 3', () => {
  const roles = (n: number) => SEARCHABLE_ROLES.concat(SEARCHABLE_ROLES.map((v) => ({ ...v, id: v.id + 'b' }))).slice(0, n);
  assertEquals(find(base({ openVacancies: roles(3) }), 'hiring_surge'), undefined);
  assertEquals(find(base({ openVacancies: roles(4) }), 'hiring_surge')!.strength, 1);
  assertEquals(find(base({ openVacancies: roles(7) }), 'hiring_surge')!.strength, 1);
  assertEquals(find(base({ openVacancies: roles(8) }), 'hiring_surge')!.strength, 2);
  assertEquals(find(base({ openVacancies: roles(15) }), 'hiring_surge')!.strength, 3);
  assertEquals(find(base({ openVacancies: roles(26) }), 'hiring_surge')!.evidence.length, 20, 'twenty roles listed, the rest counted');
});

Deno.test('engineering_hiring by count: one engineer is nothing, 2 to 3 is 1, 4 to 6 is 2, 7 or more is 3; the department decides an ambiguous title', () => {
  const eng = (n: number) => Array.from({ length: n }, (_, i) => vac({ id: `e${i}`, title: `Engineer ${i}` }));
  assertEquals(find(base({ openVacancies: eng(1) }), 'engineering_hiring'), undefined);
  assertEquals(find(base({ openVacancies: eng(2) }), 'engineering_hiring')!.strength, 1);
  assertEquals(find(base({ openVacancies: eng(4) }), 'engineering_hiring')!.strength, 2);
  assertEquals(find(base({ openVacancies: eng(7) }), 'engineering_hiring')!.strength, 3);
  const byDept = base({ openVacancies: [vac({ id: 'a', title: 'Senior Analyst', department: 'Engineering' }), vac({ id: 'b', title: 'Backend Engineer' })] });
  assertEquals(find(byDept, 'engineering_hiring')!.strength, 1);
  assertEquals(find(base({ openVacancies: [vac({ id: 'a', title: 'Senior Analyst', department: 'Finance' }), vac({ id: 'b', title: 'Backend Engineer' })] }), 'engineering_hiring'), undefined);
});

Deno.test('no_people_function: four roles and nobody; a people or talent contact, a talent_team fact, an in-post people_function fact or a people officer cancels it; a "nobody yet" fact is the wording', () => {
  const four = SEARCHABLE_ROLES.slice(0, 4);
  assertEquals(find(base({ openVacancies: four }), 'no_people_function')!.strength, 2);
  assertEquals(find(base({ openVacancies: SEARCHABLE_ROLES.slice(0, 3) }), 'no_people_function'), undefined, 'three roles is not enough');
  assertEquals(find(base({ openVacancies: four, contacts: [contact('Priya Shah', 'Head of People')] }), 'no_people_function'), undefined);
  assertEquals(find(base({ openVacancies: four, contacts: [contact('Sam Ng', 'Talent Partner')] }), 'no_people_function'), undefined);
  assertEquals(find(base({ openVacancies: four, contacts: [contact('Tom Reed', 'CEO')] }), 'no_people_function')!.strength, 2, 'a founder is not a people function');
  assertEquals(find(base({ openVacancies: four, facts: [fact({ kind: 'talent_team', statement: 'Sam Ng is the in-house recruiter.', quote: 'Sam Ng, our in-house recruiter' })] }), 'no_people_function'), undefined);
  assertEquals(find(base({ openVacancies: four, facts: [fact({ kind: 'people_function', statement: 'Priya Shah runs people as Head of People.', quote: 'Priya Shah, Head of People, looks after' })] }), 'no_people_function'), undefined);
  assertEquals(find(base({ openVacancies: four, register: { ...SEARCHABLE_REGISTER, officers: [{ name: 'Priya Shah', role: 'director, people and talent', appointedOn: '2026-01-01', resignedOn: null }] } }), 'no_people_function'), undefined);
  const nobody = fact({ id: 'f9', kind: 'people_function', statement: 'Searchable does not yet have a Head of People and the founders run hiring themselves.', quote: 'we don\'t yet have a Head of People' });
  const s = find(base({ openVacancies: four, facts: [nobody] }), 'no_people_function')!;
  assertEquals(s.explanation, 'Searchable does not yet have a Head of People and the founders run hiring themselves, and 4 roles are open.');
  assertEquals(s.evidence[1].id, 'f9');
});

Deno.test('funding_round: within nine months; a Series A or £5m is 3, a seed or an unnamed raise 2, a pre-seed 1; an old raise is not a signal; investor facts ride along', () => {
  assertEquals(find(base({ facts: [SERIES_A] }), 'funding_round')!.strength, 3);
  const seed = fact({ kind: 'funding_round', statement: 'Searchable raised a £2 million seed round in June 2026.', quote: 'raised a £2 million seed round', date_hint: 'June 2026' });
  assertEquals(find(base({ facts: [seed] }), 'funding_round')!.strength, 2);
  const bigSeed = fact({ kind: 'funding_round', statement: 'Searchable raised a $7 million seed round in June 2026.', quote: 'raised a $7 million seed round', date_hint: 'June 2026' });
  assertEquals(find(base({ facts: [bigSeed] }), 'funding_round')!.strength, 3, '$7m is £5.46m');
  const unnamed = fact({ kind: 'funding_round', statement: 'Searchable has raised new funding to grow the team.', quote: 'raised new funding to grow the team' });
  assertEquals(find(base({ facts: [unnamed] }), 'funding_round')!.strength, 2, 'undated counts as current');
  const pre = fact({ kind: 'funding_round', statement: 'The pre-seed came from angels in 2026.', quote: 'our pre-seed came from angels', date_hint: '2026' });
  assertEquals(find(base({ facts: [pre] }), 'funding_round')!.strength, 1);
  const old = fact({ kind: 'funding_round', statement: 'Searchable raised a £2 million seed round in 2024.', quote: 'raised a £2 million seed round', date_hint: 'November 2024' });
  assertEquals(find(base({ facts: [old] }), 'funding_round'), undefined, 'twenty-two months ago');
  const investor = fact({ id: 'f2', kind: 'investor', statement: 'Seedcamp and Ada Ventures also took part.', quote: 'with participation from Seedcamp', date_hint: 'March 2026' });
  const s = find(base({ facts: [SERIES_A, investor] }), 'funding_round')!;
  assertEquals(s.evidence.map((e) => e.id), ['f1', 'f2']);
  // The amount and round are added to the wording when the statement does not name the round.
  const terse = fact({ kind: 'funding_round', statement: 'Searchable announced new investment in March 2026.', quote: 'a $12M Series A led by Headline', date_hint: 'March 2026' });
  assertEquals(find(base({ facts: [terse] }), 'funding_round')!.explanation, 'Searchable announced new investment in March 2026 (£9.4m Series A); new money is spent on people first.');
});

Deno.test('shares_allotted: an SH01 within six months; 2 within three; 3 when the website says nothing about a round; older filings and other types are nothing', () => {
  const reg = (date: string, type = 'SH01', description = 'Statement of capital following an allotment of shares'): RegisterForSignals => ({ status: 'active', incorporationDate: '2020-01-01', officers: [], capitalFilings: [{ date, type, description }] });
  const quiet = find(base({ register: reg('2026-08-15') }), 'shares_allotted')!;
  assertEquals(quiet.strength, 3);
  assertEquals(quiet.explanation, 'Companies House recorded an allotment of shares on 15 Aug 2026, which is money coming in; the website says nothing about a round.');
  assertEquals(find(base({ register: reg('2026-08-15'), facts: [SERIES_A] }), 'shares_allotted')!.strength, 2);
  assertEquals(find(base({ register: reg('2026-04-15'), facts: [SERIES_A] }), 'shares_allotted')!.strength, 1);
  assertEquals(find(base({ register: reg('2026-02-15') }), 'shares_allotted'), undefined, 'seven months ago');
  assertEquals(find(base({ register: reg('2026-08-15', 'CS01', 'Confirmation statement made on 15 August 2026 with no updates') }), 'shares_allotted'), undefined, 'a confirmation statement is not money');
  const two = find(base({ register: { ...reg('2026-08-15'), capitalFilings: [...reg('2026-08-15').capitalFilings, ...reg('2026-06-01').capitalFilings] } }), 'shares_allotted')!;
  assert(two.explanation.includes('(2 filings in six months)'));
});

Deno.test('new_senior_officer: a director appointed within six months (2 within three), a leadership_change fact naming a chief or VP (2), both 3; a secretary, a resigned director or a junior move is nothing', () => {
  const reg = (appointed: string, role = 'director', resigned: string | null = null): RegisterForSignals => ({ status: 'active', incorporationDate: '2020-01-01', officers: [{ name: 'Jonathan Userovici', role, appointedOn: appointed, resignedOn: resigned }], capitalFilings: [] });
  assertEquals(find(base({ register: reg('2026-08-01') }), 'new_senior_officer')!.strength, 2);
  assertEquals(find(base({ register: reg('2026-04-01') }), 'new_senior_officer')!.strength, 1);
  assertEquals(find(base({ register: reg('2026-02-01') }), 'new_senior_officer'), undefined, 'seven months ago');
  assertEquals(find(base({ register: reg('2026-08-01', 'secretary') }), 'new_senior_officer'), undefined);
  assertEquals(find(base({ register: reg('2026-08-01', 'director', '2026-09-01') }), 'new_senior_officer'), undefined);
  const cto = fact({ kind: 'leadership_change', statement: 'Maria Lopez joins Searchable as CTO in July 2026.', quote: 'Maria Lopez joins as CTO', date_hint: 'July 2026' });
  const s = find(base({ facts: [cto] }), 'new_senior_officer')!;
  assertEquals(s.strength, 2);
  assertEquals(s.explanation, 'Maria Lopez joins Searchable as CTO in July 2026; a new leader reviews how the team is hired.');
  const both = find(base({ facts: [cto], register: reg('2026-08-01') }), 'new_senior_officer')!;
  assertEquals(both.strength, 3);
  assertEquals(both.explanation, 'Maria Lopez joins Searchable as CTO in July 2026; Companies House shows Jonathan Userovici appointed as a director in the last six months; a new leader reviews how the team is hired.');
  assertEquals(find(base({ facts: [fact({ kind: 'leadership_change', statement: 'Sam Ng was promoted to senior engineer.', quote: 'promoted to senior engineer' })] }), 'new_senior_officer'), undefined);
  assertEquals(find(base({ facts: [fact({ kind: 'leadership_change', statement: 'Maria Lopez joined as CTO in 2025.', quote: 'joined as CTO', date_hint: 'January 2025' })] }), 'new_senior_officer'), undefined, 'twenty months ago');
  const stepsDown = fact({ kind: 'leadership_change', statement: 'Co-founder and COO Ben Hart is stepping down in October 2026.', quote: 'Ben Hart is stepping down', date_hint: 'October 2026' });
  assertEquals(find(base({ facts: [stepsDown] }), 'new_senior_officer')!.strength, 2, 'a chief leaving is a leadership change too');
});

Deno.test('long_open_role after 35 days, not at 35; strength 3 when three roles or a talent role are long open', () => {
  const s = find(base({ openVacancies: [vac({ firstSeen: '2026-08-10' })] }), 'long_open_role')!;
  assertEquals(s.strength, 2);
  assertEquals(s.explanation, 'Senior Backend Engineer has been advertised for 42 days.');
  assertEquals(find(base({ openVacancies: [vac({ firstSeen: '2026-08-17' })] }), 'long_open_role'), undefined);
  assertEquals(find(base({ openVacancies: [vac({ id: 'v1', title: 'Head of Talent', firstSeen: '2026-08-01' })] }), 'long_open_role')!.strength, 3);
  assertEquals(find(base({ openVacancies: ['a', 'b', 'c'].map((id) => vac({ id, title: `Engineer ${id}`, firstSeen: '2026-08-01' })) }), 'long_open_role')!.strength, 3);
});

Deno.test('readvertised_role: seen, closed, seen again within 180 days; a board hiccup of a few days is not a re-advert', () => {
  const s = find(base({ openVacancies: [vac({ title: 'Senior Backend Engineer (Hybrid)', firstSeen: '2026-09-01' })], closedVacancies: [{ title: 'Senior Backend Engineer - London', firstSeen: '2026-05-01', lastSeen: '2026-07-15' }] }), 'readvertised_role')!;
  assertEquals(s.strength, 3);
  assertEquals(s.explanation, 'Senior Backend Engineer (Hybrid) was advertised until 2026-07-15 and is back up since 2026-09-01.');
  assertEquals(find(base({ openVacancies: [vac({ firstSeen: '2026-09-01' })], closedVacancies: [{ title: 'Senior Backend Engineer', firstSeen: '2025-10-01', lastSeen: '2026-02-01' }] }), 'readvertised_role'), undefined, 'more than 180 days');
  assertEquals(find(base({ openVacancies: [vac({ firstSeen: '2026-09-01' })], closedVacancies: [{ title: 'Senior Backend Engineer', firstSeen: '2026-08-01', lastSeen: '2026-08-29' }] }), 'readvertised_role'), undefined, 'three days gone is a hiccup');
  assertEquals(find(base({ openVacancies: [vac({ firstSeen: '2026-09-01' })], closedVacancies: [{ title: 'Engineer', firstSeen: '2026-05-01', lastSeen: '2026-07-15' }] }), 'readvertised_role'), undefined, 'a different role');
});

Deno.test('staffing_pressure_stated needs pressure wording; a number or a timescale makes it 3; "we\'re hiring" alone is nothing', () => {
  const scaling = fact({ kind: 'staffing_pressure', statement: 'Searchable says it is scaling the team fast.', quote: 'we are scaling the team fast' });
  assertEquals(find(base({ facts: [scaling] }), 'staffing_pressure_stated')!.strength, 2);
  const doubling = fact({ kind: 'headcount', statement: 'Searchable is 40 people and is doubling headcount this year.', quote: 'we are 40 people, doubling headcount this year' });
  const s = find(base({ facts: [doubling] }), 'staffing_pressure_stated')!;
  assertEquals(s.strength, 3);
  assertEquals(s.explanation, doubling.statement);
  const plan = fact({ kind: 'hiring_plan', statement: 'Searchable plans to hire 20 engineers by the end of 2026.', quote: 'hire 20 engineers by the end of 2026' });
  assertEquals(find(base({ facts: [plan] }), 'staffing_pressure_stated')!.strength, 3);
  const struggling = fact({ kind: 'staffing_pressure', statement: 'The founders say they are struggling to hire senior engineers.', quote: 'struggling to hire senior engineers' });
  assertEquals(find(base({ facts: [struggling] }), 'staffing_pressure_stated')!.strength, 2);
  const grow = fact({ kind: 'hiring_plan', statement: 'Searchable is growing the team from 30 to 60 in the next twelve months.', quote: 'growing the team from 30 to 60' });
  assertEquals(find(base({ facts: [grow] }), 'staffing_pressure_stated')!.strength, 3);
  assertEquals(find(base({ facts: [fact({ kind: 'staffing_pressure', statement: 'Searchable says it is hiring.', quote: "we're hiring" })] }), 'staffing_pressure_stated'), undefined);
  assertEquals(find(base({ facts: [fact({ kind: 'values', statement: 'Searchable is scaling the team fast.', quote: 'scaling the team fast' })] }), 'staffing_pressure_stated'), undefined, 'a values fact is never evidence');
  // The strongest fact leads the evidence.
  const both = find(base({ facts: [scaling, { ...doubling, id: 'f2' }] }), 'staffing_pressure_stated')!;
  assertEquals(both.evidence[0].id, 'f2');
});

Deno.test('agency_advertising: a named agency is 2, two mentions 3, a bare mention 1, "no agencies" is nothing', () => {
  const named = fact({ kind: 'agency_mention', statement: 'Searchable is recruiting its Head of Sales through Hunter Search.', quote: 'in partnership with Hunter Search' });
  const s = find(base({ facts: [named] }), 'agency_advertising')!;
  assertEquals(s.strength, 2);
  assertEquals(s.explanation, 'Searchable is recruiting its Head of Sales through Hunter Search; a company already paying agency fees knows what a Head of Talent would save it.');
  const bare = fact({ kind: 'agency_mention', statement: 'Searchable says it works with recruitment agencies for senior roles.', quote: 'we work with recruitment agencies for senior roles' });
  assertEquals(find(base({ facts: [bare] }), 'agency_advertising')!.strength, 1);
  assertEquals(find(base({ facts: [named, { ...bare, id: 'f2' }] }), 'agency_advertising')!.strength, 3);
  const none = fact({ kind: 'agency_mention', statement: 'The careers page says no agencies please.', quote: 'No agencies please' });
  assertEquals(find(base({ facts: [none] }), 'agency_advertising'), undefined);
  const direct = fact({ kind: 'agency_mention', statement: 'Searchable does not work with recruitment agencies.', quote: "we don't work with recruitment agencies" });
  assertEquals(find(base({ facts: [direct] }), 'agency_advertising'), undefined);
});

Deno.test('staff_departure: a departure fact within six months or dated ahead; 3 for two or more or when the leaver ran talent; arrivals and old departures are not a signal', () => {
  const eng = fact({ kind: 'staff_departure', statement: 'Ben Hart, Staff Engineer, is leaving in October 2026.', quote: 'Ben is leaving us in October', date_hint: 'October 2026' });
  const s = find(base({ facts: [eng] }), 'staff_departure')!;
  assertEquals(s.strength, 2);
  assertEquals(s.explanation, eng.statement);
  const talent = fact({ id: 'f2', kind: 'staff_departure', statement: 'Priya Shah, Head of Talent, left Searchable in July 2026.', quote: 'Priya has moved on to a new role', date_hint: 'July 2026' });
  const t = find(base({ facts: [talent] }), 'staff_departure')!;
  assertEquals(t.strength, 3);
  assertEquals(t.explanation, 'Priya Shah, Head of Talent, left Searchable in July 2026; the person who ran hiring has gone.');
  const two = find(base({ facts: [eng, { ...eng, id: 'f3', statement: 'Ana Silva, Designer, is moving on in November 2026.', date_hint: 'November 2026' }] }), 'staff_departure')!;
  assertEquals(two.strength, 3);
  assert(two.explanation.startsWith('2 members of staff are leaving or have left:'));
  assertEquals(find(base({ facts: [fact({ kind: 'staff_arrival', statement: 'Priya Shah joins as Head of People.', quote: 'joins as Head of People' })] }), 'staff_departure'), undefined);
  assertEquals(find(base({ facts: [{ ...eng, date_hint: 'January 2026' }] }), 'staff_departure'), undefined, 'eight months ago');
});

Deno.test('expansion from expansion, new_market and office facts with growth wording within twelve months; a named place is 2, two are 3; history is not growth', () => {
  const office = fact({ kind: 'office', statement: 'Searchable is opening a New York office in Q4 2026.', quote: 'opening our New York office', date_hint: 'Q4 2026' });
  const s = find(base({ facts: [office] }), 'expansion')!;
  assertEquals(s.strength, 2);
  assertEquals(s.explanation, 'Searchable is opening a New York office in Q4 2026; a new office or market is a new team to hire.');
  const market = fact({ id: 'f2', kind: 'new_market', statement: 'Searchable launched in Germany in June 2026.', quote: 'we launched in Germany', date_hint: 'June 2026' });
  assertEquals(find(base({ facts: [office, market] }), 'expansion')!.strength, 3);
  const vague = fact({ kind: 'expansion', statement: 'Searchable describes itself as a fast-growing company.', quote: 'a fast-growing company' });
  assertEquals(find(base({ facts: [vague] }), 'expansion')!.strength, 1);
  assertEquals(find(base({ facts: [fact({ kind: 'office', statement: 'Searchable was founded in London in 2019.', quote: 'founded in London in 2019' })] }), 'expansion'), undefined, 'undated history');
  assertEquals(find(base({ facts: [{ ...market, date_hint: 'June 2024' }] }), 'expansion'), undefined, 'twenty-seven months ago');
  assertEquals(find(base({ facts: [fact({ kind: 'office', statement: 'The office has a roof terrace.', quote: 'our office has a roof terrace' })] }), 'expansion'), undefined, 'an office fact without growth wording');
});

Deno.test('accelerator: strength 1 from any accelerator fact, naming the programme when it can', () => {
  const yc = fact({ kind: 'accelerator', statement: 'Searchable went through Y Combinator in the W24 batch.', quote: 'Y Combinator (W24)' });
  const s = find(base({ facts: [yc] }), 'accelerator')!;
  assertEquals(s.strength, 1);
  assertEquals(s.explanation, 'Searchable went through Y Combinator in the W24 batch; Y Combinator companies raise and hire on a schedule.');
  const ef = fact({ kind: 'accelerator', statement: 'The founders met at Entrepreneur First.', quote: 'met at Entrepreneur First' });
  assertEquals(find(base({ facts: [ef] }), 'accelerator')!.explanation, 'The founders met at Entrepreneur First; Entrepreneur First companies raise and hire on a schedule.');
  const unnamed = fact({ kind: 'accelerator', statement: 'Searchable is part of an accelerator programme.', quote: 'part of an accelerator programme' });
  assertEquals(find(base({ facts: [unnamed] }), 'accelerator')!.explanation, unnamed.statement);
});

Deno.test('new_company: incorporated within 24 months and three or more roles; 2 in the first year; nothing for an older company or with two roles', () => {
  const reg = (date: string): RegisterForSignals => ({ status: 'active', incorporationDate: date, officers: [], capitalFilings: [] });
  const three = SEARCHABLE_ROLES.slice(0, 3);
  assertEquals(find(base({ register: reg('2026-02-01'), openVacancies: three }), 'new_company')!.strength, 2);
  assertEquals(find(base({ register: reg('2025-03-12'), openVacancies: three }), 'new_company')!.strength, 1);
  assertEquals(find(base({ register: reg('2024-08-01'), openVacancies: three }), 'new_company'), undefined, 'twenty-five months');
  assertEquals(find(base({ register: reg('2026-02-01'), openVacancies: three.slice(0, 2) }), 'new_company'), undefined);
  assertEquals(find(base({ register: null, openVacancies: three }), 'new_company'), undefined);
});

Deno.test('a note from the team is a strength-1 signal with each note as evidence', () => {
  const one = fact({ id: 'f1', kind: 'consultant_intel', statement: 'Founder said on a call that they want a Head of Talent by January.', quote: '', source_url: 'consultant sheet, September 2026' });
  const s = find(base({ facts: [one] }), 'consultant_intel')!;
  assertEquals(s.strength, 1);
  assertEquals(s.explanation, one.statement);
  const two = find(base({ facts: [one, { ...one, id: 'f2', statement: 'Met the COO at SaaStock.' }] }), 'consultant_intel')!;
  assertEquals(two.explanation, 'Founder said on a call that they want a Head of Talent by January; 1 more note from the team.');
  assertEquals(two.evidence.length, 2);
});

Deno.test('has_talent_lead: a talent contact who is a head, director or lead, or a talent_team fact; cancelled by a talent departure within a year; a recruiter alone is not a lead', () => {
  const head = contact('Priya Shah', 'Head of Talent Acquisition');
  const s = find(base({ contacts: [head], openVacancies: SEARCHABLE_ROLES }), 'has_talent_lead')!;
  assertEquals(s.strength, 1);
  assertEquals(s.explanation, 'Priya Shah is Head of Talent Acquisition; the company has the function, so the conversation is about capacity, not building one.');
  assertEquals(s.evidence[0], { type: 'contact', text: 'Priya Shah, Head of Talent Acquisition' });
  assertEquals(find(base({ contacts: [head], openVacancies: SEARCHABLE_ROLES }), 'no_people_function'), undefined);
  assertEquals(find(base({ contacts: [contact('Sam Ng', 'Technical Recruiter')] }), 'has_talent_lead'), undefined, 'a recruiter is not the lead');
  assertEquals(find(base({ contacts: [contact('Priya Shah', 'Head of People')] }), 'has_talent_lead'), undefined, 'a Head of People is the people key, not talent');
  assertEquals(find(base({ contacts: [contact('Priya Shah', 'Director of Talent')] }), 'has_talent_lead')!.strength, 1);
  assertEquals(find(base({ contacts: [contact('Priya Shah', 'Talent Lead')] }), 'has_talent_lead')!.strength, 1);
  const team = fact({ kind: 'talent_team', statement: 'Sam Ng leads recruiting at Searchable.', quote: 'Sam Ng leads recruiting' });
  const t = find(base({ facts: [team] }), 'has_talent_lead')!;
  assertEquals(t.explanation, 'Sam Ng leads recruiting at Searchable; the company has the function, so the conversation is about capacity, not building one.');
  const left = fact({ id: 'f2', kind: 'staff_departure', statement: 'Sam Ng, Head of Talent, left in April 2026.', quote: 'Sam has moved on', date_hint: 'April 2026' });
  const input = base({ contacts: [head], facts: [left] });
  assertEquals(find(input, 'has_talent_lead'), undefined, 'the talent lead has gone');
  assertEquals(find(input, 'staff_departure')!.strength, 3);
  const longAgo = { ...left, date_hint: 'April 2025' };
  assertEquals(find(base({ contacts: [head], facts: [longAgo] }), 'has_talent_lead')!.strength, 1, 'seventeen months ago no longer cancels it');
});

Deno.test('signals are sorted strongest first; empty input yields none; values, remote policy and other facts are never evidence', () => {
  assertEquals(codes(base()), []);
  const s = computeSignals(base({ openVacancies: SEARCHABLE_ROLES, facts: [SERIES_A] }));
  for (let i = 1; i < s.length; i++) assert(s[i - 1].strength >= s[i].strength);
  assertEquals(codes(base({ facts: [fact({ kind: 'values', statement: 'Searchable is scaling the team from 30 to 60 people.', quote: 'x' }), fact({ kind: 'remote_policy', statement: 'Searchable is opening a New York office.', quote: 'x' }), fact({ kind: 'other', statement: 'Searchable raised a Series A.', quote: 'x' })] })), []);
  assert(!SIGNAL_FACT_KINDS.has('values') && !SIGNAL_FACT_KINDS.has('remote_policy') && !SIGNAL_FACT_KINDS.has('other') && !SIGNAL_FACT_KINDS.has('product_launch'));
  assertEquals(Object.keys(SIGNAL_LABELS).length, 17);
});

Deno.test('contactsForSignals maps role text to the taxonomy in rank order; a stored roleKey wins', () => {
  assertEquals(roleKeyFromText('Co-founder and CTO'), 'founder');
  assertEquals(roleKeyFromText('CEO'), 'founder');
  assertEquals(roleKeyFromText('Chief of Staff'), 'coo');
  assertEquals(roleKeyFromText('Head of Operations'), 'coo');
  assertEquals(roleKeyFromText('VP Engineering'), 'cto');
  assertEquals(roleKeyFromText('Chief People Officer'), 'people');
  assertEquals(roleKeyFromText('People Partner'), 'people');
  assertEquals(roleKeyFromText('Head of Talent'), 'talent');
  assertEquals(roleKeyFromText('Senior Technical Recruiter'), 'talent');
  assertEquals(roleKeyFromText('Talent Partner'), 'talent');
  assertEquals(roleKeyFromText('Chief Marketing Officer'), 'exec');
  assertEquals(roleKeyFromText('VP Sales'), 'exec');
  assertEquals(roleKeyFromText('Executive Assistant to the CEO'), 'ea');
  assertEquals(roleKeyFromText('Office Manager'), 'ea');
  assertEquals(roleKeyFromText('Non-executive director'), 'investor');
  assertEquals(roleKeyFromText('Partner at Headline'), 'investor');
  assertEquals(roleKeyFromText('Board member'), 'investor');
  assertEquals(roleKeyFromText('Software Engineer'), null);
  assertEquals(roleKeyFromText(''), null);
  assertEquals(contactsForSignals([{ name: 'Tom Reed', role: 'CEO' }, { name: 'Priya Shah', role: 'Head of People', roleKey: 'talent' }, { name: '', role: '' }]), [
    { name: 'Tom Reed', role: 'CEO', roleKey: 'founder' },
    { name: 'Priya Shah', role: 'Head of People', roleKey: 'talent' },
  ]);
  assertEquals(contactsForSignals(null), []);
});
