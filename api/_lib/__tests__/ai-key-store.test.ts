import { describe, expect, it } from 'vitest';
import { readAttachedAiKeys, writeAttachedAiKey, removeAttachedAiKey } from '../ai-key-store';
import type { D1DatabaseLike } from '../../../worker/d1/runtime';

function fixtureDb() {
  const data = new Map<string, string>();
  const queries: string[] = [];
  const db: D1DatabaseLike = { prepare(sql) {
    queries.push(sql);
    let params: unknown[] = [];
    const statement = {
      bind(...values: unknown[]) { params = values; return statement; },
      async run() {
        if (sql.startsWith('INSERT')) data.set(String(params[0]), String(params[1]));
        if (sql.startsWith('DELETE')) data.delete(String(params[0]));
        return { meta: { changes: 1 } };
      },
      async all<T>() {
        const results = sql.includes('WHERE provider') ? (data.has(String(params[0])) ? [{ value: data.get(String(params[0])) }] : [])
          : [...data.entries()].map(([provider, value]) => ({ provider, value }));
        return { results: results as T[] };
      },
    };
    return statement;
  } };
  return { db, queries };
}
describe('private D1 AI key store', () => {
  it('parameterizes secrets, verifies persistence and can clear only the selected attached key', async () => {
    const { db, queries } = fixtureDb();
    const synthetic = 'test-only-provider-value';
    expect(await writeAttachedAiKey(db, 'deepseek', synthetic)).toBe(true);
    expect(await readAttachedAiKeys(db)).toEqual({ DEEPSEEK: synthetic });
    expect(queries.every(q => !q.includes(synthetic))).toBe(true);
    expect(await removeAttachedAiKey(db, 'deepseek')).toBe(true);
    expect(await readAttachedAiKeys(db)).toEqual({});
  });
  it('fails closed without changing keys if the database fails', async () => {
    const db: D1DatabaseLike = { prepare() { throw new Error('private SQL details'); } };
    expect(await writeAttachedAiKey(db, 'deepseek', 'test-only-key')).toBe(false);
    expect(await readAttachedAiKeys(db)).toEqual({});
  });
  it('rejects invalid provider identifiers and oversized/blank values', async () => {
    const { db } = fixtureDb();
    expect(await writeAttachedAiKey(db, "x'; DROP TABLE products", 'test-only-key')).toBe(false);
    expect(await writeAttachedAiKey(db, 'deepseek', '')).toBe(false);
    expect(await writeAttachedAiKey(db, 'deepseek', 'x'.repeat(8193))).toBe(false);
  });
});
