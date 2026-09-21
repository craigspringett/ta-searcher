// HTTP helpers shared by the scraping code: every outbound fetch has a timeout
// and a browser-like User-Agent, soft-404 and parked pages can be recognised,
// and a homepage can be reached through scheme / www variants when the stored
// URL is stale.
//
// Investigation of 8 September 2026 (107 companies whose homepage failed in the
// 05:05 refresh, probed from the edge runtime with a throwaway function):
//   - 55 hosts no longer exist in DNS; nothing to fetch.
//   - Every "Connection reset by peer" host is on IONOS shared hosting
//     (AS8560) and every 15 s timeout is on London Grid for Learning
//     (AS60187): those providers drop Supabase's AWS addresses on port 443
//     whatever the User-Agent. Several of them still answer on plain http,
//     or on the bare host without www, and some redirect from there to the
//     company's new domain.
//   - Three sites returned 403 to "Mozilla/5.0 (compatible; HeGiveth/1.0 ...)"
//     and 200 to a browser User-Agent; one hung on the bot User-Agent only.
//     Cloudflare "Just a moment" challenges block every User-Agent.
// Hence the browser-style User-Agent (still carrying the HeGiveth token) and
// fetchHomepage's fallback ladder below.
//
// Investigation of 10 September 2026 (Phase 6, slice 0: 15 companies whose
// address Craig confirmed but whose homepage the nightly run could not
// fetch, probed from the edge runtime and through pg_net):
//   - The edge runtime gets "client error (Connect): Connection reset by
//     peer (os error 104)" within 70 to 130 ms, on https and on http, with
//     the default headers and with a plain browser's: the hosting platform
//     (the same one for Christ's College Finchley, Oak Wood and Pelham
//     Primary, whose pages begin "<!-- from CSV -->") drops Supabase's edge
//     addresses at the TCP level.
//   - pg_net from the database server (a different network and address)
//     gets 200 from the same URLs in one to three seconds, as long as no
//     User-Agent is given: all sixteen affected sites are on that one
//     platform, whose IIS front end answers "400 Bad Request - Invalid
//     Header" or drops the TLS connection when net.http_get carries a
//     User-Agent (it reaches the server as a second User-Agent line).
//     Accept and Accept-Language alone work; http_page_enqueue sends those.
//   - pg_net sends one batch of requests and starts the next only when the
//     whole batch has finished, and during the nightly refresh the batch
//     holds the dispatcher's POSTs to analyze-company, so a page asked for
//     mid-batch waits up to about two minutes; fetchViaDatabase waits that
//     long once per run and the other variants skip it.
// Hence the ladder in fetchPage: a connection-level failure is retried once
// with a plain browser's headers, then, when analyze-company has registered
// the database fetcher (configureDatabaseFetch), the page is fetched by the
// database through http_page_enqueue / http_page_result (migration
// 20260910180000, 1 MB and 20 s at most). Which path answered is recorded
// in `via` and reaches the run notes.

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 HeGiveth/1.0 (+https://whofoundwho.co.uk)';
/** The Phase 1 User-Agent. Some firewalls refuse a Chrome-like agent without browser headers but accept an honest bot one (Kingsdale, 8 September 2026). */
export const LEGACY_USER_AGENT = 'Mozilla/5.0 (compatible; HeGiveth/1.0; +https://whofoundwho.co.uk)';

/** A plain browser's headers, without the HeGiveth token, for the second try after a connection-level failure. */
export const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
};

export type FetchPath = 'edge' | 'edge-browser' | 'database';

/** A failure before any HTTP answer: DNS, TCP, TLS, a reset or a timeout. */
export function isConnectionLevelError(message: string | undefined): boolean {
  return !!message && /error sending request|connection reset|connect(?:ion)? (?:refused|closed|timed out)|dns error|failed to lookup|tls|handshake|certificate|timeout after|unexpected eof|broken pipe|network unreachable|os error/i.test(message);
}

// deno-lint-ignore no-explicit-any
type DatabaseClient = any;
let databaseClient: DatabaseClient | null = null;
/** Set once a database fetch got no answer in time this invocation, so the other variants do not wait again. */
let databaseBusy = false;
/** Pages the dispatcher fetched through pg_net before this run started: URL to pg_net request id. */
let prefetched = new Map<string, number>();
/** Deferred mode: this run was dispatched by pg_net itself, so a fresh pg_net request cannot be answered until the run ends; note the page and let the next pass fetch it. */
let deferMode = false;
const wanted = new Set<string>();
const WANTED_CAP = 60;

