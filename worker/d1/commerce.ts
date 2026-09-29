// ============================================================================
// LUXEDGE — D1 COMMERCE LAYER (orders, inventory holds, webhook idempotency)
//
// WHY THIS EXISTS: api/checkout-onsite.ts, api/webhook.ts and api/admin/erp.ts
// persist orders through Supabase PostgREST, which returns HTTP 402
// exceed_egress_quota — for the service-role key too. The storefront could take
// a real Stripe payment whose order row never lands anywhere. Payment without
// durable order persistence is a release blocker, so this module is the D1
// implementation of exactly the operations those callers perform.
//
// DESIGN: THE SAME SEAM AS THE READ MIGRATION
// `worker/d1/read.ts` accepts PostgREST path strings so the public reads needed
// one changed helper each. Commerce does the same: `commerceFetch(table,
// query, init)` takes the identical `restFetch(...)` arguments the call sites
// already pass, so wiring D1 in is one delegating line per file — and every
// query, validation rule and idempotency guard in those files stays untouched.
//
// FAIL-CLOSED, NEVER SILENT-FALLBACK:
//   * D1 not the active backend   -> returns null (caller uses Supabase)
//   * D1 is active               -> returns a real result, INCLUDING a real
//                                   error. It never falls back to Supabase,
//                                   because a silent fallback would hide a
//                                   broken write behind a 402 and report a
//                                   payment as persisted when it was not.
//
// SECURITY (this layer is server-side only; /api/db is untouched and remains
// deny-by-default):
//   * TABLE allowlist — 4 commerce tables, nothing else is reachable.
//   * COLUMN allowlist per table, checked on read projections AND on every
//     inserted/updated key. An unknown column is refused, so this can never
//     become "write anything anywhere".
//   * Every value is a bound parameter. Identifiers come only from the
//     allowlists, never from the query string.
//   * No generic SQL execution is exposed over HTTP by this or any route.
//
// worker/__tests__/commerce.test.ts pins the allowlists to the DDL in
// cloudflare/d1/migrations/0002_commerce.sql so the two cannot drift.
// ============================================================================

import { buildStatement, coerceRow } from './query';
import { readPostgrestPath } from './read';
import { getDataRuntime, type D1DatabaseLike } from './runtime';

// ---------------------------------------------------------------------------
// Allowlists
// ---------------------------------------------------------------------------

/** Column allowlist per commerce table (transcribed from the live schema). */
export const COMMERCE_COLUMNS: Record<string, readonly string[]> = {
  luxedge_orders: [
    'id', 'order_number', 'customer_email', 'customer_name', 'shipping_address',
    'items', 'coupon_code', 'subtotal', 'discount', 'shipping', 'tax', 'total',
    'currency', 'status', 'stripe_session_id', 'stripe_payment_intent',
    'created_at', 'updated_at', 'refunded_amount', 'refunded_at', 'order_type',
    'payment_required', 'payment_provider', 'payment_provider_payment_id',
    'payment_provider_order_id', 'erp_sync_status', 'erp_synced_at',
    'erp_sync_error', 'payment_status',
    // Written by api/checkout-onsite.ts. Absent from the live Supabase table
    // (they only exist on the unused `orders` table) — see the DDL comment in
    // cloudflare/d1/migrations/0002_commerce.sql and supabase/migrations/0033.
    'shipping_method', 'shipping_carrier', 'shipping_service', 'shipping_rate_id',
    'paid_at', 'customer_phone',
  ],
  inventory_reservations: [
    'id', 'reservation_id', 'product_id', 'quantity', 'status', 'expires_at',
    'created_at', 'consumed_at', 'released_at',
  ],
  order_financials: [
    'id', 'order_id', 'product_cost', 'shipping_cost', 'payment_fee',
    'other_expense', 'refund_amount', 'ops_status', 'supplier',
    'supplier_order_number', 'tracking_number', 'notes', 'created_at',
    'updated_at',
  ],
  processed_webhook_events: ['stripe_event_id', 'event_type', 'processed_at'],
};

export const COMMERCE_TABLES: readonly string[] = Object.keys(COMMERCE_COLUMNS);

