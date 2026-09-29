-- ============================================================================
-- LUXEDGE — CLOUDFLARE D1 MIGRATION 0003 — BUYER AUTHENTICATION
--
-- WHY THIS EXISTS: buyer sign-up / sign-in went through Supabase Auth, which is
-- restricted by the same project-wide HTTP 402 (exceed_egress_quota) as the
-- REST API — so signing in is simply impossible today. D1 is the $0 replacement
-- datastore; the authentication logic itself lives in worker/auth/*, because D1
-- is a database, not an auth provider.
--
-- POPULATION (measured 2026-09-29 from the live `profiles` export, not assumed):
--   the 17 auth users are ALL fixtures — 3 `customer` rows whose emails are
--   buyer-debug-*/buyer-contract-* and 14 `admin` rows on luxedge.test /
--   tmp.lx / luxedge.local (plus the owner's own two logins). There are NO real
--   buyers, and `orders`/`addresses`/`order_items` are empty. So this is a
--   clean implementation from zero (the master plan's PATH C): no bcrypt hash
--   is migrated, no fixture account is preserved, and nothing is fabricated to
--   look like a customer base.
--
-- LEGACY PASSWORD HASHES ARE DELIBERATELY NOT MIGRATED. All 17 are bcrypt
-- `$2a$`; bcrypt is not available in WebCrypto, a pure-JS verify costs a
-- runaway amount of CPU inside a Worker, and re-hashing to a cheaper function
-- would be exactly the security downgrade the project rules forbid. Existing
-- credentials are not carried over — see docs/CLOUDFLARE_MIGRATION.md.
--
-- SECRETS THIS TABLE HOLDS (all one-way, none reversible):
--   * password_hash — PBKDF2-SHA256, versioned, unique per-user salt
--   * session/activation rows store only the SHA-256 of a 256-bit random token,
--     so a database dump cannot be turned into a usable session or code.
--   * nothing here is ever returned by a public endpoint, and no table in this
--     file is reachable through /api/db (asserted by worker/__tests__).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- buyer_users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS buyer_users (
  id TEXT PRIMARY KEY,
  -- The Supabase auth id this identity came from, kept ONLY so an old record
  -- can be traced. NULL for every account created after the migration. It is
  -- not a credential and is never accepted as proof of identity.
  legacy_user_id TEXT,
  email TEXT NOT NULL,
  -- Lowercased+trimmed email. UNIQUE on THIS column, not on `email`, so a
  -- differently-cased duplicate cannot create two accounts for one person.
  email_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- 0 until mailbox control is actually proven. A signup that cannot send mail
  -- must not claim verification.
  email_verified INTEGER NOT NULL DEFAULT 0,
  -- 1 when the account must set a password through an admin-issued activation
  -- code before it can be used.
  requires_activation INTEGER NOT NULL DEFAULT 0,
  disabled_at TEXT,
  last_login_at TEXT,
  password_hash TEXT,
  password_updated_at TEXT
);

-- ---------------------------------------------------------------------------
-- buyer_sessions — server-managed, revocable sessions
--
-- Only the SHA-256 of the cookie token is stored: a leaked database cannot be
-- replayed as a live session. Expiry and revocation are checked server-side on
-- every request, so logout is immediate and not merely a cleared cookie.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS buyer_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES buyer_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS buyer_sessions_user_idx ON buyer_sessions (user_id);
CREATE INDEX IF NOT EXISTS buyer_sessions_expiry_idx ON buyer_sessions (expires_at);

-- ---------------------------------------------------------------------------
-- buyer_activation_tokens — admin-issued one-time codes
--
-- The owner approved this as the recovery path: there is no transactional email
-- provider at $0 (the only binding, send_email, delivers to verified
-- destinations only — it cannot mail a customer), so an admin issues a code and
-- hands it over out-of-band. Single use, short-lived, hash-only storage, and
-- regenerating one revokes the previous code.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS buyer_activation_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES buyer_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT,
  -- Admin identity that issued it (audit trail; the admin JWT subject).
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS buyer_activation_user_idx ON buyer_activation_tokens (user_id);
CREATE INDEX IF NOT EXISTS buyer_activation_active_idx ON buyer_activation_tokens (expires_at, used_at);

-- ---------------------------------------------------------------------------
-- buyer_rate_limits — shared, server-side rate limiting
--
-- The endpoint layer's existing limiter is per-warm-instance only (documented in
-- api/_lib/providers.ts), which is not a real brute-force control. This table is
-- durable and shared by every isolate, so login/signup/activation limits are
-- actually enforced.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS buyer_rate_limits (
  bucket TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- buyer_auth_audit — who did what, when
--
-- Required by the activation workflow (creation and redemption timestamps) and
-- used to investigate abuse. Never stores a token, code, or password.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS buyer_auth_audit (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  action TEXT NOT NULL,
  actor TEXT,
  subject_user_id TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS buyer_auth_audit_subject_idx ON buyer_auth_audit (subject_user_id, at);

-- ---------------------------------------------------------------------------
-- IMPORT PROVENANCE — state the identity situation honestly rather than letting
-- an empty table look like an un-migrated one.
-- ---------------------------------------------------------------------------
INSERT OR REPLACE INTO luxedge_data_provenance
  (table_name, source, source_captured_at, source_row_count, imported_row_count, imported_at, notes)
VALUES
  ('buyer_users', 'supabase:eidujmfbcfrjjleitaqp (profiles)', '2026-09-29', 0, 0, CURRENT_TIMESTAMP,
   'No real buyer identities exist to migrate: all 17 live auth users are QA fixtures (3 buyer-debug/contract@luxedge.us customers, 14 admin test logins on luxedge.test/tmp.lx/luxedge.local). Clean start; bcrypt hashes are NOT migrated by design.'),
  ('buyer_sessions', 'n/a', '2026-09-29', 0, 0, CURRENT_TIMESTAMP,
   'New server-managed sessions. Supabase session tokens are never copied into this system.'),
  ('buyer_activation_tokens', 'n/a', '2026-09-29', 0, 0, CURRENT_TIMESTAMP,
   'Admin-issued one-time activation/reset codes ($0 recovery path, no transactional email).');
