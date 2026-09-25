// ============================================================================
// SALES MANAGEMENT — admin API client (browser side)
//
// Thin typed wrapper over /api/admin/sales (admin JWT, sent as Bearer).
// All money validation happens server-side too — this layer only types it.
// ============================================================================

import { getAccessToken } from '../../services/supabase';
import type { BusinessExpense, SalesOrder } from './types';

async function call<T>(params: Record<string, string>, body?: unknown, method = 'GET'): Promise<T> {
  const token = getAccessToken();
  if (!token) throw new Error('Not signed in.');
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/admin/sales?${qs}`, {
    method: body === undefined ? method : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !data) throw new Error(data?.error || `Request failed (HTTP ${res.status}).`);
  return data;
}

export interface OrdersQuery {
  from?: string;
  to?: string;
  status?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

/**
 * Wire format for the manual sidecar fields (snake_case — matches
 * order_financials columns and the server's validated body parser).
 */
export interface OrderFinancialsPatch {
  product_cost?: number;
  shipping_cost?: number;
  payment_fee?: number;
  other_expense?: number;
  /** Explicit manual override; the server also accepts null to revert to auto. */
  refund_amount?: number | null;
  ops_status?: string | null;
  supplier?: string;
  supplier_order_number?: string;
  tracking_number?: string;
  notes?: string;
}

export interface OrdersPage {
  orders: SalesOrder[];
  total: number;
}

/** Paged order list (joined with the manual financial sidecar). */
export function fetchSalesOrders(query: OrdersQuery): Promise<OrdersPage> {
  const params: Record<string, string> = { action: 'orders' };
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') params[k] = String(v);
  }
  return call<OrdersPage>(params);
}

/** All orders in a date range (compact) — for Overview/Reports/Export. */
export function fetchAllSalesOrders(from: string, to: string): Promise<OrdersPage> {
  return call<OrdersPage>({ action: 'orders', from, to, limit: '5000' });
}

/** Upsert the manual financial fields of one order (inline cell save). */
export function saveOrderFinancials(orderId: string, patch: OrderFinancialsPatch): Promise<{ ok: true }> {
  return call<{ ok: true }>({ action: 'order-financials' }, { order_id: orderId, ...patch });
}

export interface ExpensesQuery {
  from?: string;
  to?: string;
}

export function fetchExpenses(query: ExpensesQuery = {}): Promise<{ expenses: BusinessExpense[] }> {
  const params: Record<string, string> = { action: 'expenses' };
  for (const [k, v] of Object.entries(query)) if (v) params[k] = v;
  return call<{ expenses: BusinessExpense[] }>(params);
}

export function createExpense(expense: Omit<BusinessExpense, 'id'>): Promise<{ expense: BusinessExpense }> {
  return call<{ expense: BusinessExpense }>({ action: 'expenses-create' }, expense);
}

export function updateExpense(id: string, patch: Partial<Omit<BusinessExpense, 'id'>>): Promise<{ ok: true }> {
  return call<{ ok: true }>({ action: 'expenses-update' }, { id, ...patch });
}

/** Soft delete (deleted_at) — history is never destroyed. */
export function deleteExpense(id: string): Promise<{ ok: true }> {
  return call<{ ok: true }>({ action: 'expenses-delete' }, { id });
}

export interface SheetsStatus {
  configured: boolean;
  message: string;
}

export function fetchSheetsStatus(): Promise<SheetsStatus> {
  return call<SheetsStatus>({ action: 'sheets-status' });
}

export function syncToSheets(): Promise<{ ok: boolean; message: string }> {
  return call<{ ok: boolean; message: string }>({ action: 'sheets-sync' }, {});
}
