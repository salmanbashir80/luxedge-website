// ============================================================================
// LUXEDGE SALES — Sales & Profit Management module (/admin/sales)
//
// ONE admin module: Overview · Orders · Expenses · Reports · Export / Sheets.
// Spreadsheet-first UX (Google-Sheets-simple): click a cell, type, blur/Enter
// to save. All profit math is the SHARED implementation in
// src/features/sales/profit.ts (UI = reports = exports can never disagree).
//
// Brand/currency/categories come from src/features/sales/config.ts — this
// module is reusable on other Embani sites (Himalayan Koh, …) by changing
// that one file plus the sidebar label.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CurrencyDollar, Download, Eye, FileText, MagnifyingGlass, Plus, Receipt,
  Table, TrendUp, Trash, X, CloudArrowUp,
} from '@phosphor-icons/react';
import { useApp } from '../App';
import {
  EXPENSE_CATEGORIES, ORDER_STATUSES, SALES_CURRENCY_SYMBOL, SALES_MODULE_LABEL, STATUS_LABELS,
} from '../features/sales/config';
import {
  computeOrderProfit, effectiveStatus, money, reportByPeriod, summarize,
  type PeriodGrouping,
} from '../features/sales/profit';
import {
  cpaFullCsv, excelCsv, expensesCsv, downloadText, exportFileName, ordersCsv,
} from '../features/sales/csv';
import {
  createExpense, deleteExpense, fetchAllSalesOrders, fetchExpenses, fetchSalesOrders,
  fetchSheetsStatus, saveOrderFinancials, syncToSheets, updateExpense,
  type OrderFinancialsPatch,
} from '../features/sales/api';
import type { BusinessExpense, OrderFinancials, SalesOrder, SalesReportRow } from '../features/sales/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const fmt = (n: number, sign = false): string => {
  const v = money(n);
  const s = `${SALES_CURRENCY_SYMBOL}${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return v < 0 ? `−${s}` : sign && v > 0 ? `+${s}` : s;
};
const pct = (n: number | null): string => (n === null ? '—' : `${n.toFixed(1)}%`);
const iso = (d: Date): string => {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

type RangePreset = 'today' | 'week' | 'month' | 'last_month' | 'custom';

function presetRange(p: RangePreset): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (p === 'today') return { from: iso(today), to: iso(today) };
  if (p === 'week') {
    const start = new Date(today); start.setDate(start.getDate() - 6);
    return { from: iso(start), to: iso(today) };
  }
  if (p === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(today) };
  if (p === 'last_month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: iso(start), to: iso(end) };
  }
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(today) };
}

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'custom', label: 'Custom' },
];

/** Compact date-range filter shared by Overview / Reports / Export. */
function RangeFilter({ preset, from, to, onPreset, onFrom, onTo }: {
  preset: RangePreset; from: string; to: string;
  onPreset: (p: RangePreset) => void; onFrom: (v: string) => void; onTo: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <div className="flex items-center gap-0.5 rounded-lg border border-gray-200 p-0.5 bg-white">
        {PRESETS.map((p) => (
          <button key={p.key} onClick={() => onPreset(p.key)}
            className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-colors ${preset === p.key ? 'bg-[#1b1f27] text-white' : 'text-gray-500 hover:text-gray-800'}`}>
            {p.label}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
          <input type="date" value={from} onChange={(e) => onFrom(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1 text-[11px] bg-white" />
          <span>→</span>
          <input type="date" value={to} onChange={(e) => onTo(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1 text-[11px] bg-white" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spreadsheet cell — click to edit, Enter/blur saves, Esc cancels.
// ---------------------------------------------------------------------------
function EditableCell({ value, onSave, type = 'money', placeholder, align = 'right', mono }: {
  value: string | number;
  onSave: (v: string) => Promise<void> | void;
  type?: 'money' | 'text';
  placeholder?: string;
  align?: 'left' | 'right';
  mono?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ''));
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) ref.current?.select(); }, [editing]);

  const commit = async () => {
    setEditing(false);
    const next = draft.trim();
    if (next === String(value ?? '').trim()) return;
    if (type === 'money') {
      const n = Number(next === '' ? 0 : next);
      if (!Number.isFinite(n) || n < 0) { await onSave(String(value ?? '')); return; }
    }
    setBusy(true);
    try { await onSave(next); } finally { setBusy(false); }
  };

  if (!editing) {
    const shown = value === '' || value === null || value === undefined ? '—' : type === 'money' ? fmt(Number(value)) : String(value);
    return (
      <button
        onClick={() => { setDraft(type === 'money' && Number(value) === 0 ? '' : String(value ?? '')); setEditing(true); }}
        className={`w-full min-h-[24px] px-1.5 py-0.5 rounded text-[11px] text-${align} hover:bg-amber-50 hover:ring-1 hover:ring-amber-200 transition-colors ${busy ? 'opacity-50' : ''} ${mono ? 'font-mono' : ''} ${value === '' || value === null || value === undefined ? 'text-gray-300' : 'text-gray-800'}`}
        title="Click to edit">
        {shown}
      </button>
    );
  }
  return (
    <input
      ref={ref}
      value={draft}
      type={type === 'money' ? 'number' : 'text'}
      min={type === 'money' ? 0 : undefined}
      step={type === 'money' ? 0.01 : undefined}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); void commit(); }
        if (e.key === 'Escape') setEditing(false);
      }}
      className={`w-full px-1.5 py-0.5 rounded text-[11px] border border-amber-300 bg-amber-50 outline-none focus:ring-1 focus:ring-amber-400 text-${align} ${mono ? 'font-mono' : ''}`}
    />
  );
}

