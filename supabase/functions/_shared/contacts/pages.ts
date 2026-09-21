// Which pages to read for contacts, and fetching them.
//
// Tier 1 (always): contact pages. Tier 2 (always): people pages (team,
// about, leadership, founders, careers). Tier 3 (as budget allows): blog,
// news, press and customers. Tiers 1 and 2 are fetched in parallel with an
// 8 s timeout each, soft-404s are dropped, 25 pages in total. One extra
// host is allowed when the careers page lives elsewhere: an applicant
// tracking system board (Ashby, Greenhouse, Lever, Workable) or a careers.
// or jobs. sub-domain the homepage links to; those pages are tagged
// level 'careers'. Up to two PDFs (a team sheet, a pitch deck, a press kit)
// are read with unpdf; they are rare on a start-up site, so the cap stays low.

import { fetchPage, fetchBytes, htmlToText, looksLikeSoft404, mapWithConcurrency, type FetchedPage } from '../fetch.ts';

export type PageTier = 'home' | 'contact' | 'people' | 'context' | 'pdf' | 'careers';
export type PageLevel = 'company' | 'careers';

/** Per-page cap on HTML kept for extraction, after slimming. */
export const MAX_PAGE_HTML = 300_000;
/** Total slimmed HTML processed per company; pages beyond it are dropped (contact and people tiers come first). */
export const MAX_SITE_HTML = 2_000_000;

/**
 * Drop what never holds a contact and costs CPU to scan: scripts (after the
 * JavaScript address trick has been given its chance in extract.ts, which
 * reads scripts from the original), styles, SVG, comments, noscript, and
 * data: URIs. A marketing site's pages can run to 1.4 MB each and blew the
 * edge worker's CPU budget on 8 September 2026; slimmed they are a tenth of
 * that.
 */
export function slimHtml(html: string): string {
  return slimPage(html).html;
}

/** Of an over-long page keep the head and the tail: contact details usually sit in the footer. */
export const KEEP_HEAD_HTML = 200_000;
export const KEEP_TAIL_HTML = 100_000;

