// Real client and candidate reviews from the WhoFoundWho website
// (craigspringett/whofoundwho-website, src/data/reviews.ts), used as proof
// points. Chosen by consultant where possible, then by phase hints in the
// author line. Never paste more than a short phrase; the writer paraphrases.

export interface Review {
  quote: string;
  author: string;
  type: 'Candidate' | 'Client';
  consultant: string;
  date?: string;
  /** Phase hints inferred from the author line; empty means any. */
  phases: string[];
}

export const REVIEWS: Review[] = [
  {
    quote: 'Outstanding service in all areas. Great communication with easy access to speak to the right person when you need it quickly. Everything followed up with candidates and our company to make sure all parties stay happy. Clear and methodical selection of candidates based on our company’s needs. Open and honest at all stages about experience of candidates, individual feedback, suitability and finance. Just a great service.',
    author: 'Company / Client', type: 'Client', consultant: 'Luke Carnell', date: 'Feb 2026', phases: [],
  },
  {
    quote: 'Nikki has been incredibly helpful, I have felt completely supported throughout the process. Anytime I needed help or had a question, Nikki was responsive and thorough. I felt championed and empowered by Nikki going in to the interview.',
    author: 'Candidate', type: 'Candidate', consultant: 'Nikki Webber', phases: [],
  },
  {
    quote: 'The recruitment process was smooth and professional from start to finish. From initial contact to placement, everything was handled brilliantly. Kim’s pre trial day check in call really put me at ease.',
    author: 'SEND Teaching Assistant', type: 'Candidate', consultant: 'Kim Webb', phases: ['special', 'primary', 'secondary'],
  },
  {
    quote: 'Very professional, meticulous and forthcoming manner.',
    author: 'DT Teacher', type: 'Candidate', consultant: 'Anja Micic', phases: ['secondary'],
  },
  {
    quote: 'Anja is very responsive and understands our needs.',
    author: 'Company / Client', type: 'Client', consultant: 'Anja Micic', date: 'Jan 2026', phases: [],
  },
];

/** The consultants named on the website, for matching the app's free-text tags. */
export const TEAM: Array<{ first: string; full: string; role: string }> = [
  { first: 'Luke', full: 'Luke Carnell', role: 'Managing Director' },
  { first: 'Craig', full: 'Craig Springett', role: 'Managing Director' },
  { first: 'Kim', full: 'Kim Webb', role: 'Associate Director' },
  { first: 'Nikki', full: 'Nikki Webber', role: 'Associate Director' },
  { first: 'Charlotte', full: 'Charlotte Ward', role: 'Head of Compliance' },
  { first: 'Anja', full: 'Anja Micic', role: 'Practice Lead' },
  { first: 'Alexa', full: 'Alexa Burton', role: 'Partnerships Manager' },
  { first: 'Jason', full: 'Jason Jordaan', role: 'Partnerships Manager' },
];

export interface ConsultantIdentity {
  firstName: string | null;
  fullName: string | null;
  role: string;
}

/**
 * The consultant from the app's tag ("Kim Webb", "Anja Cold Targets",
 * "Isobel NEW Area", "Nikki, Nikki Cold Targets", "House"). The first word of
 * the first tag is the first name unless it is a team label. Names not on the
 * website keep their first name with the generic role.
 */
export function consultantFromTag(tag: string | null | undefined): ConsultantIdentity {
  const first = (tag || '').split(',')[0].trim().split(/\s+/)[0] || '';
  if (!first || /^(house|cold|new|targets?|team|unassigned)$/i.test(first)) return { firstName: null, fullName: null, role: 'Education Recruitment Consultant' };
  const member = TEAM.find((m) => m.first.toLowerCase() === first.toLowerCase());
  if (member) return { firstName: member.first, fullName: member.full, role: member.role };
  const cleaned = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  return { firstName: cleaned, fullName: null, role: 'Education Recruitment Consultant' };
}

/** Two or three reviews: the consultant's own first, then phase matches, then clients. */
export function pickReviews(consultant: ConsultantIdentity, phase: string | null | undefined, max = 3): Review[] {
  const score = (r: Review) => {
    let s = 0;
    if (consultant.fullName && r.consultant === consultant.fullName) s += 10;
    if (r.type === 'Client') s += 3;
    if (phase && r.phases.includes(phase)) s += 2;
    if (r.phases.length === 0) s += 1;
    return s;
  };
  return [...REVIEWS].sort((a, b) => score(b) - score(a)).slice(0, max);
}
