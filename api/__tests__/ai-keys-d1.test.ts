import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetDataRuntime, type D1DatabaseLike } from '../../worker/d1/runtime';
vi.mock('../_lib/auth', () => ({ requireAdmin: vi.fn() }));
import { requireAdmin } from '../_lib/auth';
import handler from '../admin/ai-keys';
import { __resetDbKeysForTests, resolveProviderKey } from '../_lib/providers';

const original = process.env.DEEPSEEK_API_KEY;
afterEach(() => {
  if (original === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = original;
  resetDataRuntime(); __resetDbKeysForTests(); vi.unstubAllGlobals(); vi.clearAllMocks();
});
function request(body?: unknown): IncomingMessage {
  const r = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  return Object.assign(r, { method: body ? 'POST' : 'GET', url: '/api/admin/ai-keys', headers: { 'content-type': 'application/json' }, socket: { remoteAddress: 'qa-ai-key-store' } }) as IncomingMessage;
}
function response() {
  const captured = { status: 200, body: {} as Record<string, unknown> };
  const mock = { statusCode: 200, setHeader() {}, end(text: string) { captured.status = mock.statusCode; captured.body = JSON.parse(text); } };
  return { captured, res: mock as unknown as ServerResponse };
}
function setup() {
  const rows = new Map<string, string>();
  const db: D1DatabaseLike = { prepare(sql) {
    let args: unknown[] = [];
    const stmt = {
      bind(...values: unknown[]) { args = values; return stmt; },
      async run() { if (sql.startsWith('INSERT')) rows.set(String(args[0]), String(args[1])); return { meta: { changes: 1 } }; },
      async all<T>() { const data = sql.includes('WHERE provider') ? [{ value: rows.get(String(args[0])) }] : [...rows.entries()].map(([provider, value]) => ({ provider, value })); return { results: data as T[] }; },
    };
    return stmt;
  } };
  resetDataRuntime({ DATA_BACKEND: 'd1', DB: db });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 402 })));
  vi.mocked(requireAdmin).mockResolvedValue({ sub: 'fixture-admin', app_metadata: { role: 'admin' } });
  return rows;
}
describe('AI Hub D1 key endpoint', () => {
  it('saves a new key despite unavailable Supabase, returns no complete secret, and preserves env priority', async () => {
    const rows = setup();
    const synthetic = 'synthetic-qa-provider-key';
    process.env.DEEPSEEK_API_KEY = 'synthetic-existing-env-key';
    const write = response();
    await handler(request({ action: 'set', provider: 'deepseek', key: synthetic }), write.res);
    expect(write.captured.body.ok).toBe(true);
    expect(rows.get('deepseek')).toBe(synthetic);
    expect(JSON.stringify(write.captured.body)).not.toContain(synthetic);
    expect(await resolveProviderKey('deepseek')).toBe('synthetic-existing-env-key');
    const read = response();
    await handler(request(), read.res);
    expect(JSON.stringify(read.captured.body)).not.toContain(synthetic);
    expect(JSON.stringify(read.captured.body)).not.toContain('synthetic-existing-env-key');
  });
  it('never reaches the private store without server-authorized admin access', async () => {
    const rows = setup();
    vi.mocked(requireAdmin).mockImplementation(async (_req, res) => { res.statusCode = 401; res.end(JSON.stringify({ error: 'Unauthorized' })); return null; });
    const denied = response();
    await handler(request({ action: 'set', provider: 'deepseek', key: 'synthetic-only-key' }), denied.res);
    expect(denied.captured.status).toBe(401);
    expect(rows.size).toBe(0);
  });
});
