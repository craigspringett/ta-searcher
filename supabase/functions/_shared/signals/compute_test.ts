import { assert, assertEquals } from '../test-assert.ts';
import { computeSignals, normaliseTitle, roleFamily, type RegisterForSignals, type SignalInput, type TenderForSignals, type VacancyForSignals } from './compute.ts';
import { currentTerm, upcomingResignationDeadline, upcomingTermStart } from './calendar.ts';
import type { Fact } from '../facts/types.ts';
import { computeTrend } from '../spend/fbit.ts';

const TODAY = new Date('2026-09-08T12:00:00Z');

function base(over: Partial<SignalInput> = {}): SignalInput {
  return { today: TODAY, facts: [], openVacancies: [], closedVacancies: [], spend: null, head: null, trustName: null, ...over };
}
function vac(over: Partial<VacancyForSignals>): VacancyForSignals {
  return { id: 'v1', title: 'Teacher of Maths', firstSeen: '2026-09-01', closingDate: null, source: 'teaching_vacancies', ...over };
}
function fact(over: Partial<Fact>): Fact {
  return { id: 'f1', kind: 'other', statement: 'A statement.', quote: 'a quote from the page', source_url: 'https://x/y', date_hint: null, statement_key: 'k', ...over };
}
const codes = (input: SignalInput) => computeSignals(input).map((s) => s.code);
const find = (input: SignalInput, code: string) => computeSignals(input).find((s) => s.code === code);

Deno.test('role families', () => {
  assertEquals(roleFamily('Teaching Assistant'), 'support');
  assertEquals(roleFamily('Teacher of Maths'), 'teaching');
  assertEquals(roleFamily('Head of Science'), 'teaching');
  assertEquals(roleFamily('Learning Support Assistant (Maternity Cover)'), 'support');
  assertEquals(roleFamily('HLTA'), 'support');
  assertEquals(roleFamily('Company Business Manager'), 'office');
  assertEquals(roleFamily('Exams Officer'), 'office');
  assertEquals(roleFamily('Careers Co-ordinator'), 'other');
  // Robert Barclay Academy, 10 September dry run: the head is the boss, not the post.
  assertEquals(roleFamily("Headteacher's PA + Office Manager"), 'office');
  assertEquals(roleFamily('PA to the Headteacher'), 'office');
  assertEquals(roleFamily('Office manager / Headteacher\u2019s PA'), 'office');
  assertEquals(roleFamily('Secretary to the Principal'), 'office');
  assertEquals(roleFamily('SEN Administrator'), 'office');
  assertEquals(roleFamily('Receptionist'), 'office');
  assertEquals(roleFamily('Reception Class Teacher'), 'teaching');
  assertEquals(roleFamily('Teacher of Business and Finance'), 'teaching');
  assertEquals(roleFamily('Pastoral Leader Non Teaching'), 'support');
  assertEquals(roleFamily('Head of Science'), 'teaching');
  assertEquals(roleFamily('Science Technician'), 'other');
  assertEquals(roleFamily('Graduate Co Teacher'), 'support');
  assertEquals(roleFamily('Director of Learning: Dance (Maternity Cover)'), 'teaching');
  assertEquals(roleFamily('Head of Year 7'), 'teaching');
  assertEquals(normaliseTitle('Teacher of Maths (Maternity Cover)'), 'teacher of maths');
});

Deno.test('an office post is neither a teaching nor a support vacancy', () => {
  const s = computeSignals(base({ openVacancies: [vac({ title: "Headteacher's PA + Office Manager" })] }));
  assert(!s.some((x) => x.code === 'open_teaching_vacancies' || x.code === 'open_support_vacancies'), s.map((x) => x.code).join(','));
  const two = computeSignals(base({ openVacancies: [vac({ title: "Headteacher's PA + Office Manager" }), vac({ id: 'v2', title: 'Teacher of English' })] }));
  assertEquals(two.find((x) => x.code === 'open_teaching_vacancies')?.explanation, 'One teaching vacancy is live: Teacher of English.');
});

Deno.test('open_teaching_vacancies: one per role, three for three or more; none without', () => {
  const one = find(base({ openVacancies: [vac({})] }), 'open_teaching_vacancies');
  assertEquals(one?.strength, 1);
  assertEquals(one?.explanation, 'One teaching vacancy is live: Teacher of Maths.');
  const three = find(base({ openVacancies: [vac({ id: 'a' }), vac({ id: 'b', title: 'Teacher of English' }), vac({ id: 'c', title: 'Head of Year' })] }), 'open_teaching_vacancies');
  assertEquals(three?.strength, 3);
  assertEquals(three?.evidence.length, 3);
  assert(!codes(base({ openVacancies: [vac({ title: 'Teaching Assistant' })] })).includes('open_teaching_vacancies'));
});

Deno.test('open_support_vacancies by count; a teacher is not support', () => {
  const s = find(base({ openVacancies: [vac({ title: 'Teaching Assistant' }), vac({ id: 'v2', title: 'SEN Learning Support Assistant' })] }), 'open_support_vacancies');
  assertEquals(s?.strength, 2);
  assert(!codes(base({ openVacancies: [vac({})] })).includes('open_support_vacancies'));
});

Deno.test('long_open_role after 35 days, not at 35', () => {
  assert(codes(base({ openVacancies: [vac({ firstSeen: '2026-07-20' })] })).includes('long_open_role'));
  assert(!codes(base({ openVacancies: [vac({ firstSeen: '2026-08-04' })] })).includes('long_open_role'));
  assert(codes(base({ openVacancies: [vac({ firstSeen: '2026-08-03' })] })).includes('long_open_role'));
});

