#!/usr/bin/env node
// Analyse a website that refuses every connection from Supabase (edge
// functions and pg_net alike) or answers every server with a Cloudflare
// "just a moment" page, while it loads fine from an ordinary machine
// (29 September 2026, matching He-Giveth's route of the same day).
//
// From the operator's machine: fetch the homepage with a normal browser
// User-Agent, pick up to MAX_PAGES internal links whose path mentions
// contact, team, leadership, careers, news, about and the like (no files,
// feeds or query strings), fetch those, seed each page into
// net._http_response with a high reserved id (SEED_BASE upwards, never
// pg_net's own range), call analyze-company through pg_net with
// { url, companyName, companyNumber?, prefetch, prefetchOnly: true }
// (plus isRefresh and companyId when the row exists), wait for the reply,
// insert or update the company_searches row from it, then delete the
// seeded rows. Sites run one at a time.
//
//   SUPABASE_ACCESS_TOKEN=... node scripts/analyse-blocked-site.mjs \
//     --url https://example.com --name "Example Ltd" [--number 12345678] [--max-pages 16] [--url ... --name ...]
//
// SUPABASE_PROJECT_REF defaults to the TA Searcher project. Every SQL
// statement goes through the Management API's database/query endpoint,
// like scripts/sb-sql.sh.

const REF = process.env.SUPABASE_PROJECT_REF || 'onlnizycknfuuprsmypl';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('SUPABASE_ACCESS_TOKEN is not set'); process.exit(2); }

const SEED_BASE = 9_000_000_000_000;
const DEFAULT_MAX_PAGES = 16;
const PAGE_CAP = 900_000; // chars kept per page (the analyser reads about 1 MB)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-GB,en;q=0.9' };
const WANTED_PATH = /contact|staff|team|people|leadership|founders?|management|board|governors?|vacanc|jobs?|careers?|hiring|work-with-us|join|news|blog|press|about|who-we-are|our-story|company|welcome|head|key-information|mission|values/i;
const SKIP_PATH = /\.(pdf|docx?|xlsx?|pptx?|zip|jpe?g|png|gif|svg|webp|ico|css|js|mp4|mp3|xml|rss|atom|json|txt)$|\/(feed|rss|wp-json|wp-content|wp-includes|cdn-cgi)\b|^mailto:|^tel:|^javascript:/i;
const WAIT_MS = 6 * 60_000;
// The paths the analyser's crawler guesses at on every site (_shared/contacts/pages.ts): probed too, and seeded when they answer.
const GUESSED_PATHS = ['/contact', '/contact-us', '/get-in-touch', '/team', '/about', '/about-us', '/company', '/people', '/leadership', '/founders', '/careers', '/jobs', '/join', '/join-us', '/blog', '/news', '/press', '/customers'];

function parseArgs(argv) {
  const sites = [];
  let cur = null;
  let maxPages = DEFAULT_MAX_PAGES;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === '--url') { cur = { url: v, name: null, number: null }; sites.push(cur); i++; }
    else if (a === '--name') { if (!cur) throw new Error('--name before --url'); cur.name = v; i++; }
    else if (a === '--number') { if (!cur) throw new Error('--number before --url'); cur.number = v; i++; }
    else if (a === '--max-pages') { maxPages = Math.max(1, Math.min(40, Number(v) || DEFAULT_MAX_PAGES)); i++; }
    else throw new Error(`unknown argument ${a}`);
  }
  if (!sites.length) throw new Error('give at least one --url');
  return { sites, maxPages };
}

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : [];
}

/** Dollar-quote a string for SQL with a tag the string does not contain. */
function dq(s) {
  let tag = 'q';
  while (s.includes(`$${tag}$`)) tag += Math.random().toString(36).slice(2, 6);
  return `$${tag}$${s}$${tag}$`;
}
const lit = (s) => (s === null || s === undefined ? 'null' : dq(String(s)));

async function getPage(url, ms = 20_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: ctrl.signal });
    const type = res.headers.get('content-type') || '';
    const html = res.ok && /text\/html|application\/xhtml/i.test(type) ? await res.text() : '';
    return { url, finalUrl: res.url || url, status: res.status, ok: res.ok && !!html, html: html.slice(0, PAGE_CAP), type: type.split(';')[0] || 'text/html' };
  } catch (e) {
    return { url, finalUrl: url, status: 0, ok: false, html: '', type: 'text/html', error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(t);
  }
}

