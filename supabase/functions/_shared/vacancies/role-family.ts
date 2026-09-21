// The role family of an open role, shared by the signals, the score, the
// brief and the company page so "engineering hiring" means the same thing
// everywhere (docs/TA-SEARCHER-BRIEF.md, "Signals and the score").
//
// Seven families: `people_talent` (recruiters, talent, people, HR: the
// direct lead), `leadership` (C-level, VP, founders, chief of staff, general
// managers), `engineering`, `product_design`, `go_to_market` (sales,
// marketing, customer success, partnerships, account management, growth),
// `operations` (ops, finance, legal, admin, EA, office, support, compliance)
// and `other`.
//
// The title decides. The feed's department decides only when the title is
// ambiguous ("Senior Analyst" in Ashby's "Engineering" department is
// engineering; "Senior Analyst" in "Finance" is operations). People and
// talent is tested first so "Engineering Recruiter" is a talent role, then
// leadership so "Head of Engineering" is leadership, not engineering: the
// score counts leadership hires as load like any other.

export type RoleFamily = 'engineering' | 'product_design' | 'go_to_market' | 'operations' | 'people_talent' | 'leadership' | 'other';

export const ROLE_FAMILY_LABELS: Record<RoleFamily, string> = {
  engineering: 'Engineering',
  product_design: 'Product and design',
  go_to_market: 'Go to market',
  operations: 'Operations',
  people_talent: 'People and talent',
  leadership: 'Leadership',
  other: 'Other',
};

const PEOPLE_TALENT_RE = /\b(recruit\w*|talent|people (?:ops|operations|partner|lead|manager|director|team|experience|generalist|advisor|adviser|coordinator|co-ordinator|specialist|business partner|analyst|associate|executive)|head of people|vp,? people|director of people|chief people officer|\bcpo\b|\bhr\b|human resources|hrbp|people (?:and|&) (?:culture|talent|operations)|culture (?:and|&) people|sourcer|sourcing (?:partner|specialist|lead)|technical sourcer|employer brand\w*|learning (?:and|&) development|onboarding (?:specialist|lead|manager)|workplace (?:experience|manager)|people)\b/i;

/** Titles with an HR word that are still not people roles: "Head of Sales" carries "head", not "people". */
const PEOPLE_FALSE_POSITIVE_RE = /\bpeople (?:analytics engineer|data engineer)\b/i;

const LEADERSHIP_RE = /\b(chief [a-z]+ officer|\bc[a-z]o\b|\bcto\b|\bcoo\b|\bceo\b|\bcfo\b|\bcmo\b|\bcro\b|\bciso\b|chief of staff|founder|co-founder|founding (?:team|partner)|\bvp\b|vice president|\bsvp\b|\bevp\b|general manager|managing director|\bmd\b|president|head of (?:engineering|product|design|sales|marketing|operations|finance|growth|revenue|customer|partnerships|data|legal|commercial|strategy|business|uk|europe|emea|international)|director of (?:engineering|product|design|sales|marketing|operations|finance|growth|revenue|customer|partnerships|data|legal|commercial|strategy|business))\b/i;

const ENGINEERING_RE = /\b(engineer\w*|developer|software|backend|back-end|frontend|front-end|full[- ]?stack|devops|\bsre\b|site reliability|platform|infrastructure|data scientist|data science|machine learning|\bml\b|\bai\b|research scientist|applied scientist|\bqa\b|quality assurance|test automation|security (?:analyst|specialist|lead|architect)|architect|\bios\b|android|mobile developer|programmer|data engineer|analytics engineer|solutions engineer|technical lead|tech lead|cloud|database|\bdba\b|firmware|embedded|hardware|robotics|blockchain|research (?:engineer|lead|associate|fellow)|\bresearcher\b)\b/i;

