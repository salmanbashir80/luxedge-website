#!/usr/bin/env node
// ============================================================================
// D1 schema parity — committed migrations vs live production D1.
//
// WHY THIS EXISTS (audit 2026-10-02): a "schema drift" mission assumed
// production D1 held admin-auth tables (buyer_users, sessions, rate limits)
// that no committed migration recreates — the same failure class as the
// out-of-band products columns that broke storefront selects. The audit
// DISPROVED it: migrations 0001-0006 reproduce production exactly at the
// semantic level (tables, columns, types, constraints, defaults, PKs, CHECK/FK
// text, indexes incl. column lists and unique flags, triggers, views). This
// script keeps that invariant checkable forever: it re-probes live D1 through
// wrangler, replays the migrations into a local SQLite (node:sqlite), and
// fails with a precise diff when they diverge.
//
// Run it after ANY migration change and before trusting a repo-only rebuild:
//
//     node scripts/d1-schema-parity.mjs            # production (default)
//     node scripts/d1-schema-parity.mjs --db staging
//
// LX_PARITY_DUMP=<file> replaces the live probe with a wrangler --json dump
// (same shape as `wrangler d1 execute ... --json`) — used to mutation-test
// this script itself; leave unset in normal use.
//
// Exit 0 = parity, exit 2 = drift (diffs printed), exit 1 = probe/replay error.
// Read-only against D1: a single sqlite_master SELECT; nothing is applied.
// ============================================================================
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const MIG_DIR = 'cloudflare/d1/migrations';
const DBS = {
  production: 'luxedge-production-db',
  staging: 'luxedge-staging-db',
};
const dbKey = process.argv.includes('--db') ? process.argv[process.argv.indexOf('--db') + 1] : 'production';
const dbName = DBS[dbKey];
if (!dbName) { console.error(`Unknown --db ${dbKey} (use: ${Object.keys(DBS).join(', ')})`); process.exit(1); }

// ---------- helpers ----------
const norm = (s) => String(s ?? '').replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

function tableDefs(createSql) {
  const open = createSql.indexOf('(');
  const close = createSql.lastIndexOf(')');
  const body = createSql.slice(open + 1, close);
  const defs = [];
  let depth = 0, cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { defs.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) defs.push(cur.trim());
  return defs;
}
function firstIdent(def) {
  const m = /^\s*(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_$]*))/.exec(def);
  return m ? (m[1] || m[2] || m[3] || m[4]).toLowerCase() : null;
}
function isConstraint(def) {
  return /^\s*(?:primary\s+key|unique|check|foreign\s+key|constraint)\b/i.test(def);
}
function parseColumns(createSql) {
  const cols = {}, defs = {}, tcons = [];
  for (const d of tableDefs(createSql)) {
    if (isConstraint(d)) { tcons.push(norm(d)); continue; }
    const name = firstIdent(d);
    if (!name) continue;
    const rest = d.replace(/^\s*(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*)/, '').trim();
    const type = (rest.match(/^[A-Za-z]+[A-Za-z0-9]*(?:\([^)]*\))?/) || [''])[0].toLowerCase();
    cols[name] = {
      type,
      notnull: /\bnot\s+null\b/i.test(d),
      dflt: (rest.match(/\bdefault\s+([^,]+)/i) || [])[1]?.trim().toLowerCase() || null,
      pk: /\bprimary\s+key\b/i.test(d),
    };
    defs[name] = norm(d);
  }
  return { cols, defs, tcons };
}
function colsOfCreate(normTableSql) {
  return parseColumns('CREATE TABLE ' + normTableSql.replace(/^create\s+table\s+(if\s+not\s+exists\s+)?/, ''));
}
function indexColumns(normIndexSql) {
  return normIndexSql.slice(normIndexSql.indexOf('(') + 1, normIndexSql.lastIndexOf(')'));
}
function modelOf(masterRows) {
  const tables = {}, indexes = {}, others = {};
  for (const r of masterRows) {
    if (r.name.startsWith('sqlite_autoindex') || r.name === 'sqlite_sequence') continue;
    if (r.type === 'table' && (r.name === '_cf_KV' || r.name === 'd1_migrations')) continue;
    const sql = norm(r.sql);
    if (r.type === 'table') tables[r.name] = colsOfCreate(sql);
    else if (r.type === 'index') indexes[`${r.name}|${r.tbl_name}`] = { unique: /create\s+unique\s+index/.test(sql), cols: indexColumns(sql) };
    else others[`${r.type}|${r.name}`] = sql; // trigger/view — none exist today; compared if they ever do
  }
  return { tables, indexes, others };
}

// ---------- 1. probe live D1 (read-only) ----------
const env = { ...process.env };
delete env.CLOUDFLARE_API_TOKEN; // the established recipe: a stray token shadows login (7403)
delete env.CLOUDFLARE_ACCOUNT_ID;

