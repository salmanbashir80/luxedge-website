// ============================================================================
// LUXEDGE — worker-side SEO meta + content injection (one path for every UA)
//
// The storefront is a client-rendered SPA, so every route serves the same
// generic index.html shell. This module rewrites the shell for the requested
// route BEFORE it is returned, for ALL user agents (no bot detection):
//   /product/:slug    → product seo_title/seo_description + Product + Breadcrumb
//                       JSON-LD + a pre-rendered product summary in #root
//                       (title, price, stock/shipping facts, description,
//                       category link) — the same content the client renders
//   /blog/:slug       → post title/excerpt + BlogPosting/FAQPage JSON-LD + the
//                       article body pre-rendered into #root (same content the
//                       client renders, with its real internal links)
//   /category/:slug   → category name + CollectionPage JSON-LD + a pre-rendered
//                       category intro with real product links (mirrors the
//                       client category grid)
//   / (homepage)      → WebSite JSON-LD + pre-rendered hero + category navigation
//   /about            → unique title/description + About copy pre-rendered from
//                       src/content/about.ts (same copy the client renders)
//   static pages      → unique title/description
// Every indexable route also gets an exact route-specific canonical + og:url.
// React's createRoot().render() replaces #root on mount, so JS users see the
// identical client-rendered content — no duplicated or hidden content.
// No secrets — reads Supabase with the anon key exactly like api/google-feed.ts.
// ============================================================================

import { ABOUT_QUOTE, ABOUT_LEAD, ABOUT_SECTIONS } from '../src/content/about';
import { isHeldProduct, isHeldMedia, isHeldBlog, isRetiredPublicPath, isRetiredBlogSlug, isBlogPublic } from '../src/content/reviewHolds';
import { isPubliclyListableProduct } from '../src/content/productEligibility';
import {
  CONTACT_INFO,
  CONTACT_INTRO,
  PRIVACY_SECTIONS,
  TERMS_SECTIONS,
  RETURNS_SECTIONS,
  SHIPPING_SECTIONS,
  FAQ_DATA,
  COPYRIGHT_SECTIONS,
  DISCLAIMER_SECTIONS,
  EDITORIAL_SECTIONS,
  POLICY_LAST_UPDATED,
} from '../src/content/policies';
import { SEO_PRODUCTS_SELECT, SEO_CATEGORIES_SELECT, SEO_BLOG_POSTS_SELECT, SEO_MEDIA_SELECT } from './selects';
import { buildSitemapGroups, renderHtmlSitemapBody } from './sitemap';
import { merchantOfferExtras } from '../src/features/catalog/seo';
import { categoryContentFor } from '../src/content/categoryContent';
import { authorFor } from '../src/content/authors';
import { SSR_FOOTER_NAV } from '../src/content/navigation';
import { productContentFor } from '../src/content/productContent';
import { readPostgrestPath } from './d1/read';
import { isD1Backend } from './d1/runtime';
import { productFacts, FREE_SHIPPING_CLAIM } from '../src/content/productFacts';
import {
  HOME_SECTIONS,
  HOME_FAQ,
  CONTACT_SECTIONS,
  type SiteSection,
  type SiteFaqItem,
} from '../src/content/sitePages';

export interface SeoEnv {
  ASSETS: {
    fetch(input: Request): Promise<Response>;
  };
}

