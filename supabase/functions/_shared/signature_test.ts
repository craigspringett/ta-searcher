import { assert, assertEquals } from './test-assert.ts';
import { signatureFrom, signatureText } from './signature.ts';

Deno.test('signatureFrom: the row fills the house layout; blanks fall back to the caller and leave lines out', () => {
  const kim = signatureFrom({ email: 'kim@whofoundwho.co.uk', full_name: 'Kim Webb', job_title: 'Associate Director – Wellbeing & People Experience', mobile: '07742 023944' }, { name: 'Kim', phone: '07000 000000' });
  assertEquals(kim.name, 'Kim Webb');
  assertEquals(kim.title, 'Associate Director – Wellbeing & People Experience');
  assertEquals(kim.phone, '07742 023944');
  assertEquals(kim.company, 'WhoFoundWho');
  assertEquals(kim.badges?.length, 2);
  const luke = signatureFrom({ email: 'luke@whofoundwho.co.uk', full_name: 'Luke Carnell', job_title: '', mobile: '' }, { name: 'Luke', phone: '07111 111111' });
  assertEquals(luke.title, undefined);
  assertEquals(luke.phone, '07111 111111');
  const none = signatureFrom(null, { name: 'Alexa' });
  assertEquals(none.name, 'Alexa');
  assertEquals(none.phone, undefined);
});

Deno.test('signatureText: the plain-text block reads like the Outlook one', () => {
  const t = signatureText(signatureFrom({ email: 'kim@whofoundwho.co.uk', full_name: 'Kim Webb', job_title: 'Associate Director – Wellbeing & People Experience', mobile: '07742 023944' }, { name: 'Kim' }));
  assert(t.startsWith('Kim Webb\nAssociate Director – Wellbeing & People Experience\nWhoFoundWho\nT: 07742 023944  |  W: whofoundwho.co.uk'));
  assert(t.includes('Collaboration. Own It. Be Human. Be Excellent.'));
  assert(t.includes('*At WhoFoundWho, we respect standard working hours'));
  assert(!/daily supply|margin|\bfees?\b|per cent|%/i.test(t));
});

Deno.test('signatureText: office number after the mobile, LinkedIn as its own line without the scheme', () => {
  const t = signatureText(signatureFrom({ email: 'alexa@whofoundwho.co.uk', full_name: 'Alexa Burton', job_title: 'Partnerships Manager', mobile: '07514 867 839', office_phone: '0330 088 7846', linkedin_url: 'https://www.linkedin.com/in/alexa-burton-send' }, { name: 'Alexa' }));
  assert(t.includes('T: 07514 867 839 / 0330 088 7846  |  W: whofoundwho.co.uk\nLI: linkedin.com/in/alexa-burton-send'));
  const n = signatureText(signatureFrom({ email: 'nikki@whofoundwho.co.uk', full_name: 'Nikki Webber', job_title: 'Practice Lead – Higher Education Partnerships', mobile: '07745 524 575' }, { name: 'Nikki' }));
  assert(n.includes('T: 07745 524 575  |  W: whofoundwho.co.uk\n\n'));
  assert(!n.includes('LI:'));
});
