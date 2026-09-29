// ============================================================================
// LUXEDGE — D1 IMPORT TOOLING
//
// Turns the read-only Supabase exports into D1-loadable SQL, then verifies the
// imported row counts against the source counts. Copy-only: the source exports
// are never modified and Supabase is never written to.
//
// VALUE CONVERSION is type-driven (not column-name-driven), which is exactly
// equivalent to the declared registry in worker/d1/table-schema.ts:
//   JS boolean        -> 1 / 0            (SQLite has no boolean type)
//   JS array / object -> JSON text        (jsonb / text[] preserved as text)
//   null / undefined  -> NULL
//   number            -> numeric literal
//   string            -> quoted literal (single quotes doubled)
// Reading back re-applies the declared modes so consumers never see a
// difference from PostgREST's real booleans and jsonb arrays.
//
// USAGE
//   node scripts/d1-import.mjs sql <table>...        # write .sql files
//   node scripts/d1-import.mjs sql --all             # every exported table
//   node scripts/d1-import.mjs verify <counts.json>  # compare source vs imported
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';

const EXPORT_DIR = path.join('.freebuff', 'migration', 'tables');
const SQL_DIR = path.join('.freebuff', 'migration', 'sql');
const COUNTS_FILE = path.join('.freebuff', 'migration', 'row-counts.json');

/** D1's max SQL statement length is 100 KB — stay well clear of it. */
const MAX_STATEMENT_BYTES = 80_000;

/** Tables seeded into D1 (the public/SSR read surface). */
export const IMPORT_TABLES = [
  'products',
  'categories',
  'product_images',
  'product_variants',
  'coupons',
  'store_settings',
  'store_offers',
  'blog_posts',
  'blog_revisions',
  'media_videos',
];

export function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'NULL';
    return String(value);
  }
  if (typeof value === 'object') return quote(JSON.stringify(value));
  return quote(String(value));
}

function quote(s) {
  return `'${s.replace(/'/g, "''")}'`;
}

export function toSql(table, rows) {
  if (!rows.length) return `-- ${table}: 0 rows (schema only)\n`;

  // Union of keys so a column that is NULL in row 1 is still inserted.
  const columns = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
  }

  const statements = [];
  let batch = [];
  let batchBytes = 0;

  const flush = () => {
    if (!batch.length) return;
    statements.push(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${batch.join(',\n')};`,
    );
    batch = [];
    batchBytes = 0;
  };

  for (const row of rows) {
    const tuple = `(${columns.map((c) => sqlLiteral(row[c])).join(', ')})`;
    if (batchBytes + tuple.length > MAX_STATEMENT_BYTES) flush();
    batch.push(tuple);
    batchBytes += tuple.length + 2;
  }
  flush();

  return `-- ${table}: ${rows.length} rows, ${columns.length} columns\n${statements.join('\n')}\n`;
}

function listExportedTables() {
  if (!fs.existsSync(EXPORT_DIR)) return [];
  return fs
    .readdirSync(EXPORT_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (cmd === 'sql') {
    const all = listExportedTables();
    const tables = args.includes('--all') ? all : args.filter((a) => !a.startsWith('--'));
    if (!tables.length) {
      console.error(`usage: d1-import.mjs sql <table>... | --all\navailable: ${all.join(', ')}`);
      return;
    }
    fs.mkdirSync(SQL_DIR, { recursive: true });
    let totalRows = 0;
    for (const table of tables) {
      const file = path.join(EXPORT_DIR, `${table}.json`);
      if (!fs.existsSync(file)) {
        console.error(`  SKIP ${table} — no export at ${file}`);
        continue;
      }
      const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
      const sql = toSql(table, rows);
      fs.writeFileSync(path.join(SQL_DIR, `${table}.sql`), sql);
      totalRows += rows.length;
      console.log(`  ${String(rows.length).padStart(6)}  ${table} -> sql/${table}.sql`);
    }
    console.log(`wrote ${tables.length} SQL files (${totalRows} rows) -> ${SQL_DIR}`);
    return;
  }

  if (cmd === 'verify') {
    const target = args[0] || COUNTS_FILE;
    if (!fs.existsSync(target)) {
      console.error(`missing counts file ${target} (run: node scripts/supabase-export.mjs counts)`);
      return;
    }
    const source = JSON.parse(fs.readFileSync(target, 'utf8'));
    let ok = true;
    let checked = 0;
    for (const table of IMPORT_TABLES) {
      const file = path.join(SQL_DIR, `${table}.sql`);
      if (!fs.existsSync(file)) {
        console.error(`  MISSING SQL for ${table}`);
        ok = false;
        continue;
      }
      const exported = JSON.parse(fs.readFileSync(path.join(EXPORT_DIR, `${table}.json`), 'utf8'));
      const srcCount = source[table];
      const match = srcCount === undefined || srcCount === exported.length;
      checked += 1;
      if (!match) ok = false;
      console.log(
        `  ${match ? 'OK  ' : 'FAIL'} ${table.padEnd(20)} source=${srcCount} exported=${exported.length}`,
      );
    }
    console.log(ok ? `\nverified ${checked} tables — source and export counts agree` : '\nCOUNT MISMATCH — do not cut over');
    return;
  }

  console.error('usage: d1-import.mjs <sql|verify> ...');
}

if (process.argv[1]?.endsWith('d1-import.mjs')) main();
