import { SITEMAP_PRODUCTS_SELECT, SITEMAP_CATEGORIES_SELECT, SITEMAP_BLOG_POSTS_SELECT } from './selects';
import { isHeldBlog, isHeldProduct, isBlogPublic } from '../src/content/reviewHolds';
import { isPubliclyListableProduct } from '../src/content/productEligibility';
import { readPostgrestPath } from './d1/read';

// Dynamic sitemap source. Media routes are noindexed and deliberately excluded.
const root = 'https://luxedge.us';

/**
 * Static, always-indexable pages, in the order the HTML sitemap presents them.
 *
 * /blog is listed here for the same reason as the rest, and buildSitemapGroups
 * drops it (and every article) while the blog is withdrawn from the index.
 *
 * /sitemap is listed here because the HTML sitemap is a real visitor-facing
 * page, not a crawler-only artefact: it is in the XML feed like any other page
 * and the footer links to it. The XML file itself (/sitemap.xml) is deliberately
 * NOT listed — a sitemap should not try to index itself.
 */
export const STATIC_ROUTES: SitemapLink[] = [
  { href: '/', label: 'Home' },
  { href: '/shop', label: 'Shop all products' },
  { href: '/blog', label: 'Guides & articles' },
  { href: '/about', label: 'About Luxedge' },
  { href: '/contact', label: 'Contact us' },
  { href: '/faq', label: 'Frequently asked questions' },
  { href: '/shipping-policy', label: 'Shipping policy' },
  { href: '/returns', label: 'Returns & refunds' },
  { href: '/copyright', label: 'Copyright & DMCA' },
  { href: '/editorial-policy', label: 'Editorial policy' },
  { href: '/disclaimer', label: 'Disclaimer' },
  { href: '/privacy', label: 'Privacy policy' },
  { href: '/terms', label: 'Terms of service' },
  { href: '/sitemap', label: 'Sitemap' },
];

/**
 * Public reads go through the data layer (worker/d1/), which serves Cloudflare
 * D1 when DATA_BACKEND=d1 and Supabase otherwise. The path strings below are
 * unchanged — the D1 layer accepts the same PostgREST sub-paths — so every
 * query, select constant and eligibility rule in this file is untouched by the
 * migration. `null` still means "database unavailable", never "no rows".
 */
async function fetchRows<T>(path: string): Promise<T | null> {
  // Single data boundary: the caller's type parameter T is the row-array shape,
  // exactly as the previous `JSON.parse(text) as T` cast asserted it.
  return (await readPostgrestPath(path)) as unknown as T | null;
}
interface ProductRow { id: string; slug?: string | null; name?: string | null; status?: string | null; description?: string | null; short_description?: string | null; price?: number | null; image_url?: string | null; supplier_source?: string | null; cost_price?: number | null; us_inventory?: boolean | null; stock_status?: string | null; inventory_qty?: number | null; commerce_readiness?: string | null; }
interface CategoryRow { slug: string; name?: string | null; }
interface BlogRow { slug: string; title?: string | null; }

const xmlEscape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const htmlEscape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * One link in either sitemap: the path we publish plus the label a human reads.
 * Labels come from the live record when it has one and are only ever derived
 * from the slug as a fallback, so the page never invents a product or article
 * name that the catalog does not carry.
 */
export interface SitemapLink {
  href: string;
  label: string;
}

/** The single URL set both sitemaps are built from. XML and HTML cannot drift. */
export interface SitemapGroups {
  pages: SitemapLink[];
  categories: SitemapLink[];
  guides: SitemapLink[];
  products: SitemapLink[];
}

/** "dog-supplies" → "Dog supplies". Only used when the record has no name. */
function fromSlug(slug: string): string {
  const words = slug.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : slug;
}

/**
 * Resolves the published URL set from the LIVE database, with labels.
 *
 * Returns null on any DB failure so callers can respond with an honest 503
 * rather than resurrecting a stale snapshot (an outage must never re-publish
 * deleted or held URLs).
 */
