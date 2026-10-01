// ============================================================================
// LUXEDGE — GOOGLE PRODUCT FEED BACKEND TESTS
//
// Drives the REAL /google-products.xml handler against the REAL migration
// (cloudflare/d1/migrations/0001_storefront_read.sql) running in an in-memory
// SQLite engine, exactly like the auth/checkout D1 suites do.
//
// Locks the recovery behavior for the Supabase 402 outage:
//   * D1 serves the feed (status=active, price>0, ≥1 real http(s) image)
//   * base64-only products drop out (the server-side url=not.like.data:* filter)
//   * a /img/... local mirror is a valid feed image (absolutized by Google)
//   * NO data is fabricated: feed failure = 502, not-configured = 503,
//     image/category read failure = valid EMPTY feed (unchanged semantics)
//   * Supabase backend unchanged: D1-only errors must not change its answers
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import feedHandler from '../google-feed.js';
import { resetDataRuntime, getDataRuntime } from '../../worker/d1/runtime';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = path.join(ROOT, 'cloudflare', 'd1', 'migrations');

function migrations(): string {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n');
}

function d1From(db: DatabaseSync) {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      return {
        bind(...params: unknown[]) {
          const bound = params.map((p) => (p === undefined ? null : p)) as never[];
          return {
            all: async () => ({ results: stmt.all(...bound) as Record<string, unknown>[] }),
            run: async () => ({ meta: { changes: Number(stmt.run(...bound).changes) } }),
          };
        },
      };
    },
  };
}

let db: DatabaseSync;
function fresh() {
  db = new DatabaseSync(':memory:');
  db.exec(migrations());
  resetDataRuntime({ DATA_BACKEND: 'd1', DB: d1From(db) });
}

function makeRes(): { server: ServerResponse; body: () => string; status: () => number } {
  const cap = { code: 200, text: '' };
  const server = {
    statusCode: 200,
    setHeader: () => {},
    // A real ServerResponse resolves statusCode at end()-time; mirror that.
    end: (chunk?: string | Uint8Array) => {
      cap.text = typeof chunk === 'string' ? chunk : '';
      cap.code = (server as unknown as { statusCode: number }).statusCode;
    },
  };
  return {
    server: server as unknown as ServerResponse,
    body: () => cap.text,
    status: () => cap.code,
  };
}

const now = '2026-10-01T00:00:00Z';

function product(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'p1',
    slug: 'test-product',
    title: 'Test Product',
    name: 'Test Product',
    description: 'A test product description.',
    status: 'active',
    currency: 'USD',
    short_description: '',
    tax_code: '',
    features: '[]',
    benefits: '[]',
    specifications: '{}',
    seo_keywords: '',
    tags: '[]',
    risk_flags: '',
    created_at: now,
    updated_at: now,
    price: 24.99,
    category_id: 'c1',
    brand: 'Luxedge',
    ...over,
  };
}

function insertProduct(p: Record<string, unknown>): void {
  const cols = Object.keys(p);
  const ph = cols.map(() => '?').join(', ');
  db.prepare(`INSERT INTO products (${cols.join(', ')}) VALUES (${ph})`).run(...(Object.values(p) as never[]));
}

function image(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'i1',
    product_id: 'p1',
    storage_path: 'sp',
    public_url: '/img/x.jpg',
    alt_text: '',
    sort_order: 0,
    created_at: now,
    url: 'https://cdn.example.test/x.jpg',
    kind: 'gallery',
    is_primary: 1,
    ...over,
  };
}

function insertImage(i: Record<string, unknown>): void {
  const cols = Object.keys(i);
  const ph = cols.map(() => '?').join(', ');
  db.prepare(`INSERT INTO product_images (${cols.join(', ')}) VALUES (${ph})`).run(...(Object.values(i) as never[]));
}

function feedItems(body: string): string[] {
  return body.split('\n').filter((l) => l.trim() === '<item>');
}

