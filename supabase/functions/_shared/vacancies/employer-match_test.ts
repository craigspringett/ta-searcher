import { assertEquals } from '../test-assert.ts';
import { employerMatches, normaliseOrgName } from './employer-match.ts';

const kingsdale = { name: 'Kingsdale Foundation Company', postcodeDistrict: 'SE21' };
const stMarys = { name: "St Mary's Catholic Primary Company", postcodeDistrict: 'SW19' };
const arkActon = { name: 'Ark Acton Academy', trustName: 'ARK COMPANIES', postcodeDistrict: 'W3' };

Deno.test('normaliseOrgName', () => {
  assertEquals(normaliseOrgName("St. Mary's C of E Primary Company"), 'st marys ce primary company');
  assertEquals(normaliseOrgName('ARK COMPANIES'), 'ark companies');
  assertEquals(normaliseOrgName('Harris Academy Morden (Merton)'), 'harris academy morden');
});

Deno.test('exact and near matches', () => {
  assertEquals(employerMatches('Kingsdale Foundation Company', kingsdale).matched, true);
  assertEquals(employerMatches('KINGSDALE FOUNDATION COMPANY', kingsdale).matched, true);
  assertEquals(employerMatches("St Marys Catholic Primary", stMarys).matched, true);
  assertEquals(employerMatches("St Mary's RC Primary Company", stMarys, 'SW19').matched, true);
});

Deno.test('sibling companies and other companies do not match', () => {
  assertEquals(employerMatches('Harris Academy Beckenham', { name: 'Harris Academy Morden', postcodeDistrict: 'SM4' }).matched, false);
  assertEquals(employerMatches('Woodlands Secondary Company', { name: 'Woodlands Primary Company', postcodeDistrict: 'HA1' }, 'LU3').matched, false);
  assertEquals(employerMatches("St Mary's Catholic Primary Company", { name: "St Mary's Catholic Primary Company", postcodeDistrict: 'SW19' }, 'M15').matched, true, 'exact names match regardless of district');
  assertEquals(employerMatches("St Marys Catholic Primary", { name: "St Mary's Catholic Primary Company", postcodeDistrict: 'SW19' }, 'M15').matched, false, 'near name in another district does not match');
  assertEquals(employerMatches('Ark Globe Academy', arkActon, 'SE1').matched, false);
});

Deno.test('trust name only matches at the company location', () => {
  assertEquals(employerMatches('Ark Companies', arkActon, 'W3'), { matched: true, kind: 'trust', score: 1, reason: 'trust name with matching postcode district' });
  assertEquals(employerMatches('Ark Companies', arkActon, 'SE1').matched, false);
  assertEquals(employerMatches('Ark Companies', arkActon, null).matched, false);
});

// Sibling companies in the same trust and the same postcode district (the
// original "wrong company" complaint). None of these may match, however
// similar the names are.
const harrisBoys = { name: "Harris Boys' Academy East Dulwich", trustName: 'Harris Federation', postcodeDistrict: 'SE22' };
const harrisPeckhamPark = { name: 'Harris Primary Academy Peckham Park', trustName: 'Harris Federation', postcodeDistrict: 'SE15' };
const stMarysRc = { name: "St Mary's RC Primary Company", postcodeDistrict: 'SE15' };
const arkGlobe = { name: 'Ark Globe Academy', trustName: 'ARK COMPANIES', postcodeDistrict: 'SE1' };

Deno.test('sibling companies in the same postcode district never match', () => {
  assertEquals(employerMatches("Harris Girls' Academy East Dulwich", harrisBoys, 'SE22').matched, false, 'Harris Girls vs Harris Boys East Dulwich');
  assertEquals(employerMatches('Harris Academy Peckham', harrisPeckhamPark, 'SE15').matched, false, 'Harris Academy Peckham vs Harris Primary Academy Peckham Park');
  assertEquals(employerMatches("St Mary's CE Primary Company", stMarysRc, 'SE15').matched, false, "St Mary's CE vs St Mary's RC");
  assertEquals(employerMatches('Ark Globe Primary Academy', arkGlobe, 'SE1').matched, false, 'Ark Globe Primary Academy vs Ark Globe Academy');
  assertEquals(employerMatches('Ark Globe Academy', { name: 'Ark Globe Primary Academy', trustName: 'ARK COMPANIES', postcodeDistrict: 'SE1' }, 'SE1').matched, false, 'and the other way round');
  assertEquals(employerMatches('Woodlands Junior Company', { name: 'Woodlands Infant Company', postcodeDistrict: 'HA1' }, 'HA1').matched, false, 'infant vs junior');
});

Deno.test('the trust as employer at the company location is a trust match', () => {
  assertEquals(employerMatches('Harris Federation', harrisBoys, 'SE22'), { matched: true, kind: 'trust', score: 1, reason: 'trust name with matching postcode district' });
  assertEquals(employerMatches('ARK COMPANIES', arkGlobe, 'SE1').kind, 'trust');
  assertEquals(employerMatches('Harris Federation', harrisBoys, 'SE15').matched, false, 'trust in another district is another Harris company');
  // The company itself, with the name written differently, is still a company match.
  assertEquals(employerMatches("Harris Boys Academy East Dulwich", harrisBoys, 'SE22').kind, 'company');
  assertEquals(employerMatches("St Mary's Catholic Primary", stMarysRc, 'SE15').matched, true, 'Catholic and RC are the same word');
});

Deno.test('employerMatches: the company\'s exact name wins even when the trust is named after it', () => {
  const company = { name: 'Burntwood Company', aliases: [], trustName: 'BURNTWOOD TRUST', postcodeDistrict: 'SW17' };
  const m = employerMatches('Burntwood Company', company, null);
  assertEquals(m.matched, true);
  assertEquals(m.kind, 'company');
  // The trust itself still needs the postcode.
  assertEquals(employerMatches('Burntwood Trust', company, null).matched, false);
  assertEquals(employerMatches('Burntwood Trust', company, 'SW17').matched, true);
});