export async function buildSitemapGroups(): Promise<SitemapGroups | null> {
  const [prods, cats, blogs] = await Promise.all([
    fetchRows<ProductRow[]>(`products?select=${SITEMAP_PRODUCTS_SELECT}&status=in.(active,published)&order=slug.asc&limit=500`),
    fetchRows<CategoryRow[]>(`categories?select=${SITEMAP_CATEGORIES_SELECT}&is_active=eq.true&order=slug.asc&limit=200`),
    fetchRows<BlogRow[]>(`blog_posts?select=${SITEMAP_BLOG_POSTS_SELECT}&status=eq.published&order=slug.asc&limit=500`),
  ]);
  if (!prods || !cats || !blogs) return null;
  const guides = isBlogPublic()
    // Held posts keep returning 404, so they must never be advertised here.
    ? blogs.filter((b) => !isHeldBlog(b.slug))
    : [];
  return {
    // The blog is noindexed while isBlogPublic() is false, so its index page is
    // not published URL inventory either.
    pages: STATIC_ROUTES.filter((r) => isBlogPublic() || r.href !== '/blog').map((r) => ({ ...r })),
    categories: cats.map((c) => ({ href: `/category/${c.slug}`, label: c.name?.trim() || fromSlug(c.slug) })),
    guides: guides.map((b) => ({ href: `/blog/${b.slug}`, label: b.title?.trim() || fromSlug(b.slug) })),
    // Mirrors the storefront visibility gate: held + not-publicly-listable
    // products are excluded exactly as they are from the XML feed.
    products: prods
      .filter((p) => !isHeldProduct(p.slug) && isPubliclyListableProduct(p))
      .map((p) => ({ href: `/product/${p.slug || p.id}`, label: p.name?.trim() || fromSlug(p.slug || p.id) })),
  };
}

/** Every link in a groups object, flattened in section order. */
export function sitemapLinks(groups: SitemapGroups): SitemapLink[] {
  return [...groups.pages, ...groups.categories, ...groups.guides, ...groups.products];
}

/**
 * Emergency fallback, used ONLY when the live database cannot be reached.
 *
 * The 503 the worker otherwise returns is honest, but it withdraws the site
 * from crawling entirely while the outage lasts. This builder answers with a
 * MINIMAL, always-true URL set instead: only confirmed static, non-database
 * pages that exist in the shipped app regardless of catalog state. Nothing
 * database-derived ever enters this list — no /shop, no /blog, no /category/*,
 * no /product/* — and it is NOT the built public/sitemap.xml (that file is a
 * snapshot and can carry stale DB-derived URLs).
 *
 * Mirrors the DB-independent subset of STATIC_ROUTES so the emergency feed can
 * never drift from the routes the worker actually serves.
 */
export const EMERGENCY_STATIC_HREFS: readonly string[] = STATIC_ROUTES.filter(
  (r) => r.href !== '/shop' && r.href !== '/blog',
).map((r) => r.href);

/** Minimal emergency XML feed for crawlers during a database outage. */
export function buildEmergencyStaticSitemap(): string {
  const body = EMERGENCY_STATIC_HREFS.map((href) => `  <url><loc>${root}${xmlEscape(href)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/** XML feed for crawlers. Returns null on DB failure so the caller can 503. */
export async function buildSitemap(): Promise<string | null> {
  const groups = await buildSitemapGroups();
  if (!groups) return null;
  const body = sitemapLinks(groups).map((l) => `  <url><loc>${root}${xmlEscape(l.href)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/**
 * The pre-rendered body for the visitor-facing /sitemap page. Rendered from the
 * same groups as the XML feed, so the page a person browses lists exactly the
 * URLs we ask Google to index — a sitemap page that disagrees with its own XML
 * is worse than no page at all.
 *
 * Plain inline styles: Tailwind does not scan worker files.
 */
export function renderHtmlSitemapBody(groups: SitemapGroups): string {
  const listStyle = 'margin:.5rem 0 0;padding-left:1.25rem;line-height:1.9';
  const section = (title: string, links: SitemapLink[]): string => {
    if (!links.length) return '';
    const items = links
      .map((l) => `<li><a href="${htmlEscape(l.href)}">${htmlEscape(l.label)}</a></li>`)
      .join('');
    return `<section style="margin:0 0 1.75rem"><h2 style="font-size:1.05rem;margin:0">${htmlEscape(title)} (${links.length})</h2><ul style="${listStyle}">${items}</ul></section>`;
  };
  const total = sitemapLinks(groups).length;
  return [
    '<article>',
    '<h1>Sitemap</h1>',
    `<p>Every page we currently publish, in one place — ${total} URLs across the storefront, ${groups.categories.length} categories and ${groups.products.length} products. This is the same list our XML sitemap at <a href="/sitemap.xml">/sitemap.xml</a> gives search engines.</p>`,
    section('Main pages', groups.pages),
    section('Shop by category', groups.categories),
    // Plain text: htmlEscape() handles the ampersand. Passing a pre-escaped
    // entity here double-escaped it into "Guides &amp;amp; articles".
    // Empty while the blog is withdrawn from the index — section() then emits
    // nothing at all rather than an empty heading.
    section('Guides & articles', groups.guides),
    section('Products', groups.products),
    '<p>Looking for something specific? Try <a href="/shop">searching the shop</a> or <a href="/contact">contacting us</a>.</p>',
    '</article>',
  ].join('\n');
}