Deno.test('readvertised_role: seen, closed, seen again within 180 days', () => {
  assert(!codes(base({ openVacancies: [vac({ firstSeen: '2026-09-10' })], closedVacancies: [{ title: 'Teacher of Maths', firstSeen: '2026-08-01', lastSeen: '2026-09-08' }] })).includes('readvertised_role'), 'a two-day gap is a board hiccup');
  const yes = base({ openVacancies: [vac({ firstSeen: '2026-09-01' })], closedVacancies: [{ title: 'Teacher of Maths (Maternity Cover)', firstSeen: '2026-04-01', lastSeen: '2026-05-10' }] });
  const s = find(yes, 'readvertised_role');
  assertEquals(s?.strength, 3);
  assert(s!.explanation.includes('was advertised until 2026-05-10'));
  const tooOld = base({ openVacancies: [vac({ firstSeen: '2026-09-01' })], closedVacancies: [{ title: 'Teacher of Maths', firstSeen: '2025-09-01', lastSeen: '2025-12-01' }] });
  assert(!codes(tooOld).includes('readvertised_role'));
  const otherRole = base({ openVacancies: [vac({ firstSeen: '2026-09-01' })], closedVacancies: [{ title: 'Teacher of English', firstSeen: '2026-04-01', lastSeen: '2026-05-10' }] });
  assert(!codes(otherRole).includes('readvertised_role'));
  const stillSame = base({ openVacancies: [vac({ firstSeen: '2026-05-10' })], closedVacancies: [{ title: 'Teacher of Maths', firstSeen: '2026-04-01', lastSeen: '2026-05-10' }] });
  assert(!codes(stillSame).includes('readvertised_role'));
});

Deno.test('closing_this_week within 7 days, not past, not 8 days', () => {
  assert(codes(base({ openVacancies: [vac({ closingDate: '2026-09-15' })] })).includes('closing_this_week'));
  assert(codes(base({ openVacancies: [vac({ closingDate: '2026-09-08' })] })).includes('closing_this_week'));
  assert(!codes(base({ openVacancies: [vac({ closingDate: '2026-09-16' })] })).includes('closing_this_week'));
  assert(!codes(base({ openVacancies: [vac({ closingDate: '2026-09-07' })] })).includes('closing_this_week'));
});

Deno.test('fixed_term_or_maternity from title, contract terms or advert text', () => {
  assert(codes(base({ openVacancies: [vac({ title: 'Teacher of Dance (Maternity Cover)' })] })).includes('fixed_term_or_maternity'));
  assert(codes(base({ openVacancies: [vac({ contractTerms: ['Fixed Term'] })] })).includes('fixed_term_or_maternity'));
  assert(codes(base({ openVacancies: [vac({ advertText: 'This is a fixed term post until July 2027.' })] })).includes('fixed_term_or_maternity'));
  assert(!codes(base({ openVacancies: [vac({ contractTerms: ['Permanent'] })] })).includes('fixed_term_or_maternity'));
});

Deno.test('rr_allowance from advert text', () => {
  assert(codes(base({ openVacancies: [vac({ advertText: 'MPS/UPS plus a Recruitment and Retention allowance of one point' })] })).includes('rr_allowance'));
  assert(codes(base({ openVacancies: [vac({ advertText: 'Golden hello available for the right candidate' })] })).includes('rr_allowance'));
  assert(!codes(base({ openVacancies: [vac({ advertText: 'MPS/UPS, Inner London' })] })).includes('rr_allowance'));
});

Deno.test('agency_spend_high above median (2), top quartile (3), not below median or with too few peers', () => {
  const peers = { count: 9, median: 50000, upperQuartile: 90000, phase: 'secondary', laName: 'Camden' };
  const above = find(base({ spend: { latest: { fiscalYear: '2024-25', agencyAndSupply: 60000 }, previous: null, peers } }), 'agency_spend_high');
  assertEquals(above?.strength, 2);
  assert(above!.explanation.includes('£60,000'));
  const top = find(base({ spend: { latest: { fiscalYear: '2024-25', agencyAndSupply: 95000 }, previous: null, peers } }), 'agency_spend_high');
  assertEquals(top?.strength, 3);
  assert(!codes(base({ spend: { latest: { fiscalYear: '2024-25', agencyAndSupply: 40000 }, previous: null, peers } })).includes('agency_spend_high'));
  assert(!codes(base({ spend: { latest: { fiscalYear: '2024-25', agencyAndSupply: 95000 }, previous: null, peers: { ...peers, count: 3 } } })).includes('agency_spend_high'));
});

Deno.test('agency_spend_rising above 20% year on year', () => {
  assert(codes(base({ spend: { latest: { fiscalYear: '2024-25', agencyAndSupply: 130000 }, previous: { fiscalYear: '2023-24', agencyAndSupply: 100000 }, peers: null } })).includes('agency_spend_rising'));
  assert(!codes(base({ spend: { latest: { fiscalYear: '2024-25', agencyAndSupply: 115000 }, previous: { fiscalYear: '2023-24', agencyAndSupply: 100000 }, peers: null } })).includes('agency_spend_rising'));
  assert(!codes(base({ spend: { latest: { fiscalYear: '2024-25', agencyAndSupply: 115000 }, previous: { fiscalYear: '2023-24', agencyAndSupply: 0 }, peers: null } })).includes('agency_spend_rising'));
});

