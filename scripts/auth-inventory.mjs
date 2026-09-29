// ============================================================================
// LUXEDGE — AUTH / BUYER-ACCOUNT INVENTORY (read-only)
//
// Answers the one question that decides the auth migration path: how many REAL
// buyer accounts exist, and can their credentials be migrated safely?
//
// Uses the same read-only Supabase Management API route as supabase-export.mjs
// (independent of the PostgREST/Auth/Storage 402 restriction). Every statement
// must be a single SELECT/WITH — the guard in supabase-export.mjs refuses
// anything else, so this can never mutate production.
//
// SECURITY: never prints a password hash, token, session, email address or any
// other credential. Password material is reported only as a grouped ALGORITHM
// prefix count (e.g. "$2a$" / "$2b$"), which is what decides migratability.
//
// USAGE
//   node scripts/auth-inventory.mjs
// ============================================================================

import { sql } from './supabase-export.mjs';

/** Reports the leading algorithm marker of a password hash, never the hash. */
const ALGO_PREFIX = `left(encrypted_password, 4)`;

async function q(label, query, fmt = (r) => JSON.stringify(r)) {
  try {
    const rows = await sql(query);
    console.log(`${label}\n  ${fmt(rows)}`);
  } catch (err) {
    console.log(`${label}\n  (unavailable: ${err instanceof Error ? err.message.slice(0, 140) : String(err)})`);
  }
}

async function main() {
  console.log('=== AUTH USERS ===');
  await q(
    'total / confirmed / ever-signed-in / with-password',
    `select count(*)::int as total,
            count(*) filter (where email_confirmed_at is not null)::int as confirmed,
            count(*) filter (where last_sign_in_at is not null)::int as ever_signed_in,
            count(*) filter (where encrypted_password is not null)::int as with_password
       from auth.users`,
  );
  await q(
    'account created range',
    `select min(created_at)::date as first_created, max(created_at)::date as last_created from auth.users`,
  );
  await q(
    'sign-in recency buckets',
    `select
        count(*) filter (where last_sign_in_at > now() - interval '30 days')::int as last_30d,
        count(*) filter (where last_sign_in_at > now() - interval '90 days')::int as last_90d,
        count(*) filter (where last_sign_in_at is null)::int as never
       from auth.users`,
  );

  console.log('\n=== PASSWORD HASH ALGORITHM (prefix only — never the hash) ===');
  await q(
    'algorithm marker counts',
    `select ${ALGO_PREFIX} as algo_prefix, count(*)::int as n
       from auth.users
      where encrypted_password is not null
      group by 1 order by 2 desc`,
    (r) => r.map((x) => `${JSON.stringify(x.algo_prefix)} x${x.n}`).join(', ') || '(no password-bearing accounts)',
  );
  await q(
    'hash length buckets (format signal, e.g. bcrypt=60)',
    `select length(encrypted_password) as len, count(*)::int as n
       from auth.users where encrypted_password is not null group by 1 order by 2 desc`,
    (r) => r.map((x) => `len=${x.len} x${x.n}`).join(', ') || '(none)',
  );

  console.log('\n=== IDENTITY / PROFILES ===');
  await q('auth.identities providers', `select provider, count(*)::int as n from auth.identities group by 1 order by 2 desc`);
  await q(
    'public.profiles columns + rows',
    `select count(*)::int as rows from profiles`,
  );
  await q('public.customers rows', `select count(*)::int as rows from customers`);

  console.log('\n=== BUYER-OWNED DATA (does anything reference a user?) ===');
  const buyerTables = ['wishlist_items', 'addresses', 'luxedge_orders', 'orders', 'reviews', 'inventory_reservations'];
  for (const table of buyerTables) {
    await q(`${table}: user_id references`, `select count(*)::int as rows,
            count(distinct user_id)::int as distinct_users
       from ${table}`, (r) => JSON.stringify(r));
  }

  console.log('\n=== WHICH USER-LINKED TABLES EXIST AT ALL ===');
  await q(
    'tables with a user_id/customer_id/auth_user_id column',
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and column_name in ('user_id','customer_id','auth_user_id','owner_id','buyer_id')
      order by table_name, column_name`,
  );

  console.log('\n=== SESSION / SECRET-BEARING TABLES (existence only) ===');
  await q(
    'session-ish tables present (auth schema not listed in detail)',
    `select table_name from information_schema.tables
      where table_schema = 'auth' and table_name in ('sessions','refresh_tokens','mfa_factors','one_time_tokens')
      order by table_name`,
  );
}

await main();
