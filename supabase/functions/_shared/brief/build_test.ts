import { assert, assertEquals } from '../test-assert.ts';
import { BRIEF_GREEN_SCORE, BRIEF_TOP_COUNT, bestContact, briefCopies, briefSubject, buildManagerBrief, buildPersonBrief, copySubject, countdownLine, outcomeLine, personName, rankCompanies, toBriefCompany, weekOfLabel, type BriefCompanyInput } from './build.ts';
import { scoreBand } from '../score/propensity.ts';

const company = (over: Partial<BriefCompanyInput>): BriefCompanyInput => ({
  id: 'id-' + (over.name || 'x'), name: 'Oak Labs', stage: 'seed', sector: 'Software', website: 'https://oaklabs.example', score: 40,
  breakdown: [{ code: 'hiring_surge', label: 'Many open roles', points: 24, reason: '8 roles are open.', kind: 'signal' }, { code: 'accelerator', label: 'Accelerator alumni', points: 6, reason: 'A Y Combinator company.', kind: 'signal' }],
  topReason: '8 roles are open.', contacts: [], phone: '020 7000 0000', openVacancies: 2, lastOutcome: null, nextCallback: null, consultantNames: ['Luke Carnell'], ...over,
});

Deno.test('bestContact: a named person beats a generic mailbox; found beats a name only; then the senior role', () => {
  assertEquals(bestContact([]), null);
  assertEquals(bestContact([{ name: 'Mr A Brown', role: 'SENCO', email: 'a.brown@oak.sch.uk', confidence: 'found' }, { name: 'Mrs J Smith', role: 'Headteacher', email: '', confidence: 'role_only' }]), { name: 'Mr A Brown', role: 'SENCO', email: 'a.brown@oak.sch.uk', confidence: 'found' });
  assertEquals(bestContact([{ name: 'Mr A Brown', role: 'SENCO', email: '', confidence: 'role_only' }, { name: 'Mrs J Smith', role: 'Headteacher', email: '', confidence: 'role_only' }])?.name, 'Mrs J Smith');
  assertEquals(bestContact([{ name: '', role: 'Office', email: 'office@oak.sch.uk', confidence: 'found' }])?.email, 'office@oak.sch.uk');
  assertEquals(bestContact([{ name: '', role: "Office manager / Headteacher's PA", email: 'office@oak.sch.uk', confidence: 'found' }, { name: 'Miss N Tranter', role: 'Headteacher', email: '', confidence: 'role_only' }])?.name, 'Miss N Tranter', 'a name to ask for beats a mailbox');
  assertEquals(personName(['House', 'Luke Carnell']), 'Luke Carnell');
  assertEquals(personName(['Anja Cold Targets', 'Anja Micic']), 'Anja Micic');
  assertEquals(personName(['Isobel NEW Area', 'Isobel']), 'Isobel');
  assertEquals(personName(['Stephanie']), 'Stephanie');
});

Deno.test('outcomeLine: a callback due within a fortnight wins, then a recent outcome', () => {
  const today = new Date('2026-09-11T06:30:00Z');
  assertEquals(outcomeLine({ lastOutcome: null, nextCallback: '2026-09-15T09:00:00Z' }, today), 'Call back due Tue 15 Sep');
  assertEquals(outcomeLine({ lastOutcome: { kind: 'spoke_to', at: '2026-09-08T10:00:00Z' }, nextCallback: '2026-10-15T09:00:00Z' }, today), 'Spoke to on Tue 8 Sep');
  assertEquals(outcomeLine({ lastOutcome: { kind: 'voicemail', at: '2026-07-01T10:00:00Z' }, nextCallback: null }, today), undefined);
});

