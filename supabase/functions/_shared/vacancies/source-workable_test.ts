import { assertEquals } from '../test-assert.ts';
import { workableSource, workableVacancies } from './source-workable.ts';
import { stubFetch } from './fetch-stub_test-helper.ts';

const board = { provider: 'workable' as const, slug: 'acme-robotics', boardUrl: 'https://apply.workable.com/acme-robotics' };
const today = new Date(Date.UTC(2026, 8, 21));

/** The documented widget shape (not verified live: the build session's proxy was rate-limited, see the source note). */
const feed = {
  name: 'Acme Robotics',
  description: 'Robots for warehouses.',
  jobs: [
    { title: 'Robotics Engineer', shortcode: 'A1B2C3', code: 'ENG-1', department: 'Engineering', location: { city: 'London', region: 'England', country: 'United Kingdom', countryCode: 'GB', telecommuting: false }, telecommuting: false, published_on: '2026-09-01', url: 'https://apply.workable.com/acme-robotics/j/A1B2C3', employment_type: 'Full-time' },
    { title: 'Head of Talent', shortcode: 'D4E5F6', department: 'People', location: { city: 'London', country: 'United Kingdom', countryCode: 'GB', telecommuting: true }, telecommuting: true, published_on: '2026-09-15', url: 'https://apply.workable.com/acme-robotics/j/D4E5F6', employment_type: 'Full-time' },
  ],
  total: 2,
};

Deno.test('workableSource reads the widget feed: name, jobs, remote from telecommuting, published_on as the posting date', async () => {
  const s = stubFetch({ 'https://apply.workable.com/api/v1/widget/accounts/acme-robotics': { body: feed } });
  try {
    const r = await workableSource(board, today);
    assertEquals(r.ok, true);
    assertEquals(r.note, '2 jobs on the acme-robotics board (Acme Robotics)');
    assertEquals(r.vacancies.map((v) => [v.title, v.url, v.department, v.location, v.workplaceType, v.employmentType, v.datePosted, v.employerName]), [
      ['Robotics Engineer', 'https://apply.workable.com/acme-robotics/j/A1B2C3', 'Engineering', 'London, England, United Kingdom', null, 'Full-time', '2026-09-01', 'Acme Robotics'],
      ['Head of Talent', 'https://apply.workable.com/acme-robotics/j/D4E5F6', 'People', 'London, United Kingdom', 'remote', 'Full-time', '2026-09-15', 'Acme Robotics'],
    ]);
  } finally {
    s.restore();
  }
});

Deno.test('workableVacancies builds the URL from the shortcode when the feed omits it', () => {
  const out = workableVacancies([{ title: 'Ops Manager', shortcode: 'Z9', location: { workplaceType: 'hybrid' } } as any], board);
  assertEquals(out.map((v) => [v.url, v.workplaceType, v.location]), [['https://apply.workable.com/acme-robotics/j/Z9', 'hybrid', null]]);
});

Deno.test('workableSource: a 429 (Cloudflare 1015) is a failed read with a note, never an empty board; a 404 is an unknown account', async () => {
  const s = stubFetch({
    'https://apply.workable.com/api/v1/widget/accounts/limited': { status: 429, body: 'error code: 1015' },
    'https://apply.workable.com/api/v1/widget/accounts/nobody': { status: 404, body: '' },
  });
  try {
    const limited = await workableSource({ ...board, slug: 'limited' }, today);
    assertEquals(limited.ok, false);
    assertEquals(limited.vacancies, []);
    assertEquals(limited.note, 'Workable rate-limited the read (HTTP 429, Cloudflare 1015); the board is not empty, it was not read');
    const missing = await workableSource({ ...board, slug: 'nobody' }, today);
    assertEquals(missing.ok, false);
    assertEquals(missing.note, 'unknown Workable account "nobody" (HTTP 404)');
  } finally {
    s.restore();
  }
});