Deno.test('new_headteacher from a recent leadership fact or a changed DfE head; not from an old fact', () => {
  const recent = fact({ kind: 'leadership_change', statement: 'Ms Patel joined as headteacher in September 2026.', date_hint: 'September 2026' });
  const s = find(base({ facts: [recent] }), 'new_headteacher');
  assertEquals(s?.strength, 3);
  assertEquals(s?.evidence[0].id, 'f1');
  const old = fact({ kind: 'leadership_change', statement: 'Ms Patel joined as headteacher in 2019.', date_hint: 'September 2019' });
  assert(!codes(base({ facts: [old] })).includes('new_headteacher'));
  const assistant = fact({ kind: 'leadership_change', statement: 'Mr Modi was appointed Assistant Headteacher in June 2025.', date_hint: 'June 2025' });
  assert(!codes(base({ facts: [assistant] })).includes('new_headteacher'));
  const deputy = fact({ kind: 'leadership_change', statement: 'A new Deputy Headteacher joined in September 2026.', date_hint: 'September 2026' });
  assert(!codes(base({ facts: [deputy] })).includes('new_headteacher'));
  const principal = fact({ kind: 'leadership_change', statement: 'Ms Charles became Principal in September 2026.', date_hint: 'September 2026' });
  assert(codes(base({ facts: [principal] })).includes('new_headteacher'));
  const undated = fact({ kind: 'leadership_change', statement: 'The company is federated through an executive headship.', date_hint: null });
  assert(!codes(base({ facts: [undated] })).includes('new_headteacher'));
  const undatedHead = fact({ kind: 'leadership_change', statement: 'Mr Khan is the new headteacher.', date_hint: null });
  assert(!codes(base({ facts: [undatedHead] })).includes('new_headteacher'));
  const acting = fact({ kind: 'leadership_change', statement: 'Mark Nicholls serves as Acting Headteacher.', date_hint: null });
  assert(codes(base({ facts: [acting] })).includes('new_headteacher'));
  const changed = find(base({ head: { current: 'Mrs A Brown', previous: 'Mr B Green', changedAt: '2026-09-01' } }), 'new_headteacher');
  assert(changed!.explanation.includes('Mrs A Brown'));
  assert(!codes(base({ head: { current: 'Mrs A Brown', previous: 'Mrs A Brown', changedAt: null } })).includes('new_headteacher'));
  assert(!codes(base({ head: { current: 'Mrs A Brown', previous: 'Mr B Green', changedAt: '2025-01-01' } })).includes('new_headteacher'));
});

Deno.test('ofsted_ri_or_inadequate within three years; Good is not a signal; old RI is not', () => {
  assert(codes(base({ facts: [fact({ kind: 'ofsted', statement: 'Ofsted judged the company Requires Improvement in May 2025.', date_hint: 'May 2025' })] })).includes('ofsted_ri_or_inadequate'));
  assert(!codes(base({ facts: [fact({ kind: 'ofsted', statement: 'Ofsted judged the company Good in May 2025.', quote: 'Good in all areas', date_hint: 'May 2025' })] })).includes('ofsted_ri_or_inadequate'));
  assert(!codes(base({ facts: [fact({ kind: 'ofsted', statement: 'Ofsted judged the company Requires Improvement in 2021.', date_hint: '2021' })] })).includes('ofsted_ri_or_inadequate'));
});

Deno.test('send_provision_change needs a change word; expansion from expansion or new_build facts', () => {
  assert(codes(base({ facts: [fact({ kind: 'send_provision', statement: 'The company opened a new SEN resource base in April 2026.' })] })).includes('send_provision_change'));
  assert(codes(base({ facts: [fact({ kind: 'send_provision', statement: 'The number of pupils with EHCPs is growing.' })] })).includes('send_provision_change'));
  assert(!codes(base({ facts: [fact({ kind: 'send_provision', statement: 'The SENCO is Mrs Long.' })] })).includes('send_provision_change'));
  assert(codes(base({ facts: [fact({ kind: 'new_build', statement: 'A new sixth-form block opens in 2027.' })] })).includes('expansion'));
  assert(codes(base({ facts: [fact({ kind: 'expansion', statement: 'The company is growing to three forms of entry.' })] })).includes('expansion'));
  assert(!codes(base({ facts: [fact({ kind: 'values', statement: 'The company values kindness.' })] })).includes('expansion'));
});

