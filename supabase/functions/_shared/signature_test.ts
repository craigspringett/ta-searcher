import { assert, assertEquals } from './test-assert.ts';
import { signatureFrom, signatureText } from './signature.ts';

Deno.test('signatureFrom: the row fills the house layout; blanks fall back to the caller and leave lines out', () => {
  const craig = signatureFrom({ email: 'craig@bigfishrecruitment.co.uk', full_name: 'Craig Springett', job_title: 'Director', mobile: '07902 371 136' }, { name: 'Craig', phone: '07000 000000' });
  assertEquals(craig.name, 'Craig Springett');
  assertEquals(craig.title, 'Director');
  assertEquals(craig.phone, '07902 371 136');
  assertEquals(craig.email, 'craig@bigfishrecruitment.co.uk');
  assertEquals(craig.company, 'Big Fish Recruitment');
  assertEquals(craig.address, 'Kemp House, 152-160 City Road, London, EC1V 2NX');
  assertEquals(craig.signOff, 'Regards,');
  assert(craig.photoUrl?.endsWith('/email/craig-springett.png'), 'the photo for his address');
  assert(craig.logoUrl?.endsWith('/email/bigfish-logo.png'));
  assertEquals(craig.badges?.length, 1);
  const other = signatureFrom({ email: 'sam@bigfishrecruitment.co.uk', full_name: 'Sam Jones', job_title: '', mobile: '' }, { name: 'Sam', phone: '07111 111111' });
  assertEquals(other.title, undefined);
  assertEquals(other.phone, '07111 111111');
  assertEquals(other.photoUrl, undefined, 'no photo on the site for that address');
  const none = signatureFrom(null, { name: 'Alexa' });
  assertEquals(none.name, 'Alexa');
  assertEquals(none.phone, undefined);
  assertEquals(none.email, undefined);
});

Deno.test('signatureText: the plain-text block reads like the Outlook one (13 October 2026)', () => {
  const t = signatureText(signatureFrom({ email: 'craig@bigfishrecruitment.co.uk', full_name: 'Craig Springett', job_title: 'Director', mobile: '07902 371 136' }, { name: 'Craig' }));
  assertEquals(t, 'Regards,\n\nCraig Springett\nDirector\nE: craig@bigfishrecruitment.co.uk\nM: 07902 371 136\n\nBig Fish Recruitment\nKemp House, 152-160 City Road, London, EC1V 2NX\nbigfishrecruitment.co.uk');
  assert(!/daily supply|margin|\bfees?\b|per cent|%/i.test(t));
});

Deno.test('signatureText: office number after the mobile, LinkedIn as its own line without the scheme', () => {
  const t = signatureText(signatureFrom({ email: 'sam@bigfishrecruitment.co.uk', full_name: 'Sam Jones', job_title: 'Consultant', mobile: '07514 867 839', office_phone: '0330 088 7846', linkedin_url: 'https://www.linkedin.com/in/sam-jones' }, { name: 'Sam' }));
  assert(t.includes('M: 07514 867 839 / 0330 088 7846\nLI: linkedin.com/in/sam-jones'));
  const n = signatureText(signatureFrom({ email: 'nikki@bigfishrecruitment.co.uk', full_name: 'Nikki Webber', job_title: 'Consultant', mobile: '07745 524 575' }, { name: 'Nikki' }));
  assert(n.includes('M: 07745 524 575\n\nBig Fish Recruitment'));
  assert(!n.includes('LI:'));
});
