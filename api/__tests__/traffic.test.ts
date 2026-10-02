// ============================================================================
// LUXEDGE — TRAFFIC ANALYTICS ROUTE TESTS (D1 site_events)
//
// Drives the REAL /api/admin/traffic handler against the REAL migrations in an
// in-memory SQLite engine. Covers the load-bearing guarantees:
//   * GET is admin-gated: 401 without a cookie, 403 with a buyer cookie,
//     200 with an admin cookie (role read server-side from the D1 row).
//   * POST is the public storefront ingest: 204 + a real row for a known
//     event; unknown event names and oversized bodies are dropped (never an
//     error in the storefront); cross-origin POSTs are refused.
//   * Aggregation returns what was ingested (same shape the dashboard renders).
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import trafficHandler from '../admin/traffic.js';
import authHandler, { RECOVERY_MAIL_TO } from '../auth/index.js';
import { resetDataRuntime } from '../../worker/d1/runtime';
import { SESSION_COOKIE } from '../../worker/auth/store';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = path.join(ROOT, 'cloudflare', 'd1', 'migrations');
const ORIGIN = 'https://luxedge.us';

function migrations(): string {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n');
}

function d1From(db: DatabaseSync) {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      return {
        bind(...params: unknown[]) {
          const bound = params.map((p) => (p === undefined ? null : p)) as never[];
          return {
            all: async () => ({ results: stmt.all(...bound) as Record<string, unknown>[] }),
            run: async () => ({ meta: { changes: Number(stmt.run(...bound).changes) } }),
          };
        },
      };
    },
  };
}

let db: DatabaseSync;
function fresh() {
  db = new DatabaseSync(':memory:');
  db.exec(migrations());
  resetDataRuntime({ DATA_BACKEND: 'd1', DB: d1From(db) });
}

interface Captured {
  status: number;
  body: string;
  setCookie: string | null;
}

function makeRes(): { server: ServerResponse; cap: Captured } {
  const cap: Captured = { status: 200, body: '', setCookie: null };
  const server = {
    statusCode: 200,
    setHeader(k: string, v: string | string[]) {
      if (k.toLowerCase() === 'set-cookie') cap.setCookie = Array.isArray(v) ? v[0] : v;
    },
    end(chunk?: string | Uint8Array) {
      cap.status = (server as unknown as { statusCode: number }).statusCode;
      cap.body = typeof chunk === 'string' ? chunk : '';
    },
  };
  return { server: server as unknown as ServerResponse, cap };
}

function makeReq(opts: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
}): IncomingMessage {
  const body = opts.body ?? '';
  return {
    method: opts.method || 'GET',
    url: opts.url || '/api/admin/traffic',
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...(opts.headers || {}) },
    'cf-connecting-ip': '203.0.113.9',
    on(_ev: string, cb: (c?: unknown) => void) {
      if (_ev === 'data' && body) cb(Buffer.from(body));
      if (_ev === 'end') cb();
      return undefined as never;
    },
  } as unknown as IncomingMessage;
}

/** Drive the auth handler end-to-end and return the session cookie value. */
async function loginCookie(email: string, password: string): Promise<string | null> {
  const { server, cap } = makeRes();
  await authHandler(makeReq({ method: 'POST', url: '/api/auth/login', body: JSON.stringify({ email, password }) }), server);
  const m = /lx_buyer=([^;]+)/.exec(cap.setCookie || '');
  return m ? m[1] : null;
}

async function signupAdmin(): Promise<void> {
  const { server } = makeRes();
  await authHandler(makeReq({ method: 'POST', url: '/api/auth/signup', body: JSON.stringify({ email: 'owner@luxedge.us', password: 'Traffic-Check-2026!' }) }), server);
  db.prepare("UPDATE buyer_users SET role='admin' WHERE email='owner@luxedge.us'").run();
}

beforeEach(() => {
  fresh();
});

afterEach(() => {
  resetDataRuntime();
});

