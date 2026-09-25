// ============================================================================
// SALES MANAGEMENT — profit math unit tests (the ONE formula implementation).
// The UI, Reports and every export call these functions; these tests pin the
// formula so a refactor can never silently change the numbers.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { computeOrderProfit, effectiveRefund, effectiveStatus, money, reportByPeriod, summarize } from '../profit';
import type { BusinessExpense, SalesOrder } from '../types';

function order(over: Partial<SalesOrder> = {}): SalesOrder {
  return {
    id: 'o1',
    orderNumber: 'LX-1001',
    createdAt: '2026-09-01T10:00:00.000Z',
    customerName: 'Test Buyer',
    customerEmail: 'buyer@test.dev',
    itemsLabel: 'Fly Mask ×1',
    saleAmount: 100,
    providerRefund: 0,
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
      supplier: 'CJ',
      supplierOrderNumber: '',
      trackingNumber: '',
      notes: '',
    },
    ...over,
  };
}

function expense(over: Partial<BusinessExpense> = {}): BusinessExpense {
  return {
    id: 'e1',
    expenseDate: '2026-09-02',
    category: 'Advertising',
    description: 'Meta ads',
    amount: 25,
    paymentMethod: 'Card',
    receiptUrl: '',
    notes: '',
    ...over,
  };
}

describe('money', () => {
  it('rounds to 2 dp without float artifacts', () => {
    expect(money(0.1 + 0.2)).toBe(0.3);
    expect(money(10.005)).toBe(10.01);
    expect(money(Number.NaN)).toBe(0);
  });
});

describe('computeOrderProfit — the documented formula', () => {
  it('Net Profit = (Sale − Refund) − COGS − Shipping − Payment Fee − Other', () => {
    const p = computeOrderProfit(order());
    // 100 − 0 = 100 net sales; 100 − 30 − 5 − 3 − 2 = 60
    expect(p.netSales).toBe(100);
    expect(p.netProfit).toBe(60);
    expect(p.margin).toBe(60);
  });

  it('refund comes from the provider when no manual override exists', () => {
    const o = order({ providerRefund: 20 });
    expect(effectiveRefund(o)).toBe(20);
    const p = computeOrderProfit(o);
    expect(p.refund).toBe(20);
    expect(p.netSales).toBe(80);
    // 80 − 40 = 40 → margin 50%
    expect(p.netProfit).toBe(40);
    expect(p.margin).toBe(50);
  });

  it('manual refund override wins over the provider amount', () => {
    const o = order({ providerRefund: 20, fin: { ...order().fin, refundAmount: 10 } });
    expect(effectiveRefund(o)).toBe(10);
    expect(computeOrderProfit(o).refund).toBe(10);
  });

  it('floors net sales at 0 when the refund exceeds the sale (no phantom negative revenue)', () => {
    const p = computeOrderProfit(order({ saleAmount: 50, providerRefund: 80 }));
    expect(p.netSales).toBe(0);
    expect(p.netProfit).toBe(-40); // costs still visible — a real loss, not hidden
    expect(p.margin).toBeNull(); // undefined at zero net sales — never Infinity/NaN
  });

  it('zero net sales never yields NaN/Infinity margin', () => {
    const p = computeOrderProfit(order({ saleAmount: 0 }));
    expect(p.margin).toBeNull();
  });

  it('cancelled orders are computed for the row but excluded from aggregates; refunded orders remain reportable', () => {
    expect(computeOrderProfit(order({ status: 'cancelled' })).counted).toBe(false);
    expect(computeOrderProfit(order({ status: 'paid' })).counted).toBe(true);
    const refunded = order({
      id: 'refunded', orderNumber: 'LX-REFUNDED', status: 'refunded',
      providerRefund: 100,
      fin: { ...order().fin, productCost: 30, shippingCost: 5, paymentFee: 3, otherExpense: 2 },
    });
    expect(computeOrderProfit(refunded).counted).toBe(true);
    expect(computeOrderProfit(refunded).netSales).toBe(0);
    expect(computeOrderProfit(refunded).netProfit).toBe(-40);
    // ops override can move an order out of the counted set too
    const o = order({ status: 'paid', fin: { ...order().fin, opsStatus: 'cancelled' } });
    expect(effectiveStatus(o)).toBe('cancelled');
    expect(computeOrderProfit(o).counted).toBe(false);
  });
});

