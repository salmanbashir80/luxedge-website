// ============================================================================
// LUXEDGE — POSTGREST-SUBPATH → D1 SQL
//
// WHY A PATH PARSER INSTEAD OF REWRITING CALL SITES: the Worker's public reads
// (worker/sitemap.ts, worker/seo-meta.ts, api/google-feed.ts) are all written as
// PostgREST path strings, e.g.
//
//   products?select=id,slug,name&status=in.(active,published)&order=slug.asc&limit=500
//
// Accepting that same string here means the migration swaps ONE fetch helper per
// module instead of rewriting every query — and it keeps the exported select
// constants in worker/selects.ts (guarded by src/services/__tests__/
// select-schema.test.ts) as the single source of truth for column names.
//
// SUPPORTED SUBSET (exactly what the public reads use — nothing speculative):
//   select=col,col,...      plain columns; `categories(name)` on products is the
//                           one embedded relation and becomes a LEFT JOIN that
//                           rebuilds the same nested shape PostgREST returned
//   <col>=eq.<value>
//   <col>=in.(a,b,c)
//   <col>=not.like.<prefix>*
//   order=col.asc|.desc[,col2...]   (optional nullsfirst/nullslast)
//   limit=<n>
//
// ANYTHING ELSE is rejected (returning null), which surfaces as the existing
// honest "unavailable" behaviour instead of silently returning wrong rows.
// Identifiers are strictly validated, and every value is a bound parameter —
// this module never concatenates untrusted input into SQL.
// ============================================================================

import { TABLE_SCHEMA, isReadableTable, type TableSchema } from './table-schema';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type FilterOp = 'eq' | 'in' | 'notlike';

export interface Filter {
  column: string;
  op: FilterOp;
  value: string | string[];
}

export interface ParsedQuery {
  table: string;
  select: string[];
  /** products.categories(name) — the only embedded relation in the public reads. */
  embedCategoryName: boolean;
  filters: Filter[];
  order: { column: string; dir: 'ASC' | 'DESC'; nulls?: string }[];
  limit: number;
  offset?: number;
}

export interface BuiltStatement {
  sql: string;
  params: unknown[];
  parsed: ParsedQuery;
}

/** D1 Free allows 50 queries per invocation — a hard ceiling on any fan-out. */
export const MAX_QUERY_LIMIT = 2000;

function unquote(v: string): string {
  try {
    return decodeURIComponent(v.replace(/\+/g, ' '));
  } catch {
    return v;
  }
}

/**
 * Parses one PostgREST path into a structured query. Returns null for anything
 * outside the supported subset so callers can fail honestly.
 */
export function parsePath(path: string): ParsedQuery | null {
  const qIndex = path.indexOf('?');
  const rawTable = qIndex === -1 ? path : path.slice(0, qIndex);
  const table = unquote(rawTable.replace(/^\//, '').trim());
  if (!IDENT.test(table) || !isReadableTable(table)) return null;

  const params = new URLSearchParams(qIndex === -1 ? '' : path.slice(qIndex + 1));
  const parsed: ParsedQuery = {
    table,
    select: [],
    embedCategoryName: false,
    filters: [],
    order: [],
    limit: MAX_QUERY_LIMIT,
  };

  for (const [key, rawValue] of params.entries()) {
    const value = rawValue;

    if (key === 'select') {
      for (const part of unquote(value).split(',')) {
        const token = part.trim();
        if (!token) continue;
        const embed = /^([a-z_]+)\(\s*([a-z_]+)\s*\)$/i.exec(token);
        if (embed) {
          // Only products.categories(name) exists in the public reads.
          if (table === 'products' && embed[1] === 'categories' && embed[2] === 'name') {
            parsed.embedCategoryName = true;
            continue;
          }
          return null;
        }
        if (!IDENT.test(token)) return null;
        parsed.select.push(token);
      }
      continue;
    }

    if (key === 'order') {
      for (const spec of unquote(value).split(',')) {
        const bits = spec.trim().split('.');
        const column = bits[0];
        if (!IDENT.test(column)) return null;
        const dirToken = (bits[1] || 'asc').toLowerCase();
        if (dirToken !== 'asc' && dirToken !== 'desc') return null;
        const nullsToken = (bits[2] || '').toLowerCase();
        if (nullsToken && nullsToken !== 'nullsfirst' && nullsToken !== 'nullslast') return null;
        parsed.order.push({
          column,
          dir: dirToken === 'desc' ? 'DESC' : 'ASC',
          nulls: nullsToken || undefined,
        });
      }
      continue;
    }

    if (key === 'limit') {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return null;
      parsed.limit = Math.min(Math.floor(n), MAX_QUERY_LIMIT);
      continue;
    }

    if (key === 'offset') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) return null;
      parsed.offset = Math.floor(n);
      continue;
    }

    // A filter must name a real-looking column; embedded relation filters are
    // outside the supported subset.
    if (!IDENT.test(key)) return null;

    const inMatch = /^in\.\((.*)\)$/.exec(value);
    if (inMatch) {
      parsed.filters.push({
        column: key,
        op: 'in',
        value: inMatch[1].split(',').map((v) => stripQuotes(unquote(v.trim()))),
      });
      continue;
    }

    const notLike = /^not\.like\.(.*)$/.exec(value);
    if (notLike) {
      let prefix = unquote(notLike[1]);
      // PostgREST uses a trailing `*` as the SQL `%` wildcard.
      const wildcard = prefix.endsWith('*');
      prefix = stripQuotes(wildcard ? prefix.slice(0, -1) : prefix);
      parsed.filters.push({ column: key, op: 'notlike', value: prefix });
      continue;
    }

    const eq = /^eq\.(.*)$/.exec(value);
    if (eq) {
      parsed.filters.push({ column: key, op: 'eq', value: stripQuotes(unquote(eq[1])) });
      continue;
    }

    // Unsupported operator (gt/lt/gte/is/or/...) — refuse rather than guess.
    return null;
  }

  if (!parsed.select.length) parsed.select.push('*');
  return parsed;
}

