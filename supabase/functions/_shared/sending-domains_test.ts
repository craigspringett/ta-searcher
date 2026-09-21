import { assert, assertEquals } from './test-assert.ts';
import { cleanDisplayName, domainOf, parseSendingDomains, resolveFrom } from './sending-domains.ts';

const FALLBACK = { name: 'He-Giveth', email: 'noreply@notify.whofoundwho.co.uk' };

Deno.test('domainOf reads the domain of a plain address only', () => {
  assertEquals(domainOf('anja@whofoundwho.co.uk'), 'whofoundwho.co.uk');
  assertEquals(domainOf('  Anja@WhoFoundWho.co.uk '), 'whofoundwho.co.uk');
  assertEquals(domainOf('Anja <anja@whofoundwho.co.uk>'), null);
  assertEquals(domainOf('anja@'), null);
  assertEquals(domainOf(''), null);
});

Deno.test('parseSendingDomains falls back to the notify sub-domain', () => {
  assertEquals(parseSendingDomains(null), ['notify.whofoundwho.co.uk']);
  assertEquals(parseSendingDomains('whofoundwho.co.uk'), ['notify.whofoundwho.co.uk']);
  assertEquals(parseSendingDomains([]), ['notify.whofoundwho.co.uk']);
  assertEquals(parseSendingDomains([42, 'not a domain']), ['notify.whofoundwho.co.uk']);
  assertEquals(parseSendingDomains(['Notify.WhoFoundWho.co.uk', 'whofoundwho.co.uk', 'whofoundwho.co.uk']), ['notify.whofoundwho.co.uk', 'whofoundwho.co.uk']);
});

Deno.test('a consultant address on a verified domain is used as given', () => {
  const r = resolveFrom({ name: 'Anja Micic', email: 'Anja@whofoundwho.co.uk' }, ['notify.whofoundwho.co.uk', 'whofoundwho.co.uk'], FALLBACK);
  assertEquals(r.applied, true);
  assertEquals(r.from, 'Anja Micic <anja@whofoundwho.co.uk>');
  assertEquals(r.domain, 'whofoundwho.co.uk');
});

Deno.test('an address on an unverified domain keeps the name and falls back to the default sender', () => {
  const r = resolveFrom({ name: 'Anja Micic', email: 'anja@whofoundwho.co.uk' }, ['notify.whofoundwho.co.uk'], FALLBACK);
  assertEquals(r.applied, false);
  assertEquals(r.from, 'Anja Micic <noreply@notify.whofoundwho.co.uk>');
  assertEquals(r.domain, 'notify.whofoundwho.co.uk');
  assert((r.reason || '').includes('whofoundwho.co.uk is not a verified sending domain'));
});

Deno.test('Big Fish addresses are not on the list until Craig adds the domain', () => {
  const r = resolveFrom({ name: 'Craig Springett', email: 'craig@bigfishrecruitment.co.uk' }, ['notify.whofoundwho.co.uk', 'whofoundwho.co.uk'], FALLBACK);
  assertEquals(r.applied, false);
  assertEquals(r.from, 'Craig Springett <noreply@notify.whofoundwho.co.uk>');
});

Deno.test('no request, a bad address or a header-injection name never changes the sender', () => {
  assertEquals(resolveFrom(null, ['whofoundwho.co.uk'], FALLBACK).from, 'He-Giveth <noreply@notify.whofoundwho.co.uk>');
  assertEquals(resolveFrom({ name: 'X', email: 'not-an-address' }, ['whofoundwho.co.uk'], FALLBACK).applied, false);
  const r = resolveFrom({ name: 'Anja <evil@x.com>\r\nBcc: y@z.com', email: 'anja@whofoundwho.co.uk' }, ['whofoundwho.co.uk'], FALLBACK);
  assertEquals(r.from, 'Anja evil@x.com Bcc: y@z.com <anja@whofoundwho.co.uk>');
  assertEquals(cleanDisplayName('  "Anja"  '), 'Anja');
  assertEquals(resolveFrom({ name: '', email: 'anja@whofoundwho.co.uk' }, ['whofoundwho.co.uk'], FALLBACK).from, 'He-Giveth <anja@whofoundwho.co.uk>');
});