interface RouteMeta {
  title: string;
  description: string;
  canonical: string;
  noindex?: boolean;
  /** Per-page social/preview image (absolute URL). Falls back to the shell's
   * static og:image (luxedge-mark.png) when absent. */
  ogImage?: string | null;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const cleanText = (d: string | null | undefined, max = 400): string => {
  const plain = (d || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
};

/** Lightweight canonical + og:url rewrite used when route data is unavailable
 * so no content route is ever served with the homepage canonical. */
function injectCanonical(html: string, canonical: string): string {
  let out = html;
  out = out.replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${esc(canonical)}" />`);
  out = out.replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${esc(canonical)}" />`);
  return out;
}

// ---------------------------------------------------------------------------
// Data access — Cloudflare D1 when DATA_BACKEND=d1 (see worker/d1/read.ts),
// otherwise the Supabase anon REST path this module has always used. The path
// strings themselves are unchanged PostgREST sub-paths, so switching backends
// requires no query edits here.
// ---------------------------------------------------------------------------

function supabaseBase(): string {
  return (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
}
function supabaseAnon(): string {
  return (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
}

export interface ProductRow {
  id: string;
  slug?: string | null;
  name: string;
  status?: string | null;
  description?: string | null;
  short_description?: string | null;
  /** Owner-editable detail columns. Raw jsonb — formatted by productFacts(). */
  long_description?: string | null;
  features?: unknown;
  specifications?: unknown;
  weight_oz?: number | null;
  seo_title?: string | null;
  seo_description?: string | null;
  seo_keywords?: string | null;
  price?: number | null;
  compare_at_price?: number | null;
  brand?: string | null;
  /** Legacy absolute product image URL (products.image_url). */
  image_url?: string | null;
  stock_status?: string | null;
  inventory_qty?: number | null;
  us_inventory?: boolean | null;
  free_shipping?: boolean | null;
  shipping_cost?: number | null;
  delivery_min_days?: number | null;
  delivery_max_days?: number | null;
  currency?: string | null;
  supplier_source?: string | null;
  supplier_product_ref?: string | null;
  cost_price?: number | null;
  commerce_readiness?: string | null;
  /** Postgres text[] arrives as an array, but legacy rows hold a comma
   * separated string, so the cat-category tag check below handles both. */
  tags?: string[] | string | null;
  /** Embedded category name via categories(name) — the REST key is the
   * relation name `categories`. */
  categories?: { name?: string } | null;
  /** Embedded product images via product_images(url,public_url,is_primary,sort_order). */
  product_images?: ProductImageRow[] | null;
}

interface ProductImageRow {
  product_id?: string | null;
  url?: string | null;
  public_url?: string | null;
  is_primary?: boolean | null;
  sort_order?: number | null;
}

const cache = new Map<string, { ts: number; data: unknown }>();
const TTL_DB = 15 * 60 * 1000;

async function cachedFetch<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < ttl) return hit.data as T;
  try {
    const data = await fn();
    cache.set(key, { ts: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

async function fetchJson<T>(base: string, key: string, path: string): Promise<T | null> {
  // D1 first when the environment selects it. Checked explicitly rather than
  // "try D1 then fall back", so a D1 outage surfaces as null (the honest
  // unavailable path) instead of being masked by a second failing backend.
  // Single data boundary: T is the row-array shape the caller already asserts,
  // matching what the previous `JSON.parse(text) as T` cast did.
  if (isD1Backend()) return (await readPostgrestPath(path)) as unknown as T | null;
  try {
    const res = await fetch(`${base}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

async function getProducts(): Promise<ProductRow[] | null> {
  const base = supabaseBase();
  const key = supabaseAnon();
  if (!base || !key) return null;
  // Page-specific fields the storefront shows: short/long description, price,
  // stock, shipping and delivery estimates, plus the embedded category name for
  // a contextual "More in {category}" link. features/specifications are mostly
  // empty in the live catalog, so they are deliberately not pre-rendered.
  //
  // Images come from a SEPARATE query (getProductImages) filtered to real HTTP
  // URLs — excluding the inline base64 blobs that made the embedded products
  // payload ~9 MB and every cache-expiry page load 1-2s slower.
  return cachedFetch('seo:products', TTL_DB, async () => {
    const [products, images] = await Promise.all([
      fetchJson<ProductRow[]>(
        base,
        key,
        `products?select=${SEO_PRODUCTS_SELECT}&status=in.(active,published)&limit=500`,
      ),
      getProductImages(),
    ]);
    if (!products) return null;
    if (images && images.length) {
      const byProduct = new Map<string, ProductImageRow[]>();
      for (const img of images) {
        if (!img.product_id) continue;
        const arr = byProduct.get(img.product_id) || [];
        arr.push(img);
        byProduct.set(img.product_id, arr);
      }
      if (byProduct.size) {
        for (const p of products) {
          const list = byProduct.get(p.id);
          if (list) {
            // Keep the same ordering consumers expect: primary first, then sort.
            // is_primary arrives as boolean (Postgres) or 0/1 (D1) — Number()
            // normalizes both; a strict === true would break D1 ordering.
            p.product_images = list.slice().sort(
              (a, b) =>
                (Number(!!b.is_primary) - Number(!!a.is_primary)) ||
                ((a.sort_order ?? 0) - (b.sort_order ?? 0)),
            );
          }
        }
      }
    }
    return products;
  });
}

/** Lightweight image rows for SEO products — HTTP URLs only (no base64 blobs). */
async function getProductImages(): Promise<ProductImageRow[] | null> {
  const base = supabaseBase();
  const key = supabaseAnon();
  if (!base || !key) return null;
  return cachedFetch('seo:product-images', TTL_DB, () =>
    fetchJson<ProductImageRow[]>(
      base,
      key,
      `product_images?select=product_id,url,public_url,is_primary,sort_order&url=not.like.data:*&limit=3000`,
    ),
  );
}

export interface CategoryRow {
  slug: string;
  name: string;
}

async function getCategories(): Promise<CategoryRow[] | null> {
  const base = supabaseBase();
  const key = supabaseAnon();
  if (!base || !key) return null;
  return cachedFetch('seo:categories', TTL_DB, () =>
    fetchJson<CategoryRow[]>(base, key, `categories?select=${SEO_CATEGORIES_SELECT}&limit=200`),
  );
}

interface BlogEntry {
  slug: string;
  title: string;
  excerpt: string;
  image?: string;
  date?: string;
  authorName?: string;
  /** Full markdown-ish body (same source the client renders from). */
  content?: string;
  /** Visible FAQ section, mirrored as FAQPage JSON-LD — never schema-only. */
  faq?: { q: string; a: string }[];
}

interface BlogCmsRow {
  slug: string;
  title: string;
  excerpt?: string | null;
  hero_image_url?: string | null;
  published_at?: string | null;
  created_at?: string | null;
  author_name?: string | null;
  content?: string | null;
  faq?: { q: string; a: string }[] | null;
}

function mapCmsToBlogEntry(r: BlogCmsRow): BlogEntry | null {
  if (!r || !r.slug) return null;
  const date = (r.published_at || r.created_at || '').slice(0, 10) || undefined;
  return {
    slug: r.slug,
    title: r.title || r.slug,
    excerpt: r.excerpt || r.title || '',
    image: r.hero_image_url || undefined,
    date,
    // Truthful default attribution: when the CMS row has no individual author,
    // attribute the article to the editorial team instead of a bare brand name
    // or an invented persona.
    authorName: r.author_name || 'Luxedge Editorial Team',
    content: r.content || undefined,
    faq: Array.isArray(r.faq) && r.faq.length ? r.faq : undefined,
  };
}

export interface MediaEntry {
  slug: string;
  title: string;
  summary: string;
  description: string;
  seoTitle?: string | null;
  metaDescription?: string | null;
  thumbnail?: string | null;
  youtubeVideoId?: string | null;
  category: string;
  isShort: boolean;
  featured: boolean;
  publishedAt?: string | null;
  duration?: string | null;
  transcript?: string | null;
  chapters: { t: string; title: string }[];
  faq?: { q: string; a: string }[];
  relatedProductIds: string[];
  relatedArticleSlugs: string[];
  relatedVideoSlugs: string[];
}

interface MediaCmsRow {
  slug: string;
  title: string;
  summary?: string | null;
  description?: string | null;
  seo_title?: string | null;
  meta_description?: string | null;
  thumbnail_url?: string | null;
  custom_thumbnail_url?: string | null;
  youtube_video_id?: string | null;
  category?: string | null;
  is_short?: boolean | null;
  featured?: boolean | null;
  published_at?: string | null;
  duration?: string | null;
  transcript?: string | null;
  chapters?: { t: string; title: string }[] | null;
  faq?: { q: string; a: string }[] | null;
  related_product_ids?: string[] | null;
  related_article_slugs?: string[] | null;
  related_video_slugs?: string[] | null;
}

function mapCmsToMediaEntry(r: MediaCmsRow): MediaEntry | null {
  if (!r || !r.slug || isHeldMedia(r.slug)) return null;
  return {
    slug: r.slug,
    title: r.title || r.slug,
    summary: r.summary || '',
    description: r.description || '',
    seoTitle: r.seo_title || null,
    metaDescription: r.meta_description || null,
    // Custom editorial thumbnail wins over YouTube's real thumbnail.
    thumbnail: r.custom_thumbnail_url || r.thumbnail_url || null,
    youtubeVideoId: r.youtube_video_id || null,
    category: r.category || 'product-education',
    isShort: r.is_short === true,
    featured: r.featured === true,
    publishedAt: r.published_at || null,
    duration: r.duration || null,
    transcript: r.transcript || null,
    chapters: Array.isArray(r.chapters)
      ? r.chapters.filter((c) => !!c && typeof c.t === 'string' && typeof c.title === 'string')
      : [],
    faq: Array.isArray(r.faq) && r.faq.length ? r.faq : undefined,
    relatedProductIds: Array.isArray(r.related_product_ids) ? r.related_product_ids.filter((x): x is string => typeof x === 'string') : [],
    relatedArticleSlugs: Array.isArray(r.related_article_slugs) ? r.related_article_slugs.filter((x): x is string => typeof x === 'string') : [],
    relatedVideoSlugs: Array.isArray(r.related_video_slugs) ? r.related_video_slugs.filter((x): x is string => typeof x === 'string') : [],
  };
}

/**
 * Media registry — source of truth is the Supabase `media_videos` table
 * (published only; RLS enforces published + published_at <= now()). Short TTL
 * so a newly published video gets SEO + indexability on the next worker
 * requests WITHOUT a redeploy. Returns null when the DB is unreachable / the
 * table is not yet migrated so callers keep the canonical correct.
 */
async function getMediaRegistry(): Promise<MediaEntry[] | null> {
  const base = supabaseBase();
  const key = supabaseAnon();
  if (!base || !key) return null;
  return cachedFetch<MediaEntry[]>('seo:media', 60_000, async () => {
    const rows = await fetchJson<MediaCmsRow[]>(
      base,
      key,
      `media_videos?select=${SEO_MEDIA_SELECT}&status=eq.published&order=published_at.desc`,
    );
    if (!rows) throw new Error('media_videos unavailable');
    return rows
      .map(mapCmsToMediaEntry)
      .filter((x): x is MediaEntry => x !== null);
  });
}

/**
 * Blog registry — source of truth is the Supabase CMS (published only; RLS
 * enforces published + published_at <= now()). Short TTL so a freshly
 * published CMS post gets SEO + indexability on the very next worker requests
 * WITHOUT a redeploy. A CMS failure returns null: legacy static blog content
 * must never be revived as an indexable fallback.
 */
async function getBlogRegistry(_origin: string, _env: SeoEnv): Promise<BlogEntry[] | null> {
  const base = supabaseBase();
  const key = supabaseAnon();
  if (base && key) {
    const cms = await cachedFetch<BlogEntry[]>('seo:blog-cms', 60_000, async () => {
      const rows = await fetchJson<BlogCmsRow[]>(
        base,
        key,
        `blog_posts?select=${SEO_BLOG_POSTS_SELECT}&status=eq.published&order=published_at.desc`,
      );
      if (!rows) throw new Error('blog_cms unavailable');
      return rows
        .map(mapCmsToBlogEntry)
        .filter((x): x is BlogEntry => x !== null && !isHeldBlog(x.slug));
    });
    if (cms) return cms;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Static pages
// ---------------------------------------------------------------------------

const STATIC_PAGES: Record<string, { title: string; description: string }> = {
  '/shop': {
    title: 'Shop All Pet Essentials — Dog, Cat, Bird, Horse & More | Luxedge',
    description:
      'Browse the Luxedge curated collection — dog beds and leashes, cat toys and fountains, bird feeders, horse grooming and livestock essentials, all sourced and ready to ship.',
  },
  '/about': {
    title: 'About Luxedge — Premium Pet Essentials',
    description:
      'Luxedge curates useful essentials for pets and animals — thoughtfully selected, sourced from verified suppliers, and shipped to your door.',
  },
  '/contact': {
    title: 'Contact Luxedge — We Are Here to Help',
    description:
      'Questions about an order, a product, or shipping? Contact the Luxedge support team and we will get back to you.',
  },
  '/faq': {
    title: 'FAQ — Shipping, Returns & Product Questions | Luxedge',
    description:
      'Answers to common questions about Luxedge — shipping times, order tracking, returns, and how our curated pet essentials are sourced.',
  },
  '/sitemap': {
    // The visitor-facing HTML sitemap. It exists so the footer's "Sitemap" link
    // opens a readable page instead of dumping raw XML in the browser, and so a
    // human can reach every published URL without relying on the XML feed.
    title: 'Sitemap — Every Page on Luxedge',
    description:
      'Browse every page on Luxedge in one place: the full product catalog, shop categories, care guides, and our shipping, returns, privacy and terms pages.',
  },
  '/careers': {
    // Registered so the pre-render below actually runs. CareersPage is a live
    // client route with an injectCareersBody() twin, but without this entry
    // STATIC_PAGES lookup missed and /careers fell through to the trailing
    // 404 branch — the page 404'd for crawlers and cold visits even though the
    // SPA rendered it fine.
    title: 'Careers at Luxedge — Join the Team',
    description:
      'Join the Luxedge team. Open roles in product curation, content and customer support, fully remote, plus the chance to reach out about work that is not listed yet.',
  },
  '/shipping-policy': {
    // Describes what the page actually contains. The retired description
    // advertised site-wide delivery windows drawn from sourcing data,
    // but the policy deliberately shows each window per product and at checkout
    // rather than publishing one number, so the old copy overstated the page.
    title: 'Shipping Policy — Delivery, Costs & Tracking | Luxedge',
    description:
      'How Luxedge ships: where we deliver, how shipping is calculated before payment, what affects your delivery estimate, and what to do about a missing package.',
  },
  '/returns': {
    title: 'Returns & Replacement Policy | Luxedge',
    description:
      'How Luxedge returns work: request within 30 days for damaged, defective, or incorrect items, with replacement or refund where the law requires it.',
  },
  '/copyright': {
    title: 'Copyright & DMCA — Reporting Infringement | Luxedge',
    description:
      'How Luxedge handles copyright: what we own, how to reuse our content, and how a rights holder can report allegedly infringing material with a DMCA-style notice.',
  },
  '/editorial-policy': {
    title: 'Editorial Policy — How Luxedge Guides Are Prepared',
    description:
      'How Luxedge prepares, checks, updates, sources, and corrects its animal-care buying guides and editorial content.',
  },
  '/disclaimer': {
    title: 'Disclaimer — Luxedge Product and Animal-Care Information',
    description:
      'Important limits on Luxedge product information and general animal-care content, including health, safety, and professional-care boundaries.',
  },
  '/privacy': {
    title: 'Privacy Policy | Luxedge',
    description:
      'How Luxedge collects, uses, and protects your personal information when you shop with us.',
  },
  '/terms': {
    title: 'Terms of Service | Luxedge',
    description:
      'The rules for using Luxedge: orders and payment, shipping estimates, product information, returns, and liability, written in plain language.',
  },
};

// ---------------------------------------------------------------------------
// Security headers (single source of truth — applied by worker/index.ts to
// every response it builds; static assets get them via the ASSETS pass-through
// wrapper). CSP ships as Report-Only first: it logs violations without
// blocking, so the enforcing flip can happen later from real report data.
// ---------------------------------------------------------------------------

/** Directives every page needs regardless of route. Derived from the origins
 * the production site actually loads/calls (audited 2026-09): the SPA bundle,
 * AdSense scripts, GA4 via googletagmanager, Supabase REST/storage
 * + auth, YouTube embeds/thumbnails, the ad networks' creative/pixel hosts,
 * and Wikimedia/Pexels/Unsplash editorial + product imagery. */
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  // 'unsafe-inline' is required by the AdSense
  // loader; blob:/data: cover media workers and inline previews.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://pagead2.googlesyndication.com https://www.googletagmanager.com https://*.supabase.co",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https://img.cjdropshipping.com https://images.pexels.com https://images.unsplash.com https://upload.wikimedia.org https://i.ytimg.com https://*.supabase.co https://www.google.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://pagead2.googlesyndication.com",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://www.google-analytics.com https://analytics.google.com https://www.googletagmanager.com https://pagead2.googlesyndication.com",
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://googleads.g.doubleclick.net",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "upgrade-insecure-requests",
].join('; ');

/** Header map merged into every response the Worker returns. HSTS starts
 * conservative (1 day, includeSubDomains) — raise to max-age=31536000 only
 * after every subdomain is confirmed permanently HTTPS; never preload. */
export const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'strict-origin-when-cross-origin',
  // The site uses no camera/mic/geo/payment APIs; deny the high-value ones.
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'strict-transport-security': 'max-age=86400; includeSubDomains',
  'content-security-policy-report-only': CSP_REPORT_ONLY,
};

/** Copy a response, adding the security headers without clobbering the ones
 * the original already set (first writer wins, so handlers can override). */
export function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!out.headers.has(k)) out.headers.set(k, v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// JSON-LD builders
// ---------------------------------------------------------------------------

/** Absolute, crawlable image URLs for JSON-LD: the embedded product_images
 * primary-first (relative assets are absolutized to the canonical origin the
 * ASSETS binding serves), falling back to the legacy products.image_url.
 * Empty only when the catalog genuinely has no image — never fabricated. */
export function productImageUrls(p: ProductRow): string[] {
  const origin = 'https://luxedge.us';
  const abs = (u?: string | null): string | null => {
    if (!u) return null;
    const s = u.trim();
    // Only absolute http(s) URLs or site-relative paths — a bare token like
    // "garbage" must not silently become https://luxedge.us/garbage.
    if (!/^(https?:\/\/|\/(?!\/)|[./])/i.test(s)) return null;
    const href = new URL(s, origin).href;
    return /^https?:\/\//i.test(href) ? href : null;
  };
  const rows = (p.product_images || []).slice().sort(
    (a, b) =>
      Number(!!b.is_primary) - Number(!!a.is_primary) ||
      (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );
  const urls = rows.map((r) => abs(r.url || r.public_url)).filter((u): u is string => !!u);
  if (!urls.length) {
    const fb = abs(p.image_url);
    if (fb) urls.push(fb);
  }
  return urls;
}

export function productJsonLd(p: ProductRow, canonical: string): Record<string, unknown> {
  const offers: Record<string, unknown> = {
    '@type': 'Offer',
    price: Number(p.price ?? 0).toFixed(2),
    priceCurrency: 'USD',
    url: canonical,
  };
  if (p.stock_status === 'in_stock' || p.us_inventory === true) offers.availability = 'https://schema.org/InStock';
  else if (p.stock_status && p.stock_status !== 'in_stock') offers.availability = 'https://schema.org/OutOfStock';
  // GSC merchant-listing warnings: real return policy + shipping details.
  Object.assign(offers, merchantOfferExtras({
    freeShipping: p.free_shipping,
    shippingCost: p.shipping_cost,
    deliveryMinDays: p.delivery_min_days,
    deliveryMaxDays: p.delivery_max_days,
    currency: p.currency,
  }));
  const product: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: cleanText(p.seo_description || p.description || ''),
    url: canonical,
    offers,
  };
  const images = productImageUrls(p);
  if (images.length) product.image = images.slice(0, 8);
  // Brand is published only when the catalog records a real product brand, and
  // never the retailer's own name — the store is not the manufacturer of these
  // third-party goods. Matches the client JSON-LD and the merchant feed.
  const brand = (p.brand || '').trim();
  if (brand && brand.toLowerCase() !== 'luxedge') product.brand = { '@type': 'Brand', name: brand };
  return product;
}

function breadcrumbJsonLd(name: string, canonical: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://luxedge.us' },
      { '@type': 'ListItem', position: 2, name, item: canonical },
    ],
  };
}

function blogJsonLd(b: BlogEntry, canonical: string): Record<string, unknown>[] {
  const post: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: b.title,
    description: b.excerpt,
    mainEntityOfPage: canonical,
  };
  if (b.date) post.datePublished = b.date;
  // Truthful organic attribution (BlogPosting is a Person schema): default to
  // the editorial team when no individual author is recorded in the CMS.
  post.author = { '@type': 'Person', name: b.authorName || 'Luxedge Editorial Team' };
  if (b.image) post.image = b.image;
  const blocks: Record<string, unknown>[] = [post];
  if (b.faq && b.faq.length) {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: b.faq.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Media JSON-LD + body pre-render
// ---------------------------------------------------------------------------

/** VideoObject (real data only) + BreadcrumbList. Fields with no real value
 * are omitted entirely — nothing is ever fabricated.
 *
 * No FAQPage here, by owner decision: media pages are noindexed, so FAQ markup
 * is schema for a page we do not ask Google to index. Any FAQ the page shows
 * stays visible and unmarked. */
export function mediaJsonLd(v: MediaEntry, canonical: string): Record<string, unknown>[] {
  // Home → Media → video — matches the breadcrumb the client actually renders.
  const blocks: Record<string, unknown>[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://luxedge.us' },
        { '@type': 'ListItem', position: 2, name: 'Media', item: 'https://luxedge.us/media' },
        { '@type': 'ListItem', position: 3, name: v.title, item: canonical },
      ],
    },
  ];
  if (v.youtubeVideoId) {
    const video: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      name: v.title,
      description: cleanText(v.metaDescription || v.summary || v.description || v.title, 400),
      thumbnailUrl: v.thumbnail || undefined,
      uploadDate: v.publishedAt || undefined,
      embedUrl: `https://www.youtube.com/embed/${v.youtubeVideoId}`,
      contentUrl: `https://www.youtube.com/watch?v=${v.youtubeVideoId}`,
    };
    if (v.duration) video.duration = v.duration;
    blocks.push(video);
  }
  return blocks;
}

/** Pre-renders the /media hub index with real video links + thumbnails from
 * the CMS, so the initial HTML shows the actual video cards. */
async function injectMediaIndexBody(html: string): Promise<string> {
  const media = await getMediaRegistry();
  const items = media && media.length
    ? media
        .slice(0, 15)
        .map((v) => {
          const thumb = v.thumbnail
            ? `<br /><img src="${esc(v.thumbnail)}" alt="${esc(v.title)}" loading="lazy" width="480" height="270" />`
            : '';
          return `<li><a href="/media/${esc(v.slug)}">${esc(v.title)}</a>${thumb}</li>`;
        })
        .join('')
    : '<li>Videos from the official Luxedge YouTube channel are added here as they are published.</li>';
  const parts: string[] = [
    `<h1>Luxedge Media</h1>`,
    `<p>Films, guides and stories from the Luxedge team — how our products are made, how to care for the animals you love, and honest buying advice. Videos are hosted on the official Luxedge YouTube channel and embedded here.</p>`,
    `<h2>Latest Videos</h2>`,
    `<ul>${items}</ul>`,
  ];
  return html.replace('<div id="ssr-body"></div>', `<article>${parts.join('\n')}</article>`);
}

/** Pre-renders a /media/:slug video page with its real editorial substance. */
async function injectMediaBody(html: string, v: MediaEntry): Promise<string> {
  const parts: string[] = [
    `<h1>${esc(v.title)}</h1>`,
  ];
  if (v.publishedAt) parts.push(`<p><time datetime="${esc(v.publishedAt)}">${esc(v.publishedAt.slice(0, 10))}</time></p>`);
  if (v.youtubeVideoId) {
    // Server-rendered iframe: the video embed is real markup in the initial
    // HTML, so the crawler can verify the video a VideoObject points at
    // (frame-src already allows youtube.com). The watch link stays for any
    // client that blocks frames.
    parts.push(
      `<iframe src="https://www.youtube.com/embed/${esc(v.youtubeVideoId)}" title="${esc(v.title)}" loading="lazy" allowfullscreen></iframe>`,
    );
    parts.push(`<p><a href="https://www.youtube.com/watch?v=${esc(v.youtubeVideoId)}">Watch on YouTube</a></p>`);
  } else if (v.thumbnail) {
    parts.push(`<p><img src="${esc(v.thumbnail)}" alt="${esc(v.title)}" loading="lazy" /></p>`);
  }
  if (v.summary) parts.push(`<p>${esc(v.summary)}</p>`);
  if (v.description) parts.push(`<p>${esc(v.description).replace(/\n+/g, '</p><p>')}</p>`);
  if (v.chapters.length) {
    parts.push(`<h2>Chapters</h2>`, `<ol>${v.chapters.map((c) => `<li>${esc(c.t)} — ${esc(c.title)}</li>`).join('')}</ol>`);
  }
  if (v.faq && v.faq.length) {
    parts.push(`<h2>Frequently Asked Questions</h2>`);
    for (const f of v.faq) parts.push(`<h3>${esc(f.q)}</h3>`, `<p>${esc(f.a)}</p>`);
  }
  if (v.transcript) {
    parts.push(`<h2>Transcript</h2>`, `<p>${esc(v.transcript).replace(/\n+/g, '</p><p>')}</p>`);
  }
  return html.replace('<div id="ssr-body"></div>', `<article>${parts.join('\n')}</article>`);
}

// ---------------------------------------------------------------------------
// Head injection
// ---------------------------------------------------------------------------

/**
 * Crawlable sitewide footer navigation, server-rendered into #root on every
 * route (the React footer is client-side only, so without this the utility
 * pages — /blog, /media, /about, /contact, legal — have zero SSR inbound
 * links and are reachable only via the sitemap). Lives INSIDE #root so React
 * replaces it with the real footer on hydration: no duplication, no hidden
 * text. The links come from src/content/navigation.ts, the same module the
 * React header, drawer and footer read. Plain inline styling — Tailwind does
 * not scan this file.
 */
const FOOTER_NAV =
  '<nav aria-label="Site" style="margin-top:2rem;padding:1rem 0;border-top:1px solid #e5e7eb;font-size:13px;line-height:1.8">' +
  SSR_FOOTER_NAV.map(({ label, to }) => `<a href="${to}">${label}</a>`).join(' \u00b7 ') +
  // Business identity in the crawlable footer too: a reviewer reading the
  // server response (no JS) should still learn who operates the store.
  '<p style="margin:.75rem 0 0;font-size:12px;color:#6b7280">Luxedge is operated by Embani LLC \u00b7 Denver, CO.</p>' +
  '</nav>';

function inject(html: string, meta: RouteMeta): string {
  let out = html;
  // Pre-fill #root with the footer nav and a nested mount point; route-body
  // injectors then fill #ssr-body (see the replace targets below).
  out = out.replace(
    '<div id="root"></div>',
    `<div id="root"><div id="ssr-body"></div>${FOOTER_NAV}</div>`,
  );
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${esc(meta.title)}</title>`);
  out = out.replace(
    /<meta name="description" content="[^"]*" \/>/,
    `<meta name="description" content="${esc(meta.description)}" />`,
  );
  out = out.replace(
    /<meta name="robots" content="[^"]*" \/>/,
    `<meta name="robots" content="${meta.noindex ? 'noindex, nofollow' : 'index, follow'}" />`,
  );
  out = out.replace(
    /<link rel="canonical" href="[^"]*" \/>/,
    `<link rel="canonical" href="${esc(meta.canonical)}" />`,
  );
  out = out.replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${esc(meta.title)}" />`);
  out = out.replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${esc(meta.description)}" />`);
  out = out.replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${esc(meta.canonical)}" />`);
  if (meta.ogImage) {
    // Per-page image: replace the shell default on both card protocols.
    out = out.replace(/<meta property="og:image" content="[^"]*" \/>/, `<meta property="og:image" content="${esc(meta.ogImage)}" />`);
    out = out.replace(/<meta name="twitter:image" content="[^"]*" \/>/, `<meta name="twitter:image" content="${esc(meta.ogImage)}" />`);
  }
  out = out.replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${esc(meta.title)}" />`);
  out = out.replace(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${esc(meta.description)}" />`);
  if (meta.jsonLd) {
    const blocks = Array.isArray(meta.jsonLd) ? meta.jsonLd : [meta.jsonLd];
    const script = blocks
      .map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`)
      .join('\n');
    out = out.replace('</head>', `${script}\n</head>`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Article body pre-render + route resolution (one semantic path for every UA)
// ---------------------------------------------------------------------------

/** Escape for text and attribute contexts (same rules as esc()). */
function inlineMarkup(text: string): string {
  // Mirrors the client renderer (src/App.tsx renderInline): [label](/path)
  // becomes a real <a>; everything else is plain escaped text.
  const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g).filter(Boolean);
  return parts
    .map((part) => {
      const m = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (m) {
        const path = m[2];
        // A link to a held product or a deleted route would 404 for the
        // crawler (and the visitor). Render the anchor text as plain text
        // instead: the sentence stays readable, the dead link never ships.
        if (isRetiredPublicPath(path)) return esc(m[1]);
        const productSlug = path.match(/^\/product\/([^/?#]+)/)?.[1];
        if (productSlug && isHeldProduct(productSlug)) return esc(m[1]);
        return `<a href="${esc(path)}">${esc(m[1])}</a>`;
      }
      return esc(part);
    })
    .join('');
}

/** Renders the article body exactly like the client (## → h2, # → h1, else <p>;
 * the client shows `### ` FAQ lines as plain paragraphs, so we mirror that too). */
function renderArticleBody(content: string): string {
  return content
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (!t) return '<br />';
      if (t.startsWith('## ')) return `<h2>${esc(t.slice(3))}</h2>`;
      if (t.startsWith('# ')) return `<h1>${esc(t.slice(2))}</h1>`;
      return `<p>${inlineMarkup(t)}</p>`;
    })
    .join('\n');
}

/** Injects the pre-rendered article (title, image, body with real internal
 * links) into the SPA shell's #root. React's createRoot().render() replaces
 * #root on mount, so JS users see the identical client-rendered article — no
 * duplication, no hidden/SEO-only markup. */
function injectArticleBody(html: string, post: BlogEntry): string {
  const image = post.image ? `<img src="${esc(post.image)}" alt="${esc(post.title)}" />` : '';
  const author = post.authorName || 'Luxedge Editorial Team';
  const date = post.date
    ? new Date(post.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '';
  const byline = `<p>Written by ${esc(author)}${date ? ' \u2014 ' + esc(date) : ''}</p>`;
  const editorialNote = author === 'Luxedge Editorial Team'
    ? '<p><em>Buying guides are prepared by the Luxedge editorial team for general product information. Always follow the product label and instructions.</em></p>'
    : '';
  const body = renderArticleBody(post.content || post.excerpt || '');
  const article = `<article><h1>${esc(post.title)}</h1>${byline}${editorialNote}${image}${body}</article>`;
  return html.replace('<div id="ssr-body"></div>', `${article}`);
}

// ---------------------------------------------------------------------------
// Pre-rendered route bodies (product / category / homepage / about)
// ---------------------------------------------------------------------------

/** Static category intros — mirrors CAT_META in src/App.tsx (keep in sync).
 * Used only when the live categories table has no description for the slug,
 * so the pre-render and the client category header show the same line. */
const CATEGORY_DESC: Record<string, string> = {
  'dog-supplies': 'Walking, training & everyday dog essentials',
  'cat-supplies': 'Play, comfort & everyday cat essentials',
  'pet-beds': 'Comfort-led pieces for deeper rest',
  'pet-toys': 'Interactive play and everyday enrichment',
  'feeding-water': 'Considered pieces for daily mealtimes',
  grooming: 'Simple tools for everyday care',
  'pet-accessories': 'Useful pieces for life together',
  'bird-supplies': 'Seed, feed & care essentials for feathered friends',
  horse: 'Practical care and stable essentials for horses',
  cattle: 'Useful feeding and care essentials for cattle and livestock',
};

function money(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `$${n.toFixed(2)}`;
}

/** Pre-renders the product essentials into the SPA shell: the same title,
 * price, stock/shipping facts, description and category link the Product
 * detail page renders after hydration. Only real catalog columns are used —
 * nothing is invented. */
/** Exported so the product-facts test can render the crawl copy and compare it
 * to the React rows string-for-string. */
export function injectProductBody(html: string, p: ProductRow): string {
  const parts: string[] = [`<h1>${esc(p.name)}</h1>`];
  const price = money(p.price);
  const compare = money(p.compare_at_price);
  if (price) {
    parts.push(compare ? `<p>Price: <strong>${price}</strong> <s>${compare}</s></p>` : `<p>Price: <strong>${price}</strong></p>`);
  }
  const facts: string[] = [];
  if (p.stock_status === 'in_stock' || p.us_inventory === true) facts.push('In stock');
  else if (p.stock_status && p.stock_status !== 'in_stock') facts.push('Availability confirmed at checkout');
  if (p.free_shipping === true) facts.push(FREE_SHIPPING_CLAIM);
  else if (p.shipping_cost && Number(p.shipping_cost) > 0) facts.push(`Shipping ${money(p.shipping_cost)}`);
  facts.push('Delivery timing confirmed during order processing');
  if (facts.length) parts.push(`<p>${esc(facts.join(' · '))}</p>`);
  const lead = (p.short_description || '').trim() || (p.description || '').trim();
  if (lead) parts.push(`<h2>Details</h2>`, `<p>${esc(lead)}</p>`);
  if (p.description && p.description.trim() && p.description.trim() !== lead) {
    parts.push(`<h2>Description</h2>`);
    parts.push(...p.description.split(/\n+/).filter((l) => l.trim()).map((l) => `<p>${esc(l)}</p>`));
  }
  // Owner-editable catalog detail (src/content/productFacts.ts), rendered by the
  // same formatter the React product page uses so the crawler and the visitor
  // get the same rows. A product whose fields are empty gets no new markup —
  // no empty sections, no placeholder values, nothing guessed.
  const ownerFacts = productFacts({
    features: p.features,
    specifications: p.specifications,
    longDescription: p.long_description,
    weightOz: p.weight_oz,
    description: p.description,
  });
  if (ownerFacts.longDescription) {
    parts.push(`<h2>Full description</h2>`);
    parts.push(...ownerFacts.longDescription.split(/\n+/).filter((l) => l.trim()).map((l) => `<p>${esc(l)}</p>`));
  }
  if (ownerFacts.features.length) {
    parts.push(`<h2>Features</h2>`);
    parts.push(`<ul>${ownerFacts.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`);
  }
  if (ownerFacts.specifications.length) {
    parts.push(`<h2>Specifications</h2>`);
    parts.push(
      `<ul>${ownerFacts.specifications.map((s) => `<li><strong>${esc(s.label)}:</strong> ${esc(s.value)}</li>`).join('')}</ul>`,
    );
  }
  // Buyer content shared with the client product page
  // (src/content/productContent.ts) so the crawl HTML carries the same
  // summary, pre-purchase checks, care/safety notes and guide link the visitor
  // sees after hydration. Absent for a product with no entry — nothing is
  // invented, the page just stays as short as its catalog data is.
  const content = productContentFor(p.slug);
  if (content) {
    parts.push(`<h2>About this product</h2>`, `<p>${esc(content.summary)}</p>`);
    if (content.confirm.length) {
      parts.push(`<h2>What to check before ordering</h2>`);
      parts.push(`<ul>${content.confirm.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`);
    }
    if (content.care.length) {
      parts.push(`<h2>Care and safety</h2>`);
      parts.push(`<ul>${content.care.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`);
    }
    if (content.guide) {
      parts.push(`<p><a href="${esc(content.guide.href)}">${esc(content.guide.label)}</a></p>`);
    }
  }
  const links: string[] = [];
  if (p.categories && p.categories.name) {
    const catSlug = (p.categories.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    links.push(`<a href="/category/${esc(catSlug)}">More in ${esc(p.categories.name)}</a>`);
  }
  links.push('<a href="/shop">Shop all pet essentials</a>');
  parts.push(`<p>${links.join(' · ')}</p>`);
  return html.replace('<div id="ssr-body"></div>', `<article>${parts.join('\n')}</article>`);
}

/** Pre-renders the category intro into the SPA shell: the category name, the
 * same descriptive line the client header shows, and links to the real
 * products in the category (the client renders these same products as cards). */
// Category pet hero images — mirror of CAT_HERO_IMAGES in src/App.tsx so the
// server-rendered category header shows the same pet image the hydrated page
// does. Keep the two maps in sync.
const CAT_HERO_IMAGES: Record<string, string> = {
  'Dog Supplies': 'https://images.unsplash.com/photo-1552053831-71594a27632d?w=720&h=820&fit=crop&crop=faces&auto=format&q=88',
  'Cat Supplies': 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=720&h=820&fit=crop&crop=faces&auto=format&q=88',
  'Bird Supplies': 'https://images.unsplash.com/photo-1552728089-57bdde30beb3?w=720&h=820&fit=crop&crop=faces&auto=format&q=88',
  'Horse': 'https://images.unsplash.com/photo-1553284965-83fd3e82fa5a?w=720&h=820&fit=crop&crop=faces&auto=format&q=88',
  'Cattle': 'https://images.unsplash.com/photo-1500595046743-cd271d694d30?w=720&h=820&fit=crop&crop=faces&auto=format&q=88',
  'Pet Beds': 'https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=640&h=760&fit=crop&crop=faces&auto=format&q=88',
  'Pet Toys': 'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?w=640&h=760&fit=crop&crop=faces&auto=format&q=88',
  'Feeding & Water': 'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?w=640&h=760&fit=crop&crop=faces&auto=format&q=88',
  'Grooming': 'https://images.unsplash.com/photo-1516734212186-a967f81ad0d7?w=640&h=760&fit=crop&crop=faces&auto=format&q=88',
  'Pet Accessories': 'https://images.unsplash.com/photo-1541599540903-216a46ca1dc0?w=640&h=760&fit=crop&crop=faces&auto=format&q=88',
};

export function injectCategoryBody(html: string, cat: CategoryRow, products: ProductRow[]): string {
  const inCategory = products.filter((p) => {
    if (!p.slug || !isPubliclyListableProduct(p)) return false;
    const catName = p.categories?.name?.toLowerCase();
    if (catName === cat.name.toLowerCase()) return true;
    if (cat.slug === 'cat-supplies' || cat.name.toLowerCase() === 'cat supplies') {
      const slug = p.slug.toLowerCase();
      const name = (p.name || '').toLowerCase();
      const tags = typeof p.tags === 'string' ? p.tags.toLowerCase() : Array.isArray(p.tags) ? p.tags.join(' ').toLowerCase() : '';
      if (tags.includes('cat')) return true;
      if (slug.includes('cat-') || slug.includes('-cat') || /\bcat\b|\bcats\b/i.test(name)) return true;
    }
    return false;
  });
  // Mirror the client category header exactly (CAT_META in src/App.tsx or the
  // client's `Browse our {category} collection` fallback) so the pre-render and
  // the hydrated page show the same line. The DB description column is ignored
  // here because the client does not render it. Keep CATEGORY_DESC in sync.
  // Shared with the client collection page (src/content/categoryContent.ts) so
  // the crawl HTML carries the same intro, considerations and guide links the
  // hydrated page shows. CATEGORY_DESC stays as the fallback for a slug that has
  // no shared entry yet.
  // Through the shared lookup, never the raw map: that lookup drops guide links
  // whose URL is retired, and the crawl HTML has to match the hydrated page.
  const content = categoryContentFor(cat.slug);
  const desc = content?.desc || CATEGORY_DESC[cat.slug] || `Browse our ${cat.name} collection`;
  const hero = CAT_HERO_IMAGES[cat.name] || '';
  const parts: string[] = [];
  if (hero) parts.push(`<img src="${esc(hero)}" alt="${esc(cat.name)} essentials" />`);
  // Mirror the client CategoryHero breadcrumb so crawlers see the same trail.
  parts.push(
    `<nav aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li><a href="/shop">Shop</a></li><li>${esc(cat.name)}</li></ol></nav>`,
    `<h1>${esc(cat.name)}</h1>`,
    `<p>${esc(desc)}</p>`,
    `<h2>Choosing ${esc(cat.name.toLowerCase())}</h2>`,
    `<p>Start with the task you need to complete, then compare the listed dimensions, materials, availability, and delivery details before choosing.</p>`,
  );
  if (content && content.considerations.length) {
    parts.push(`<h2>What to look for in ${esc(cat.name.toLowerCase())}</h2>`);
    parts.push(`<ul>${content.considerations.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`);
  }
  if (content && content.guides.length) {
    parts.push(`<h2>Related guides</h2>`);
    parts.push(`<ul>${content.guides.map((g) => `<li><a href="${esc(g.href)}">${esc(g.label)}</a></li>`).join('')}</ul>`);
  }
  if (inCategory.length > 0) {
    const items = inCategory
      .slice(0, 12)
      .map((p) => `<li><a href="/product/${esc(p.slug!)}">${esc(p.name)}</a></li>`)
      .join('');
    parts.push(`<ul>${items}</ul>`);
  }
  return html.replace('<div id="ssr-body"></div>', `<article>${parts.join('\n')}</article>`);
}

/** Pre-renders the homepage hero + category navigation into the SPA shell.
 * Mirrors the HomePage section copy and every link the client renders. */
/**
 * Serialises the shared site-page copy (src/content/sitePages.ts) into crawl
 * HTML. The React pages render the same module via src/components/SiteContent,
 * so the pre-rendered and hydrated copies cannot drift apart.
 */
function renderSiteSections(sections: SiteSection[]): string[] {
  const parts: string[] = [];
  for (const s of sections) {
    parts.push(`<h2>${esc(s.heading)}</h2>`);
    for (const p of s.paragraphs || []) parts.push(`<p>${esc(p)}</p>`);
    if (s.bullets?.length) {
      parts.push(`<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`);
    }
    if (s.links?.length) {
      parts.push(`<p>${s.links.map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join(' | ')}</p>`);
    }
  }
  return parts;
}

function renderSiteFaq(items: SiteFaqItem[], title = 'Common questions'): string[] {
  const parts: string[] = [`<h2>${esc(title)}</h2>`];
  for (const f of items) {
    parts.push(`<h3>${esc(f.q)}</h3>`, `<p>${esc(f.a)}</p>`);
  }
  // Same trailing line the React component renders, so the crawl HTML carries
  // the same onward links a visitor sees (and the parity test stays honest).
  parts.push(
    `<p>More detail lives on the <a href="/faq">FAQ page</a> and on the ` +
    `<a href="/shipping-policy">Shipping</a> and <a href="/returns">Returns</a> policies.</p>`,
  );
  return parts;
}

export function injectHomeBody(html: string, products?: ProductRow[] | null): string {
  const parts: string[] = [
    `<h1>The Best Finds for Every Pet, Thoughtfully Curated.</h1>`,
    `<p>Sourced worldwide. Chosen with care.</p>`,
    `<p>We search trusted sources around the world for well-made essentials, then choose the pieces worth bringing home.</p>`,
    `<h2>Shop with the details in view</h2>`,
    `<p>Start with the animal and everyday task you are shopping for, then use each listing’s stated size, materials, price, and availability to narrow the options.</p>`,
    `<p>Shop by pet</p>`,
    `<h2>Who are you shopping for?</h2>`,
    `<ul>` +
      `<li><a href="/category/dog-supplies">Dog</a></li>` +
      `<li><a href="/category/cat-supplies">Cat</a></li>` +
      `<li><a href="/category/bird-supplies">Birds</a></li>` +
      `<li><a href="/category/horse">Horse</a></li>` +
      `<li><a href="/category/cattle">Livestock</a></li>` +
      `</ul>`,
    `<p>Browse</p>`,
    `<h2>Popular Categories</h2>`,
    `<ul>` +
      `<li><a href="/shop">Shop all products</a></li>` +
      `<li><a href="/category/dog-supplies">Dog walking &amp; training</a></li>` +
      `<li><a href="/category/pet-beds">Beds &amp; mats</a></li>` +
      `<li><a href="/category/grooming">Grooming</a></li>` +
      `<li><a href="/category/feeding-water">Feeding &amp; water</a></li>` +
      `<li><a href="/category/pet-toys">Toys</a></li>` +
      `<li><a href="/category/pet-accessories">Travel &amp; accessories</a></li>` +
      `<li><a href="/category/cat-supplies">Cat essentials</a></li>` +
      `<li><a href="/category/bird-supplies">Bird supplies</a></li>` +
      `</ul>`,
    ...renderSiteSections(HOME_SECTIONS),
    ...renderSiteFaq(HOME_FAQ),
  ];
  // A real product grid: what the store actually sells, with images and
  // prices, in the crawler's initial HTML. The hydrated homepage renders its
  // own curated React sections on top; this block gives the crawl the same
  // commercial substance the visitor sees. Same public filter as /shop and the
  // sitemap; name + price + one real image only — nothing invented.
  const publicProducts = (products || []).filter(
    (p) => p.slug && !isHeldProduct(p.slug) && isPubliclyListableProduct(p),
  );
  if (publicProducts.length) {
    const cards = publicProducts.slice(0, 12).map((p) => {
      const img = productImageUrls(p)[0];
      const price = money(p.price);
      return (
        `<li>` +
        `<a href="/product/${esc(p.slug!)}">${esc(p.name)}</a>` +
        (price ? ` — ${esc(price)}` : '') +
        (img ? `<br /><img src="${esc(img)}" alt="${esc(p.name)}" loading="lazy" width="400" height="400" />` : '') +
        `</li>`
      );
    });
    parts.push(`<h2>Featured products</h2>`, `<ul>${cards.join('')}</ul>`);
  }
  return html.replace('<div id="ssr-body"></div>', `<article>${parts.join('\n')}</article>`);
}

/** Pre-renders the /about copy (shared with the client AboutPage) so the
 * initial HTML carries the same truthful content the hydrated page shows. */
function injectAboutBody(html: string): string {
  const parts: string[] = [`<h1>About Luxedge</h1>`, `<p>${esc(ABOUT_QUOTE)}</p>`, `<p>${esc(ABOUT_LEAD)}</p>`];
  for (const s of ABOUT_SECTIONS) {
    parts.push(`<h2>${esc(s.title)}</h2>`, `<p>${esc(s.body)}</p>`);
  }
  return html.replace('<div id="ssr-body"></div>', `<article>${parts.join('\n')}</article>`);
}

/** Pre-renders the /contact page with contact info and intro. */
/** Exported so the site-pages test can assert the crawl HTML carries every
 * shared string the React page renders (renderer parity). */
export function injectContactBody(html: string): string {
  const cards = CONTACT_INFO.map((c) => `<li><strong>${esc(c.label)}:</strong> ${esc(c.value)} (${esc(c.sub)})</li>`).join('');
  const parts: string[] = [
    `<h1>Contact Us</h1>`,
    `<p>${esc(CONTACT_INTRO)}</p>`,
    `<ul>${cards}</ul>`,
    `<p>Email: <a href="mailto:hello@luxedge.us">hello@luxedge.us</a> | Phone: (440) 941-8002 | Hours: Mon-Fri, 9AM-6PM CT</p>`,
    ...renderSiteSections(CONTACT_SECTIONS),
  ];
  return html.replace('<div id="ssr-body"></div>', `<article>${parts.join('\n')}</article>`);
}

/** Pre-renders a legal/policy page from shared section data. The date comes
 * from POLICY_LAST_UPDATED so the crawl HTML matches the React page. */
function injectLegalBody(html: string, title: string, sections: { title: string; body: string }[], updated: string): string {
  const parts: string[] = [`<h1>${esc(title)}</h1>`, `<p>Last updated: ${esc(updated)}</p>`];
  for (const s of sections) {
    parts.push(`<h2>${esc(s.title)}</h2>`, `<p>${esc(s.body)}</p>`);
  }
  return html.replace('<div id="ssr-body"></div>', `<article>${parts.join('\n')}</article>`);
}

/** Pre-renders the /faq page with categories and questions. */
/** Exported so the FAQ drift test can render the crawl copy and compare it to
 * the React page string-for-string. */
export function injectFaqBody(html: string): string {
  const parts: string[] = [`<h1>Frequently Asked Questions</h1>`];
  for (const cat of FAQ_DATA) {
    parts.push(`<h2>${esc(cat.category)}</h2>`);
    for (const item of cat.items) {
      parts.push(`<h3>${esc(item.q)}</h3>`, `<p>${esc(item.a)}</p>`);
    }
  }
  return html.replace('<div id="ssr-body"></div>', `<article>${parts.join('\n')}</article>`);
}

/**
 * Pre-renders the /sitemap page from the SAME groups the XML feed is built
 * from, so the page a visitor browses and the URL list we hand Google cannot
 * disagree. On a DB outage the shell is left as-is (no link list we cannot
 * vouch for) rather than publishing stale or unverified URLs.
 */
async function injectSitemapBody(html: string): Promise<string> {
  const groups = await buildSitemapGroups();
  if (!groups) return html;
  return html.replace('<div id="ssr-body"></div>', renderHtmlSitemapBody(groups));
}

/** Pre-renders the /shop page: category navigation plus direct links to the
 * commerce-ready products (crawlers reach every product from the hub page
 * without depending on per-category JS rendering). Mirrors injectCategoryBody. */
async function injectShopBody(html: string): Promise<string> {
  const cats = [
    ['Dog Supplies', '/category/dog-supplies'], ['Cat Supplies', '/category/cat-supplies'],
    ['Pet Beds', '/category/pet-beds'], ['Pet Toys', '/category/pet-toys'],
    ['Feeding & Water', '/category/feeding-water'], ['Grooming', '/category/grooming'],
    ['Pet Accessories', '/category/pet-accessories'], ['Bird Supplies', '/category/bird-supplies'],
    ['Horse', '/category/horse'], ['Cattle', '/category/cattle'],
  ];
  const links = cats.map(([label, to]) => `<li><a href="${esc(to)}">${esc(label)}</a></li>`).join('');
  const parts: string[] = [
    `<h1>Shop All Pet Essentials</h1>`,
    `<p>Handpicked for quality, comfort, and value. Browse by category below.</p>`,
    `<h2>Categories</h2>`,
    `<ul>${links}</ul>`,
  ];
  const products = await getProducts();
  if (products) {
    const ready = products.filter((p) => p.slug && !isHeldProduct(p.slug) && isPubliclyListableProduct(p)).slice(0, 60);
    if (ready.length > 0) {
      const items = ready.map((p) => `<li><a href="/product/${esc(p.slug!)}">${esc(p.name)}</a></li>`).join('');
      parts.push(`<h2>All Products</h2>`, `<ul>${items}</ul>`);
    }
  }
  return html.replace('<div id="ssr-body"></div>', `<article>${parts.join('\n')}</article>`);
}

/** Pre-renders the /blog index with recent post links from the CMS. */
/** Pre-renders the /careers page (mirrors the client CareersPage copy). */
function injectCareersBody(html: string): string {
  const parts: string[] = [
    `<h1>Careers at Luxedge</h1>`,
    `<p>Join our growing team and help shape the future of curated ecommerce.</p>`,
    `<h2>Why Work at Luxedge?</h2>`,
    `<p>At Luxedge, we're building more than an online store — we're creating a trusted destination for people who value quality. Our small but passionate team is obsessed with finding the best products and delivering an exceptional shopping experience.</p>`,
    `<p>We value curiosity, ownership, and a genuine desire to make customers happy.</p>`,
    `<h2>Our Culture</h2>`,
    `<ul>`,
    `<li><strong>Growth-Focused</strong> — We invest in our people. Learn, grow, and level up with us.</li>`,
    `<li><strong>Collaborative</strong> — Small team, big impact. Every voice matters here.</li>`,
    `<li><strong>Remote-Friendly</strong> — Work from anywhere. We care about results, not locations.</li>`,
    `<li><strong>Innovation-Driven</strong> — We encourage new ideas and creative problem-solving.</li>`,
    `</ul>`,
    `<h2>Open Positions</h2>`,
    `<p>We're always looking for talented individuals to join us. Even if you don't see a specific role listed, we encourage you to reach out.</p>`,
    `<ul>`,
    `<li><strong>Product Curator</strong> (Remote · Full-Time) — Research, test, and select products that meet our quality standards.</li>`,
    `<li><strong>Content Writer</strong> (Remote · Part-Time) — Create engaging blog posts, product descriptions, and marketing copy.</li>`,
    `<li><strong>Customer Support Specialist</strong> (Remote · Full-Time) — Help customers via email and chat with a focus on resolution and delight.</li>`,
    `</ul>`,
    `<h2>How to Apply</h2>`,
    `<p>Send your resume and a brief note about why you'd be a great fit to <a href="mailto:careers@luxedge.us">careers@luxedge.us</a>. Include the role you're interested in as the subject line. We review all applications and aim to respond within one week.</p>`,
    `<p><a href="/contact">Get in Touch</a></p>`,
  ];
  return html.replace('<div id="ssr-body"></div>', `<article>${parts.join('\n')}</article>`);
}

async function injectBlogIndexBody(html: string, origin: string, env: SeoEnv): Promise<string> {
  const posts = await getBlogRegistry(origin, env);
  const parts: string[] = [
    `<h1>Blog</h1>`,
    `<p>Practical pet care guides from Luxedge — puppy essentials, cat enrichment, bird care, horse grooming, cattle basics, and honest buying advice.</p>`,
  ];
  if (posts && posts.length > 0) {
    const items = posts.slice(0, 15).map((p) => `<li><a href="/blog/${esc(p.slug)}">${esc(p.title)}</a> — ${esc(p.excerpt || '').slice(0, 100)}</li>`).join('');
    parts.push(`<h2>Latest articles</h2>`, `<ul>${items}</ul>`);
  }
  return html.replace('<div id="ssr-body"></div>', `<article>${parts.join('\n')}</article>`);
}

/** UUID-shaped product param (case-insensitive) — the URL shape the
 * storefront used to link from product cards before PR #35, still indexed.
 * 301-ing it to the canonical slug merges the duplicate instead of leaving a
 * self-canonicalized generic shell. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve a UUID-shaped product param to its canonical slug redirect target.
 * Returns null for slug-shaped params (never touched), unknown UUIDs, missing
 * slugs, or an unavailable product list — callers keep today's behavior. */
export function resolveUuidProductRedirect(
  products: ProductRow[] | null,
  param: string,
): string | null {
  if (!products || !UUID_RE.test(param)) return null;
  const id = param.toLowerCase();
  // x.id must be null-safe: rows from a stale cache may predate the id column.
  const p = products.find((x) => x.id && x.id.toLowerCase() === id);
  return p && p.slug ? `/product/${p.slug}` : null;
}

export async function maybeInjectSeo(
  html: string,
  pathname: string,
  origin: string,
  env: SeoEnv,
): Promise<{ html: string; status: number } | { redirect: string } | null> {
  const segs = pathname.split('/').filter(Boolean);
  const root = 'https://luxedge.us';

  if (segs.length === 2 && ((segs[0] === 'product' && isHeldProduct(segs[1])) || (segs[0] === 'media' && isHeldMedia(segs[1])) || (segs[0] === 'blog' && isHeldBlog(segs[1])))) {
    return { html: inject(html, { title: 'Page unavailable | Luxedge', description: 'This page is currently unavailable.', canonical: `${root}/${segs.join('/')}`, noindex: true }), status: 404 };
  }

  // Metadata and content are UA-independent: every indexable route receives the
  // same head (title/desc/canonical/og/robots/JSON-LD), and blog articles also
  // receive their pre-rendered body with real internal links. React replaces
  // #root on mount, so bots and humans see the same semantic content.

  // Pet Gift Drop campaign (client-rendered /free-pet-gift): time-boxed, real
  // finite inventory — serve the SPA shell with campaign meta, noindexed (it
  // will flip to a fully-claimed state; follow links so ad/social traffic and
  // backlinks still pass value). Never a 404: real claims come from the page.
  if (segs.length > 0 && segs[0] === 'free-pet-gift') {
    return {
      html: inject(html, {
        title: 'Luxedge Pet Gift Drop — Free Gift for Dogs & Cats',
        description:
          'Claim a complimentary Luxedge pet gift for your dog or cat — product and standard shipping are free. No purchase required and no card is ever asked for, while real supplies last.',
        canonical: `${root}/free-pet-gift`,
        noindex: true,
      }),
      status: 200,
    };
  }

  // /campaigns/:slug — Campaign Engine landing (client-rendered). Campaigns are
  // temporary promotions that flip to claimed/ended states, so the whole prefix
  // is noindexed (ad/social traffic still works). Unknown slugs must NOT become
  // a 200 indexable homepage copy — but they also shouldn't be a hard 404 for
  // the SPA router, so a missing campaign is a real 404 that the client also
  // shows as closed/unavailable.
  if (segs.length === 2 && segs[0] === 'campaigns') {
    if (!['pet-gift-drop'].includes(segs[1])) {
      return { html: inject(html, { title: 'Campaign Not Found | Luxedge', description: 'This campaign is no longer available.', canonical: `${root}/campaigns/${encodeURIComponent(segs[1])}`, noindex: true }), status: 404 };
    }
    return {
      html: inject(html, {
        title: 'Luxedge Campaign',
        description: 'A limited Luxedge promotion — view eligibility and claim details on the campaign page.',
        canonical: `${root}/campaigns/${encodeURIComponent(segs[1])}`,
        noindex: true,
      }),
      status: 200,
    };
  }

  // Noindex utility/private routes so they never appear in search results.
  // Matches any depth: /admin, /admin/blogs, /checkout, /checkout/success, …
  const noIndexFirst = ['admin', 'checkout', 'login', 'signup', 'account', 'cart', 'orders', 'wishlist'];
  if (segs.length > 0 && noIndexFirst.includes(segs[0])) {
    return {
      html: inject(html, {
        title: `${segs[0].charAt(0).toUpperCase() + segs[0].slice(1)} | Luxedge`,
        description: '',
        canonical: `${root}/${segs.slice(0, 2).join('/')}`,
        noindex: true,
      }),
      status: 200,
    };
  }

  // Homepage (and the /home alias the app also serves) — canonical always to /.
  if (segs.length === 0 || (segs.length === 1 && segs[0] === 'home')) {
    // og:image: the homepage pre-renders a real product grid below the fold,
    // so the social/preview card leads with a real product image too. With no
    // catalog (DB down) the shell's brand PNG stays.
    const homeProducts = await getProducts();
    const homeOgImage = homeProducts
      ? homeProducts
          .filter((p) => p.slug && !isHeldProduct(p.slug) && isPubliclyListableProduct(p) && productImageUrls(p).length)
          .map((p) => productImageUrls(p)[0])[0] || null
      : null;
    let out = inject(html, {
      title: 'Luxedge — Premium Pet & Animal Essentials',
      description:
        'Shop practical pet and horse essentials, read buying guides, and find clear shipping and return information at Luxedge.',
      canonical: root,
      ogImage: homeOgImage,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'Luxedge',
        url: root,
        publisher: {
          '@type': 'Organization',
          name: 'Embani LLC',
          legalName: 'Embani LLC',
          // The storefront brand the customer buys under, and the mark the
          // store actually ships (public/luxedge-mark.png). No `sameAs`: the
          // social profiles are empty on purpose until a real account exists
          // (src/content/socialProfiles.ts), and naming a profile that does
          // not exist would be a false claim about the business.
          brand: { '@type': 'Brand', name: 'Luxedge' },
          logo: `${root}/luxedge-mark.png`,
          url: root,
          address: {
            '@type': 'PostalAddress',
            streetAddress: '1500 N Grant St',
            addressLocality: 'Denver',
            addressRegion: 'CO',
            postalCode: '80203',
            addressCountry: 'US',
          },
          contactPoint: {
            '@type': 'ContactPoint',
            email: 'hello@luxedge.us',
            telephone: '+1-440-941-8002',
            contactType: 'customer service',
            availableLanguage: 'English',
          },
        },
      },
    });
    // Pre-render the hero + category navigation + a real product grid so the
    // initial HTML (and any non-JS crawler) sees substantive, product-led
    // content, not an empty shell.
    out = injectHomeBody(out, homeProducts);
    return { html: out, status: 200 };
  }

  // /media (hub index) — pre-render with recent video links from the CMS.
  if (segs.length === 1 && segs[0] === 'media') {
    let out = inject(html, {
      title: 'Luxedge Media — Videos, Guides & Stories | Luxedge',
      description:
        'Watch Luxedge videos — product education, pet & animal care, how-to guides, buying guides and behind-the-brand stories, embedded from the official YouTube channel.',
      canonical: `${root}/media`,
      noindex: true,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'Luxedge Media',
        url: `${root}/media`,
        description:
          'Films, guides and stories from the Luxedge team — product education, pet and animal care, how-to guides, buying guides and behind-the-brand stories.',
      },
    });
    out = await injectMediaIndexBody(out);
    return { html: out, status: 200 };
  }

  // /media/:slug — real editorial page with VideoObject structured data.
  if (segs.length === 2 && segs[0] === 'media') {
    const slug = decodeURIComponent(segs[1]);
    const media = await getMediaRegistry();
    if (media === null) {
      return { html: inject(html, { title: 'Media temporarily unavailable | Luxedge', description: 'This media page is temporarily unavailable.', canonical: `${root}/media/${slug}`, noindex: true }), status: 503 };
    }
    const v = media.find((x) => x.slug === slug);
    if (!v) {
      return {
        html: inject(html, {
          title: 'Video Not Found | Luxedge',
          description: 'This video is no longer available.',
          canonical: `${root}/media/${slug}`,
          noindex: true,
        }),
        status: 404,
      };
    }
    const canonical = `${root}/media/${slug}`;
    const title = (v.seoTitle || v.title).replace(/\s*\|\s*Luxedge\s*$/i, '') + ' | Luxedge';
    let out = inject(html, {
      title,
      description: cleanText(v.metaDescription || v.summary || v.description || '', 200),
      canonical,
      noindex: true,
      ogImage: v.thumbnail || null,
      jsonLd: mediaJsonLd(v, canonical),
    });
    out = await injectMediaBody(out, v);
    return { html: out, status: 200 };
  }

  // /blog/write — client-side composition tool; nothing to index. This must
  // precede /blog/:slug so the reserved path cannot be treated as an article.
  if (segs.length === 2 && segs[0] === 'blog' && segs[1] === 'write') {
    return {
      html: inject(html, {
        title: 'Write | Luxedge',
        description: '',
        canonical: `${root}/blog/write`,
        noindex: true,
      }),
      status: 200,
    };
  }

  // /blog (index) — pre-render the index with recent post links from the CMS.
  if (segs.length === 1 && segs[0] === 'blog') {
    let out = inject(html, {
      title: 'Pet Care Blog — Guides, Tips & Buying Advice | Luxedge',
      description:
        'Practical buying guides and care tips for dogs, cats, birds, horses, and cattle — sizing, placement, grooming, and product picks from the Luxedge editorial team.',
      canonical: `${root}/blog`,
      // Withdrawn from the index while the blog is not public (reviewHolds.ts).
      noindex: !isBlogPublic(),
    });
    const posts = await getBlogRegistry(origin, env);
    if (posts === null) return { html: inject(out, { title: 'Blog temporarily unavailable | Luxedge', description: 'The blog is temporarily unavailable. Please retry.', canonical: `${root}/blog`, noindex: true }), status: 503 };
    out = await injectBlogIndexBody(out, origin, env);
    return { html: out, status: 200 };
  }

  // /shop — pre-render category navigation.
  if (segs.length === 1 && segs[0] === 'shop') {
    let out = inject(html, {
      title: 'Shop All Pet Essentials — Dog, Cat, Bird, Horse & More | Luxedge',
      description:
        'Browse the Luxedge curated collection — dog beds and leashes, cat toys and fountains, bird feeders, horse grooming and livestock essentials, all sourced and ready to ship.',
      canonical: `${root}/shop`,
    });
    out = await injectShopBody(out);
    return { html: out, status: 200 };
  }

  // Static pages (about also receives the shared About copy pre-rendered).
  const staticKey = `/${segs.join('/')}`;
  const staticMeta = STATIC_PAGES[staticKey];
  if (staticMeta) {
    let out = inject(html, {
      title: staticMeta.title,
      description: staticMeta.description,
      canonical: `${root}${staticKey}`,
    });
    // Pre-render body content for each static page so crawlers see
    // substantive material, not an empty SPA shell.
    if (staticKey === '/about') out = injectAboutBody(out);
    else if (staticKey === '/contact') out = injectContactBody(out);
    else if (staticKey === '/privacy') out = injectLegalBody(out, 'Privacy Policy', PRIVACY_SECTIONS, POLICY_LAST_UPDATED[staticKey]);
    else if (staticKey === '/terms') out = injectLegalBody(out, 'Terms of Service', TERMS_SECTIONS, POLICY_LAST_UPDATED[staticKey]);
    else if (staticKey === '/returns') out = injectLegalBody(out, 'Returns & Replacement Policy', RETURNS_SECTIONS, POLICY_LAST_UPDATED[staticKey]);
    else if (staticKey === '/shipping-policy') out = injectLegalBody(out, 'Shipping Policy', SHIPPING_SECTIONS, POLICY_LAST_UPDATED[staticKey]);
    else if (staticKey === '/copyright') out = injectLegalBody(out, 'Copyright & DMCA', COPYRIGHT_SECTIONS, POLICY_LAST_UPDATED[staticKey]);
    else if (staticKey === '/editorial-policy') out = injectLegalBody(out, 'Editorial Policy', EDITORIAL_SECTIONS, POLICY_LAST_UPDATED[staticKey]);
    else if (staticKey === '/disclaimer') out = injectLegalBody(out, 'Disclaimer', DISCLAIMER_SECTIONS, POLICY_LAST_UPDATED[staticKey]);
    else if (staticKey === '/faq') out = injectFaqBody(out);
    else if (staticKey === '/sitemap') out = await injectSitemapBody(out);
    else if (staticKey === '/careers') out = injectCareersBody(out);
    return { html: out, status: 200 };
  }

  // /product/:slug
  if (segs.length === 2 && segs[0] === 'product') {
    const slug = decodeURIComponent(segs[1]);
    const products = await getProducts();
    if (products === null) {
      return { html: injectCanonical(html, `${root}/product/${slug}`), status: 200 }; // DB unavailable — keep canonical correct
    }
    const p = products.find((x) => x.slug === slug && !isHeldProduct(x.slug) && isPubliclyListableProduct(x));
    if (!p) {
      // Legacy UUID product URLs (pre-PR #35 storefront links) — 301 to the
      // canonical slug so the duplicate collapses instead of soft-404ing.
      const redirect = resolveUuidProductRedirect(products, slug);
      if (redirect) return { redirect };
      return {
        html: inject(html, {
          title: 'Product Not Found | Luxedge',
          description: 'This product is no longer available.',
          canonical: `${root}/product/${slug}`,
          noindex: true,
        }),
        status: 404,
      };
    }
    const canonical = `${root}/product/${slug}`;
    const title = (p.seo_title || `${p.name} | Luxedge`).replace(/\s*\|\s*Luxedge\s*$/, '') + ' | Luxedge';
    // og:image: the product's first real catalog image — crawlers and social
    // cards get the actual item, not the brand mark.
    const ogImage = productImageUrls(p)[0] || null;
    let out = inject(html, {
      title,
      description: cleanText(p.seo_description || p.short_description || p.description || '', 200),
      canonical,
      ogImage,
      jsonLd: [productJsonLd(p, canonical), breadcrumbJsonLd(p.name, canonical)],
    });
    // Pre-render the real product facts into #root (same content the client
    // renders after hydration) so crawlers see page-specific substance.
    out = injectProductBody(out, p);
    return { html: out, status: 200 };
  }

  // /blog/:slug
  if (segs.length === 2 && segs[0] === 'blog') {
    const slug = decodeURIComponent(segs[1]);
    const posts = await getBlogRegistry(origin, env);
    if (posts === null) {
      return { html: inject(html, { title: 'Article temporarily unavailable | Luxedge', description: 'This article is temporarily unavailable. Please retry.', canonical: `${root}/blog/${slug}`, noindex: true }), status: 503 };
    }
    const post = posts.find((x) => x.slug === slug);
    if (!post) {
      // An article that was published, submitted in the sitemap and later
      // removed: 301 to the blog index rather than leaving a 404 in the index.
      // Checked only after the CMS lookup, so a restored article wins.
      if (isRetiredBlogSlug(slug)) return { redirect: '/blog' };
      return {
        html: inject(html, {
          title: 'Post Not Found | Luxedge',
          description: 'This article is no longer available.',
          canonical: `${root}/blog/${slug}`,
          noindex: true,
        }),
        status: 404,
      };
    }
    const canonical = `${root}/blog/${slug}`;
    // One semantic path: full head metadata AND the pre-rendered article body
    // (with its real internal links) are served to every UA. React replaces
    // #root on mount, so there is no duplicated visible content.
    let out = inject(html, {
      title: `${post.title} | Luxedge`,
      description: cleanText(post.excerpt, 200),
      canonical,
      ogImage: post.image || null,
      jsonLd: blogJsonLd(post, canonical),
      // Withdrawn from the index while the blog is not public (reviewHolds.ts).
      noindex: !isBlogPublic(),
    });
    out = injectArticleBody(out, post);
    return { html: out, status: 200 };
  }

  // /author/:slug — editorial attribution. The registry is deliberately empty
  // until a real author is supplied (src/content/authors.ts), so today every
  // slug falls through to the noindex 404 below rather than publishing an
  // invented person. The branch is here so that adding an author is a data edit,
  // not a rendering change: the name, photo, bio and their pre-rendered article
  // list all come from that one entry.
  if (segs.length === 2 && segs[0] === 'author') {
    const slug = decodeURIComponent(segs[1]);
    const author = authorFor(slug);
    if (author) {
      const canonical = `${root}/author/${author.slug}`;
      const posts = await getBlogRegistry(origin, env);
      const mine = (posts || []).filter((p) => p.authorName === author.name);
      const photo = author.photo
        ? `<p><img src="${esc(author.photo)}" alt="${esc(author.name)}" width="160" height="160" /></p>`
        : '';
      const articles = mine.length
        ? `<h2>Articles by ${esc(author.name)}</h2><ul>${mine
            .map((p) => `<li><a href="/blog/${esc(p.slug)}">${esc(p.title)}</a></li>`)
            .join('')}</ul>`
        : '';
      const external = (author.links || [])
        .map((l) => `<a href="${esc(l.href)}" rel="noopener">${esc(l.label)}</a>`)
        .join(' \u00b7 ');
      const out = inject(html, {
        title: `${author.name} \u2014 author | Luxedge`,
        description: cleanText(author.bio, 200),
        canonical,
        ogImage: author.photo || null,
      });
      return {
        html: out.replace(
          '<div id="ssr-body"></div>',
          `<article><h1>${esc(author.name)}</h1>${photo}<p>${esc(author.bio)}</p>${articles}`
            + `${external ? `<p>${external}</p>` : ''}</article>`,
        ),
        status: 200,
      };
    }
  }

  // /category/:slug
  if (segs.length === 2 && segs[0] === 'category') {
    const slug = decodeURIComponent(segs[1]);
    const categories = await getCategories();
    if (categories === null) {
      return { html: injectCanonical(html, `${root}/category/${slug}`), status: 200 };
    }
    const cat = categories.find((x) => x.slug === slug);
    if (!cat) {
      return {
        html: inject(html, {
          title: 'Category Not Found | Luxedge',
          description: 'This category is no longer available.',
          canonical: `${root}/category/${slug}`,
          noindex: true,
        }),
        status: 404,
      };
    }
    const canonical = `${root}/category/${slug}`;
    let out = inject(html, {
      title: `${cat.name} — Pet Essentials | Luxedge`,
      description: CATEGORY_DESC[slug]
        ? `Shop ${cat.name} at Luxedge — ${CATEGORY_DESC[slug].toLowerCase()}. Supplier-verified items with clear delivery estimates.`
        : `Shop ${cat.name} at Luxedge — curated, supplier-verified essentials for you and your pets.`,
      canonical,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: `${cat.name} — Luxedge`,
        url: canonical,
      },
    });
    // Pre-render the category intro + real product links (the client renders
    // the same products as its category grid).
    const products = await getProducts();
    if (products !== null) out = injectCategoryBody(out, cat, products);
    return { html: out, status: 200 };
  }

  // Unknown route: the SPA fallback would otherwise serve an indexable copy of
  // the homepage under a URL that does not exist (stale WordPress-era slugs,
  // typos, probes). Serve a real 404 with noindex so the index self-cleans.
  return {
    html: inject(html, {
      title: 'Page Not Found | Luxedge',
      description: 'This page does not exist.',
      canonical: `${root}/404`,
      noindex: true,
    }),
    status: 404,
  };
}
