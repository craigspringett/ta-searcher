import { assertEquals } from './test-assert.ts';
import { signFeedbackToken, verifyFeedbackToken } from './feedback-token.ts';

Deno.test('feedback token round-trips and rejects tampering', async () => {
  const secret = 'test-secret';
  const token = await signFeedbackToken({ v: '11111111-1111-1111-1111-111111111111', k: 'closed', e: 'craig@example.com' }, secret);
  const payload = await verifyFeedbackToken(token, secret);
  assertEquals(payload?.v, '11111111-1111-1111-1111-111111111111');
  assertEquals(payload?.k, 'closed');
  assertEquals(payload?.e, 'craig@example.com');
  assertEquals(await verifyFeedbackToken(token, 'other-secret'), null);
  const [body, sig] = token.split('.');
  assertEquals(await verifyFeedbackToken(`${body}x.${sig}`, secret), null);
  assertEquals(await verifyFeedbackToken('garbage', secret), null);
});

Deno.test('feedback token expires after 30 days', async () => {
  const secret = 'test-secret';
  const issued = new Date(Date.UTC(2026, 8, 1));
  const token = await signFeedbackToken({ v: 'v1', k: 'closed', e: 'craig@example.com' }, secret, issued);
  assertEquals((await verifyFeedbackToken(token, secret, new Date(Date.UTC(2026, 8, 30))))?.v, 'v1', 'valid at 29 days');
  assertEquals(await verifyFeedbackToken(token, secret, new Date(Date.UTC(2026, 9, 2))), null, 'refused at 31 days');
});