function pageKey(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '');
}

export interface DatabaseFetchOptions {
  prefetched?: Record<string, number> | null;
  defer?: boolean;
}

/**
 * Register a service-role client so fetchPage can fall back to the
 * database's pg_net, with the pages the dispatcher prefetched for this run
 * and whether fresh requests must be deferred to the next pass.
 */
export function configureDatabaseFetch(client: DatabaseClient | null, options: DatabaseFetchOptions = {}): void {
  databaseClient = client;
  databaseBusy = false;
  deferMode = !!options.defer;
  prefetched = new Map(Object.entries(options.prefetched || {}).map(([u, id]) => [pageKey(u), Number(id)]));
  wanted.clear();
}

/** The pages this run could not fetch and wants the next pass to prefetch (deferred mode). */
export function wantedPages(): string[] {
  return Array.from(wanted);
}

/** A connection-level failure that another network might get past (a reset or a refusal, not a host that does not exist). */
export function isRetryableViaDatabase(message: string | undefined): boolean {
  return isConnectionLevelError(message) && !/dns error|failed to lookup|name or service not known|no such host/i.test(message || '');
}

/** pg_net's own limit on a request. */
const DATABASE_FETCH_MAX_MS = 20000;
/**
 * How long to wait for pg_net to answer. pg_net sends one batch of requests
 * and starts the next only when every request in the batch has finished;
 * during the nightly refresh the batch holds the dispatcher's POSTs to
 * analyze-company (30 to 120 s each), so a page asked for mid-batch is sent
 * only when that batch ends.
 */
const DATABASE_FETCH_WAIT_MS = 110_000;

/** Fetch a page through pg_net (see the investigation above); never throws. */
export async function fetchViaDatabase(url: string, ms: number): Promise<FetchedPage> {
  const started = Date.now();
  if (!databaseClient) return { url, finalUrl: url, status: 0, ok: false, html: '', error: 'no database fetcher configured', ms: 0, via: 'database' };
  const pre = prefetched.get(pageKey(url));
  if (pre === undefined) {
    if (deferMode) {
      if (wanted.size < WANTED_CAP) wanted.add(url);
      return { url, finalUrl: url, status: 0, ok: false, html: '', error: 'deferred: the next pass fetches it through the database', ms: 0, via: 'database' };
    }
    if (databaseBusy) return { url, finalUrl: url, status: 0, ok: false, html: '', error: 'database fetch skipped: no answer earlier this run', ms: 0, via: 'database' };
  }
  const budget = Math.min(Math.max(ms, 5000), DATABASE_FETCH_MAX_MS);
  try {
    let id = pre;
    if (id === undefined) {
      const { data, error } = await databaseClient.rpc('http_page_enqueue', { p_url: url, p_timeout_ms: budget });
      if (error || !data) return { url, finalUrl: url, status: 0, ok: false, html: '', error: `http_page_enqueue: ${error?.message || 'no id'}`, ms: Date.now() - started, via: 'database' };
      id = Number(data);
    }
    // A prefetched page is already answered (the dispatcher waits for it); a fresh one waits for pg_net's batch to turn over.
    const deadline = Date.now() + (pre !== undefined ? 8000 : DATABASE_FETCH_WAIT_MS);
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      const { data, error: e2 } = await databaseClient.rpc('http_page_result', { p_id: id });
      if (e2) return { url, finalUrl: url, status: 0, ok: false, html: '', error: `http_page_result: ${e2.message}`, ms: Date.now() - started, via: 'database' };
      if (!data) continue;
      const r = data as { status: number | null; content: string | null; error: string | null; truncated?: boolean };
      if (r.error) return { url, finalUrl: url, status: 0, ok: false, html: '', error: `database: ${r.error}`, ms: Date.now() - started, via: 'database' };
      const status = Number(r.status || 0);
      const ok = status >= 200 && status < 300;
      return { url, finalUrl: url, status, ok, html: ok ? r.content || '' : '', ms: Date.now() - started, via: 'database', error: r.truncated ? 'body cut at 1 MB' : undefined };
    }
    if (pre === undefined) databaseBusy = true;
    return { url, finalUrl: url, status: 0, ok: false, html: '', error: pre !== undefined ? 'database: the prefetched page has no answer' : `database: no answer within ${DATABASE_FETCH_WAIT_MS} ms`, ms: Date.now() - started, via: 'database' };
  } catch (e) {
    return { url, finalUrl: url, status: 0, ok: false, html: '', error: `database: ${e instanceof Error ? e.message : String(e)}`, ms: Date.now() - started, via: 'database' };
  }
}

