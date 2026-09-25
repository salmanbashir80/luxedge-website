// ============================================================================
// LUXEDGE — /api/admin/sales contract (Sales & Profit module)
//
// Security is the first concern: every action is admin-only and financial
// money inputs are validated server-side (finite, >= 0, bounded).
// ============================================================================
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../_lib/auth.js', () => ({ requireAdmin: vi.fn() }));

const { requireAdmin } = await import('../_lib/auth.js');
const handler = (await import('../admin/sales.js')).default;

function makeRes(): { captured: { status: number; body: unknown }; server: ServerResponse } {
  const captured = { status: 200, body: null as unknown };
  const server = {
    statusCode: 200,
    setHeader: () => undefined,
    end: (body: unknown) => {
      captured.status = (server as { statusCode: number }).statusCode;
      captured.body = typeof body === 'string' ? JSON.parse(body) : body;
    },
  } as unknown as ServerResponse;
  return { captured, server };
}

function makeReq(method: string, url: string, payload?: Record<string, unknown>): IncomingMessage {
  const body = payload ? JSON.stringify(payload) : '';
  const r = {
    method,
    url,
    headers: payload ? { 'content-type': 'application/json' } : {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
  const evt = (name: string, fn: (chunk?: Buffer) => void) => {
    if (name === 'data' && body) process.nextTick(() => fn(Buffer.from(body)));
    if (name === 'end') process.nextTick(() => fn());
    return r;
  };
  Object.defineProperty(r, 'on', { value: evt, configurable: true });
  return r;
}

interface StubCall { method: string; url: string; body?: string; prefer?: string | null }

function stubFetch(responses: Record<string, unknown>): StubCall[] {
  const calls: StubCall[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    calls.push({ method, url, body: typeof init?.body === 'string' ? init.body : undefined, prefer: new Headers(init?.headers).get('Prefer') });
    // Route by table + method: "TABLE:METHOD" → response payload (or []).
    for (const [key, payload] of Object.entries(responses)) {
      const [table, m] = key.split(':');
      if (url.includes(`/rest/v1/${table}`) && method === (m || 'GET')) {
        return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }
    return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  return calls;
}

describe('/api/admin/sales', () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockResolvedValue({ sub: 'admin-1', role: 'admin', email: 'admin@test' } as never);
    process.env.VITE_SUPABASE_URL = 'https://probe.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-probe';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('rejects unauthenticated callers before touching any data', async () => {
    vi.mocked(requireAdmin).mockImplementationOnce(async (_req, res) => {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return null;
    });
    const calls = stubFetch({});
    const { captured, server } = makeRes();
    await handler(makeReq('GET', '/api/admin/sales?action=orders'), server);
    expect(captured.status).toBe(401);
    expect(calls.length).toBe(0);
  });

  it('GET orders joins the financial sidecar and never mutates luxedge_orders', async () => {
    const calls = stubFetch({
      'luxedge_orders:GET': [{
        id: 'o1', order_number: 'LX-1001', created_at: '2026-09-01T10:00:00.000Z',
        customer_name: 'Buyer', customer_email: 'b@t.dev',
        items: [{ name: 'Fly Mask', qty: 1 }], total: 100, refunded_amount: 10,
        status: 'paid', payment_provider: 'stripe', coupon_code: null,
      }],
      'order_financials:GET': [{
        id: 'f1', order_id: 'o1', product_cost: 30, shipping_cost: 5, payment_fee: 3,
        other_expense: 2, refund_amount: null, ops_status: null,
        supplier: 'CJ', supplier_order_number: '', tracking_number: '', notes: '',
      }],
    });
    const { captured, server } = makeRes();
    await handler(makeReq('GET', '/api/admin/sales?action=orders'), server);
    const body = captured.body as { orders: Array<{ id: string; saleAmount: number; providerRefund: number; fin: { productCost: number; refundAmount: number | null } }>; total: number };
    expect(captured.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.orders[0].saleAmount).toBe(100);
    expect(body.orders[0].providerRefund).toBe(10);
    expect(body.orders[0].fin.productCost).toBe(30);
    expect(body.orders[0].fin.refundAmount).toBeNull(); // provider amount is the default
    // REGRESSION PIN: gift exclusion must be NULL-safe. A bare
    // `coupon_code=not.eq.X` also drops every order with no coupon at all
    // (real customer orders), so the query must keep NULL-coupon rows.
    const ordersUrl = calls.find((c) => c.url.includes('/rest/v1/luxedge_orders'))?.url || '';
    expect(ordersUrl).toContain('coupon_code.is.null');
    expect(ordersUrl).not.toMatch(/coupon_code=not\.eq\./);
  });

  it('fails closed when the financial sidecar read fails instead of reporting zero costs', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/rest/v1/luxedge_orders')) {
        return new Response(JSON.stringify([{
          id: 'o1', order_number: 'LX-1001', created_at: '2026-09-01T10:00:00.000Z',
          customer_name: 'Buyer', customer_email: 'b@t.dev', items: [], total: 100,
          refunded_amount: 0, status: 'paid', payment_provider: 'stripe', coupon_code: null,
        }]), { status: 200 });
      }
      return new Response(JSON.stringify({ message: 'sidecar unavailable' }), { status: 503 });
    }));
    const { captured, server } = makeRes();
    await handler(makeReq('GET', '/api/admin/sales?action=orders'), server);
    expect(captured.status).toBe(503);
    expect(captured.body).toEqual({ error: 'Could not load order financial details. Please retry.' });
  });

  it('order-financials validates money and rejects negatives', async () => {
    stubFetch({});
    const { captured, server } = makeRes();
    await handler(makeReq('POST', '/api/admin/sales?action=order-financials', { order_id: 'o1', product_cost: -5 }), server);
    expect(captured.status).toBe(400);
  });

  it('order-financials rejects an unknown ops status', async () => {
    stubFetch({});
    const { captured, server } = makeRes();
    await handler(makeReq('POST', '/api/admin/sales?action=order-financials', { order_id: 'o1', ops_status: 'shipped_typo' }), server);
    expect(captured.status).toBe(400);
  });

  it('order-financials upserts the sidecar without ever PATCHing luxedge_orders', async () => {
    const calls = stubFetch({
      'order_financials:PATCH': [{ id: 'f1' }],
    });
    const { captured, server } = makeRes();
    await handler(makeReq('POST', '/api/admin/sales?action=order-financials', {
      order_id: 'o1', product_cost: 30.5, refund_amount: null, ops_status: 'shipped', tracking_number: 'T-1',
    }), server);
    expect(captured.status).toBe(200);
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.url).toContain('/rest/v1/order_financials');
    expect(patch?.body).toContain('"product_cost":30.5');
    expect(patch?.body).toContain('"ops_status":"shipped"');
    expect(patch?.prefer).toBe('return=representation');
    expect(calls.every((c) => !c.url.includes('/rest/v1/luxedge_orders') || c.method === 'GET')).toBe(true);
  });

  it('expenses-create returns the persisted representation and forwards PostgREST Prefer', async () => {
    const calls = stubFetch({
      'business_expenses:POST': [{ id: 'e1', expense_date: '2026-09-01', category: 'Advertising', description: 'Campaign', amount: 12.5, payment_method: 'Card', receipt_url: '', notes: '' }],
    });
    const { captured, server } = makeRes();
    await handler(makeReq('POST', '/api/admin/sales?action=expenses-create', {
      expenseDate: '2026-09-01', category: 'Advertising', description: 'Campaign', amount: 12.5,
      paymentMethod: 'Card', receiptUrl: '', notes: '',
    }), server);
    expect(captured.status).toBe(200);
    expect((captured.body as { expense: { id: string; amount: number } }).expense).toEqual(expect.objectContaining({ id: 'e1', amount: 12.5 }));
    expect(calls[0].prefer).toBe('return=representation');
  });

  it('expenses-create validates category and amount', async () => {
    stubFetch({});
    const { captured: c1, server: s1 } = makeRes();
    await handler(makeReq('POST', '/api/admin/sales?action=expenses-create', { expense_date: '2026-09-01', category: 'Bribes', amount: 10 }), s1);
    expect(c1.status).toBe(400);

    const { captured: c2, server: s2 } = makeRes();
    await handler(makeReq('POST', '/api/admin/sales?action=expenses-create', { expense_date: '2026-09-01', category: 'Advertising', amount: -1 }), s2);
    expect(c2.status).toBe(400);
  });

  it('expenses-delete is SOFT (sets deleted_at, never DELETEs the row)', async () => {
    const calls = stubFetch({ 'business_expenses:PATCH': [{ id: 'e1' }] });
    const { captured, server } = makeRes();
    await handler(makeReq('POST', '/api/admin/sales?action=expenses-delete', { id: 'e1' }), server);
    expect(captured.status).toBe(200);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toContain('"deleted_at"');
  });

  it('Google Sheets stays optional: status reports honest state, sync is safe without it', async () => {
    delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const { captured, server } = makeRes();
    await handler(makeReq('GET', '/api/admin/sales?action=sheets-status'), server);
    expect((captured.body as { configured: boolean }).configured).toBe(false);

    const { captured: c2, server: s2 } = makeRes();
    await handler(makeReq('POST', '/api/admin/sales?action=sheets-sync', {}), s2);
    expect(c2.status).toBe(501); // clean seam — core module works without Sheets
  });
});
