// Regenerate public/sitemap.xml from the LIVE database — the same URL set the
// worker's dynamic sitemap serves (worker/sitemap.ts). This static file ships
// in the build output, so it must never carry stale/archived/deleted URLs: GSC
// keeps re-crawling what it last saw here.
//
// The eligibility decision itself is NOT duplicated here. It is imported from
// the same modules the storefront and the worker use (productEligibility.ts +
// reviewHolds.ts), so the static file and the live sitemap cannot drift apart:
// an earlier hand-maintained copy still listed KONG, a held product whose PDP
// returns 404.
//
// Included (mirrors buildSitemap exactly):
//   * static routes
//   * active storefront categories (is_active)
//   * published CMS blog posts (status=published — the RLS-visible set)
//   * publicly listable active products (isPubliclyListableProduct), minus holds
//
// Requires VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.
// Usage: node scripts/regenerate-sitemap.mjs
import fs from 'fs';
import { isHeldBlog, isHeldProduct, isBlogPublic } from '../src/content/reviewHolds.ts';
import { isPubliclyListableProduct } from '../src/content/productEligibility.ts';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const URL_BASE = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) { console.error('env missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const HEAD = { apikey: KEY, Authorization: `Bearer ${KEY}` };

class DbUnavailableError extends Error {}
const get = async (path) => {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers: HEAD });
  if (!res.ok) throw new DbUnavailableError(`${path} -> ${res.status}`);
  return res.json();
};

// Fields the shared public-listing contract (productEligibility.ts) reads.
const PRODUCT_FIELDS = [
  'id', 'slug', 'name', 'status', 'description', 'short_description', 'price',
  'image_url', 'supplier_source', 'cost_price', 'us_inventory', 'stock_status',
  'inventory_qty', 'commerce_readiness',
].join(',');

// Every query is explicitly ordered: PostgREST does not guarantee row order
// without one, which made the generated file churn between identical runs.
//
// A database outage (quota restriction, pause, network) must NOT fail the
// production build: the worker's live /sitemap.xml route degrades to a minimal
// emergency static feed in that case (worker/index.ts), so deploys keep
// shipping. The committed public/sitemap.xml is left byte-for-byte untouched —
// it is never silently rewritten with partial data.
let dbUp = true;
let prods, cats, blogs;
try {
  [prods, cats, blogs] = await Promise.all([
    get(`products?select=${PRODUCT_FIELDS}&status=in.(active,published)&order=slug.asc&limit=500`),
    get('categories?select=slug&is_active=eq.true&order=slug.asc&limit=200'),
    get('blog_posts?select=slug&status=eq.published&order=slug.asc&limit=500'),
  ]);
} catch (error) {
  if (!(error instanceof DbUnavailableError)) throw error;
  const existing = fs.existsSync('public/sitemap.xml');
  console.warn(`sitemap: DATABASE UNAVAILABLE (${error.message}) — keeping the committed sitemap.xml unchanged (${existing ? 'stale snapshot; the live worker serves the minimal emergency feed until the DB recovers' : 'no file present'})`);
  // End naturally — process.exit() here races stdio on Windows (libuv
  // async.c assertion) and the build step needs a clean exit 0.
  dbUp = false;
}

if (dbUp) {

  const listable = prods.filter((p) => !isHeldProduct(p.slug) && isPubliclyListableProduct(p));

// Must stay identical (order included) to STATIC_ROUTES in worker/sitemap.ts —
// the live /sitemap.xml is served by the worker while this file ships in the
// build output, and the two are expected to diff to zero.
// src/content/__tests__/sitemap-parity.test.ts enforces that.
const urls = ['/', '/shop', '/blog', '/about', '/contact', '/faq', '/shipping-policy', '/returns', '/copyright', '/editorial-policy', '/disclaimer', '/privacy', '/terms', '/sitemap']
  // While the blog is withdrawn from the index it is not published URL
  // inventory, so the static file drops it exactly as buildSitemapGroups does.
  // The literal above keeps /blog so this list stays comparable to STATIC_ROUTES.
  .filter((u) => isBlogPublic() || u !== '/blog');
  for (const c of cats) urls.push(`/category/${c.slug}`);
  if (isBlogPublic()) for (const b of blogs) if (!isHeldBlog(b.slug)) urls.push(`/blog/${b.slug}`);
  for (const p of listable) urls.push(`/product/${p.slug || p.id}`);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>https://luxedge.us${u}</loc></url>`).join('\n')}
</urlset>
`;
  fs.writeFileSync('public/sitemap.xml', xml);
  const publishedGuides = isBlogPublic() ? blogs.filter((b) => !isHeldBlog(b.slug)).length : 0;
  console.log(`sitemap: ${urls.length} URLs (${publishedGuides} published blogs, ${cats.length} categories, ${listable.length} publicly listable products)`);
}