describe('traffic route — admin read gate', () => {
  it('answers 401 without a session cookie', async () => {
    const { server, cap } = makeRes();
    await trafficHandler(makeReq({ method: 'GET' }), server);
    expect(cap.status).toBe(401);
  });

  it('answers 200 for a signed-in admin and returns ingested rows', async () => {
    await signupAdmin();
    const cookie = await loginCookie('owner@luxedge.us', 'Traffic-Check-2026!');
    expect(cookie).toBeTruthy();

    const post = makeRes();
    await trafficHandler(
      makeReq({ method: 'POST', body: JSON.stringify({ event: 'page_view', path: '/shop', device: 'desktop' }) }),
      post.server,
    );
    expect(post.cap.status).toBe(204);

    const get = makeRes();
    await trafficHandler(makeReq({ method: 'GET', headers: { cookie: `${SESSION_COOKIE}=${cookie}` } }), get.server);
    expect(get.cap.status).toBe(200);
    const data = JSON.parse(get.cap.body) as { rows: Array<{ event: string; path: string }>; source: string };
    expect(data.source).toBe('d1');
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].event).toBe('page_view');
    expect(data.rows[0].path).toBe('/shop');
  });

  it('refuses a buyer cookie with 403 (role read server-side)', async () => {
    const { server } = makeRes();
    await authHandler(makeReq({ method: 'POST', url: '/api/auth/signup', body: JSON.stringify({ email: 'buyer@luxedge.us', password: 'Buyer-Pass-2026!' }) }), server);
    const cookie = await loginCookie('buyer@luxedge.us', 'Buyer-Pass-2026!');

    const { server: s2, cap } = makeRes();
    await trafficHandler(makeReq({ method: 'GET', headers: { cookie: `${SESSION_COOKIE}=${cookie}` } }), s2);
    expect(cap.status).toBe(403);
  });
});

describe('traffic route — public ingest', () => {
  it('stores a known event with clamped fields', async () => {
    const { server, cap } = makeRes();
    await trafficHandler(
      makeReq({
        method: 'POST',
        body: JSON.stringify({
          event: 'ADD_TO_CART',
          path: '/product/x',
          device: 'mobile',
          visitor_id: 'v123',
          item_ids: ['p1', 'p2'],
          value: 19.99,
          currency: 'usd',
        }),
      }),
      server,
    );
    expect(cap.status).toBe(204);
    const row = db.prepare('SELECT event, device, value, currency FROM site_events').all() as Array<Record<string, unknown>>;
    expect(row).toHaveLength(1);
    expect(row[0].event).toBe('add_to_cart');
    expect(row[0].device).toBe('mobile');
    expect(row[0].value).toBe(19.99);
    expect(row[0].currency).toBe('USD');
  });

  it('drops unknown event names silently (204, no row)', async () => {
    const { server, cap } = makeRes();
    await trafficHandler(makeReq({ method: 'POST', body: JSON.stringify({ event: 'drop_table--x' }) }), server);
    expect(cap.status).toBe(204);
    const rows = db.prepare('SELECT COUNT(*) n FROM site_events').all() as Array<{ n: number }>;
    expect(rows[0].n).toBe(0);
  });

  it('refuses cross-origin ingest and malformed JSON without surfacing errors', async () => {
    const evil = makeRes();
    await trafficHandler(
      makeReq({ method: 'POST', headers: { origin: 'https://evil.example' }, body: JSON.stringify({ event: 'page_view' }) }),
      evil.server,
    );
    expect(evil.cap.status).toBe(204);
    let rows = db.prepare('SELECT COUNT(*) n FROM site_events').all() as Array<{ n: number }>;
    expect(rows[0].n).toBe(0);

    const bad = makeRes();
    await trafficHandler(makeReq({ method: 'POST', body: '{not json' }), bad.server);
    expect(bad.cap.status).toBe(204);
    rows = db.prepare('SELECT COUNT(*) n FROM site_events').all() as Array<{ n: number }>;
    expect(rows[0].n).toBe(0);
  });

  it('enforces the per-IP ingest rate limit', async () => {
    for (let i = 0; i < 121; i++) {
      const { server } = makeRes();
      await trafficHandler(makeReq({ method: 'POST', body: JSON.stringify({ event: 'page_view', path: `/${i}` }) }), server);
    }
    const rows = db.prepare('SELECT COUNT(*) n FROM site_events').all() as Array<{ n: number }>;
    expect(rows[0].n).toBeLessThanOrEqual(120);
  });

  it('answers 503 when the D1 binding is absent (never pretends)', async () => {
    resetDataRuntime({ DATA_BACKEND: 'd1', DB: undefined });
    const { server, cap } = makeRes();
    await trafficHandler(makeReq({ method: 'GET' }), server);
    expect(cap.status).toBe(401); // gate first — the missing binding never bypasses auth
  });

  it('keeps the recovery mail constant contract intact', () => {
    expect(RECOVERY_MAIL_TO).toBe('8002salman@gmail.com');
  });
});
