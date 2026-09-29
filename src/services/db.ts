// ============================================================================
// LUXEDGE V2 — DATA LAYER BOUNDARY
//
// Single interface for persistence. Today the app persists to localStorage
// (matching current behavior); when a Supabase project is configured via
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, the same calls route to
// Supabase's PostgREST API (no SDK dependency required).
//
// The schema the Supabase adapter expects is defined in
// supabase/migrations/0001_initial_schema.sql.
//
// SECURITY: this module never holds secrets. Supabase anon key is client-safe
// by design (RLS protects the tables); the service-role key stays server-side.
// ============================================================================

import { getSession } from './supabase';

export type DbMode = 'local' | 'supabase' | 'd1' | 'unconfigured';

/**
 * True when a REMOTE database backs the app (Supabase or Cloudflare D1), as
 * opposed to localStorage/unconfigured. Callers that only need "is there a
 * real storefront database?" must use this instead of comparing to 'supabase'
 * directly, or they silently stop working the moment the backend flips to D1.
 */
export function isRemoteDb(): boolean {
  const mode = getDbMode();
  return mode === 'supabase' || mode === 'd1';
}

export interface DbConnectionResult {
  ok: boolean;
  mode: DbMode;
  detail?: string;
}

export interface DbListOptions {
  select?: string;
  orderBy?: string;
  limit?: number;
  filters?: Record<string, string>;
  /** Raw filter expressions passed through verbatim (e.g. `url=not.like.data:*`). */
  rawFilters?: Record<string, string>;
}

export interface DbAdapter {
  mode: DbMode;
  list<T>(table: string, opts?: DbListOptions): Promise<T[]>;
  get<T>(table: string, id: string): Promise<T | null>;
  /** First row matching `column = value`, or null. Used for identity lookups. */
  findFirst<T>(table: string, column: string, value: string): Promise<T | null>;
  insert<T extends { id: string }>(table: string, row: T): Promise<T>;
  /** Insert a row whose PK is NOT `id` (e.g. store_settings.key). */
  insertRaw<T>(table: string, row: T): Promise<T>;
  update<T extends { id: string }>(table: string, id: string, patch: Partial<T>): Promise<T | null>;
  /** Update the first row where `column = value` (tables whose PK is not `id`). */
  updateBy<T>(table: string, column: string, value: string, patch: Partial<T>): Promise<T | null>;
  remove(table: string, id: string): Promise<void>;
  /** Honest connectivity check — never claims success it cannot prove. */
  testConnection(): Promise<DbConnectionResult>;
}

const KEY_PREFIX = 'luxedge_db_v2';

// ---------------------------------------------------------------------------
// Local storage adapter (current behavior)
// ---------------------------------------------------------------------------
export class LocalStorageAdapter implements DbAdapter {
  readonly mode: DbMode = 'local';
  private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

  constructor(storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
    this.storage = storage || (typeof window !== 'undefined' ? window.localStorage : nullStorage);
  }

  private tableKey(table: string): string {
    return `${KEY_PREFIX}:${table}`;
  }

