// Contact extraction from company web pages: email addresses (before the HTML
// is stripped, so mailto: links and obfuscated forms survive), people with
// roles from the common team-page structures (card grids, tables, definition
// lists, "Role: Name" lines), and the company phone number.
//
// Nothing in here constructs an address. Every email returned was present on
// the page in some encoded form; the `how` field says which.

import { htmlToText } from '../fetch.ts';

export type EmailHow = 'mailto' | 'text' | 'entity' | 'cfemail' | 'obfuscated' | 'js';

export interface EmailHit {
  email: string;
  /** About 200 characters of visible text around the address, link text included. */
  context: string;
  source_url: string;
  linkText?: string;
  how: EmailHow;
}

export interface PersonHit {
  name: string;
  role: string;
  /** The row, card or line the person was found in. */
  context: string;
  /** Set when an address sat in the same table row or card. */
  email?: string;
  source_url: string;
}

export interface PhoneHit {
  phone: string;
  context: string;
  source_url: string;
}

// ---------------------------------------------------------------------------
// Decoding helpers

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', commat: '@', period: '.', colon: ':', lpar: '(', rpar: ')', lsqb: '[', rsqb: ']',
  ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: '...', copy: '(c)',
};

/** Decode numeric and the common named HTML entities. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED_ENTITIES[n.toLowerCase()] ?? m);
}

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 9 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** Cloudflare email-protection: first byte is the XOR key for the rest. */
export function decodeCfEmail(hex: string): string | null {
  const h = (hex || '').trim();
  if (h.length < 4 || h.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(h)) return null;
  const key = parseInt(h.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < h.length; i += 2) out += String.fromCharCode(parseInt(h.slice(i, i + 2), 16) ^ key);
  return /^[^@\s]+@[^@\s]+$/.test(out) ? out : null;
}