Deno.test('expansion needs growth wording: a pitch, a pool, a theatre or training routes are not growth; old builds are history', () => {
  const no = (kind: 'expansion' | 'new_build', statement: string, quote = statement, date_hint: string | null = null) =>
    assert(!codes(base({ facts: [fact({ kind, statement, quote, date_hint })] })).includes('expansion'), statement);
  const yes = (kind: 'expansion' | 'new_build', statement: string, quote = statement, date_hint: string | null = null, strength?: number) => {
    const s = find(base({ facts: [fact({ kind, statement, quote, date_hint })] }), 'expansion');
    assert(s, statement);
    if (strength) assertEquals(s!.strength, strength, statement);
  };
  // 10 September dry run.
  no('expansion', 'Latymer Upper Company operates a 32-acre sports ground at Quintin Hogg Memorial Grounds in Chiswick.');
  no('expansion', 'Latymer Upper Company facilities on King Street include a Sports Centre with a six-lane 25m swimming pool, sports hall, fitness suite and floodlit netball courts.');
  no('expansion', 'A gen3 astroturf pitch was installed at the company in 2022.', 'A gen3 astroturf pitch was installed in 2022, which is also available for hire.', '2022');
  no('expansion', 'Finchley Catholic High Company has installed a new Astroturf pitch funded in part by parent contributions.', 'Take a look at our new Astroturf', '4th September 2026');
  no('new_build', 'Finchley Catholic High Company is constructing a new sports hall on site.', 'construction of our sports hall is well under way now', 'April');
  no('new_build', "The company's historic theatre was renovated in 2023 with state of the art audio-visual facilities.", 'In 2023 our historic company theatre was renovated', '2023');
  no('new_build', 'The company newly opened its Refectory, marked by an official opening event.', 'Official Opening of the New Refectory', '14 July 2026');
  no('new_build', 'Priestmead Primary Company opened a new building in January 2017 featuring a playing field, playground, and artificial grass pitch.', 'We are fortunate to have a brand new building (January 2017)', 'January 2017');
  no('new_build', 'Priestmead Primary Company operates across a three-floor DDA-compliant building with lift access to all floors.', 'We are a new build over three floors, designed to be DDA compliant.');
  no('new_build', 'Goffs Academy completed a multi-million pound rebuild under the Priority Companies Building Programme.', 'Ian led on the successful application to the Priority Companies Building Programme and subsequent delivery of the rebuild');
  no('expansion', 'The company runs multiple initial teacher training routes including Teach First, PGCE, and an assessment-only route with Reading University.');
  no('expansion', 'City of London Academy Southwark operates a dedicated sixth form centre on Rotherhithe New Road.');
  no('expansion', 'Goffs Academy receives an average of over 800 applications annually for 240 available places.', 'with an average of over 800 applications annually for the 240 places available, and significant waiting list');
  no('expansion', 'The number of extra-curricular events and trips accessed by students increased from 53 in 2023-24 to 192 in 2024-25.', 'In 2024 to 2025, this increased to 192.', '2024-2025');
  no('expansion', 'Wren Academy Enfield opened in September 2020 with its inaugural Year 7 cohort.', 'Since opening our doors in September 2020', 'September 2020');
  // Growth that means more staff.
  yes('expansion', 'Ark Soane Academy is opening its Sixth Form in 2026.', 'as we open our Sixth Form in 2026', '2026', 2);
  yes('new_build', 'Chace Community Company has moved into a new company building.', 'a great week in the new company building', 'September 2026', 2);
  yes('new_build', 'The company is moving to a new site at Northwood Road in Harefield.', 'our move to the new site at Northwood Road', 'September 2026', 2);
  yes('expansion', 'The company held a consultation on a proposed change to its Published Admission Number (PAN) in December 2025.', 'Consultation on Proposed Change to Published Admission Number (PAN)', '16th Dec 2025', 2);
  yes('expansion', 'Marylebone Academy plans to expand to co-education starting in September 2027.', 'girls will join Year 7 from September 2027 as we move towards being fully co-educational by 2031', 'September 2027', 2);
  yes('expansion', 'The company is being asked by the Local Authority to continue expanding due to demand.', 'LA requests for continued expansion', null, 2);
  yes('expansion', 'As of September 2025, Northway Company operates across three separate sites following considerable expansion in recent years.', 'Our company population has expanded considerably in recent years', 'September 2025', 2);
  yes('new_build', 'The Department for Education has confirmed a full company rebuild for Hornsey Company for Girls.', 'DfE confirm full company rebuild', null, 2);
  yes('expansion', 'Villiers High Company describes itself as an innovative and expanding company.', 'As an innovative and expanding company we are proud of our staff', null, 1);
  yes('expansion', 'The company has future plans for a brand-new building rated BREEAM Excellent.', 'Future plans include a brand-new building rated BREEAM Excellent', null, 2);
  // A values fact with growth words is never a signal.
  assert(!codes(base({ facts: [fact({ kind: 'values', statement: 'We are growing to three forms of entry with a new building.' })] })).includes('expansion'));
  assert(!codes(base({ facts: [fact({ kind: 'other', statement: 'We are growing to three forms of entry with a new building.' })] })).includes('expansion'));
});

Deno.test('trust_join within 18 months; membership alone is not a join; old join is not', () => {
  assert(codes(base({ facts: [fact({ kind: 'trust', statement: 'The company joined the Learning Trust in September 2025.', date_hint: 'September 2025' })] })).includes('trust_join'));
  assert(!codes(base({ facts: [fact({ kind: 'trust', statement: 'The company is part of the Learning Trust.', quote: 'part of the Learning Trust' })] })).includes('trust_join'));
  assert(!codes(base({ facts: [fact({ kind: 'trust', statement: 'The company joined the Learning Trust in 2020.', date_hint: '2020' })] })).includes('trust_join'));
  assert(!codes(base({ facts: [fact({ kind: 'trust', statement: 'The company joined the Learning Trust.', date_hint: null })] })).includes('trust_join'));
  assert(!codes(base({ facts: [fact({ kind: 'trust', statement: 'The company is proud to be part of the Learning Trust.', quote: 'proud to be part of', date_hint: 'September 2026' })] })).includes('trust_join'));
});

Deno.test('staffing_pressure_stated from staffing_pressure or supply_mention facts', () => {
  const s = find(base({ facts: [fact({ kind: 'supply_mention', statement: 'The company relies on supply staff to cover long-term absence.' })] }), 'staffing_pressure_stated');
  assertEquals(s?.strength, 3);
  assert(!codes(base({ facts: [fact({ kind: 'values', statement: 'The company values kindness.' })] })).includes('staffing_pressure_stated'));
});

