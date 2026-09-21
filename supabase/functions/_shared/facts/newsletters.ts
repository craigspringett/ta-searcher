// Departures and arrivals from the company's news and blog pages. A start-up
// writes "Priya joins as our first Head of People" or "our CTO is stepping
// down" on its blog weeks before the org chart or any advert changes. This
// module finds the news, blog, press and updates pages from the homepage,
// takes the three most recent posts (web page or PDF press release), and
// asks the model for staff departures and arrivals only, each with a
// verbatim quote that validate.ts then checks against the post it came
// from. The facts land in company_facts as kinds staff_departure and
// staff_arrival; the staff_departure signal reads them. The file keeps its
// He-Giveth name so the callers do not move.

import { chatCompletion, resolveModel } from '../ai.ts';
import { fetchBytes, fetchPage, htmlToText, looksLikeSoft404, mapWithConcurrency } from '../fetch.ts';
import { extractPdfText, pageLinks } from '../contacts/pages.ts';
import { ExtractionQuotaError } from './extract.ts';
import type { RawFact, SourcePage } from './types.ts';

/** Link text or path that names a news or blog section. A changelog is product news, not people news. */
export const NEWS_LINK = /\bblog\b|\bnews(?:room)?\b|\bpress(?:[- ]releases?)?\b|\bupdates?\b|\bannouncements?\b|\bstories\b|\bjournal\b|\bin the (?:news|press)\b/i;
/** Links in a news section that are forms, feeds, listings by tag or product release notes, not posts. */
const NOT_A_POST = /subscribe|sign ?up|unsubscribe|mailchimp|substack\.com\/subscribe|\.rss|\/feed\b|\/rss\b|\/tags?\/|\/categor(?:y|ies)\/|\/authors?\/|\/page\/\d+|[?&]page=|changelog|release[- ]notes|product[- ]updates|press[- ]kit|media[- ]kit|brand[- ]assets|\/search\b/i;
const MONTH_RE = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const POST_HINT = new RegExp(`\\b(?:announc\\w*|join\\w*|welcom\\w*|hire\\w*|appoint\\w*|leav\\w*|farewell|team|people|funding|raise\\w*|series [a-d]|seed|${MONTH_RE}|20\\d{2})\\b`, 'i');

const PAGE_MS = 8000;
const PDF_MS = 15000;
const PDF_MAX_BYTES = 5 * 1024 * 1024;
/** Posts read per company per run. */
export const MAX_ISSUES = 3;
/** Characters of each post shown to the model. */
export const MAX_ISSUE_CHARS = 25000;

function isPdf(u: URL): boolean {
  return /\.pdf(?:\?|$)/i.test(u.pathname + u.search);
}

