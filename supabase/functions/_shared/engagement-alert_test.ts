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

Deno.test('an open or click seconds after delivery is a security scan and sends no alert (20 October 2026)', async () => {
  const { isAutomaticEngagement } = await import('./email-events.ts');
  const { decideEngagementAlert, DEFAULT_ENGAGEMENT_SETTINGS } = await import('./engagement-alert.ts');
  assertEquals(isAutomaticEngagement('opened', '2026-10-20T09:12:27Z', '2026-10-20T09:12:22Z'), true);
  assertEquals(isAutomaticEngagement('clicked', '2026-10-20T09:12:50Z', '2026-10-20T09:12:22Z'), true);
  assertEquals(isAutomaticEngagement('opened', '2026-10-20T09:40:00Z', '2026-10-20T09:12:22Z'), false);
  assertEquals(isAutomaticEngagement('opened', '2026-10-20T09:12:27Z', null), false);
  const d = decideEngagementAlert({ type: 'opened', recipient: 'a@b.com', url: null, occurredAt: '2026-10-20T09:12:27Z', countAfterInsert: 1, metadata: { kind: 'outreach', reply_to: 'craig@bigfishrecruitment.co.uk' }, automatic: true, settings: DEFAULT_ENGAGEMENT_SETTINGS, appBaseUrl: 'https://x' });
  assertEquals(d.alert, null);
});

Deno.test('classifyEngagement: scanners, data centres and Microsoft within minutes are machines; later human-looking opens are not (21 October 2026)', async () => {
  const { classifyEngagement, engagementIp } = await import('./email-events.ts');
  const d = '2026-10-21T13:50:12Z';
  assertEquals(classifyEngagement('opened', '2026-10-21T13:50:35Z', d, 'AS8075 Microsoft Corporation').automatic, true);
  assertEquals(classifyEngagement('clicked', '2026-10-21T13:52:52Z', d, 'AS396982 Google LLC').automatic, true, 'Google Cloud');
  assertEquals(classifyEngagement('clicked', '2026-10-21T13:53:00Z', d, 'AS16509 Amazon.com, Inc.').automatic, true, 'Amazon');
  assertEquals(classifyEngagement('opened', '2026-10-21T14:35:00Z', d, 'AS54113 Fastly, Inc.').automatic, true, 'privacy relay');
  assertEquals(classifyEngagement('opened', '2026-10-21T13:59:22Z', '2026-10-21T13:35:00Z', 'AS2856 British Telecommunications Limited').automatic, false, 'a home connection 24 minutes later');
  assertEquals(classifyEngagement('clicked', '2026-10-21T14:00:57Z', '2026-10-21T13:35:00Z', 'AS8075 Microsoft Corporation').automatic, false, 'Microsoft 25 minutes later still counts');
  assertEquals(classifyEngagement('opened', '2026-10-21T13:52:12Z', d, null).automatic, false, 'unknown owner, over a minute after delivery');
  assertEquals(engagementIp({ data: { open: { ipAddress: '1.2.3.4' } } }), '1.2.3.4');
  assertEquals(engagementIp({ data: { click: { ipAddress: '5.6.7.8' } } }), '5.6.7.8');
  assertEquals(engagementIp({ data: {} }), null);
});
