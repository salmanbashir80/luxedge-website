// ============================================================================
// SALES MANAGEMENT — /api/admin/sales  (Sales & Profit module, admin-only)
//
//   GET  ?action=orders&from&to&status&q&limit&offset   — orders + financial sidecar
//   POST ?action=order-financials { order_id, …fields }  — upsert manual fields
//   GET  ?action=expenses&from&to                       — general business expenses
//   POST ?action=expenses-create  { …expense }          — create
//   POST ?action=expenses-update  { id, …fields }       — update
//   POST ?action=expenses-delete  { id }                — SOFT delete (deleted_at)
//   GET  ?action=sheets-status                          — Google Sheets connection state
//   POST ?action=sheets-sync                            — optional sync (clean seam)
//
// SECURITY:
//   - requireAdmin (verified Supabase JWT, app_metadata.role='admin') on
//     EVERY action — financial data is never public.
//   - The service-role key stays server-side (api/_lib/supabase pattern).
//   - luxedge_orders is read-only here (original order facts are preserved);
//     only order_financials / business_expenses are written.
//   - Every money input is validated: finite, >= 0, <= 99,999,999.99.
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody } from '../_lib/providers.js';
import { requireAdmin } from '../_lib/auth.js';
import { supabaseAdmin, supabaseHeaders } from '../_lib/supabase.js';

const MAX_MONEY = 99_999_999.99;

const OPS_STATUSES = new Set([
  'pending', 'paid', 'processing', 'ordered_from_supplier', 'shipped',
  'delivered', 'cancelled', 'partially_refunded', 'refunded',
]);

const EXPENSE_CATEGORIES = new Set([
  'Advertising', 'Software', 'Hosting', 'Domain', 'Supplier', 'Shipping',
  'Payment Fees', 'Bank Fees', 'Contractor', 'Office',
  'Professional Services', 'Miscellaneous',
]);

interface RestResult { ok: boolean; status: number; data: unknown }

