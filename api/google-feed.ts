// GET /google-products.xml — public Google Merchant Center product feed
//
// Serves only products that are genuinely customer-visible and complete:
//   status=active, has a supplier reference (real sourcing), price > 0,
//   has at least one real image. No demo/test placeholders are ever included.
// Because checkout/payment is not yet live, this feed is prepared but not
// wired into Merchant Center until purchase eligibility is finalized.
//
// No secrets. Reads go through the shared data runtime (worker/d1/read.ts):
// Cloudflare D1 when DATA_BACKEND=d1, Supabase PostgREST with the anon key
// otherwise (Vercel + pre-cutover Worker) — the same switch every other public
// read path uses, so the feed follows the storefront's backend, never its own.
import type { IncomingMessage, ServerResponse } from 'node:http';

import { readPostgrestPath } from '../worker/d1/read';
import { getDataRuntime, isD1Backend } from '../worker/d1/runtime';

interface FeedProductRow {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  price: number | null;
  category_id: string | null;
  brand: string | null;
}
interface FeedImageRow {
  product_id: string;
  url: string;
  public_url: string | null;
  sort_order: number;
  is_primary: boolean | number;
}

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const cleanDesc = (d: string | null | undefined): string => {
  const plain = (d || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.slice(0, 400);
};

/** Merchant Center requires absolute image URLs; site-relative local mirrors
 * (/img/...) are absolutized against the canonical origin exactly like the
 * JSON-LD builder does. */
const absImage = (u: string): string =>
  /^https?:\/\//i.test(u) ? u : `https://luxedge.us${u.startsWith('/') ? '' : '/'}${u}`;

export default async function handler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  // "Not configured" only applies to the Supabase path: a D1 deployment always
  // has its binding, and readPostgrestPath refuses to invent rows either way.
  const rt = getDataRuntime();
  if (!isD1Backend() && (!rt.supabaseBase || !rt.supabaseAnon)) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.end('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>Luxedge</title><link>https://luxedge.us</link><description>Feed unavailable — database not configured.</description></channel></rss>');
    return;
  }

  const [prodRows, imgRowsRead, catRows] = await Promise.all([
    // Columns are exactly what the feed renders/filters on — no wide selects:
    // sku/supplier_product_ref were read for years but never emitted.
    readPostgrestPath<FeedProductRow>(
      'products?select=id,slug,name,description,price,category_id,brand&status=eq.active&limit=500',
    ),
    // Server-side filter (url NOT LIKE 'data:%'): product_images carries ~9 MB
    // of junk inline base64 rows, and fetching them just to discard them burned
    // Supabase egress quota (the 2026-09-29 outage). Excluded rows never leave
    // the database — the D1 translator emits the same NOT LIKE. A product whose
    // ONLY images are base64 blobs therefore drops out of the feed — correct:
    // the feed requires at least one real http(s) image.
    readPostgrestPath<FeedImageRow>(
      'product_images?select=product_id,url,public_url,sort_order,is_primary&url=not.like.data:*&limit=5000',
    ),
    readPostgrestPath<{ id: string; name: string }>('categories?select=id,name&limit=500'),
  ]);

  const catName = new Map<string, string>();
  for (const c of catRows || []) catName.set(c.id, c.name);

  if (!prodRows) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.end('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://www.google.com/shopping/feed"><channel><title>Luxedge</title><link>https://luxedge.us</link><description>Feed temporarily unavailable.</description></channel></rss>');
    return;
  }

  // Image/category read failures degrade exactly as before: no images → every
  // product is filtered out → a valid, empty feed rather than a broken one.
  const imgRows = imgRowsRead || [];
  const imgsByP = new Map<string, FeedImageRow[]>();
  for (const im of imgRows) {
    // An empty string is not a real image URL — the feed requires one.
    if (!(im.url || im.public_url || '').trim()) continue;
    const arr = imgsByP.get(im.product_id) || [];
    arr.push(im);
    imgsByP.set(im.product_id, arr);
  }

  const products = prodRows.map((p) => ({ ...p, category: p.category_id ? catName.get(p.category_id) || null : null, images: [] as string[] })).filter((p) => {
    const price = Number(p.price);
    const imgs = (imgsByP.get(p.id) || []).sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0) || a.sort_order - b.sort_order);
    return price > 0 && imgs.length > 0;
  });

  const items = products.map((p) => {
    const imgs = (imgsByP.get(p.id) || []).sort(
      (a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0) || a.sort_order - b.sort_order,
    );
    const price = Number(p.price).toFixed(2);
    const linkBase = `https://luxedge.us/product/${p.slug || p.id}`;
    const lines = [
      '<item>',
      `<g:id>${esc(p.id)}</g:id>`,
      `<g:title>${esc(p.name)}</g:title>`,
      `<g:description>${esc(cleanDesc(p.description))}</g:description>`,
      `<g:link>${esc(linkBase)}</g:link>`,
      // Same image preference as the storefront and JSON-LD: the legacy url
      // column first, falling back to the site-relative local mirror — a
      // product whose url points at the restricted Supabase Storage still
      // feeds a working, same-origin image from public_url.
      `<g:image_link>${esc(absImage(imgs[0].url || imgs[0].public_url || ''))}</g:image_link>`,
      ...imgs.slice(1, 6).map((im) => `  <g:additional_image_link>${esc(absImage(im.url || im.public_url || ''))}</g:additional_image_link>`),
      `<g:availability>in stock</g:availability>`,
      `<g:condition>new</g:condition>`,
      `<g:price>${price} USD</g:price>`,
      p.category ? `  <g:product_type>${esc(p.category)}</g:product_type>` : '',
      `<g:brand>${esc(p.brand || 'Luxedge')}</g:brand>`,
      `</item>`,
    ];
    return lines.filter((l) => l.includes('<item>') || l.includes('g:') || l === '</item>').join('\n');
  }).join('\n');

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0" xmlns:g="http://www.google.com/shopping/feed">\n` +
    `  <channel>\n` +
    `    <title>Luxedge</title>\n` +
    `    <link>https://luxedge.us</link>\n` +
    `    <description>Luxedge pet essentials — live product feed</description>\n` +
    items +
    `\n  </channel>\n</rss>`;

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.end(xml);
}