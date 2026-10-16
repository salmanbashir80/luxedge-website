import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../_lib/auth', () => ({ requireAdmin: vi.fn() }));
import { requireAdmin } from '../_lib/auth';
import handler from '../admin/adsterra';

function request(body?: unknown): IncomingMessage {
  const r = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  return Object.assign(r, {
    method: body ? 'POST' : 'GET',
    url: '/api/admin/adsterra',
    headers: { 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
  }) as IncomingMessage;
}

function response() {
  const captured = { status: 200, body: {} as Record<string, unknown> };
  const mock = {
    statusCode: 200,
    setHeader() {},
    end(text: string) {
      captured.status = mock.statusCode;
      try {
        captured.body = JSON.parse(text);
      } catch {
        captured.body = { raw: text };
      }
    },
  };
  return { captured, res: mock as unknown as ServerResponse };
}

describe('/api/admin/adsterra endpoint', () => {
  const origToken = process.env.ADSTERRA_API_TOKEN;
  const origPub = process.env.ADSTERRA_PUBLISHER_ID;

  afterEach(() => {
    if (origToken === undefined) delete process.env.ADSTERRA_API_TOKEN;
    else process.env.ADSTERRA_API_TOKEN = origToken;

    if (origPub === undefined) delete process.env.ADSTERRA_PUBLISHER_ID;
    else process.env.ADSTERRA_PUBLISHER_ID = origPub;

    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('rejects unauthenticated requests with 401', async () => {
    vi.mocked(requireAdmin).mockImplementation(async (_req, res) => {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return null;
    });

    const res = response();
    await handler(request(), res.res);
    expect(res.captured.status).toBe(401);
  });

  it('returns masked status and active units on GET', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ sub: 'admin', app_metadata: { role: 'admin' } });
    process.env.ADSTERRA_API_TOKEN = 'b1e3ebcbeb0deafe660719043e434dfc';
    process.env.ADSTERRA_PUBLISHER_ID = '25409389';

    const res = response();
    await handler(request(), res.res);
    expect(res.captured.status).toBe(200);
    expect(res.captured.body.configured).toBe(true);
    expect(res.captured.body.publisherId).toBe('25409389');
    expect(res.captured.body.masked).toBe('b1e3••••4dfc');
    expect(res.captured.body.active).toBe(true);
  });

  it('verifies token against Adsterra API on test action', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ sub: 'admin', app_metadata: { role: 'admin' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));

    const res = response();
    await handler(request({ action: 'test', token: 'b1e3ebcbeb0deafe660719043e434dfc' }), res.res);
    expect(res.captured.status).toBe(200);
    expect(res.captured.body.ok).toBe(true);
  });
});
