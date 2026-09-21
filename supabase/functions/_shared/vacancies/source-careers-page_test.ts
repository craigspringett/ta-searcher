import { assertEquals } from '../test-assert.ts';
import { candidatePageUrls, candidatesFromPage, careersPageSource, extractTitlesFromPage, isVacancyPage, parseJsonLdJobPostings, CAREERS_PATHS } from './source-careers-page.ts';
import { stubFetch } from './fetch-stub_test-helper.ts';
import type { CompanyContext } from './types.ts';

const today = new Date(Date.UTC(2026, 8, 21));
const ctx: CompanyContext = { companySearchId: 'c1', companyNumber: '12345678', name: 'Acme Robotics', aliases: [], url: 'https://acme.io', postcodeDistrict: 'EC1', record: null, boards: [] };

const nav = `<nav><a href="/">Home</a><a href="/product">Product</a><a href="/customers">Customers</a><a href="/blog/how-we-hire">How we hire</a><a href="/careers">Careers</a></nav>`;
const homepage = `<html><head><title>Acme Robotics</title></head><body>${nav}<h1>Robots for warehouses</h1><p>We are 40 people in London.</p></body></html>`;

const listingPage = `<html><head><title>Careers - Acme Robotics</title></head><body>${nav}
<main><h1>Open roles</h1><p>We're hiring across engineering and go to market. Full-time, hybrid in London.</p>
<h2>Engineering</h2>
<a href="/careers/senior-robotics-engineer">Senior Robotics Engineer</a><p>London, hybrid. Full-time.</p>
<a href="/careers/head-of-talent">Head of Talent</a><p>London. Full-time. Apply by 30 October 2026.</p>
<h3>Our culture</h3><p>We ship every day.</p>
<h3>Founding Account Executive</h3><p>Remote (UK). Full-time. Equity.</p>
<a href="/blog/meet-our-new-head-of-product">Meet our new Head of Product</a>
<a href="/careers">See all roles</a>
<a href="/uploads/2020/05/Engineer-JD.pdf">Robotics Engineer - Job Description</a>
<strong>Don't see a role that fits?</strong>
</main></body></html>`;

const atsOnlyPage = `<html><head><title>Careers - Acme Robotics</title></head><body>${nav}
<main><h1>Join us</h1><p>We're hiring. See our open roles.</p><a href="https://jobs.ashbyhq.com/acme-robotics">See open roles</a></main></body></html>`;

const jsonLdPage = `<html><head><title>Jobs at Acme</title>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
 {"@type":"Organization","name":"Acme Robotics"},
 {"@type":"JobPosting","title":"Machine Learning Engineer","url":"https://acme.io/jobs/ml-engineer","datePosted":"2026-08-01T09:00:00Z","validThrough":"2026-11-30","employmentType":"FULL_TIME","hiringOrganization":{"@type":"Organization","name":"Acme Robotics"},"jobLocation":{"@type":"Place","address":{"addressLocality":"London","addressCountry":"GB"}}},
 {"@type":"JobPosting","title":"Customer Success Lead","url":"https://acme.io/jobs/cs-lead","datePosted":"2026-09-10","employmentType":["FULL_TIME"],"jobLocationType":"TELECOMMUTE","applicantLocationRequirements":{"@type":"Country","name":"UK"}},
 {"@type":"JobPosting","title":"General Application","url":"https://acme.io/jobs/general"}
]}</script></head><body><h1>Jobs</h1><div id="app"></div></body></html>`;

Deno.test('CAREERS_PATHS are the start-up paths', () => {
  for (const p of ['/careers', '/jobs', '/join', '/join-us', '/work-with-us', '/open-roles', '/company/careers', '/about/careers', '/hiring', '/openings', '/positions', '/vacancies']) {
    assertEquals(CAREERS_PATHS.includes(p), true, p);
  }
  assertEquals(CAREERS_PATHS.some((p) => /teach|school|staff-vac/.test(p)), false);
});

Deno.test('candidatePageUrls: the usual paths at the root, then the careers links the homepage offers, never news', () => {
  const urls = candidatePageUrls('https://acme.io/', homepage);
  assertEquals(urls[0], 'https://acme.io/careers');
  assertEquals(urls.includes('https://acme.io/blog/how-we-hire'), false);
  assertEquals(urls.length, CAREERS_PATHS.length, 'the /careers link is one of the standard paths');
  const withJoin = candidatePageUrls('https://acme.io', `<a href="/about/join-the-robots">Join the robots</a><a href="https://other.com/jobs">Partner jobs</a>`);
  assertEquals(withJoin.includes('https://acme.io/about/join-the-robots'), true);
  assertEquals(withJoin.some((u) => u.includes('other.com')), false);
});

Deno.test('isVacancyPage needs a hiring signal or a JobPosting block', () => {
  assertEquals(isVacancyPage(listingPage, 'https://acme.io/careers'), true);
  assertEquals(isVacancyPage(jsonLdPage, 'https://acme.io/jobs'), true);
  assertEquals(isVacancyPage(`<html><body>${nav}<h1>Careers</h1><p>Nothing yet.</p></body></html>`, 'https://acme.io/careers'), false);
});

