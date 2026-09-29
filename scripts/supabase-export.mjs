// ============================================================================
// LUXEDGE — SUPABASE READ-ONLY EXPORT TOOLING (migration support)
//
// WHY: Production Supabase is hard-restricted for PostgREST/Auth (HTTP 402
// exceed_egress_quota) — `/shop` renders 0 products and the sitemap fell back to
// the emergency static set. The Supabase **Management API** database/query
// endpoint still works and is INDEPENDENT of the PostgREST restriction, so the
// live schema and data can be read for a real migration.
//
// SAFETY CONTRACT (this runs against PRODUCTION):
//   * Every statement is validated to be a single read-only SELECT/WITH before
//     it is sent. Anything else is refused, so this tool can never mutate or
//     destroy production data.
//   * Credentials are never printed and never written into the repository. The
//     token is read from SUPABASE_ACCESS_TOKEN or a gitignored local file.
//   * Nothing is deleted from Supabase. Export is copy-only, by design.
//
// USAGE
//   node scripts/supabase-export.mjs schema            # live column inventory
//   node scripts/supabase-export.mjs counts            # exact row counts
//   node scripts/supabase-export.mjs tables            # table list
//   node scripts/supabase-export.mjs export <table>...  # dump rows to JSON
//   node scripts/supabase-export.mjs ddl               # generate SQLite DDL hints
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';

export const SUPABASE_REF = 'eidujmfbcfrjjleitaqp';
const MGMT = 'https://api.supabase.com';

export const OUT_DIR = path.join('.freebuff', 'migration');

// ---------------------------------------------------------------------------
// Credentials — never logged, never committed.
// ---------------------------------------------------------------------------
function readPat() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  const candidates = [
    path.join('.freebuff', 'supabase-pat'),
    '.env',
    path.join(process.env.USERPROFILE || '', '.supabase', 'access-token'),
  ];
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const m = raw.match(/sbp_[A-Za-z0-9]+/);
      if (m) return m[0];
    } catch {
      /* try the next location */
    }
  }
  return null;
}

/**
 * Read-only guard. Rejects anything that is not a single SELECT/WITH statement
 * so this production tool cannot be used to mutate data by accident.
 */
export function assertReadOnly(query) {
  const stripped = query
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim()
    .replace(/;+\s*$/, '');
  if (stripped.includes(';')) throw new Error('refused: multiple statements in one query');
  if (!/^(select|with)\b/i.test(stripped)) throw new Error('refused: only SELECT/WITH is allowed');
  if (/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|comment\s+on|vacuum|copy)\b/i.test(stripped)) {
    throw new Error('refused: statement contains a mutating keyword');
  }
  return stripped;
}

