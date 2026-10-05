// ============================================================================
// LUXEDGE — PRIVATE ADMIN DB WRITES (D1 bind safety)
//
// Regression: the catalog editor's normal Save posts the WHOLE product form,
// including `tags` as an array. Cloudflare D1's bind() accepts only scalars
// (null/number/string/ArrayBuffer), so the array threw D1_TYPE_ERROR and the
// entire Save failed — while a partial save (no tags) and a single-column
// PATCH both worked. These tests pin the coercion so no object, array or
// boolean can ever reach bind() again, and that `undefined` fields are never
// written as a value.
// ============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDataRuntime, setDataRuntime } from '../../worker/d1/runtime';

vi.mock('../_lib/auth.js', () => ({ requireAdmin: vi.fn() }));
const { requireAdmin } = await import('../_lib/auth.js');
const handler = (await import('../admin/db.js')).default;

function response() {
  const captured = { status: 200, body: null as unknown };
  const res = {
    statusCode: 200,
    setHeader() {},
    end(body: string) { captured.status = this.statusCode; captured.body = body ? JSON.parse(body) : null; },
  };
  return { captured, res: res as unknown as ServerResponse };
}

/** Minimal IncomingMessage stand-in that streams one JSON body. */
function request(method: string, url: string, body?: unknown): IncomingMessage {
  const stream = new Readable({ read() { /* body is pushed up-front */ } });
  stream.push(body === undefined ? null : JSON.stringify(body));
  stream.push(null);
  return Object.assign(stream, { method, url, headers: {} }) as unknown as IncomingMessage;
}

describe('private admin db writes are D1-bind safe', () => {
  const prepare = vi.fn();
  const bind = vi.fn();
  const all = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ sub: 'admin-test' } as never);
    prepare.mockReturnValue({ bind });
    bind.mockReturnValue({ all, run: vi.fn() });
    all.mockResolvedValue({ results: [{ id: 'draft-1' }] });
    setDataRuntime({ DATA_BACKEND: 'd1', DB: { prepare } });
  });
  afterEach(() => resetDataRuntime());

  async function write(method: string, path: string, body: unknown) {
    const { captured, res } = response();
    await handler(request(method, `/api/admin/db/${path}`, body), res);
    return captured;
  }

  it('serializes the full-form product save (tags array, booleans, json) instead of failing the write', async () => {
    const result = await write('PATCH', 'products?id=eq.draft-1', {
      name: 'Restored Title',
      title: 'Restored Title',
      tags: ['dog', 'grooming'],
      seo_keywords: ['brush'],
      features: [{ label: 'Soft' }],
      featured: true,
      free_shipping: false,
      us_inventory: true,
      short_description: 'Short',
      owner_notes: undefined,
    });
    expect(result.status).toBe(200);
    expect(prepare).toHaveBeenCalledWith(
      'UPDATE "products" SET "name" = ?, "title" = ?, "tags" = ?, "seo_keywords" = ?, "features" = ?, "featured" = ?, "free_shipping" = ?, "us_inventory" = ?, "short_description" = ? WHERE "id" = ? RETURNING *',
    );
    const args = bind.mock.calls[0] as unknown[];
    // Only D1-bindable scalars: strings, numbers, nulls.
    for (const value of args) {
      expect(['string', 'number']).toContain(typeof value);
    }
    expect(args[2]).toBe('["dog","grooming"]'); // tags stays text; parseTagList() reads it
    expect(args[3]).toBe('["brush"]');
    expect(args[4]).toBe('[{"label":"Soft"}]');
    expect(args[5]).toBe(1);
    expect(args[6]).toBe(0);
    expect(args[7]).toBe(1);
    // The undefined owner_notes field is not written at all.
    expect(String(prepare.mock.calls[0][0])).not.toContain('owner_notes');
    expect(args[args.length - 1]).toBe('draft-1');
  });

  it('coerces an insert the same way', async () => {
    const result = await write('POST', 'products', {
      id: 'new-1',
      name: 'New',
      tags: ['cat'],
      featured: false,
    });
    expect(result.status).toBe(201);
    expect(prepare).toHaveBeenCalledWith('INSERT INTO "products" ("id", "name", "tags", "featured") VALUES (?, ?, ?, ?) RETURNING *');
    expect(bind.mock.calls[0]).toEqual(['new-1', 'New', '["cat"]', 0]);
  });

  it('never writes anything without the admin guard', async () => {
    vi.mocked(requireAdmin).mockImplementation(async (_req, res) => {
      res.statusCode = 401; res.end(JSON.stringify({ error: 'Unauthorized' }));
      return null;
    });
    const result = await write('PATCH', 'products?id=eq.draft-1', { name: 'x' });
    expect(result.status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
  });
});
