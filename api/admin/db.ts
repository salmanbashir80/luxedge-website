import type { IncomingMessage, ServerResponse } from 'node:http';
import { requireAdmin } from '../_lib/auth.js';
import { sendJson, readJsonBody } from '../_lib/providers.js';
import { getDataRuntime, isD1Backend } from '../../worker/d1/runtime.js';
import { TABLE_SCHEMA } from '../../worker/d1/table-schema.js';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const admin = await requireAdmin(req, res);
  if (!admin) return; // 401/403 sent

  if (!isD1Backend()) {
    sendJson(res, 503, { error: 'Admin DB mutations are only supported on the D1 backend.' });
    return;
  }
  const db = getDataRuntime().db!;

  // Path: /api/admin/db/<table>?column=eq.value
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathParts = url.pathname.split('/').filter(Boolean);
  // Expected: ["api", "admin", "db", "table"]
  const table = pathParts[3];
  if (!table || !TABLE_SCHEMA[table]) {
    sendJson(res, 400, { error: `Unknown or read-only table: ${table || '(none)'}` });
    return;
  }

  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET') {
    sendJson(res, 405, { error: 'Method not allowed. Use /api/db for reads.' });
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
        cols.push(`"${k}"`);
        placeholders.push('?');
        // Handle coercion for insert
        if (schema.bool?.includes(k)) {
          values.push(v === true || v === 1 || v === 'true' ? 1 : 0);
        } else if (schema.json?.includes(k)) {
          values.push(typeof v === 'string' ? v : JSON.stringify(v));
        } else {
          values.push(v);
        }
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
        sets.push(`"${k}" = ?`);
        if (schema.bool?.includes(k)) {
          values.push(v === true || v === 1 || v === 'true' ? 1 : 0);
        } else if (schema.json?.includes(k)) {
          values.push(typeof v === 'string' ? v : JSON.stringify(v));
        } else {
          values.push(v);
        }
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
