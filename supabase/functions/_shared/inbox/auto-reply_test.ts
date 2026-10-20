import { autoReplyVerdict } from './auto-reply.ts';
import { assertEquals } from '../test-assert.ts';

Deno.test('out-of-office and on-leave notices are auto-replies', () => {
  assertEquals(autoReplyVerdict('Automatic reply: Founder to founder: the $10M Series A', 'Dear climate champion, I am OOO until Mon 26 Oct due to family illness.').auto, true);
  assertEquals(autoReplyVerdict('Automatic reply: Your new CTO and the Ireland launch', 'Thank you for your email. I am now on maternity leave. Please reach out to people@seccl.tech.').auto, true);
  assertEquals(autoReplyVerdict('Out of Office', 'I am away until Monday.').auto, true);
  assertEquals(autoReplyVerdict('Re: Hello', 'Thanks for your note. I am currently out of the office with limited access to email and will respond when I return.').auto, true);
  assertEquals(autoReplyVerdict('Autoreply', '').auto, true);
});

Deno.test('a real reply, even one mentioning holiday, is not an auto-reply', () => {
  assertEquals(autoReplyVerdict('Re: Eleven roles open at Flagright', 'No. Best, Baran').auto, false);
  assertEquals(autoReplyVerdict('Re: Five numbers', 'Interesting. Can we talk after my holiday next week? Send over the details.').auto, false);
  assertEquals(autoReplyVerdict('Re: Founder to founder', 'Yes please, call me tomorrow at 10.').auto, false);
});

Deno.test('someone who has left the company is not treated as an out-of-office, so the run still stops', () => {
  assertEquals(autoReplyVerdict('Automatic reply: Hello', 'I no longer work at Acme. Please contact info@acme.com.').auto, false);
  assertEquals(autoReplyVerdict('Auto-reply', 'Sam has left the company. Please email hello@acme.com.').auto, false);
});