export function isCommerceTable(table: string): boolean {
  return COMMERCE_TABLES.includes(table);
}

export function isCommerceColumn(table: string, column: string): boolean {
  const cols = COMMERCE_COLUMNS[table];
  return Array.isArray(cols) && cols.includes(column);
}

/** Every order id is a UUID the app must supply (D1 has no gen_random_uuid()). */
function uuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Deterministic-enough fallback for exotic runtimes; never used in practice.
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

export interface CommerceResult {
  ok: boolean;
  status: number;
  data: unknown;
}

// ---------------------------------------------------------------------------
// Backend access
// ---------------------------------------------------------------------------

function commerceDb(): D1DatabaseLike | null {
  const rt = getDataRuntime();
  return rt.backend === 'd1' && rt.db ? rt.db : null;
}

/** True when this deployment can persist commerce somewhere. */
export function commerceDbActive(): boolean {
  return commerceDb() !== null;
}

/** True when the legacy Supabase side is configured (rollback path). */
export function supabaseConfigured(supabaseBase: string, serviceRole: string): boolean {
  return Boolean(supabaseBase && serviceRole);
}

// ---------------------------------------------------------------------------
// Query parsing (the commerce subset of PostgREST — nothing speculative)
//   select=a,b  |  <col>=eq.v  |  <col>=not.eq.v  |  <col>=in.(a,b)
//   <col>=not.in.(a,b)  |  <col>=is.null  |  <col>=not.is.null
//   order=col.asc|desc  |  limit=n
// ---------------------------------------------------------------------------

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

type FilterOp = 'eq' | 'neq' | 'in' | 'nin' | 'isnull' | 'notnull';

interface Filter {
  column: string;
  op: FilterOp;
  value?: string | string[];
}

interface ParsedCommerce {
  table: string;
  select: string[];
  filters: Filter[];
  order: { column: string; dir: 'ASC' | 'DESC' }[];
  limit: number;
}

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 2000;

