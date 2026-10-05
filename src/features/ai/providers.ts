// ============================================================================
// LUXEDGE V2 — AI PROVIDER REGISTRY
//
// Client-side provider *configuration* (id, name, models, enabled, default).
// API keys are intentionally NOT part of this model — they are read from
// server-side environment variables by /api/ai/* serverless functions.
//
// sanitizeProvider scrubs any legacy apiKey that older versions may have
// persisted in localStorage, so secrets are actively removed from the client.
// ============================================================================

import type { AIProvider } from './types';

// Default provider is OpenRouter (free tier — no credits needed); DeepSeek is
// enabled because it is a common server-side key; Codex is available on demand
// (enable it as default/fallback in AI Hub when its CODEX_API_KEY or
// CHATGPT_OAUTH_TOKEN is configured on the server).
// This matches DEFAULT_PROVIDER_SETTINGS (openrouter → deepseek).
//
// Every OpenRouter id below was checked against GET
// https://openrouter.ai/api/v1/models. Keep it to ids that endpoint actually
// returns: OpenRouter retires `:free` ids without notice, and a retired id
// fails the whole request with HTTP 404 instead of degrading gracefully.
export const OPENROUTER_DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';

/**
 * Model ids upstream providers have RETIRED, mapped to a live replacement.
 *
 * A browser that saved one of these as its default would keep sending a dead id
 * after every deploy, so `loadAIProviders` rewrites it on load. The server
 * heals the same failure on its own side (see `generateWithFallback`), so this
 * map is about keeping the UI and the stored config honest rather than keeping
 * requests working. Add an entry whenever a provider drops a model.
 */
export const RETIRED_MODEL_SLUGS: Record<string, string> = {
  'minimax/minimax-m3:free': OPENROUTER_DEFAULT_MODEL,
};

/**
 * Replace a retired model id with its live replacement, or return it unchanged.
 *
 * The own-property check is load-bearing: `defaultModel` comes from storage a
 * user can edit, and a plain `RETIRED_MODEL_SLUGS[model]` lookup would resolve
 * "toString" / "constructor" to an Object.prototype FUNCTION and assign that as
 * a model id. Only a non-empty string may ever be substituted.
 */
export function liveModelFor(model: string): string {
  if (!Object.prototype.hasOwnProperty.call(RETIRED_MODEL_SLUGS, model)) return model;
  const replacement = RETIRED_MODEL_SLUGS[model];
  return typeof replacement === 'string' && replacement ? replacement : model;
}

