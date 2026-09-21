// The company's own careers page: the usual start-up paths, fetched in
// parallel with timeouts, soft-404s skipped, JSON-LD JobPosting blocks read
// first and role-shaped titles off the page second.
//
// Investigation of 21 September 2026 (from the build session): a start-up's
// careers page is one of three things.
//   - A page that only links to its ATS board ("See open roles" to
//     jobs.ashbyhq.com/{slug}): the roles come from the feed, and this
//     source must not invent titles off the page. When the page links to a
//     detected board and lists no titles it answers ok with zero roles and
//     names the board, and `detectedBoards` carries what it saw for the
//     integrator to confirm.
//   - A page that embeds its board (a Greenhouse embed script, an Ashby
//     iframe) or renders the list client-side: the HTML lists nothing; same
//     answer, the feed is the source.
//   - A page that lists the roles itself, often with JSON-LD JobPosting
//     blocks (Webflow and Framer templates, the Workable and Teamtailor
//     hosted pages): the blocks give title, url, datePosted, employment type
//     and whether the job is remote; headings and links give the rest.
// Precision rules kept from He-Giveth's website source: a page only counts
// when its text carries a hiring signal; a linked title must point at a
// role-shaped URL and never at news; every title read off the page must
// contain a job noun (blocklist.ts); documents about a post are carried as
// documents, never as roles.
import type { AtsBoard, CandidateVacancy, CompanyContext, SourceResult } from './types.ts';
import { fetchPage, htmlToText, looksLikeSoft404, mapWithConcurrency } from '../fetch.ts';
import { isBlockedTitle, looksLikeRoleTitle } from './blocklist.ts';
import { classifyDocument, hasDateEvidence, type DocumentKind } from './documents.ts';
import { findClosingDateInText } from '../dates.ts';
import { decodeEntities, normaliseTitle, vacancyKey } from '../vacancy-identity.ts';
import { detectAtsBoards } from './ats-detect.ts';
import { isoDateOf, workplaceTypeOf } from './feed.ts';

export const CAREERS_PATHS = [
  '/careers', '/jobs', '/join', '/join-us', '/work-with-us', '/open-roles', '/company/careers', '/about/careers',
  '/hiring', '/openings', '/positions', '/vacancies', '/join-the-team', '/join-our-team', '/careers/open-roles', '/about/jobs', '/team/careers',
];

