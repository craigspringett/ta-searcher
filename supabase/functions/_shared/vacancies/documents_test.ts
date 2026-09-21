import { assert, assertEquals } from '../test-assert.ts';
import { classifyDocument, postKey, samePost, staleDocumentReason, stripDates, titleDate, uploadDate } from './documents.ts';

const today = new Date(Date.UTC(2026, 8, 21));

Deno.test('classifyDocument: documents about a post, the advert itself, and ordinary titles', () => {
  assertEquals(classifyDocument('Senior Engineer Job Descrip...'), { kind: 'job_description', post: 'Senior Engineer', supporting: true, cut: false });
  assertEquals(classifyDocument('Senior Engineer Advert'), { kind: 'advert', post: 'Senior Engineer', supporting: false, cut: false });
  assertEquals(classifyDocument('Head of Talent - Role Profile'), { kind: 'job_description', post: 'Head of Talent', supporting: true, cut: false });
  assertEquals(classifyDocument('Head of Talent Candidate Pack (PDF)').kind, 'pack');
  assertEquals(classifyDocument('Head of Talent Candidate Pack (PDF)').post, 'Head of Talent');
  assertEquals(classifyDocument('Application Form').kind, 'application_form');
  assertEquals(classifyDocument('How to apply').kind, 'guidance');
  assertEquals(classifyDocument('Product Designer JD & Person Spec').post, 'Product Designer');
  for (const t of ['Senior Engineer', 'Account Executive – Agency Growth', 'Content and Marketing Designer', 'Sales Development Representative (SDR) - SMB', 'Head of Partnerships']) {
    const c = classifyDocument(t);
    assertEquals(c.kind, null, `${t}: ${c.kind}`);
    assertEquals(c.supporting, false);
  }
});

Deno.test('titleDate reads UK-first numeric stamps, written dates, months and bare years', () => {
  assertEquals(titleDate('03.03.26 Advert Senior Engineer 2026')?.date.toISOString().slice(0, 10), '2026-03-03');
  assertEquals(titleDate('Product Manager 05/10/2026')?.date.toISOString().slice(0, 10), '2026-10-05');
  assertEquals(titleDate('Head of Talent - 3rd March 2026')?.date.toISOString().slice(0, 10), '2026-03-03');
  assertEquals(titleDate('Engineer September 2026')?.date.toISOString().slice(0, 10), '2026-09-30');
  assertEquals(titleDate('Engineer 2025')?.date.toISOString().slice(0, 10), '2025-12-31');
  assertEquals(titleDate('Engineer 2026-08-14')?.date.toISOString().slice(0, 10), '2026-08-14');
  for (const t of ['Backend Engineer III', 'Senior Engineer (£90,000 - £120,000)', 'Engineer - 0.8 FTE', '2027 Graduate Analyst']) {
    if (t === '2027 Graduate Analyst') assertEquals(titleDate(t)?.date.toISOString().slice(0, 10), '2027-12-31', 'a future year is a date, and not stale');
    else assertEquals(titleDate(t), null, t);
  }
});

Deno.test('uploadDate reads the WordPress upload month', () => {
  assertEquals(uploadDate('https://acme.io/wp-content/uploads/2020/05/Engineer-JD.pdf')?.date.toISOString().slice(0, 10), '2020-05-31');
  assertEquals(uploadDate('https://acme.io/careers/engineer/'), null);
  assertEquals(uploadDate(null), null);
});

Deno.test('staleDocumentReason: more than 60 days old is not a new role; the title date wins over the upload path; Last-Modified when neither', () => {
  assertEquals(staleDocumentReason('03.03.26 Senior Engineer JD', null, today), 'dated 03.03.26 (3 March 2026), more than 60 days old');
  assertEquals(staleDocumentReason('Engineer JD', 'https://acme.io/wp-content/uploads/2021/03/Engineer-JD.pdf', today), 'dated uploaded mar 2021 (31 March 2021), more than 60 days old');
  assertEquals(staleDocumentReason('Engineer - September 2026', 'https://acme.io/wp-content/uploads/2021/03/x.pdf', today), null, 'the title date wins');
  assertEquals(staleDocumentReason('Engineer - January 2027', null, today), null, 'future dates are fine');
  assertEquals(staleDocumentReason('Engineer', 'https://acme.io/careers/engineer.pdf', today), null, 'no date at all');
  assertEquals(staleDocumentReason('Engineer', 'https://acme.io/x.pdf', today, undefined, '2018-05-01'), 'dated last changed 2018-05-01 (1 May 2018), more than 60 days old');
  assertEquals(staleDocumentReason('Engineer', 'https://acme.io/x.pdf', today, undefined, '2026-09-01'), null);
});

Deno.test('stripDates', () => {
  assertEquals(stripDates('03.03.26 Advert Senior Engineer 2026'), 'Advert Senior Engineer');
  assertEquals(stripDates('Head of Talent - September 2026'), 'Head of Talent');
  assertEquals(stripDates('Backend Engineer III'), 'Backend Engineer III');
});

Deno.test('postKey ignores dates, the company initials, filler, order and the usual abbreviations', () => {
  assertEquals(postKey('03.03.26 JD Senior Engineer ACM').tokens, ['engineer', 'senior']);
  assertEquals(postKey('Sales Development Representative').tokens, ['sdr']);
  assertEquals(postKey('SDR - London').tokens, ['london', 'sdr']);
  assertEquals(postKey('Senior Software Engineer').tokens, ['senior', 'softwareengineer']);
  assertEquals(postKey('Sr. Software Developer').tokens, ['senior', 'softwareengineer']);
  assertEquals(postKey('Senior Engineer Job Descrip...'), { tokens: ['engineer', 'senior'], truncated: true });
  assertEquals(postKey('Talent Acquisition Partner').tokens, ['partner', 'recruiting']);
});

Deno.test('samePost: near-identical titles at one company are one post; different posts are not', () => {
  assert(samePost('Senior Engineer Advert', 'Senior Engineer Job Descrip...'));
  assert(samePost('Sales Development Representative', 'SDR'));
  assert(samePost('Senior Software Engineer', 'Software Engineer, Senior'));
  assert(samePost('Product Designer', 'Product Designer (Sept 2026 start)'));
  assert(samePost('Account Executive', 'Account Executives'));
  assert(samePost('Head of Talent', 'Head of Talent - now hiring'));
  assert(!samePost('Senior Engineer', 'Senior Designer'));
  assert(!samePost('Account Executive', 'Senior Account Executive, Germany and DACH'));
  assert(!samePost('Sales Development Representative (SDR) - Enterprise', 'Sales Development Representative (SDR) - SMB'));
  assert(!samePost('Head of Talent', 'Head of People'));
  assert(!samePost('Content and Marketing Designer', 'Senior Content and Marketing Designer'));
  assert(!samePost('Backend Engineer', 'Frontend Engineer'));
});
