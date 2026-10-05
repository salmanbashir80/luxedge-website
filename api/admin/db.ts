import type { IncomingMessage, ServerResponse } from 'node:http';
import { requireAdmin } from '../_lib/auth.js';
import { sendJson, readJsonBody } from '../_lib/providers.js';
import { getDataRuntime, isD1Backend } from '../../worker/d1/runtime.js';
import { TABLE_SCHEMA } from '../../worker/d1/table-schema.js';
import { buildStatement, coerceRow } from '../../worker/d1/query.js';

type TableSchemaShape = { bool?: readonly string[]; json?: readonly string[] } | undefined;

/**
 * A value Cloudflare D1 can bind.
 *
 * D1's statement.bind() accepts only null, number, bigint, string and
 * ArrayBuffer views — a JS array or plain object throws D1_TYPE_ERROR and
 * fails the ENTIRE write. The catalog editor's normal Save posts the whole
 * product form, which includes `tags` as an array. `tags` is deliberately a
 * raw TEXT column (AGENTS.md: parseTagList() is the ONE tolerant tags parser,
 * so it is never pre-parsed here) and therefore not in schema.json — so the
 * full-form Save used to 500 on D1 while a partial save (no tags) and a
 * single-column PATCH both succeeded. That is exactly the reported "normal
 * Save silently does nothing" failure. Serializing here keeps the tolerant
 * JSON-string shape every reader already parses.
 */
function d1BindValue(schema: TableSchemaShape, column: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (schema?.bool?.includes(column)) return value === true || value === 1 || value === 'true' ? 1 : 0;
  if (schema?.json?.includes(column)) return typeof value === 'string' ? value : JSON.stringify(value);
  // Never hand D1 an object, array or boolean: serialize it to a scalar.
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

// Only the existing catalog editor's tables. Credentials, buyers, orders and
// authentication tables must never be added to this generic read surface.
const SCOUT_READ_TABLES = new Set(['product_candidates', 'product_scores', 'suppliers', 'supplier_products', 'agent_jobs']);
const CATALOG_READ_TABLES = new Set([
  'products', 'categories', 'product_images', 'product_variants',
  'coupons', 'store_offers', 'store_settings',
]);

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie, Authorization');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const admin = await requireAdmin(req, res);
  if (!admin) return; // 401/403 sent

  if (!isD1Backend()) {
    sendJson(res, 503, { error: 'Admin DB access is only supported on the D1 backend.' });
    return;
  }
  const db = getDataRuntime().db!;

  // Path: /api/admin/db/<table>?column=eq.value
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathParts = url.pathname.split('/').filter(Boolean);
  // Expected: ["api", "admin", "db", "table"]
  const table = pathParts[3];
  // Scout data has not migrated to D1. Authenticated, read-only proxy to its
  // existing Supabase backend; never add these tables to the public projection.
  if (table && SCOUT_READ_TABLES.has(table) && (req.method || 'GET').toUpperCase() === 'GET') {
    const base = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!base || !key) { sendJson(res, 503, { error: 'Scout storage is not configured.' }); return; }
    try {
      const upstream = await fetch(`${base}/rest/v1/${table}${url.search}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000),
      });
      if (!upstream.ok) { sendJson(res, upstream.status === 402 ? 402 : 503, { error: `Scout storage unavailable (Supabase HTTP ${upstream.status}). No scores can be shown.` }); return; }
      const rows = await upstream.json();
      if (!Array.isArray(rows)) throw new Error('Invalid Scout response');
      sendJson(res, 200, rows);
    } catch { sendJson(res, 503, { error: 'Scout storage unreachable. No scores can be shown.' }); }
    return;
  }
  if (!table || !TABLE_SCHEMA[table]) {
    sendJson(res, 400, { error: `Unknown or read-only table: ${table || '(none)'}` });
    return;
  }

  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET') {
    if (!CATALOG_READ_TABLES.has(table)) {
      sendJson(res, 403, { error: 'This table is not available through catalog reads.' });
      return;
    }
    const statement = buildStatement(`${table}${url.search}`);
    if (!statement) {
      sendJson(res, 400, { error: 'Unsupported catalog query.' });
      return;
    }
    try {
      const result = await db.prepare(statement.sql).bind(...statement.params).all();
      // No public listing projection: descriptions/SEO/internal editor fields
      // are needed for accurate read-after-write and conflict-safe Undo.
      sendJson(res, 200, (result.results || []).map(row => coerceRow(table, row)));
    } catch {
      sendJson(res, 503, { error: 'Catalog read unavailable. Please try again.' });
    }
    return;
  }

  const schema = TABLE_SCHEMA[table];

  try {
    if (method === 'POST') {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const cols: string[] = [];
      const placeholders: string[] = [];
      const values: unknown[] = [];
      for (const [k, v] of Object.entries(body)) {
        // `undefined` is not bindable — leave the column to its default.
        if (v === undefined) continue;
        cols.push(`"${k}"`);
        placeholders.push('?');
        values.push(d1BindValue(schema, k, v));
      }
      if (!cols.length) {
        sendJson(res, 400, { error: 'Empty payload' });
        return;
      }
      const sql = `INSERT INTO "${table}" (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
      const result = await db.prepare(sql).bind(...values).all();
      const inserted = result.results?.[0] || body;
      sendJson(res, 201, [inserted]);
      return;
    }

    if (method === 'PATCH' || method === 'DELETE') {
      let filterCol = '';
      let filterVal = '';
      for (const [key, val] of url.searchParams.entries()) {
        const eqMatch = /^eq\.(.*)$/.exec(val);
        if (eqMatch) {
          filterCol = key;
          filterVal = eqMatch[1];
          break;
        }
      }
      if (!filterCol || !filterVal) {
        sendJson(res, 400, { error: 'Missing eq. filter for PATCH/DELETE' });
        return;
      }

      if (method === 'DELETE') {
        const sql = `DELETE FROM "${table}" WHERE "${filterCol}" = ?`;
        await db.prepare(sql).bind(filterVal).run?.();
        sendJson(res, 204, null);
        return;
      }

      // PATCH
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const sets: string[] = [];
      const values: unknown[] = [];
      for (const [k, v] of Object.entries(body)) {
        // A field the caller did not provide (undefined) must not be written.
        if (v === undefined) continue;
        sets.push(`"${k}" = ?`);
        values.push(d1BindValue(schema, k, v));
      }
      if (!sets.length) {
        sendJson(res, 400, { error: 'Empty payload' });
        return;
      }
      values.push(filterVal);
      const sql = `UPDATE "${table}" SET ${sets.join(', ')} WHERE "${filterCol}" = ? RETURNING *`;
      const result = await db.prepare(sql).bind(...values).all();
      const updated = result.results?.[0] || null;
      if (!updated) {
        sendJson(res, 404, { error: 'Not found' });
      } else {
        sendJson(res, 200, [updated]);
      }
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    sendJson(res, 500, { error: (e as Error).message });
  }
}