Deno.test('toBriefCompany: reason, further signals, band and links', () => {
  const b = toBriefCompany(company({ contacts: [{ name: 'Mrs J Smith', role: 'Headteacher', email: 'head@oak.sch.uk', confidence: 'found' }] }), 3, 'https://app.example');
  assertEquals(b.rank, 3);
  assertEquals(b.band, 'warm');
  assertEquals(b.reason, '8 roles are open.');
  assertEquals(b.alsoSignals, ['Framework window (RM6376)']);
  assertEquals(b.appUrl, 'https://app.example/companies/id-x');
  assertEquals(b.contact?.email, 'head@oak.sch.uk');
  assertEquals(b.consultant, undefined);
  assertEquals(toBriefCompany(company({}), 1, 'https://app.example', true).consultant, 'Luke Carnell');
  const none = toBriefCompany(company({ score: 0, breakdown: [], topReason: null }), 9, 'https://app.example');
  assertEquals(none.reason, 'No signal today; a routine call.');
  assertEquals(none.band, 'cool');
});

const luke = { email: 'luke@x', name: 'Luke Carnell', consultantIds: ['c1'] };

Deno.test('rankCompanies and the person brief: the top five by score, or every green company when more than five are green', () => {
  assertEquals(BRIEF_TOP_COUNT, 5);
  assertEquals(scoreBand(BRIEF_GREEN_SCORE), 'hot', 'green is the top band');
  assertEquals(scoreBand(BRIEF_GREEN_SCORE - 1), 'warm', 'and starts exactly where scoreBand does');
  // Two green companies among twelve: exactly five, the two green and the next three by score, whatever they score.
  const twoGreen = [company({ name: 'B', score: 40 }), company({ name: 'A', score: 40 }), company({ name: 'C', score: 71 }), company({ name: 'D', score: 0 }), company({ name: 'E', score: 29 }), company({ name: 'F', score: 30 }), company({ name: 'G', score: 33 }), company({ name: 'H', score: 60 }), company({ name: 'I', score: 12 }), company({ name: 'J', score: 59 }), company({ name: 'K', score: null }), company({ name: 'L', score: 8 })];
  assertEquals(rankCompanies(twoGreen).map((s) => `${s.name}:${s.score}`), ['C:71', 'H:60', 'J:59', 'A:40', 'B:40'], 'score first, then name');
  assertEquals(rankCompanies([...twoGreen, company({ id: 'dup', name: 'C', score: 55 })]).map((s) => `${s.name}:${s.score}`), ['C:71', 'H:60', 'J:59', 'A:40', 'B:40'], 'a company tracked twice is one line');
  const two = buildPersonBrief(luke, twoGreen, 'https://app.example');
  assertEquals(two.sections.length, 1);
  assertEquals(two.count, 5);
  assertEquals(two.sections[0].title, 'Your 5 companies to call');
  assertEquals(two.sections[0].subtitle, 'The 5 of your 12 companies most likely to buy now (2 to call this week, 5 worth a call).');
  assertEquals(two.sections[0].companies.map((s) => `${s.rank} ${s.name}`), ['1 C', '2 H', '3 J', '4 A', '5 B']);
  assertEquals(two.totals, { hot: 2, warm: 5, cool: 5, companies: 12 });
  // Fewer green than five but the fifth is a low score: still five. A 29 and a 12 fill the list, a 0 or a missing score never does.
  const thin = [company({ name: 'C', score: 71 }), company({ name: 'E', score: 29 }), company({ name: 'I', score: 12 }), company({ name: 'D', score: 0 }), company({ name: 'K', score: null }), company({ name: 'A', score: 40 }), company({ name: 'B', score: 40 })];
  assertEquals(rankCompanies(thin).map((s) => s.name), ['C', 'A', 'B', 'E', 'I']);
  // Nine green: all nine, then nothing else; the heading carries nine.
  const nineGreen = [...Array.from({ length: 9 }, (_, i) => company({ name: `G${i}`, score: 60 + i })), company({ name: 'W', score: 58 }), company({ name: 'X', score: 45 })];
  assertEquals(rankCompanies(nineGreen).length, 9);
  const nine = buildPersonBrief(luke, nineGreen, 'https://app.example');
  assertEquals(nine.count, 9);
  assertEquals(nine.sections[0].title, 'Your 9 companies to call');
  assertEquals(nine.sections[0].subtitle, 'Every one of the 9 companies on your patch to call this week, ranked; the other 2 have nothing as pressing.');
  assertEquals(nine.sections[0].companies.map((s) => s.name), ['G8', 'G7', 'G6', 'G5', 'G4', 'G3', 'G2', 'G1', 'G0']);
  assertEquals(nine.sections[0].companies.every((s) => s.band === 'hot'), true);
  // Exactly five green: five, no more.
  assertEquals(buildPersonBrief(luke, nineGreen.slice(4), 'https://app.example').count, 5);
  // Three scored companies in total (plus two with nothing): the three, and the subtitle says so in one line.
  const threeScored = [company({ name: 'C', score: 71 }), company({ name: 'A', score: 40 }), company({ name: 'E', score: 29 }), company({ name: 'D', score: 0 }), company({ name: 'K', score: null })];
  const three = buildPersonBrief(luke, threeScored, 'https://app.example');
  assertEquals(three.count, 3);
  assertEquals(three.sections[0].title, 'Your 3 companies to call');
  assertEquals(three.sections[0].subtitle, "Only 3 of your 5 companies have a score on today's signals, so the list is shorter than the usual five.");
  assertEquals(three.sections[0].companies.map((s) => `${s.rank} ${s.name}`), ['1 C', '2 A', '3 E']);
  assertEquals(buildPersonBrief(luke, threeScored.slice(0, 1), 'https://app.example').sections[0].subtitle, "Only 1 of your 1 companies has a score on today's signals, so the list is shorter than the usual five.");
  // Nothing scored at all.
  const none = buildPersonBrief(luke, [company({ name: 'D', score: 0 }), company({ name: 'K', score: null })], 'https://app.example');
  assertEquals(none.count, 0);
  assertEquals(none.sections[0].title, 'No company to call this week');
  assertEquals(none.sections[0].subtitle, "None of your 2 companies has a score on today's signals.");
  assertEquals(none.sections[0].companies, []);
  assertEquals(briefSubject(9, '14 September 2026'), 'Your 9 companies to call, week of 14 September 2026');
  assertEquals(briefSubject(5, '14 September 2026'), 'Your 5 companies to call, week of 14 September 2026');
  assertEquals(briefSubject(1, '14 September 2026'), 'Your 1 company to call, week of 14 September 2026');
  assertEquals(briefSubject(0, '14 September 2026'), 'Your 0 companies to call, week of 14 September 2026');
});