const PRODUCT_DESIGN_RE = /\b(product (?:manager|owner|lead|designer|design|analyst|marketing manager|operations|specialist|associate|director|management)|\bpm\b|\bux\b|\bui\b|user (?:experience|research|researcher)|design(?:er)?|creative (?:director|lead)|brand designer|visual designer|interaction designer|content designer|design (?:lead|manager|system)|illustrator|motion designer|copywriter|technical writer|content (?:strategist|lead|manager|writer|marketing designer))\b/i;

const STRONG_PRODUCT_DESIGN_RE = /\b(product (?:manager|owner|director|lead|designer|analyst|marketing manager|operations)|designer|design lead|\bux\b|\bui\b|user research\w*|copywriter|technical writer|content designer)\b/i;

const GO_TO_MARKET_RE = /\b(sales|account (?:executive|manager|director|development|management)|\bae\b|\bsdr\b|\bbdr\b|business development|marketing|growth|demand generation|customer (?:success|experience|support|service|onboarding|operations|advocate|champion|marketing|education)|partnerships?|partner (?:manager|lead|director)|revenue|commercial|go[- ]to[- ]market|\bgtm\b|community (?:manager|lead|associate)|social media|\bpr\b|public relations|communications|comms|brand (?:manager|lead|marketing)|\bseo\b|performance marketing|lifecycle|crm (?:manager|lead|executive)|events? (?:manager|lead|coordinator|co-ordinator|executive)|solutions? (?:consultant|architect)|pre-?sales|implementation (?:manager|specialist|consultant)|customer|client (?:success|partner|director|manager|services))\b/i;

const OPERATIONS_RE = /\b(operations?|\bops\b|finance|financial|accountant|accounting|accounts (?:payable|receivable|assistant)|controller|\bfp&a\b|bookkeeper|payroll|legal|counsel|paralegal|compliance|risk|regulatory|\bmlro\b|fraud|kyc|aml|credit (?:analyst|risk|manager)|underwrit\w*|procurement|supply chain|logistics|admin\w*|executive assistant|\bea\b|personal assistant|\bpa\b|office (?:manager|coordinator|co-ordinator|assistant|administrator)|receptionist|facilities|workplace|it (?:support|manager|administrator|engineer|analyst)|support (?:engineer|specialist|analyst|associate|agent)|business (?:operations|analyst|manager|intelligence)|strategy|analyst|programme (?:manager|lead)|program (?:manager|lead)|project (?:manager|coordinator|co-ordinator|lead)|delivery (?:manager|lead)|scrum master|agile coach|chief of staff|data (?:analyst|protection|governance)|treasury|tax|audit\w*|investor relations|fundraising|grants?|quality (?:manager|lead|assurance manager)|health (?:and|&) safety|sustainability|esg|clinical|regulatory affairs|policy|research (?:manager|coordinator|co-ordinator|analyst))\b/i;

/** Department names from the feeds, mapped to a family when the title is ambiguous. */
const DEPARTMENT_FAMILY: Array<[RegExp, RoleFamily]> = [
  [/\b(people|talent|recruit\w*|\bhr\b|human resources)\b/i, 'people_talent'],
  [/\b(engineering|technology|tech|data|research|science|r&d|security|platform|infrastructure|product engineering)\b/i, 'engineering'],
  [/\b(product|design|ux|creative)\b/i, 'product_design'],
  [/\b(sales|marketing|growth|revenue|commercial|partnerships|customer|success|support|business development|go[- ]to[- ]market|gtm|brand|communications|community)\b/i, 'go_to_market'],
  [/\b(operations|ops|finance|legal|compliance|risk|admin\w*|g&a|general (?:and|&) administrative|corporate|strategy|business operations|office|facilities|workplace|it)\b/i, 'operations'],
  [/\b(leadership|executive|founders?|management|c-suite)\b/i, 'leadership'],
];

/** Source suffixes such as "(via Ashby)" and Ashby's trailing spaces are stripped before the title is tested. */
function cleanTitle(title: string): string {
  return (title || '').replace(/\s*\((?:posted on |via |from )?(?:ashby|greenhouse|lever|workable|careers page|company website|llm|ai)[^)]*\)\s*$/i, '').replace(/\s+/g, ' ').trim();
}