async function rest(table: string, query: string, init?: RequestInit): Promise<RestResult> {
  const cfg = supabaseAdmin();
  if (!cfg) return { ok: false, status: 503, data: { error: 'Database is not configured on this deployment.' } };
  try {
    const headers = supabaseHeaders(cfg.serviceRole, init?.body !== undefined);
    // Preserve PostgREST response preferences used by update/insert handlers.
    // In particular, `return=representation` lets callers distinguish an
    // updated row from a zero-row PATCH (and prevents a false insert/retry).
    const prefer = new Headers(init?.headers).get('Prefer');
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(`${cfg.url}/rest/v1/${table}${query}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 502, data: { error: 'Database is unreachable right now.' } };
  }
}

/** Validate a money input: finite, >= 0, within bounds. Returns null when invalid. */
function parseMoney(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > MAX_MONEY) return null;
  return Math.round(n * 100) / 100;
}

function parseStr(v: unknown, max = 500): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function parseDate(v: unknown): string | null {
  const s = parseStr(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// ---------------------------------------------------------------------------
// Row mapping: luxedge_orders row + optional order_financials row → SalesOrder
// ---------------------------------------------------------------------------
interface OrderRow {
  id: string;
  order_number: string;
  created_at: string;
  customer_name: string | null;
  customer_email: string | null;
  items: unknown;
  total: number | null;
  refunded_amount: number | null;
  status: string | null;
  payment_provider: string | null;
  coupon_code: string | null;
}

interface FinRow {
  id: string;
  order_id: string;
  product_cost: number | null;
  shipping_cost: number | null;
  payment_fee: number | null;
  other_expense: number | null;
  refund_amount: number | null;
  ops_status: string | null;
  supplier: string | null;
  supplier_order_number: string | null;
  tracking_number: string | null;
  notes: string | null;
}

function itemsLabel(items: unknown): string {
  if (!Array.isArray(items)) return '';
  return items
    .map((raw) => {
      const it = (raw || {}) as { name?: unknown; qty?: unknown; quantity?: unknown };
      const name = parseStr(it.name, 80) || 'Item';
      const qty = Number(it.qty ?? it.quantity ?? 1) || 1;
      return qty > 1 ? `${name} ×${qty}` : name;
    })
    .join(', ')
    .slice(0, 300);
}

function emptyFin(orderId: string) {
  return {
    id: null as string | null,
    order_id: orderId,
    product_cost: 0, shipping_cost: 0, payment_fee: 0, other_expense: 0,
    refund_amount: null as number | null,
    ops_status: null as string | null,
    supplier: '', supplier_order_number: '', tracking_number: '', notes: '',
  };
}

function toSalesOrder(o: OrderRow, f: FinRow | undefined) {
  const fin = f || emptyFin(o.id);
  return {
    id: o.id,
    orderNumber: o.order_number,
    createdAt: o.created_at,
    customerName: o.customer_name || '',
    customerEmail: o.customer_email || '',
    itemsLabel: itemsLabel(o.items),
    saleAmount: Number(o.total || 0),
    providerRefund: Number(o.refunded_amount || 0),
    status: o.status || 'pending',
    paymentProvider: o.payment_provider || '',
    fin: {
      id: fin.id,
      productCost: Number(fin.product_cost || 0),
      shippingCost: Number(fin.shipping_cost || 0),
      paymentFee: Number(fin.payment_fee || 0),
      otherExpense: Number(fin.other_expense || 0),
      refundAmount: fin.refund_amount === null || fin.refund_amount === undefined ? null : Number(fin.refund_amount),
      opsStatus: fin.ops_status,
      supplier: fin.supplier || '',
      supplierOrderNumber: fin.supplier_order_number || '',
      trackingNumber: fin.tracking_number || '',
      notes: fin.notes || '',
    },
  };
}

const ORDER_COLUMNS = 'id,order_number,created_at,customer_name,customer_email,items,total,refunded_amount,status,payment_provider,coupon_code';
const FIN_COLUMNS = 'id,order_id,product_cost,shipping_cost,payment_fee,other_expense,refund_amount,ops_status,supplier,supplier_order_number,tracking_number,notes';
const EXPENSE_COLUMNS = 'id,expense_date,category,description,amount,payment_method,receipt_url,notes';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  // Admin-only, every action. Financial data never leaves the owner console.
  if (!(await requireAdmin(req, res))) return;

  const cfg = supabaseAdmin();
  if (!cfg) { sendJson(res, 503, { error: 'Database is not configured on this deployment.' }); return; }

  const url = new URL(req.url || '/', 'http://localhost');
  const action = url.searchParams.get('action') || '';

  // -------------------------------------------------------------------------
  // GET ?action=orders — orders joined with the manual financial sidecar.
  // Date filtering is server-side; effective-status + text filter and paging
  // happen on the joined rows (small owner-side volumes; one query each).
  // -------------------------------------------------------------------------
  if (req.method === 'GET' && action === 'orders') {
    const from = parseDate(url.searchParams.get('from')) || '';
    const to = parseDate(url.searchParams.get('to')) || '';
    const statusFilter = parseStr(url.searchParams.get('status'), 40);
    const q = parseStr(url.searchParams.get('q'), 80).toLowerCase();
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 5000);
    const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
    const includeGifts = url.searchParams.get('includeGifts') === 'true';

    let query = `?select=${ORDER_COLUMNS}&order=created_at.desc&limit=5000`;
    if (from) query += `&created_at=gte.${from}T00:00:00`;
    if (to) query += `&created_at=lte.${to}T23:59:59.999`;
    // NOTE: `coupon_code=not.eq.X` silently drops rows where coupon_code IS
    // NULL (SQL three-valued logic) — i.e. every real customer order placed
    // without a coupon. Keep those: exclude ONLY the gift-drop rows.
    if (!includeGifts) query += '&or=(coupon_code.neq.PET-GIFT-DROP,coupon_code.is.null)';

    const r = await rest('luxedge_orders', query);
    if (!r.ok || !Array.isArray(r.data)) { sendJson(res, r.status, r.data); return; }
    const orderRows = r.data as OrderRow[];

    // One batched fetch of the sidecar rows for these orders.
    let finByOrder = new Map<string, FinRow>();
    if (orderRows.length > 0) {
      const ids = orderRows.map((o) => `"${o.id}"`).join(',');
      const f = await rest('order_financials', `?select=${FIN_COLUMNS}&order_id=in.(${ids})`);
      // Never report a misleading zero-cost order when the financial sidecar
      // failed to load. Fail closed so the admin can retry instead of trusting
      // inflated profit figures.
      if (!f.ok || !Array.isArray(f.data)) {
        sendJson(res, f.status || 502, { error: 'Could not load order financial details. Please retry.' });
        return;
      }
      finByOrder = new Map((f.data as FinRow[]).map((row) => [row.order_id, row]));
    }

    let rows = orderRows.map((o) => toSalesOrder(o, finByOrder.get(o.id)));
    if (statusFilter && statusFilter !== 'all') {
      rows = rows.filter((row) => (row.fin.opsStatus || row.status) === statusFilter);
    }
    if (q) {
      rows = rows.filter((row) =>
        row.orderNumber.toLowerCase().includes(q) ||
        row.customerName.toLowerCase().includes(q) ||
        row.customerEmail.toLowerCase().includes(q) ||
        row.fin.supplier.toLowerCase().includes(q) ||
        row.fin.trackingNumber.toLowerCase().includes(q) ||
        row.itemsLabel.toLowerCase().includes(q));
    }
    const total = rows.length;
    rows = rows.slice(offset, offset + limit);
    sendJson(res, 200, { orders: rows, total, limit, offset });
    return;
  }

  // -------------------------------------------------------------------------
  // POST ?action=order-financials — upsert the manual sidecar (inline cell save).
  // Only order_financials is written; luxedge_orders is never modified.
  // -------------------------------------------------------------------------
  if (req.method === 'POST' && action === 'order-financials') {
    let body: Record<string, unknown>;
    try { body = (await readJsonBody(req)) as Record<string, unknown>; }
    catch (e) { sendJson(res, 400, { error: (e as Error).message }); return; }

    const orderId = parseStr(body.order_id, 64);
    if (!orderId) { sendJson(res, 400, { error: 'order_id is required.' }); return; }

    const patch: Record<string, unknown> = {};
    for (const field of ['product_cost', 'shipping_cost', 'payment_fee', 'other_expense', 'refund_amount'] as const) {
      if (body[field] !== undefined) {
        if (body[field] === null && field === 'refund_amount') { patch[field] = null; continue; }
        const n = parseMoney(body[field]);
        if (n === null) { sendJson(res, 400, { error: `${field} must be a number between 0 and ${MAX_MONEY}.` }); return; }
        patch[field] = n;
      }
    }
    if (body.ops_status !== undefined) {
      if (body.ops_status === null) { patch.ops_status = null; }
      else if (OPS_STATUSES.has(String(body.ops_status))) { patch.ops_status = String(body.ops_status); }
      else { sendJson(res, 400, { error: 'Unknown order status.' }); return; }
    }
    for (const field of ['supplier', 'supplier_order_number', 'tracking_number', 'notes'] as const) {
      if (body[field] !== undefined) patch[field] = parseStr(body[field], field === 'notes' ? 2000 : 200);
    }
    patch.updated_at = new Date().toISOString();

    // Upsert by unique(order_id): try UPDATE first, INSERT when no row exists.
    const upd = await rest(
      'order_financials',
      `?order_id=eq.${encodeURIComponent(orderId)}&select=id`,
      { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=representation' } },
    );
    if (!upd.ok && upd.status !== 404) { sendJson(res, upd.status, upd.data); return; }
    if (Array.isArray(upd.data) && upd.data.length > 0) { sendJson(res, 200, { ok: true }); return; }

    const ins = await rest(
      'order_financials',
      '',
      { method: 'POST', body: JSON.stringify({ order_id: orderId, ...patch }), headers: { Prefer: 'return=representation' } },
    );
    if (!ins.ok) {
      // 23505 = a concurrent save created the row; retry the update once.
      const retry = await rest(
        'order_financials',
        `?order_id=eq.${encodeURIComponent(orderId)}&select=id`,
        { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=representation' } },
      );
      if (retry.ok && Array.isArray(retry.data) && retry.data.length > 0) { sendJson(res, 200, { ok: true }); return; }
      sendJson(res, ins.status, { error: 'Could not save the financial fields.' });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  // -------------------------------------------------------------------------
  // Expenses — general business expenses (soft-deleted rows stay in history).
  // -------------------------------------------------------------------------
  if (req.method === 'GET' && action === 'expenses') {
    const from = parseDate(url.searchParams.get('from')) || '';
    const to = parseDate(url.searchParams.get('to')) || '';
    let query = `?select=${EXPENSE_COLUMNS}&deleted_at=is.null&order=expense_date.desc,created_at.desc&limit=2000`;
    if (from) query += `&expense_date=gte.${from}`;
    if (to) query += `&expense_date=lte.${to}`;
    const r = await rest('business_expenses', query);
    if (!r.ok || !Array.isArray(r.data)) { sendJson(res, r.status, r.data); return; }
    const expenses = (r.data as Record<string, unknown>[]).map((e) => ({
      id: String(e.id),
      expenseDate: String(e.expense_date || ''),
      category: String(e.category || 'Miscellaneous'),
      description: String(e.description || ''),
      amount: Number(e.amount || 0),
      paymentMethod: String(e.payment_method || ''),
      receiptUrl: String(e.receipt_url || ''),
      notes: String(e.notes || ''),
    }));
    sendJson(res, 200, { expenses });
    return;
  }

  if (req.method === 'POST' && (action === 'expenses-create' || action === 'expenses-update')) {
    let body: Record<string, unknown>;
    try { body = (await readJsonBody(req)) as Record<string, unknown>; }
    catch (e) { sendJson(res, 400, { error: (e as Error).message }); return; }

    const expenseDate = parseDate(body.expense_date ?? body.expenseDate);
    const category = parseStr(body.category, 60);
    if (action === 'expenses-create' && !expenseDate) {
      sendJson(res, 400, { error: 'A valid expense date (YYYY-MM-DD) is required.' }); return;
    }

    const row: Record<string, unknown> = {};
    if (expenseDate) row.expense_date = expenseDate;
    if (category) {
      if (!EXPENSE_CATEGORIES.has(category)) { sendJson(res, 400, { error: 'Unknown expense category.' }); return; }
      row.category = category;
    }
    if (body.amount !== undefined) {
      const n = parseMoney(body.amount);
      if (n === null) { sendJson(res, 400, { error: `Amount must be a number between 0 and ${MAX_MONEY}.` }); return; }
      row.amount = n;
    }
    if (body.description !== undefined) row.description = parseStr(body.description, 500);
    if (body.payment_method !== undefined || body.paymentMethod !== undefined) row.payment_method = parseStr(body.payment_method ?? body.paymentMethod, 100);
    if (body.receipt_url !== undefined || body.receiptUrl !== undefined) row.receipt_url = parseStr(body.receipt_url ?? body.receiptUrl, 1000);
    if (body.notes !== undefined) row.notes = parseStr(body.notes, 2000);
    row.updated_at = new Date().toISOString();

    if (action === 'expenses-create') {
      if (row.amount === undefined || row.category === undefined) { sendJson(res, 400, { error: 'Category and amount are required.' }); return; }
      const ins = await rest('business_expenses', '', { method: 'POST', body: JSON.stringify(row), headers: { Prefer: 'return=representation' } });
      if (!ins.ok || !Array.isArray(ins.data) || ins.data.length === 0) { sendJson(res, ins.status, { error: 'Could not save the expense.' }); return; }
      const e = ins.data[0] as Record<string, unknown>;
      sendJson(res, 200, { expense: { id: String(e.id), expenseDate: String(e.expense_date), category: String(e.category), description: String(e.description || ''), amount: Number(e.amount || 0), paymentMethod: String(e.payment_method || ''), receiptUrl: String(e.receipt_url || ''), notes: String(e.notes || '') } });
      return;
    }

    const id = parseStr(body.id, 64);
    if (!id) { sendJson(res, 400, { error: 'id is required.' }); return; }
    const upd = await rest('business_expenses', `?id=eq.${encodeURIComponent(id)}&select=${EXPENSE_COLUMNS}`, { method: 'PATCH', body: JSON.stringify(row), headers: { Prefer: 'return=representation' } });
    if (!upd.ok || !Array.isArray(upd.data) || upd.data.length === 0) { sendJson(res, upd.ok ? 404 : upd.status, { error: 'Expense not found.' }); return; }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && action === 'expenses-delete') {
    let body: Record<string, unknown>;
    try { body = (await readJsonBody(req)) as Record<string, unknown>; }
    catch (e) { sendJson(res, 400, { error: (e as Error).message }); return; }
    const id = parseStr(body.id, 64);
    if (!id) { sendJson(res, 400, { error: 'id is required.' }); return; }
    // SOFT delete — the row is retained (deleted_at) so history never breaks.
    const upd = await rest('business_expenses', `?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    });
    if (!upd.ok) { sendJson(res, upd.status, { error: 'Could not delete the expense.' }); return; }
    sendJson(res, 200, { ok: true });
    return;
  }

  // -------------------------------------------------------------------------
  // Google Sheets — OPTIONAL by design. Supabase is the source of truth and
  // the core module works without this. The seam below is where a future
  // service-account integration plugs in (see docs: GOOGLE_SHEETS_SYNC).
  // -------------------------------------------------------------------------
  if (req.method === 'GET' && action === 'sheets-status') {
    const configured = Boolean((process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '').trim() && (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_SHEETS_TOKEN || '').trim());
    sendJson(res, 200, {
      configured,
      message: configured
        ? 'Google Sheets is connected. Sync pushes the current date range to the configured spreadsheet.'
        : 'Google Sheets is not connected. Use Export / CSV for now — the core Sales module never depends on Sheets.',
    });
    return;
  }

  if (req.method === 'POST' && action === 'sheets-sync') {
    const configured = Boolean((process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '').trim() && (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_SHEETS_TOKEN || '').trim());
    if (!configured) {
      sendJson(res, 501, { ok: false, message: 'Google Sheets is not configured on this deployment (needs GOOGLE_SHEETS_SPREADSHEET_ID + GOOGLE_SERVICE_ACCOUNT_KEY). CSV export works without it.' });
      return;
    }
    // Future: append rows via the Sheets API here (service account, server-side).
    sendJson(res, 501, { ok: false, message: 'Sheets sync is reserved for a future release — the connection is configured but the sync job is not enabled yet.' });
    return;
  }

  sendJson(res, 400, { error: 'Unknown action.' });
}