Deno.test('staffing_pressure_stated needs pressure wording; "no use of supply teachers" is the opposite', () => {
  const sig = (kind: 'staffing_pressure' | 'supply_mention', statement: string, quote = statement) => computeSignals(base({ facts: [fact({ kind, statement, quote })] }));
  const no = (kind: 'staffing_pressure' | 'supply_mention', statement: string, quote = statement) => assert(!sig(kind, statement, quote).some((x) => x.code === 'staffing_pressure_stated'), statement);
  // 10 September dry run: none of these is pressure.
  no('staffing_pressure', 'Cherry Lane Primary Company says it maintains a hardworking, dedicated staff team committed to raising standards.', 'A hardworking, dedicated staff team committed to raising standards');
  no('staffing_pressure', 'Chiswick Company provides teaching staff with 17% PPA time compared to the 10% STPCD guidance.', 'More PPA time (17% PPA time compared to the STPCD guidance of 10%)');
  no('staffing_pressure', 'Chiswick Company employs cover supervisors to reduce the amount of cover required by teachers.', 'Teacher cover - we have Cover Supervisors reducing the amount of cover required by teachers');
  no('staffing_pressure', 'Latymer Upper Company pays teaching staff salaries significantly above the maintained sector.', 'Teaching salaries significantly above maintained sector');
  no('staffing_pressure', 'The company runs multiple initial teacher training routes including Teach First, PGCE, and an assessment-only route with Reading University.', 'We run a variety of initial teacher training routes and work closely with a variety of universities');
  no('staffing_pressure', 'Buxton Company runs a high-quality NQT induction programme with mentor meetings and learning walks.', 'A high-quality NQT staff induction programme');
  no('staffing_pressure', 'The company notes many staff have stayed for years, reflecting strong staff retention, while also seeking to welcome new staff.', 'Many staff have stayed for years, testament to the strong sense of camaraderie');
  no('staffing_pressure', "The Children's Hospital Company is currently unable to offer placements to trainee teachers.", 'We are currently unable to offer placements to trainee teachers.');
  // The opposite of pressure: a small signal of its own, never pressure.
  const paddington = sig('supply_mention', 'Paddington Academy states that it makes no use of supply teachers.', 'This means we have exceptionally well-trained staff, small class sizes, and no use of supply teachers.');
  assert(!paddington.some((x) => x.code === 'staffing_pressure_stated'));
  const self = paddington.find((x) => x.code === 'self_sufficient_stated');
  assertEquals(self?.strength, 1);
  assert(self!.explanation.startsWith('Paddington Academy states that it makes no use of supply teachers; lead with the framework'));
  const urswick = sig('staffing_pressure', 'The Urswick Company reports having very low staff turnover among its specialist teaching staff.', 'We have an excellent staff team, with very low staff turnover');
  assert(!urswick.some((x) => x.code === 'staffing_pressure_stated'));
  assert(urswick.some((x) => x.code === 'self_sufficient_stated'));
  assert(!sig('supply_mention', 'The company does not use agency staff.').some((x) => x.code === 'staffing_pressure_stated'));
  // Real pressure: agency reliance and recruitment difficulty are strength 3, a cover or interim mention 2.
  const preston = sig('staffing_pressure', 'The Lower Company uses agency staff to cover teaching assistant roles in several year groups.', 'Agency Staff Teaching Assistant 1 Yew').find((x) => x.code === 'staffing_pressure_stated');
  assertEquals(preston?.strength, 3);
  assertEquals(sig('supply_mention', 'Beaumont Primary Company employs long-term supply teaching assistants and pupil support assistants.', 'Long Term Supply (TA, PSAs)').find((x) => x.code === 'staffing_pressure_stated')?.strength, 3);
  assertEquals(sig('supply_mention', 'Hackbridge Primary Company uses agency supply staff for EYFS and Key Stage 1 PE cover.', 'Teaching EYFS & PE to Years 1 & 2 Agency supply').find((x) => x.code === 'staffing_pressure_stated')?.strength, 3);
  assertEquals(sig('staffing_pressure', 'The company says recruitment is a challenge in maths and science.').find((x) => x.code === 'staffing_pressure_stated')?.strength, 3);
  assertEquals(sig('staffing_pressure', 'Several posts have been hard to fill this year.').find((x) => x.code === 'staffing_pressure_stated')?.strength, 3);
  assertEquals(sig('staffing_pressure', "A maths subject leader's maternity leave is currently being covered by another staff member.", 'Asha Sale (Rebecca Wall covering maternity leave)').find((x) => x.code === 'staffing_pressure_stated')?.strength, 2);
  assertEquals(sig('staffing_pressure', 'The academy has several interim leadership roles including two Interim Assistant Principals.', 'Mr Ejiofor Interim Assistant Principal').find((x) => x.code === 'staffing_pressure_stated')?.strength, 2);
  assertEquals(sig('supply_mention', 'Copthall Company publishes feedback from supply staff praising the company community and leadership.', 'Thank you very much for the opportunity to do supply work in your company.').find((x) => x.code === 'staffing_pressure_stated')?.strength, 2);
  assertEquals(sig('staffing_pressure', 'The company is restructuring its support staff team.').find((x) => x.code === 'staffing_pressure_stated')?.strength, 2);
  // Pressure wording in a fact of another kind is not evidence.
  assert(!computeSignals(base({ facts: [fact({ kind: 'values', statement: 'We rely on agency staff and recruitment is a challenge.' })] })).some((x) => x.code === 'staffing_pressure_stated'));
  assert(!computeSignals(base({ facts: [fact({ kind: 'other', statement: 'We rely on agency staff and recruitment is a challenge.' })] })).some((x) => x.code === 'staffing_pressure_stated'));
});

Deno.test('framework_window for trust companies before 1 November 2026 only', () => {
  assert(codes(base({ trustName: 'ARK COMPANIES' })).includes('framework_window'));
  assert(!codes(base({ trustName: null })).includes('framework_window'));
  assert(!codes(base({ trustName: 'ARK COMPANIES', today: new Date('2026-11-01T00:00:00Z') })).includes('framework_window'));
});

Deno.test('resignation_deadline_near within 21 days before 31 Oct, 28 Feb, 31 May', () => {
  assertEquals(upcomingResignationDeadline(new Date('2026-10-15T00:00:00Z'))?.date, '2026-10-31');
  assertEquals(upcomingResignationDeadline(new Date('2026-10-09T00:00:00Z')), null);
  assertEquals(upcomingResignationDeadline(new Date('2027-02-10T00:00:00Z'))?.date, '2027-02-28');
  assertEquals(upcomingResignationDeadline(new Date('2026-05-31T00:00:00Z'))?.daysAway, 0);
  assert(codes(base({ today: new Date('2026-10-20T00:00:00Z') })).includes('resignation_deadline_near'));
  assert(!codes(base()).includes('resignation_deadline_near'));
});

Deno.test('term_start_near within 21 days before a term start', () => {
  assertEquals(upcomingTermStart(new Date('2026-08-20T00:00:00Z'))?.term.date, '2026-09-02');
  assertEquals(upcomingTermStart(new Date('2026-08-10T00:00:00Z')), null);
  assert(codes(base({ today: new Date('2026-12-20T00:00:00Z') })).includes('term_start_near'));
  assert(!codes(base()).includes('term_start_near'));
  assertEquals(currentTerm(TODAY), 'autumn term 2026');
  assertEquals(currentTerm(new Date('2026-08-01T00:00:00Z')), 'summer term 2026');
});