const SQL = 'SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name';
let master = null;
if (process.env.LX_PARITY_DUMP) {
  master = JSON.parse(fs.readFileSync(process.env.LX_PARITY_DUMP, 'utf8'))[0].results;
  console.log(`dump override: ${process.env.LX_PARITY_DUMP}`);
} else {
  // wrangler --json quirks this script tolerates: errors arrive on STDOUT as
  // {"error":{...}} (not stderr), exit codes are unreliable on Windows (the
  // libuv "async.c assertion" crash exits 127/3221226505 even after success),
  // and 7403/7500 are transient — retry.
  for (let attempt = 1; attempt <= 4 && !master; attempt++) {
    const probe = spawnSync(
      `npx wrangler d1 execute ${dbName} --remote --json --command "${SQL}"`,
      { encoding: 'utf8', shell: true, env, timeout: 180_000 },
    );
    try {
      const parsed = JSON.parse(probe.stdout);
      if (Array.isArray(parsed) && parsed[0]?.results) { master = parsed[0].results; break; }
      const code = parsed?.error?.code;
      if (code === 7403 || code === 7500) {
        console.log(`attempt ${attempt}: transient D1 error ${code}, retrying…`);
      } else {
        console.error(`D1 probe error: ${JSON.stringify(parsed?.error ?? parsed).slice(0, 400)}`);
        process.exit(1);
      }
    } catch {
      console.log(`attempt ${attempt}: unparseable wrangler output (status ${probe.status}), retrying…`);
    }
    await new Promise((r) => setTimeout(r, 5_000 * attempt));
  }
  if (!master) { console.error('D1 probe failed after retries.'); process.exit(1); }
}
console.log(`live ${dbKey} (${dbName}): ${master.filter((r) => r.type === 'table').length} tables, ${master.filter((r) => r.type === 'index').length} indexes`);

// ---------- 2. replay migrations into a scratch local SQLite ----------
const db = new DatabaseSync(':memory:');
const files = fs.readdirSync(MIG_DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
if (!files.length) { console.error('No migrations found in ' + MIG_DIR); process.exit(1); }
for (const f of files) {
  try { db.exec(fs.readFileSync(`${MIG_DIR}/${f}`, 'utf8')); }
  catch (e) { console.error(`replay FAILED at ${f}: ${e.message}`); process.exit(1); }
}
const scratch = db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all();
console.log(`migrations ${files[0]}..${files[files.length - 1]}: replayed into scratch SQLite (${scratch.filter((r) => r.type === 'table').length} tables)`);

// ---------- 3. semantic compare ----------
const A = modelOf(scratch);   // migrations
const B = modelOf(master);    // production
const diffs = [];
for (const [t, a] of Object.entries(A.tables)) {
  const b = B.tables[t];
  if (!b) { diffs.push(`SCRATCH-ONLY TABLE: ${t}`); continue; }
  for (const [n, x] of Object.entries(a.cols)) {
    const y = b.cols[n];
    if (!y) { diffs.push(`COL SCRATCH-ONLY ${t}.${n}`); continue; }
    if (x.type !== y.type || x.notnull !== y.notnull || (x.dflt || null) !== (y.dflt || null) || x.pk !== y.pk) {
      diffs.push(`COL ATTR DIFF ${t}.${n}: migrations{${x.type},${x.notnull},${x.dflt},${x.pk}} live{${y.type},${y.notnull},${y.dflt},${y.pk}}`);
    }
    if (a.defs[n] !== b.defs[n]) diffs.push(`COL DEF DIFF ${t}.${n}:\n    migrations: ${a.defs[n]}\n    live      : ${b.defs[n]}`);
  }
  for (const n of Object.keys(b.cols)) if (!a.cols[n]) diffs.push(`COL LIVE-ONLY ${t}.${n}`);
  const at = [...a.tcons].sort().join(' ; ');
  const bt = [...b.tcons].sort().join(' ; ');
  if (at !== bt) diffs.push(`TABLE CONSTRAINT DIFF ${t}:\n    migrations: ${at || '(none)'}\n    live      : ${bt || '(none)'}`);
}
for (const t of Object.keys(B.tables)) if (!A.tables[t]) diffs.push(`LIVE-ONLY TABLE: ${t}`);
for (const [k, a] of Object.entries(A.indexes)) {
  const b = B.indexes[k];
  if (!b) { diffs.push(`SCRATCH-ONLY INDEX: ${k}`); continue; }
  if (a.unique !== b.unique) diffs.push(`INDEX UNIQUE DIFF: ${k}`);
  if (a.cols !== b.cols) diffs.push(`INDEX COLS DIFF ${k}:\n    migrations: ${a.cols}\n    live      : ${b.cols}`);
}
for (const k of Object.keys(B.indexes)) if (!(k in A.indexes)) diffs.push(`LIVE-ONLY INDEX: ${k}`);
for (const k of Object.keys(A.others)) if (!(k in B.others)) diffs.push(`SCRATCH-ONLY OBJECT: ${k}`);
for (const k of Object.keys(B.others)) if (!(k in A.others)) diffs.push(`LIVE-ONLY OBJECT: ${k}`);

if (diffs.length) {
  console.error(`\nSCHEMA DRIFT between ${MIG_DIR} and live ${dbKey} (${diffs.length}):`);
  for (const d of diffs) console.error('  ' + d);
  console.error('\nAdd a reconciling migration (IF NOT EXISTS / guarded pattern) — do NOT edit applied files.');
  process.exit(2);
}
console.log(`SCHEMA PARITY: ${MIG_DIR} ${files[0]}..${files[files.length - 1]} reproduces live ${dbKey} exactly (0 diffs)`);
