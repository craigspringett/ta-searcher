// A small RSS 2.0 item reader for the funding news feeds.
//
// Investigation of 21 September 2026 (fixtures/ fetched from the build
// session with curl and a browser User-Agent):
//   UKTN https://www.uktech.news/feed: WordPress RSS 2.0, 10 items, plain
//     <title>, <link> to the article, <pubDate> RFC 822 with "+0000",
//     <description> in CDATA holding a <p> of the first sentences, an
//     "[&#8230;]" ellipsis and a "The post ... appeared first on UKTN"
//     line, and a <content:encoded> with the whole article. Categories in
//     CDATA. 3 of the 10 were raise stories (Magnitude Biosciences £1.3m,
//     Itoflow £1.8m, Embedd £2m; First Table's $12m NZD is a New Zealand
//     company expanding into the UK and reads as a raise too).
//   Sifted https://sifted.eu/feed: hand-built RSS 2.0, 24 items, CDATA
//     titles, <link> and <guid> the article URL, <pubDate> in GMT, and no
//     description at all: the headline is all there is to read. 1 of the
//     24 was a raise story (Exein $270m).
//   Google News https://news.google.com/rss/search?q=...&hl=en-GB&gl=GB&ceid=GB:en:
//     100 items on one line, <title> as "Headline - Publisher" (the
//     publisher repeated in <source url="...">), <link> a
//     news.google.com/rss/articles/<id>?oc=5 redirect (the article URL is
//     not in the feed), <pubDate> in GMT, <description> an escaped <a> with
//     the headline again and a <font> with the publisher. The search feed
//     answered 100 items at once and needs no key. Apostrophes come as the
//     curly ’ in the title.
// Nothing here needs a DOM: items are cut out with a regex, the fields
// read with another, CDATA unwrapped and entities decoded. Namespaced
// elements (dc:creator, content:encoded) are ignored.

import { decodeEntities } from '../vacancy-identity.ts';

export interface RssItem {
  title: string;
  link: string;
  /** The pubDate as the feed wrote it, or null. */
  pubDate: string | null;
  /** The pubDate as an ISO instant, or null when missing or unreadable. */
  publishedAt: string | null;
  /** The description as plain text (tags stripped, entities decoded), "" when the feed gives none. */
  description: string;
  /** Google News's " - Publisher" suffix or its <source> element; null elsewhere. */
  publisher: string | null;
}

const ITEM_RE = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;

function unwrapCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

/** The text of the first <name> element in an item's XML, CDATA unwrapped and entities decoded; null when absent. */
export function elementText(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  if (!m) return null;
  return decodeEntities(unwrapCdata(m[1])).trim();
}

/** HTML to one line of text: tags out, entities decoded, whitespace collapsed. */
export function htmlToLine(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** RFC 822 or ISO pubDate to an ISO instant; null when it does not parse. */
export function isoFromPubDate(pubDate: string | null | undefined): string | null {
  if (!pubDate) return null;
  const t = Date.parse(pubDate.trim());
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * "Headline - Publisher" (Google News) into its two parts. When the feed
 * names the publisher (its <source> element) that exact suffix is taken
 * off, so "EU-Startups" with its own hyphen still comes away cleanly; else
 * the split is at the last " - ". A title with no such suffix keeps its
 * whole text and no publisher.
 */
export function splitPublisher(title: string, known: string | null = null): { title: string; publisher: string | null } {
  const t = title.trim();
  if (known) {
    const suffix = ` - ${known.trim()}`;
    if (t.toLowerCase().endsWith(suffix.toLowerCase())) return { title: t.slice(0, t.length - suffix.length).trim(), publisher: known.trim() };
  }
  const at = t.lastIndexOf(' - ');
  if (at <= 0) return { title: t, publisher: known };
  const publisher = t.slice(at + 3).trim();
  if (!publisher || publisher.length > 60) return { title: t, publisher: known };
  return { title: t.slice(0, at).trim(), publisher: known || publisher };
}

/** Whether the feed is Google News's, whose titles carry the publisher. */
export function isGoogleNewsFeed(xml: string): boolean {
  return /<link>https?:\/\/news\.google\.com\//i.test(xml.slice(0, 4000)) || /<generator>NFE\//i.test(xml.slice(0, 4000));
}

/**
 * Every <item> of an RSS 2.0 document. The publisher comes from Google
 * News's <source> element when there is one, else from the " - Publisher"
 * suffix of its title (only for a Google News feed, or when `googleNews`
 * is set: a UKTN headline with a hyphen is left whole).
 */
export function parseRssItems(xml: string, options: { googleNews?: boolean } = {}): RssItem[] {
  const google = options.googleNews ?? isGoogleNewsFeed(xml);
  const items: RssItem[] = [];
  for (const m of xml.matchAll(ITEM_RE)) {
    const body = m[1];
    const rawTitle = (elementText(body, 'title') || '').replace(/\s+/g, ' ').trim();
    const link = (elementText(body, 'link') || '').trim();
    if (!rawTitle || !link) continue;
    const pubDate = elementText(body, 'pubDate');
    const descriptionHtml = elementText(body, 'description') || '';
    let description = htmlToLine(descriptionHtml);
    let title = rawTitle;
    let publisher: string | null = null;
    if (google) {
      const split = splitPublisher(rawTitle, elementText(body, 'source'));
      title = split.title;
      publisher = split.publisher;
      // The Google description is the headline and the publisher again: nothing to keep.
      if (description.startsWith(title)) description = '';
    } else {
      // UKTN's "The post X appeared first on UKTN." trailer says nothing about the story.
      description = description.replace(/\s*The post .* appeared first on .*$/i, '').replace(/\s*\[…\]$/, '').trim();
    }
    items.push({ title, link, pubDate, publishedAt: isoFromPubDate(pubDate), description, publisher });
  }
  return items;
}
