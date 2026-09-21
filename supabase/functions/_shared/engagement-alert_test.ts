import { assert, assertEquals } from './test-assert.ts';
import { decideEngagementAlert, DEFAULT_ENGAGEMENT_SETTINGS, engagementSettingsFrom, engagementSubject } from './engagement-alert.ts';

const meta = { kind: 'outreach', company_search_id: '5b520572-812c-4831-9852-867489d813bb', company_name: 'Hatch End High Company', contact_name: 'Mrs Patel', reply_to: 'kim@whofoundwho.co.uk', subject: 'Your Year 4 post' };
const base = { type: 'opened', recipient: 'head@hatchend.harrow.sch.uk', url: null, occurredAt: '2026-09-21T12:05:00Z', countAfterInsert: 1, metadata: meta, settings: DEFAULT_ENGAGEMENT_SETTINGS, appBaseUrl: 'https://he-giveth.whofoundwho.co.uk' };

Deno.test('the first open and the first click alert the sender; later ones, tests, our own addresses and other kinds do not', () => {
  const open = decideEngagementAlert(base);
  assert(open.alert);
  assertEquals(open.alert!.to, 'kim@whofoundwho.co.uk');
  assertEquals(open.alert!.data.companyUrl, 'https://he-giveth.whofoundwho.co.uk/companies/5b520572-812c-4831-9852-867489d813bb#contacts');
  assertEquals(engagementSubject(open.alert!.data), 'Mrs Patel at Hatch End High Company opened your email');
  const click = decideEngagementAlert({ ...base, type: 'clicked', url: 'https://whofoundwho.co.uk/x' });
  assertEquals(click.alert!.data.url, 'https://whofoundwho.co.uk/x');
  assertEquals(engagementSubject(click.alert!.data), 'Mrs Patel at Hatch End High Company clicked a link in your email');
  assertEquals(decideEngagementAlert({ ...base, countAfterInsert: 2 }).alert, null);
  assertEquals(decideEngagementAlert({ ...base, type: 'delivered' }).alert, null);
  assertEquals(decideEngagementAlert({ ...base, metadata: { ...meta, test: true } }).alert, null);
  assertEquals(decideEngagementAlert({ ...base, recipient: 'craig@whofoundwho.co.uk' }).alert, null);
  assertEquals(decideEngagementAlert({ ...base, recipient: 'craig@bigfishrecruitment.co.uk' }).alert, null);
  assertEquals(decideEngagementAlert({ ...base, metadata: { ...meta, kind: 'alert' } }).alert, null);
  assertEquals(decideEngagementAlert({ ...base, metadata: { ...meta, reply_to: null } }).alert, null);
  assertEquals(decideEngagementAlert({ ...base, metadata: { ...meta, kind: 'shortlist', contact_name: 'Ryan Foster' }, recipient: 'foster@example.com' }).alert!.data.contactName, 'Ryan Foster');
});

Deno.test('settings: off for everyone, for one kind, or for one person', () => {
  assertEquals(engagementSettingsFrom(null), DEFAULT_ENGAGEMENT_SETTINGS);
  const s = engagementSettingsFrom({ enabled: true, opens: false, clicks: true, off_for: [' Kim@WhoFoundWho.co.uk '] });
  assertEquals(s, { enabled: true, opens: false, clicks: true, offFor: ['kim@whofoundwho.co.uk'] });
  assertEquals(decideEngagementAlert({ ...base, settings: s }).alert, null, 'opens off');
  assertEquals(decideEngagementAlert({ ...base, type: 'clicked', settings: s }).alert, null, 'Kim is off');
  assert(decideEngagementAlert({ ...base, type: 'clicked', settings: s, metadata: { ...meta, reply_to: 'luke@whofoundwho.co.uk' } }).alert, 'Luke is on');
  assertEquals(decideEngagementAlert({ ...base, settings: { ...s, enabled: false }, type: 'clicked', metadata: { ...meta, reply_to: 'luke@whofoundwho.co.uk' } }).alert, null, 'all off');
});