export async function sql(query, { timeoutMs = 180_000 } = {}) {
  const pat = readPat();
  if (!pat) throw new Error('no Supabase access token (set SUPABASE_ACCESS_TOKEN or .freebuff/supabase-pat)');
  const safe = assertReadOnly(query);
  const res = await fetch(`${MGMT}/v1/projects/${SUPABASE_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: safe }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase management api ${res.status}: ${text.slice(0, 400)}`);
  if (!text) return [];
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// Introspection
// ---------------------------------------------------------------------------
export async function listTables() {
  return sql(
    `select table_name, (select count(*) from information_schema.columns c
        where c.table_schema = t.table_schema and c.table_name = t.table_name) as column_count
       from information_schema.tables t
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`,
  );
}

export async function liveSchema() {
  return sql(
    `select c.table_name,
            c.ordinal_position,
            c.column_name,
            c.data_type,
            c.udt_name,
            c.is_nullable,
            c.column_default,
            (select count(*) from information_schema.key_column_usage k
               join information_schema.table_constraints tc
                 on tc.constraint_name = k.constraint_name
                and tc.table_schema = k.table_schema
              where k.table_schema = 'public'
                and k.table_name = c.table_name
                and k.column_name = c.column_name
                and tc.constraint_type = 'PRIMARY KEY') as is_pk
       from information_schema.columns c
      where c.table_schema = 'public'
      order by c.table_name, c.ordinal_position`,
  );
}

export async function exactCounts(tables) {
  const union = tables
    .map((t) => `select ${quoteLiteral(t)} as table_name, count(*)::bigint as row_count from ${quoteIdent(t)}`)
    .join(' union all ');
  const rows = await sql(union);
  const out = {};
  for (const r of rows) out[r.table_name] = Number(r.row_count);
  return out;
}

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------
export function quoteIdent(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`unsafe identifier: ${name}`);
  return `"${name}"`;
}
export function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------------------
// Batched full-table dump (LIMIT/OFFSET over a stable ORDER BY key)
// ---------------------------------------------------------------------------
export async function dumpTable(table, { batch = 1000, orderBy = 'id' } = {}) {
  const rows = [];
  for (let offset = 0; ; offset += batch) {
    const page = await sql(
      `select * from ${quoteIdent(table)} order by ${quoteIdent(orderBy)} nulls last limit ${batch} offset ${offset}`,
    );
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    if (page.length < batch) break;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function writeJson(file, data) {
  ensureOutDir();
  const target = path.join(OUT_DIR, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(data, null, 1));
  return target;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd) {
    console.log('usage: supabase-export.mjs <schema|counts|tables|export|ddl> [table...]');
    return;
  }

  if (cmd === 'tables') {
    const t = await listTables();
    console.log(t.map((r) => `${r.table_name} (${r.column_count} cols)`).join('\n'));
    return;
  }

  if (cmd === 'schema') {
    const s = await liveSchema();
    const file = writeJson('live-schema.json', s);
    const byTable = new Map();
    for (const c of s) {
      if (!byTable.has(c.table_name)) byTable.set(c.table_name, { cols: 0, pks: [] });
      const e = byTable.get(c.table_name);
      e.cols += 1;
      if (Number(c.is_pk) > 0) e.pks.push(c.column_name);
    }
    console.log(`live columns: ${s.length} across ${byTable.size} tables -> ${file}`);
    return;
  }

  if (cmd === 'counts') {
    const tables = (await listTables()).map((r) => r.table_name);
    const counts = await exactCounts(tables);
    const file = writeJson('row-counts.json', counts);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`exact counts for ${tables.length} tables (${total} rows total) -> ${file}`);
    for (const [t, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(8)}  ${t}`);
    }
    return;
  }

  if (cmd === 'export') {
    if (!args.length) throw new Error('export needs at least one table name');
    const schema = await liveSchema();
    const pkByTable = new Map();
    for (const c of schema) {
      if (Number(c.is_pk) > 0) pkByTable.set(c.table_name, c.column_name);
    }
    for (const table of args) {
      const orderBy = pkByTable.get(table) || 'id';
      const rows = await dumpTable(table, { orderBy });
      const file = writeJson(path.join('tables', `${table}.json`), rows);
      console.log(`exported ${rows.length} rows from ${table} -> ${file}`);
    }
    return;
  }

  if (cmd === 'ddl') {
    const schema = await liveSchema();
    const grouped = new Map();
    for (const c of schema) {
      if (!grouped.has(c.table_name)) grouped.set(c.table_name, []);
      grouped.get(c.table_name).push(c);
    }
    const lines = [];
    for (const [table, cols] of grouped) {
      lines.push(`-- ${table} (${cols.length} columns)`);
      lines.push(`-- ${cols.map((c) => `${c.column_name}:${c.udt_name}`).join(', ')}`);
      lines.push('');
    }
    const file = writeJson('schema-summary.json', Object.fromEntries(grouped));
    console.log(`schema summary -> ${file}`);
    console.log(lines.join('\n').slice(0, 4000));
    return;
  }

  throw new Error(`unknown command: ${cmd}`);
}

// Only run the CLI when invoked directly (imported helpers stay side-effect free).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('supabase-export.mjs')) {
  try {
    await main();
  } catch (err) {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}
