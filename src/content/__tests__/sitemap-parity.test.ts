import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { STATIC_ROUTES, buildSitemap, buildSitemapGroups, renderHtmlSitemapBody, sitemapLinks } from '../../../worker/sitemap';
import { NAV_PATHS, FOOTER_COLUMNS, SSR_FOOTER_NAV } from '../navigation';
import { isBlogPublic, setBlogPublicForTesting } from '../reviewHolds';

/**
 * The footer's "Sitemap" link used to point straight at /sitemap.xml, so
 * clicking it dumped raw XML into the browser. A visitor-facing /sitemap page
 * now exists — which immediately creates a new risk: a page that advertises a
 * different URL set than the XML feed we hand Google. These tests pin the two
 * together, because a sitemap page that disagrees with its own XML is worse
 * than no page at all.
 */
const app = readFileSync('src/App.tsx', 'utf8');
const seoMeta = readFileSync('worker/seo-meta.ts', 'utf8');
const sitemapScript = readFileSync('scripts/regenerate-sitemap.mjs', 'utf8');
const staticSitemapXml = readFileSync('public/sitemap.xml', 'utf8');

const VALID_PRODUCT = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'everyday-knit-cardigan-verified',
  name: 'Everyday Knit Cardigan',
  category_id: 'cat-womens-clothing',
  status: 'active',
  description: 'A'.repeat(60),
  short_description: 'B'.repeat(60),
  price: 49.95,
  image_url: 'https://cdn.example.com/bed.jpg',
  commerce_readiness: 'COMMERCE_READY',
  supplier_source: 'cj-dropshipping',
  cost_price: 12,
  us_inventory: true,
  stock_status: 'in_stock',
  inventory_qty: 5,
};
const HELD_PRODUCT = { ...VALID_PRODUCT, id: '2', slug: 'kong-classic-durable-natural-rubber-dog-toy', name: 'KONG Classic' };
const PRICELESS_PRODUCT = { ...VALID_PRODUCT, id: '3', slug: 'draft-no-price', name: 'Draft Product', price: 0 };
const HELD_BLOG = { slug: 'grooming-routine-long-haired-pets', title: 'Grooming Routine for Long-Haired Pets' };
const LIVE_BLOG = { slug: 'how-to-fit-no-pull-dog-harness', title: 'How to Fit a No-Pull Dog Harness' };

function stubDb(rows: { products: unknown[]; categories: unknown[]; blogs: unknown[] } | 'down') {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (rows === 'down') return new Response('nope', { status: 500 });
    const url = String(input);
    if (url.includes('/products')) return new Response(JSON.stringify(rows.products));
    if (url.includes('/categories')) return new Response(JSON.stringify(rows.categories));
    if (url.includes('/blog_posts')) return new Response(JSON.stringify(rows.blogs));
    return new Response('[]');
  }));
}

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = 'https://test-project.supabase.co';
  process.env.VITE_SUPABASE_ANON_KEY = 'anon-key';
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.VITE_SUPABASE_URL; delete process.env.VITE_SUPABASE_ANON_KEY; });

const locsOf = (xml: string) => [...xml.matchAll(/<loc>https:\/\/luxedge\.us([^<]*)<\/loc>/g)].map((m) => m[1]);
const hrefsOf = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

