import { assertEquals } from '../test-assert.ts';
import { isTalentLeadRole, isTalentRole, ROLE_FAMILY_LABELS, roleFamily, type RoleFamily } from './role-family.ts';

const expectFamily = (cases: Array<[string, RoleFamily] | [string, RoleFamily, string | null]>) => {
  for (const [title, family, department] of cases) {
    assertEquals(roleFamily(title, department ?? null), family, `"${title}"${department ? ` (${department})` : ''}`);
  }
};

Deno.test('roleFamily: people and talent roles are the direct lead', () => {
  expectFamily([
    ['Head of Talent', 'people_talent'],
    ['Talent Acquisition Partner', 'people_talent'],
    ['Senior Recruiter', 'people_talent'],
    ['People Operations Manager', 'people_talent'],
    ['Head of People', 'people_talent'],
    ['Engineering Recruiter', 'people_talent'],
    ['Technical Sourcer', 'people_talent'],
    ['HR Business Partner', 'people_talent'],
    ['People Partner', 'people_talent'],
    ['Chief People Officer', 'people_talent'],
    ['Head of Recruitment', 'people_talent'],
    ['Talent Lead', 'people_talent'],
  ]);
});

Deno.test('roleFamily: leadership, engineering, product and design', () => {
  expectFamily([
    ['Chief of Staff', 'leadership'],
    ['VP Engineering', 'leadership'],
    ['Head of Engineering', 'leadership'],
    ['Chief Technology Officer', 'leadership'],
    ['Co-founder', 'leadership'],
    ['Founding Engineer', 'engineering'],
    ['Senior Engineer', 'engineering'],
    ['Backend Engineer III', 'engineering'],
    ['Android Engineer', 'engineering'],
    ['Machine Learning Scientist', 'engineering'],
    ['Data Science Manager', 'engineering'],
    ['Site Reliability Engineer', 'engineering'],
    ['Staff Product Designer', 'product_design'],
    ['Content and Marketing Designer', 'product_design'],
    ['Senior Product Manager', 'product_design'],
    ['AI Product Manager', 'product_design'],
    ['UX Researcher', 'product_design'],
    ['Design Engineer', 'engineering'],
  ]);
});

Deno.test('roleFamily: go to market and operations', () => {
  expectFamily([
    ['Account Executive', 'go_to_market'],
    ['SDR', 'go_to_market'],
    ['Sales Development Representative (SDR) - Enterprise', 'go_to_market'],
    ['B2B Marketing Manager', 'go_to_market'],
    ['Senior Social Media Manager', 'go_to_market'],
    ['Customer Success Manager', 'go_to_market'],
    ['Partnerships Manager', 'go_to_market'],
    ['Growth Lead', 'go_to_market'],
    ['Finance Manager', 'operations'],
    ['Financial Controller', 'operations'],
    ['Executive Assistant to the CEO', 'operations'],
    ['Office Manager', 'operations'],
    ['Legal Counsel', 'operations'],
    ['Compliance Officer', 'operations'],
    ['Credit Risk Manager, Portfolio Management', 'operations'],
    ['Anaplan Support Analyst', 'operations'],
    ['Operations Associate', 'operations'],
  ]);
});

Deno.test('roleFamily: an ambiguous title takes the feed department; an unknown title is other', () => {
  expectFamily([
    ['Senior Analyst', 'engineering', 'Engineering'],
    ['Senior Analyst', 'operations', 'Finance'],
    ['Senior Analyst', 'operations', null],
    ['Intern', 'go_to_market', 'Sales'],
    ['Intern', 'other', null],
    ['2027 Graduate Analyst', 'operations', 'CAO General'],
    ['Team Member', 'other', null],
    ['Barista', 'other', null],
    ['Senior Engineer', 'engineering', 'Sales'],
  ]);
});

Deno.test('isTalentRole and isTalentLeadRole', () => {
  for (const t of ['Head of Talent', 'Talent Acquisition Partner', 'Senior Recruiter', 'People Operations Manager', 'Head of People', 'Technical Sourcer', 'HR Business Partner', 'Recruiting Lead', 'Director of Talent Acquisition']) {
    assertEquals(isTalentRole(t), true, `talent: ${t}`);
  }
  for (const t of ['Senior Engineer', 'Account Executive', 'Chief of Staff', 'Staff Product Designer', 'People Analytics Engineer', 'Office Manager']) {
    assertEquals(isTalentRole(t), false, `not talent: ${t}`);
  }
  for (const t of ['Head of Talent', 'Head of Recruitment', 'Head of Talent Acquisition', 'Director of Talent', 'Talent Lead', 'Recruiting Lead', 'VP People and Talent', 'Talent Acquisition Manager', 'Lead Recruiter']) {
    assertEquals(isTalentLeadRole(t), true, `lead: ${t}`);
  }
  for (const t of ['Talent Acquisition Partner', 'Senior Recruiter', 'Head of People', 'People Partner', 'Technical Sourcer', 'Senior Engineer']) {
    assertEquals(isTalentLeadRole(t), false, `not lead: ${t}`);
  }
});

Deno.test('ROLE_FAMILY_LABELS has the seven labels the contract names', () => {
  assertEquals(ROLE_FAMILY_LABELS, { engineering: 'Engineering', product_design: 'Product and design', go_to_market: 'Go to market', operations: 'Operations', people_talent: 'People and talent', leadership: 'Leadership', other: 'Other' });
});