/** "acme.com" from "www.acme.com", so "blog.acme.com" counts as the company's own host. */
function siteDomain(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function sameSite(host: string, base: URL): boolean {
  const d = siteDomain(base.hostname);
  const h = siteDomain(host);
  return h === d || h.endsWith('.' + d);
}

/**
 * The homepage links that lead to the news: a blog or news index, a press
 * page, or a direct post. The company's own hosts only (a blog sub-domain
 * counts); forms, feeds and changelogs excluded; index pages first.
 */
export function findNewsEntries(homepageHtml: string, siteUrl: string, limit = 3): string[] {
  const base = new URL(siteUrl);
  const seen = new Set<string>();
  const pages: string[] = [];
  const posts: string[] = [];
  for (const l of pageLinks(homepageHtml, siteUrl)) {
    if (!sameSite(l.abs.hostname, base)) continue;
    const hay = `${l.text} ${l.abs.pathname}`;
    if (!NEWS_LINK.test(hay) || NOT_A_POST.test(hay)) continue;
    const key = (l.abs.origin + l.abs.pathname + l.abs.search).replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    (isPdf(l.abs) ? posts : pages).push(l.abs.toString());
  }
  return [...pages, ...posts].slice(0, limit);
}

/** A date read from link text or path, as a sortable string; empty when none. */
export function postDateKey(text: string, href: string): string {
  const hay = `${text} ${decodeURIComponent(href)}`.replace(/[_\-]+/g, ' ');
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const mi = (m: string) => String(months.indexOf(m.slice(0, 3).toLowerCase()) + 1).padStart(2, '0');
  let m = hay.match(/\b(20\d{2})[./ ](\d{1,2})[./ ](\d{1,2})\b/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = hay.match(/\b(\d{1,2})[./ ](\d{1,2})[./ ](20\d{2}|\d{2})\b/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = hay.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_RE})\\s+(20\\d{2})\\b`, 'i'));
  if (m) return `${m[3]}-${mi(m[2])}-${m[1].padStart(2, '0')}`;
  m = hay.match(new RegExp(`\\b(${MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`, 'i'));
  if (m) return `${m[3]}-${mi(m[1])}-${m[2].padStart(2, '0')}`;
  m = hay.match(new RegExp(`\\b(${MONTH_RE})\\s+(20\\d{2})\\b`, 'i'));
  if (m) return `${m[2]}-${mi(m[1])}-00`;
  m = hay.match(/\b(20\d{2})\b/);
  if (m) return `${m[1]}-00-00`;
  return '';
}

/**
 * The most recent posts linked from a news or blog index: dated links
 * newest first, then the page's own order (a blog lists the latest at the
 * top). A same-site web link counts when it goes deeper than the index
 * (/blog/why-we-raised), or is a news link elsewhere on the site whose
 * text reads like a post; PDFs (press releases) on any host when their
 * name or text says so. Tag, category, author and pagination links are not
 * posts.
 */
export function pickLatestPosts(indexHtml: string, indexUrl: string, n = MAX_ISSUES): string[] {
  const base = new URL(indexUrl);
  const indexPath = base.pathname.replace(/\/+$/, '').toLowerCase();
  const indexKey = (base.origin + indexPath).toLowerCase();
  const seen = new Set<string>([indexKey]);
  const candidates: Array<{ url: string; date: string; order: number }> = [];
  let order = 0;
  for (const l of pageLinks(indexHtml, indexUrl)) {
    const pdf = isPdf(l.abs);
    if (!pdf && !sameSite(l.abs.hostname, base)) continue;
    const hay = `${l.text} ${l.abs.pathname}`;
    if (NOT_A_POST.test(hay)) continue;
    if (/\.(?:jpe?g|png|gif|svg|webp|docx?|xlsx?|pptx?|zip|mp4)(?:\?|$)/i.test(l.abs.pathname)) continue;
    const path = l.abs.pathname.replace(/\/+$/, '').toLowerCase();
    const deeper = indexPath ? path.startsWith(indexPath + '/') && path.length > indexPath.length + 1 : path.split('/').length > 2;
    const looksLikePost = pdf
      ? (NEWS_LINK.test(hay) || POST_HINT.test(l.text) || !!postDateKey(l.text, l.abs.pathname))
      : (deeper || (NEWS_LINK.test(l.abs.pathname) && POST_HINT.test(l.text)));
    if (!looksLikePost) continue;
    const key = (l.abs.origin + l.abs.pathname + l.abs.search).replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ url: l.abs.toString(), date: postDateKey(l.text, l.abs.pathname), order: order++ });
  }
  candidates.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : a.order - b.order));
  return candidates.slice(0, n).map((c) => c.url);
}

export interface NewsFetch {
  pages: SourcePage[];
  notes: { entries: string[]; posts: string[]; fetched: string[]; skipped: Array<{ url: string; why: string }>; ms: number };
}

async function readPost(url: string): Promise<{ text: string | null; why: string }> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { text: null, why: 'bad url' };
  }
  if (isPdf(u)) {
    const got = await fetchBytes(url, PDF_MS, PDF_MAX_BYTES);
    if (!got) return { text: null, why: 'not fetched or over 5 MB' };
    if (!/pdf/i.test(got.contentType) && !(got.bytes[0] === 0x25 && got.bytes[1] === 0x50)) return { text: null, why: 'not a PDF' };
    try {
      return { text: await extractPdfText(got.bytes), why: '' };
    } catch (e) {
      return { text: null, why: `pdf parse failed: ${e instanceof Error ? e.message.slice(0, 60) : e}` };
    }
  }
  const page = await fetchPage(url, PAGE_MS);
  if (!page.ok || !page.html) return { text: null, why: page.error ? page.error.slice(0, 80) : `HTTP ${page.status}` };
  return { text: htmlToText(page.html), why: '' };
}

/** Find and read the latest news and blog posts. Never throws; the notes say what happened. */
export async function fetchNewsPages(opts: { siteUrl: string; homepageHtml: string }): Promise<NewsFetch> {
  const started = Date.now();
  const notes: NewsFetch['notes'] = { entries: [], posts: [], fetched: [], skipped: [], ms: 0 };
  const pages: SourcePage[] = [];
  try {
    const entries = findNewsEntries(opts.homepageHtml, opts.siteUrl);
    notes.entries = entries;
    if (!entries.length) return { pages, notes: { ...notes, ms: Date.now() - started } };
    const posts: string[] = [];
    const seen = new Set<string>();
    const add = (u: string) => {
      const k = u.replace(/\/+$/, '').toLowerCase();
      if (seen.has(k) || posts.length >= MAX_ISSUES) return;
      seen.add(k);
      posts.push(u);
    };
    for (const entry of entries) {
      if (posts.length >= MAX_ISSUES) break;
      if (isPdf(new URL(entry))) { add(entry); continue; }
      const index = await fetchPage(entry, PAGE_MS);
      if (!index.ok || !index.html || looksLikeSoft404(index.html, opts.homepageHtml)) {
        notes.skipped.push({ url: entry, why: index.error ? index.error.slice(0, 80) : index.ok ? 'soft 404' : `HTTP ${index.status}` });
        continue;
      }
      const found = pickLatestPosts(index.html, index.finalUrl, MAX_ISSUES);
      if (found.length) {
        for (const u of found) add(u);
      } else {
        // The page itself may be the news (a single updates page with every post on it).
        const text = htmlToText(index.html);
        if (text.length > 1500) pages.push({ url: index.finalUrl, text: text.slice(0, MAX_ISSUE_CHARS) });
        else notes.skipped.push({ url: entry, why: 'no posts linked' });
      }
    }
    notes.posts = posts;
    const results = await mapWithConcurrency(posts, 2, async (u) => ({ u, ...(await readPost(u)) }));
    for (const r of results) {
      if (r.text && r.text.replace(/\s+/g, ' ').trim().length > 200) {
        pages.push({ url: r.u, text: r.text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').slice(0, MAX_ISSUE_CHARS) });
        notes.fetched.push(r.u);
      } else {
        notes.skipped.push({ url: r.u, why: r.why || 'empty' });
      }
    }
  } catch (e) {
    notes.skipped.push({ url: opts.siteUrl, why: `news pages failed: ${e instanceof Error ? e.message.slice(0, 80) : e}` });
  }
  notes.ms = Date.now() - started;
  return { pages, notes };
}

export const DEPARTURES_SYSTEM = `You read a UK start-up's news and blog pages and record staff departures and arrivals only, each backed by a verbatim quote from the labelled page it came from.

Rules:
- kind is staff_departure (a named member of staff leaving, stepping down, moving to another company or role, retiring, or going on parental leave) or staff_arrival (a named person joining the company, being appointed to a post, or being promoted into one: "Priya Shah joins as Head of People", "we have appointed Tom Reed as CTO").
- statement: one plain sentence in British English naming the person as written, their role when the page gives it, and the date when the page gives it ("Priya Shah, Head of Talent, is leaving in June 2026.").
- quote: copied exactly from the page text, 10 to 300 characters, no paraphrase, no ellipsis. A fact whose quote is not on the page is discarded.
- source_url: the exact URL label of the section the quote is in.
- date_hint: the date the page gives for the departure or arrival ("June 2026", "Q3 2026"), or the post's own date when the text says "this week" or "today", or null.
- Customers, investors, advisers and board members, partners, candidates, and people at other companies do not count. A founder describing how they left a previous employer to start the company is not a departure. A job advert is not a departure.
- Do not invent, infer or combine. If there is nothing, return an empty list. At most 12.`;

export const DEPARTURES_TOOL = {
  type: 'function',
  function: {
    name: 'record_staff_changes',
    description: 'Record staff departures and arrivals with verbatim quotes.',
    parameters: {
      type: 'object',
      properties: {
        facts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['staff_departure', 'staff_arrival'] },
              statement: { type: 'string', description: 'One sentence naming the person and role.' },
              quote: { type: 'string', description: 'Verbatim from the page text, 10 to 300 characters.' },
              source_url: { type: 'string', description: 'The URL label of the section the quote is in.' },
              date_hint: { type: 'string', description: 'Date given by the page, or empty.' },
            },
            required: ['kind', 'statement', 'quote', 'source_url'],
          },
        },
      },
      required: ['facts'],
    },
  },
};

export interface DeparturesOutput {
  facts: RawFact[];
  usage: { provider: 'gemini'; model: string; inputTokens: number; outputTokens: number; cachedInputTokens: number; durationMs: number };
}

export function buildDeparturesMessage(companyName: string, pages: SourcePage[], postDates?: string): string {
  const sections = pages.map((p) => `\n\n=== PAGE ${p.url} ===\n${p.text.trim()}`).join('');
  return [
    `Company: ${companyName}`,
    postDates ? `Post dates: ${postDates}` : '',
    'NEWS TEXT (each section is labelled with its URL; quote only from these sections and cite the label):',
    sections.trim(),
  ].filter(Boolean).join('\n\n');
}

/** One Gemini call for the departures and arrivals in the news pages. Throws ExtractionQuotaError on 429. */
export async function extractDepartures(companyName: string, pages: SourcePage[]): Promise<DeparturesOutput> {
  const started = Date.now();
  const text = buildDeparturesMessage(companyName, pages);
  const MAX = 2;
  let response: Response | null = null;
  for (let attempt = 1; attempt <= MAX; attempt++) {
    response = await chatCompletion({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: DEPARTURES_SYSTEM },
        { role: 'user', content: text },
      ],
      tools: [DEPARTURES_TOOL],
      tool_choice: { type: 'function', function: { name: 'record_staff_changes' } },
      max_tokens: 3000,
    });
    if (response.ok) break;
    const body = await response.text();
    console.error(`Departures pass: AI API error (attempt ${attempt}/${MAX}):`, response.status, body.slice(0, 200));
    if (response.status === 429) {
      if (attempt < MAX) { await new Promise((r) => setTimeout(r, 15000)); continue; }
      throw new ExtractionQuotaError('AI rate limit exceeded (departures pass)');
    }
    if (response.status === 402) throw new ExtractionQuotaError('AI API billing error (402)');
    if (response.status >= 500 && attempt < MAX) { await new Promise((r) => setTimeout(r, 4000)); continue; }
    throw new Error(`AI API error: ${response.status}`);
  }
  if (!response || !response.ok) throw new Error('AI API failed after all retries (departures pass)');
  const data = await response.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.function?.name !== 'record_staff_changes') throw new Error('Unexpected AI response format (no record_staff_changes call)');
  let facts: RawFact[] = [];
  try {
    const args = toolCall.function.arguments;
    const obj = typeof args === 'string' ? JSON.parse(args) : args;
    facts = Array.isArray(obj?.facts) ? obj.facts : [];
  } catch {
    throw new Error('AI returned invalid JSON for record_staff_changes');
  }
  facts = facts.filter((f) => f && (f.kind === 'staff_departure' || f.kind === 'staff_arrival'));
  return {
    facts,
    usage: {
      provider: 'gemini',
      model: resolveModel('google/gemini-2.5-flash'),
      inputTokens: Number(data.usage?.prompt_tokens ?? 0),
      outputTokens: Number(data.usage?.completion_tokens ?? 0),
      cachedInputTokens: Number(data.usage?.prompt_tokens_details?.cached_tokens ?? 0),
      durationMs: Date.now() - started,
    },
  };
}