export async function fetchWithTimeout(url: string, ms: number, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout after ${ms}ms`)), ms);
  try {
    const headers = new Headers(init.headers ?? {});
    if (!headers.has('User-Agent')) headers.set('User-Agent', DEFAULT_USER_AGENT);
    if (!headers.has('Accept')) headers.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
    if (!headers.has('Accept-Language')) headers.set('Accept-Language', 'en-GB,en;q=0.9');
    return await fetch(url, { ...init, headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface FetchedPage {
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  html: string;
  error?: string;
  ms: number;
  /** Which path answered (or was tried last): the edge runtime, the edge with a plain browser's headers, or the database's pg_net. */
  via?: FetchPath;
}

/**
 * Fetch a page as text, never throwing. A 403 is retried once with the
 * legacy User-Agent. A connection-level failure (reset, refused, DNS, TLS,
 * timeout) is retried once with a plain browser's headers and then, when a
 * database fetcher is registered, through pg_net.
 */
export async function fetchPage(url: string, ms: number, init: RequestInit = {}): Promise<FetchedPage> {
  const started = Date.now();
  const customAgent = new Headers(init.headers ?? {}).has('User-Agent');
  try {
    let res = await fetchWithTimeout(url, ms, init);
    if (res.status === 403 && !customAgent) {
      await res.body?.cancel().catch(() => {});
      const headers = new Headers(init.headers ?? {});
      headers.set('User-Agent', LEGACY_USER_AGENT);
      res = await fetchWithTimeout(url, ms, { ...init, headers });
    }
    const html = res.ok ? await res.text() : '';
    return { url, finalUrl: res.url || url, status: res.status, ok: res.ok, html, ms: Date.now() - started, via: 'edge' };
  } catch (e) {
    const first = e instanceof Error ? e.message : String(e);
    if (!isConnectionLevelError(first) || customAgent) return { url, finalUrl: url, status: 0, ok: false, html: '', error: first, ms: Date.now() - started, via: 'edge' };
    // Second try: a plain browser's headers (a few firewalls key on the token).
    try {
      const headers = new Headers(init.headers ?? {});
      for (const [k, v] of Object.entries(BROWSER_HEADERS)) headers.set(k, v);
      const res = await fetchWithTimeout(url, Math.min(ms, 8000), { ...init, headers });
      const html = res.ok ? await res.text() : '';
      return { url, finalUrl: res.url || url, status: res.status, ok: res.ok, html, ms: Date.now() - started, via: 'edge-browser' };
    } catch (e2) {
      const second = e2 instanceof Error ? e2.message : String(e2);
      // Third: the database's own network (not for a host that does not exist).
      if (databaseClient && isRetryableViaDatabase(first)) {
        const viaDb = await fetchViaDatabase(url, ms);
        if (viaDb.ok || viaDb.status > 0) return { ...viaDb, ms: Date.now() - started };
        return { url, finalUrl: url, status: 0, ok: false, html: '', error: `${first}; browser headers: ${second}; ${viaDb.error}`, ms: Date.now() - started, via: 'database' };
      }
      return { url, finalUrl: url, status: 0, ok: false, html: '', error: `${first}; browser headers: ${second}`, ms: Date.now() - started, via: 'edge-browser' };
    }
  }
}

/** Fetch a binary resource (PDF) as bytes, never throwing; null when too large or failed. */
export async function fetchBytes(url: string, ms: number, maxBytes: number): Promise<{ bytes: Uint8Array; finalUrl: string; contentType: string } | null> {
  try {
    const res = await fetchWithTimeout(url, ms, { headers: { Accept: 'application/pdf,*/*;q=0.8' } });
    if (!res.ok) return null;
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > maxBytes) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) return null;
    return { bytes: buf, finalUrl: res.url || url, contentType: res.headers.get('content-type') || '' };
  } catch {
    return null;
  }
}

export function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim().toLowerCase() : '';
}

function bodyFingerprint(html: string): string {
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  return body
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when `html` is really the homepage served under another path
 * (identical body, or identical <title>), or an obvious "not found" page
 * served with HTTP 200.
 */
export function looksLikeSoft404(html: string, homepageHtml: string): boolean {
  if (!html) return true;
  const t = extractTitle(html);
  if (/\b(page not found|404|not found|no longer available)\b/.test(t)) return true;
  if (!homepageHtml) return false;
  if (bodyFingerprint(html) === bodyFingerprint(homepageHtml)) return true;
  const ht = extractTitle(homepageHtml);
  if (t && ht && t === ht) return true;
  return false;
}

/** A parked domain, a hosting default page or a bot challenge is not a company website. */
export function looksParked(html: string): boolean {
  if (!html) return true;
  const t = extractTitle(html);
  if (/\b(is for sale|domain (?:for sale|parking|parked)|hugedomains|sedo|iis windows server|apache2 .*default|welcome to nginx|just a moment|attention required|access denied|site not found|account suspended|coming soon)\b/.test(t)) return true;
  const text = htmlToText(html.slice(0, 20000)).toLowerCase();
  if (text.length < 200 && /domain|for sale|parked|coming soon|suspended/.test(text)) return true;
  return false;
}

export interface HomepageFetch {
  page: FetchedPage;
  /** The URL that finally answered (after the fallback ladder), or the stored URL when nothing did. */
  urlUsed: string;
  /** True when the stored URL itself failed and a scheme / www variant answered instead. */
  usedVariant: boolean;
  /** The variants tried, in order, with what happened. */
  attempts: Array<{ url: string; status: number; error?: string; ms: number; via?: FetchPath }>;
}

/** Scheme and www variants of a URL, the stored one first. */
export function homepageVariants(storedUrl: string): string[] {
  let u: URL;
  try {
    u = new URL(storedUrl);
  } catch {
    return [storedUrl];
  }
  const bare = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/+$/, '') : '';
  const hosts = u.hostname.toLowerCase().startsWith('www.') ? [`www.${bare}`, bare] : [bare, `www.${bare}`];
  const schemes = u.protocol === 'http:' ? ['http', 'https'] : ['https', 'http'];
  const out: string[] = [];
  // Same host, other scheme first (IONOS / LGfL drop 443 but answer 80), then the other host.
  for (const h of hosts) for (const s of schemes) out.push(`${s}://${h}${path}/`);
  return Array.from(new Set(out));
}

