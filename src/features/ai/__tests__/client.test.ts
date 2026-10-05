// ============================================================================
// LUXEDGE — AI CLIENT TESTS
//
// Verifies callAIProvider's provider override + fallback chain contract:
//   - default routing uses the configured default (openrouter) with no
//     paid fallback by default (owner must explicitly enable fallback)
//   - a providerIdOverride forces a non-default provider as primary while
//     keeping the configured fallback for server-side failover
//   - an override that is disabled/unknown throws instead of silently
//     switching to another provider
//   - nothing secret is ever sent to /api/ai/generate
// ============================================================================
import { describe, it, expect, afterEach, vi } from 'vitest';
import { callAIProvider, serverTestProviderResult } from '../client';
import type { AIProvider } from '../types';

function providers(): AIProvider[] {
  return [
    { id: 'openrouter', name: 'OpenRouter', models: ['nvidia/nemotron-3-super-120b-a12b:free'], defaultModel: 'nvidia/nemotron-3-super-120b-a12b:free', enabled: true, isDefault: true },
    { id: 'deepseek', name: 'DeepSeek', models: ['deepseek-v4-flash'], defaultModel: 'deepseek-v4-flash', enabled: true, isDefault: false },
    { id: 'codex', name: 'OpenAI Codex', models: ['gpt-5-codex'], defaultModel: 'gpt-5-codex', enabled: true, isDefault: false },
    { id: 'anthropic', name: 'Anthropic Claude', models: ['claude-haiku-4-5-20251001'], defaultModel: 'claude-haiku-4-5-20251001', enabled: true, isDefault: false },
  ];
}

let lastBody: { provider?: string; model?: string; fallback?: string; prompt?: string; system?: string } = {};

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    lastBody = JSON.parse(String(init?.body || '{}'));
    return new Response(JSON.stringify({ text: 'LUXEDGE-QWEN-OK', provider: lastBody.provider, model: lastBody.model }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  lastBody = {};
});

describe('callAIProvider', () => {
  it('does not mistake an HTTP 200 failed connection test for success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, message: 'Quota exhausted' }), { status: 200 })));
    expect(await serverTestProviderResult('openrouter')).toEqual({ ok: false, message: 'Quota exhausted' });
  });
  it('uses the configured default provider with no fallback when default settings have null fallback', async () => {
    stubFetch();
    const out = await callAIProvider('test', providers());
    expect(out).toBe('LUXEDGE-QWEN-OK');
    expect(lastBody.provider).toBe('openrouter');
    expect(lastBody.model).toBe('nvidia/nemotron-3-super-120b-a12b:free');
    // Default fallback is null (no paid providers auto-used)
    expect(lastBody.fallback).toBeFalsy();
  });

  it('forces a non-default provider as primary while keeping the fallback', async () => {
    stubFetch();
    const progress: string[] = [];
    const out = await callAIProvider('test', providers(), (m) => progress.push(m), undefined, 'anthropic');
    expect(out).toBe('LUXEDGE-QWEN-OK');
    expect(lastBody.provider).toBe('anthropic');
    expect(lastBody.model).toBe('claude-haiku-4-5-20251001');
    // Default fallback is null; forced primary has no fallback from settings
    expect(lastBody.fallback).toBeFalsy();
  });

  it('throws when the override provider is disabled or unknown', async () => {
    stubFetch();
    const disabled = providers().map((p) => (p.id === 'anthropic' ? { ...p, enabled: false } : p));
    await expect(callAIProvider('test', disabled, undefined, undefined, 'anthropic')).rejects.toThrow(/not enabled/i);
    await expect(callAIProvider('test', providers(), undefined, undefined, 'does-not-exist')).rejects.toThrow(/not enabled/i);
  });

  it('uses auto-routing when the override is the literal "auto" value', async () => {
    stubFetch();
    await callAIProvider('test', providers(), undefined, undefined, 'auto');
    expect(lastBody.provider).toBe('openrouter');
    // Default fallback is null (no paid providers auto-used)
    expect(lastBody.fallback).toBeFalsy();
  });

  it('never sends secrets to the server proxy', async () => {
    stubFetch();
    await callAIProvider('test', providers(), undefined, 'be nice', 'anthropic');
    const serialized = JSON.stringify(lastBody);
    expect(serialized).not.toMatch(/api[_-]?key|secret|Bearer\s+\S+|sk-[A-Za-z0-9]{10,}/i);
  });
});
