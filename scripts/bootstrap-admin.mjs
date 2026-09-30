// ============================================================================
// LUXEDGE — ADMIN ACCOUNT BOOTSTRAP (owner-only, local, $0)
//
// WHY THIS EXISTS
//   Admin sign-in used to be minted by Supabase Auth, which is restricted by
//   the project-wide HTTP 402 — the Admin Console answered "HTTP 402" and the
//   owner was locked out. Admins now authenticate against Cloudflare/D1
//   (worker/auth/*), and the very first admin cannot be created over HTTP:
//   issuing an activation code already requires an authenticated admin
//   (api/admin/buyers.ts), which is exactly the chicken-and-egg this script
//   breaks — locally, through `wrangler d1 execute`, with no new credentials
//   and no network service.
//
// WHAT IT DOES (all idempotent)
//   1. Ensures the admin identity row exists in buyer_users with role='admin'.
//      role is never accepted over HTTP; it is written here and read back
//      server-side from the session row (migration 0004).
//   2. Unless the account already has a working password, issues a ONE-TIME
//      activation code: only its SHA-256 is stored, any previous live code is
//      revoked first, and it expires (default 14 days).
//   3. Prints the code EXACTLY ONCE to this terminal. It is never written to a
//      file, never logged, never re-displayable — the database holds only the
//      hash, so re-running the script is the only way to get a new code (which
//      invalidates the old one).
//
// USAGE
//   node scripts/bootstrap-admin.mjs --db staging
//   node scripts/bootstrap-admin.mjs --db production --email admin@luxedge.us
//   node scripts/bootstrap-admin.mjs --db staging --reissue   # force a new code
//
// Run it with the Cloudflare OAuth identity if a shadowing API token is set:
//   env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID node scripts/bootstrap-admin.mjs --db staging
// ============================================================================

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// --- Token primitives (MUST stay byte-identical to worker/auth/tokens.ts) ----
// scripts/*.mjs cannot import TypeScript, so these are mirrored — and
// scripts/bootstrap-admin.test.ts asserts they match the source of truth.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const CODE_LENGTH = 10;

export function generateActivationCode() {
  // Same CSPRNG source as tokens.ts: crypto.getRandomValues (never Math.random).
  const raw = globalThis.crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let body = '';
  for (const byte of raw) body += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return `${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8)}`;
}

export function normalizeActivationCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

// --- CLI --------------------------------------------------------------------

const DBS = {
  staging: { name: 'luxedge-staging-db', args: ['--env', 'staging', 'luxedge-staging-db'] },
  production: { name: 'luxedge-production-db', args: ['luxedge-production-db'] },
};

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Wrangler's local entry point. Spawning `npx` from Node on Windows needs a
 * shell (npx.cmd) which would then mangle SQL quoting, so the CLI is invoked as
 * a plain Node program with a real argv array — no shell, no re-quoting.
 */
function wranglerBin() {
  const candidates = [
    path.join(process.cwd(), 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    path.join(process.cwd(), 'node_modules', 'wrangler', 'bin', 'cf-wrangler.js'),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('wrangler is not installed locally — run `npm install` in the repo root first.');
  return found;
}

function runWrangler(db, extraArgs, command) {
  const args = [wranglerBin(), 'd1', 'execute', ...DBS[db].args, '--remote', ...extraArgs, '--command', command];
  return spawnSync(process.execPath, args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env },
    shell: false,
  });
}

function wrangler(db, command, extraArgs = []) {
  const res = runWrangler(db, extraArgs, command);
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const out = `${res.stdout || ''}\n${res.stderr || ''}`.trim();
    throw new Error(`wrangler d1 execute failed (exit ${res.status}):\n${out.slice(0, 2000)}`);
  }
  return res.stdout || '';
}

/** Runs a SELECT and returns its rows (parses wrangler --json output). */
function select(db, command) {
  const res = runWrangler(db, ['--json'], command);
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const out = `${res.stdout || ''}\n${res.stderr || ''}`.trim();
    if (/no such column: role/i.test(out)) {
      throw new Error(
        'The `role` column is missing (migration 0004 not applied). Run:\n' +
          `  npx wrangler d1 migrations apply ${DBS[db].name} --remote${db === 'staging' ? ' --env staging' : ''}`,
      );
    }
    throw new Error(`wrangler d1 query failed (exit ${res.status}):\n${out.slice(0, 2000)}`);
  }
  try {
    const parsed = JSON.parse(res.stdout);
    const blocks = Array.isArray(parsed) ? parsed : [parsed];
    return blocks.flatMap((b) => (Array.isArray(b?.results) ? b.results : []));
  } catch {
    throw new Error(`Could not parse wrangler JSON output:\n${String(res.stdout).slice(0, 1000)}`);
  }
}

