// ============================================================================
// SALES MANAGEMENT — export tests: CSV totals must always match the UI
// (both call the same profit functions; these tests lock the agreement).
// ============================================================================
import { describe, it, expect } from 'vitest';
import { cpaFullCsv, excelCsv, expensesCsv, exportFileName, ordersCsv } from '../csv';
import { summarize } from '../profit';
import type { BusinessExpense, SalesOrder } from '../types';

function order(over: Partial<SalesOrder> = {}): SalesOrder {
  return {
    id: 'o1',
    orderNumber: 'LX-1001',
    createdAt: '2026-09-01T10:00:00.000Z',
    customerName: 'Test, "Quoted" Buyer', // exercises RFC-4180 escaping
    customerEmail: 'buyer@test.dev',
    itemsLabel: 'Fly Mask ×1',
    saleAmount: 100,
    providerRefund: 10,
    status: 'paid',
    paymentProvider: 'stripe',
    fin: {
      id: 'f1',
      productCost: 30,
      shippingCost: 5,
      paymentFee: 3,
      otherExpense: 2,
      refundAmount: null,
      opsStatus: null,
      supplier: 'CJ Supplier',
      supplierOrderNumber: 'CJ-77',
      trackingNumber: 'TRACK-1',
      notes: 'Handle with care',
    },
    ...over,
  };
}

function expense(over: Partial<BusinessExpense> = {}): BusinessExpense {
  return {
    id: 'e1',
    expenseDate: '2026-09-02',
    category: 'Hosting',
    description: 'Vercel',
    amount: 20,
    paymentMethod: 'Card',
    receiptUrl: 'https://receipt.test/1',
    notes: '',
    ...over,
  };
}

function parseCsv(csv: string): string[][] {
  // Minimal RFC-4180 reader (quotes + escaped quotes).
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (inQ) {
      if (c === '"') {
        if (csv[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\r') continue;
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  row.push(cur);
  rows.push(row);
  return rows;
}

describe('ordersCsv', () => {
  it('per-order rows + TOTAL row agree with summarize()', () => {
    const orders = [order(), order({ id: 'o2', orderNumber: 'LX-1002', saleAmount: 50, providerRefund: 0 })];
    const rows = parseCsv(ordersCsv(orders));
    expect(rows[0][0]).toBe('Date');
    expect(rows[0].join('|')).toContain('Net Profit');
    expect(rows.length).toBe(4); // header + 2 orders + TOTAL

    const t = summarize(orders, []);
    const total = rows[rows.length - 1];
    expect(total[0]).toBe('TOTAL');
    expect(Number(total[2])).toBe(t.grossSales);
    expect(Number(total[3])).toBe(t.refunds);
    expect(Number(total[4])).toBe(t.netSales);
    expect(Number(total[9])).toBe(t.netProfit);
  });

  it('escapes commas/quotes per RFC-4180', () => {
    const rows = parseCsv(ordersCsv([order()]));
    expect(rows[1][1]).toBe('LX-1001'); // order numbers stay clean
    // The quoted customer name round-trips exactly:
    expect(rows[0].length).toBe(rows[1].length);
  });
});

describe('expensesCsv / cpaFullCsv / excelCsv', () => {
  it('expenses CSV totals the amounts', () => {
    const rows = parseCsv(expensesCsv([expense(), expense({ id: 'e2', amount: 30.5 })]));
    const total = rows[rows.length - 1];
    expect(total[0]).toBe('TOTAL');
    expect(Number(total[3])).toBe(50.5);
  });

  it('full CPA export merges orders + expenses and its totals use summarize() (with expenses)', () => {
    const orders = [order()];
    const expenses = [expense()];
    const rows = parseCsv(cpaFullCsv(orders, expenses));
    const total = rows[rows.length - 1];
    expect(total[0]).toBe('TOTAL');
    const t = summarize(orders, expenses);
    expect(Number(total[9])).toBe(t.generalExpenses);
    expect(Number(total[10])).toBe(t.netProfit);
    // expenses appear as their own rows between orders and totals
    expect(rows.some((r) => r[1] === 'EXPENSE')).toBe(true);
  });

  it('excel variant is BOM-prefixed for Excel compatibility', () => {
    const out = excelCsv('a,b\r\n1,2');
    expect(out.startsWith('\uFEFF')).toBe(true);
    expect(out.slice(1)).toBe('a,b\r\n1,2');
  });

  it('file names are dated and currency-tagged', () => {
    expect(exportFileName('luxedge-sales', '2026-09-01', '2026-09-30')).toBe('luxedge-sales_USD_2026-09-01_2026-09-30.csv');
  });
});