describe('summarize — range aggregates', () => {
  it('matches the per-order sums and subtracts general expenses from net profit', () => {
    const orders = [
      order({ id: 'a', orderNumber: 'LX-1' }),
      order({ id: 'b', orderNumber: 'LX-2', providerRefund: 100, fin: { ...order().fin, productCost: 0, shippingCost: 0, paymentFee: 0, otherExpense: 0 } }),
      order({ id: 'c', orderNumber: 'LX-3', status: 'cancelled' }),
    ];
    const s = summarize(orders, [expense({ amount: 25 })]);
    expect(s.orders).toBe(2); // cancelled not counted
    expect(s.cancelledOrders).toBe(1);
    expect(s.grossSales).toBe(200);
    expect(s.refunds).toBe(100);
    expect(s.netSales).toBe(100); // 100 + max(0, 100−100)
    expect(s.cogs).toBe(30);
    expect(s.shipping).toBe(5);
    expect(s.paymentFees).toBe(3);
    expect(s.otherOrderExpenses).toBe(2);
    expect(s.generalExpenses).toBe(25);
    // 100 − 30 − 5 − 3 − 2 − 25 = 35
    expect(s.netProfit).toBe(35);
    expect(s.margin).toBe(35);
    expect(s.aov).toBe(100); // 200 gross / 2 orders
  });

  it('keeps fully refunded orders in period totals with gross sales and refunds reconciling to zero net sales', () => {
    const refunded = order({ id: 'r', status: 'refunded', providerRefund: 100 });
    const s = summarize([refunded], []);
    expect(s.orders).toBe(1);
    expect(s.cancelledOrders).toBe(0);
    expect(s.grossSales).toBe(100);
    expect(s.refunds).toBe(100);
    expect(s.netSales).toBe(0);
    expect(s.netProfit).toBe(-40);
    expect(s.margin).toBeNull();
    const monthly = reportByPeriod([refunded], [], 'month');
    expect(monthly).toHaveLength(1);
    expect(monthly[0].orders).toBe(1);
    expect(monthly[0].refunds).toBe(100);
  });

  it('does not mislabel failed or awaiting-payment orders as cancelled', () => {
    const rows = [
      order({ id: 'cancelled', status: 'cancelled' }),
      order({ id: 'failed', status: 'failed' }),
      order({ id: 'awaiting', status: 'awaiting_payment' }),
    ];
    const s = summarize(rows, []);
    expect(s.orders).toBe(0);
    expect(s.cancelledOrders).toBe(1);
    expect(s.grossSales).toBe(0);
  });

  it('handles empty input safely', () => {
    const s = summarize([], []);
    expect(s.netProfit).toBe(0);
    expect(s.margin).toBeNull();
    expect(s.aov).toBe(0);
  });
});

describe('reportByPeriod — weekly/monthly/quarterly/yearly breakdowns', () => {
  const orders = [
    order({ id: 'a', orderNumber: 'LX-1', createdAt: '2026-01-10T10:00:00.000Z' }),
    order({ id: 'b', orderNumber: 'LX-2', createdAt: '2026-01-20T10:00:00.000Z' }),
    order({ id: 'c', orderNumber: 'LX-3', createdAt: '2026-04-05T10:00:00.000Z' }),
  ];
  const expenses = [expense({ expenseDate: '2026-01-15', amount: 40 })];

  it('buckets orders and expenses by month', () => {
    const rows = reportByPeriod(orders, expenses, 'month');
    expect(rows.length).toBe(2); // Jan + Apr only — empty months are skipped
    expect(rows[0].label).toContain('Jan');
    expect(rows[0].orders).toBe(2);
    expect(rows[0].generalExpenses).toBe(40);
    expect(rows[1].label).toContain('Apr');
    expect(rows[1].orders).toBe(1);
  });

  it('quarters and years group correctly and totals agree with summarize', () => {
    const q = reportByPeriod(orders, expenses, 'quarter');
    expect(q.map((r) => r.label)).toEqual(['Q1 2026', 'Q2 2026']);
    const y = reportByPeriod(orders, expenses, 'year');
    expect(y.length).toBe(1);
    const flat = summarize(orders, expenses);
    expect(y[0].netProfit).toBe(flat.netProfit);
    expect(y[0].grossSales).toBe(flat.grossSales);
  });
});