Deno.test('the manager brief: the same rule across the patch with the consultant named, then per consultant', () => {
  const lukes = [company({ name: 'B', score: 40 }), company({ name: 'C', score: 71 }), company({ name: 'Z', score: 5 }), company({ name: 'Y', score: 0 })];
  const kims = Array.from({ length: 6 }, (_, i) => company({ name: `K${i}`, score: 62 + i, consultantNames: ['Kim Webb'] }));
  const people = [luke, { email: 'kim@x', name: 'Kim Webb', consultantIds: ['c2'] }];
  const m = buildManagerBrief(people, new Map([['luke@x', lukes], ['kim@x', kims]]), [...lukes, ...kims], 'https://app.example');
  assertEquals(m.sections.map((s) => s.title), ['Top 7 across the patch', 'Kim Webb', 'Luke Carnell']);
  assertEquals(m.count, 7, 'seven green across the patch, so seven');
  assertEquals(m.sections[0].companies.map((s) => `${s.name}:${s.consultant}`), ['C:Luke Carnell', 'K5:Kim Webb', 'K4:Kim Webb', 'K3:Kim Webb', 'K2:Kim Webb', 'K1:Kim Webb', 'K0:Kim Webb']);
  assertEquals(m.sections[1].subtitle, '6 companies: 6 to call this week, 0 worth a call. Top 6:');
  assertEquals(m.sections[1].companies.length, 6, 'six green: all six');
  assertEquals(m.sections[2].subtitle, '4 companies: 1 to call this week, 1 worth a call. Only 3 scored:');
  assertEquals(m.sections[2].companies.map((s) => s.name), ['C', 'B', 'Z'], 'three scored: the three, the unscored one never');
  assertEquals(m.totals, { hot: 7, warm: 1, cool: 2, companies: 10 });
});

