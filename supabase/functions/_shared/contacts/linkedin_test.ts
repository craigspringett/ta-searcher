import { assertEquals } from '../test-assert.ts';
import { findCompanyLinkedIn, linkedInCompanySearchUrl, linkedInPeopleSearchUrl, tidyProfileUrl } from './linkedin.ts';

Deno.test('linkedin: the company page from the site, the most linked slug wins, share links are ignored', () => {
  const html = '<a href="https://www.linkedin.com/company/metris-energy/">LinkedIn</a> <a href="https://uk.linkedin.com/company/metris-energy/about">About</a> <a href="https://www.linkedin.com/company/hubspot">badge</a> <a href="https://www.linkedin.com/shareArticle?mini=true">share</a>';
  assertEquals(findCompanyLinkedIn(html), 'https://www.linkedin.com/company/metris-energy/');
  assertEquals(findCompanyLinkedIn('<a href="https://www.linkedin.com/in/someone">me</a>'), null);
  assertEquals(findCompanyLinkedIn(null), null);
});

Deno.test('linkedin: search links and profile tidying', () => {
  assertEquals(linkedInPeopleSearchUrl('Priya Shah', 'Metris Energy'), 'https://www.linkedin.com/search/results/people/?keywords=Priya%20Shah%20Metris%20Energy');
  assertEquals(linkedInPeopleSearchUrl('Priya Shah', null), 'https://www.linkedin.com/search/results/people/?keywords=Priya%20Shah');
  assertEquals(linkedInCompanySearchUrl('Metris Energy'), 'https://www.linkedin.com/search/results/companies/?keywords=Metris%20Energy');
  assertEquals(tidyProfileUrl('http://uk.linkedin.com/in/priya-shah-1a2b?trk=x'), 'https://www.linkedin.com/in/priya-shah-1a2b/');
  assertEquals(tidyProfileUrl('https://twitter.com/priya'), null);
});
