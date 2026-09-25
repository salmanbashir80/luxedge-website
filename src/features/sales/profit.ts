// ============================================================================
// SALES MANAGEMENT — profit math (pure, shared by UI / reports / exports)
//
// ONE implementation: the Orders table, Overview, Reports and every CSV
// export all call these functions, so totals can never disagree.
//
// Formula (transparent, no hidden logic):
//
//   Refund      = fin.refundAmount ?? order.providerRefund ?? 0
//                 (manual override wins; otherwise the payment provider's
//                  authoritative refunded amount)
//   Net Sales   = max(0, Sale Amount − Refund)
//   Net Profit  = Net Sales − Product Cost − Shipping Cost
//                          − Payment Fee − Other Order Expense
//   Margin      = Net Profit / Net Sales × 100   (null when Net Sales = 0)
//
// Zero/negative safety: Net Sales floors at 0 (a refund larger than the sale
// cannot create phantom negative revenue); margin is undefined (null) at zero
// net sales instead of Infinity/NaN. Cancelled orders compute normally in the
// per-order view but contribute 0 to every aggregate (counted=false).
// ============================================================================

import type { BusinessExpense, OrderProfit, SalesOrder, SalesReportRow, SalesSummary } from './types';
import { COUNTED_STATUSES } from './config';

/** Round to 2 dp — money never carries float artifacts past the cent. */
export function money(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Effective status shown in the module (ops override ?? payment status). */
export function effectiveStatus(o: SalesOrder): string {
  return o.fin.opsStatus || o.status || 'pending';
}

/** Effective refund: manual override wins; otherwise the provider amount. */
export function effectiveRefund(o: SalesOrder): number {
  return money(o.fin.refundAmount !== null ? o.fin.refundAmount : o.providerRefund || 0);
}

/** Per-order profit breakdown. See the formula above. */
export function computeOrderProfit(o: SalesOrder): OrderProfit {
  const refund = effectiveRefund(o);
  const netSales = money(Math.max(0, (o.saleAmount || 0) - refund));
  const fin = o.fin;
  const netProfit = money(
    netSales - fin.productCost - fin.shippingCost - fin.paymentFee - fin.otherExpense,
  );
  const margin = netSales > 0 ? money((netProfit / netSales) * 100) : null;
  const counted = COUNTED_STATUSES.has(effectiveStatus(o));
  return { refund, netSales, netProfit, margin, counted };
}

const EMPTY_SUMMARY: SalesSummary = {
  grossSales: 0,
  refunds: 0,
  netSales: 0,
  orders: 0,
  cancelledOrders: 0,
  cogs: 0,
  shipping: 0,
  paymentFees: 0,
  otherOrderExpenses: 0,
  generalExpenses: 0,
  netProfit: 0,
  margin: null,
  aov: 0,
};

/**
 * Aggregate orders (+ general expenses) into the business summary.
 * Cancelled orders are excluded from every money total and counted
 * separately; general expenses reduce net profit (never allocated
 * into per-order profit).
 */
export function summarize(orders: SalesOrder[], expenses: BusinessExpense[]): SalesSummary {
  const s: SalesSummary = { ...EMPTY_SUMMARY };
  for (const o of orders) {
    const p = computeOrderProfit(o);
    if (!p.counted) {
      if (effectiveStatus(o) === 'cancelled') s.cancelledOrders += 1;
      continue;
    }
    s.orders += 1;
    s.grossSales = money(s.grossSales + (o.saleAmount || 0));
    s.refunds = money(s.refunds + p.refund);
    s.netSales = money(s.netSales + p.netSales);
    s.cogs = money(s.cogs + o.fin.productCost);
    s.shipping = money(s.shipping + o.fin.shippingCost);
    s.paymentFees = money(s.paymentFees + o.fin.paymentFee);
    s.otherOrderExpenses = money(s.otherOrderExpenses + o.fin.otherExpense);
  }
  for (const e of expenses) {
    s.generalExpenses = money(s.generalExpenses + (e.amount || 0));
  }
  s.netProfit = money(
    s.netSales - s.cogs - s.shipping - s.paymentFees - s.otherOrderExpenses - s.generalExpenses,
  );
  s.margin = s.netSales > 0 ? money((s.netProfit / s.netSales) * 100) : null;
  s.aov = s.orders > 0 ? money(s.grossSales / s.orders) : 0;
  return s;
}

export type PeriodGrouping = 'day' | 'week' | 'month' | 'quarter' | 'year';

/** Start (inclusive, local) of the period containing `date`. */
export function periodStart(date: Date, grouping: PeriodGrouping): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (grouping === 'day') return d;
  if (grouping === 'week') {
    d.setDate(d.getDate() - d.getDay()); // week starts Sunday
    return d;
  }
  if (grouping === 'month') return new Date(date.getFullYear(), date.getMonth(), 1);
  if (grouping === 'quarter') return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
  return new Date(date.getFullYear(), 0, 1);
}

function periodLabel(start: Date, grouping: PeriodGrouping): string {
  if (grouping === 'day') return start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  if (grouping === 'week') return `Week of ${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  if (grouping === 'month') return start.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  if (grouping === 'quarter') return `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`;
  return String(start.getFullYear());
}

function isoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Break a range down into per-period summary rows (orders bucketed by their
 * creation date; general expenses bucketed by expense_date). Periods with no
 * activity are skipped — the report shows movement, not empty calendar rows.
 */
export function reportByPeriod(
  orders: SalesOrder[],
  expenses: BusinessExpense[],
  grouping: PeriodGrouping,
): SalesReportRow[] {
  const buckets = new Map<string, { orders: SalesOrder[]; expenses: BusinessExpense[] }>();
  const put = (key: Date, order?: SalesOrder, expense?: BusinessExpense) => {
    const start = periodStart(key, grouping);
    const k = isoDate(start);
    const b = buckets.get(k) || { orders: [], expenses: [] };
    if (order) b.orders.push(order);
    if (expense) b.expenses.push(expense);
    buckets.set(k, b);
  };
  for (const o of orders) {
    const t = new Date(o.createdAt);
    if (!Number.isNaN(t.getTime())) put(t, o);
  }
  for (const e of expenses) {
    const t = new Date(`${e.expenseDate}T00:00:00`);
    if (!Number.isNaN(t.getTime())) put(t, undefined, e);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([iso, b]) => {
      const start = new Date(`${iso}T00:00:00`);
      return { label: periodLabel(start, grouping), periodStart: iso, ...summarize(b.orders, b.expenses) };
    });
}