function parseCommercePath(path: string): ParsedCommerce | null {
  const qIndex = path.indexOf('?');
  const table = (qIndex === -1 ? path : path.slice(0, qIndex)).replace(/^\//, '').trim();
  if (!IDENT.test(table) || !isCommerceTable(table)) return null;

  const parsed: ParsedCommerce = { table, select: [], filters: [], order: [], limit: DEFAULT_LIMIT };
  const params = new URLSearchParams(qIndex === -1 ? '' : path.slice(qIndex + 1));

  for (const [key, value] of params.entries()) {
    if (key === 'select') {
      for (const token of value.split(',')) {
        const col = token.trim();
        if (!col) continue;
        if (col === '*') return null; // projection-limited: never SELECT *
        if (!IDENT.test(col) || !isCommerceColumn(table, col)) return null;
        parsed.select.push(col);
      }
      continue;
    }
    if (key === 'order') {
      for (const spec of value.split(',')) {
        const bits = spec.trim().split('.');
        if (!IDENT.test(bits[0] || '') || !isCommerceColumn(table, bits[0])) return null;
        const dir = (bits[1] || 'asc').toLowerCase();
        if (dir !== 'asc' && dir !== 'desc') return null;
        parsed.order.push({ column: bits[0], dir: dir === 'desc' ? 'DESC' : 'ASC' });
      }
      continue;
    }
    if (key === 'limit') {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return null;
      parsed.limit = Math.min(Math.floor(n), MAX_LIMIT);
      continue;
    }
    if (!IDENT.test(key) || !isCommerceColumn(table, key)) return null;

    const inMatch = /^in\.\((.*)\)$/.exec(value);
    if (inMatch) {
      parsed.filters.push({ column: key, op: 'in', value: inMatch[1].split(',').map((v) => stripQuotes(v.trim())) });
      continue;
    }
    const notIn = /^not\.in\.\((.*)\)$/.exec(value);
    if (notIn) {
      parsed.filters.push({ column: key, op: 'nin', value: notIn[1].split(',').map((v) => stripQuotes(v.trim())) });
      continue;
    }
    const notEq = /^not\.eq\.(.*)$/.exec(value);
    if (notEq) {
      parsed.filters.push({ column: key, op: 'neq', value: stripQuotes(notEq[1]) });
      continue;
    }
    if (value === 'is.null') {
      parsed.filters.push({ column: key, op: 'isnull' });
      continue;
    }
    if (value === 'not.is.null') {
      parsed.filters.push({ column: key, op: 'notnull' });
      continue;
    }
    const eq = /^eq\.(.*)$/.exec(value);
    if (eq) {
      parsed.filters.push({ column: key, op: 'eq', value: stripQuotes(eq[1]) });
      continue;
    }
    return null; // unsupported operator — refuse rather than guess
  }
  return parsed;
}

function stripQuotes(v: string): string {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  return v;
}

/** SQLite stores booleans as 0/1; PostgREST callers write eq.true / eq.false. */
function bindValue(value: string): string | number {
  if (value === 'true') return 1;
  if (value === 'false') return 0;
  return value;
}

function whereClause(filters: Filter[]): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const clauses: string[] = [];
  for (const f of filters) {
    const col = `"${f.column}"`;
    if (f.op === 'eq') {
      clauses.push(`${col} = ?`);
      params.push(bindValue(String(f.value)));
    } else if (f.op === 'neq') {
      clauses.push(`(${col} IS NULL OR ${col} <> ?)`);
      params.push(bindValue(String(f.value)));
    } else if (f.op === 'isnull') {
      clauses.push(`${col} IS NULL`);
    } else if (f.op === 'notnull') {
      clauses.push(`${col} IS NOT NULL`);
    } else {
      const list = (f.value as string[]) || [];
      if (!list.length) {
        // PostgREST's `in.()` matches nothing / `not.in.()` matches everything.
        clauses.push(f.op === 'in' ? '0 = 1' : '1 = 1');
        continue;
      }
      clauses.push(`${col} ${f.op === 'in' ? 'IN' : 'NOT IN'} (${list.map(() => '?').join(', ')})`);
      params.push(...list.map(bindValue));
    }
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function selectRows(
  db: D1DatabaseLike,
  table: string,
  select: string[],
  filters: Filter[],
  order: { column: string; dir: 'ASC' | 'DESC' }[],
  limit: number,
): Promise<Record<string, unknown>[]> {
  const cols = select.length ? select.map((c) => `"${c}"`).join(', ') : '*';
  const where = whereClause(filters);
  const orderBy = order.length ? ` ORDER BY ${order.map((o) => `"${o.column}" ${o.dir}`).join(', ')}` : '';
  const sql = `SELECT ${cols} FROM "${table}"${where.sql}${orderBy} LIMIT ?`;
  const res = await db.prepare(sql).bind(...where.params, limit).all<Record<string, unknown>>();
  const rows = Array.isArray(res?.results) ? res.results : [];
  return rows.map((row) => coerceRow(table, row)) as Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function changesOf(result: unknown): number {
  const meta = (result as { meta?: { changes?: number } } | null)?.meta;
  return typeof meta?.changes === 'number' ? meta.changes : 0;
}

function isUniqueViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE|constraint failed: .*\./i.test(msg);
}

/** Validates every column of a write against the table's allowlist. */
function assertColumns(table: string, keys: string[]): string | null {
  for (const key of keys) {
    if (!isCommerceColumn(table, key)) return `column not allowed for ${table}: ${key}`;
  }
  return null;
}

async function insertRow(
  db: D1DatabaseLike,
  table: string,
  row: Record<string, unknown>,
): Promise<CommerceResult> {
  // D1 has no gen_random_uuid(): the app must supply the primary key. Postgres
  // filled it in, so the call sites legitimately omit it — supply it here
  // rather than changing every caller (and every caller's idempotency logic).
  const values: Record<string, unknown> = { ...row };
  if (!values.id && isCommerceColumn(table, 'id')) values.id = uuid();

  const bad = assertColumns(table, Object.keys(values));
  if (bad) return { ok: false, status: 400, data: { error: `Refused: ${bad}` } };

  const cols = Object.keys(values);
  const placeholders = cols.map(() => '?').join(', ');
  const sql = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`;
  try {
    await db.prepare(sql).bind(...cols.map((c) => normalizeWriteValue(values[c]))).run?.();
  } catch (err) {
    if (isUniqueViolation(err)) {
      // PostgREST reported 409 + Postgres code 23505 for this; callers branch on
      // both, so keep the identical shape (a replayed webhook must stay a no-op).
      return { ok: false, status: 409, data: { code: '23505', message: 'duplicate key value violates unique constraint' } };
    }
    return { ok: false, status: 503, data: { error: 'Order database write failed.' } };
  }

  const inserted = await selectRows(db, table, [], [{ column: 'id', op: 'eq', value: String(values.id) }], [], 1);
  return { ok: true, status: 201, data: inserted };
}

async function updateRows(
  db: D1DatabaseLike,
  table: string,
  filters: Filter[],
  patch: Record<string, unknown>,
): Promise<CommerceResult> {
  const cols = Object.keys(patch);
  if (!cols.length) return { ok: false, status: 400, data: { error: 'Refused: empty update' } };
  const bad = assertColumns(table, cols);
  if (bad) return { ok: false, status: 400, data: { error: `Refused: ${bad}` } };
  if (!filters.length) {
    // An unfiltered UPDATE would rewrite the whole ledger — never allowed.
    return { ok: false, status: 400, data: { error: 'Refused: update without a filter' } };
  }

  const where = whereClause(filters);
  const sql = `UPDATE "${table}" SET ${cols.map((c) => `"${c}" = ?`).join(', ')}${where.sql}`;
  const params = [...cols.map((c) => normalizeWriteValue(patch[c])), ...where.params];
  try {
    await db.prepare(sql).bind(...params).run?.();
  } catch {
    return { ok: false, status: 503, data: { error: 'Order database update failed.' } };
  }

  const updated = await selectRows(db, table, [], filters, [], MAX_LIMIT);
  return { ok: true, status: 200, data: updated };
}

/** Postgres->SQLite value adaptation for writes (booleans + jsonb). */
function normalizeWriteValue(value: unknown): unknown {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === undefined) return null;
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return value as string | number | null;
}

// ---------------------------------------------------------------------------
// Public entry point — mirrors the local restFetch() signature exactly
// ---------------------------------------------------------------------------

/**
 * Serves one commerce request from D1.
 * Returns null ONLY when D1 is not the active backend, so the caller can use
 * its Supabase path unchanged. Once D1 is active the result is authoritative.
 */
export async function commerceFetch(
  table: string,
  query: string,
  init?: { method?: string; body?: unknown; prefer?: string },
): Promise<CommerceResult | null> {
  const db = commerceDb();
  if (!db) return null;

  const method = (init?.method || 'GET').toUpperCase();

  // The checkout reads the catalog, coupons and settings through the SAME
  // helper it writes orders through. Those are storefront-read tables, already
  // served from D1 by worker/d1/read.ts, so they are delegated instead of being
  // re-implemented here (and so price authority keeps using the one reader).
  if (!isCommerceTable(table)) {
    if (method !== 'GET') {
      return { ok: false, status: 501, data: { error: `D1 does not serve writes to ${table}` } };
    }
    const path = `${table}${query}`;
    if (!buildStatement(path)) {
      return { ok: false, status: 501, data: { error: `D1 does not serve this request: ${path}` } };
    }
    const rows = await readPostgrestPath(path);
    // null means the read could not be answered truthfully — report unavailability
    // rather than an empty list, which would look like "no such product" and
    // silently empty a cart or a storefront.
    if (rows === null) return { ok: false, status: 503, data: { error: 'Storefront database is unavailable.' } };
    return { ok: true, status: 200, data: rows };
  }

  const parsed = parseCommercePath(`${table}${query}`);
  if (!parsed) {
    return {
      ok: false,
      status: 501,
      data: { error: `D1 does not serve this request: ${table}${query}` },
    };
  }

  try {
    if (method === 'GET') {
      const rows = await selectRows(db, parsed.table, parsed.select, parsed.filters, parsed.order, parsed.limit);
      return { ok: true, status: 200, data: rows };
    }

    if (method === 'POST') {
      const body = init?.body;
      const rows = Array.isArray(body) ? body : [body];
      const inserted: Record<string, unknown>[] = [];
      for (const row of rows) {
        if (!row || typeof row !== 'object') return { ok: false, status: 400, data: { error: 'Invalid row' } };
        const res = await insertRow(db, parsed.table, row as Record<string, unknown>);
        if (!res.ok) return res;
        inserted.push(...(res.data as Record<string, unknown>[]));
      }
      return { ok: true, status: 201, data: inserted };
    }

    if (method === 'PATCH') {
      const body = init?.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { ok: false, status: 400, data: { error: 'Invalid patch body' } };
      }
      return await updateRows(db, parsed.table, parsed.filters, body as Record<string, unknown>);
    }

    return { ok: false, status: 405, data: { error: `Method not allowed: ${method}` } };
  } catch {
    return { ok: false, status: 503, data: { error: 'Order database is unavailable.' } };
  }
}

// ---------------------------------------------------------------------------
// Inventory RPCs — the D1 equivalents of migrations 0014/0015
//
// The Postgres functions were atomic because plpgsql ran them in one
// transaction. D1 cannot execute plpgsql, so each step here is an ATOMIC
// CONDITIONAL statement (`... WHERE inventory_qty >= ?`) and the row count
// decides the outcome — which is what actually prevents oversell. The one place
// Postgres got atomicity for free is the reserve step's decrement-then-insert
// pair; it is compensated explicitly below and the reason is recorded.
// ---------------------------------------------------------------------------

const SWEEP_LIMIT = 50;

/** Releases reservations that expired without a webhook, restoring their stock. */
async function sweepExpiredReservations(db: D1DatabaseLike, now: string): Promise<void> {
  const expired = await db
    .prepare(`SELECT id, product_id, quantity FROM inventory_reservations WHERE status = 'reserved' AND expires_at < ? LIMIT ?`)
    .bind(now, SWEEP_LIMIT)
    .all<{ id: string; product_id: string; quantity: number }>();
  for (const row of expired?.results || []) {
    const released = await db
      .prepare(`UPDATE inventory_reservations SET status = 'released', released_at = ? WHERE id = ? AND status = 'reserved'`)
      .bind(now, row.id)
      .run?.();
    // Only the statement that actually flipped the row restores the stock, so a
    // concurrent release can never restore twice.
    if (changesOf(released) > 0) {
      await db
        .prepare(`UPDATE products SET inventory_qty = inventory_qty + ?, updated_at = ? WHERE id = ? AND inventory_qty IS NOT NULL`)
        .bind(row.quantity, now, row.product_id)
        .run?.();
    }
  }
}

export async function reserveInventory(input: {
  reservationId: string;
  productId: string;
  quantity: number;
  expiresAt: string;
}): Promise<{ ok: boolean; reason?: string; remaining?: number | null; untracked?: boolean; already?: boolean }> {
  const db = commerceDb();
  if (!db) return { ok: false, reason: 'db_unavailable' };
  const { reservationId, productId, quantity, expiresAt } = input;
  if (!Number.isFinite(quantity) || quantity < 1) return { ok: false, reason: 'invalid_quantity' };
  if (!expiresAt || expiresAt <= nowIso()) return { ok: false, reason: 'invalid_expiry' };
  const now = nowIso();

  try {
    await sweepExpiredReservations(db, now);

    // Idempotent: this cart already holds this product.
    const existing = await db
      .prepare(`SELECT id FROM inventory_reservations WHERE reservation_id = ? AND product_id = ? LIMIT 1`)
      .bind(reservationId, productId)
      .all<{ id: string }>();
    if ((existing?.results || []).length > 0) return { ok: true, already: true };

    const product = await db
      .prepare(`SELECT inventory_qty FROM products WHERE id = ? LIMIT 1`)
      .bind(productId)
      .all<{ inventory_qty: number | null }>();
    const rows = product?.results || [];
    if (!rows.length) return { ok: false, reason: 'product_not_found' };

    // inventory_qty NULL = untracked stock: record the hold, reduce nothing.
    if (rows[0].inventory_qty === null || rows[0].inventory_qty === undefined) {
      await insertRow(db, 'inventory_reservations', {
        reservation_id: reservationId, product_id: productId, quantity,
        status: 'reserved', expires_at: expiresAt, created_at: now,
      });
      return { ok: true, untracked: true, remaining: null };
    }

    const decremented = await db
      .prepare(
        `UPDATE products SET inventory_qty = inventory_qty - ?, updated_at = ?
          WHERE id = ? AND inventory_qty IS NOT NULL AND inventory_qty >= ?`,
      )
      .bind(quantity, now, productId, quantity)
      .run?.();
    if (changesOf(decremented) === 0) return { ok: false, reason: 'out_of_stock_or_oversell' };

    const hold = await insertRow(db, 'inventory_reservations', {
      reservation_id: reservationId, product_id: productId, quantity,
      status: 'reserved', expires_at: expiresAt, created_at: now,
    });
    if (!hold.ok) {
      // Postgres ran decrement+insert inside one function, so a failed insert
      // rolled the decrement back. D1 cannot, so compensate explicitly: give the
      // stock back and report failure. Losing a sale is recoverable; silently
      // holding stock for a reservation that does not exist is not.
      await db
        .prepare(`UPDATE products SET inventory_qty = inventory_qty + ?, updated_at = ? WHERE id = ? AND inventory_qty IS NOT NULL`)
        .bind(quantity, now, productId)
        .run?.();
      return { ok: false, reason: hold.status === 409 ? 'already_held' : 'reservation_write_failed' };
    }

    const remaining = await db
      .prepare(`SELECT inventory_qty FROM products WHERE id = ? LIMIT 1`)
      .bind(productId)
      .all<{ inventory_qty: number | null }>();
    const left = (remaining?.results || [])[0]?.inventory_qty;
    return { ok: true, remaining: left === undefined ? null : left };
  } catch {
    return { ok: false, reason: 'db_unavailable' };
  }
}

export async function consumeReservation(reservationId: string): Promise<{ ok: boolean; consumed: number; group_size: number }> {
  const db = commerceDb();
  if (!db) return { ok: false, consumed: -1, group_size: -1 };
  const now = nowIso();
  try {
    const held = await db
      .prepare(`SELECT id, product_id, quantity, status FROM inventory_reservations WHERE reservation_id = ?`)
      .bind(reservationId)
      .all<{ id: string; product_id: string; quantity: number; status: string }>();
    const rows = held?.results || [];
    let consumed = 0;

    for (const row of rows) {
      if (row.status === 'consumed') continue; // replay guard — never double-consume
      const flipped = await db
        .prepare(`UPDATE inventory_reservations SET status = 'consumed', consumed_at = ? WHERE id = ? AND status <> 'consumed'`)
        .bind(now, row.id)
        .run?.();
      if (changesOf(flipped) === 0) continue;

      if (row.status === 'reserved') {
        // Stock was already reduced at reserve time — nothing more to do.
        consumed += 1;
      } else {
        // released/expired → stock had been restored, so decrement now, guarded
        // against oversell, so a late async payment still charges stock once.
        await db
          .prepare(
            `UPDATE products SET inventory_qty = inventory_qty - ?, updated_at = ?
              WHERE id = ? AND inventory_qty IS NOT NULL AND inventory_qty >= ?`,
          )
          .bind(row.quantity, now, row.product_id, row.quantity)
          .run?.();
        consumed += 1;
      }
    }
    return { ok: true, consumed, group_size: rows.length };
  } catch {
    return { ok: false, consumed: -1, group_size: -1 };
  }
}

export async function releaseReservation(reservationId: string): Promise<{ ok: boolean; released: number }> {
  const db = commerceDb();
  if (!db) return { ok: false, released: -1 };
  const now = nowIso();
  try {
    const held = await db
      .prepare(`SELECT id, product_id, quantity FROM inventory_reservations WHERE reservation_id = ? AND status = 'reserved'`)
      .bind(reservationId)
      .all<{ id: string; product_id: string; quantity: number }>();
    let released = 0;
    for (const row of held?.results || []) {
      const flipped = await db
        .prepare(`UPDATE inventory_reservations SET status = 'released', released_at = ? WHERE id = ? AND status = 'reserved'`)
        .bind(now, row.id)
        .run?.();
      if (changesOf(flipped) === 0) continue;
      await db
        .prepare(`UPDATE products SET inventory_qty = inventory_qty + ?, updated_at = ? WHERE id = ? AND inventory_qty IS NOT NULL`)
        .bind(row.quantity, now, row.product_id)
        .run?.();
      released += 1;
    }
    return { ok: true, released };
  } catch {
    return { ok: false, released: -1 };
  }
}

export async function decrementInventory(productId: string, quantity: number): Promise<{ ok: boolean; reason?: string; remaining?: number | null; untracked?: boolean }> {
  const db = commerceDb();
  if (!db) return { ok: false, reason: 'db_unavailable' };
  if (!Number.isFinite(quantity) || quantity < 1) return { ok: false, reason: 'invalid_quantity' };
  const now = nowIso();
  try {
    const product = await db
      .prepare(`SELECT inventory_qty FROM products WHERE id = ? LIMIT 1`)
      .bind(productId)
      .all<{ inventory_qty: number | null }>();
    const rows = product?.results || [];
    if (!rows.length) return { ok: false, reason: 'product_not_found' };
    if (rows[0].inventory_qty === null || rows[0].inventory_qty === undefined) return { ok: true, untracked: true, remaining: null };

    const updated = await db
      .prepare(
        `UPDATE products SET inventory_qty = inventory_qty - ?, updated_at = ?
          WHERE id = ? AND inventory_qty IS NOT NULL AND inventory_qty >= ?`,
      )
      .bind(quantity, now, productId, quantity)
      .run?.();
    if (changesOf(updated) === 0) return { ok: false, reason: 'out_of_stock_or_oversell' };
    const left = await db
      .prepare(`SELECT inventory_qty FROM products WHERE id = ? LIMIT 1`)
      .bind(productId)
      .all<{ inventory_qty: number | null }>();
    return { ok: true, remaining: (left?.results || [])[0]?.inventory_qty ?? null };
  } catch {
    return { ok: false, reason: 'db_unavailable' };
  }
}

/**
 * The four service-role RPCs the checkout/webhook call, resolved locally.
 * Returns null when D1 is not the active backend.
 */
export async function commerceRpc(fn: string, body: Record<string, unknown>): Promise<CommerceResult | null> {
  if (!commerceDb()) return null;
  const str = (v: unknown) => String(v ?? '');
  switch (fn) {
    case 'reserve_inventory':
      return {
        ok: true,
        status: 200,
        data: await reserveInventory({
          reservationId: str(body.p_reservation_id),
          productId: str(body.p_product_id),
          quantity: Number(body.p_quantity),
          expiresAt: str(body.p_expires_at),
        }),
      };
    case 'consume_reservation':
      return { ok: true, status: 200, data: await consumeReservation(str(body.p_reservation_id)) };
    case 'release_reservation':
      return { ok: true, status: 200, data: await releaseReservation(str(body.p_reservation_id)) };
    case 'decrement_inventory':
      return {
        ok: true,
        status: 200,
        data: await decrementInventory(str(body.p_product_id), Number(body.p_quantity)),
      };
    default:
      return { ok: false, status: 501, data: { error: `D1 does not implement rpc ${fn}` } };
  }
}

/**
 * Stripe event-id idempotency gate. Records the event id and reports whether
 * this delivery is the FIRST time it has been seen. Returns null when D1 is not
 * active (the caller then relies on its existing order-level guards).
 */
export async function claimWebhookEvent(eventId: string, eventType: string): Promise<{ firstSeen: boolean } | null> {
  const db = commerceDb();
  if (!db) return null;
  if (!eventId) return { firstSeen: true };
  try {
    await db
      .prepare(`INSERT INTO processed_webhook_events (stripe_event_id, event_type, processed_at) VALUES (?, ?, ?)`)
      .bind(eventId, eventType, nowIso())
      .run?.();
    return { firstSeen: true };
  } catch (err) {
    if (isUniqueViolation(err)) return { firstSeen: false };
    // An idempotency-table failure must never block a legitimate payment event:
    // the order-level unique indexes are still the primary guard.
    return { firstSeen: true };
  }
}

export { changesOf as __changesOf, parseCommercePath as __parseCommercePath };