Deno.test('signals are sorted strongest first and empty input yields none', () => {
  const s = computeSignals(base({ openVacancies: [vac({ closingDate: '2026-09-10' })], facts: [fact({ kind: 'staffing_pressure', statement: 'Recruitment is a challenge.' })] }));
  assertEquals(s[0].code, 'staffing_pressure_stated');
  assertEquals(s[s.length - 1].strength, 1);
  assertEquals(computeSignals(base()), []);
});

Deno.test('agency_advertising: one agency is strength 2, two agencies strength 3, none is silent', () => {
  const advert = (over: Partial<import('./compute.ts').AgencyAdvertForSignals> = {}) => ({ id: 'a1', board: 'zen_educate', boardLabel: 'Zen Educate', agency: 'Zen Educate', title: 'Year 4 class teacher', url: 'https://www.zeneducate.com/jobs/x', firstSeen: '2026-09-09', lastSeen: '2026-09-09', ...over });
  assert(!codes(base({})).includes('agency_advertising'));
  const one = computeSignals(base({ agencyAdverts: [advert()] })).find((s) => s.code === 'agency_advertising');
  assertEquals(one?.strength, 2);
  assertEquals(one?.evidence[0].type, 'agency_advert');
  assertEquals(one?.evidence[0].source_url, 'https://www.zeneducate.com/jobs/x');
  assertEquals(one?.explanation, 'Zen Educate is advertising "Year 4 class teacher" for this company (seen 9 Sep).');
  assertEquals(one?.evidence[0].text, 'Zen Educate: "Year 4 class teacher" (seen 9 Sep)');
  const two = computeSignals(base({ agencyAdverts: [advert(), advert({ id: 'a2', board: 'reed', boardLabel: 'Reed', agency: 'Reeson Education', url: 'https://www.reed.co.uk/jobs/y/2' })] })).find((s) => s.code === 'agency_advertising');
  assertEquals(two?.strength, 3);
  assert(two!.explanation.includes('Reeson Education is advertising "Year 4 class teacher" for this company on Reed (seen 9 Sep)'), two!.explanation);
});

// --- Phase 5: early demand ---------------------------------------------------

Deno.test('staff_departure: a departure fact within six months or dated ahead, strength 3 for two or more; arrivals are not a signal', () => {
  const leaving = fact({ id: 'd1', kind: 'staff_departure', statement: 'Mrs Patel, Head of Maths, is leaving the company at Christmas.', quote: 'Mrs Patel will be leaving us at Christmas', source_url: 'https://x/newsletter.pdf', date_hint: 'December 2026' });
  const one = find(base({ facts: [leaving] }), 'staff_departure');
  assertEquals(one?.strength, 2);
  assertEquals(one?.explanation, 'Mrs Patel, Head of Maths, is leaving the company at Christmas.');
  assertEquals(one?.evidence[0].quote, 'Mrs Patel will be leaving us at Christmas');
  const two = find(base({ facts: [leaving, fact({ id: 'd2', kind: 'staff_departure', statement: 'Mr Okafor is retiring in July.', quote: 'Mr Okafor is retiring', source_url: 'https://x/n', date_hint: 'July 2026' })] }), 'staff_departure');
  assertEquals(two?.strength, 3);
  assert(two!.explanation.startsWith('2 members of staff are leaving or have left: '));
  assert(!codes(base({ facts: [fact({ kind: 'staff_arrival', statement: 'Mr Okafor joins as Head of Maths.', quote: 'we welcome Mr Okafor' })] })).includes('staff_departure'));
  // An old departure is not a signal.
  assert(!codes(base({ facts: [fact({ kind: 'staff_departure', statement: 'Mrs Patel left in 2024.', quote: 'Mrs Patel left us', date_hint: 'July 2024' })] })).includes('staff_departure'));
});

Deno.test('resignation_deadline_near: strength 2 when the company has open teaching posts or staff leaving, else 1', () => {
  const near = new Date('2026-10-15T09:00:00Z'); // 16 days before 31 October
  const plain = find(base({ today: near }), 'resignation_deadline_near');
  assertEquals(plain?.strength, 1);
  assertEquals(plain?.explanation, 'Staff leaving at Christmas must resign by 2026-10-31, 16 days away; the company will know its gaps shortly after.');
  const gaps = find(base({ today: near, openVacancies: [vac({})] }), 'resignation_deadline_near');
  assertEquals(gaps?.strength, 2);
  assertEquals(gaps?.explanation, 'Staff leaving at Christmas must resign by 2026-10-31, 16 days away; the company will know its gaps shortly after, and it already has 1 open teaching post.');
  assertEquals(gaps?.evidence.length, 2, 'the calendar date plus the vacancy');
  const support = find(base({ today: near, openVacancies: [vac({ title: 'Teaching Assistant' })] }), 'resignation_deadline_near');
  assertEquals(support?.strength, 1, 'a support post does not follow the teachers\' deadline');
  const leaving = find(base({ today: near, facts: [fact({ kind: 'staff_departure', statement: 'Mrs Patel is leaving at Christmas.', quote: 'Mrs Patel will be leaving us', date_hint: 'December 2026' })] }), 'resignation_deadline_near');
  assertEquals(leaving?.strength, 2);
  assert(leaving!.explanation.endsWith('and it already has 1 member of staff leaving.'));
});

Deno.test('resignation_deadline_passed: for ten days after a deadline, never alongside the next countdown', () => {
  const after = new Date('2026-11-03T09:00:00Z');
  const s = find(base({ today: after, openVacancies: [vac({}), vac({ id: 'v2', title: 'Teacher of English' })] }), 'resignation_deadline_passed');
  assertEquals(s?.strength, 2);
  assertEquals(s?.explanation, 'The 2026-10-31 resignation deadline has passed, so the company now knows who is leaving at Christmas; it already has 2 open teaching posts.');
  assert(s!.evidence[0].text.includes('passed 3 days ago'));
  assertEquals(find(base({ today: after }), 'resignation_deadline_passed')?.strength, 1);
  assert(!codes(base({ today: after })).includes('resignation_deadline_near'));
  assert(!codes(base({ today: new Date('2026-11-12T09:00:00Z') })).includes('resignation_deadline_passed'), 'twelve days on it is gone');
  assert(codes(base({ today: new Date('2026-10-31T09:00:00Z') })).includes('resignation_deadline_near'), 'on the day it is still the countdown');
  assert(codes(base({ today: new Date('2026-10-31T09:00:00Z') })).includes('resignation_deadline_passed'), 'and the company knows from the day itself');
  assert(codes(base({ today: new Date('2027-03-02T09:00:00Z') })).includes('resignation_deadline_passed'), '28 February works across the year boundary');
});

