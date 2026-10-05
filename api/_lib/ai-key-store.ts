// Server-only owner-attached AI keys. This table is NOT exposed by /api/db or
// /api/admin/db. Access is through the existing requireAdmin-protected AI Hub.
// Deployment bindings retain priority; this never modifies those bindings.
import type { D1DatabaseLike } from '../../worker/d1/runtime';

export async function readAttachedAiKeys(db: D1DatabaseLike): Promise<Record<string, string>> {
  try {
    const rows = await db.prepare('SELECT provider, value FROM ai_provider_keys LIMIT 20').all<{ provider: string; value: string }>();
    return Object.fromEntries((rows.results || []).filter(r => typeof r.provider === 'string' && typeof r.value === 'string' && r.value.trim())
      .map(r => [r.provider.toUpperCase(), r.value.trim()]));
  } catch { return {}; } // before the isolated table migration: existing env keys still work
}

export async function writeAttachedAiKey(db: D1DatabaseLike, provider: string, value: string): Promise<boolean> {
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(provider) || value.length < 8 || value.length > 8192) return false;
  try {
    const statement = db.prepare('INSERT INTO ai_provider_keys (provider, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(provider) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .bind(provider, value, new Date().toISOString());
    if (!statement.run) return false;
    await statement.run();
    const rows = await db.prepare('SELECT value FROM ai_provider_keys WHERE provider = ? LIMIT 1').bind(provider).all<{ value: string }>();
    return rows.results?.[0]?.value === value;
  } catch { return false; } // never put a SQL error or bound credential into logs/responses
}

export async function removeAttachedAiKey(db: D1DatabaseLike, provider: string): Promise<boolean> {
  try {
    const statement = db.prepare('DELETE FROM ai_provider_keys WHERE provider = ?').bind(provider);
    if (!statement.run) return false;
    await statement.run();
    return true;
  } catch { return false; }
}