/** Same-host links whose path looks like a page worth reading, in page order, deduplicated. */
function pickLinks(homeUrl, html, max) {
  const base = new URL(homeUrl);
  const host = base.hostname.replace(/^www\./, '');
  const seen = new Set([homeUrl.replace(/\/+$/, '').toLowerCase()]);
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"'#]+)["']/gi)) {
    let u;
    try { u = new URL(m[1].trim(), base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    if (u.hostname.replace(/^www\./, '') !== host) continue;
    if (u.search) continue;
    if (SKIP_PATH.test(u.pathname) || SKIP_PATH.test(m[1])) continue;
    if (!WANTED_PATH.test(u.pathname)) continue;
    u.hash = '';
    const key = u.toString().replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u.toString());
    if (out.length >= max) break;
  }
  return out;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

async function runSite(site, maxPages) {
  const started = Date.now();
  console.log(`\n== ${site.name || site.url}`);
  const home = await getPage(site.url);
  if (!home.ok) throw new Error(`homepage ${site.url} -> HTTP ${home.status}${home.error ? ` (${home.error})` : ''}; nothing to seed`);
  const linked = pickLinks(home.finalUrl, home.html, maxPages);
  const origin = new URL(home.finalUrl).origin;
  const have = new Set(linked.map((u) => u.replace(/\/+$/, '').toLowerCase()));
  const guessed = GUESSED_PATHS.map((p) => origin + p).filter((u) => !have.has(u.toLowerCase()));
  const links = [...linked, ...guessed];
  console.log(`homepage ${home.finalUrl} (${home.html.length} chars); ${linked.length} linked page(s) chosen, ${guessed.length} guessed path(s) probed`);
  const pages = (await mapLimit(links, 3, (u) => getPage(u))).filter((p) => p.ok);
  console.log(`${pages.length} of ${links.length} answered as HTML`);

  // The row, if the company is already tracked (by URL, either scheme, with or without www).
  const hostKey = new URL(home.finalUrl).hostname.replace(/^www\./, '').toLowerCase();
  const existing = await sql(`select id, company_name, company_number, url from company_searches where lower(regexp_replace(url, '^https?://(www\\.)?', '')) like ${lit(hostKey + '%')} order by created_at limit 1`);
  const row = existing[0] || null;
  const url = row?.url || site.url;
  const companyName = site.name || row?.company_name || null;
  const companyNumber = site.number || row?.company_number || null;

  // Seed the pages. A high reserved range, offset by the clock so two runs a
  // second apart never collide; one insert per page (the bodies are large).
  const idBase = SEED_BASE + (Date.now() % 1_000_000_000) * 100;
  const seeded = [];
  const all = [{ ...home, url }, ...pages];
  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    const id = idBase + i;
    await sql(`insert into net._http_response (id, status_code, content_type, headers, content, timed_out, error_msg, created) values (${id}, 200, ${lit(p.type)}, ${lit(JSON.stringify({ 'content-type': p.type }))}::jsonb, ${lit(p.html)}, false, null, now())`);
    seeded.push({ id, url: p.url });
    if (p.finalUrl && p.finalUrl !== p.url) seeded.push({ id, url: p.finalUrl });
  }
  const prefetch = Object.fromEntries(seeded.map((s) => [s.url, s.id]));
  const ids = Array.from(new Set(seeded.map((s) => s.id)));
  console.log(`seeded ${ids.length} page(s) as net._http_response ids ${ids[0]}..${ids[ids.length - 1]}`);

  try {
    const payload = { url, companyName, companyNumber, prefetch, prefetchOnly: true, ...(row ? { isRefresh: true, companyId: row.id } : {}) };
    const [{ id: reqId }] = await sql(`select public.invoke_edge_function('analyze-company', ${lit(JSON.stringify(payload))}::jsonb) as id`);
    console.log(`analyze-company queued through pg_net as request ${reqId}${row ? ` (refresh of ${row.id})` : ' (new company)'}; waiting…`);
    const deadline = Date.now() + WAIT_MS;
    let reply = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));
      const rows = await sql(`select status_code, content, error_msg, timed_out from net._http_response where id = ${reqId}`);
      if (rows[0]) { reply = rows[0]; break; }
    }
    if (!reply) throw new Error(`no reply from analyze-company within ${WAIT_MS / 60000} minutes`);
    if (reply.error_msg || reply.timed_out) throw new Error(`pg_net: ${reply.error_msg || 'timed out'}`);
    let body;
    try { body = JSON.parse(reply.content || '{}'); } catch { body = { error: `unparseable reply: ${String(reply.content).slice(0, 200)}` }; }
    if (reply.status_code !== 200 || body.error) throw new Error(`analyze-company HTTP ${reply.status_code}: ${body.error || 'no detail'}${body.degraded ? ' (degraded)' : ''}`);

    const contacts = Array.isArray(body.decisionMakers) ? body.decisionMakers.length : 0;
    const roles = body.recruitmentInsights?.currentVacancies?.length ?? 0;
    const pagesRead = body.contactsRun?.pagesFetched?.length ?? null;
    const via = body.notes?.homepage?.via || body.vacancyRun?.degraded === false ? 'ok' : 'unknown';
    if (row) {
      // The analyser updates the row itself on a refresh; confirm it did.
      const [after] = await sql(`select updated_at from company_searches where id = ${lit(row.id)}`);
      console.log(`row ${row.id} updated at ${after?.updated_at}`);
    } else {
      const name = body.companyRecord?.name || companyName || hostKey;
      const ins = await sql(`insert into company_searches (url, company_number, company_name, analysis_result) values (${lit(url)}, ${lit(companyNumber)}, ${lit(name)}, ${lit(JSON.stringify(body))}::jsonb) on conflict (url) do update set company_name = excluded.company_name, company_number = coalesce(excluded.company_number, company_searches.company_number), analysis_result = excluded.analysis_result, updated_at = now() returning id`);
      console.log(`row ${ins[0]?.id} written for ${name}`);
    }
    console.log(`done in ${Math.round((Date.now() - started) / 1000)} s: ${contacts} contact(s), ${roles} role(s), ${pagesRead ?? '?'} page(s) read, degraded ${body.vacancyRun?.degraded ?? 'unknown'}, via ${via}`);
  } finally {
    await sql(`delete from net._http_response where id in (${ids.join(',')})`);
    console.log(`seeded rows deleted`);
  }
}

const { sites, maxPages } = parseArgs(process.argv.slice(2));
let failed = 0;
for (const site of sites) {
  try { await runSite(site, maxPages); } catch (e) { failed++; console.error(`FAILED ${site.url}: ${e instanceof Error ? e.message : String(e)}`); }
}
process.exit(failed ? 1 : 0);
