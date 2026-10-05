import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDataRuntime, setDataRuntime } from '../../worker/d1/runtime';

vi.mock('../_lib/auth.js', () => ({ requireAdmin: vi.fn() }));
const { requireAdmin } = await import('../_lib/auth.js');
const handler = (await import('../admin/db.js')).default;

function response() {
  const captured = { status: 200, body: null as unknown, headers: {} as Record<string, string> };
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string) { captured.headers[name.toLowerCase()] = value; },
    end(body: string) { captured.status = this.statusCode; captured.body = body ? JSON.parse(body) : null; },
  };
  return { captured, res: res as unknown as ServerResponse };
}

describe('private admin catalog reads', () => {
  const prepare = vi.fn();
  const bind = vi.fn();
  const all = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ sub: 'admin-test' } as never);
    prepare.mockReturnValue({ bind });
    bind.mockReturnValue({ all });
    all.mockResolvedValue({ results: [] });
    setDataRuntime({ DATA_BACKEND: 'd1', DB: { prepare } });
  });
  afterEach(() => resetDataRuntime());
  async function read(path: string) {
    const { captured, res } = response();
    await handler({ method: 'GET', url: `/api/admin/db/${path}`, headers: {} } as IncomingMessage, res);
    return captured;
  }
  it('never reads the database without the existing admin guard', async () => {
    vi.mocked(requireAdmin).mockImplementation(async (_req, res) => {
      res.statusCode = 401; res.end(JSON.stringify({ error: 'Unauthorized' }));
      return null;
    });
    const result = await read('products');
    expect(result.status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
    expect(result.headers['cache-control']).toBe('private, no-store');
  });
  it('returns complete fresh editor fields with safe JSON coercion', async () => {
    const row = { id: 'draft-1', description: 'Full description', seo_title: 'SEO', seo_keywords: '["brush"]', tags: 'dog,grooming' };
    all.mockResolvedValue({ results: [row] });
    const result = await read('products?id=eq.draft-1&limit=1');
    expect(result.status).toBe(200);
    expect(result.body).toEqual([{ ...row, seo_keywords: ['brush'] }]);
    expect(prepare).toHaveBeenCalledWith('SELECT * FROM "products" t WHERE t."id" = ? LIMIT ?');
    expect(bind).toHaveBeenCalledWith('draft-1', 1);
    expect(result.headers['cache-control']).toBe('private, no-store');
    expect(result.headers.vary).toBe('Cookie, Authorization');
    expect(result.headers['x-robots-tag']).toBe('noindex, nofollow');
  });
  it('does not reuse stale results between reads after a save', async () => {
    all.mockResolvedValueOnce({ results: [{ id: 'draft-1', description: 'Before' }] })
      .mockResolvedValueOnce({ results: [{ id: 'draft-1', description: 'Saved' }] });
    expect((await read('products?id=eq.draft-1')).body).toEqual([{ id: 'draft-1', description: 'Before' }]);
    expect((await read('products?id=eq.draft-1')).body).toEqual([{ id: 'draft-1', description: 'Saved' }]);
    expect(all).toHaveBeenCalledTimes(2);
  });
  it.each(['luxedge_orders', 'inventory_reservations', 'order_financials', 'processed_webhook_events'])('refuses non-catalog table %s', async table => {
    expect((await read(table)).status).toBe(403);
    expect(prepare).not.toHaveBeenCalled();
  });
  it.each(['app_settings', 'private_ai_keys', 'auth_users'])('never exposes %s', async table => {
    expect((await read(table)).status).toBe(400);
    expect(prepare).not.toHaveBeenCalled();
  });
  it('rejects unsupported queries before executing SQL', async () => {
    expect((await read('products?or=(status.eq.draft)')).status).toBe(400);
    expect(prepare).not.toHaveBeenCalled();
  });
  it('does not leak database error details', async () => {
    all.mockRejectedValue(new Error('internal-sensitive-database-details'));
    const result = await read('products');
    expect(result.status).toBe(503);
    expect(JSON.stringify(result.body)).not.toContain('sensitive');
  });
});
