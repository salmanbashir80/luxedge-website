import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../supabase', () => ({ getAccessToken: vi.fn(() => null), getSession: vi.fn() }));
import { getAccessToken } from '../supabase';
import { WorkerDbAdapter } from '../db';

describe('private catalog WorkerDbAdapter', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
  it('uses private uncached same-origin reads and preserves full editor fields', async () => {
    const row = { id: 'p1', description: 'Details', seo_title: 'Title' };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([row])));
    vi.stubGlobal('fetch', fetcher);
    const adapter = new WorkerDbAdapter('/api/admin/db');
    expect(await adapter.get('products', 'p1')).toEqual(row);
    expect(fetcher).toHaveBeenCalledWith('/api/admin/db/products?limit=1&id=eq.p1', {
      headers: { accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin',
    });
  });
  it('supports the existing JWT session without storing or minting a token', async () => {
    vi.mocked(getAccessToken).mockReturnValueOnce('test-session-only');
    const fetcher = vi.fn().mockResolvedValue(new Response('[]'));
    vi.stubGlobal('fetch', fetcher);
    await new WorkerDbAdapter('/api/admin/db').list('categories');
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer test-session-only');
  });
  it('leaves public caching and unauthenticated storefront reads unchanged', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('[]'));
    vi.stubGlobal('fetch', fetcher);
    await new WorkerDbAdapter().list('products');
    expect(fetcher).toHaveBeenCalledWith('/api/db/products', { headers: { accept: 'application/json' } });
    expect(getAccessToken).not.toHaveBeenCalled();
  });
});