/**
 * Fetch a company's homepage, falling back through scheme and www variants
 * when the stored URL does not answer. A 403 / 404 / 410 / 5xx on the stored
 * URL is also retried through the ladder (three sites moved domains and only
 * the bare host still redirects).
 */
export async function fetchHomepage(
  storedUrl: string,
  ms = 12000,
  variantMs = 8000,
  fetcher: (url: string, ms: number) => Promise<FetchedPage> = fetchPage,
): Promise<HomepageFetch> {
  const variants = homepageVariants(storedUrl);
  const attempts: HomepageFetch['attempts'] = [];
  let first: FetchedPage | null = null;
  for (let i = 0; i < variants.length; i++) {
    const page = await fetcher(variants[i], i === 0 ? ms : variantMs);
    const parked = page.ok && !!page.html && looksParked(page.html);
    const usable = page.ok && !!page.html && !parked;
    attempts.push({ url: variants[i], status: page.status, error: page.error ?? (parked ? 'parked or challenge page' : undefined), ms: page.ms, via: page.via });
    if (usable) return { page, urlUsed: variants[i], usedVariant: i > 0, attempts };
    // A parked page or a hosting default page is not the company's website:
    // when every variant fails, the run must be degraded rather than proceed
    // on it (and close the company's open website vacancies).
    if (i === 0) first = parked ? { ...page, ok: false, error: page.error ?? 'parked or challenge page' } : page;
  }
  return { page: first!, urlUsed: storedUrl, usedVariant: false, attempts };
}

/** Strip tags, scripts and styles; decode the common entities; collapse whitespace. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h[1-6]>|<\/div>|<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8211;|&ndash;/g, '-')
    .replace(/&#8217;|&rsquo;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