describe('sitemap — XML and the visitor-facing page share one source', () => {
  beforeEach(() => {
    stubDb({
      products: [VALID_PRODUCT, HELD_PRODUCT, PRICELESS_PRODUCT],
      categories: [{ id: 'cat-womens-clothing', slug: 'womens-clothing', name: "Women's Clothing" }],
      blogs: [LIVE_BLOG, HELD_BLOG],
    });
  });

  it('lists exactly the same URLs in the XML feed and the HTML page', async () => {
    const groups = await buildSitemapGroups();
    expect(groups).not.toBeNull();
    const xml = await buildSitemap();
    expect(xml).not.toBeNull();

    const xmlHrefs = locsOf(xml!);
    const htmlHrefs = hrefsOf(renderHtmlSitemapBody(groups!));

    // Every URL we ask Google to index is reachable from the page...
    for (const href of xmlHrefs) {
      expect(htmlHrefs, `sitemap page omits ${href}`).toContain(href);
    }
    // ...and the page links nothing we do not index, apart from the pointer to
    // the XML file itself. The intro/outro copy re-links /shop and /contact,
    // which are already part of the indexable set, so they add no new target.
    expect(htmlHrefs.filter((h) => !xmlHrefs.includes(h))).toEqual(['/sitemap.xml']);
  });

  it('never advertises a held blog, a held product or an unlistable product', async () => {
    const xml = await buildSitemap();
    const groups = await buildSitemapGroups();
    const html = renderHtmlSitemapBody(groups!);
    for (const dead of ['/blog/grooming-routine-long-haired-pets', '/product/kong-classic-durable-natural-rubber-dog-toy', '/product/draft-no-price']) {
      expect(xml!, `XML advertised ${dead}`).not.toContain(dead);
      expect(html, `sitemap page advertised ${dead}`).not.toContain(dead);
    }
  });

  it('escapes section headings exactly once', async () => {
    // A guide is supplied explicitly: the section still has to render and
    // escape correctly whenever the blog is public again.
    const groups = { ...(await buildSitemapGroups())!, guides: [{ href: '/blog/a-guide', label: 'A guide' }] };
    const html = renderHtmlSitemapBody(groups);
    // "Guides &amp;amp; articles" rendered into the crawl HTML as a literal
    // "&amp;amp;" for every visitor and crawler until this was pinned.
    expect(html).toContain('Guides &amp; articles');
    expect(html).not.toContain('&amp;amp;');
  });

  it('labels links with the real record name, not a slug-derived guess', async () => {
    const groups = await buildSitemapGroups();
    const html = renderHtmlSitemapBody(groups!);
    expect(html).toContain(">Women's Clothing<");
    expect(html).toContain('>Everyday Knit Cardigan<');
  });

  it('drops the blog from every sitemap surface while it is withdrawn from the index', async () => {
    setBlogPublicForTesting(false);
    try {
      const groups = (await buildSitemapGroups())!;
      expect(groups.guides).toEqual([]);
      expect(sitemapLinks(groups).some((l) => l.href === '/blog' || l.href.startsWith('/blog/'))).toBe(false);
      expect(await buildSitemap()).not.toContain('/blog');
    } finally {
      setBlogPublicForTesting(null);
    }
  });

  it('returns null on a database outage so the caller can 503 instead of publishing stale URLs', async () => {
    stubDb('down');
    expect(await buildSitemapGroups()).toBeNull();
    expect(await buildSitemap()).toBeNull();
  });
});

describe('sitemap — the static URL set cannot drift', () => {
  it('keeps the build script in step with the worker, order included', () => {
    const match = sitemapScript.match(/const urls = \[([^\]]*)\]/);
    expect(match, 'regenerate-sitemap.mjs no longer declares a urls array').not.toBeNull();
    const fromScript = match![1]
      .split(',')
      .map((x) => x.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    expect(fromScript).toEqual(STATIC_ROUTES.map((r) => r.href));
  });

  it('includes the HTML sitemap page and never the XML file', () => {
    const hrefs = STATIC_ROUTES.map((r) => r.href);
    expect(hrefs).toContain('/sitemap');
    expect(hrefs).not.toContain('/sitemap.xml');
  });

  it('ships the same static set in the built sitemap.xml', () => {
    // Same rule as the worker's own feed: /blog is excluded only while the blog
    // is withdrawn from the index, and present again the moment it is public.
    for (const href of STATIC_ROUTES.map((r) => r.href).filter((h) => isBlogPublic() || h !== '/blog')) {
      const expected = href === '/' ? '<loc>https://luxedge.us/</loc>' : `<loc>https://luxedge.us${href}</loc>`;
      expect(staticSitemapXml, `${href} missing from public/sitemap.xml`).toContain(expected);
    }
    if (!isBlogPublic()) {
      expect(staticSitemapXml, 'the withdrawn blog is still advertised').not.toContain('<loc>https://luxedge.us/blog</loc>');
    }
    expect(staticSitemapXml).not.toContain('/shipping<');
  });
});

describe('sitemap — the footer link opens a page, not raw XML', () => {
  it('links the /sitemap page from the hydrated footer, never the raw XML', () => {
    expect(FOOTER_COLUMNS.flatMap((c) => c.links.map((l) => l.to))).toContain('/sitemap');
    expect(Object.values(NAV_PATHS)).not.toContain('/sitemap.xml');
  });

  it('renders the page from live data so the crawl body and the React page agree', () => {
    expect(app).toContain('function SitemapPage()');
    expect(app).toContain('<Route path="/sitemap"');
  });

  it('links every static page the worker pre-renders, from the same list', () => {
    // The hydrated page must not omit a page the crawl body advertises (it did:
    // the React list left out /sitemap while STATIC_ROUTES included it).
    const start = app.indexOf('function SitemapPage()');
    expect(start, 'SitemapPage component not found').toBeGreaterThan(-1);
    const end = app.indexOf('\nfunction ', start + 1);
    const page = app.slice(start, end === -1 ? undefined : end);
    const tos = [...page.matchAll(/to: '([^']+)'/g)].map((m) => m[1]);
    expect(tos).toEqual(STATIC_ROUTES.map((r) => r.href));
  });

  it('is a known, indexable static page in the worker', () => {
    expect(seoMeta).toMatch(/['"]\/sitemap['"]:\s*\{/);
    expect(seoMeta).toContain('Sitemap — Every Page on Luxedge');
    expect(SSR_FOOTER_NAV.some((l) => l.to === '/sitemap')).toBe(true);
  });
});
