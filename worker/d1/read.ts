// ============================================================================
// LUXEDGE — PUBLIC READ ENTRY POINT
//
// ONE function serves every public read path in the Worker. Callers keep passing
// the exact PostgREST path string they always did (see query.ts for why), so the
// only change in worker/sitemap.ts and worker/seo-meta.ts is which helper they
// call — their queries, select constants and eligibility rules are untouched.
//
// FAILURE CONTRACT (unchanged from before the migration): returns `null` on any
// failure, never a partial or invented result. Every caller already treats null
// as "database unavailable" and responds honestly — the sitemap fails open to
// the minimal emergency feed rather than republishing stale URLs.
//
// A path the D1 layer does not support also returns null. That is deliberate:
// silently returning [] would present "no rows" as a data fact and could empty
// the storefront without any error surfacing.
// ============================================================================

import { buildStatement, coerceRow } from './query';
import { getDataRuntime, isD1Backend } from './runtime';

const SUPABASE_TIMEOUT_MS = 12_000;

/**
 * Reads one PostgREST path. Returns rows, or null when the data source cannot
 * answer truthfully.
 */
export async function readPostgrestPath<T = Record<string, unknown>>(path: string): Promise<T[] | null> {
  const rt = getDataRuntime();

  if (isD1Backend() && rt.db) {
    const built = buildStatement(path);
    if (!built) return null;
    try {
      const res = await rt.db.prepare(built.sql).bind(...built.params).all<Record<string, unknown>>();
      const rows = Array.isArray(res?.results) ? res.results : [];
      return rows.map((row) => coerceRow(built.parsed.table, row)) as T[];
    } catch {
      return null;
    }
  }

  // Previous behaviour: Supabase PostgREST with the anon key.
  const { supabaseBase, supabaseAnon } = rt;
  if (!supabaseBase || !supabaseAnon) return null;
  try {
    const res = await fetch(`${supabaseBase}/rest/v1/${path}`, {
      headers: { apikey: supabaseAnon, Authorization: `Bearer ${supabaseAnon}` },
      signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    const parsed = JSON.parse(text) as T[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Single-row convenience for `findFirst`-style reads. */
export async function readFirst<T = Record<string, unknown>>(path: string): Promise<T | null> {
  const rows = await readPostgrestPath<T>(path);
  return rows && rows.length ? rows[0] : null;
}