const EMAIL_RE = /[a-z0-9][a-z0-9._%+'-]*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+/gi;
const EMAIL_EXACT = /^[a-z0-9][a-z0-9._%+'-]*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

const BAD_DOMAINS = /(^|\.)(example\.(com|org|net)|domain\.com|email\.com|yourdomain\.com|sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|w3\.org|schema\.org|googleapis\.com|gravatar\.com|company\.com|acme\.com|startup\.com)$/i;
const BAD_LOCAL = /^(user|you|your|yourname|name|email|someone|firstname\.lastname|first\.last|example|test|username|xxx|abc|noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|webmaster|hostmaster|wordpress)$/i;
const ASSET_RE = /\.(png|jpe?g|gif|svg|webp|css|js|ico|woff2?|ttf|pdf|mp4)$/i;

/** Lower-case, trim punctuation, and reject the obvious non-addresses. */
export function normaliseEmail(raw: string): string | null {
  let e = decodeEntities(raw || '').trim().toLowerCase();
  e = e.replace(/^mailto:/, '').split('?')[0].replace(/^[\s"'<(\[{]+|[\s"'>)\]}.,;:]+$/g, '');
  if (!EMAIL_EXACT.test(e)) return null;
  if (e.length > 80) return null;
  const [local, domain] = e.split('@');
  if (ASSET_RE.test(local) || ASSET_RE.test(domain) || /@\d+x$/.test(e) || /^\d+x$/.test(local)) return null;
  if (BAD_DOMAINS.test(domain) || BAD_LOCAL.test(local)) return null;
  if (/^[0-9.]+$/.test(domain)) return null;
  if (!/\.[a-z]{2,}$/.test(domain)) return null;
  return e;
}

// ---------------------------------------------------------------------------
// Pre-processing: turn every encoded address into a literal one in the HTML

/** Expand cfemail, javascript:mt(), http://user@host hrefs and entity-encoded addresses into plain text. */
export function expandObfuscatedHtml(html: string): { html: string; jsEmails: string[]; hows: Map<string, EmailHow> } {
  const hows = new Map<string, EmailHow>();
  let out = html;

  // Cloudflare: href="/cdn-cgi/l/email-protection#HEX" and <span data-cfemail="HEX">[email protected]</span>
  out = out.replace(/href=(["'])[^"']*\/cdn-cgi\/l\/email-protection#([0-9a-f]+)\1/gi, (m, q, hex) => {
    const e = decodeCfEmail(hex);
    if (!e) return m;
    hows.set(e.toLowerCase(), 'cfemail');
    return `href=${q}mailto:${e}${q}`;
  });
  out = out.replace(/<([a-z]+)([^>]*)data-cfemail=(["'])([0-9a-f]+)\3([^>]*)>\s*\[email(?:&#160;|&nbsp;|\s)*protected\]\s*<\/\1>/gi, (m, tag, pre, _q, hex, post) => {
    const e = decodeCfEmail(hex);
    if (!e) return m;
    hows.set(e.toLowerCase(), 'cfemail');
    return `<${tag}${pre}${post}>${e}</${tag}>`;
  });
  out = out.replace(/data-cfemail=(["'])([0-9a-f]+)\1/gi, (m, _q, hex) => {
    const e = decodeCfEmail(hex);
    if (!e) return m;
    hows.set(e.toLowerCase(), 'cfemail');
    return `data-email="${e}"`;
  });

  // javascript:mt('user','domain', ...) and similar helpers.
  out = out.replace(/href=(["'])javascript:[a-z_$][\w$]*\(\s*'([a-z0-9._%+-]+)'\s*,\s*'([a-z0-9.-]+\.[a-z]{2,})'[^"']*\1/gi, (_m, q, local, domain) => {
    hows.set(`${local}@${domain}`.toLowerCase(), 'js');
    return `href=${q}mailto:${local}@${domain}${q}`;
  });

  // href="http://user@example.sch.uk" (a mistyped mailto)
  out = out.replace(/href=(["'])https?:\/\/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\/?\1/gi, (_m, q, addr) => `href=${q}mailto:${addr}${q}`);

  // JavaScript concatenation: 'name' + '@' + 'domain' or "name@" + "domain"
  const jsEmails: string[] = [];
  const scripts = out.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const s of scripts) {
    const re1 = /(["'])([a-z0-9._%+-]+)\1\s*\+\s*(["'])@\3\s*\+\s*(["'])([a-z0-9.-]+\.[a-z]{2,})\4/gi;
    const re2 = /(["'])([a-z0-9._%+-]+@)\1\s*\+\s*(["'])([a-z0-9.-]+\.[a-z]{2,})\3/gi;
    const re3 = /(["'])([a-z0-9._%+-]+)\1\s*\+\s*(["'])@([a-z0-9.-]+\.[a-z]{2,})\3/gi;
    let m: RegExpExecArray | null;
    while ((m = re1.exec(s)) !== null) jsEmails.push(`${m[2]}@${m[5]}`);
    while ((m = re2.exec(s)) !== null) jsEmails.push(`${m[2]}${m[4]}`);
    while ((m = re3.exec(s)) !== null) jsEmails.push(`${m[2]}@${m[4]}`);
  }
  for (const e of jsEmails) hows.set(e.toLowerCase(), 'js');

  // Entity-encoded addresses (&#64;, &commat;, &#46;): decode entities that
  // sit inside an address-shaped run. Decoding the whole document would turn
  // &lt;script&gt; into markup, so only local/at/domain runs are touched.
  // Only when an encoded "@" or "." is present at all, and with bounded runs,
  // so a page full of minified script cannot make this quadratic.
  if (/&#64;|&#x40;|&commat;|&#46;|&#x2e;|&period;/i.test(out)) {
    out = out.replace(/(?:[a-z0-9._%+-]|&#\d+;|&#x[0-9a-f]+;|&period;){1,64}(?:@|&#64;|&#x40;|&commat;)(?:[a-z0-9.-]|&#\d+;|&#x[0-9a-f]+;|&period;){1,64}/gi, (m) => {
      if (!/&(#\d+|#x[0-9a-f]+|commat|period);/i.test(m)) return m;
      const dec = decodeEntities(m);
      const e = normaliseEmail(dec);
      if (e) hows.set(e, 'entity');
      return e ? dec : m;
    });
  }

  return { html: out, jsEmails, hows };
}

/** Visible text with mailto addresses kept next to their link text. */
export function visibleTextWithMailto(html: string): string {
  const withAddresses = html.replace(/<a\b([^>]*)href=(["'])mailto:([^"'?]+)[^"']*\2([^>]*)>([\s\S]*?)<\/a>/gi, (_m, _pre, _q, addr, _post, inner) => {
    const text = htmlToText(inner);
    const a = decodeEntities(addr).trim();
    return text.toLowerCase().includes(a.toLowerCase()) ? ` ${text} ` : ` ${text} ${a} `;
  }).replace(/data-email="([^"]+)"/gi, ' $1 ');
  // The named entities a marketing site writes between a name and an address (&mdash;, &ndash;, &nbsp;) become plain characters.
  return decodeEntities(htmlToText(withAddresses));
}

/** Top-level domains an obfuscated company address can plausibly end in; "lunchtime. Then" is prose, not a domain. */
const PLAUSIBLE_TLD = new Set(['uk', 'com', 'org', 'net', 'edu', 'eu', 'ie', 'io', 'me', 'info', 'company', 'london', 'ai', 'co', 'dev', 'app', 'tech', 'xyz', 'health', 'finance', 'ventures', 'capital', 'fund', 'vc']);

/** Decode "[at]", "(at)", " at ", "[dot]" forms found in visible text. */
export function deobfuscateText(text: string): Array<{ email: string; index: number; original: string }> {
  const out: Array<{ email: string; index: number; original: string }> = [];
  const bracketed = /\b([a-z0-9._%+-]{1,40})\s*[\[({<]\s*at\s*[\])}>]\s*((?:[a-z0-9-]+\s*(?:\.|[\[({<]\s*dot\s*[\])}>])\s*)+[a-z]{2,})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = bracketed.exec(text)) !== null) {
    const domain = m[2].replace(/\s*[\[({<]\s*dot\s*[\])}>]\s*/gi, '.').replace(/\s*\.\s*/g, '.');
    // Prose such as "sports (at) lunchtime. Then" scans as an address; a real one ends in a TLD.
    if (!PLAUSIBLE_TLD.has(domain.split('.').pop() || '')) continue;
    const e = normaliseEmail(`${m[1]}@${domain}`);
    if (e) out.push({ email: e, index: m.index, original: m[0] });
  }
  // "name at domain dot ac dot uk": only when both words are present, so that
  // prose such as "meet at company" never becomes an address.
  const spoken = /\b([a-z0-9_%+-]{2,40}(?:\s+dot\s+[a-z0-9_%+-]{1,40})*)\s+at\s+([a-z0-9-]+(?:\s+dot\s+[a-z0-9-]+)+)\b/gi;
  while ((m = spoken.exec(text)) !== null) {
    const e = normaliseEmail(`${m[1].replace(/\s+dot\s+/gi, '.')}@${m[2].replace(/\s+dot\s+/gi, '.')}`);
    if (e) out.push({ email: e, index: m.index, original: m[0] });
  }
  return out;
}

function contextAround(text: string, index: number, length: number, width = 200): string {
  const half = Math.floor(width / 2);
  const start = Math.max(0, index - half);
  const end = Math.min(text.length, index + length + half);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Emails

export function extractEmails(htmlOrText: string, pageUrl: string): EmailHit[] {
  const isHtml = /<[a-z][\s\S]*>/i.test(htmlOrText);
  const { html, jsEmails, hows } = isHtml ? expandObfuscatedHtml(htmlOrText) : { html: htmlOrText, jsEmails: [], hows: new Map<string, EmailHow>() };
  const hits = new Map<string, EmailHit>();
  const add = (email: string | null, context: string, how: EmailHow, linkText?: string) => {
    if (!email) return;
    const existing = hits.get(email);
    if (existing) {
      if (!existing.context && context) existing.context = context;
      if (!existing.linkText && linkText) existing.linkText = linkText;
      return;
    }
    hits.set(email, { email, context, source_url: pageUrl, linkText, how: hows.get(email) ?? how });
  };

  const text = isHtml ? visibleTextWithMailto(html) : html;
  const lower = text.toLowerCase();
  const findContext = (email: string, fallback: string): string => {
    const i = lower.indexOf(email);
    if (i >= 0) return contextAround(text, i, email.length);
    return fallback;
  };

  // mailto links first (they carry link text)
  if (isHtml) {
    const re = /<a\b[^>]*href=(["'])mailto:([^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const email = normaliseEmail(m[2]);
      if (!email) continue;
      const linkText = htmlToText(m[3]).replace(/\s+/g, ' ').trim();
      add(email, findContext(email, linkText), 'mailto', linkText);
    }
  }

  // plain-text addresses
  let m: RegExpExecArray | null;
  EMAIL_RE.lastIndex = 0;
  while ((m = EMAIL_RE.exec(text)) !== null) {
    const email = normaliseEmail(m[0]);
    if (!email) continue;
    add(email, contextAround(text, m.index, m[0].length), 'text');
  }

  // [at] / (at) / " at ... dot " forms
  for (const d of deobfuscateText(text)) add(d.email, contextAround(text, d.index, d.original.length), 'obfuscated');

  // JavaScript concatenations: no visible context, only the page title
  const title = htmlOrText.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  for (const e of jsEmails) add(normaliseEmail(e), title ? htmlToText(title).slice(0, 120) : '', 'js');

  return Array.from(hits.values());
}

// ---------------------------------------------------------------------------
// People

const TITLE = "(?:Mr|Mrs|Ms|Miss|Mx|Dr|Rev|Revd|Reverend|Fr|Father|Sr|Sister|Prof|Professor|Sir|Dame|Lady|Canon|Deacon)\\.?";
const WORD = "[A-Z][a-z]*(?:[A-Z][a-z]+)?(?:['’-][A-Za-z]+)*";
const INITIALS = "(?:[A-Z]\\.?\\s+){0,2}";
const NAME_CORE = `${INITIALS}${WORD}(?:\\s+${INITIALS}${WORD}){0,3}`;
// A name is a title followed by a name-ish run, or two to four capitalised words.
const NAME_WITH_TITLE = new RegExp(`\\b(${TITLE})\\s+(${NAME_CORE})`, 'g');
const NAME_PLAIN = new RegExp(`\\b(${WORD}(?:\\s+${INITIALS}${WORD}){1,3})\\b`, 'g');
const NAME_EXACT = new RegExp(`^(?:(${TITLE})\\s+)?(${NAME_CORE})$`);

// Words that end a name when they trail it ("Ms Bailey Operations") and that
// disqualify a capitalised pair from being a person ("Series A", "Open
// Roles", "Head Of", "Backed By"): page furniture, role words and the
// start-up vocabulary that team, about and careers pages are made of.
const STOP_WORDS = new Set([
  'welcome', 'our', 'company', 'companies', 'the', 'a', 'an', 'year', 'years', 'head', 'heads', 'of', 'staff', 'team', 'teams', 'support',
  'office', 'contact', 'contacts', 'email', 'telephone', 'phone', 'tel', 'address', 'name', 'title', 'role', 'roles', 'board', 'chair', 'vice',
  'deputy', 'assistant', 'executive', 'acting', 'senior', 'junior', 'leadership', 'leader', 'leaders', 'lead', 'leads', 'principal', 'staff', 'founding',
  'founder', 'founders', 'co-founder', 'cofounder', 'ceo', 'cto', 'coo', 'cpo', 'cfo', 'cmo', 'cro', 'chief', 'officer', 'officers', 'vp', 'president', 'director', 'directors',
  'business', 'manager', 'managers', 'finance', 'hr', 'human', 'resources', 'people', 'talent', 'recruiter', 'recruiting', 'recruitment', 'hiring', 'operations', 'ops',
  'engineer', 'engineers', 'engineering', 'developer', 'developers', 'designer', 'designers', 'design', 'product', 'products', 'platform', 'data', 'science', 'research', 'machine',
  'learning', 'ai', 'software', 'technology', 'tech', 'security', 'infrastructure', 'sales', 'marketing', 'growth', 'customer', 'customers', 'success', 'partnerships', 'partner',
  'partners', 'revenue', 'commercial', 'account', 'accounts', 'advisor', 'advisors', 'adviser', 'advisers', 'advisory', 'investor', 'investors', 'backed', 'funding', 'raise', 'raised',
  'seed', 'series', 'round', 'pre-seed', 'venture', 'ventures', 'capital', 'fund', 'funds', 'portfolio', 'general', 'managing', 'counsel', 'legal', 'compliance',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'january', 'february', 'march',
  'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'london', 'road', 'street', 'avenue', 'please', 'click', 'here', 'view', 'read',
  'more', 'home', 'about', 'us', 'news', 'events', 'blog', 'press', 'careers', 'jobs', 'join', 'open', 'roles', 'apply', 'now', 'remote', 'hybrid', 'onsite', 'office',
  'pricing', 'docs', 'documentation', 'api', 'demo', 'book', 'sign', 'log', 'in', 'up', 'get', 'started', 'start', 'free', 'trial', 'download', 'app', 'store',
  'information', 'details', 'privacy', 'terms', 'cookies', 'accessibility', 'sitemap', 'login', 'search', 'menu', 'skip', 'content', 'main', 'navigation', 'footer', 'header',
  'copyright', 'website', 'web', 'online', 'mission', 'vision', 'values', 'story', 'culture', 'benefits', 'perks', 'life', 'work', 'working', 'why', 'what', 'how', 'who',
  'meet', 'list', 'find', 'touch', 'and', 'for', 'to', 'with', 'at', 'on', 'by', 'from', 'all', 'new', 'latest', 'upper', 'lower', 'middle', 'level', 'levels', 'results',
  'award', 'awards', 'featured', 'trusted', 'loved', 'used', 'built', 'building', 'launch', 'launched', 'announcing', 'announcement', 'introducing',
  'link', 'links', 'page', 'pages', 'this', 'that', 'these', 'those', 'we', 'you', 'they', 'it', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must', 'not', 'no', 'yes', 'or', 'but',
  'if', 'then', 'than', 'so', 'as', 'also', 'very', 'just', 'only', 'own', 'same', 'other', 'another', 'each', 'every', 'both', 'few', 'many', 'much', 'most', 'some', 'any', 'such',
  'community', 'local', 'global', 'international', 'europe', 'uk', 'usa', 'ea', 'pa', 'secretary', 'administrator', 'admin', 'administration', 'it', 'network', 'member', 'members',
  'coordinator', 'co-ordinator', 'specialist', 'analyst', 'associate', 'intern', 'graduate', 'scientist', 'architect', 'consultant', 'first', 'second', 'third', 'inc', 'ltd', 'limited',
]);

// The words a start-up team page uses for a job title. A card or row whose
// second line has none of them is a caption, not a role.
const ROLE_HINT = /\b(co-?founder|founder|founding (?:engineer|designer|team|partner)|ceo|cto|coo|cpo|cfo|cmo|cro|ciso|chro|chief (?:executive|technology|technical|operating|operations|product|people|financial|finance|marketing|revenue|commercial|scientific|medical|data|information|security|of staff)|chief\b|head of|vp\b|vice[- ]president|svp|evp|director|managing director|partner|general partner|principal|associate|lead\b|manager|engineer|engineering|developer|architect|designer|design|product|scientist|researcher|analyst|talent|recruiter|recruiting|recruitment|people|hr\b|human resources|operations|ops\b|chief of staff|\bea\b|ea to\b|executive assistant|personal assistant|\bpa\b|pa to\b|office manager|general counsel|counsel|legal|finance|accountant|controller|investor|angel|advisor|adviser|board|non-executive|trustee|observer|marketing|sales|growth|customer success|customer support|account executive|account manager|partnerships|community|content|brand|success|specialist|coordinator|co-ordinator|consultant|strategist|writer|intern|apprentice|fellow|technician|officer|president|secretary|clerk)\b/i;

/** Does this text read like a job title or role, rather than a name or a sentence? */
export function looksLikeRole(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 120) return false;
  if (/[.!?]$/.test(t) && t.split(' ').length > 8) return false;
  return ROLE_HINT.test(t);
}

const TITLE_RE = new RegExp(`^(?:${TITLE})\\s+`);

/** Tidy a name: whitespace, trailing punctuation, a possessive ("Mr Sear's Office"), and trailing role words ("Ms Bailey Administration"). */
function cleanName(raw: string): string {
  let n = raw.replace(/\s+/g, ' ').replace(/[\s,;:–—-]+$/g, '').trim();
  // Drop trailing words that are roles or page furniture, keeping at least the surname.
  const m = n.match(TITLE_RE);
  const title = m ? m[0] : '';
  let words = n.slice(title.length).split(' ').filter(Boolean);
  while (words.length > 1 && STOP_WORDS.has(words[words.length - 1].toLowerCase().replace(/[’']s?$/, ''))) words.pop();
  if (words.length > 0) words[words.length - 1] = words[words.length - 1].replace(/[’']s$/, '');
  n = (title + words.join(' ')).trim();
  return n;
}

/** Tidy a role: "Welcome from our Principal" is "Principal". */
function cleanRole(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^(?:welcome|a (?:message|word|letter|note)|message|letter|hello|greetings|news)\s+from\s+(?:our|the|your)?\s*/i, '')
    .replace(/^(?:meet|about|introducing)\s+(?:our|the)\s+/i, '')
    .replace(/[:\-–—,\s]+$/g, '')
    .trim();
}

/** Is this capitalised run a plausible person's name (title + surname, or two to four proper-noun words)? */
export function looksLikeName(text: string): boolean {
  const t = cleanName(text);
  const m = t.match(NAME_EXACT);
  if (!m) return false;
  const hasTitle = !!m[1];
  const words = m[2].split(/\s+/).filter((w) => !/^[A-Z]\.?$/.test(w));
  if (words.length === 0) return false;
  if (!hasTitle && words.length < 2) return false;
  if (words.length > 4) return false;
  const stops = words.filter((w) => STOP_WORDS.has(w.toLowerCase().replace(/[’']s?$/, '')));
  return stops.length === 0;
}

function splitNameAndRole(cell: string): { name: string; role: string } | null {
  // "Tom Patel (EA to the CEO)" or "Amy Jones - Chief of Staff"
  const t = cleanName(cell);
  let m = t.match(/^(.+?)\s*\(([^)]{3,100})\)\s*$/);
  if (m && looksLikeName(m[1]) && looksLikeRole(m[2])) return { name: cleanName(m[1]), role: m[2].trim() };
  m = t.match(/^(.+?)\s*[,–—-]\s*(.{3,100})$/);
  if (m && looksLikeName(m[1]) && looksLikeRole(m[2])) return { name: cleanName(m[1]), role: m[2].trim() };
  m = t.match(/^(.{3,100}?)\s*[:–—-]\s*(.+)$/);
  if (m && looksLikeRole(m[1]) && looksLikeName(m[2])) return { name: cleanName(m[2]), role: m[1].trim() };
  return null;
}

function cellText(html: string): string {
  return visibleTextWithMailto(html).replace(/\s+/g, ' ').trim();
}

function firstEmailIn(text: string): string | undefined {
  const m = text.match(EMAIL_RE);
  const e = m ? normaliseEmail(m[0]) : null;
  return e ?? undefined;
}

/** The text without its addresses: plain ones, and the "[at]" and "name at domain dot io" forms, so "Priya Shah — p.shah [at] x [dot] io" still reads as a name. */
function stripEmails(text: string): string {
  let t = text.replace(EMAIL_RE, ' ');
  for (const d of deobfuscateText(t)) t = t.replace(d.original, ' ');
  return t.replace(/\(\s*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

export function extractPeople(htmlOrText: string, pageUrl: string): PersonHit[] {
  const isHtml = /<[a-z][\s\S]*>/i.test(htmlOrText);
  const html = isHtml ? expandObfuscatedHtml(htmlOrText).html : '';
  const people: PersonHit[] = [];
  const seen = new Map<string, PersonHit>();
  const add = (name: string, role: string, context: string, email?: string) => {
    const n = cleanName(name);
    if (!looksLikeName(n)) return;
    const r = cleanRole(role);
    if (!looksLikeRole(r)) return;
    const key = n.replace(new RegExp(`^${TITLE}\\s+`), '').toLowerCase();
    const ctx = context.replace(/\s+/g, ' ').trim().slice(0, 200);
    const existing = seen.get(key);
    if (existing) {
      if (!existing.email && email) existing.email = email;
      if (existing.role.length < r.length && !existing.email) existing.role = r;
      return;
    }
    const hit: PersonHit = { name: n, role: r, context: ctx, email, source_url: pageUrl };
    seen.set(key, hit);
    people.push(hit);
  };

  if (isHtml) {
    // 1. Tables: header row may say which column is which; otherwise inspect each cell.
    const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
    for (const table of tables) {
      const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];
      let cols: { name?: number; role?: number; email?: number } = {};
      for (const row of rows) {
        const cells = (row.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) || []).map(cellText);
        if (cells.length === 0) continue;
        const isHeader = /<th/i.test(row) && cells.every((c) => c.length < 40);
        if (isHeader) {
          cols = {};
          cells.forEach((c, i) => {
            const l = c.toLowerCase();
            if (/^(name|staff|person|who|team member|member)$/.test(l)) cols.name = i;
            else if (/^(title|role|position|job title|job|function|responsibilit\w*|post)$/.test(l)) cols.role = i;
            else if (/^(e-?mail|contact|email address)$/.test(l)) cols.email = i;
          });
          continue;
        }
        const rowText = cells.join(' | ');
        const email = firstEmailIn(rowText);
        if (cols.name !== undefined && cells[cols.name] !== undefined) {
          const name = stripEmails(cells[cols.name]);
          const role = cols.role !== undefined ? stripEmails(cells[cols.role] ?? '') : '';
          if (role) add(name, role, rowText, email);
          else {
            const split = splitNameAndRole(name);
            if (split) add(split.name, split.role, rowText, email);
          }
          continue;
        }
        // Label / value rows and free-form rows
        const plain = cells.map(stripEmails);
        const nameIdx = plain.findIndex((c) => looksLikeName(c));
        const roleIdx = plain.findIndex((c, i) => i !== nameIdx && looksLikeRole(c) && !looksLikeName(c));
        if (nameIdx >= 0 && roleIdx >= 0) add(plain[nameIdx], plain[roleIdx], rowText, email);
        else {
          for (const c of plain) {
            const split = splitNameAndRole(c);
            if (split) { add(split.name, split.role, rowText, email); break; }
          }
        }
      }
    }

    // 2. Definition lists
    const dls = html.match(/<dl[\s\S]*?<\/dl>/gi) || [];
    for (const dl of dls) {
      const re = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(dl)) !== null) {
        const a = cellText(m[1]), b = cellText(m[2]);
        const email = firstEmailIn(`${a} ${b}`);
        if (looksLikeRole(stripEmails(a)) && looksLikeName(stripEmails(b))) add(stripEmails(b), stripEmails(a), `${a}: ${b}`, email);
        else if (looksLikeName(stripEmails(a)) && looksLikeRole(stripEmails(b))) add(stripEmails(a), stripEmails(b), `${a}: ${b}`, email);
      }
    }

    // 3. Card grids: a heading holding a name, with the role in the next block; or the reverse.
    const headingRe = /<h([2-6])[^>]*>([\s\S]*?)<\/h\1>([\s\S]{0,600}?)(?=<h[1-6]|$)/gi;
    let hm: RegExpExecArray | null;
    while ((hm = headingRe.exec(html)) !== null) {
      const heading = stripEmails(cellText(hm[2]));
      const after = hm[3];
      const blocks = (after.match(/<(?:p|span|div|li|em|strong|small|h[3-6])[^>]*>([\s\S]*?)<\/(?:p|span|div|li|em|strong|small|h[3-6])>/gi) || []).map((b) => cellText(b)).filter((t) => t && t.length <= 120);
      const email = firstEmailIn(cellText(after));
      if (looksLikeName(heading)) {
        const role = blocks.map(stripEmails).find((b) => looksLikeRole(b) && !looksLikeName(b));
        if (role) add(heading, role, `${heading} ${blocks.slice(0, 3).join(' ')}`, email);
        else {
          const split = splitNameAndRole(heading);
          if (split) add(split.name, split.role, heading, email);
        }
      } else if (looksLikeRole(heading) && heading.length <= 80) {
        const name = blocks.map(stripEmails).find((b) => looksLikeName(b));
        if (name) add(name, heading, `${heading} ${name}`, email);
        else {
          const split = splitNameAndRole(heading);
          if (split) add(split.name, split.role, heading, email);
        }
      } else {
        const split = splitNameAndRole(heading);
        if (split) add(split.name, split.role, heading, email);
      }
    }
  }

  // 4. Inline patterns over the visible text, line by line.
  const text = isHtml ? visibleTextWithMailto(html) : htmlOrText;
  const lines = text.split(/\n|\s\|\s|;\s/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length >= 6 && l.length <= 240);
  // An address belongs to the person it follows on the line (within 90
  // characters and before the next person), or on a "Contact details:" line
  // directly below a line that names exactly one person.
  const emailAfter = (line: string, from: number, limit: number): string | undefined => {
    EMAIL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = EMAIL_RE.exec(line)) !== null) {
      if (m.index >= from && m.index < Math.min(limit, from + 90)) return normaliseEmail(m[0]) ?? undefined;
    }
    return undefined;
  };
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const nextLineEmail = li + 1 < lines.length && /^(?:contact details|contact|e-?mail|e)\s*[:\-–]?\s*[a-z0-9][a-z0-9._%+'-]*@/i.test(lines[li + 1]) ? firstEmailIn(lines[li + 1]) : undefined;
    const split = splitNameAndRole(stripEmails(line));
    if (split) { add(split.name, split.role, line, firstEmailIn(line) ?? nextLineEmail); continue; }
    // "Founder: Jamie Brownhill Chief of Staff: Simon Dodds" (several on one line)
    const multi = /([A-Z][A-Za-z'’()\/&\s-]{2,80}?)\s*[:–—-]\s*((?:(?:Mr|Mrs|Ms|Miss|Mx|Dr|Rev|Revd|Fr|Sr|Prof|Sir)\.?\s+)?[A-Z][a-z'’-]+(?:\s+[A-Z]\.?)?(?:\s+[A-Z][a-z'’-]+){0,3})(?=\s+[A-Z][A-Za-z'’()\/&\s-]{2,80}?\s*[:–—-]|\s*[a-z0-9._%+'-]+@|\s*$)/g;
    const matches: Array<{ name: string; role: string; end: number }> = [];
    let mm: RegExpExecArray | null;
    while ((mm = multi.exec(line)) !== null) {
      if (looksLikeRole(mm[1]) && looksLikeName(mm[2])) matches.push({ name: mm[2], role: mm[1], end: mm.index + mm[0].length });
    }
    if (matches.length > 0) {
      matches.forEach((m, i) => {
        const limit = i + 1 < matches.length ? matches[i + 1].end - matches[i + 1].name.length - matches[i + 1].role.length : line.length;
        add(m.name, m.role, line, emailAfter(line, m.end, limit) ?? (matches.length === 1 ? nextLineEmail : undefined));
      });
      continue;
    }
    // "Dr Sarah Brown, CTO" or "CTO Dr Sarah Brown" (a titled name; plain names go through the line patterns above)
    NAME_WITH_TITLE.lastIndex = 0;
    let nm: RegExpExecArray | null;
    const named: Array<{ name: string; role: string; end: number }> = [];
    while ((nm = NAME_WITH_TITLE.exec(line)) !== null) {
      const before = line.slice(Math.max(0, nm.index - 60), nm.index).trim();
      const after = line.slice(nm.index + nm[0].length, nm.index + nm[0].length + 70).trim();
      const roleAfter = after.match(/^[,(–—:-]?\s*([A-Za-z][A-Za-z'’&\/\s-]{2,60}?)(?:[).,;]|\s+(?:and|is|who|has|will|can|for|at|on|with)\b|$)/)?.[1];
      const roleBefore = before.match(/([A-Z][A-Za-z'’&\/\s-]{2,60}?)\s*[:–—,-]?\s*$/)?.[1];
      if (roleAfter && looksLikeRole(roleAfter) && !looksLikeName(roleAfter)) named.push({ name: `${nm[1]} ${nm[2]}`, role: roleAfter, end: nm.index + nm[0].length });
      else if (roleBefore && looksLikeRole(roleBefore) && !looksLikeName(roleBefore)) named.push({ name: `${nm[1]} ${nm[2]}`, role: roleBefore, end: nm.index + nm[0].length });
    }
    named.forEach((m, i) => {
      const limit = i + 1 < named.length ? named[i + 1].end - named[i + 1].name.length : line.length;
      add(m.name, m.role, line, emailAfter(line, m.end, limit) ?? (named.length === 1 ? nextLineEmail : undefined));
    });
  }

  return people;
}

// ---------------------------------------------------------------------------
// Phones

const PHONE_RE = /(?:\+44\s?\(?0?\)?[\s-]?|\(?0)\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g;

export function normalisePhone(raw: string): string | null {
  let d = raw.replace(/[^\d+]/g, '');
  if (d.startsWith('+44')) d = '0' + d.slice(3);
  if (d.startsWith('44') && d.length === 12) d = '0' + d.slice(2);
  if (!/^0\d{9,10}$/.test(d)) return null;
  if (/^0[12]/.test(d)) return d.length === 11 ? `${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}` : d;
  return d;
}

/** UK numbers near the words tel / phone / call, or in tel: links. */
export function extractPhones(htmlOrText: string, pageUrl: string): PhoneHit[] {
  const isHtml = /<[a-z][\s\S]*>/i.test(htmlOrText);
  const out = new Map<string, PhoneHit>();
  if (isHtml) {
    const re = /href=(["'])tel:([^"']+)\1/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(htmlOrText)) !== null) {
      const p = normalisePhone(decodeEntities(m[2]));
      if (p && !out.has(p)) out.set(p, { phone: p, context: 'tel: link', source_url: pageUrl });
    }
  }
  const text = isHtml ? htmlToText(htmlOrText) : htmlOrText;
  let m: RegExpExecArray | null;
  PHONE_RE.lastIndex = 0;
  while ((m = PHONE_RE.exec(text)) !== null) {
    const p = normalisePhone(m[0]);
    if (!p) continue;
    const before = text.slice(Math.max(0, m.index - 30), m.index).toLowerCase();
    if (/\b(fax|f)\s*[:.]?\s*$/.test(before)) continue;
    if (!/\b(tel|telephone|phone|call|t|contact)\s*[:.]?\s*$/.test(before) && !/\b(tel|telephone|phone)\b/.test(before)) continue;
    if (!out.has(p)) out.set(p, { phone: p, context: contextAround(text, m.index, m[0].length, 120), source_url: pageUrl });
    if (out.size >= 3) break;
  }
  return Array.from(out.values());
}
