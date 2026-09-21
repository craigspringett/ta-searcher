// Stable identity for a vacancy so the same advert is never reported as "new"
// twice, whichever source found it and however the title was worded that day.

export interface VacancyLike {
  title: string;
  /** Direct link to the advert when we have one. */
  url?: string | null;
  /** The page the advert was found on (a listing page). Not an identity on its own. */
  pageUrl?: string | null;
}

const SOURCE_SUFFIX = /\s*\((?:posted on|from|via)?\s*(?:the\s+)?(?:company website|company site|tes|teaching vacancies|gov teaching vacancies|gov\.uk|eteach|mynewterm|my new term|reed|indeed|academics|hays|teaching personnel|randstad|llm|ai)[^)]*\)\s*$/i;

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&#8211;|&ndash;|&#8212;|&mdash;/g, '-')
    .replace(/&#8217;|&rsquo;|&#8216;|&lsquo;|&#39;|&apos;/g, "'")
    .replace(/&#8220;|&ldquo;|&#8221;|&rdquo;|&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

/** Strip source suffixes, decode entities, lowercase, collapse punctuation and whitespace. */
export function normaliseTitle(title: string | null | undefined): string {
  if (!title) return '';
  let t = decodeEntities(String(title));
  // Remove any number of trailing source suffixes: "(posted on TES) (from company website)"
  let prev = '';
  while (prev !== t) {
    prev = t;
    t = t.replace(SOURCE_SUFFIX, '');
  }
  t = t.toLowerCase();
  t = t.replace(/[‘’']/g, '');
  t = t.replace(/[^a-z0-9]+/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** Canonical form of a URL: lowercase host without www., no query, hash or trailing slash. */
export function canonicalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(String(url).trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  let path = u.pathname.replace(/\/+$/, '');
  if (path === '') path = '';
  return `${host}${path}`;
}

/**
 * Identity key for a vacancy. A direct advert URL wins; otherwise the
 * normalised title. A URL that is only the listing page it was found on does
 * not identify a single vacancy, so it is ignored.
 */
export function vacancyKey(v: VacancyLike): string {
  const direct = v.url && (!v.pageUrl || canonicalUrl(v.url) !== canonicalUrl(v.pageUrl)) ? canonicalUrl(v.url) : null;
  if (direct) return `url:${direct}`;
  return `title:${normaliseTitle(v.title)}`;
}

/** Human-readable title without the legacy "(posted on ...)" suffixes. */
export function cleanTitle(title: string | null | undefined): string {
  if (!title) return '';
  let t = decodeEntities(String(title)).trim();
  let prev = '';
  while (prev !== t) {
    prev = t;
    t = t.replace(SOURCE_SUFFIX, '').trim();
  }
  return t.replace(/\s+/g, ' ');
}