Deno.test('ofsted_change: a report published in the last 120 days is news, strength 3 when an area needs attention; ofsted_ri_or_inadequate from the data', () => {
  const ofsted = (over: Partial<NonNullable<SignalInput['ofsted']>> = {}): NonNullable<SignalInput['ofsted']> => ({
    description: 'Graded inspection published 3 July 2026: leadership and governance "attention needed"', reportUrl: 'http://www.ofsted.gov.uk/x', inspectionType: 'Graded inspection', inspectionDate: '2026-06-12', publicationDate: '2026-07-03',
    concernAreas: ['leadership and governance "attention needed"'], categoryOfConcern: null, oeifOverall: null, oeifPublicationDate: null, ungradedDate: null, ungradedOutcome: null, ungradedConcern: false, changedAt: '2026-09-07', changeSummary: 'new Graded inspection published 3 July 2026', ...over,
  });
  const concern = computeSignals(base({ ofsted: ofsted() }));
  const change = concern.find((s) => s.code === 'ofsted_change')!;
  assertEquals(change.strength, 3);
  assertEquals(change.explanation, 'Ofsted: Graded inspection published 3 July 2026: leadership and governance "attention needed"; a report like this is usually followed by leadership change and staff turnover.');
  assertEquals(change.evidence[0].source_url, 'http://www.ofsted.gov.uk/x');
  assert(change.evidence[0].text.includes('change noticed 2026-09-07'));
  const ri = concern.find((s) => s.code === 'ofsted_ri_or_inadequate')!;
  assertEquals(ri.explanation, 'Ofsted: Graded inspection published 3 July 2026: leadership and governance "attention needed".');

  const fine = computeSignals(base({ ofsted: ofsted({ description: 'Graded inspection published 3 July 2026: no area graded below the expected standard', concernAreas: [] }) }));
  assertEquals(fine.find((s) => s.code === 'ofsted_change')?.strength, 2);
  assert(!fine.some((s) => s.code === 'ofsted_ri_or_inadequate'));

  const old = computeSignals(base({ ofsted: ofsted({ publicationDate: '2025-03-01', inspectionDate: '2025-02-01' }) }));
  assert(!old.some((s) => s.code === 'ofsted_change'), 'eighteen months on it is not news');
  assert(old.some((s) => s.code === 'ofsted_ri_or_inadequate'), 'but the attention-needed grade still counts for three years');

  const oldGood = computeSignals(base({ ofsted: ofsted({ publicationDate: null, inspectionDate: null, concernAreas: [], oeifOverall: 'Good', oeifPublicationDate: '2022-03-01', description: 'overall effectiveness Good (published 1 March 2022)' }) }));
  assert(!oldGood.some((s) => s.code === 'ofsted_change' || s.code === 'ofsted_ri_or_inadequate'));
});

Deno.test('agency_advertising: three adverts with one title on one board are one line, "3 adverts", in the wording and the evidence', () => {
  // Pentland Field Company, 10 September dry run: three Zen Educate posts with the same title and different URLs.
  const ad = (id: string, title = 'SEN Teaching Assistant - Hillingdon Sen-company') => ({ id, board: 'zen_educate', boardLabel: 'Zen Educate', agency: 'Zen Educate', title, url: `https://zen.example/${id}`, firstSeen: '2026-09-09', lastSeen: '2026-09-10' });
  const s = find(base({ agencyAdverts: [ad('a'), ad('b'), ad('c')] }), 'agency_advertising')!;
  assertEquals(s.strength, 2);
  assertEquals(s.explanation, 'Zen Educate is advertising "SEN Teaching Assistant - Hillingdon Sen-company" for this company (3 adverts, seen 10 Sep).');
  assertEquals(s.evidence.length, 1);
  assertEquals(s.evidence[0].text, 'Zen Educate: "SEN Teaching Assistant - Hillingdon Sen-company" (3 adverts, seen 10 Sep)');
  // Case and spacing differences are the same title; a different title is a second line.
  const mixed = find(base({ agencyAdverts: [ad('a'), ad('b', 'SEN teaching assistant -  Hillingdon SEN-Company'), ad('c', 'Year 2 Class Teacher')] }), 'agency_advertising')!;
  assertEquals(mixed.evidence.length, 2);
  assert(mixed.explanation.includes('(2 adverts, seen 10 Sep); Zen Educate is advertising "Year 2 Class Teacher" for this company (seen 10 Sep).'), mixed.explanation);
});

Deno.test('agency_spend_rising is strength 3 when up two years running, with the series and per pupil in the evidence', () => {
  const trend = computeTrend([
    { fiscalYear: '2022-23', agencyAndSupply: 50000 },
    { fiscalYear: '2023-24', agencyAndSupply: 70000 },
    { fiscalYear: '2024-25', agencyAndSupply: 100000, pupils: 400 },
  ]);
  const s = find(base({ spend: { latest: { fiscalYear: '2024-25', agencyAndSupply: 100000 }, previous: { fiscalYear: '2023-24', agencyAndSupply: 70000 }, peers: null, trend } }), 'agency_spend_rising');
  assertEquals(s.strength, 3);
  assert(s.explanation.includes('the second rise in a row'));
  assert(s.evidence[0].text.includes('£50,000 in 2022-23'));
  assert(s.evidence[0].text.includes('£250 per pupil'));
  const one = find(base({ spend: { latest: { fiscalYear: '2024-25', agencyAndSupply: 100000 }, previous: { fiscalYear: '2023-24', agencyAndSupply: 70000 }, peers: null } }), 'agency_spend_rising');
  assertEquals(one.strength, 2);
});

