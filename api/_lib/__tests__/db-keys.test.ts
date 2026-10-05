// ============================================================================
// LUXEDGE — DB-ATTACHED AI KEY FALLBACK TESTS
//
// Owners can attach provider keys via Settings → AI & Scraping Keys without
// touching env vars. The key is stored in app_settings as AI_KEY_<PROVIDER>
// and is used when the env var is absent (env always wins). These tests pin
// that resolution order and the cache behavior.
// ============================================================================
import { describe, it, expect, afterEach, vi } from 'vitest';
import { isConfiguredFull, resolveProviderKey, loadDbProviderKeys, generate, __resetDbKeysForTests, __resetKeyRotationForTests } from '../providers.js';
import { resetDataRuntime } from '../../../worker/d1/runtime';

const ORIG = new Map<string, string | undefined>([
  ['DEEPSEEK_API_KEY', process.env.DEEPSEEK_API_KEY],
  ['CODEX_API_KEY', process.env.CODEX_API_KEY],
  ['CHATGPT_OAUTH_TOKEN', process.env.CHATGPT_OAUTH_TOKEN],
  ['VITE_SUPABASE_URL', process.env.VITE_SUPABASE_URL],
  ['SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY],
]);

function stubDb(rows: Array<{ key: string; value: string }>) {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    if (String(url).includes('/rest/v1/app_settings')) {
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
  }));
}

describe('DB-attached AI provider keys', () => {
  afterEach(() => {
    for (const [k, v] of ORIG) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    __resetDbKeysForTests();
    __resetKeyRotationForTests();
    vi.unstubAllGlobals();
    resetDataRuntime();
  });

  it('falls back to the DB-attached key when the env var is missing', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    process.env.VITE_SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    stubDb([{ key: 'AI_KEY_DEEPSEEK', value: 'db-deepseek-key' }]);

    expect(await isConfiguredFull('deepseek')).toBe(true);
    expect(await resolveProviderKey('deepseek')).toBe('db-deepseek-key');
  });

  it('env var wins over the DB-attached key', async () => {
    process.env.DEEPSEEK_API_KEY = 'env-deepseek-key';
    process.env.VITE_SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    stubDb([{ key: 'AI_KEY_DEEPSEEK', value: 'db-deepseek-key' }]);

    expect(await isConfiguredFull('deepseek')).toBe(true);
    expect(await resolveProviderKey('deepseek')).toBe('env-deepseek-key');
  });

  it('codex accepts a ChatGPT OAuth token as the attached subscription key', async () => {
    delete process.env.CODEX_API_KEY;
    delete process.env.CHATGPT_OAUTH_TOKEN;
    process.env.VITE_SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    stubDb([{ key: 'AI_KEY_CHATGPT_OAUTH', value: 'oauth-token' }]);

    expect(await isConfiguredFull('codex')).toBe(true);
    expect(await resolveProviderKey('codex')).toBe('oauth-token');
  });

  it('reports unconfigured when neither env nor DB has a key', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    process.env.VITE_SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    stubDb([{ key: 'AI_KEY_OPENROUTER', value: 'or-key' }]);

    expect(await isConfiguredFull('deepseek')).toBe(false);
    expect(await resolveProviderKey('deepseek')).toBe('');
  });

  it('generate uses the DB-attached key when the env var is missing (DeepSeek rotation path)', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    process.env.VITE_SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/rest/v1/app_settings')) {
        return new Response(JSON.stringify([{ key: 'AI_KEY_DEEPSEEK', value: 'db-deepseek-key' }]), { status: 200 });
      }
      if (url.includes('api.deepseek.com')) {
        const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization || '');
        if (auth === 'Bearer db-deepseek-key') {
          return new Response(JSON.stringify({ choices: [{ message: { content: 'from db key' } }] }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: 'wrong key' }), { status: 401 });
      }
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
    }));

    const text = await generate('deepseek', { prompt: 'hi', model: 'deepseek-v4-flash' });
    expect(text).toBe('from db key');
  });

  it('caches DB keys for 60s and refreshes when forced', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    process.env.VITE_SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ key: 'AI_KEY_DEEPSEEK', value: 'k1' }]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await loadDbProviderKeys()).toEqual({ DEEPSEEK: 'k1' });
    const firstCalls = fetchMock.mock.calls.length;
    await loadDbProviderKeys(); // cached — no second fetch
    expect(fetchMock.mock.calls.length).toBe(firstCalls);
    await loadDbProviderKeys(true); // forced refresh
    expect(fetchMock.mock.calls.length).toBeGreaterThan(firstCalls);
  });
  it('uses new D1-attached keys through the shared resolver while env bindings still win', async () => {
    resetDataRuntime({ DATA_BACKEND: 'd1', DB: { prepare: () => ({ all: async () => ({ results: [{ provider: 'deepseek', value: 'fixture-d1-key' }] }) }) } });
    process.env.VITE_SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 402 })));
    delete process.env.DEEPSEEK_API_KEY;
    expect(await resolveProviderKey('deepseek')).toBe('fixture-d1-key');
    process.env.DEEPSEEK_API_KEY = 'fixture-env-key';
    expect(await resolveProviderKey('deepseek')).toBe('fixture-env-key');
  });
});
