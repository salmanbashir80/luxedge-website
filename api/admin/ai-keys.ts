// GET/POST /api/admin/ai-keys
// Admin-only endpoint to manage owner-attached AI provider keys.
// Cloudflare stores new keys in private D1 ai_provider_keys; legacy Supabase
// app_settings `AI_KEY_<PROVIDER>` keys remain read-only fallbacks.
// (e.g. AI_KEY_DEEPSEEK, AI_KEY_OPENROUTER, AI_KEY_CODEX, AI_KEY_CHATGPT_OAUTH)
// — server-side only, never in the browser. Env vars always win; DB keys are
// the fallback so the owner can attach their own keys without a redeploy.
//
// GET:  { providers: [{ id, name, configured, masked }] }  (masked, never full)
// POST { action: 'set', provider, key }  |  { action: 'clear', provider }
//      |  { action: 'test', provider }
//
// NEVER returns a full key. set/clear never echo the key.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody, PROVIDER_ENV, PROVIDER_NAMES, resolveProviderKey, loadDbProviderKeys, testProvider, rateLimited, clientIp } from '../_lib/providers.js';
import { upsertAppSetting, deleteAppSetting } from '../_lib/supabase.js';
import { requireAdmin } from '../_lib/auth.js';
import { getDataRuntime } from '../../worker/d1/runtime';
import { writeAttachedAiKey, removeAttachedAiKey } from '../_lib/ai-key-store.js';

const DB_KEY_PREFIX = 'AI_KEY_';

/** Provider id → app_settings key name. Codex can use a ChatGPT OAuth token. */
function dbKeyName(provider: string): string {
  if (provider === 'codex') return `${DB_KEY_PREFIX}CODEX`;
  return `${DB_KEY_PREFIX}${provider.toUpperCase()}`;
}

function mask(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function writeDbKey(provider: string, value: string): Promise<boolean> {
  const runtime = getDataRuntime();
  if (runtime.backend === 'd1' && runtime.db) return writeAttachedAiKey(runtime.db, provider, value);
  return upsertAppSetting(dbKeyName(provider), value);
}

function clearDbKey(provider: string): Promise<boolean> {
  const runtime = getDataRuntime();
  if (runtime.backend === 'd1' && runtime.db) return removeAttachedAiKey(runtime.db, provider);
  return deleteAppSetting(dbKeyName(provider));
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (rateLimited(clientIp(req))) {
    sendJson(res, 429, { error: 'Too many requests — slow down.' });
    return;
  }
  if (!(await requireAdmin(req, res))) return;

  if (req.method === 'GET') {
    const db = await loadDbProviderKeys(true);
    const out = Object.keys(PROVIDER_ENV).map((id) => {
      const envKey = !!process.env[PROVIDER_ENV[id]]?.trim();
      const dbVal = id === 'codex' ? (db['CHATGPT_OAUTH'] || db['CODEX'] || '') : (db[id.toUpperCase()] || '');
      return {
        id,
        name: PROVIDER_NAMES[id] || id,
        configured: envKey || !!dbVal,
        source: envKey ? 'env' : dbVal ? 'attached' : 'none',
        masked: envKey ? '•••• (env)' : mask(dbVal),
      };
    });
    sendJson(res, 200, { providers: out });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { error: (e as Error).message });
    return;
  }
  const provider = String(body.provider || '');
  const action = String(body.action || '');
  if (!PROVIDER_ENV[provider]) {
    sendJson(res, 400, { error: `Unknown provider: ${provider}` });
    return;
  }

  if (action === 'set') {
    const key = String(body.key || '').trim();
    if (key.length < 8 || key.length > 8192) {
      sendJson(res, 400, { error: 'Key must contain between 8 and 8192 characters.' });
      return;
    }
    const ok = await writeDbKey(provider, key);
    if (!ok) {
      sendJson(res, 502, { error: 'Could not save the key to the private server store. Existing keys are unchanged.' });
      return;
    }
    await loadDbProviderKeys(true); // refresh cache so the next generate sees it
    sendJson(res, 200, { ok: true, configured: true, masked: mask(key) });
    return;
  }

  if (action === 'clear') {
    await clearDbKey(provider);
    await loadDbProviderKeys(true);
    const stillEnv = !!process.env[PROVIDER_ENV[provider]]?.trim();
    sendJson(res, 200, { ok: true, configured: stillEnv, masked: stillEnv ? '•••• (env)' : '' });
    return;
  }

  if (action === 'test') {
    const model = typeof body.model === 'string' && body.model ? String(body.model) : undefined;
    // Test the attached key directly even when env is unset.
    const attached = await resolveProviderKey(provider);
    if (!attached) {
      sendJson(res, 200, { ok: false, message: 'Not configured — attach a key first.' });
      return;
    }
    const result = await testProvider(provider, model);
    sendJson(res, 200, result);
    return;
  }

  sendJson(res, 400, { error: 'action must be set, clear or test' });
}