Deno.test('tender signals: an open tender by the trust is strength 3, by the authority 2; an award in the last year is 2', () => {
  const t = (over: Partial<TenderForSignals>): TenderForSignals => ({ id: 't1', source: 'find_a_tender', title: 'Supply teachers and agency staff', buyerName: 'ARK COMPANIES', stage: 'tender', publishedAt: '2026-09-01', deadline: '2026-10-08', valueAmount: 350000, url: 'https://www.find-tender.service.gov.uk/Notice/1', awardedSupplier: null, contractEnd: null, matchedTo: 'trust', scope: 'local', ...over });
  const open = find(base({ tenders: [t({})] }), 'tender_open');
  assertEquals(open.strength, 3);
  assert(open.explanation.includes('Its trust (ARK COMPANIES) has a tender open'));
  assertEquals(open.evidence[0].type, 'tender');
  assertEquals(find(base({ tenders: [t({ matchedTo: 'la', buyerName: 'London Borough of Enfield' })] }), 'tender_open').strength, 2);
  assert(!codes(base({ tenders: [t({ deadline: '2026-01-01' })] })).includes('tender_open'));
  const award = find(base({ tenders: [t({ stage: 'award', deadline: null, awardedSupplier: 'Other Agency', contractEnd: '2028-08-31', publishedAt: '2026-06-01' })] }), 'tender_awarded');
  assertEquals(award.strength, 2);
  assert(award.explanation.includes('to Other Agency'));
  assert(award.explanation.includes('runs to 2028-08-31'));
  assert(!codes(base({ tenders: [t({ stage: 'award', publishedAt: '2024-01-01' })] })).includes('tender_awarded'));
});

Deno.test('register signals: growing roll, over capacity, new and proposed companies, trust change', () => {
  const reg = (over: Partial<RegisterForSignals>): RegisterForSignals => ({ status: 'Open', openDate: '2005-09-01', reasonOpened: 'Not applicable', pupils: 500, capacity: 450, censusDate: '2025-01-16', pupilHistory: [{ fiscalYear: '2022-23', pupils: 400 }, { fiscalYear: '2023-24', pupils: 420 }, { fiscalYear: '2024-25', pupils: 470 }], trustName: null, trustChange: null, ...over });
  const g = find(base({ register: reg({}) }), 'pupil_growth');
  assertEquals(g.strength, 2);
  assert(g.explanation.includes('rose 12%'));
  assert(g.explanation.includes('over capacity'));
  assert(!codes(base({ register: reg({ pupils: 400, capacity: 450, pupilHistory: [{ fiscalYear: '2023-24', pupils: 420 }, { fiscalYear: '2024-25', pupils: 425 }] }) })).includes('pupil_growth'));
  // A company a few pupils over its places is normal for London and is not a signal on its own.
  assert(!codes(base({ register: reg({ pupils: 460, capacity: 450, pupilHistory: [{ fiscalYear: '2023-24', pupils: 455 }, { fiscalYear: '2024-25', pupils: 460 }] }) })).includes('pupil_growth'));
  const slow = find(base({ register: reg({ pupils: 400, capacity: 450, pupilHistory: [{ fiscalYear: '2022-23', pupils: 400 }, { fiscalYear: '2023-24', pupils: 425 }, { fiscalYear: '2024-25', pupils: 445 }] }) }), 'pupil_growth');
  assertEquals(slow.strength, 1);
  assertEquals(find(base({ register: reg({ status: 'Proposed to open', openDate: '2027-09-01', pupils: null, capacity: null, pupilHistory: [] }) }), 'new_company').strength, 3);
  assertEquals(find(base({ register: reg({ openDate: '2025-09-01', reasonOpened: 'New Provision', pupils: null, capacity: null, pupilHistory: [] }) }), 'new_company').strength, 2);
  assert(!codes(base({ register: reg({ openDate: '2025-09-01', reasonOpened: 'Academy Converter', pupils: null, capacity: null, pupilHistory: [] }) })).includes('new_company'));
  const tc = find(base({ register: reg({ pupils: null, capacity: null, pupilHistory: [], trustChange: { noticedAt: '2026-09-01', previousTrust: 'OLD TRUST', newTrust: 'NEW TRUST' } }) }), 'trust_change');
  assert(tc.explanation.includes('moved from OLD TRUST to NEW TRUST'));
  assert(!codes(base({ register: reg({ pupils: null, capacity: null, pupilHistory: [], trustChange: { noticedAt: '2024-01-01', previousTrust: 'A', newTrust: 'B' } }) })).includes('trust_change'));
});

Deno.test('a note from the team is a strength-1 signal with each note as evidence', () => {
  const facts = [
    fact({ id: 'f1', kind: 'consultant_intel', statement: 'New head in first term; Barnet Special Education Trust.', quote: '', source_url: 'consultant sheet, September 2026', statement_key: 'k1' }),
    fact({ id: 'f2', kind: 'consultant_intel', statement: 'Still growing: funded for 70 places in 2025-26, rising to 90 when full.', quote: '', source_url: 'consultant sheet, September 2026', statement_key: 'k2' }),
  ];
  const s = find(base({ facts }), 'consultant_intel');
  assert(s, 'expected the From the team signal');
  assertEquals(s.label, 'From the team');
  assertEquals(s.strength, 1);
  assertEquals(s.evidence.map((e) => e.text), facts.map((f) => f.statement));
  assertEquals(s.explanation, 'New head in first term; Barnet Special Education Trust; 1 more note from the team.');
  assertEquals(codes(base({ facts: [fact({ kind: 'other', statement: 'A note.' })] })).includes('consultant_intel'), false);
});
