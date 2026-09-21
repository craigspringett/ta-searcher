import { assertEquals } from '../test-assert.ts';
import { employerMatches, normaliseOrgName, orgTokens } from './employer-match.ts';

Deno.test('normaliseOrgName strips legal and vanity suffixes and domain endings', () => {
  assertEquals(normaliseOrgName('Searchable Technologies Ltd'), 'searchable');
  assertEquals(normaliseOrgName('SEARCHABLE LIMITED'), 'searchable');
  assertEquals(normaliseOrgName('searchable.ai'), 'searchable');
  assertEquals(normaliseOrgName('www.monzo.com'), 'monzo');
  assertEquals(normaliseOrgName('Monzo Bank Limited'), 'monzo bank');
  assertEquals(normaliseOrgName('Acme Labs, Inc.'), 'acme');
  assertEquals(normaliseOrgName('Acme HQ'), 'acme');
  assertEquals(normaliseOrgName('Zopa Bank (UK)'), 'zopa bank');
  assertEquals(normaliseOrgName("Craig's Robots & Co"), 'craigs robots and');
  assertEquals(normaliseOrgName(null), '');
  assertEquals(Array.from(orgTokens('The Acme Group Ltd')), ['acme']);
});

Deno.test('employerMatches: the same company under its register, board and domain names', () => {
  const searchable = { name: 'Searchable Technologies Ltd', aliases: ['searchable.ai'] };
  assertEquals(employerMatches('Searchable', searchable), { matched: true, score: 1, reason: 'exact name match' });
  assertEquals(employerMatches('SEARCHABLE LTD', searchable).matched, true);
  assertEquals(employerMatches('Monzo', { name: 'Monzo Bank Limited' }).reason, 'one name contains the other');
  assertEquals(employerMatches('Monzo Bank', { name: 'Monzo Bank Limited' }).reason, 'exact name match');
  assertEquals(employerMatches('Acme Robotics Ltd', { name: 'Acme Robotics' }).matched, true);
});

Deno.test('employerMatches: another company does not match', () => {
  assertEquals(employerMatches('Someone Else Inc', { name: 'Acme Robotics' }).matched, false);
  assertEquals(employerMatches('Acme Payments', { name: 'Acme Robotics' }).matched, false, 'one shared word out of two is not a match');
  assertEquals(employerMatches('', { name: 'Acme Robotics' }), { matched: false, score: 0, reason: 'no employer name' });
  assertEquals(employerMatches('Monzo', { name: 'Zopa' }).reason, 'no name overlap');
});
