// ============================================================================
// LUXEDGE — POST /api/admin/products  (the EASY way to add a product)
//
// One endpoint, one JSON body — creates a storefront product row +
// product_images rows (same legacy-column discipline as the scout draft
// path), honors the admin-JWT contract, and keeps secrets server-side.
//
//   title       required  product name (3–200 chars)
//   price       required  sell price in USD, > 0
//   status      optional  'live' (default) | 'draft'
//   image_urls  optional  array of http(s) image URLs (max 8)
//   description optional
//   brand       optional
//
// 201 → { ok, id, slug, url, status } · 400 on bad input · 401/403 via
// requireAdmin · 500 fail-closed (never leaks internals).
// status 'live' maps to products.status='active' + an explicit
// COMMERCE_READY stamp (a row without cost/inventory would otherwise be
// hidden by the storefront readiness filter — publishing here is the
// owner's explicit intent).
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { requireAdmin } from '../_lib/auth.js';
import { sendJson, readJsonBody } from '../_lib/providers.js';
import { isD1Backend, getDataRuntime } from '../../worker/d1/runtime.js';

const TAX_CODE = 'txcd_99999999';

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';
}

interface CreateProductInput {
  title?: unknown;
  price?: unknown;
  status?: unknown;
  image_urls?: unknown;
  description?: unknown;
  brand?: unknown;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed — POST only' });
    return;
  }
  const admin = await requireAdmin(req, res);
  if (!admin) return; // 401/403 already sent

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { error: e instanceof Error ? e.message : 'Invalid request body' });
    return;
  }
  const input = body as CreateProductInput;

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title.length < 3 || title.length > 200) {
    sendJson(res, 400, { error: 'title is required (3–200 characters)' });
    return;
  }
  const price = typeof input.price === 'number' && Number.isFinite(input.price) ? input.price : NaN;
  if (!(price > 0)) {
    sendJson(res, 400, { error: 'price is required and must be greater than 0' });
    return;
  }
  const status =
    input.status === 'draft' ? 'draft'
      : input.status === undefined || input.status === null || input.status === 'live' ? 'live'
        : null; // explicit default: live
  if (status === null) {
    sendJson(res, 400, { error: "status must be 'live' or 'draft'" });
    return;
  }
  const images = Array.isArray(input.image_urls) ? input.image_urls : [];
  for (const u of images) {
    if (typeof u !== 'string' || !/^https?:\/\/.+/.test(u)) {
      sendJson(res, 400, { error: 'image_urls must be an array of http(s) URLs' });
      return;
    }
  }
  if (images.length > 8) {
    sendJson(res, 400, { error: 'image_urls supports at most 8 images' });
    return;
  }
  const description = typeof input.description === 'string' && input.description.trim()
    ? input.description.trim().slice(0, 2000)
    : '';
  const brand = typeof input.brand === 'string' ? input.brand.trim().slice(0, 120) : '';

  const base = (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!base || !key) {
    sendJson(res, 503, { error: 'Product API not configured on this deployment' });
    return;
  }

  try {
    const isD1 = isD1Backend();
    let slug = slugify(title);
    for (let n = 2; n < 100; n++) {
      let hitCount = 0;
      if (isD1) {
        const db = getDataRuntime().db!;
        const hit = await db.prepare('SELECT slug FROM products WHERE slug = ?').bind(slug).all<{ slug: string }>();
        if (hit.results && hit.results.length > 0) hitCount = 1;
      } else {
        const hit = await fetch(`${base}/rest/v1/products?select=slug&slug=eq.${slug}`, {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(10_000),
        });
        const rows: { slug: string }[] = hit.ok ? ((await hit.json()) as { slug: string }[]) : [];
        hitCount = rows.length;
      }
      if (hitCount === 0) break;
      slug = `${slugify(title)}-${n}`;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const live = status === 'live';
    const product = {
      id,
      slug,
      title,
      name: title,
      description: [description || title, brand ? `Brand: ${brand}` : ''].filter(Boolean).join(' — '),
      short_description: description || title,
      status: live ? 'active' : 'draft',
      currency: 'USD',
      tax_code: TAX_CODE,
      is_featured: false,
      features: description ? [description.slice(0, 300)] : [],
      benefits: [],
      specifications: {},
      seo_keywords: [],
      brand,
      price,
      compare_at_price: null,
      cost_price: null,
      landed_cost: null,
      gross_margin: null,
      inventory_qty: 0,
      category_id: null,
      commerce_readiness: live ? 'COMMERCE_READY' : null,
      published_at: live ? now : null,
      product_source_evidence: {
        sourceUrl: null,
        supplier: 'api-quick-add',
        status: live ? 'published' : 'draft',
        publishedVia: 'api',
        draftedAt: now,
      },
      created_at: now,
      updated_at: now,
    };

    let productId: string | undefined = undefined;
    if (isD1) {
      const db = getDataRuntime().db!;
      const cols = Object.keys(product).map(k => `"${k}"`);
      const placeholders = Object.keys(product).map(() => '?');
      const values = Object.values(product).map(v => typeof v === 'boolean' ? (v ? 1 : 0) : (v !== null && typeof v === 'object' ? JSON.stringify(v) : v));
      await db.prepare(`INSERT INTO products (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`).bind(...values).run?.();
      productId = product.id;
    } else {
      const insertRes = await fetch(`${base}/rest/v1/products`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify(product),
        signal: AbortSignal.timeout(15_000),
      });
      const inserted = (await insertRes.json()) as Array<{ id: string }> | { message?: string };
      productId = Array.isArray(inserted) ? inserted[0]?.id : undefined;
      if (!insertRes.ok || !productId) {
        sendJson(res, 502, { error: 'Failed to create product in the database' });
        return;
      }
    }

    // product_images legacy NOT NULLs: storage_path, public_url, alt_text.
    let imagesSaved = 0;
    for (let i = 0; i < images.length; i++) {
      const url = images[i] as string;
      const row = {
        id: crypto.randomUUID(),
        product_id: productId,
        storage_path: url,
        public_url: url,
        url,
        alt_text: title,
        kind: 'product',
        is_primary: i === 0,
        sort_order: i,
        created_at: now,
      };
      
      if (isD1) {
        const db = getDataRuntime().db!;
        try {
          const cols = Object.keys(row).map(k => `"${k}"`);
          const placeholders = Object.keys(row).map(() => '?');
          const values = Object.values(row).map(v => typeof v === 'boolean' ? (v ? 1 : 0) : v);
          await db.prepare(`INSERT INTO product_images (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`).bind(...values).run?.();
          imagesSaved++;
        } catch (e) {
          try {
            row.storage_path = `${url}#api-${productId.slice(0, 8)}`;
            const cols = Object.keys(row).map(k => `"${k}"`);
            const placeholders = Object.keys(row).map(() => '?');
            const values = Object.values(row).map(v => typeof v === 'boolean' ? (v ? 1 : 0) : v);
            await db.prepare(`INSERT INTO product_images (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`).bind(...values).run?.();
            imagesSaved++;
          } catch (e2) {}
        }
      } else {
        let imgRes = await fetch(`${base}/rest/v1/product_images`, {
          method: 'POST',
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(row),
          signal: AbortSignal.timeout(15_000),
        });
        if (!imgRes.ok) {
          imgRes = await fetch(`${base}/rest/v1/product_images`, {
            method: 'POST',
            headers: {
              apikey: key,
              Authorization: `Bearer ${key}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ...row, storage_path: `${url}#api-${productId.slice(0, 8)}` }),
            signal: AbortSignal.timeout(15_000),
          });
        }
        if (imgRes.ok) imagesSaved++;
      }
    }

    sendJson(res, 201, { ok: true, id: productId, slug, url: `/product/${slug}`, status: live ? 'active' : 'draft', images: imagesSaved });
  } catch {
    sendJson(res, 500, { error: 'Failed to create product — try again' });
  }
}