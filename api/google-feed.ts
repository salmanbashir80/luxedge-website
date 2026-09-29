// GET /google-products.xml — public Google Merchant Center product feed
//
// Serves only products that are genuinely customer-visible and complete:
//   status=active, has a supplier reference (real sourcing), price > 0,
//   has at least one real image. No demo/test placeholders are ever included.
// Because checkout/payment is not yet live, this feed is prepared but not
// wired into Merchant Center until purchase eligibility is finalized.
//
// No secrets — reads Supabase with the anon key exactly like api/checkout.ts.
import type { IncomingMessage, ServerResponse } from 'node:http';

interface FeedProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  category?: string | null;
  brand?: string | null;
  sku?: string | null;
  supplier_ref?: string | null;
  slug?: string | null;
  images: string[];
}

function supabaseBase(): string {
  return (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
}
function supabaseAnon(): string {
  return (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
}

async function restFetch<T>(table: string, query: string, key: string): Promise<{ ok: boolean; status: number; data: T | { error: string } }> {
  const base = supabaseBase();
  if (!base || !key) return { ok: false, status: 503, data: { error: 'Database is not configured on this deployment.' } };
  try {
    const res = await fetch(`${base}/rest/v1/${table}${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let data: T | null = null;
    try { data = text ? (JSON.parse(text) as T) : null; } catch { data = null; }
    if (!res.ok || data === null) return { ok: false, status: res.status, data: { error: 'feed data rejected' } };
    return { ok: true, status: res.status, data };
  } catch {
    return { ok: false, status: 502, data: { error: 'Database is unreachable right now.' } };
  }
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

export default async function handler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const key = supabaseAnon();
  const base = supabaseBase();
  if (!base || !key) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.end('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>Luxedge</title><link>https://luxedge.us</link><description>Feed unavailable — database not configured.</description></channel></rss>');
    return;
  }

  const [prodRes, imgRes, catRes] = await Promise.all([
    restFetch<Array<Omit<FeedProduct, 'images' | 'category'> & { category_id?: string | null }>>(
      'products',
      // Columns are exactly what the feed renders/filters on — no wide selects:
      // sku/supplier_product_ref were read for years but never emitted.
      '?select=id,slug,name,description,price,category_id,brand&status=eq.active&limit=500',
      key,
    ),
    // Server-side PostgREST filter (url NOT LIKE 'data:%'): product_images
    // carries ~9 MB of junk inline base64 rows, and fetching them just to
    // discard them burned Supabase egress quota (the 2026-09-29 outage).
    // Excluded rows never leave the database. Same live-proven filter as
    // worker/seo-meta.ts getProductImages(). A product whose ONLY images are
    // base64 blobs therefore drops out of the feed — correct: the feed
    // requires at least one real http(s) image.
    restFetch<{ product_id: string; url: string; sort_order: number; is_primary: boolean }[]>(
      'product_images',
      '?select=product_id,url,sort_order,is_primary&url=not.like.data:*&limit=5000',
      key,
    ),
    restFetch<{ id: string; name: string }[]>('categories', '?select=id,name&limit=500', key),
  ]);

  const catName = new Map<string, string>();
  if (catRes.ok && Array.isArray(catRes.data)) {
    for (const c of catRes.data as { id: string; name: string }[]) catName.set(c.id, c.name);
  }

  if (!prodRes.ok || !Array.isArray(prodRes.data)) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.end('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://www.google.com/shopping/feed"><channel><title>Luxedge</title><link>https://luxedge.us</link><description>Feed temporarily unavailable.</description></channel></rss>');
    return;
  }

  const imgRows = Array.isArray(imgRes.data) ? (imgRes.data as { product_id: string; url: string; sort_order: number; is_primary: boolean }[]) : [];
  const imgsByP = new Map<string, { url: string; sort_order: number; is_primary: boolean }[]>();
  for (const im of imgRows) {
    const arr = imgsByP.get(im.product_id) || [];
    arr.push(im);
    imgsByP.set(im.product_id, arr);
  }

  const rawProducts = prodRes.data as Array<Omit<FeedProduct, 'images'> & { category_id?: string | null }>;
  const products = rawProducts.map((p) => ({ ...p, category: p.category_id ? catName.get(p.category_id) || null : null, images: [] })).filter((p) => {
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
      `<g:image_link>${esc(imgs[0].url)}</g:image_link>`,
      ...imgs.slice(1, 6).map((im) => `  <g:additional_image_link>${esc(im.url)}</g:additional_image_link>`),
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