function parseArgs(argv) {
  const opts = { db: 'staging', email: 'admin@luxedge.us', name: 'Store Owner', ttlDays: 14, reissue: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') opts.db = argv[++i];
    else if (a === '--email') opts.email = argv[++i];
    else if (a === '--name') opts.name = argv[++i];
    else if (a === '--ttl-days') opts.ttlDays = Number(argv[++i]);
    else if (a === '--reissue') opts.reissue = true;
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  if (!DBS[opts.db]) throw new Error(`Unknown --db "${opts.db}" (use: staging | production)`);
  if (!Number.isFinite(opts.ttlDays) || opts.ttlDays < 1 || opts.ttlDays > 30) {
    throw new Error('--ttl-days must be between 1 and 30');
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node scripts/bootstrap-admin.mjs [--db staging|production] [--email you@example.com] [--name "Name"] [--ttl-days 14] [--reissue]');
    return;
  }

  const email = opts.email.trim();
  const emailNorm = email.toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`Invalid email: ${email}`);

  const now = new Date();
  const expires = new Date(now.getTime() + opts.ttlDays * 86_400_000);
  const iso = (d) => d.toISOString();

  console.log(`[bootstrap-admin] database: ${DBS[opts.db].name}`);

  // 1) Ensure the identity exists, with role='admin' (server-side only).
  const existing = select(
    opts.db,
    `SELECT id, role, requires_activation, (password_hash IS NOT NULL) AS has_password FROM buyer_users WHERE email_normalized = ${sqlQuote(emailNorm)} LIMIT 1`,
  );
  let userId = existing[0]?.id;

  if (!userId) {
    userId = randomUUID();
    wrangler(
      opts.db,
      `INSERT INTO buyer_users (id, legacy_user_id, email, email_normalized, display_name, created_at, updated_at, email_verified, requires_activation, password_hash, password_updated_at, role) ` +
        `VALUES (${sqlQuote(userId)}, NULL, ${sqlQuote(email)}, ${sqlQuote(emailNorm)}, ${sqlQuote(opts.name)}, ${sqlQuote(iso(now))}, ${sqlQuote(iso(now))}, 0, 1, NULL, NULL, 'admin')`,
    );
    console.log('[bootstrap-admin] created admin identity (requires_activation = 1, no password yet)');
  } else {
    if (existing[0].role !== 'admin') {
      wrangler(opts.db, `UPDATE buyer_users SET role = 'admin', updated_at = ${sqlQuote(iso(now))} WHERE id = ${sqlQuote(userId)}`);
      console.log('[bootstrap-admin] promoted existing account to role=admin');
    } else {
      console.log('[bootstrap-admin] account already has role=admin');
    }
  }

  // 2) Issue a code only when the account cannot sign in yet, or when asked.
  const active = existing[0] && existing[0].has_password && existing[0].requires_activation !== 1;
  if (active && !opts.reissue) {
    console.log('[bootstrap-admin] account already has a working password — no code issued (use --reissue to force a new one).');
    return;
  }

  const code = generateActivationCode();
  const tokenHash = sha256Hex(normalizeActivationCode(code));
  const tokenId = randomUUID();

  // Regenerating revokes any previous live code for this account (same rule as
  // worker/auth/store.ts issueActivationCode), then records only the hash.
  wrangler(opts.db, `UPDATE buyer_activation_tokens SET revoked_at = ${sqlQuote(iso(now))} WHERE user_id = ${sqlQuote(userId)} AND used_at IS NULL AND revoked_at IS NULL`);
  wrangler(
    opts.db,
    `INSERT INTO buyer_activation_tokens (id, user_id, token_hash, created_at, expires_at, created_by) ` +
      `VALUES (${sqlQuote(tokenId)}, ${sqlQuote(userId)}, ${sqlQuote(tokenHash)}, ${sqlQuote(iso(now))}, ${sqlQuote(iso(expires))}, 'bootstrap-script')`,
  );
  wrangler(opts.db, `UPDATE buyer_users SET requires_activation = 1, updated_at = ${sqlQuote(iso(now))} WHERE id = ${sqlQuote(userId)}`);

  const bar = '='.repeat(66);
  console.log(`\n${bar}`);
  console.log(' ONE-TIME ACTIVATION CODE — SHOWN ONCE, NEVER STORED IN PLAINTEXT');
  console.log(`${bar}`);
  console.log(`  account : ${email}`);
  console.log(`  code    : ${code}`);
  console.log(`  expires : ${iso(expires)}`);
  console.log(`  database: ${DBS[opts.db].name}`);
  console.log('');
  console.log('  Redeem at /admin/login → "Have an activation code?" → choose a');
  console.log('  password (min 10 chars). The code works once; re-running this');
  console.log('  script revokes it and issues a fresh one.');
  console.log(`${bar}\n`);
}

// Run only when executed directly (imported by the parity test otherwise).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[bootstrap-admin] FAILED: ${err?.message || err}`);
    process.exitCode = 1;
  });
}
