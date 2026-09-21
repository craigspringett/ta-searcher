import { assert, assertEquals } from '../test-assert.ts';
import { classifyDocument, postKey, samePost, staleDocumentReason, stripDates, titleDate, uploadDate } from './documents.ts';

const today = new Date(Date.UTC(2026, 8, 10)); // 10 September 2026, the morning the noisy lines went out

Deno.test('classifyDocument: the 10 September lines are documents about a post, or the advert itself', () => {
  assertEquals(classifyDocument('Pastoral Leader Non teaching Job Descrip...'), { kind: 'job_description', post: 'Pastoral Leader Non teaching', supporting: true, cut: false });
  assertEquals(classifyDocument('Pastoral Leader Non Teaching Advert'), { kind: 'advert', post: 'Pastoral Leader Non Teaching', supporting: false, cut: false });
  assertEquals(classifyDocument('03.03.26 JD Deputy Principal ANL'), { kind: 'job_description', post: 'Deputy Principal ANL', supporting: true, cut: false });
  assertEquals(classifyDocument('03.03.26 Advert ANL Deputy Principal 2026'), { kind: 'advert', post: 'ANL Deputy Principal', supporting: false, cut: false });
  assertEquals(classifyDocument('guidance notes for teachers'), { kind: 'guidance', post: 'teachers', supporting: true, cut: false });
  assertEquals(classifyDocument('Notes for Teachers'), { kind: 'guidance', post: 'Teachers', supporting: true, cut: false });
});

Deno.test('classifyDocument: the other document shapes', () => {
  assertEquals(classifyDocument('Teacher of Maths - Person Specification').kind, 'person_specification');
  assertEquals(classifyDocument('Teacher of Maths - Person Specification').post, 'Teacher of Maths');
  assertEquals(classifyDocument('Support Staff Application Form').kind, 'application_form');
  assertEquals(classifyDocument('Teaching Assistant - Job Description').post, 'Teaching Assistant');
  assertEquals(classifyDocument('Head of Science Candidate Pack').kind, 'pack');
  assertEquals(classifyDocument('Head of Science Information Pack (PDF)').post, 'Head of Science');
  assertEquals(classifyDocument('Class Teacher JD & Person Spec').kind, 'job_description');
  assertEquals(classifyDocument('Class Teacher JD & Person Spec').post, 'Class Teacher');
  assertEquals(classifyDocument('SENCO Advert and JD').kind, 'advert');
  assertEquals(classifyDocument('SENCO Advert and JD').post, 'SENCO');
  assertEquals(classifyDocument('Grade 4 Premises Officer JD-Pers Spec').post, 'Grade 4 Premises Officer');
});

Deno.test('classifyDocument: ordinary titles are not documents', () => {
  for (const t of ['Teacher of Geography', 'Class Teacher (KS2)', 'Learning Support Assistant - Closing Date 11th September 2026', 'Advertising Manager', 'Head of Food & DT - Required January 2027, Closing Date 18th September 2026', 'Teacher of Notes and Music']) {
    const c = classifyDocument(t);
    assertEquals(c.kind, null, `${t}: ${c.kind}`);
    assertEquals(c.supporting, false);
  }
  assertEquals(classifyDocument('Teacher of Geography').post, 'Teacher of Geography');
});

Deno.test('titleDate reads UK-first numeric stamps, written dates, months and bare years', () => {
  assertEquals(titleDate('03.03.26 Advert ANL Deputy Principal 2026')?.date.toISOString().slice(0, 10), '2026-03-03');
  assertEquals(titleDate('Teaching Assistant 05/10/2026')?.date.toISOString().slice(0, 10), '2026-10-05');
  assertEquals(titleDate('Head of Maths - 3rd March 2026')?.date.toISOString().slice(0, 10), '2026-03-03');
  assertEquals(titleDate('Class Teacher September 2026')?.date.toISOString().slice(0, 10), '2026-09-30');
  assertEquals(titleDate('Class Teacher Sept 2026')?.date.toISOString().slice(0, 10), '2026-09-30');
  assertEquals(titleDate('Premises Officer Advert June 2026')?.date.toISOString().slice(0, 10), '2026-06-30');
  assertEquals(titleDate('Teacher of Maths 2025')?.date.toISOString().slice(0, 10), '2025-12-31');
  assertEquals(titleDate('Learning Support Assistant 2026-08-14')?.date.toISOString().slice(0, 10), '2026-08-14');
  for (const t of ['Teaching Assistant - HT', '1:1 LSA', 'Teacher - 0.4 FTE', 'Level 1 or Level 2 Learning Support Assistant', 'Scale 5/6 Teaching Assistant', 'Teacher of Maths (£30,000 - £45,000)']) {
    assertEquals(titleDate(t), null, t);
  }
});

Deno.test('uploadDate reads the WordPress upload month', () => {
  assertEquals(uploadDate('https://hws.haringey.sch.uk/wp-content/uploads/2020/05/Notes-for-Teachers.pdf')?.date.toISOString().slice(0, 10), '2020-05-31');
  assertEquals(uploadDate('https://generationsmat.com/app/uploads/2026/08/Learning-Support-Assistant-August-2026.pdf')?.date.toISOString().slice(0, 10), '2026-08-31');
  assertEquals(uploadDate('https://company.org/vacancies/class-teacher/'), null);
  assertEquals(uploadDate(null), null);
});