/** slimHtml, reporting whether the page was cut down to head plus tail. */
export function slimPage(html: string): { html: string; truncated: boolean } {
  const scripts = (html.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || []).filter((s) => /@|['"]\s*\+\s*['"]/.test(s) && s.length < 20000).join('\n');
  let out = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(?:src|href|srcset|style)=(["'])data:[^"']{0,200000}\1/gi, '')
    .replace(/[ \t]{2,}/g, ' ');
  let truncated = false;
  if (out.length > MAX_PAGE_HTML) {
    out = out.slice(0, KEEP_HEAD_HTML) + '\n<!-- ta-searcher: middle of the page dropped -->\n' + out.slice(out.length - KEEP_TAIL_HTML);
    truncated = true;
  }
  // Keep only the scripts that could carry an address, so the JS trick still works.
  return { html: scripts ? out + '\n' + scripts : out, truncated };
}

export interface SitePage {
  url: string;
  tier: PageTier;
  level: PageLevel;
  html: string;
  text: string;
  ms: number;
}

export interface SiteFetchNotes {
  requested: number;
  fetched: string[];
  skipped: Array<{ url: string; why: string }>;
  /** Pages cut to head plus tail because they were over the per-page cap. */
  truncated: string[];
  /** The careers page on another host (an ATS board URL or a careers. sub-domain), when the homepage linked one. */
  careersHost: string | null;
  pdfs: string[];
  ms: number;
}

export const CONTACT_PATHS = ['/contact', '/contact-us', '/get-in-touch'];
export const PEOPLE_PATHS = ['/team', '/about', '/about-us', '/company', '/people', '/leadership', '/founders', '/careers', '/jobs', '/join', '/join-us'];
export const CONTEXT_PATHS = ['/blog', '/news', '/press', '/customers'];
const CONTACT_LINK = /contact|get in touch|talk to us|say hello/i;
const PEOPLE_LINK = /\b(team|about|company|people|leadership|founders|careers|jobs|join|open roles|we'?re hiring|hiring)\b/i;
const PEOPLE_PATH = /team|about|company|people|leadership|founders|careers|jobs|join/i;
const PDF_LINK = /team|leadership|founders|deck|press kit|press-kit|company overview|about/i;
const PAGE_MS = 8000;
const PDF_MS = 12000;
const PDF_MAX_BYTES = 2 * 1024 * 1024;
const MAX_PAGES = 25;
const MAX_PDFS = 2;
const CONCURRENCY = 8;

/** Hosts that serve a company's careers page on the ATS's own domain; the path carries the company's slug. */
export const ATS_HOSTS = ['jobs.ashbyhq.com', 'boards.greenhouse.io', 'job-boards.greenhouse.io', 'jobs.lever.co', 'apply.workable.com'];

interface Link { href: string; text: string; abs: URL }

export function pageLinks(html: string, baseUrl: string): Link[] {
  const out: Link[] = [];
  const re = /<a\b[^>]*href=(["'])([^"'#]+?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[2].trim();
    if (!href || /^(mailto|tel|javascript):/i.test(href)) continue;
    let abs: URL;
    try {
      abs = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(abs.protocol)) continue;
    const text = htmlToText(m[3]).replace(/\s+/g, ' ').trim();
    out.push({ href, text, abs });
  }
  return out;
}

function pathKey(u: URL): string {
  return u.pathname.replace(/\/+$/, '').toLowerCase() || '/';
}

/** The tiered list of same-host URLs to fetch, homepage links first within each tier. */
export function selectPages(homepageHtml: string, siteUrl: string): { contact: string[]; people: string[]; context: string[]; pdfs: Array<{ url: string; text: string }> } {
  const base = new URL(siteUrl);
  const links = pageLinks(homepageHtml, siteUrl);
  const same = links.filter((l) => l.abs.hostname === base.hostname);
  const seen = new Set<string>([pathKey(base)]);
  const take = (candidates: string[], limit: number): string[] => {
    const out: string[] = [];
    for (const c of candidates) {
      let u: URL;
      try {
        u = new URL(c, siteUrl);
      } catch {
        continue;
      }
      const k = pathKey(u);
      if (seen.has(k)) continue;
      if (/\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|svg|zip)$/i.test(k)) continue;
      seen.add(k);
      out.push(u.origin + u.pathname);
      if (out.length >= limit) break;
    }
    return out;
  };
  const contactLinks = same.filter((l) => CONTACT_LINK.test(l.text) || CONTACT_LINK.test(l.abs.pathname)).map((l) => l.abs.toString());
  const peopleLinks = same.filter((l) => PEOPLE_LINK.test(l.text) || PEOPLE_PATH.test(l.abs.pathname)).map((l) => l.abs.toString());
  const contact = take([...contactLinks, ...CONTACT_PATHS], 6);
  const people = take([...peopleLinks, ...PEOPLE_PATHS], 16);
  const context = take([...CONTEXT_PATHS], 3);
  const pdfs = links
    .filter((l) => /\.pdf(\?|$)/i.test(l.abs.pathname + l.abs.search) && (PDF_LINK.test(l.text) || PDF_LINK.test(l.abs.pathname)))
    .map((l) => ({ url: l.abs.toString(), text: l.text }));
  return { contact, people, context, pdfs };
}

function registrable(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, '').split('.');
  // co.uk, org.uk and the like keep three labels; everything else two.
  const n = parts.length >= 3 && /^(co|org|ac|gov|net|me|ltd|plc)$/.test(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-n).join('.');
}

/**
 * The careers page on another host, when the homepage links to one: the
 * company's board on an ATS host (the full URL, since the path carries the
 * company's slug), or a careers. / jobs. sub-domain of the company's own
 * domain (its origin). Null when the careers page is on the site itself or
 * not linked at all. Job boards and social sites are never the careers host.
 */
export function findCareersHost(homepageHtml: string, siteUrl: string): string | null {
  const base = new URL(siteUrl);
  const siteDomain = registrable(base.hostname);
  const links = pageLinks(homepageHtml, siteUrl).filter((l) => l.abs.hostname !== base.hostname);
  for (const l of links) {
    const host = l.abs.hostname.toLowerCase();
    if (ATS_HOSTS.includes(host) && l.abs.pathname.replace(/\/+$/, '').length > 1) return l.abs.origin + l.abs.pathname.replace(/\/+$/, '');
  }
  for (const l of links) {
    const host = l.abs.hostname.toLowerCase();
    if (/^(careers|jobs|join)\./.test(host) && registrable(host) === siteDomain) return l.abs.origin;
  }
  return null;
}

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  // A literal specifier, so the deploy bundler ships the package: with a
  // variable specifier the edge runtime answered "Could not find constraint
  // 'unpdf@0.12.1' in the list of packages" on 10 September 2026 and every
  // PDF was skipped.
  const { extractText, getDocumentProxy } = await import('npm:unpdf@0.12.1');
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return String(text || '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

export interface FetchSiteOptions {
  siteUrl: string;
  homepageHtml: string;
  /** Pages already fetched by another step (URL -> html), reused rather than fetched twice. */
  known?: Map<string, string>;
  maxPages?: number;
}

export async function fetchContactPages(opts: FetchSiteOptions): Promise<{ pages: SitePage[]; notes: SiteFetchNotes }> {
  const started = Date.now();
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const notes: SiteFetchNotes = { requested: 0, fetched: [], skipped: [], truncated: [], careersHost: null, pdfs: [], ms: 0 };
  const sel = selectPages(opts.homepageHtml, opts.siteUrl);
  const slimHome = slimPage(opts.homepageHtml);
  if (slimHome.truncated) notes.truncated.push(opts.siteUrl);
  const pages: SitePage[] = [{ url: opts.siteUrl, tier: 'home', level: 'company', html: slimHome.html, text: htmlToText(opts.homepageHtml), ms: 0 }];
  const seenFinal = new Set<string>([opts.siteUrl.replace(/\/+$/, '')]);

  const fetchTier = async (urls: string[], tier: PageTier, level: PageLevel, homeHtml: string) => {
    const budget = maxPages - pages.length;
    const list = urls.slice(0, Math.max(0, budget));
    notes.requested += list.length;
    const results = await mapWithConcurrency(list, CONCURRENCY, async (u): Promise<FetchedPage> => {
      const known = opts.known?.get(u);
      if (known) return { url: u, finalUrl: u, status: 200, ok: true, html: known, ms: 0 };
      return await fetchPage(u, PAGE_MS);
    });
    for (const r of results) {
      if (!r.ok || !r.html) { notes.skipped.push({ url: r.url, why: r.error ? r.error.slice(0, 80) : `HTTP ${r.status}` }); continue; }
      const key = r.finalUrl.replace(/\/+$/, '');
      if (seenFinal.has(key)) { notes.skipped.push({ url: r.url, why: 'duplicate' }); continue; }
      if (looksLikeSoft404(r.html, homeHtml)) { notes.skipped.push({ url: r.url, why: 'soft 404' }); continue; }
      seenFinal.add(key);
      const slim = slimPage(r.html);
      if (slim.truncated) notes.truncated.push(r.finalUrl);
      pages.push({ url: r.finalUrl, tier, level, html: slim.html, text: htmlToText(slim.html), ms: r.ms });
      notes.fetched.push(r.finalUrl);
    }
  };

  await Promise.all([
    fetchTier(sel.contact, 'contact', 'company', opts.homepageHtml),
    fetchTier(sel.people, 'people', 'company', opts.homepageHtml),
  ]);

  // The careers page on another host: the board page itself and, on a
  // careers. sub-domain, its own team and contact pages.
  const careersHost = findCareersHost(opts.homepageHtml, opts.siteUrl);
  if (careersHost && pages.length < maxPages) {
    notes.careersHost = careersHost;
    const home = await fetchPage(careersHost + (careersHost.endsWith('/') ? '' : '/'), PAGE_MS);
    if (home.ok && home.html) {
      const isAts = ATS_HOSTS.includes(new URL(careersHost).hostname.toLowerCase());
      if (!isAts) {
        const csel = selectPages(home.html, careersHost + '/');
        const careersUrls = Array.from(new Set([...csel.contact.slice(0, 2), ...csel.people.filter((u) => /team|people|about|leadership|founders|contact/i.test(u)).slice(0, 4)]));
        await fetchTier(careersUrls, 'careers', 'careers', home.html);
      }
      const slimCareersHome = slimPage(home.html);
      if (slimCareersHome.truncated) notes.truncated.push(home.finalUrl);
      pages.push({ url: home.finalUrl, tier: 'careers', level: 'careers', html: slimCareersHome.html, text: htmlToText(slimCareersHome.html), ms: home.ms });
      notes.fetched.push(home.finalUrl);
    } else {
      notes.skipped.push({ url: careersHost, why: home.error ? home.error.slice(0, 80) : `HTTP ${home.status}` });
    }
  }

  if (pages.length < maxPages) await fetchTier(sel.context, 'context', 'company', opts.homepageHtml);

  // PDFs linked from the homepage or the fetched people/contact pages.
  const pdfLinks = new Map<string, string>();
  for (const p of sel.pdfs) pdfLinks.set(p.url, p.text);
  for (const pg of pages) {
    if (pg.tier !== 'people' && pg.tier !== 'contact') continue;
    for (const l of pageLinks(pg.html, pg.url)) {
      if (/\.pdf(\?|$)/i.test(l.abs.pathname + l.abs.search) && (PDF_LINK.test(l.text) || PDF_LINK.test(l.abs.pathname))) pdfLinks.set(l.abs.toString(), l.text);
    }
  }
  const pdfList = Array.from(pdfLinks.keys()).slice(0, MAX_PDFS);
  if (pdfList.length > 0) {
    const results = await mapWithConcurrency(pdfList, 2, async (u) => {
      const got = await fetchBytes(u, PDF_MS, PDF_MAX_BYTES);
      if (!got) return { u, text: null as string | null, why: 'not fetched or over 2 MB' };
      if (!/pdf/i.test(got.contentType) && !(got.bytes[0] === 0x25 && got.bytes[1] === 0x50)) return { u, text: null, why: 'not a PDF' };
      try {
        return { u, text: await extractPdfText(got.bytes), why: '' };
      } catch (e) {
        return { u, text: null, why: `pdf parse failed: ${e instanceof Error ? e.message.slice(0, 60) : e}` };
      }
    });
    for (const r of results) {
      if (r.text && r.text.length > 40) {
        pages.push({ url: r.u, tier: 'pdf', level: 'company', html: '', text: r.text.slice(0, 60000), ms: 0 });
        notes.pdfs.push(r.u);
        notes.fetched.push(r.u);
      } else {
        notes.skipped.push({ url: r.u, why: r.why || 'empty PDF' });
      }
    }
  }

  // CPU budget: contact and people pages first, then the rest until the total is spent.
  const priority: Record<PageTier, number> = { home: 0, contact: 1, people: 2, pdf: 3, careers: 4, context: 5 };
  const kept: SitePage[] = [];
  let bytes = 0;
  for (const p of [...pages].sort((a, b) => priority[a.tier] - priority[b.tier])) {
    const size = (p.html || p.text).length;
    if (bytes + size > MAX_SITE_HTML && p.tier !== 'home') { notes.skipped.push({ url: p.url, why: 'over the size budget' }); continue; }
    bytes += size;
    kept.push(p);
  }
  notes.fetched = notes.fetched.filter((u) => kept.some((p) => p.url === u));
  notes.ms = Date.now() - started;
  return { pages: kept, notes };
}
