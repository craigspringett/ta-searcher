import { assertEquals } from './test-assert.ts';
import { consultantInactive, recipientsFor, runEligibility, companyInScope, vacancyEligible, type Assignments, type ConsultantRow } from './alerts.ts';

const consultants = new Map<string, ConsultantRow>([
  ['c-anja', { id: 'c-anja', name: 'Anja Micic', email: 'anja@whofoundwho.co.uk', active: true }],
  ['c-house', { id: 'c-house', name: 'House', email: 'luke@whofoundwho.co.uk', active: true }],
]);
const base = { id: 'cfg', name: null, alert_type: 'deadline', la_filter: null, enabled: true, auto_refresh_enabled: false, daily_alerts: true, weekly_alerts: false };

Deno.test('recipientsFor: the setting\'s own address first, else the consultant\'s, plus extras, no duplicates', () => {
  assertEquals(recipientsFor({ ...base, email: null, consultant_filter: 'Anja Micic', consultant_id: 'c-anja' }, consultants), ['anja@whofoundwho.co.uk']);
  // Craig's copy of Anja's alert keeps going to Craig, not to Anja twice.
  assertEquals(recipientsFor({ ...base, email: 'Craig@BigFishRecruitment.co.uk', consultant_filter: 'Anja Micic', consultant_id: 'c-anja' }, consultants), ['craig@bigfishrecruitment.co.uk']);
  assertEquals(recipientsFor({ ...base, email: null, consultant_filter: null, consultant_id: 'c-anja', extra_recipients: ['craig@bigfishrecruitment.co.uk', 'ANJA@whofoundwho.co.uk', 'not-an-address'] }, consultants),
    ['anja@whofoundwho.co.uk', 'craig@bigfishrecruitment.co.uk']);
  assertEquals(recipientsFor({ ...base, email: null, consultant_filter: 'Nobody', consultant_id: 'missing' }, consultants), []);
});

Deno.test('companyInScope: by assignment when the setting has a consultant_id, by the legacy tag otherwise', () => {
  const assignments: Assignments = new Map([['s1', new Set(['c-anja'])], ['s2', new Set(['c-house'])]]);
  const s1 = { id: 's1', company_name: 'One', url: 'https://one', company_number: '00000001', analysis_result: { consultant: 'House' } };
  const s2 = { id: 's2', company_name: 'Two', url: 'https://two', company_number: '00000002', analysis_result: { consultant: 'Anja Micic' } };
  const byId = { ...base, email: null, consultant_filter: 'Anja Micic', consultant_id: 'c-anja' };
  assertEquals(companyInScope(s1, byId, assignments), true, 'assigned wins over a stale tag');
  assertEquals(companyInScope(s2, byId, assignments), false);
  const legacy = { ...base, email: null, consultant_filter: 'Anja Micic', consultant_id: null };
  assertEquals(companyInScope(s2, legacy, assignments), true, 'no consultant_id: the tag decides');
  assertEquals(companyInScope(s1, byId, undefined), false, 'no assignments loaded: the tag decides');
});

Deno.test('consultantInactive: by id, by legacy name, never for an unknown consultant', () => {
  const withInactive = new Map(consultants);
  withInactive.set('c-old', { id: 'c-old', name: 'Old Hand', email: 'old@whofoundwho.co.uk', active: false });
  assertEquals(consultantInactive({ consultant_id: 'c-old', consultant_filter: 'Old Hand' }, withInactive), true);
  assertEquals(consultantInactive({ consultant_id: null, consultant_filter: 'old hand' }, withInactive), true);
  assertEquals(consultantInactive({ consultant_id: 'c-anja', consultant_filter: null }, withInactive), false);
  assertEquals(consultantInactive({ consultant_id: null, consultant_filter: 'Nobody' }, withInactive), false);
  assertEquals(consultantInactive({ consultant_id: null, consultant_filter: null }, withInactive), false);
});

Deno.test('a degraded run with a job board that answered makes only that board\'s vacancies eligible; a degraded run with no board is skipped', () => {
  const cutoff = new Date('2026-09-10T05:00:00Z');
  const clean = { started_at: '2026-09-10T05:10:00Z', finished_at: '2026-09-10T05:11:00Z', degraded: false, sources_ok: ['careers_page', 'ashby', 'greenhouse'] };
  const deadSiteWithBoards = { started_at: '2026-09-10T05:10:00Z', finished_at: '2026-09-10T05:11:00Z', degraded: true, sources_ok: ['ashby', 'lever'] };
  const deadSiteNoBoards = { started_at: '2026-09-10T05:10:00Z', finished_at: '2026-09-10T05:11:00Z', degraded: true, sources_ok: [] as string[] };
  const board = { source: 'ashby' };
  const otherBoard = { source: 'greenhouse' };
  const website = { source: 'careers_page' };
  const ai = { source: 'llm' };

  const c = runEligibility(clean, cutoff);
  assertEquals(c, { fresh: true });
  assertEquals([board, website, ai].map((v) => vacancyEligible(v, c)), [true, true, true]);

  const d = runEligibility(deadSiteWithBoards, cutoff);
  assertEquals(d.fresh, true);
  assertEquals(d.boardsOnly, ['ashby', 'lever']);
  assertEquals(vacancyEligible(board, d), true, 'the board that answered');
  assertEquals(vacancyEligible(otherBoard, d), false, 'a board that did not answer');
  assertEquals(vacancyEligible(website, d), false, 'careers-page rows from a degraded run are never alerted');
  assertEquals(vacancyEligible(ai, d), false);

  const n = runEligibility(deadSiteNoBoards, cutoff);
  assertEquals(n.fresh, false);
  assertEquals(n.reason, 'latest run was degraded and no job board answered');
  assertEquals(vacancyEligible(board, n), false);

  assertEquals(runEligibility(undefined, cutoff).fresh, false);
  assertEquals(runEligibility({ ...clean, finished_at: null }, cutoff).reason, 'latest run has not finished');
  assertEquals(runEligibility({ ...deadSiteWithBoards, started_at: '2026-09-09T05:10:00Z' }, cutoff).fresh, false, 'older than the snapshot, degraded or not');
});