function familyOfDepartment(department: string | null | undefined): RoleFamily | null {
  if (!department) return null;
  for (const [re, family] of DEPARTMENT_FAMILY) if (re.test(department)) return family;
  return null;
}

/** Titles whose words say nothing about the discipline: the department decides, or "other". */
const AMBIGUOUS_RE = /^(?:(?:senior|junior|lead|principal|staff|associate|graduate|head of|chief|intern|apprentice|trainee|entry[- ]level|mid[- ]level|experienced|founding|first|early careers?)\s+)*(?:analyst|manager|associate|specialist|lead|intern|internship|apprentice|apprenticeship|graduate|coordinator|co-ordinator|executive|assistant|consultant|advisor|adviser|officer|generalist|fellow|team member|hire|role|position|scientist|partner|principal|director)s?(?:\s*[-,(:]\s*.*)?$/i;

/** "Executive Assistant to the CEO", "EA to the founders", "Chief of Staff to the CTO": the leader is the boss, not the post. */
const REPORTS_TO_RE = /\b(?:to|for|supporting)\s+(?:the\s+|our\s+)?(?:ceo|cto|coo|cfo|cpo|cmo|cro|founders?|co-founders?|founding team|chief [a-z]+ officer|executive team|leadership team|senior leadership|c-suite|exec(?:utive)?s?|vp[\w ]*|head of [a-z]+|directors?)\b|\b(?:ceo|cto|coo|cfo|founders?|co-founders?)['’]s\b/gi;

export function roleFamily(title: string, department?: string | null): RoleFamily {
  const t = cleanTitle(title).replace(REPORTS_TO_RE, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return 'other';
  const fromDepartment = familyOfDepartment(department);
  if (PEOPLE_TALENT_RE.test(t) && !PEOPLE_FALSE_POSITIVE_RE.test(t)) return 'people_talent';
  if (LEADERSHIP_RE.test(t)) return 'leadership';
  if (AMBIGUOUS_RE.test(t) && fromDepartment) return fromDepartment;
  // "AI Product Manager" and "Content Designer" are product roles even though
  // an engineering word sits in the title; a "Design Engineer" is not.
  if (STRONG_PRODUCT_DESIGN_RE.test(t)) return 'product_design';
  if (ENGINEERING_RE.test(t)) return 'engineering';
  if (PRODUCT_DESIGN_RE.test(t)) return 'product_design';
  if (GO_TO_MARKET_RE.test(t)) return 'go_to_market';
  if (OPERATIONS_RE.test(t)) return 'operations';
  return fromDepartment ?? 'other';
}

/** Recruiter, talent, people partner, head of people: the roles that run hiring. */
export function isTalentRole(title: string): boolean {
  const t = cleanTitle(title);
  if (!t) return false;
  return /\b(recruit\w*|talent|sourcer|head of people|vp,? people|director of people|chief people officer|people (?:partner|lead|manager|director|ops|operations|business partner|generalist|team lead|and talent|& talent)|hrbp|hr (?:business partner|manager|lead|director|generalist))\b/i.test(t) && !PEOPLE_FALSE_POSITIVE_RE.test(t);
}

/** Head of Talent, Head of Recruitment, Head of Talent Acquisition, Director of Talent, Talent Lead, Recruiting Lead: the role Craig places. */
export function isTalentLeadRole(title: string): boolean {
  const t = cleanTitle(title);
  if (!t) return false;
  return /\b(?:head of|director of|vp,?(?: of)?|vice president,?(?: of)?|chief)\s+(?:talent|recruit\w*|people (?:and|&) talent|talent (?:and|&) people)\b|\b(?:talent|recruit(?:ing|ment)|\bta\b)\s+(?:lead|leader|director|head)\b|\btalent acquisition (?:lead|leader|manager|director|head)\b|\blead (?:recruiter|talent partner)\b/i.test(t);
}
