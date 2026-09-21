import { assert, assertEquals } from '../test-assert.ts';
import { quietPeriodBlock, secondCallScript, sequenceIsDone, spokenName, stopDecision } from './stop.ts';

const started = '2026-09-15T09:00:00Z';
const base = { startedAt: started, contactEmail: 'Head@a.sch.uk', outcomes: [], events: [] };

Deno.test('a reply, a conversation, a meeting or "not interested" after the start stops the sequence', () => {
  assertEquals(stopDecision(base), null);
  assertEquals(stopDecision({ ...base, outcomes: [{ kind: 'voicemail', created_at: '2026-09-15T10:00:00Z' }] }), null, 'a voicemail carries on');
  assertEquals(stopDecision({ ...base, outcomes: [{ kind: 'emailed', created_at: '2026-09-15T10:00:00Z' }] }), null, 'an email outside the sequence carries on');
  assertEquals(stopDecision({ ...base, outcomes: [{ kind: 'callback', created_at: '2026-09-15T10:00:00Z' }] }), null);
  assertEquals(stopDecision({ ...base, outcomes: [{ kind: 'spoke_to', created_at: '2026-09-15T10:00:00Z' }] }), { reason: 'you spoke to them', because: 'outcome', outcomeKind: 'spoke_to' });
  assertEquals(stopDecision({ ...base, outcomes: [{ kind: 'replied', created_at: '2026-09-16T10:00:00Z' }] })?.reason, 'they replied');
  assertEquals(stopDecision({ ...base, outcomes: [{ kind: 'meeting_booked', created_at: '2026-09-16T10:00:00Z' }] })?.reason, 'a meeting is booked');
  assertEquals(stopDecision({ ...base, outcomes: [{ kind: 'not_interested', created_at: '2026-09-16T10:00:00Z' }] })?.reason, 'not interested');
  assertEquals(stopDecision({ ...base, outcomes: [{ kind: 'spoke_to', created_at: '2026-09-14T10:00:00Z' }] }), null, 'an outcome before the start is history, not a stop');
  // The earliest stopping outcome decides.
  const two = stopDecision({ ...base, outcomes: [{ kind: 'not_interested', created_at: '2026-09-17T10:00:00Z' }, { kind: 'replied', created_at: '2026-09-16T10:00:00Z' }] });
  assertEquals(two?.outcomeKind, 'replied');
});

Deno.test('a bounce, a complaint or a suppressed address stops it; other addresses do not', () => {
  assertEquals(stopDecision({ ...base, events: [{ event_type: 'bounced', recipient_email: 'head@a.sch.uk', occurred_at: '2026-09-15T14:05:00Z' }] }), { reason: 'the address bounced', because: 'bounce' });
  assertEquals(stopDecision({ ...base, events: [{ event_type: 'complained', recipient_email: 'HEAD@a.sch.uk', occurred_at: '2026-09-15T14:05:00Z' }] })?.because, 'complaint');
  assertEquals(stopDecision({ ...base, events: [{ event_type: 'bounced', recipient_email: 'other@a.sch.uk', occurred_at: '2026-09-15T14:05:00Z' }] }), null);
  assertEquals(stopDecision({ ...base, events: [{ event_type: 'opened', recipient_email: 'head@a.sch.uk', occurred_at: '2026-09-15T14:05:00Z' }] }), null, 'an open is good news');
  assertEquals(stopDecision({ ...base, events: [{ event_type: 'bounced', recipient_email: 'head@a.sch.uk', occurred_at: '2026-09-01T14:05:00Z' }] }), null, 'an old bounce before the start does not count (suppression does)');
  assertEquals(stopDecision({ ...base, suppressedReason: 'bounce' })?.reason, 'the address bounced before');
  assertEquals(stopDecision({ ...base, suppressedReason: 'unsubscribe' })?.reason, 'they asked not to be emailed');
});

Deno.test('the quiet period: eight weeks after the last sequence ended, unless something new appeared', () => {
  const now = new Date('2026-09-17T10:00:00Z');
  assertEquals(quietPeriodBlock({ previous: [], now }), null);
  assertEquals(quietPeriodBlock({ previous: [{ status: 'active', ended_at: null, started_at: '2026-09-10T10:00:00Z' }], now }), null, 'an active one is the one-per-company rule, not the quiet period');
  const recent = { status: 'stopped', ended_at: '2026-09-01T10:00:00Z', started_at: '2026-08-20T10:00:00Z' };
  const block = quietPeriodBlock({ previous: [recent], now });
  assert(block && block.includes('2 weeks ago') && block.includes('until 27 Oct'), block || 'no block');
  assertEquals(quietPeriodBlock({ previous: [recent], now, newestVacancySeen: '2026-09-10' }), null, 'a new vacancy lifts it');
  assertEquals(quietPeriodBlock({ previous: [recent], now, newestFactSeen: '2026-09-05' }), null, 'a new fact lifts it');
  assert(quietPeriodBlock({ previous: [recent], now, newestVacancySeen: '2026-08-25', newestFactSeen: '2026-09-01' }), 'old evidence does not');
  assertEquals(quietPeriodBlock({ previous: [{ status: 'done', ended_at: '2026-07-01T10:00:00Z', started_at: '2026-06-15T10:00:00Z' }], now }), null, 'more than eight weeks ago');
  assert(quietPeriodBlock({ previous: [{ status: 'done', ended_at: null, started_at: '2026-09-01T10:00:00Z' }], now }), 'no ended_at: the start counts');
});

Deno.test('a sequence is done when every step has ended', () => {
  assertEquals(sequenceIsDone([]), false);
  assertEquals(sequenceIsDone([{ status: 'sent' }, { status: 'due' }]), false);
  assertEquals(sequenceIsDone([{ status: 'sent' }, { status: 'skipped' }, { status: 'done' }]), true);
});

Deno.test('the second call script names the emails that went, without a model', () => {
  assertEquals(spokenName('Mrs Patel'), 'Mrs Patel');
  assertEquals(spokenName('Sam Jones'), 'Sam');
  assertEquals(spokenName(''), 'there');
  const two = secondCallScript('Mrs Patel', 'Anja Micic', [
    { sentAt: '2026-09-15T13:10:00Z', subject: 'The Year 4 post', hook: 'the Year 4 post that closes on Friday' },
    { sentAt: '2026-09-18T12:40:00Z', subject: 'Your new Ofsted report', hook: 'the new Ofsted report' },
  ]);
  assertEquals(two, "Hello Mrs Patel, it's Anja Micic from Big Fish Recruitment.\nI emailed on 15 September about the Year 4 post that closes on Friday and again on 18 September about the new Ofsted report. Did either land with you, and is it worth two minutes now?");
  assertEquals(two.split('\n').length, 2);
  const one = secondCallScript('Sam Jones', 'Kim', [{ sentAt: '2026-09-15T13:10:00Z', subject: 'The Year 4 post', hook: null }]);
  assert(one.startsWith("Hello Sam, it's Kim from Big Fish Recruitment.\nI emailed you on 15 September about The Year 4 post."));
  const none = secondCallScript(null, null, [], 'Holland Park Company');
  assert(none.includes('the Big Fish Recruitment team') && none.includes('about Holland Park Company'));
});