Deno.test("directors' copies: every consultant edition also goes to the directors and the consultant rows' own copy lists, never to the consultant twice", () => {
  const luke = { email: 'luke@whofoundwho.co.uk', name: 'Luke Carnell', consultantIds: ['c-house', 'c-luke'] };
  const anja = { email: 'anja@whofoundwho.co.uk', name: 'Anja Micic', consultantIds: ['c-anja', 'c-anja-cold'] };
  const directors = ['craig@whofoundwho.co.uk', 'Luke@WhoFoundWho.co.uk'];
  const copies = new Map<string, string[]>([['c-anja-cold', ['nikki@whofoundwho.co.uk', 'craig@whofoundwho.co.uk', 'not-an-address']], ['c-house', ['craig@bigfishrecruitment.co.uk']]]);
  assertEquals(briefCopies(anja, directors, copies), ['craig@whofoundwho.co.uk', 'luke@whofoundwho.co.uk', 'nikki@whofoundwho.co.uk']);
  assertEquals(briefCopies(luke, directors, copies), ['craig@whofoundwho.co.uk', 'craig@bigfishrecruitment.co.uk'], "Luke's own brief is not copied to Luke");
  assertEquals(briefCopies(anja, [], new Map()), []);
  assertEquals(copySubject('Anja Micic', 'Your 12 companies to call, week of 14 September 2026'), '[Anja] Your 12 companies to call, week of 14 September 2026');
  assertEquals(copySubject('', 'x'), '[Consultant] x');
});

Deno.test('countdown and week labels', () => {
  assertEquals(weekOfLabel(new Date('2026-09-11T06:30:00Z')), '14 September 2026', 'a Friday points at the coming Monday');
  assertEquals(weekOfLabel(new Date('2026-09-14T06:30:00Z')), '21 September 2026', 'a Monday points at the next one');
  assertEquals(countdownLine(new Date('2026-08-01T06:30:00Z')), '', 'start-ups have no calendar line');
});

Deno.test('the reason for calling is a signal line: a raise or a signal-bearing fact, never an unknown code or the talent-lead note', () => {
  const spend = { code: 'funding_round', label: 'Raised recently', points: 30, reason: 'Raised £10.3 million in a Series A led by Headline in July 2026.', kind: 'signal' as const };
  const pressure = { code: 'staffing_pressure_stated', label: 'Hiring pressure stated', points: 25, reason: 'The company says it is doubling the team this year.', kind: 'signal' as const };
  const stale = { code: 'stale', label: 'Analysis is not fresh', points: 0.85, reason: 'old', kind: 'adjustment' as const };
  // The stored top reason is used when its code is a signal the brief may quote.
  const a = toBriefCompany(company({ breakdown: [spend, pressure], topReason: pressure.reason, topCode: 'staffing_pressure_stated' }), 1, 'https://app');
  assertEquals(a.reason, pressure.reason);
  assertEquals(a.alsoSignals, ['Raised recently']);
  // A raise stays as it is.
  const b = toBriefCompany(company({ breakdown: [spend], topReason: spend.reason, topCode: 'funding_round' }), 1, 'https://app');
  assertEquals(b.reason, spend.reason);
  // A stored reason whose code is not a signal (an old row, a values fact that once leaked) is skipped for the next best signal line.
  const c = toBriefCompany(company({ breakdown: [{ code: 'values_fact', label: 'Values', points: 30, reason: 'The company values kindness.', kind: 'signal' }, spend], topReason: 'The company values kindness.', topCode: 'values_fact' }), 1, 'https://app');
  assertEquals(c.reason, spend.reason);
  assertEquals(c.alsoSignals, []);
  // The self-sufficiency note is never the reason and never in "also".
  const d = toBriefCompany(company({ breakdown: [{ code: 'has_talent_lead', label: 'A Head of Talent is already in post', points: 0, reason: 'Has a Head of Talent.', kind: 'signal' }, spend, stale], topReason: null, topCode: null }), 1, 'https://app');
  assertEquals(d.reason, spend.reason);
  assertEquals(d.alsoSignals, []);
  // Nothing to quote: the routine-call line.
  assertEquals(toBriefCompany(company({ score: 0, breakdown: [], topReason: null, topCode: null }), 1, 'https://app').reason, 'No signal today; a routine call.');
});