function feedImageLinks(body: string): string[] {
  return body
    .split('\n')
    .filter((l) => l.includes('<g:image_link>') || l.includes('<g:additional_image_link>'))
    .map((l) => l.replace(/<\/?g:(additional_)?image_link>/g, '').trim());
}

beforeEach(() => {
  fresh();
});

afterEach(() => {
  resetDataRuntime();
});

describe('google feed — D1 backend', () => {
  it('serves active products with a real image, price, brand and category from D1', async () => {
    db.exec("INSERT INTO categories (id, name, slug, description) VALUES ('c1', 'Dog Travel', 'dog-travel', '')");
    insertProduct(product());
    insertImage(image());

    const { server, body, status } = makeRes();
    await feedHandler({} as never, server);

    expect(status()).toBe(200);
    expect(body()).toContain('<g:title>Test Product</g:title>');
    expect(body()).toContain('<g:price>24.99 USD</g:price>');
    expect(body()).toContain('<g:brand>Luxedge</g:brand>');
    expect(body()).toContain('<g:product_type>Dog Travel</g:product_type>');
    expect(feedImageLinks(body())[0]).toBe('https://cdn.example.test/x.jpg');
  });

  it('excludes non-active products and products without images or price', async () => {
    insertProduct(product({ id: 'p1', slug: 'draft-one' }));
    insertImage(image({ id: 'i1', product_id: 'p1', url: 'https://cdn.example.test/kept.jpg' }));
    insertProduct(product({ id: 'p2', slug: 'draft-two', status: 'draft' }));
    insertProduct(product({ id: 'p3', slug: 'free-but-imaged', price: 0 }));
    insertProduct(product({ id: 'p4', slug: 'priced-but-no-image' }));
    insertImage(image({ id: 'i3', product_id: 'p3', url: 'https://cdn.example.test/free.jpg' }));

    const { server, body, status } = makeRes();
    await feedHandler({} as never, server);

    expect(status()).toBe(200);
    expect(feedItems(body()).length).toBe(1);
    expect(body()).toContain('<g:id>p1</g:id>');
    expect(body()).not.toContain('<g:id>p2</g:id>');
    expect(body()).not.toContain('<g:id>p3</g:id>');
    expect(body()).not.toContain('<g:id>p4</g:id>');
  });

  it('orders images primary-first and orders items by slug', async () => secondary());

  async function secondary(): Promise<void> {
    db.exec("INSERT INTO categories (id, name, slug, description) VALUES ('c1', 'Cat', 'cat', '')");
    insertProduct(product({ id: 'pA', slug: 'a-first', name: 'A First', brand: 'B', category_id: 'c1' }));
    insertProduct(product({ id: 'pB', slug: 'b-second', name: 'B Second', brand: 'B', category_id: 'c1' }));
    insertImage(image({ id: 'iA1', product_id: 'pA', url: 'https://cdn.example.test/a-gallery.jpg', sort_order: 2, is_primary: 0 }));
    insertImage(image({ id: 'iA2', product_id: 'pA', url: 'https://cdn.example.test/a-primary.jpg', sort_order: 1, is_primary: 1 }));
    insertImage(image({ id: 'iB1', product_id: 'pB', url: 'https://cdn.example.test/b-primary.jpg' }));

    const { server, body, status } = makeRes();
    await feedHandler({} as never, server);

    expect(status()).toBe(200);
    expect(feedItems(body()).length).toBe(2);
    const aIdx = body().indexOf('<g:id>pA</g:id>');
    const bIdx = body().indexOf('<g:id>pB</g:id>');
    expect(aIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeGreaterThan(aIdx);
    const links = feedImageLinks(body());
    expect(links[0]).toBe('https://cdn.example.test/a-primary.jpg');
    expect(links[1]).toBe('https://cdn.example.test/a-gallery.jpg');
    expect(links[2]).toBe('https://cdn.example.test/b-primary.jpg');
  }

  it('keeps a site-relative url when present and absolutizes a public_url fallback for Merchant Center', async () => {
    // Case 1: url is a site-relative mirror (post-0005 state) — absolutized
    insertProduct(product());
    insertImage(image({ id: 'i1', url: '/img/hk/hk-salt-lump.jpg', public_url: '/img/hk/hk-salt-lump.jpg' }));

    const r1 = makeRes();
    await feedHandler({} as never, r1.server);
    expect(r1.status()).toBe(200);
    expect(feedImageLinks(r1.body())[0]).toBe('https://luxedge.us/img/hk/hk-salt-lump.jpg');

    // Case 2: url column empty (passes the NOT LIKE 'data%' filter — NULL
    // would not), mirror only in public_url — absolutized fallback
    db.exec('DELETE FROM product_images');
    insertImage(image({ id: 'i2', url: '', public_url: '/img/hk/hk-salt-lump.jpg' }));

    const r2 = makeRes();
    await feedHandler({} as never, r2.server);
    expect(r2.status()).toBe(200);
    expect(feedImageLinks(r2.body())[0]).toBe('https://luxedge.us/img/hk/hk-salt-lump.jpg');
  });

  it('drops products whose only images are base64 blobs (server-side not.like filter)', async () => {
    insertProduct(product({ id: 'pB64', slug: 'base64-only' }));
    insertImage(image({ id: 'iB', product_id: 'pB64', url: 'data:image/png;base64,AAAA', public_url: 'data:image/png;base64,AAAA' }));

    const { server, body, status } = makeRes();
    await feedHandler({} as never, server);

    expect(status()).toBe(200);
    expect(feedItems(body()).length).toBe(0);
    expect(body()).not.toContain('<g:id>pB64</g:id>');
  });

  it('returns a valid EMPTY feed when the image or category read fails (unchanged degradation)', async () => {
    insertProduct(product());
    // product row reads fine, but the product_images READ itself fails —
    // simulate a D1 error on that one table by dropping it after migration.
    db.exec('DROP TABLE product_images');

    const { server, body, status } = makeRes();
    await feedHandler({} as never, server);

    expect(status()).toBe(200);
    expect(feedItems(body()).length).toBe(0);
    expect(body()).toContain('<channel>');
  });

  it('returns 502 when the products read fails on D1 (never a fabricated feed)', async () => {
    db.exec('DROP TABLE products');

    const { server, body, status } = makeRes();
    await feedHandler({} as never, server);

    expect(status()).toBe(502);
    expect(body()).toContain('Feed temporarily unavailable.');
  });

  it('runs with DATA_BACKEND=d1 but no rows and still answers 200', async () => {
    const { server, body, status } = makeRes();
    await feedHandler({} as never, server);

    expect(status()).toBe(200);
    expect(feedItems(body()).length).toBe(0);
  });
});

describe('google feed — supabase backend unchanged', () => {
  it('still answers 503 when unconfigured (D1-only state must not change this)', async () => {
    // The runtime falls back to process.env when the env override is empty;
    // vitest may carry VITE_SUPABASE_* from the build config, so clear both.
    const saved = {
      url: process.env.VITE_SUPABASE_URL,
      key: process.env.VITE_SUPABASE_ANON_KEY,
    };
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.VITE_SUPABASE_ANON_KEY;
    try {
      resetDataRuntime({ DATA_BACKEND: '', DB: undefined, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' });
      expect(getDataRuntime().backend).toBe('supabase');

      const { server, status } = makeRes();
      await feedHandler({} as never, server);
      expect(status()).toBe(503);
    } finally {
      if (saved.url !== undefined) process.env.VITE_SUPABASE_URL = saved.url;
      if (saved.key !== undefined) process.env.VITE_SUPABASE_ANON_KEY = saved.key;
      resetDataRuntime();
    }
  });
});