Deno.test('extractTitlesFromPage keeps roles and drops team headings, navigation, news, placeholders and stale documents', () => {
  const found = extractTitlesFromPage(listingPage, 'https://acme.io/careers');
  assertEquals(found.map((f) => [f.title, f.url, f.document]), [
    ['Senior Robotics Engineer', 'https://acme.io/careers/senior-robotics-engineer', null],
    ['Head of Talent', 'https://acme.io/careers/head-of-talent', null],
    ['Robotics Engineer - Job Description', 'https://acme.io/uploads/2020/05/Engineer-JD.pdf', 'job_description'],
    ['Founding Account Executive', null, null],
  ]);
  assertEquals(/Apply by 30 October 2026/.test(found[1].context), true);
  assertEquals(found[2].post, 'Robotics Engineer');
});

Deno.test('parseJsonLdJobPostings reads a @graph of postings with dates, employment type, location and remote', () => {
  const posts = parseJsonLdJobPostings(jsonLdPage);
  assertEquals(posts.map((p) => [p.title, p.url, p.datePosted, p.validThrough, p.employmentType, p.workplaceType, p.location, p.employerName]), [
    ['Machine Learning Engineer', 'https://acme.io/jobs/ml-engineer', '2026-08-01', '2026-11-30', 'Full-Time', null, 'London, GB', 'Acme Robotics'],
    ['Customer Success Lead', 'https://acme.io/jobs/cs-lead', '2026-09-10', null, 'Full-Time', 'remote', null, null],
    ['General Application', 'https://acme.io/jobs/general', null, null, null, null, null, null],
  ]);
  assertEquals(parseJsonLdJobPostings('<script type="application/ld+json">not json</script>'), []);
  assertEquals(parseJsonLdJobPostings('<script type="application/ld+json">[{"@type":"JobPosting","title":"Engineer"}]</script>').map((p) => p.title), ['Engineer']);
});

Deno.test('candidatesFromPage: JSON-LD postings first (a placeholder is still rejected), then the markup, without repeats', () => {
  const out = candidatesFromPage(jsonLdPage, 'https://acme.io/jobs', ctx, today);
  assertEquals(out.map((c) => [c.title, c.source, c.datePosted, c.workplaceType, c.closingDate, (c.raw as any).jsonLd]), [
    ['Machine Learning Engineer', 'careers_page', '2026-08-01', null, '2026-11-30', true],
    ['Customer Success Lead', 'careers_page', '2026-09-10', 'remote', null, true],
  ]);
  const listed = candidatesFromPage(listingPage, 'https://acme.io/careers', ctx, today);
  assertEquals(listed.map((c) => c.title), ['Senior Robotics Engineer', 'Head of Talent', 'Robotics Engineer - Job Description', 'Founding Account Executive']);
  assertEquals(listed[1].closingDate, '2026-10-30');
  assertEquals(listed[3].url, 'https://acme.io/careers', 'an unlinked heading carries the page URL');
});

Deno.test('careersPageSource: a page that only links to an ATS board answers ok with zero roles and names the board', async () => {
  const s = stubFetch({
    'https://acme.io/careers': { body: atsOnlyPage },
    'https://acme.io/': { status: 404, body: '' },
  });
  try {
    const r = await careersPageSource(ctx, { homepageHtml: homepage, today });
    assertEquals(r.ok, true);
    assertEquals(r.vacancies, []);
    assertEquals(r.detectedBoards, [{ provider: 'ashby', slug: 'acme-robotics', boardUrl: 'https://jobs.ashbyhq.com/acme-robotics' }]);
    assertEquals(r.pagesRead, ['https://acme.io/careers']);
    assertEquals(/links to ashby board acme-robotics; no roles listed on the page, the feed is the source$/.test(r.note ?? ''), true, r.note ?? '');
    assertEquals(s.calls.every((c) => c.method === 'GET'), true);
  } finally {
    s.restore();
  }
});

Deno.test('careersPageSource: a listing page yields the roles, asks Last-Modified for an undated file, and reads boards off the homepage too', async () => {
  const s = stubFetch({
    'https://acme.io/careers': { body: listingPage.replace('/uploads/2020/05/Engineer-JD.pdf', '/files/Engineer-JD.pdf') },
    'https://acme.io/files/Engineer-JD.pdf': { headers: { 'last-modified': 'Wed, 01 May 2019 10:00:00 GMT' } },
    'https://acme.io/': { status: 404, body: '' },
  });
  try {
    const r = await careersPageSource(ctx, { homepageHtml: homepage + '<a href="https://jobs.lever.co/acme">Old board</a>', today });
    assertEquals(r.ok, true);
    assertEquals(r.vacancies.map((v) => v.title), ['Senior Robotics Engineer', 'Head of Talent', 'Robotics Engineer - Job Description', 'Founding Account Executive']);
    assertEquals(r.vacancies[2].lastModified, '2019-05-01');
    assertEquals(r.detectedBoards.map((b) => `${b.provider}:${b.slug}`), ['lever:acme']);
    assertEquals(s.calls.filter((c) => c.method === 'HEAD').map((c) => c.url), ['https://acme.io/files/Engineer-JD.pdf']);
  } finally {
    s.restore();
  }
});

Deno.test('careersPageSource never throws: a bad stored URL is ok false with a note', async () => {
  const r = await careersPageSource({ ...ctx, url: 'not a url' }, { homepageHtml: '', today });
  assertEquals(r.ok, false);
  assertEquals(r.vacancies, []);
  assertEquals(r.detectedBoards, []);
});
