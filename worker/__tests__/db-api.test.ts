// ============================================================================
// Tests for the public D1 read API (/api/db) — worker/db-api.ts
//
// Two things matter here:
//   1. It is PUBLIC and unauthenticated, so the deny-by-default allowlists must
//      actually deny (notably: the secrets table must be unreachable).
//   2. Its column projections, the coercion registry and the generated D1
//      migration must not drift. A missing column is a hard query failure, and
//      this repo has already been bitten by that class of bug — see
//      src/services/__tests__/select-schema.test.ts.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { PUBLIC_TABLE_COLUMNS, PUBLIC_TABLES, handleDbApi } from '../db-api';
import { TABLE_SCHEMA } from '../d1/table-schema';
import { resetDataRuntime, setDataRuntime } from '../d1/runtime';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = path.join(ROOT, 'cloudflare', 'd1', 'migrations');

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * The whole D1 migration lineage, concatenated.
 *
 * The column-drift contract is "this column exists in the D1 schema", not "it
 * exists in file 0001": the storefront read surface lives in the generated
 * 0001 and commerce in the hand-authored 0002 (commerce is not public, so it is
 * not in the generator's table list). Reading one file would make the contract
 * silently stop covering whichever half it does not name.
 */
const readMigrations = () =>
  fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n');

/**
 * Column names declared for `table` in the D1 migration.
 * Parsed by string slicing rather than a regex so there is no escaping to get
 * wrong in a template literal.
 */
function ddlColumns(ddl: string, table: string): Set<string> {
  const marker = `CREATE TABLE IF NOT EXISTS ${table} (`;
  const start = ddl.indexOf(marker);
  if (start === -1) return new Set();
  const end = ddl.indexOf('\n);', start);
  const body = ddl.slice(start + marker.length, end === -1 ? undefined : end);
  const cols = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('--'))
    .map((line) => line.split(/\s+/)[0].replace(/,$/, ''));
  return new Set(cols);
}

/** Stub D1 binding: records what the read layer executed and returns fixed rows. */
function stubD1(rows: Record<string, unknown>[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    prepare(sql: string) {
      const entry = { sql, params: [] as unknown[] };
      return {
        bind(...params: unknown[]) {
          entry.params = params;
          calls.push(entry);
          return { all: async () => ({ results: rows }) };
        },
      };
    },
  };
}

function get(p: string, init?: RequestInit) {
  const url = new URL(`https://luxedge.us${p}`);
  return handleDbApi(new Request(url.toString(), init), url);
}

afterEach(() => {
  resetDataRuntime(null);
});

describe('access control — deny by default', () => {
  it('refuses the secrets table app_settings', async () => {
    const res = await get('/api/db/app_settings?select=key,value&limit=10');
    expect(res.status).toBe(404);
  });

  it('refuses admin/commerce tables that are not in the public read surface', async () => {
    for (const table of ['luxedge_orders', 'customers', 'profiles', 'agent_jobs', 'site_events', 'ai_provider_keys']) {
      const res = await get(`/api/db/${table}?select=id&limit=1`);
      expect(res.status, table).toBe(404);
    }
  });

  it('refuses a non-GET method', async () => {
    const res = await get('/api/db/products?select=id', { method: 'POST' });
    expect(res.status).toBe(405);
  });

  it('refuses select=*', async () => {
    const res = await get('/api/db/products?select=*&limit=1');
    expect(res.status).toBe(400);
  });

  it('refuses a non-public column in the projection', async () => {
    // owner_notes / evidence_notes are internal sourcing notes.
    for (const col of ['owner_notes', 'evidence_notes', 'agent_score']) {
      const res = await get(`/api/db/products?select=id,${col}&limit=1`);
      expect(res.status, col).toBe(400);
    }
  });

  it('refuses filtering on a non-public column (row existence leaks too)', async () => {
    const res = await get('/api/db/products?select=id&owner_notes=eq.x&limit=1');
    expect(res.status).toBe(400);
  });

  it('refuses ordering by a non-public column', async () => {
    const res = await get('/api/db/products?select=id&order=owner_notes.asc&limit=1');
    expect(res.status).toBe(400);
  });
});

