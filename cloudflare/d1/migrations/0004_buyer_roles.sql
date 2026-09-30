-- ============================================================================
-- LUXEDGE — CLOUDFLARE D1 MIGRATION 0004 — ACCOUNT ROLES
--
-- WHY: admin sign-in still went through Supabase Auth, which is restricted by
-- the project-wide HTTP 402 (exceed_egress_quota) — so the Admin Console
-- login form answered "HTTP 402" and locked the owner out. The D1 auth system
-- (0003) already owns sessions and passwords; it just had no notion of a role,
-- because the admin role used to live in Supabase's app_metadata.role claim.
--
-- WHAT THIS ADDS: a `role` column whose value is written ONLY by trusted
-- server-side code:
--   * 'buyer'  — the DEFAULT, so a public signup can never mint an admin
--                (the INSERT in api/auth/index.ts does not mention `role`).
--   * 'admin'  — set out-of-band by scripts/bootstrap-admin.mjs (owner-only,
--                runs through `wrangler d1 execute`), never over HTTP.
-- The role is read back from the session row server-side on every guarded
-- request; it is never accepted from a request body, cookie or query string.
--
-- ROLLOUT: additive and inert — no existing row changes meaning (every
-- existing account becomes 'buyer', which is correct: all pre-existing rows
-- are QA fixtures and none is an admin). Safe to apply before the code that
-- reads it ships.
-- ============================================================================

ALTER TABLE buyer_users ADD COLUMN role TEXT NOT NULL DEFAULT 'buyer';

CREATE INDEX IF NOT EXISTS buyer_users_role_idx ON buyer_users (role);