const PAGE_MS = 8000;
/** Time allowed for a HEAD request asking when a linked file last changed. */
const HEAD_MS = 6000;
const CONCURRENCY = 8;
const MAX_DISCOVERED = 6;
const LINK_HINT = /career|jobs?\b|join|hiring|open[- ]?roles|openings|positions|vacanc|work[- ](?:with|for|at)[- ]us/i;
const ATS_HOST = /ashbyhq\.com|greenhouse\.io|lever\.co|workable\.com|teamtailor\.com|bamboohr\.com|jobvite\.com|smartrecruiters\.com|recruitee\.com|personio\.(?:de|com)|pinpointhq\.com|homerun\.co|welcometothejungle\.com|otta\.com|workatastartup\.com/i;
const VACANCY_HREF = new RegExp(`career|jobs?\\b|join|hiring|open[- ]?roles|openings|positions|vacanc|apply|opportunit|\\.pdf(\\?|$)|${ATS_HOST.source}`, 'i');
const NEWS_HREF = /(^|\/|-)news(\/|-|$)|\/blog|\/events|\/newsletter|\/press|\/customers|\/case-stud/i;
const VACANCY_SIGNAL = /\b(open (?:roles?|positions?)|we(?:'re| are) hiring|now hiring|join (?:us|our team|the team)|apply (?:now|here|today)|current (?:openings|opportunities|vacancies|roles)|job (?:description|openings?)|full[- ]time|part[- ]time|remote|hybrid|salary|equity|stock options|share options|benefits|how to apply|closing date|start date|contract type|employment type)\b/i;

export interface CareersPageOptions {
  homepageHtml: string;
  today?: Date;
}

/** The careers-page source's answer: a SourceResult plus the boards the pages link to. */
export interface CareersPageResult extends SourceResult {
  detectedBoards: AtsBoard[];
  pagesRead: string[];
}

/** Same-host links from a page whose href or text suggests a careers page. */
export function discoverCareersLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return out;
  }
  const re = /<a[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < MAX_DISCOVERED) {
    const href = m[1];
    const text = htmlToText(m[2]);
    if (!LINK_HINT.test(href) && !LINK_HINT.test(text)) continue;
    let abs: URL;
    try {
      abs = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (abs.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
    if (/\.(pdf|docx?|jpe?g|png|svg)$/i.test(abs.pathname)) continue;
    if (NEWS_HREF.test(abs.pathname)) continue;
    const key = abs.origin + abs.pathname.replace(/\/+$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(abs.toString());
  }
  return out;
}

/** Candidate careers URLs for a company: the usual paths at the site root, then the links the homepage offers. */
export function candidatePageUrls(storedUrl: string, homepageHtml: string): string[] {
  let base: URL;
  try {
    base = new URL(storedUrl);
  } catch {
    return [];
  }
  const urls: string[] = [];
  for (const p of CAREERS_PATHS) urls.push(`${base.origin}${p}`);
  for (const u of discoverCareersLinks(homepageHtml, storedUrl)) urls.push(u);
  return Array.from(new Set(urls));
}

/** A link straight to a file rather than a page. */
export const DOCUMENT_URL_RE = /\.(pdf|docx?)(\?|$)/i;

/** The words of a file name: "senior-engineer-jd_v2.pdf" -> "senior engineer jd v2". */
export function fileNameWords(url: string): string {
  let name = url.split('?')[0].split('#')[0].split('/').pop() || '';
  try { name = decodeURIComponent(name); } catch { /* keep as is */ }
  return name.replace(/\.(pdf|docx?)$/i, '').replace(/[-_+.]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** When a file was last changed, from the server's Last-Modified header; null when it does not say or cannot be reached. */
export async function fileLastModified(url: string, ms: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TASearcher/1.0)' } });
    const lm = res.headers.get('last-modified');
    if (!lm) return null;
    const d = new Date(lm);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Does this page read like a careers page (a hiring signal in its text, or a JobPosting block)? */
export function isVacancyPage(html: string, _pageUrl: string): boolean {
  if (parseJsonLdJobPostings(html).length) return true;
  const text = htmlToText(html);
  return VACANCY_SIGNAL.test(text);
}

export interface JsonLdJobPosting {
  title: string;
  url: string | null;
  datePosted: string | null;
  validThrough: string | null;
  employmentType: string | null;
  workplaceType: string | null;
  location: string | null;
  employerName: string | null;
}

/** Every schema.org JobPosting in the page's JSON-LD blocks (a bare object, an array, or a @graph). */
export function parseJsonLdJobPostings(html: string): JsonLdJobPosting[] {
  const out: JsonLdJobPosting[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html || '')) !== null) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const nodes: unknown[] = [];
    const walk = (n: unknown) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      const o = n as Record<string, unknown>;
      const type = o['@type'];
      const types = Array.isArray(type) ? type.map(String) : typeof type === 'string' ? [type] : [];
      if (types.includes('JobPosting')) nodes.push(o);
      if (Array.isArray(o['@graph'])) walk(o['@graph']);
      if (Array.isArray(o.itemListElement)) walk(o.itemListElement.map((e: any) => e?.item ?? e));
    };
    walk(data);
    for (const n of nodes as Array<Record<string, any>>) {
      const title = typeof n.title === 'string' ? decodeEntities(n.title).replace(/\s+/g, ' ').trim() : (typeof n.name === 'string' ? decodeEntities(n.name).replace(/\s+/g, ' ').trim() : '');
      if (!title) continue;
      const url = typeof n.url === 'string' && /^https?:\/\//i.test(n.url) ? n.url : (typeof n.directApply === 'string' && /^https?:\/\//i.test(n.directApply) ? n.directApply : null);
      const et = Array.isArray(n.employmentType) ? n.employmentType.map(String).join(', ') : (typeof n.employmentType === 'string' ? n.employmentType : null);
      const loc = Array.isArray(n.jobLocation) ? n.jobLocation[0] : n.jobLocation;
      const addr = loc?.address && typeof loc.address === 'object' ? loc.address : (typeof loc?.address === 'string' ? { addressLocality: loc.address } : null);
      const location = addr ? [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter((p: unknown) => typeof p === 'string' && p.trim()).join(', ') || null : null;
      const remote = n.jobLocationType === 'TELECOMMUTE';
      out.push({
        title,
        url,
        datePosted: isoDateOf(n.datePosted),
        validThrough: isoDateOf(n.validThrough),
        employmentType: et ? et.replace(/_/g, '-').toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase()) : null,
        workplaceType: remote ? 'remote' : workplaceTypeOf(n.workplaceType ?? null),
        location,
        employerName: typeof n.hiringOrganization?.name === 'string' ? n.hiringOrganization.name : null,
      });
    }
  }
  return out;
}

interface Extracted {
  title: string;
  url: string | null;
  context: string;
  /** A supporting document about a post (job description, pack), kept so the merge can attach it to the advert. */
  document: DocumentKind | null;
  post: string | null;
}

/**
 * Pull role-shaped titles off a careers page: linked titles (role-shaped
 * hrefs only), headings, and bold text. Each comes with the text that
 * follows it, for a closing date when the page gives one.
 */
export function extractTitlesFromPage(html: string, pageUrl: string): Extracted[] {
  const found: Extracted[] = [];
  const seen = new Set<string>();
  const text = htmlToText(html);
  const textLower = text.toLowerCase();

  const consider = (rawTitle: string, href: string | null) => {
    const title = decodeEntities(rawTitle).replace(/\s+/g, ' ').trim();
    if (title.length < 4 || title.length > 120) return;
    if (title.split(' ').length > 14) return;
    if (/^(https?:\/\/|www\.)/i.test(title)) return;
    if (!looksLikeRoleTitle(title, 'careers_page')) return;
    const doc = classifyDocument(title);
    if (doc.supporting) {
      if (!doc.post || !looksLikeRoleTitle(doc.post, 'careers_page') || isBlockedTitle(doc.post).blocked) return;
    } else if (isBlockedTitle(title).blocked) {
      return;
    }
    let url: string | null = null;
    if (href) {
      let abs: URL;
      try {
        abs = new URL(href, pageUrl);
      } catch {
        return;
      }
      if (!/^https?:$/.test(abs.protocol)) return;
      if (NEWS_HREF.test(abs.pathname + abs.search)) return;
      if (!VACANCY_HREF.test(abs.toString())) return;
      url = abs.toString();
    }
    const key = normaliseTitle(title);
    if (!key || seen.has(key)) return;
    const idx = textLower.indexOf(title.toLowerCase());
    const context = idx >= 0 ? text.slice(idx, idx + 700) : '';
    // A link to a posting on an ATS host, an apply page or a file is a role
    // on its own; an unlinked heading needs advert details beside it.
    const strongHref = !!url && (ATS_HOST.test(url) || /apply|\.pdf(\?|$)|\/jobs?\/[^/]+|\/careers?\/[^/]+|\/positions?\/[^/]+|\/openings?\/[^/]+|\/roles?\/[^/]+/i.test(url));
    if (!strongHref && !VACANCY_SIGNAL.test(context)) return;
    seen.add(key);
    let docClass = doc;
    if (!docClass.supporting && url && DOCUMENT_URL_RE.test(url)) {
      const fromFile = classifyDocument(fileNameWords(url));
      if (fromFile.supporting && fromFile.kind) docClass = { ...fromFile, post: doc.post || fromFile.post || title };
    }
    found.push({ title, url, context, document: docClass.supporting ? docClass.kind : null, post: docClass.supporting ? docClass.post : null });
  };

  const linkRe = /<a[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const inner = htmlToText(m[2]);
    if (!inner) continue;
    consider(inner.split('\n')[0], m[1]);
  }
  const headingRe = /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi;
  while ((m = headingRe.exec(html)) !== null) {
    const inner = htmlToText(m[1]);
    if (!inner) continue;
    consider(inner.split('\n')[0], null);
  }
  const strongRe = /<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi;
  while ((m = strongRe.exec(html)) !== null) {
    const inner = htmlToText(m[1]);
    if (!inner || inner.length > 80) continue;
    consider(inner.split('\n')[0], null);
  }
  return found;
}

/** The candidates on one page: JSON-LD postings first (a title there is a role), then what the markup lists. */
export function candidatesFromPage(html: string, pageUrl: string, ctx: Pick<CompanyContext, 'name'>, today: Date): CandidateVacancy[] {
  const out: CandidateVacancy[] = [];
  const seenKeys = new Set<string>();
  const seenTitles = new Set<string>();
  for (const p of parseJsonLdJobPostings(html)) {
    if (isBlockedTitle(p.title).blocked) continue;
    const candidate: CandidateVacancy = {
      title: p.title,
      url: p.url ?? pageUrl,
      pageUrl,
      source: 'careers_page',
      employerName: p.employerName ?? ctx.name,
      closingDate: p.validThrough,
      datePosted: p.datePosted,
      startText: null,
      location: p.location,
      workplaceType: p.workplaceType,
      employmentType: p.employmentType,
      raw: { foundOn: pageUrl, jsonLd: true },
    };
    const key = vacancyKey(candidate);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    seenTitles.add(normaliseTitle(p.title));
    out.push(candidate);
  }
  for (const e of extractTitlesFromPage(html, pageUrl)) {
    if (seenTitles.has(normaliseTitle(e.title))) continue;
    const candidate: CandidateVacancy = {
      title: e.title,
      url: e.url ?? pageUrl,
      pageUrl,
      source: 'careers_page',
      employerName: ctx.name,
      closingDate: findClosingDateInText(e.context, today),
      startText: null,
      document: e.document,
      post: e.post,
      raw: { foundOn: pageUrl },
    };
    const key = vacancyKey(candidate);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    out.push(candidate);
  }
  return out;
}

export async function careersPageSource(ctx: CompanyContext, opts: CareersPageOptions): Promise<CareersPageResult> {
  const started = Date.now();
  const today = opts.today ?? new Date();
  try {
    const urls = candidatePageUrls(ctx.url, opts.homepageHtml);
    const pages = await mapWithConcurrency(urls, CONCURRENCY, (u) => fetchPage(u, PAGE_MS));
    const reachable = pages.filter((p) => p.ok && p.html && !looksLikeSoft404(p.html, opts.homepageHtml));

    // The same page often answers several paths (redirects); keep one copy.
    const byFinal = new Map<string, typeof reachable[number]>();
    for (const p of reachable) {
      const k = p.finalUrl.replace(/\/+$/, '');
      if (!byFinal.has(k)) byFinal.set(k, p);
    }
    const unique = Array.from(byFinal.values());
    const vacancyPages = unique.filter((p) => isVacancyPage(p.html, p.finalUrl));

    // Boards linked from the homepage and every careers page, for the integrator to confirm.
    const detected = new Map<string, AtsBoard>();
    for (const b of detectAtsBoards(opts.homepageHtml, ctx.url)) detected.set(`${b.provider}:${b.slug}`, b);
    for (const p of unique) for (const b of detectAtsBoards(p.html, p.finalUrl)) detected.set(`${b.provider}:${b.slug}`, b);
    const detectedBoards = Array.from(detected.values());

    const vacancies: CandidateVacancy[] = [];
    const seenKeys = new Set<string>();
    for (const p of vacancyPages) {
      for (const c of candidatesFromPage(p.html, p.finalUrl, ctx, today)) {
        const key = vacancyKey(c);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        vacancies.push(c);
      }
    }
    // A file with no date in its name or path: ask the server when it last
    // changed, so an old job description cannot pass as a live role.
    const undatedFiles = vacancies.filter((v) => v.url && DOCUMENT_URL_RE.test(v.url) && !hasDateEvidence(v.title, v.url));
    await mapWithConcurrency(undatedFiles, CONCURRENCY, async (v) => { v.lastModified = await fileLastModified(v.url!, HEAD_MS); });

    const boardsNote = detectedBoards.length ? `; links to ${detectedBoards.map((b) => `${b.provider} board ${b.slug}`).join(', ')}` : '';
    const pagesNote = `${urls.length} paths tried, ${reachable.length} reachable, ${vacancyPages.length} careers pages (${vacancyPages.map((p) => p.finalUrl).join(', ') || 'none'})`;
    if (vacancies.length === 0 && detectedBoards.length) {
      return { source: 'careers_page', ok: true, vacancies: [], note: `${pagesNote}${boardsNote}; no roles listed on the page, the feed is the source`, ms: Date.now() - started, detectedBoards, pagesRead: unique.map((p) => p.finalUrl) };
    }
    return { source: 'careers_page', ok: reachable.length > 0 || pages.some((p) => p.status === 404), vacancies, note: `${pagesNote}${boardsNote}`, ms: Date.now() - started, detectedBoards, pagesRead: unique.map((p) => p.finalUrl) };
  } catch (e) {
    return { source: 'careers_page', ok: false, vacancies: [], note: e instanceof Error ? e.message : String(e), ms: Date.now() - started, detectedBoards: [], pagesRead: [] };
  }
}
