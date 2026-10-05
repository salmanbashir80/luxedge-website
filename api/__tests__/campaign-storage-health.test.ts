import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../_lib/auth.js', () => ({ requireAdmin: vi.fn() }));
import { campaignStorageHealth } from '../_lib/campaigns';
const { requireAdmin } = await import('../_lib/auth.js');
const handler = (await import('../admin/campaigns.js')).default;

describe('honest campaign storage health', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key-only');
    vi.mocked(requireAdmin).mockResolvedValue({ sub: 'test-admin' } as never);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
  it('distinguishes an empty reachable registry from quota failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('[]')).mockResolvedValueOnce(new Response('private error details', { status: 402 })));
    expect(await campaignStorageHealth()).toEqual({ ok: true });
    expect(await campaignStorageHealth()).toEqual({ ok: false, error: 'Campaign storage unavailable (Supabase HTTP 402). No campaign changes were made.' });
  });
  it('does not expose provider response bodies or exception details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret-in-error')));
    expect(JSON.stringify(await campaignStorageHealth())).not.toContain('secret-in-error');
  });
  it.each(['GET', 'POST'])('blocks %s rather than reporting false zero counts or overwriting unreadable config', async method => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 402 }));
    vi.stubGlobal('fetch', fetcher);
    let body: Record<string, unknown> = {};
    const res = { statusCode: 200, setHeader: vi.fn(), end: (raw: string) => { body = JSON.parse(raw); } };
    await handler({ method, headers: {}, url: '/api/admin/campaigns' } as IncomingMessage, res as unknown as ServerResponse);
    expect(res.statusCode).toBe(503);
    expect(body.error).toContain('Supabase HTTP 402');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1].method).toBeUndefined();
  });
  it('checks existing admin authorization before probing storage', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await handler({ method: 'GET', headers: {} } as IncomingMessage, { setHeader: vi.fn() } as unknown as ServerResponse);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