  private readTable<T>(table: string): T[] {
    try {
      const raw = this.storage.getItem(this.tableKey(table));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  private writeTable<T>(table: string, rows: T[]): void {
    this.storage.setItem(this.tableKey(table), JSON.stringify(rows));
  }

  async list<T>(table: string, opts?: { select?: string; filters?: Record<string, string>; rawFilters?: Record<string, string> }): Promise<T[]> {
    let rows = this.readTable<T>(table);
    if (opts?.filters) {
      for (const [key, value] of Object.entries(opts.filters)) {
        rows = rows.filter((r) => (r as Record<string, unknown>)[key] === value);
      }
    }
    if (opts?.rawFilters) {
      // Local adapter mirrors the minimal PostgREST operators the storefront
      // uses: `not.like.<prefix>*` → drop rows whose value starts with prefix.
      for (const [key, expr] of Object.entries(opts.rawFilters)) {
        const m = /^not\.like\.(.+)\*$/.exec(expr);
        if (!m) continue;
        const prefix = m[1];
        rows = rows.filter((r) => {
          const v = (r as Record<string, unknown>)[key];
          return typeof v === 'string' && !v.startsWith(prefix);
        });
      }
    }
    return rows;
  }

  async get<T>(table: string, id: string): Promise<T | null> {
    const rows = this.readTable<{ id: string } & T>(table);
    return rows.find((r) => r.id === id) || null;
  }

  async findFirst<T>(table: string, column: string, value: string): Promise<T | null> {
    const rows = this.readTable<Record<string, unknown> & T>(table);
    const hit = rows.find((r) => r[column] === value);
    return hit || null;
  }

  async insert<T extends { id: string }>(table: string, row: T): Promise<T> {
    const rows = this.readTable<T>(table);
    rows.push(row);
    this.writeTable(table, rows);
    return row;
  }

  async insertRaw<T>(table: string, row: T): Promise<T> {
    const rows = this.readTable<T>(table);
    rows.push(row);
    this.writeTable(table, rows);
    return row;
  }

  async update<T extends { id: string }>(table: string, id: string, patch: Partial<T>): Promise<T | null> {
    return this.updateBy(table, 'id', id, patch);
  }

  async updateBy<T>(table: string, column: string, value: string, patch: Partial<T>): Promise<T | null> {
    const rows = this.readTable<T>(table);
    const idx = rows.findIndex((r) => (r as Record<string, unknown>)[column] === value);
    if (idx < 0) return null;
    rows[idx] = { ...rows[idx], ...patch } as T;
    this.writeTable(table, rows);
    return rows[idx];
  }

  async remove(table: string, id: string): Promise<void> {
    const rows = this.readTable<{ id: string }>(table);
    this.writeTable(table, rows.filter((r) => r.id !== id));
  }

  async testConnection(): Promise<DbConnectionResult> {
    return { ok: true, mode: 'local', detail: 'localStorage adapter (active)' };
  }
}

const nullStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

// ---------------------------------------------------------------------------
// Supabase adapter (PostgREST over fetch — activates only when configured)
// ---------------------------------------------------------------------------
export class SupabaseAdapter implements DbAdapter {
  readonly mode: DbMode = 'supabase';
  private url: string;
  private anonKey: string;
  /** Signed-in user's access token — used (when present) instead of the anon key. */
  private accessToken: string | null = null;

  constructor(url: string, anonKey: string) {
    this.url = url.replace(/\/$/, '');
    this.anonKey = anonKey;
  }

  /**
   * Use the signed-in user's JWT for requests (RLS then sees their role).
   * The token is the caller's own session token, never a secret we mint.
   */
  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  private endpoint(table: string, id?: string): string {
    return `${this.url}/rest/v1/${table}${id ? `?id=eq.${encodeURIComponent(id)}` : ''}`;
  }

  private headers(_method: string): Record<string, string> {
    // New-style Supabase keys: the publishable/anon key goes in the `apikey`
    // header ONLY (sending it as a Bearer token is rejected). A signed-in
    // user's access token is added as the Bearer token so RLS sees their
    // role; without it the request runs as the public anon role.
    const h: Record<string, string> = {
      apikey: this.anonKey,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };
    if (this.accessToken) h.Authorization = `Bearer ${this.accessToken}`;
    return h;
  }

  private async handle<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  /**
   * Expired-token recovery (Supabase PGRST303 "JWT expired"): a long-open
   * admin page's access token can expire mid-session. Refresh the GoTrue
   * session once and retry — the caller never sees a bogus expiry failure
   * and no page reload is required. Only fires when a user token is set.
   */
  private async request(url: string, init: { method?: string; body?: string } = {}): Promise<Response> {
    const attempt = () => fetch(url, { ...init, headers: this.headers(init.method || 'GET') });
    let res = await attempt();
    if (res.status === 401 && this.accessToken) {
      // Force-refresh: the token may have been invalidated server-side while
      // its local expiresAt still looked valid (new sign-in elsewhere, session
      // rotation). The clock-based getSession() guard alone would return the
      // same rejected token and the caller would see a bogus 401.
      const session = await getSession(true);
      const fresh = session?.accessToken || null;
      if (fresh && fresh !== this.accessToken) {
        this.accessToken = fresh;
        res = await attempt();
      }
    }
    return res;
  }

  async list<T>(table: string, opts?: DbListOptions): Promise<T[]> {
    const url = new URL(this.endpoint(table));
    if (opts?.select) url.searchParams.set('select', opts.select);
    if (opts?.orderBy) url.searchParams.set('order', opts.orderBy);
    if (opts?.limit) url.searchParams.set('limit', String(opts.limit));
    if (opts?.filters) {
      for (const [key, value] of Object.entries(opts.filters)) url.searchParams.append(key, `eq.${value}`);
    }
    if (opts?.rawFilters) {
      for (const [key, expr] of Object.entries(opts.rawFilters)) url.searchParams.append(key, expr);
    }
    const res = await this.request(url.toString());
    const rows = await this.handle<T[]>(res);
    return Array.isArray(rows) ? rows : [];
  }

  async get<T>(table: string, id: string): Promise<T | null> {
    const res = await this.request(this.endpoint(table, id));
    const rows = await this.handle<T[]>(res);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  async findFirst<T>(table: string, column: string, value: string): Promise<T | null> {
    const url = new URL(this.endpoint(table));
    url.searchParams.append(column, `eq.${value}`);
    const res = await this.request(url.toString());
    const rows = await this.handle<T[]>(res);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  async insert<T extends { id: string }>(table: string, row: T): Promise<T> {
    const res = await this.request(this.endpoint(table), { method: 'POST', body: JSON.stringify(row) });
    const rows = await this.handle<T[]>(res);
    return rows[0] || row;
  }

  async insertRaw<T>(table: string, row: T): Promise<T> {
    const res = await this.request(this.endpoint(table), { method: 'POST', body: JSON.stringify(row) });
    const rows = await this.handle<T[]>(res);
    return rows[0] || row;
  }

  async update<T extends { id: string }>(table: string, id: string, patch: Partial<T>): Promise<T | null> {
    return this.updateBy(table, 'id', id, patch);
  }

  async updateBy<T>(table: string, column: string, value: string, patch: Partial<T>): Promise<T | null> {
    const url = new URL(this.endpoint(table));
    url.searchParams.append(column, `eq.${value}`);
    const res = await this.request(url.toString(), { method: 'PATCH', body: JSON.stringify(patch) });
    const rows = await this.handle<T[]>(res);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  async remove(table: string, id: string): Promise<void> {
    await this.request(this.endpoint(table, id), { method: 'DELETE' });
  }

  /**
   * Real connectivity probe: reads one published category through the anon
   * key exactly like the storefront does. Returns ok:false (no silent
   * fallback to localStorage) when Supabase is configured but unreachable.
   */
  async testConnection(): Promise<DbConnectionResult> {
    try {
      // Connectivity probe is an ANON read — strip any (possibly expired)
      // user token so an old JWT can never misreport the store as down.
      const headers = this.headers('GET');
      delete headers.Authorization;
      const res = await fetch(this.endpoint('categories') + '?limit=1', {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, mode: 'supabase', detail: `Supabase HTTP ${res.status}: ${text.slice(0, 120)}` };
      }
      return { ok: true, mode: 'supabase', detail: 'Supabase reachable (anon read OK)' };
    } catch (e) {
      return { ok: false, mode: 'supabase', detail: (e as Error).message || 'Supabase unreachable' };
    }
  }
}

// ---------------------------------------------------------------------------
// Cloudflare D1 adapter (same-origin Worker data API)
// ---------------------------------------------------------------------------
/**
 * Reads the storefront through the Worker's allowlisted /api/db route, which
 * serves Cloudflare D1 (see worker/db-api.ts). Same-origin, no SDK, no key in
 * the browser bundle — and it replaces the direct browser→Supabase PostgREST
 * calls that broke when Supabase began returning HTTP 402.
 *
 * READS ONLY. /api/db implements SELECTs exclusively, so the mutating methods
 * throw a clear error instead of pretending to succeed: mutations must go
 * through a server-authorized route, which is a separate (PHASE 8) migration.
 * A thrown error here is honest — every caller already handles a failed remote
 * read by degrading (empty storefront / safe defaults), never by inventing data.
 */
export class WorkerDbAdapter implements DbAdapter {
  readonly mode: DbMode = 'd1';
  private base: string;

  constructor(base = '/api/db') {
    this.base = base.replace(/\/$/, '');
  }

  private url(table: string, opts?: DbListOptions): string {
    const params = new URLSearchParams();
    if (opts?.select) params.set('select', opts.select);
    if (opts?.orderBy) params.set('order', opts.orderBy);
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.filters) {
      for (const [key, value] of Object.entries(opts.filters)) params.append(key, `eq.${value}`);
    }
    if (opts?.rawFilters) {
      for (const [key, expr] of Object.entries(opts.rawFilters)) params.append(key, expr);
    }
    const qs = params.toString();
    return `${this.base}/${encodeURIComponent(table)}${qs ? `?${qs}` : ''}`;
  }

  private async read<T>(url: string): Promise<T[]> {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`D1 API ${res.status}: ${text.slice(0, 200)}`);
    }
    const rows = (await res.json()) as T[];
    return Array.isArray(rows) ? rows : [];
  }

  async list<T>(table: string, opts?: DbListOptions): Promise<T[]> {
    return this.read<T>(this.url(table, opts));
  }

  async get<T>(table: string, id: string): Promise<T | null> {
    const rows = await this.read<T>(this.url(table, { filters: { id }, limit: 1 }));
    return rows.length ? rows[0] : null;
  }

  async findFirst<T>(table: string, column: string, value: string): Promise<T | null> {
    const rows = await this.read<T>(this.url(table, { filters: { [column]: value }, limit: 1 }));
    return rows.length ? rows[0] : null;
  }

  private readOnly(operation: string): never {
    throw new Error(
      `D1 adapter is read-only (${operation} on ${this.base}). Public reads are migrated; authorized writes are not yet.`,
    );
  }

  async insert<T extends { id: string }>(_table: string, _row: T): Promise<T> {
    return this.readOnly('insert');
  }

  async insertRaw<T>(_table: string, _row: T): Promise<T> {
    return this.readOnly('insertRaw');
  }

  async update<T extends { id: string }>(_table: string, _id: string, _patch: Partial<T>): Promise<T | null> {
    return this.readOnly('update');
  }

  async updateBy<T>(_table: string, _column: string, _value: string, _patch: Partial<T>): Promise<T | null> {
    return this.readOnly('updateBy');
  }

  async remove(_table: string, _id: string): Promise<void> {
    this.readOnly('remove');
  }

  /** Real probe: reads one public row through the Worker the way the store does. */
  async testConnection(): Promise<DbConnectionResult> {
    try {
      const res = await fetch(this.url('categories', { select: 'id', limit: 1 }));
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, mode: 'd1', detail: `D1 API HTTP ${res.status}: ${text.slice(0, 120)}` };
      }
      return { ok: true, mode: 'd1', detail: 'Cloudflare D1 reachable (/api/db)' };
    } catch (e) {
      return { ok: false, mode: 'd1', detail: (e as Error).message || 'D1 API unreachable' };
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
let dbConfigOverride: { url: string; anonKey: string } | null | undefined = undefined;

/**
 * Test-only hook: override resolved config (null = unconfigured, undefined =
 * restore real env resolution). Never called by app code.
 */
export function __setDbConfigForTests(config: { url: string; anonKey: string } | null | undefined): void {
  dbConfigOverride = config;
}

export function resolveDbConfig(): { url: string; anonKey: string } | null {
  if (dbConfigOverride !== undefined) return dbConfigOverride;
  const url = (import.meta as { env?: Record<string, string> }).env?.VITE_SUPABASE_URL || '';
  const anonKey = (import.meta as { env?: Record<string, string> }).env?.VITE_SUPABASE_ANON_KEY || '';
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/**
 * Which data backend the storefront should use.
 *   VITE_DATA_BACKEND=d1  -> Cloudflare D1 via the same-origin Worker API
 *   anything else         -> Supabase (previous behaviour, unchanged default)
 * Opt-in and explicit: the switch is a build/deploy decision that must be
 * visible, not something inferred at runtime.
 */
export function resolveDataBackend(): 'd1' | 'supabase' {
  const requested = String(
    (import.meta as { env?: Record<string, string> }).env?.VITE_DATA_BACKEND || '',
  ).trim().toLowerCase();
  return requested === 'd1' ? 'd1' : 'supabase';
}

let cachedAdapter: DbAdapter | null = null;

/**
 * Returns the active adapter: D1 when selected, else Supabase when configured,
 * else localStorage.
 */
export function getDb(): DbAdapter {
  if (cachedAdapter) return cachedAdapter;
  if (resolveDataBackend() === 'd1') {
    cachedAdapter = new WorkerDbAdapter();
    return cachedAdapter;
  }
  const cfg = resolveDbConfig();
  cachedAdapter = cfg ? new SupabaseAdapter(cfg.url, cfg.anonKey) : new LocalStorageAdapter();
  return cachedAdapter;
}

/** Which persistence mode is active — used for honest UI status. */
export function getDbMode(): DbMode {
  if (resolveDataBackend() === 'd1') return 'd1';
  return resolveDbConfig() ? 'supabase' : 'local';
}

export function resetDbForTests(): void {
  cachedAdapter = null;
}