// ---------------------------------------------------------------------------
// Load all range data once (Overview / Reports / Export share one fetch).
// ---------------------------------------------------------------------------
function useRangeData(from: string, to: string) {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [expenses, setExpenses] = useState<BusinessExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([fetchAllSalesOrders(from, to), fetchExpenses({ from, to })])
      .then(([o, e]) => { setOrders(o.orders); setExpenses(e.expenses); })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [from, to]);
  useEffect(() => { reload(); }, [reload]);
  return { orders, expenses, loading, error, reload };
}

// ---------------------------------------------------------------------------
// OVERVIEW
// ---------------------------------------------------------------------------
function StatTile({ label, value, sub, danger }: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3">
      <p className="text-[10px] font-medium text-gray-500">{label}</p>
      <p className={`text-base font-bold leading-none mt-1.5 ${danger ? 'text-rose-600' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-[9px] text-gray-400 mt-1 truncate">{sub}</p>}
    </div>
  );
}

function OverviewTab() {
  const [preset, setPreset] = useState<RangePreset>('month');
  const initial = presetRange('month');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const pick = (p: RangePreset) => {
    setPreset(p);
    if (p !== 'custom') { const r = presetRange(p); setFrom(r.from); setTo(r.to); }
  };
  const { orders, expenses, loading, error } = useRangeData(from, to);
  const s = useMemo(() => summarize(orders, expenses), [orders, expenses]);
  const trend = useMemo(() => reportByPeriod(orders, expenses, 'day'), [orders, expenses]);
  const maxProfit = Math.max(1, ...trend.map((t) => Math.abs(t.netProfit)));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <RangeFilter preset={preset} from={from} to={to} onPreset={pick} onFrom={setFrom} onTo={setTo} />
        <span className="text-[10px] text-gray-400">{from} → {to}{loading ? ' · loading…' : ` · ${s.orders} order(s)`}</span>
      </div>
      {error && <p className="text-[11px] text-rose-600">{error}</p>}

      {/* Business numbers — the whole point of this screen */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
        <StatTile label="Total Sales" value={fmt(s.grossSales)} sub="before refunds" />
        <StatTile label="Total Orders" value={String(s.orders)} sub={s.cancelledOrders ? `${s.cancelledOrders} cancelled (excluded)` : 'counted in totals'} />
        <StatTile label="Refunds" value={fmt(s.refunds)} danger={s.refunds > 0} />
        <StatTile label="Net Sales" value={fmt(s.netSales)} sub="sales − refunds" />
        <StatTile label="Product Cost / COGS" value={fmt(s.cogs)} />
        <StatTile label="Shipping Cost" value={fmt(s.shipping)} />
        <StatTile label="Payment Fees" value={fmt(s.paymentFees)} />
        <StatTile label="Other Order Expenses" value={fmt(s.otherOrderExpenses)} />
        <StatTile label="General Business Expenses" value={fmt(s.generalExpenses)} sub="not tied to one order" />
        <StatTile label="Net Profit" value={fmt(s.netProfit)} danger={s.netProfit < 0}
          sub="net sales − all costs" />
        <StatTile label="Profit Margin" value={pct(s.margin)} sub="net profit ÷ net sales" />
        <StatTile label="Average Order Value" value={fmt(s.aov)} sub="gross sales ÷ orders" />
      </div>

      {/* One small trend — sales & profit per day in range (no chart clutter) */}
      <div className="bg-white rounded-xl border border-gray-100 p-3">
        <h3 className="text-[11px] font-bold text-gray-800 mb-2 flex items-center gap-1.5"><TrendUp size={12} className="text-[#9a6f16]" /> Sales &amp; Profit Trend (daily)</h3>
        {trend.length === 0 ? (
          <p className="text-[11px] text-gray-400 py-3 text-center">No activity in this range.</p>
        ) : (
          <div className="flex items-end gap-[3px] h-20 overflow-x-auto">
            {trend.map((t, i) => (
              <div key={i} className="flex-1 min-w-[8px] flex flex-col items-center justify-end gap-0.5 h-full"
                title={`${t.label}: net sales ${fmt(t.netSales)}, net profit ${fmt(t.netProfit)}`}>
                <div className="w-full rounded-t bg-[#c9a44c]/60" style={{ height: `${Math.max((Math.abs(t.netSales) / maxProfit) * 34, t.netSales > 0 ? 3 : 1)}px` }} />
                <div className={`w-full rounded-b ${t.netProfit < 0 ? 'bg-rose-300' : 'bg-emerald-400'}`} style={{ height: `${Math.max((Math.abs(t.netProfit) / maxProfit) * 34, t.netProfit !== 0 ? 3 : 1)}px` }} />
              </div>
            ))}
          </div>
        )}
        <p className="text-[9px] text-gray-400 mt-1.5">Gold = net sales · Green = net profit · Red = loss</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ORDERS — the main working screen (spreadsheet)
// ---------------------------------------------------------------------------
const PAGE_SIZE = 50;

function OrderDetail({ order, onClose }: { order: SalesOrder; onClose: () => void }) {
  const p = computeOrderProfit(order);
  const f = order.fin;
  const Row = ({ l, v, bold, danger }: { l: string; v: string; bold?: boolean; danger?: boolean }) => (
    <div className={`flex items-center justify-between gap-4 py-1 ${bold ? 'font-bold border-t border-gray-100 mt-1 pt-1.5' : ''}`}>
      <span className="text-[11px] text-gray-500">{l}</span>
      <span className={`text-[11px] ${danger ? 'text-rose-600' : 'text-gray-900'} ${bold ? 'font-bold' : 'font-medium'}`}>{v}</span>
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] overflow-y-auto p-4 shadow-2xl">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-mono text-sm font-bold text-gray-900">{order.orderNumber}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={15} /></button>
        </div>
        <p className="text-[11px] text-gray-500 mb-3">{new Date(order.createdAt).toLocaleString()} · {STATUS_LABELS[effectiveStatus(order)] || effectiveStatus(order)}</p>

        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mt-2">Customer</p>
        <p className="text-[11px] text-gray-800">{order.customerName || '—'}</p>
        <p className="text-[11px] text-gray-500">{order.customerEmail || '—'}</p>

        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mt-3">Products</p>
        <p className="text-[11px] text-gray-800">{order.itemsLabel || '—'}</p>

        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mt-3">Financials</p>
        <Row l="Sale Amount" v={fmt(order.saleAmount)} />
        <Row l="Refund" v={fmt(p.refund)} danger={p.refund > 0} />
        <Row l="Net Sales" v={fmt(p.netSales)} />
        <Row l="Product Cost" v={fmt(f.productCost)} />
        <Row l="Shipping" v={fmt(f.shippingCost)} />
        <Row l="Processor Fee" v={fmt(f.paymentFee)} />
        <Row l="Other Expense" v={fmt(f.otherExpense)} />
        <Row l="Net Profit" v={fmt(p.netProfit)} bold danger={p.netProfit < 0} />
        <Row l="Margin" v={pct(p.margin)} bold />

        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mt-3">Operational</p>
        <Row l="Supplier" v={f.supplier || '—'} />
        <Row l="Supplier Order #" v={f.supplierOrderNumber || '—'} />
        <Row l="Tracking #" v={f.trackingNumber || '—'} />
        <Row l="Order Status" v={STATUS_LABELS[effectiveStatus(order)] || effectiveStatus(order)} />
        <p className="text-[11px] text-gray-600 mt-2 whitespace-pre-wrap">{f.notes || 'No notes.'}</p>
      </div>
    </div>
  );
}

function OrdersTab() {
  const { notify } = useApp();
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [qInput, setQInput] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detail, setDetail] = useState<SalesOrder | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchSalesOrders({ from, to, status, q, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then((d) => { setOrders(d.orders); setTotal(d.total); })
      .catch((err: Error) => notify(err.message, 'error'))
      .finally(() => setLoading(false));
  }, [from, to, status, q, page, notify]);
  useEffect(() => { load(); }, [load]);

  // snake_case wire key → camelCase fin field (for the optimistic update).
  const WIRE_TO_FIN: Record<keyof OrderFinancialsPatch, keyof OrderFinancials> = {
    product_cost: 'productCost', shipping_cost: 'shippingCost', payment_fee: 'paymentFee',
    other_expense: 'otherExpense', refund_amount: 'refundAmount', ops_status: 'opsStatus',
    supplier: 'supplier', supplier_order_number: 'supplierOrderNumber',
    tracking_number: 'trackingNumber', notes: 'notes',
  };

  // Optimistic inline save of one manual field.
  const saveField = async (order: SalesOrder, field: keyof OrderFinancials, raw: string) => {
    const finId = order.fin.id;
    let patch: OrderFinancialsPatch;
    if (field === 'productCost' || field === 'shippingCost' || field === 'paymentFee' || field === 'otherExpense' || field === 'refundAmount') {
      const n = Number(raw === '' ? 0 : raw);
      if (!Number.isFinite(n) || n < 0) { notify('Enter a number of 0 or more.', 'error'); return; }
      patch = {
        [field === 'productCost' ? 'product_cost' : field === 'shippingCost' ? 'shipping_cost'
          : field === 'paymentFee' ? 'payment_fee' : field === 'otherExpense' ? 'other_expense' : 'refund_amount']: money(n),
      } as OrderFinancialsPatch;
    } else if (field === 'opsStatus') {
      patch = { ops_status: raw === '' ? null : raw };
    } else {
      const col = { supplier: 'supplier', supplierOrderNumber: 'supplier_order_number', trackingNumber: 'tracking_number', notes: 'notes' }[field as string];
      if (!col) return;
      patch = { [col]: raw } as OrderFinancialsPatch;
    }
    // Optimistic local update — the cell feels instant; the save follows.
    setOrders((prev) => prev.map((o) => {
      if (o.id !== order.id) return o;
      const fin = { ...o.fin } as OrderFinancials;
      const rec = fin as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) {
        rec[WIRE_TO_FIN[k as keyof OrderFinancialsPatch] || k] = v;
      }
      return { ...o, fin };
    }));
    try {
      await saveOrderFinancials(order.id, patch);
      if (!finId) load(); // first sidecar row — refresh to pick up its id
    } catch (err) {
      notify((err as Error).message, 'error');
      load();
    }
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const th = 'px-2 py-2 text-[9px] font-bold uppercase tracking-wider text-gray-400 whitespace-nowrap';
  const td = 'px-1 py-0.5 border-b border-gray-50 align-middle';

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 flex-wrap bg-white rounded-xl border border-gray-100 p-2">
        <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1">
          <MagnifyingGlass size={12} className="text-gray-400" />
          <input value={qInput} onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setQ(qInput.trim()); setPage(0); } }}
            placeholder="Order #, customer, supplier, tracking…" className="bg-transparent text-[11px] outline-none w-48" />
        </div>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}
          className="border border-gray-200 rounded-lg px-2 py-1 text-[11px] bg-white">
          <option value="">All statuses</option>
          {[...new Set([...ORDER_STATUSES, 'awaiting_payment', 'failed'])].map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>
          ))}
        </select>
        <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }}
          className="border border-gray-200 rounded-lg px-2 py-1 text-[11px] bg-white" title="From date" />
        <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }}
          className="border border-gray-200 rounded-lg px-2 py-1 text-[11px] bg-white" title="To date" />
        <span className="ml-auto text-[10px] text-gray-400">{total} order{total !== 1 ? 's' : ''}</span>
      </div>

      {/* Formula note — transparent math, no hidden logic */}
      <p className="text-[9px] text-gray-400 px-1">
        Net Sales = Sale − Refund · Net Profit = Net Sales − Product Cost − Shipping − Payment Fee − Other · Margin = Net Profit ÷ Net Sales.
        Click any gold-highlightable cell to edit. Refund shows the payment-provider amount until you override it.
      </p>

      {/* Spreadsheet */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        <table className="w-full text-[11px] min-w-[1500px]">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-left">
              <th className={th}>Date</th>
              <th className={th}>Order #</th>
              <th className={th}>Customer</th>
              <th className={th}>Product / Items</th>
              <th className={`${th} text-right`}>Sale Amount</th>
              <th className={`${th} text-right`}>Product Cost</th>
              <th className={`${th} text-right`}>Shipping Cost</th>
              <th className={`${th} text-right`}>Payment Fee</th>
              <th className={`${th} text-right`}>Other Expense</th>
              <th className={`${th} text-right`}>Refund</th>
              <th className={`${th} text-right`}>Net Profit</th>
              <th className={`${th} text-right`}>Margin</th>
              <th className={th}>Order Status</th>
              <th className={th}>Supplier</th>
              <th className={th}>Supplier Order #</th>
              <th className={th}>Tracking #</th>
              <th className={th}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {loading && orders.length === 0 && (
              <tr><td colSpan={17} className="px-4 py-8 text-center text-gray-400">Loading orders…</td></tr>
            )}
            {!loading && orders.length === 0 && (
              <tr><td colSpan={17} className="px-4 py-8 text-center text-gray-400">No orders in this view — website orders appear here automatically.</td></tr>
            )}
            {orders.map((o) => {
              const p = computeOrderProfit(o);
              return (
                <tr key={o.id} className="hover:bg-gray-50/70">
                  <td className={`${td} text-gray-500 whitespace-nowrap`}>{new Date(o.createdAt).toLocaleDateString()}</td>
                  <td className={td}>
                    <button onClick={() => setDetail(o)} className="font-mono font-semibold text-gray-900 hover:text-[#9a6f16] flex items-center gap-1" title="Open order detail">
                      <Eye size={11} />{o.orderNumber}
                    </button>
                  </td>
                  <td className={`${td} text-gray-700 max-w-[140px] truncate`} title={o.customerEmail}>{o.customerName || o.customerEmail || '—'}</td>
                  <td className={`${td} text-gray-600 max-w-[220px] truncate`} title={o.itemsLabel}>{o.itemsLabel || '—'}</td>
                  <td className={`${td} text-right font-semibold text-gray-900 whitespace-nowrap`}>{fmt(o.saleAmount)}</td>
                  <td className={td}><EditableCell value={o.fin.productCost} onSave={(v) => saveField(o, 'productCost', v)} placeholder="0.00" /></td>
                  <td className={td}><EditableCell value={o.fin.shippingCost} onSave={(v) => saveField(o, 'shippingCost', v)} placeholder="0.00" /></td>
                  <td className={td}><EditableCell value={o.fin.paymentFee} onSave={(v) => saveField(o, 'paymentFee', v)} placeholder="0.00" /></td>
                  <td className={td}><EditableCell value={o.fin.otherExpense} onSave={(v) => saveField(o, 'otherExpense', v)} placeholder="0.00" /></td>
                  <td className={td} title={o.fin.refundAmount === null ? 'From payment provider — click to override' : 'Manual override'}>
                    <EditableCell value={p.refund} onSave={(v) => saveField(o, 'refundAmount', v)} placeholder="0.00" />
                  </td>
                  <td className={`${td} text-right font-bold whitespace-nowrap ${p.netProfit < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{fmt(p.netProfit)}</td>
                  <td className={`${td} text-right text-gray-500`}>{pct(p.margin)}</td>
                  <td className={td}>
                    <select
                      value={o.fin.opsStatus || ''}
                      onChange={(e) => void saveField(o, 'opsStatus', e.target.value)}
                      className="bg-transparent text-[11px] rounded px-1 py-0.5 hover:bg-amber-50 border border-transparent hover:border-amber-200 cursor-pointer max-w-[150px]"
                      title={o.fin.opsStatus ? `Payment status: ${STATUS_LABELS[o.status] || o.status}` : 'Showing payment status'}>
                      <option value="">{STATUS_LABELS[o.status] || o.status} (auto)</option>
                      {ORDER_STATUSES.map((s) => (
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  </td>
                  <td className={td}><EditableCell value={o.fin.supplier} onSave={(v) => saveField(o, 'supplier', v)} type="text" align="left" placeholder="—" /></td>
                  <td className={td}><EditableCell value={o.fin.supplierOrderNumber} onSave={(v) => saveField(o, 'supplierOrderNumber', v)} type="text" align="left" mono placeholder="—" /></td>
                  <td className={td}><EditableCell value={o.fin.trackingNumber} onSave={(v) => saveField(o, 'trackingNumber', v)} type="text" align="left" mono placeholder="—" /></td>
                  <td className={td}><EditableCell value={o.fin.notes} onSave={(v) => saveField(o, 'notes', v)} type="text" align="left" placeholder="—" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-[11px] text-gray-500">
        <span>Page {page + 1} of {pages}</span>
        <div className="flex items-center gap-1.5">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1 rounded-lg border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50">Prev</button>
          <button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 rounded-lg border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50">Next</button>
        </div>
      </div>

      {detail && <OrderDetail order={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EXPENSES
// ---------------------------------------------------------------------------
function ExpensesTab() {
  const { notify } = useApp();
  const [expenses, setExpenses] = useState<BusinessExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<BusinessExpense>>({});
  const [adding, setAdding] = useState(false);
  const [newExp, setNewExp] = useState<Partial<BusinessExpense>>({ expenseDate: iso(new Date()), category: 'Advertising', amount: 0, description: '' });

  const load = useCallback(() => {
    setLoading(true);
    fetchExpenses()
      .then((d) => setExpenses(d.expenses))
      .catch((err: Error) => notify(err.message, 'error'))
      .finally(() => setLoading(false));
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const amount = Number(newExp.amount || 0);
    if (!newExp.expenseDate || !Number.isFinite(amount) || amount < 0) { notify('Enter a valid date and amount.', 'error'); return; }
    try {
      await createExpense({
        expenseDate: newExp.expenseDate,
        category: newExp.category || 'Miscellaneous',
        description: (newExp.description || '').trim(),
        amount: money(amount),
        paymentMethod: (newExp.paymentMethod || '').trim(),
        receiptUrl: (newExp.receiptUrl || '').trim(),
        notes: (newExp.notes || '').trim(),
      });
      setAdding(false);
      setNewExp({ expenseDate: iso(new Date()), category: 'Advertising', amount: 0, description: '' });
      load();
      notify('Expense added');
    } catch (err) { notify((err as Error).message, 'error'); }
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const amount = Number(draft.amount ?? 0);
    if (!Number.isFinite(amount) || amount < 0) { notify('Amount must be 0 or more.', 'error'); return; }
    try {
      await updateExpense(editingId, { ...draft, amount: money(amount) });
      setEditingId(null);
      setDraft({});
      load();
      notify('Expense updated');
    } catch (err) { notify((err as Error).message, 'error'); }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this expense? (It is kept in history but hidden from reports.)')) return;
    try { await deleteExpense(id); load(); notify('Expense deleted'); }
    catch (err) { notify((err as Error).message, 'error'); }
  };

  const total = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const th = 'px-2 py-2 text-[9px] font-bold uppercase tracking-wider text-gray-400 whitespace-nowrap';
  const td = 'px-2 py-1.5 border-b border-gray-50 text-[11px]';
  const input = 'border border-gray-200 rounded-lg px-2 py-1 text-[11px] bg-white w-full';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-[10px] text-gray-400">General business expenses (not tied to one order). Deleted rows stay in history.</p>
        <button onClick={() => setAdding((a) => !a)}
          className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-white bg-[#1b1f27] hover:bg-[#2b3140] flex items-center gap-1.5">
          <Plus size={12} weight="bold" /> Add Expense
        </button>
      </div>

      {adding && (
        <div className="bg-white rounded-xl border border-amber-200 p-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 items-end">
          <label className="text-[9px] font-bold text-gray-400">DATE<input type="date" value={newExp.expenseDate || ''} onChange={(e) => setNewExp({ ...newExp, expenseDate: e.target.value })} className={input} /></label>
          <label className="text-[9px] font-bold text-gray-400">CATEGORY
            <select value={newExp.category} onChange={(e) => setNewExp({ ...newExp, category: e.target.value })} className={input}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-[9px] font-bold text-gray-400">DESCRIPTION<input value={newExp.description || ''} onChange={(e) => setNewExp({ ...newExp, description: e.target.value })} className={input} placeholder="What was this?" /></label>
          <label className="text-[9px] font-bold text-gray-400">AMOUNT<input type="number" min={0} step={0.01} value={newExp.amount ?? ''} onChange={(e) => setNewExp({ ...newExp, amount: Number(e.target.value) })} className={input} /></label>
          <label className="text-[9px] font-bold text-gray-400">PAYMENT (optional)<input value={newExp.paymentMethod || ''} onChange={(e) => setNewExp({ ...newExp, paymentMethod: e.target.value })} className={input} placeholder="Card / Bank…" /></label>
          <label className="text-[9px] font-bold text-gray-400">RECEIPT URL (optional)<input value={newExp.receiptUrl || ''} onChange={(e) => setNewExp({ ...newExp, receiptUrl: e.target.value })} className={input} placeholder="https://…" /></label>
          <div className="flex gap-1.5">
            <button onClick={() => void add()} className="flex-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white">Save</button>
            <button onClick={() => setAdding(false)} className="px-3 py-1.5 rounded-lg text-[11px] border border-gray-200">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        <table className="w-full text-left min-w-[900px]">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className={th}>Date</th><th className={th}>Category</th><th className={th}>Description</th>
              <th className={`${th} text-right`}>Amount</th><th className={th}>Payment Method</th><th className={th}>Reference / Receipt</th>
              <th className={th}>Notes</th><th className={th} />
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Loading expenses…</td></tr>}
            {!loading && expenses.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No expenses recorded yet.</td></tr>}
            {expenses.map((e) => {
              const ed = editingId === e.id;
              const v = (k: keyof BusinessExpense) => (ed ? String(draft[k] ?? e[k] ?? '') : String(e[k] ?? ''));
              return (
                <tr key={e.id} className="hover:bg-gray-50/70">
                  <td className={td}>{ed ? <input type="date" value={v('expenseDate')} onChange={(ev) => setDraft({ ...draft, expenseDate: ev.target.value })} className={input} /> : e.expenseDate}</td>
                  <td className={td}>
                    {ed ? (
                      <select value={v('category')} onChange={(ev) => setDraft({ ...draft, category: ev.target.value })} className={input}>
                        {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    ) : e.category}
                  </td>
                  <td className={td}>{ed ? <input value={v('description')} onChange={(ev) => setDraft({ ...draft, description: ev.target.value })} className={input} /> : (e.description || '—')}</td>
                  <td className={`${td} text-right font-semibold`}>{ed ? <input type="number" min={0} step={0.01} value={v('amount')} onChange={(ev) => setDraft({ ...draft, amount: Number(ev.target.value) })} className={`${input} text-right`} /> : fmt(e.amount)}</td>
                  <td className={td}>{ed ? <input value={v('paymentMethod')} onChange={(ev) => setDraft({ ...draft, paymentMethod: ev.target.value })} className={input} /> : (e.paymentMethod || '—')}</td>
                  <td className={td}>{ed ? <input value={v('receiptUrl')} onChange={(ev) => setDraft({ ...draft, receiptUrl: ev.target.value })} className={input} /> : (e.receiptUrl ? <a href={e.receiptUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Receipt</a> : '—')}</td>
                  <td className={td}>{ed ? <input value={v('notes')} onChange={(ev) => setDraft({ ...draft, notes: ev.target.value })} className={input} /> : (e.notes || '—')}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    {ed ? (
                      <>
                        <button onClick={() => void saveEdit()} className="px-2 py-1 rounded-lg text-[10px] font-bold bg-emerald-600 text-white mr-1">Save</button>
                        <button onClick={() => { setEditingId(null); setDraft({}); }} className="px-2 py-1 rounded-lg text-[10px] border border-gray-200">Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => { setEditingId(e.id); setDraft({}); }} className="px-2 py-1 rounded-lg text-[10px] border border-gray-200 mr-1 hover:bg-gray-50">Edit</button>
                        <button onClick={() => void remove(e.id)} className="px-2 py-1 rounded-lg text-[10px] text-rose-600 hover:bg-rose-50"><Trash size={12} /></button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {expenses.length > 0 && (
            <tfoot>
              <tr className="bg-gray-50 font-bold text-[11px]">
                <td className={td} colSpan={3}>Total</td>
                <td className={`${td} text-right`}>{fmt(total)}</td>
                <td className={td} colSpan={4} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// REPORTS
// ---------------------------------------------------------------------------
function ReportsTab() {
  const [preset, setPreset] = useState<RangePreset>('month');
  const initial = presetRange('month');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [grouping, setGrouping] = useState<PeriodGrouping>('month');
  const pick = (p: RangePreset) => {
    setPreset(p);
    if (p !== 'custom') { const r = presetRange(p); setFrom(r.from); setTo(r.to); }
  };
  const { orders, expenses, loading, error } = useRangeData(from, to);
  const rows: SalesReportRow[] = useMemo(() => reportByPeriod(orders, expenses, grouping), [orders, expenses, grouping]);
  const total = useMemo(() => summarize(orders, expenses), [orders, expenses]);

  const th = 'px-2 py-2 text-[9px] font-bold uppercase tracking-wider text-gray-400 whitespace-nowrap';
  const td = 'px-2 py-1.5 border-b border-gray-50 text-[11px] whitespace-nowrap';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <RangeFilter preset={preset} from={from} to={to} onPreset={pick} onFrom={setFrom} onTo={setTo} />
        <select value={grouping} onChange={(e) => setGrouping(e.target.value as PeriodGrouping)}
          className="border border-gray-200 rounded-lg px-2 py-1 text-[11px] bg-white">
          <option value="day">Daily</option>
          <option value="week">Weekly</option>
          <option value="month">Monthly</option>
          <option value="quarter">Quarterly</option>
          <option value="year">Yearly</option>
        </select>
      </div>
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
      <p className="text-[9px] text-gray-400 px-1">A management report — not accounting statements. Tax filing stays with your CPA.</p>

      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        <table className="w-full text-left min-w-[1100px]">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className={th}>Period</th>
              <th className={`${th} text-right`}>Gross Sales</th>
              <th className={`${th} text-right`}>Refunds</th>
              <th className={`${th} text-right`}>Net Sales</th>
              <th className={`${th} text-right`}>Orders</th>
              <th className={`${th} text-right`}>COGS</th>
              <th className={`${th} text-right`}>Shipping</th>
              <th className={`${th} text-right`}>Payment Fees</th>
              <th className={`${th} text-right`}>Other Order Exp.</th>
              <th className={`${th} text-right`}>General Exp.</th>
              <th className={`${th} text-right`}>Net Profit</th>
              <th className={`${th} text-right`}>Margin</th>
              <th className={`${th} text-right`}>AOV</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={13} className="px-4 py-8 text-center text-gray-400">Loading report…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={13} className="px-4 py-8 text-center text-gray-400">Nothing to report in this range.</td></tr>}
            {rows.map((r) => (
              <tr key={r.periodStart} className="hover:bg-gray-50/70">
                <td className={`${td} font-semibold text-gray-800`}>{r.label}</td>
                <td className={`${td} text-right`}>{fmt(r.grossSales)}</td>
                <td className={`${td} text-right ${r.refunds > 0 ? 'text-rose-600' : ''}`}>{fmt(r.refunds)}</td>
                <td className={`${td} text-right`}>{fmt(r.netSales)}</td>
                <td className={`${td} text-right`}>{r.orders}</td>
                <td className={`${td} text-right`}>{fmt(r.cogs)}</td>
                <td className={`${td} text-right`}>{fmt(r.shipping)}</td>
                <td className={`${td} text-right`}>{fmt(r.paymentFees)}</td>
                <td className={`${td} text-right`}>{fmt(r.otherOrderExpenses)}</td>
                <td className={`${td} text-right`}>{fmt(r.generalExpenses)}</td>
                <td className={`${td} text-right font-bold ${r.netProfit < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{fmt(r.netProfit)}</td>
                <td className={`${td} text-right`}>{pct(r.margin)}</td>
                <td className={`${td} text-right`}>{fmt(r.aov)}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-gray-50 font-bold text-[11px]">
                <td className={td}>Total</td>
                <td className={`${td} text-right`}>{fmt(total.grossSales)}</td>
                <td className={`${td} text-right`}>{fmt(total.refunds)}</td>
                <td className={`${td} text-right`}>{fmt(total.netSales)}</td>
                <td className={`${td} text-right`}>{total.orders}</td>
                <td className={`${td} text-right`}>{fmt(total.cogs)}</td>
                <td className={`${td} text-right`}>{fmt(total.shipping)}</td>
                <td className={`${td} text-right`}>{fmt(total.paymentFees)}</td>
                <td className={`${td} text-right`}>{fmt(total.otherOrderExpenses)}</td>
                <td className={`${td} text-right`}>{fmt(total.generalExpenses)}</td>
                <td className={`${td} text-right ${total.netProfit < 0 ? 'text-rose-600' : ''}`}>{fmt(total.netProfit)}</td>
                <td className={`${td} text-right`}>{pct(total.margin)}</td>
                <td className={`${td} text-right`}>{fmt(total.aov)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EXPORT / SHEETS
// ---------------------------------------------------------------------------
function ExportTab() {
  const { notify } = useApp();
  const [preset, setPreset] = useState<RangePreset>('month');
  const initial = presetRange('month');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const pick = (p: RangePreset) => {
    setPreset(p);
    if (p !== 'custom') { const r = presetRange(p); setFrom(r.from); setTo(r.to); }
  };
  const { orders, expenses, loading, reload } = useRangeData(from, to);
  const [sheets, setSheets] = useState<{ configured: boolean; message: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => { fetchSheetsStatus().then(setSheets).catch(() => setSheets(null)); }, []);

  const doExport = (kind: 'csv' | 'excel' | 'expenses' | 'full') => {
    try {
      if (kind === 'csv') downloadText(exportFileName('luxedge-sales', from, to), ordersCsv(orders));
      else if (kind === 'excel') downloadText(exportFileName('luxedge-sales-excel', from, to), excelCsv(ordersCsv(orders)), 'application/vnd.ms-excel;charset=utf-8');
      else if (kind === 'expenses') downloadText(exportFileName('luxedge-expenses', from, to), excelCsv(expensesCsv(expenses)), 'application/vnd.ms-excel;charset=utf-8');
      else downloadText(exportFileName('luxedge-cpa-full', from, to), excelCsv(cpaFullCsv(orders, expenses)), 'application/vnd.ms-excel;charset=utf-8');
      notify('Export downloaded');
    } catch (err) { notify((err as Error).message, 'error'); }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await syncToSheets();
      notify(r.message, r.ok ? 'success' : 'error');
    } catch (err) { notify((err as Error).message, 'error'); }
    finally { setSyncing(false); }
  };

  const btn = 'px-3.5 py-2 rounded-lg text-[11px] font-bold border border-gray-200 bg-white hover:bg-gray-50 flex items-center gap-1.5';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <RangeFilter preset={preset} from={from} to={to} onPreset={pick} onFrom={setFrom} onTo={setTo} />
        <button onClick={reload} className="text-[10px] text-[#9a6f16] hover:underline">Refresh data</button>
      </div>
      <p className="text-[9px] text-gray-400 px-1">
        {loading ? 'Loading…' : `${orders.length} order(s) · ${expenses.length} expense(s) in range`} — exports use the exact same totals shown in this module. No tax liability is calculated; filing stays with your CPA.
      </p>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-2">
          <h3 className="text-[11px] font-bold text-gray-800 flex items-center gap-1.5"><Download size={12} className="text-[#9a6f16]" /> CPA / Accountant Export</h3>
          <button onClick={() => doExport('csv')} className={btn}><FileText size={13} /> Orders CSV</button>
          <button onClick={() => doExport('excel')} className={btn}><Table size={13} /> Orders Excel-compatible CSV</button>
          <button onClick={() => doExport('expenses')} className={btn}><Receipt size={13} /> Expenses Excel-compatible CSV</button>
          <button onClick={() => doExport('full')} className={btn}><CurrencyDollar size={13} /> Full CPA Hand-off (orders + expenses + summary)</button>
          <p className="text-[9px] text-gray-400 pt-1">Date, Order #, Revenue, Refund, Net Sales, COGS, Shipping, Payment Fees, Other Expenses, Net Profit, Supplier, Tracking / Reference, Notes.</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-2">
          <h3 className="text-[11px] font-bold text-gray-800 flex items-center gap-1.5"><CloudArrowUp size={12} className="text-[#9a6f16]" /> Google Sheets (optional)</h3>
          <p className="text-[10px] text-gray-500">{sheets ? sheets.message : 'Checking connection…'}</p>
          <p className="text-[9px] text-gray-400">Supabase is the source of truth; this module works fully without Sheets. Any CSV above opens directly in Google Sheets (File → Import).</p>
          <button onClick={() => void sync()} disabled={!sheets?.configured || syncing}
            className={`${btn} disabled:opacity-40 disabled:cursor-not-allowed`}>
            <CloudArrowUp size={13} /> {syncing ? 'Syncing…' : 'Sync to Google Sheets'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MODULE SHELL — single admin entry with internal tabs
// ---------------------------------------------------------------------------
type TabKey = 'overview' | 'orders' | 'expenses' | 'reports' | 'export';

const TABS: { key: TabKey; label: string; icon: React.ComponentType<Record<string, unknown>> }[] = [
  { key: 'overview', label: 'Overview', icon: TrendUp },
  { key: 'orders', label: 'Orders', icon: Table },
  { key: 'expenses', label: 'Expenses', icon: Receipt },
  { key: 'reports', label: 'Reports', icon: FileText },
  { key: 'export', label: 'Export / Sheets', icon: Download },
];

export default function LuxedgeSales() {
  const [tab, setTab] = useState<TabKey>('overview');
  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">{SALES_MODULE_LABEL}</h1>
        <p className="text-xs text-gray-500 mt-0.5">Sales, order profitability and business expenses — one simple place.</p>
      </div>
      <div className="flex items-center gap-1 rounded-xl bg-white border border-gray-100 p-1 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors ${tab === t.key ? 'bg-[#1b1f27] text-white' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'}`}>
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab />}
      {tab === 'orders' && <OrdersTab />}
      {tab === 'expenses' && <ExpensesTab />}
      {tab === 'reports' && <ReportsTab />}
      {tab === 'export' && <ExportTab />}
    </div>
  );
}
