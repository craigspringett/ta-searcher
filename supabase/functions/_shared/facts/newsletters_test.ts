import { assert, assertEquals } from '../test-assert.ts';
import { buildDeparturesMessage, findNewsEntries, MAX_ISSUES, pickLatestPosts, postDateKey } from './newsletters.ts';

const home = `<html><body>
<nav><a href="/about">About us</a><a href="/blog">Blog</a><a href="/careers">Careers</a><a href="/press">Press</a>
<a href="/changelog">Changelog</a><a href="/blog/rss">RSS feed</a><a href="https://searchable.substack.com/subscribe">Subscribe to our newsletter</a>
<a href="/press/Searchable-Series-A-12-March-2026.pdf">Press release</a><a href="https://medium.com/@searchable">Medium</a>
<a href="https://blog.searchable.com/">Engineering blog</a></nav>
</body></html>`;

Deno.test('findNewsEntries: blog, press and the blog sub-domain first, then a direct press release; changelog, feeds, forms and other hosts excluded', () => {
  assertEquals(findNewsEntries(home, 'https://www.searchable.com/', 9), ['https://www.searchable.com/blog', 'https://www.searchable.com/press', 'https://blog.searchable.com/', 'https://www.searchable.com/press/Searchable-Series-A-12-March-2026.pdf']);
  assertEquals(findNewsEntries(home, 'https://www.searchable.com/').length, 3, 'three entries by default');
  assertEquals(findNewsEntries('<html><body><a href="/careers">Careers</a></body></html>', 'https://www.searchable.com/'), []);
  assertEquals(MAX_ISSUES, 3);
});

Deno.test('postDateKey reads the usual date shapes, including a /2026/03/12/ path, and sorts newest first', () => {
  assertEquals(postDateKey('Series A announcement 12 March 2026', '/x'), '2026-03-12');
  assertEquals(postDateKey('Press release', '/press/Searchable-Series-A-12-03-2026.pdf'), '2026-03-12');
  assertEquals(postDateKey('Welcome Priya', '/blog/2026/03/12/welcome-priya'), '2026-03-12');
  assertEquals(postDateKey('March 2026 update', '/x'), '2026-03-00');
  assertEquals(postDateKey('Our 2026 plans', '/x'), '2026-00-00');
  assertEquals(postDateKey('Why we raised', '/x'), '');
  assert(postDateKey('12 March 2026', '/') > postDateKey('17 July 2025', '/'));
});

const index = `<html><body><h1>Blog</h1>
<a href="/blog">Blog</a>
<a href="/blog/why-we-raised-a-series-a">Why we raised a Series A</a>
<a href="/blog/welcoming-priya-shah-head-of-people">Welcoming Priya Shah, our first Head of People</a>
<a href="/blog/2026/03/12/series-a">Searchable raises £10.3m Series A</a>
<a href="/blog/tag/engineering">Engineering</a><a href="/blog/category/product">Product</a><a href="/blog/author/tom">Tom</a><a href="/blog/page/2">Next page</a>
<a href="/careers">Careers</a><a href="/pricing">Pricing</a><a href="/blog/cover.png">Cover</a>
<a href="https://cdn.example.com/searchable/Press-Release-20-June-2026.pdf">Press release 20 June 2026</a>
<a href="/press/kit">Press kit</a>
</body></html>`;

Deno.test('pickLatestPosts: dated posts newest first, then the page order; tags, categories, authors, pagination, sections and images ignored', () => {
  assertEquals(pickLatestPosts(index, 'https://www.searchable.com/blog', 3), ['https://cdn.example.com/searchable/Press-Release-20-June-2026.pdf', 'https://www.searchable.com/blog/2026/03/12/series-a', 'https://www.searchable.com/blog/why-we-raised-a-series-a']);
  assertEquals(pickLatestPosts(index, 'https://www.searchable.com/blog', 9).length, 4, 'the press kit, the tag pages and the image are not posts');
  // Undated posts keep the page's order (latest at the top).
  const undated = `<html><body><a href="/news/our-new-cto">Our new CTO</a><a href="/news/first-year">Our first year</a></body></html>`;
  assertEquals(pickLatestPosts(undated, 'https://www.searchable.com/news', 2), ['https://www.searchable.com/news/our-new-cto', 'https://www.searchable.com/news/first-year']);
  // A news link elsewhere on the site counts when its text reads like a post.
  const elsewhere = `<html><body><a href="/company/news/priya-joins">Priya joins as Head of People</a><a href="/company/news">News</a></body></html>`;
  assertEquals(pickLatestPosts(elsewhere, 'https://www.searchable.com/blog', 2), ['https://www.searchable.com/company/news/priya-joins']);
});

Deno.test('buildDeparturesMessage labels each post by URL', () => {
  const msg = buildDeparturesMessage('Searchable', [{ url: 'https://www.searchable.com/blog/welcoming-priya', text: 'Priya Shah joins as our first Head of People.' }]);
  assert(msg.startsWith('Company: Searchable'));
  assert(msg.includes('NEWS TEXT'));
  assert(msg.includes('=== PAGE https://www.searchable.com/blog/welcoming-priya ===\nPriya Shah joins as our first Head of People.'));
});