describe('serving reads from D1', () => {
  it('returns projected, coerced rows for a public query', async () => {
    const db = stubD1([{ id: 'p1', slug: 'dog-collar', is_featured: 1, tags: 'dog,collar' }]);
    setDataRuntime({ DATA_BACKEND: 'd1', DB: db });

    const res = await get('/api/db/products?select=id,slug,is_featured,tags&limit=10');
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>[];
    expect(body).toHaveLength(1);
    expect(body[0].is_featured).toBe(true); // stored 1 -> real boolean
    expect(body[0].tags).toBe('dog,collar'); // stays raw for parseTagList
  });

  it('never returns a non-public column even if a row carries one', async () => {
    const db = stubD1([{ id: 'p1', slug: 'x', owner_notes: 'internal margin note' }]);
    setDataRuntime({ DATA_BACKEND: 'd1', DB: db });

    const res = await get('/api/db/products?select=id,slug&limit=10');
    const body = (await res.json()) as Record<string, unknown>[];
    expect(body[0]).not.toHaveProperty('owner_notes');
  });

  it('marks the response non-indexable and cacheable for a minute', async () => {
    const db = stubD1([]);
    setDataRuntime({ DATA_BACKEND: 'd1', DB: db });
    const res = await get('/api/db/products?select=id&limit=10');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
  });

  it('reports 503 — never an empty 200 — when no backend can answer', async () => {
    setDataRuntime({}); // no D1 binding and no Supabase URL configured
    const res = await get('/api/db/products?select=id&limit=10');
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('60');
  });
});

describe('column-drift contract', () => {
  const clientSelects: [string, string, string][] = [
    ['products', 'PRODUCTS_PUBLIC_SELECT', 'src/services/catalog.ts'],
    ['categories', 'CATEGORIES_PUBLIC_SELECT', 'src/services/catalog.ts'],
    ['product_images', 'PRODUCT_IMAGES_PUBLIC_SELECT', 'src/services/catalog.ts'],
    ['product_variants', 'PRODUCT_VARIANTS_PUBLIC_SELECT', 'src/services/catalog.ts'],
    ['coupons', 'COUPONS_PUBLIC_SELECT', 'src/services/catalog.ts'],
    ['store_settings', 'STORE_SETTINGS_PUBLIC_SELECT', 'src/services/catalog.ts'],
    ['blog_posts', 'BLOG_LIST_PUBLIC_SELECT', 'src/services/blog.ts'],
    ['media_videos', 'MEDIA_LIST_PUBLIC_SELECT', 'src/services/media.ts'],
  ];

  /** Extracts a quoted public-select constant from source text. */
  function selectConstant(source: string, name: string): string[] | null {
    const at = source.indexOf(`export const ${name}`);
    if (at === -1) return null;
    const firstQuote = source.indexOf("'", at);
    const secondQuote = source.indexOf("'", firstQuote + 1);
    if (firstQuote === -1 || secondQuote === -1) return null;
    return source
      .slice(firstQuote + 1, secondQuote)
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c.length > 0 && !c.includes('('));
  }

  it('every PUBLIC client select column is exposed by the public API', () => {
    const sources = new Map<string, string>();
    for (const [, , file] of clientSelects) {
      if (!sources.has(file)) sources.set(file, read(file));
    }
    for (const [table, constant, file] of clientSelects) {
      const cols = selectConstant(sources.get(file) as string, constant);
      expect(cols, `${constant} not found in ${file}`).not.toBeNull();
      for (const col of cols as string[]) {
        expect(PUBLIC_TABLE_COLUMNS[table], `${table}.${col} missing`).toContain(col);
      }
    }
  });

  it('every public API column exists in the D1 migration lineage', () => {
    const ddl = readMigrations();
    for (const table of PUBLIC_TABLES) {
      const declared = ddlColumns(ddl, table);
      expect(declared.size, `no DDL for ${table}`).toBeGreaterThan(0);
      for (const col of PUBLIC_TABLE_COLUMNS[table]) {
        expect(declared.has(col), `${table}.${col} not in D1 migration`).toBe(true);
      }
    }
  });

  it('every column named in the coercion registry exists in the D1 migration lineage', () => {
    const ddl = readMigrations();
    for (const [table, schema] of Object.entries(TABLE_SCHEMA)) {
      const declared = ddlColumns(ddl, table);
      expect(declared.size, `no DDL for ${table}`).toBeGreaterThan(0);
      for (const col of [...schema.bool, ...schema.json]) {
        expect(declared.has(col), `registry column ${table}.${col} not in D1 migration`).toBe(true);
      }
    }
  });

  it('the public read surface stays small and explicitly enumerated', () => {
    expect([...PUBLIC_TABLES].sort()).toEqual(
      [
        'blog_posts',
        'categories',
        'coupons',
        'media_videos',
        'product_images',
        'product_variants',
        'products',
        'store_offers',
        'store_settings',
      ].sort(),
    );
  });
});