export const DEFAULT_AI_PROVIDERS: AIProvider[] = [
  { id: 'openrouter', name: 'OpenRouter (Multi-Model)', models: [OPENROUTER_DEFAULT_MODEL, 'nvidia/nemotron-3.5-lightning:free', 'google/gemma-4-31b-it:free', 'cohere/north-mini-code:free', 'openrouter/free'], defaultModel: OPENROUTER_DEFAULT_MODEL, enabled: true, isDefault: true },
  { id: 'deepseek', name: 'DeepSeek (Fast & Smart)', models: ['deepseek-chat', 'deepseek-reasoner'], defaultModel: 'deepseek-chat', enabled: true, isDefault: false },
  { id: 'gemini', name: 'Google Gemini (Flash)', models: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'], defaultModel: 'gemini-2.5-flash', enabled: true, isDefault: false },
  { id: 'openai', name: 'OpenAI', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'], defaultModel: 'gpt-4o-mini', enabled: false, isDefault: false },
  { id: 'anthropic', name: 'Anthropic Claude', models: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'], defaultModel: 'claude-haiku-4-5-20251001', enabled: false, isDefault: false },
  { id: 'codex', name: 'OpenAI Codex', models: ['gpt-5-codex', 'codex-mini-latest'], defaultModel: 'gpt-5-codex', enabled: true, isDefault: false },
];

const PROVIDER_IDS = new Set(DEFAULT_AI_PROVIDERS.map((p) => p.id));

/** Fresh copy of the shipped defaults — never hand out the shared `models` array. */
function defaultProviders(): AIProvider[] {
  return DEFAULT_AI_PROVIDERS.map((p) => ({ ...p, models: [...p.models] }));
}

/** Strip any secret fields (e.g. legacy apiKey) from a provider object. */
export function sanitizeProvider(p: Partial<AIProvider> & Record<string, unknown>): AIProvider {
  const { apiKey: _legacy, ...rest } = p as AIProvider & { apiKey?: string };
  const def = DEFAULT_AI_PROVIDERS.find((d) => d.id === rest.id) || DEFAULT_AI_PROVIDERS[0];
  return {
    id: rest.id || def.id,
    name: rest.name || def.name,
    models: Array.isArray(rest.models) && rest.models.length ? rest.models : def.models,
    defaultModel: rest.defaultModel || def.defaultModel,
    enabled: rest.enabled !== false,
    isDefault: !!rest.isDefault,
  };
}

/** Load provider configuration from localStorage, scrubbing any legacy keys. */
export function loadAIProviders(storage?: Pick<Storage, 'getItem'>): AIProvider[] {
  try {
    const raw = (storage || window.localStorage).getItem('luxedge_ai_providers');
    if (!raw) return defaultProviders();
    const stored = JSON.parse(raw);
    if (!Array.isArray(stored)) return defaultProviders();
    const merged: AIProvider[] = stored.map((p) => sanitizeProvider(p || {}));
    for (const def of DEFAULT_AI_PROVIDERS) {
      if (!merged.some((p) => p.id === def.id)) merged.push({ ...def, models: [...def.models] });
    }
    // Heal retired model ids saved by an older build. Without this a stored
    // config keeps a dead slug forever, because stored values win over shipped
    // defaults — the exact way AI SEO broke when OpenRouter retired a model.
    for (const p of merged) {
      p.defaultModel = liveModelFor(p.defaultModel);
      p.models = Array.from(new Set(p.models.map((m) => liveModelFor(m))));
      // A model that is not in its own dropdown would render as a blank select.
      if (!p.models.includes(p.defaultModel)) p.models.push(p.defaultModel);
    }
    // Preserve an owner's marked provider. Changing models for retired IDs
    // above is safe; silently changing their provider is not.
    const markedDefault = merged.find((p) => p.isDefault);
    if (markedDefault) merged.forEach((p) => { p.isDefault = p.id === markedDefault.id; });
    // Self-healing: a stale all-disabled config (e.g. from an old save) must
    // never leave the import flow without a provider. The SERVER decides which
    // providers actually have keys; client toggles only affect routing.
    if (!merged.some((p) => p.enabled)) return defaultProviders();
    return merged;
  } catch {
    return defaultProviders();
  }
}

/** Persist provider configuration (never contains keys). */
export function saveAIProviders(providers: AIProvider[], storage?: Pick<Storage, 'setItem'>): void {
  const clean = providers.map((p) => sanitizeProvider(p as AIProvider & Record<string, unknown>));
  (storage || window.localStorage).setItem('luxedge_ai_providers', JSON.stringify(clean));
}

/** Resolve the active provider from a list, preferring the default. */
export function resolveActiveProvider(providers: AIProvider[]): AIProvider | null {
  const active = providers.filter((p) => p.enabled);
  if (!active.length) return null;
  return active.find((p) => p.isDefault) || active[0];
}

// ---------------------------------------------------------------------------
// Provider routing settings (default + fallback). Keys are never stored here.
// ---------------------------------------------------------------------------

export interface AIProviderSettings {
  defaultProviderId: string;
  fallbackProviderId: string | null;
}

export const DEFAULT_PROVIDER_SETTINGS: AIProviderSettings = {
  defaultProviderId: 'openrouter',
  fallbackProviderId: null,
};

const PROVIDER_SETTINGS_KEY = 'luxedge_ai_provider_settings';

/** Load the default/fallback routing settings (no secrets). */
export function loadProviderSettings(storage?: Pick<Storage, 'getItem'>): AIProviderSettings {
  try {
    const raw = (storage || (typeof window !== 'undefined' ? window.localStorage : null))?.getItem(PROVIDER_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_PROVIDER_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AIProviderSettings>;
    // Migrate the previous shipped default chain (deepseek → codex) to the new
    // default chain (openrouter → deepseek). Explicit owner customizations are
    // preserved — only the exact old shipped default is rewritten.
    const isOldShippedDefault = parsed.defaultProviderId === 'deepseek' && parsed.fallbackProviderId === 'codex';
    return {
      defaultProviderId: isOldShippedDefault
        ? DEFAULT_PROVIDER_SETTINGS.defaultProviderId
        : typeof parsed.defaultProviderId === 'string' && parsed.defaultProviderId ? parsed.defaultProviderId : DEFAULT_PROVIDER_SETTINGS.defaultProviderId,
      fallbackProviderId: isOldShippedDefault
        ? DEFAULT_PROVIDER_SETTINGS.fallbackProviderId
        : typeof parsed.fallbackProviderId === 'string' && parsed.fallbackProviderId ? parsed.fallbackProviderId : null,
    };
  } catch {
    return { ...DEFAULT_PROVIDER_SETTINGS };
  }
}

/** Persist the default/fallback routing settings (no secrets). */
export function saveProviderSettings(settings: AIProviderSettings, storage?: Pick<Storage, 'setItem'>): void {
  (storage || (typeof window !== 'undefined' ? window.localStorage : null))?.setItem(
    PROVIDER_SETTINGS_KEY,
    JSON.stringify({ defaultProviderId: settings.defaultProviderId, fallbackProviderId: settings.fallbackProviderId || null }),
  );
}

/** Resolve the primary + fallback providers from the enabled list + routing settings. */
export function resolveProviderChain(
  providers: AIProvider[],
  settings: AIProviderSettings,
): { primary: AIProvider | null; fallback: AIProvider | null } {
  const enabled = providers.filter((p) => p.enabled);
  const find = (id: string | null) => (id ? enabled.find((p) => p.id === id) || null : null);
  let primary = find(settings.defaultProviderId);
  if (!primary) primary = enabled.find((p) => p.isDefault) || enabled[0] || null;
  let fallback = find(settings.fallbackProviderId);
  if (fallback && fallback.id === primary?.id) fallback = null;
  return { primary, fallback };
}

export function isKnownProviderId(id: string): boolean {
  return PROVIDER_IDS.has(id);
}

/**
 * Proactively remove legacy secrets from localStorage (runs once at startup).
 * Older Luxedge builds persisted provider keys + scraping tokens in
 * `luxedge_ai_providers`, `luxedge_api_keys` and the `luxedge-settings` store.
 * This scrubs them so no credential lingers in the browser.
 */
export function scrubLegacySecrets(storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): void {
  const s = storage || (typeof window !== 'undefined' ? window.localStorage : null);
  if (!s) return;

  // 1) Standalone legacy key vault (scrapedoKey + provider keys).
  try {
    if (s.getItem('luxedge_api_keys')) s.removeItem('luxedge_api_keys');
  } catch { /* ignore */ }

  // 2) Provider config may carry a legacy `apiKey` field.
  try {
    const raw = s.getItem('luxedge_ai_providers');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const clean = parsed.map((p) => sanitizeProvider(p || {}));
        s.setItem('luxedge_ai_providers', JSON.stringify(clean));
      }
    }
  } catch { /* ignore */ }

  // 3) The old settings store held secrets inside apiKeys (scrapedoKey,
  //    scraperApiKey, openAiKey, openRouterKey, geminiApiKey). Strip them and
  //    rewrite the stored JSON so they cannot be re-merged on next load.
  const LEGACY_SETTING_KEYS = ['scrapedoKey', 'scraperApiKey', 'openAiKey', 'openRouterKey', 'geminiApiKey'] as const;
  try {
    const raw = s.getItem('luxedge-settings');
    if (raw) {
      const parsed = JSON.parse(raw);
      const apiKeys = parsed?.state?.apiKeys;
      if (apiKeys && typeof apiKeys === 'object') {
        let changed = false;
        for (const k of LEGACY_SETTING_KEYS) {
          if (k in apiKeys) { delete apiKeys[k]; changed = true; }
        }
        if (changed) s.setItem('luxedge-settings', JSON.stringify(parsed));
      }
    }
  } catch { /* ignore */ }
}
