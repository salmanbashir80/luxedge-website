import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeProvider, loadAIProviders, DEFAULT_AI_PROVIDERS, resolveActiveProvider, scrubLegacySecrets, loadProviderSettings, saveProviderSettings, resolveProviderChain, DEFAULT_PROVIDER_SETTINGS, OPENROUTER_DEFAULT_MODEL, RETIRED_MODEL_SLUGS, liveModelFor } from '../providers';
import type { AIProvider } from '../types';

function memoryStorage(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

/** Recursively collect text-bearing source files under a repo-relative dir. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) out.push(p);
  }
  return out;
}

describe('sanitizeProvider', () => {
  it('strips legacy apiKey secrets from stored provider config', () => {
    const dirty = {
      id: 'openai',
      name: 'OpenAI',
      models: ['gpt-4o-mini'],
      defaultModel: 'gpt-4o-mini',
      enabled: true,
      isDefault: true,
      apiKey: 'sk-secret-1234567890',
    };
    const clean = sanitizeProvider(dirty) as AIProvider & { apiKey?: string };
    expect(clean.apiKey).toBeUndefined();
    expect(JSON.stringify(clean)).not.toContain('sk-secret-1234567890');
    expect(clean.id).toBe('openai');
  });

  it('fills defaults for unknown/malformed providers', () => {
    const clean = sanitizeProvider({ id: 'unknown' } as AIProvider & Record<string, unknown>);
    expect(clean.name).toBeTruthy();
    expect(clean.models.length).toBeGreaterThan(0);
    expect(clean.enabled).toBe(true);
  });
});

describe('loadAIProviders', () => {
  it('returns defaults when nothing is stored', () => {
    const providers = loadAIProviders(memoryStorage({}));
    expect(providers.map((p) => p.id).sort()).toEqual(DEFAULT_AI_PROVIDERS.map((p) => p.id).sort());
    expect(providers.every((p) => !('apiKey' in p))).toBe(true);
  });

  it('merges stored config with defaults and never leaks keys', () => {
    const storage = memoryStorage({
      luxedge_ai_providers: JSON.stringify([
        { id: 'deepseek', name: 'DeepSeek', models: ['deepseek-chat'], defaultModel: 'deepseek-chat', enabled: true, isDefault: true, apiKey: 'sk-ds-super-secret' },
      ]),
    });
    const providers = loadAIProviders(storage);
    const deepseek = providers.find((p) => p.id === 'deepseek');
    // A saved owner choice stays the default; adding shipped providers must not replace it.
    expect(deepseek?.isDefault).toBe(true);
    expect(deepseek?.defaultModel).toBe('deepseek-chat');
    expect(deepseek && 'apiKey' in deepseek).toBe(false);
    expect(providers.find((p) => p.id === 'openrouter')?.isDefault).toBe(false);
    // defaults still present
    expect(providers.length).toBeGreaterThanOrEqual(DEFAULT_AI_PROVIDERS.length);
    expect(JSON.stringify(providers)).not.toContain('sk-ds-super-secret');
  });

  it('recovers from corrupt storage', () => {
    const providers = loadAIProviders(memoryStorage({ luxedge_ai_providers: '{{{not json' }));
    expect(providers.length).toBe(DEFAULT_AI_PROVIDERS.length);
  });

  it('defaults to OpenRouter as the default provider (owner chain: openrouter only, no paid fallbacks)', () => {
    expect(DEFAULT_AI_PROVIDERS.find((p) => p.isDefault)?.id).toBe('openrouter');
    const or = DEFAULT_AI_PROVIDERS.find((p) => p.id === 'openrouter');
    expect(or?.defaultModel).toBe(OPENROUTER_DEFAULT_MODEL);
    expect(or?.enabled).toBe(true);
    // DeepSeek enabled by default (server-side key is commonly configured);
    // Codex is available on demand (still never the default).
    expect(DEFAULT_AI_PROVIDERS.find((p) => p.id === 'deepseek')?.enabled).toBe(true);
    expect(DEFAULT_AI_PROVIDERS.find((p) => p.id === 'codex')?.enabled).toBe(true);
    expect(DEFAULT_AI_PROVIDERS.find((p) => p.id === 'codex')?.isDefault).toBe(false);
  });

  it('registry keeps the standard providers and no removed/private providers', () => {
    const ids = DEFAULT_AI_PROVIDERS.map((p) => p.id);
    expect(ids).toContain('deepseek');
    expect(ids).toContain('codex');
    expect(ids).toContain('openai');
    expect(ids).toContain('anthropic');
    expect(ids).not.toContain('qwen');
    // OpenRouter is the default; every provider has at least one model
    expect(DEFAULT_AI_PROVIDERS.find((p) => p.id === 'openrouter')?.isDefault).toBe(true);
    expect(DEFAULT_AI_PROVIDERS.every((p) => p.models.length > 0 && p.defaultModel)).toBe(true);
  });

  it('rewrites a RETIRED default model saved by an older build', () => {
    // The regression that broke AI SEO: OpenRouter retired the shipped default
    // id, and the stored config keeps winning over shipped defaults forever.
    const storage = memoryStorage({
      luxedge_ai_providers: JSON.stringify([
        { id: 'openrouter', name: 'OpenRouter', models: ['minimax/minimax-m3:free', 'openrouter/free'], defaultModel: 'minimax/minimax-m3:free', enabled: true, isDefault: true },
      ]),
    });
    const or = loadAIProviders(storage).find((p) => p.id === 'openrouter');
    expect(or?.defaultModel).toBe(OPENROUTER_DEFAULT_MODEL);
    expect(RETIRED_MODEL_SLUGS['minimax/minimax-m3:free']).toBe(OPENROUTER_DEFAULT_MODEL);
    // the dropdown must not keep offering the dead id either
    expect(or?.models).toContain(OPENROUTER_DEFAULT_MODEL);
    expect(or?.models).not.toContain('minimax/minimax-m3:free');
  });

  it('never substitutes an Object.prototype member as a model id', () => {
    // A plain lookup would resolve "toString"/"constructor" to a prototype
    // FUNCTION and assign that as the model — the storied prototype-chain bug.
    const storage = memoryStorage({
      luxedge_ai_providers: JSON.stringify([
        { id: 'openrouter', name: 'OpenRouter', models: ['toString', 'constructor', 'valueOf'], defaultModel: 'toString', enabled: true, isDefault: true },
      ]),
    });
    const or = loadAIProviders(storage).find((p) => p.id === 'openrouter');
    expect(typeof or?.defaultModel).toBe('string');
    expect(or?.defaultModel).toBe('toString');
    expect(or?.models.every((m) => typeof m === 'string')).toBe(true);
    expect(or?.models).toEqual(['toString', 'constructor', 'valueOf']);
    expect(liveModelFor('__proto__')).toBe('__proto__');
    expect(liveModelFor('minimax/minimax-m3:free')).toBe(OPENROUTER_DEFAULT_MODEL);
  });

  it('never exposes the shared default model arrays to callers', () => {
    const first = loadAIProviders(memoryStorage({}));
    first.find((p) => p.id === 'openrouter')!.models.push('pushed-by-a-caller');
    const second = loadAIProviders(memoryStorage({}));
    expect(second.find((p) => p.id === 'openrouter')!.models).not.toContain('pushed-by-a-caller');
  });

  it('ships no retired model ids outside the retirement map', () => {
    // A retired id anywhere else (a provider list, an admin help string, an API
    // handler) is a 404 waiting to happen. The map itself is the one allowed
    // mention, plus the labels in the admin help text and these tests.
    const offenders: string[] = [];
    for (const dir of ['src', 'api', 'worker']) {
      for (const file of sourceFiles(dir)) {
        if (file.includes('__tests__')) continue;
        const text = readFileSync(file, 'utf8');
        for (const retired of Object.keys(RETIRED_MODEL_SLUGS)) {
          if (text.includes(retired) && !file.endsWith(join('features', 'ai', 'providers.ts'))) {
            offenders.push(`${file}: ${retired}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('self-heals a stale all-disabled stored config back to defaults', () => {
    const allDisabled = DEFAULT_AI_PROVIDERS.map((p) => ({ ...p, enabled: false }));
    const providers = loadAIProviders(memoryStorage({ luxedge_ai_providers: JSON.stringify(allDisabled) }));
    expect(providers.some((p) => p.enabled)).toBe(true);
    expect(providers.find((p) => p.id === 'openrouter')?.enabled).toBe(true);
    expect(providers.find((p) => p.isDefault)?.id).toBe('openrouter');
  });
});

describe('scrubLegacySecrets', () => {
  const mem = (initial: Record<string, string>) => {
    const map = new Map(Object.entries(initial));
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
  };

  it('removes the standalone legacy key vault', () => {
    const s = mem({ luxedge_api_keys: JSON.stringify({ scrapedoKey: 'tok-123', openAiKey: 'sk-secret' }) });
    scrubLegacySecrets(s);
    expect(s.getItem('luxedge_api_keys')).toBeNull();
  });

  it('strips apiKey from stored provider config', () => {
    const s = mem({ luxedge_ai_providers: JSON.stringify([{ id: 'openai', name: 'OpenAI', models: ['gpt-4o-mini'], defaultModel: 'gpt-4o-mini', enabled: true, isDefault: true, apiKey: 'sk-leaked' }]) });
    scrubLegacySecrets(s);
    const stored = JSON.parse(s.getItem('luxedge_ai_providers') || '[]');
    expect(JSON.stringify(stored)).not.toContain('sk-leaked');
    expect('apiKey' in stored[0]).toBe(false);
  });

  it('strips legacy secret keys from the luxedge-settings store and rewrites it', () => {
    const s = mem({
      'luxedge-settings': JSON.stringify({ state: { apiKeys: { scrapedoKey: 'tok-1', openAiKey: 'sk-1', openRouterKey: 'sk-2', geminiApiKey: 'ai-3', supabaseUrl: 'https://x.supabase.co' }, storeConfig: { storeName: 'Luxedge' } }, version: 0 }),
    });
    scrubLegacySecrets(s);
    const stored = JSON.parse(s.getItem('luxedge-settings') || '{}');
    const apiKeys = stored.state.apiKeys;
    expect(apiKeys.scrapedoKey).toBeUndefined();
    expect(apiKeys.openAiKey).toBeUndefined();
    expect(apiKeys.openRouterKey).toBeUndefined();
    expect(apiKeys.geminiApiKey).toBeUndefined();
    expect(apiKeys.supabaseUrl).toBe('https://x.supabase.co'); // client-safe fields survive
    expect(JSON.stringify(stored)).not.toContain('sk-1');
    expect(JSON.stringify(stored)).not.toContain('tok-1');
  });

  it('is a no-op when storage is empty or absent', () => {
    const s = mem({});
    expect(() => scrubLegacySecrets(s)).not.toThrow();
    expect(() => scrubLegacySecrets()).not.toThrow();
  });
});

describe('resolveActiveProvider', () => {
  const list: AIProvider[] = [
    { id: 'a', name: 'A', models: [], defaultModel: 'm', enabled: true, isDefault: false },
    { id: 'b', name: 'B', models: [], defaultModel: 'm', enabled: true, isDefault: true },
    { id: 'c', name: 'C', models: [], defaultModel: 'm', enabled: false, isDefault: false },
  ];
  it('prefers the default enabled provider', () => {
    expect(resolveActiveProvider(list)?.id).toBe('b');
  });
  it('falls back to first enabled when no default', () => {
    const noDefault = list.map((p) => ({ ...p, isDefault: false }));
    expect(resolveActiveProvider(noDefault)?.id).toBe('a');
  });
  it('returns null when none enabled', () => {
    expect(resolveActiveProvider(list.map((p) => ({ ...p, enabled: false })))).toBeNull();
  });
});

describe('provider routing settings', () => {
  it('defaults to OpenRouter primary + no paid fallback', () => {
    expect(DEFAULT_PROVIDER_SETTINGS.defaultProviderId).toBe('openrouter');
    expect(DEFAULT_PROVIDER_SETTINGS.fallbackProviderId).toBeNull();
    expect(loadProviderSettings(memoryStorage({}))).toEqual(DEFAULT_PROVIDER_SETTINGS);
  });

  it('migrates the old shipped default chain (deepseek → codex) to openrouter → null', () => {
    const s = memoryStorage({ luxedge_ai_provider_settings: JSON.stringify({ defaultProviderId: 'deepseek', fallbackProviderId: 'codex' }) });
    expect(loadProviderSettings(s)).toEqual({ defaultProviderId: 'openrouter', fallbackProviderId: null });
  });

  it('preserves an explicit owner customization that is not the old shipped default', () => {
    const s = memoryStorage({ luxedge_ai_provider_settings: JSON.stringify({ defaultProviderId: 'anthropic', fallbackProviderId: 'gemini' }) });
    expect(loadProviderSettings(s)).toEqual({ defaultProviderId: 'anthropic', fallbackProviderId: 'gemini' });
  });

  it('round-trips default/fallback and treats empty fallback as null', () => {
    const s = memoryStorage({});
    saveProviderSettings({ defaultProviderId: 'codex', fallbackProviderId: '' }, s);
    expect(loadProviderSettings(s)).toEqual({ defaultProviderId: 'codex', fallbackProviderId: null });
  });

  it('recovers from corrupt storage', () => {
    expect(loadProviderSettings(memoryStorage({ luxedge_ai_provider_settings: '{{{nope' }))).toEqual(DEFAULT_PROVIDER_SETTINGS);
  });

  const providers: AIProvider[] = [
    { id: 'deepseek', name: 'DeepSeek', models: [], defaultModel: 'deepseek-v4-flash', enabled: true, isDefault: false },
    { id: 'codex', name: 'Codex', models: [], defaultModel: 'gpt-5-codex', enabled: true, isDefault: false },
    { id: 'openai', name: 'OpenAI', models: [], defaultModel: 'gpt-4o-mini', enabled: false, isDefault: false },
  ];

  it('resolves the configured primary and fallback', () => {
    const chain = resolveProviderChain(providers, { defaultProviderId: 'deepseek', fallbackProviderId: 'codex' });
    expect(chain.primary?.id).toBe('deepseek');
    expect(chain.fallback?.id).toBe('codex');
  });

  it('ignores a fallback that equals the primary', () => {
    const chain = resolveProviderChain(providers, { defaultProviderId: 'deepseek', fallbackProviderId: 'deepseek' });
    expect(chain.primary?.id).toBe('deepseek');
    expect(chain.fallback).toBeNull();
  });

  it('never selects a disabled provider as primary or fallback', () => {
    const chain = resolveProviderChain(providers, { defaultProviderId: 'openai', fallbackProviderId: 'openai' });
    expect(chain.primary?.id).not.toBe('openai');
    expect(chain.fallback?.id).not.toBe('openai');
  });
});