Deno.test('staleDocumentReason: more than 60 days old is not a new vacancy; the title date wins over the upload path', () => {
  assertEquals(staleDocumentReason('03.03.26 Advert ANL Deputy Principal 2026', null, today), 'dated 03.03.26 (3 March 2026), more than 60 days old');
  assertEquals(staleDocumentReason('03.03.26 JD Deputy Principal ANL', null, today)?.startsWith('dated 03.03.26'), true);
  assertEquals(staleDocumentReason('Notes for Teachers', 'https://hws.haringey.sch.uk/wp-content/uploads/2021/03/Notes-for-Teachers.pdf', today), 'dated uploaded mar 2021 (31 March 2021), more than 60 days old');
  assertEquals(staleDocumentReason('Learning Support Assistant - Closing Date 11th September 2026', 'https://generationsmat.com/app/uploads/2026/08/Learning-Support-Assistant-August-2026.pdf', today), null);
  assertEquals(staleDocumentReason('Class Teacher September 2026', null, today), null, 'a month is read as its last day');
  assertEquals(staleDocumentReason('Class Teacher - January 2027', null, today), null, 'future dates are fine');
  assertEquals(staleDocumentReason('Teacher of Maths', 'https://company.org/vacancies/maths.pdf', today), null, 'no date at all');
  assertEquals(staleDocumentReason('Class Teacher July 2026', null, today), null, '31 July is 41 days before 10 September');
  assertEquals(staleDocumentReason('Class Teacher June 2026', null, today), 'dated June 2026 (30 June 2026), more than 60 days old');
});

Deno.test('stripDates', () => {
  assertEquals(stripDates('03.03.26 Advert ANL Deputy Principal 2026'), 'Advert ANL Deputy Principal');
  assertEquals(stripDates('Teacher of Maths - September 2026'), 'Teacher of Maths');
  assertEquals(stripDates('Head of Year 7'), 'Head of Year 7');
});

Deno.test('postKey ignores dates, company initials, filler, order and the usual abbreviations', () => {
  assertEquals(postKey('03.03.26 JD Deputy Principal ANL').tokens, ['deputy', 'principal']);
  assertEquals(postKey('03.03.26 Advert ANL Deputy Principal 2026').tokens, ['deputy', 'principal']);
  assertEquals(postKey('Head of Food & DT').tokens, ['designtechnology', 'food', 'head']);
  assertEquals(postKey('Head of Design Technology & Food').tokens, ['designtechnology', 'food', 'head']);
  assertEquals(postKey('Pastoral Leader Non teaching Job Descrip...'), { tokens: ['leader', 'nonteaching', 'pastoral'], truncated: true });
  assertEquals(postKey('Teacher of Mathem...'), { tokens: ['teacher'], truncated: true });
  assertEquals(classifyDocument('Teacher of Mathem...').cut, true);
  assertEquals(postKey('Teaching Assistant (SEN)').tokens, ['sen', 'ta']);
  assertEquals(postKey('SEND TA').tokens, ['sen', 'ta']);
});

Deno.test('samePost: near-identical titles at one company are one post; different posts are not', () => {
  assert(samePost('Pastoral Leader Non Teaching Advert', 'Pastoral Leader Non teaching Job Descrip...'));
  assert(samePost('Pastoral Leader Non Teaching', 'Pastoral Leader Non teaching Job Descrip...'));
  assert(samePost('03.03.26 Advert ANL Deputy Principal 2026', '03.03.26 JD Deputy Principal ANL'));
  assert(samePost('guidance notes for teachers', 'Notes for Teachers'));
  assert(samePost('Head of Food & DT', 'Head of Design Technology & Food'));
  assert(samePost('Head of Food & DT - Required January 2027, Closing Date 18th September 2026', 'Head of Design Technology & Food'));
  assert(samePost('Teacher of Maths', 'Maths Teacher'));
  assert(samePost('Teacher of Mathematics', 'Teacher of Maths - September 2026'));
  assert(samePost('Class Teacher', 'Class Teacher (Sept 2026 start)'));
  assert(samePost('Teaching Assistant', 'Teaching Assistants'));
  assert(samePost('Learning Support Assistant (LSA)', 'LSA'));
  assert(samePost('Teacher of Mathem...', 'Teacher of Mathematics'));
  assert(samePost('Teacher of Business Studies with TLR for Travel and Tourism Lead Role', 'Teacher of Business Studies with TLR for Travel & Tourism Lead'));

  assert(!samePost('Teacher of Maths', 'Teacher of Science'));
  assert(!samePost('Teacher of Geography', 'Teacher of Geography (Maternity Cover)'), 'a cover post may sit beside a permanent one');
  assert(!samePost('Class Teacher (KS1)', 'Class Teacher (KS2)'));
  assert(!samePost('Teaching Assistant', 'Higher Level Teaching Assistant'));
  assert(!samePost('Head of Year', 'Head of Year 7'));
  assert(!samePost('Teacher of Dance (Maternity Cover)', 'Teacher of Psychology (Maternity Cover)'));
  assert(!samePost('Deputy Headteacher', 'Assistant Headteacher'));
  assert(!samePost('guidance notes for teachers', 'Teacher of Maths'));
});

Deno.test('a file with no date of its own is aged by its Last-Modified date (Berkeley Academy, 15 September 2026)', () => {
  const today = new Date(Date.UTC(2026, 8, 15));
  assertEquals(staleDocumentReason('Teaching Assistant', 'https://cdn.example.com/berkley/uploads/document/2_218_teaching-assistant-jd-ba_v1.pdf', today, undefined, '2018-05-01'), 'dated last changed 2018-05-01 (1 May 2018), more than 60 days old');
  assertEquals(staleDocumentReason('Teaching Assistant', 'https://cdn.example.com/berkley/uploads/document/2_218_teaching-assistant-jd-ba_v1.pdf', today, undefined, '2026-09-01'), null);
  assertEquals(staleDocumentReason('Teaching Assistant', 'https://cdn.example.com/x.pdf', today, undefined, null), null);
});
