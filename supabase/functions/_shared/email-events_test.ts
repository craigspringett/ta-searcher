import { assert, assertEquals } from './test-assert.ts';
import { dedupeKey, IgnoredEvent, linkFromMetadata, parseResendEvent, shouldSuppress } from './email-events.ts';

const NOW = new Date('2026-09-17T09:00:00Z');

const opened = JSON.stringify({
  type: 'email.opened',
  created_at: '2026-09-17T08:12:31.126Z',
  data: {
    created_at: '2026-09-17T08:12:30.894Z',
    email_id: '56761188-7520-42d8-8898-ff6fc54ce618',
    from: 'Anja Micic <anja@whofoundwho.co.uk>',
    to: ['Head@Example-Company.sch.uk'],
    subject: 'The Year 4 post',
    tags: { message_id: 'a1b2c3d4-0000-4000-8000-000000000001', template: 'outreach-email', purpose: 'outreach' },
  },
});

Deno.test('an open carries the recipient, the message id from the tags and the event time', () => {
  const e = parseResendEvent(opened, NOW);
  assertEquals(e.type, 'opened');
  assertEquals(e.recipients, ['head@example-company.sch.uk']);
  assertEquals(e.messageId, 'a1b2c3d4-0000-4000-8000-000000000001');
  assertEquals(e.emailId, '56761188-7520-42d8-8898-ff6fc54ce618');
  assertEquals(e.occurredAt, '2026-09-17T08:12:31.126Z');
  assertEquals(e.url, null);
  assertEquals(shouldSuppress(e), false);
});

Deno.test('a click carries the link and uses the click timestamp', () => {
  const body = JSON.stringify({
    type: 'email.clicked',
    created_at: '2026-09-17T08:40:00.000Z',
    data: {
      email_id: 'e-1',
      to: 'head@example-company.sch.uk',
      tags: [{ name: 'message_id', value: 'm-1' }, { name: 'purpose', value: 'outreach' }],
      click: { link: 'https://teaching-vacancies.service.gov.uk/jobs/year-4-teacher', timestamp: '2026-09-17T08:39:57.163Z', ipAddress: '1.2.3.4', userAgent: 'x' },
    },
  });
  const e = parseResendEvent(body, NOW);
  assertEquals(e.type, 'clicked');
  assertEquals(e.url, 'https://teaching-vacancies.service.gov.uk/jobs/year-4-teacher');
  assertEquals(e.occurredAt, '2026-09-17T08:39:57.163Z');
  assertEquals(e.messageId, 'm-1');
  assertEquals(e.recipients, ['head@example-company.sch.uk']);
});

Deno.test('sent and delivered are stored; unknown types are ignored; a body with no recipient is an error', () => {
  assertEquals(parseResendEvent(JSON.stringify({ type: 'email.sent', data: { to: ['a@b.co'] } }), NOW).type, 'sent');
  assertEquals(parseResendEvent(JSON.stringify({ type: 'email.delivered', data: { to: ['a@b.co'] } }), NOW).type, 'delivered');
  let ignored = false;
  try { parseResendEvent(JSON.stringify({ type: 'contact.created', data: { to: ['a@b.co'] } }), NOW); } catch (err) { ignored = err instanceof IgnoredEvent; }
  assert(ignored, 'contact.created should be ignored');
  let failed = false;
  try { parseResendEvent(JSON.stringify({ type: 'email.opened', data: {} }), NOW); } catch (err) { failed = !(err instanceof IgnoredEvent); }
  assert(failed, 'no recipient should be an error, not an ignore');
});

Deno.test('a missing timestamp falls back to now, and a missing tag leaves the message id null', () => {
  const e = parseResendEvent(JSON.stringify({ type: 'email.opened', data: { to: ['a@b.co'] } }), NOW);
  assertEquals(e.occurredAt, '2026-09-17T09:00:00.000Z');
  assertEquals(e.messageId, null);
  assertEquals(e.emailId, null);
});

Deno.test('bounces suppress only when permanent; complaints always', () => {
  const hard = parseResendEvent(JSON.stringify({ type: 'email.bounced', data: { to: ['a@b.co'], bounce: { type: 'Permanent', message: 'no such user' } } }), NOW);
  const soft = parseResendEvent(JSON.stringify({ type: 'email.bounced', data: { to: ['a@b.co'], bounce: { type: 'Transient' } } }), NOW);
  const unsaid = parseResendEvent(JSON.stringify({ type: 'email.bounced', data: { to: ['a@b.co'] } }), NOW);
  const complaint = parseResendEvent(JSON.stringify({ type: 'email.complained', data: { to: ['a@b.co'] } }), NOW);
  assertEquals(shouldSuppress(hard), true);
  assertEquals(shouldSuppress(soft), false);
  assertEquals(shouldSuppress(unsaid), true);
  assertEquals(shouldSuppress(complaint), true);
  assertEquals(hard.bounceType, 'Permanent');
});

Deno.test('the dedupe key tells two opens apart but not a retried webhook', () => {
  const a = parseResendEvent(opened, NOW);
  const b = parseResendEvent(opened, NOW);
  const later = parseResendEvent(opened.replace('08:12:31.126Z', '09:12:31.126Z'), NOW);
  assertEquals(dedupeKey(a, a.recipients[0]), dedupeKey(b, b.recipients[0]));
  assert(dedupeKey(a, a.recipients[0]) !== dedupeKey(later, later.recipients[0]));
});

Deno.test('the link to a company comes from the send log metadata and tolerates junk', () => {
  assertEquals(linkFromMetadata({ company_search_id: '0f6a2c1e-1111-4222-8333-444455556666', consultant_id: 'nope', contact_name: 'Mrs Patel', kind: 'outreach' }), {
    company_search_id: '0f6a2c1e-1111-4222-8333-444455556666',
    consultant_id: null,
    contact_name: 'Mrs Patel',
  });
  assertEquals(linkFromMetadata(null), { company_search_id: null, consultant_id: null, contact_name: null });
  assertEquals(linkFromMetadata('x'), { company_search_id: null, consultant_id: null, contact_name: null });
});
