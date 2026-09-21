import { assertEquals } from '../test-assert.ts';
import { cleanTitle } from '../vacancy-identity.ts';
import { isBlockedTitle, looksLikeHeadline, looksLikeRoleTitle, roleRuleFailure } from './blocklist.ts';

/** Apply the rule the way the pipeline does for a careers-page title. */
const fails = (t: string, source: string | null = 'careers_page') => roleRuleFailure(cleanTitle(t), source);

Deno.test('KEEP: start-up titles of every family survive the rule', () => {
  const mustSurvive = [
    'Senior Engineer', 'Founding Engineer', 'Backend Engineer III', 'Staff Product Designer', 'Content and Marketing Designer', 'Account Executive', 'Account Executive – Agency Growth',
    'Sales Development Representative (SDR)', 'SDR', 'Head of Partnerships', 'B2B Marketing Manager', 'Senior Social Media Manager', 'Chief of Staff', 'Head of Talent', 'Talent Acquisition Partner',
    'Senior Recruiter', 'People Operations Manager', 'Head of People', 'Executive Assistant', 'Office Manager', 'Finance Manager', 'Legal Counsel', 'Financial Controller', 'Data Scientist',
    'Machine Learning Researcher', 'Product Manager', 'Customer Success Manager', 'Operations Associate', 'Software Engineering Intern', 'Marketing Apprentice', 'Graduate Analyst', 'Engineering Manager',
    'VP Sales', 'CTO', 'Anaplan Support Analyst', 'Credit Risk Manager, Portfolio Management', 'Senior Account Executive, Germany and DACH', 'Solutions Architect', 'Technical Writer', 'Copywriter',
  ];
  for (const t of mustSurvive) {
    assertEquals(fails(t), null, `expected "${t}" to survive: ${fails(t)}`);
    assertEquals(looksLikeRoleTitle(t, 'careers_page'), true, `expected "${t}" to look like a role`);
  }
});

Deno.test('placeholders that are not roles are rejected, interns and apprentices are kept', () => {
  const placeholders = [
    'General Application', 'Open Application', 'Speculative Application', 'Speculative CV', "Don't see a role that fits?", "Don't see the right role?", "Can't find your role?",
    'Join our Talent Community', 'Join our talent network', 'Talent Pool', 'Future Opportunities', 'Future roles', 'Register your interest', 'Expression of Interest', 'Keep in touch',
    'Talent Network', 'Send us your CV', 'Dream job not listed?',
  ];
  for (const t of placeholders) {
    const r = isBlockedTitle(t);
    assertEquals(r.blocked, true, `expected "${t}" to be blocked`);
  }
  assertEquals(isBlockedTitle("Don't see a role that fits?").reason?.startsWith('role rule: not a role'), true);
  for (const t of ['Software Engineering Intern', 'Marketing Intern', 'Internship - Product', 'Data Apprentice', 'Apprentice Engineer']) {
    assertEquals(isBlockedTitle(t).blocked, false, `expected "${t}" to be kept`);
  }
});

Deno.test('shape rejects: navigation, category links, sentences, documents and headlines', () => {
  const shapes: Array<[string, string]> = [
    ['Careers', 'navigation'],
    ['Open roles', 'navigation'],
    ['Life at Searchable', 'navigation'],
    ['Engineering roles', 'category link'],
    ['All open positions', 'category link'],
    ['We are hiring engineers across London', 'sentence, not a title'],
    ["You'll be joining a small team", 'sentence, not a title'],
    ['Our hiring process', 'about page'],
    ['Candidate privacy notice', 'document, not a vacancy'],
    ['https://jobs.ashbyhq.com/searchable', 'url'],
    ['Welcome to the team', 'welcome page'],
    ['Series A announcement', 'news item'],
    ['Senior Engineer 2023', 'refers to 2023'],
    ['AE', 'too short'],
  ];
  for (const [t, reason] of shapes) {
    const r = isBlockedTitle(t);
    assertEquals(r.blocked, true, `expected "${t}" to be blocked`);
    assertEquals(r.reason, reason, `"${t}"`);
  }
  assertEquals(looksLikeHeadline('How our engineers ship every day'), true);
  assertEquals(looksLikeHeadline('Meet our new Head of Product'), true);
  assertEquals(looksLikeHeadline('Why I joined as a founding engineer...'), true);
  assertEquals(looksLikeHeadline('Head of Talent'), false);
  assertEquals(fails('Our head of product leads the roadmap discussion each week'), 'about page');
  assertEquals(fails('Lessons from a founding engineer'), 'reads like a news headline');
});

Deno.test('non-English titles are rejected, English ones with unusual words are not', () => {
  for (const t of ['Senior Softwareentwickler (m/w/d)', 'Développeur Backend Senior', 'Ingeniero de Software']) {
    assertEquals(isBlockedTitle(t).reason, 'role rule: non-English title', t);
  }
  for (const t of ['Anaplan Support Analyst', 'Kubernetes Platform Engineer', 'Rust Engineer', 'Zopa Graduate Analyst']) {
    assertEquals(isBlockedTitle(t).blocked, false, t);
  }
});

Deno.test('the job-noun test applies to page titles only; a feed title is a role by definition', () => {
  assertEquals(looksLikeRoleTitle('Engineering', 'careers_page'), false);
  assertEquals(looksLikeRoleTitle('London', 'llm'), false);
  assertEquals(looksLikeRoleTitle('Our culture', 'careers_page'), false);
  assertEquals(looksLikeRoleTitle('Barista', 'ashby'), true);
  assertEquals(looksLikeRoleTitle('Quant', 'greenhouse'), true);
  assertEquals(looksLikeRoleTitle('Team Member', 'lever'), true);
  assertEquals(fails('Team Member', 'workable'), null);
  assertEquals(fails('Team Member', 'careers_page'), 'no job noun in title');
  assertEquals(fails('Engineering', 'careers_page'), 'no job noun in title');
  assertEquals(fails('Engineering', 'ashby'), null);
  assertEquals(fails('General Application', 'ashby'), 'role rule: not a role (a general application, talent community or future-opportunities placeholder)', 'a placeholder is rejected whatever the source');
});
