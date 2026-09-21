// Accept a model-read open role only when its title occurs verbatim in the
// page text read this run and is not already verified from a feed or the
// careers page. The model never invents a role: no quote, no vacancy.
import type { CandidateVacancy } from './types.ts';
import { normaliseTitle, vacancyKey, cleanTitle } from '../vacancy-identity.ts';
import { parseUkDate } from '../dates.ts';
import { looksLikeRoleTitle } from './blocklist.ts';

export interface LlmVacancyInput {
  title?: string;
  startDate?: string;
  endDate?: string;
  url?: string;
}

export interface GroundingResult {
  accepted: CandidateVacancy[];
  rejected: Array<{ title: string; reason: string }>;
}

export function normaliseTextForGrounding(text: string): string {
  return ` ${normaliseTitle(text)} `;
}

export function groundLlmVacancies(items: LlmVacancyInput[], scrapedText: string, verified: CandidateVacancy[], today: Date = new Date()): GroundingResult {
  const haystack = normaliseTextForGrounding(scrapedText);
  const verifiedKeys = new Set(verified.map(vacancyKey));
  const verifiedTitles = new Set(verified.map((v) => normaliseTitle(v.title)));
  const accepted: CandidateVacancy[] = [];
  const rejected: GroundingResult['rejected'] = [];
  for (const item of items || []) {
    const title = cleanTitle(item?.title);
    const norm = normaliseTitle(title);
    if (!norm || norm.length < 4) {
      rejected.push({ title: String(item?.title ?? ''), reason: 'empty title' });
      continue;
    }
    const candidate: CandidateVacancy = {
      title,
      url: item.url && /^https?:\/\//i.test(item.url) ? item.url : null,
      source: 'llm',
      closingDate: parseUkDate(item.endDate, today, { mode: 'closing' }),
      startText: item.startDate && !/unknown|not specified|see (?:the )?(?:company )?(?:website|advert|posting)/i.test(item.startDate) ? item.startDate : null,
    };
    if (verifiedKeys.has(vacancyKey(candidate)) || verifiedTitles.has(norm)) {
      rejected.push({ title, reason: 'already verified from a source' });
      continue;
    }
    if (!haystack.includes(` ${norm} `)) {
      rejected.push({ title, reason: 'title not found verbatim in scraped text' });
      continue;
    }
    if (!looksLikeRoleTitle(title, 'llm')) {
      rejected.push({ title, reason: 'no job noun in title' });
      continue;
    }
    accepted.push(candidate);
  }
  return { accepted, rejected };
}
