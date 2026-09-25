// ============================================================================
// SALES MANAGEMENT — CSV / Excel-compatible export builders (pure)
//
// Uses the SAME profit functions as the UI/reports, so exported totals always
// match what the screen shows. No tax liability is ever computed — this is a
// management export for a CPA, not bookkeeping software.
// ============================================================================

import type { BusinessExpense, SalesOrder } from './types';
import { computeOrderProfit, money, summarize } from './profit';
import { SALES_CURRENCY } from './config';

/** RFC-4180 cell: quote when needed, escape quotes, strip control chars. */
function cell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v).replace(/[\r\n]+/g, ' ').trim();
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowsToCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  return [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n');
}

/**
 * CPA-friendly orders export. One row per order (+ a TOTAL row), fields per
 * the agreed layout: Date, Order #, Revenue, Refund, Net Sales, COGS,
 * Shipping, Payment Fees, Other Order Expenses, Net Profit, Supplier,
 * Tracking / Reference, Notes.
 */
export function ordersCsv(orders: SalesOrder[]): string {
  const headers = [
    'Date',
    'Order #',
    'Revenue',
    'Refund',
    'Net Sales',
    'COGS',
    'Shipping',
    'Payment Fees',
    'Other Order Expenses',
    'Net Profit',
    'Supplier',
    'Tracking / Reference',
    'Notes',
  ];
  const rows = orders.map((o) => {
    const p = computeOrderProfit(o);
    const ref = [o.fin.trackingNumber, o.fin.supplierOrderNumber].filter(Boolean).join(' / ');
    return [
      o.createdAt.slice(0, 10),
      o.orderNumber,
      money(o.saleAmount),
      p.refund,
      p.netSales,
      o.fin.productCost,
      o.fin.shippingCost,
      o.fin.paymentFee,
      o.fin.otherExpense,
      p.netProfit,
      o.fin.supplier,
      ref,
      o.fin.notes,
    ];
  });
  // TOTAL row = summarize() over the SAME rows (guaranteed agreement).
  const t = summarize(orders, []);
  rows.push([
    'TOTAL',
    `${t.orders} order(s)`,
    t.grossSales,
    t.refunds,
    t.netSales,
    t.cogs,
    t.shipping,
    t.paymentFees,
    t.otherOrderExpenses,
    t.netProfit,
    '',
    '',
    '',
  ]);
  return rowsToCsv(headers, rows);
}

/** General expenses export (CSV). */
export function expensesCsv(expenses: BusinessExpense[]): string {
  const headers = ['Date', 'Category', 'Description', 'Amount', 'Payment Method', 'Reference / Receipt URL', 'Notes'];
  const rows = expenses.map((e) => [e.expenseDate, e.category, e.description, money(e.amount), e.paymentMethod, e.receiptUrl, e.notes]);
  rows.push(['TOTAL', `${expenses.length} expense(s)`, '', money(expenses.reduce((s, e) => s + (e.amount || 0), 0)), '', '', '']);
  return rowsToCsv(headers, rows);
}

/**
 * Full bookkeeping hand-off export: orders + an allocation column for general
 * expenses + a closing summary. Still no tax math — the CPA decides.
 */
export function cpaFullCsv(orders: SalesOrder[], expenses: BusinessExpense[]): string {
  const head = rowsToCsv(
    [
      'Date',
      'Order #',
      'Revenue',
      'Refund',
      'Net Sales',
      'COGS',
      'Shipping',
      'Payment Fees',
      'Other Order Expenses',
      'General Expenses',
      'Net Profit',
      'Supplier',
      'Tracking / Reference',
      'Notes',
    ],
    orders.map((o) => {
      const p = computeOrderProfit(o);
      return [
        o.createdAt.slice(0, 10),
        o.orderNumber,
        money(o.saleAmount),
        p.refund,
        p.netSales,
        o.fin.productCost,
        o.fin.shippingCost,
        o.fin.paymentFee,
        o.fin.otherExpense,
        '',
        p.netProfit,
        o.fin.supplier,
        [o.fin.trackingNumber, o.fin.supplierOrderNumber].filter(Boolean).join(' / '),
        o.fin.notes,
      ];
    }),
  );
  const exp = rowsToCsv(
    ['', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    expenses.map((e) => [e.expenseDate, 'EXPENSE', e.description, '', '', '', '', '', '', money(e.amount), -money(e.amount), e.category, e.receiptUrl, e.notes]),
  ).split('\r\n').slice(1);
  const t = summarize(orders, expenses);
  const total = rowsToCsv(
    ['', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    [[
      'TOTAL',
      `${t.orders} order(s)`,
      t.grossSales,
      t.refunds,
      t.netSales,
      t.cogs,
      t.shipping,
      t.paymentFees,
      t.otherOrderExpenses,
      t.generalExpenses,
      t.netProfit,
      '',
      '',
      t.margin === null ? '' : `Margin ${t.margin}%`,
    ]],
  ).split('\r\n').slice(1);
  return [head, ...exp, ...total].join('\r\n');
}

/**
 * Excel-compatible variant: same CSV with a UTF-8 BOM so Excel opens it
 * cleanly (accented names etc.) and treats it as a spreadsheet.
 */
export function excelCsv(csv: string): string {
  return `\uFEFF${csv}`;
}

/** Trigger a client-side download of text content. */
export function downloadText(fileName: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Standard dated file name for exports. */
export function exportFileName(kind: string, from: string, to: string): string {
  return `${kind}_${SALES_CURRENCY}_${from}_${to}.csv`;
}