function stripQuotes(v: string): string {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  return v;
}

/** Escapes LIKE metacharacters so a prefix filter can never widen. */
function likeParam(prefix: string, negate: boolean): string {
  const escaped = prefix.replace(/[\\%_]/g, (m) => `\\${m}`);
  return `${negate ? '' : ''}${escaped}%`;
}

/** Builds a parameterised statement, or null when the path is unsupported. */
export function buildStatement(path: string): BuiltStatement | null {
  const parsed = parsePath(path);
  if (!parsed) return null;

  const schema = TABLE_SCHEMA[parsed.table] as TableSchema;
  const params: unknown[] = [];
  const selectCols =
    parsed.select.length === 1 && parsed.select[0] === '*'
      ? ['*']
      : parsed.select.map((c) => `t."${c}"`);

  // products.category_id → categories.id left join, rebuilt into the nested
  // `categories: { name }` object PostgREST returned for `categories(name)`.
  const needsJoin = parsed.embedCategoryName && parsed.table === 'products';
  const selectList = (needsJoin ? [...selectCols, 'c."name" AS __embed_categories_name'] : selectCols).join(', ');
  const from = needsJoin ? `FROM "products" t LEFT JOIN "categories" c ON c."id" = t."category_id"` : `FROM "${parsed.table}" t`;

  const where: string[] = [];
  for (const f of parsed.filters) {
    if (f.op === 'eq') {
      if (f.value === 'true' || f.value === 'false') {
        // Booleans are stored 0/1; PostgREST callers write eq.true.
        where.push(`t."${f.column}" = ?`);
        params.push(f.value === 'true' ? 1 : 0);
      } else {
        where.push(`t."${f.column}" = ?`);
        params.push(f.value);
      }
    } else if (f.op === 'in') {
      const list = f.value as string[];
      if (!list.length) return null;
      const coerced = list.map((v) => (v === 'true' ? 1 : v === 'false' ? 0 : v));
      where.push(`t."${f.column}" IN (${list.map(() => '?').join(', ')})`);
      params.push(...coerced);
    } else {
      where.push(`t."${f.column}" NOT LIKE ? ESCAPE '\\'`);
      params.push(likeParam(String(f.value), true));
    }
  }

  const orderBy = parsed.order.length
    ? `ORDER BY ${parsed.order
        .map((o) => `t."${o.column}" ${o.dir}${o.nulls === 'nullsfirst' ? ' NULLS FIRST' : o.nulls === 'nullslast' ? ' NULLS LAST' : ''}`)
        .join(', ')}`
    : '';

  const offsetClause = parsed.offset !== undefined ? ` OFFSET ?` : '';
  const sql = `SELECT ${selectList} ${from}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}${orderBy ? ` ${orderBy}` : ''} LIMIT ?${offsetClause}`;
  params.push(parsed.limit);
  if (parsed.offset !== undefined) {
    params.push(parsed.offset);
  }

  void schema;
  return { sql, params, parsed };
}

// ---------------------------------------------------------------------------
// Row coercion — Postgres booleans/jsonb → SQLite 0/1/TEXT and back again.
// ---------------------------------------------------------------------------

/**
 * Tolerant JSON parse: returns the parsed value for real JSON text and the raw
 * string otherwise. NEVER throws — live products.features/benefits/
 * specifications/tags are heterogeneous by documented reality, so a strict
 * parse here would break rows that PostgREST happily returned.
 */
export function tolerantJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  const first = trimmed[0];
  if (first !== '[' && first !== '{' && first !== '"') return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

/** Applies the declared column modes so consumers never see SQLite types. */
export function coerceRow(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const schema = TABLE_SCHEMA[table];
  if (!schema) return row;
  const out: Record<string, unknown> = { ...row };

  // products.categories(name) → PostgREST's nested object shape.
  if ('__embed_categories_name' in out) {
    const name = out.__embed_categories_name;
    delete out.__embed_categories_name;
    out.categories = name === null || name === undefined ? null : { name };
  }

  for (const col of schema.bool) {
    if (col in out) {
      const v = out[col];
      out[col] = v === null || v === undefined ? null : v === 1 || v === true || v === '1' || v === 't';
    }
  }
  for (const col of schema.json) {
    if (col in out && out[col] !== null) out[col] = tolerantJson(out[col]);
  }
  return out;
}
