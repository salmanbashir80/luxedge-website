// ============================================================================
// LUXEDGE — DATA RUNTIME (backend switch)
//
// Cloudflare bindings are NOT reachable from module scope, and the Worker's
// public-read helpers (worker/sitemap.ts, worker/seo-meta.ts) are called from
// many places without an `env` parameter. The repo already solves this exact
// problem the same way for AdSense OAuth — see setAdSenseRuntimeBindings() in
// worker/index.ts — so the data layer follows that established pattern instead
// of threading `env` through a dozen signatures.
//
// BACKEND SELECTION (explicit, never guessed):
//   DATA_BACKEND=d1 + a DB binding  -> read Cloudflare D1
//   anything else                   -> read Supabase (previous behaviour)
//
// The switch is deliberately explicit rather than "try D1 then fall back":
// a silent fallback would hide a broken D1 migration behind 402-ing Supabase
// and make the cutover impossible to verify.
// ============================================================================

/** Minimal structural view of the D1 binding — no type package required. */
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  /**
   * Required by the commerce layer (worker/d1/commerce.ts): an order insert or
   * an inventory decrement needs the statement's own result, and `meta.changes`
   * is how a conditional `UPDATE ... WHERE inventory_qty >= ?` reports whether
   * it actually took the row — that row count IS the oversell guard.
   */
  run?(): Promise<{ meta?: { changes?: number } } | unknown>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatement;
}

export interface DataRuntimeEnv {
  DB?: D1DatabaseLike;
  DATA_BACKEND?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

export type DataBackend = 'd1' | 'supabase';

export interface DataRuntime {
  backend: DataBackend;
  db: D1DatabaseLike | null;
  supabaseBase: string;
  supabaseAnon: string;
}

/**
 * `env` is typed loosely on purpose: the Worker's Env interface shares no
 * property names with this view (bindings are structurally anonymous there),
 * so a nominal parameter type would be rejected at the call site.
 */
function fromEnv(env: unknown): DataRuntime {
  const e = (env ?? {}) as DataRuntimeEnv;
  const db = (e.DB as D1DatabaseLike | undefined) || null;
  const requested = String(e.DATA_BACKEND || '').trim().toLowerCase();
  const backend: DataBackend = requested === 'd1' && db ? 'd1' : 'supabase';
  const supabaseBase = String(e.VITE_SUPABASE_URL || e.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
    .trim()
    .replace(/\/$/, '');
  const supabaseAnon = String(
    e.VITE_SUPABASE_ANON_KEY || e.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
  ).trim();
  return { backend, db, supabaseBase, supabaseAnon };
}

let runtime: DataRuntime = fromEnv(undefined);

/** Called once per request (and per scheduled run) before any data read. */
export function setDataRuntime(env: unknown): void {
  runtime = fromEnv(env);
}

/** Restores env-derived defaults. Test-only hook — no app code calls this. */
export function resetDataRuntime(env?: unknown): void {
  runtime = fromEnv(env);
}

export function getDataRuntime(): DataRuntime {
  return runtime;
}

/** True when reads must be served from D1. */
export function isD1Backend(): boolean {
  return runtime.backend === 'd1' && runtime.db !== null;
}
