import { assert, assertEquals } from '../test-assert.ts';
import { alreadyEmailedToday, checkOutreachText, londonDay, parseOutreachRequest } from './rules.ts';

Deno.test('a margin or fee figure is a hard stop; the bare word is a warning', () => {
  const figure = checkOutreachText('Rates', 'Our margin is £45 a day and our permanent fee is 12%.');
  assertEquals(figure.blocked.length, 1);
  assert(figure.blocked[0].includes('fee, margin or retainer figure'));
  const word = checkOutreachText('Rates', 'Happy to show you our margin on a call.');
  assertEquals(word.blocked, []);
  assertEquals(word.warnings.length, 1);
  assert(word.warnings[0].includes('fee or margin'));
});

Deno.test('style phrases only warn, and a clean email passes', () => {
  const r = checkOutreachText('The Year 4 post', 'Hope this finds you well. I wanted to reach out about the Year 4 post that closes on Friday.');
  assertEquals(r.blocked, []);
  assertEquals(r.warnings.length, 1);
  assert(r.warnings[0].includes('"hope this finds you well"'));
  assert(r.warnings[0].includes('"reach out"'));
  const clean = checkOutreachText('The Year 4 post', 'Dear Mrs Patel,\n\nYour Year 4 post closes on Friday. I have two teachers who could start in January and are on the framework rate.\n\nAnja');
  assertEquals(clean, { blocked: [], warnings: [] });
});

Deno.test('one send per contact per day, by the London day', () => {
  const now = new Date('2026-09-17T14:00:00Z');
  assertEquals(londonDay(now), '2026-09-17');
  assertEquals(londonDay('2026-09-16T23:30:00Z'), '2026-09-17', 'half past midnight BST is already the 17th');
  assertEquals(alreadyEmailedToday([], now), false);
  assertEquals(alreadyEmailedToday([{ created_at: '2026-09-17T08:00:00Z', status: 'sent' }], now), true);
  assertEquals(alreadyEmailedToday([{ created_at: '2026-09-17T08:00:00Z', status: 'pending' }], now), true);
  assertEquals(alreadyEmailedToday([{ created_at: '2026-09-17T08:00:00Z', status: 'failed' }], now), false);
  assertEquals(alreadyEmailedToday([{ created_at: '2026-09-16T08:00:00Z', status: 'sent' }], now), false);
  assertEquals(alreadyEmailedToday([{ created_at: '2026-09-16T23:30:00Z', status: 'sent' }], now), true);
});

Deno.test('the request is tidied and refused for the right reasons', () => {
  const good = parseOutreachRequest({ companySearchId: '0f6a2c1e-1111-4222-8333-444455556666', contactName: ' Mrs Patel ', contactEmail: 'Head@Company.sch.uk', subject: 'Year 4\r\npost', body: 'Hello\r\n\r\nthere\r\n', contactRole: 'Headteacher', sendAnyway: true });
  assert(good.ok);
  assertEquals(good.ok, {
    companySearchId: '0f6a2c1e-1111-4222-8333-444455556666',
    contactName: 'Mrs Patel',
    contactRole: 'Headteacher',
    contactEmail: 'head@company.sch.uk',
    subject: 'Year 4 post',
    body: 'Hello\n\nthere',
    sendAnyway: true,
    dryRun: false,
  });
  assertEquals(parseOutreachRequest({}).error, 'companySearchId (uuid) is required');
  assertEquals(parseOutreachRequest({ companySearchId: '0f6a2c1e-1111-4222-8333-444455556666', contactEmail: 'nope' }).error, 'contactEmail must be an email address');
  assertEquals(parseOutreachRequest({ companySearchId: '0f6a2c1e-1111-4222-8333-444455556666', contactEmail: 'a@b.co', contactName: 'A', subject: '', body: 'x' }).error, 'subject is required');
  assertEquals(parseOutreachRequest({ companySearchId: '0f6a2c1e-1111-4222-8333-444455556666', contactEmail: 'a@b.co', contactName: 'A', subject: 'S', body: '  ' }).error, 'body is required');
});
