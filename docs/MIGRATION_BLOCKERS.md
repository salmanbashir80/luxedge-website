# Cloudflare migration — cutover blockers (updated 2026-09-29, third sprint)

Production runs Worker `cd544ac9-2672-44ac-a786-1f6f6a2078e3` (deployed
2026-09-30 with the admin-auth fix — §2b), the sitemap is still in emergency
mode (`x-luxedge-sitemap-mode: emergency`), the cutover switches (`DATA_BACKEND`)
remain unset, and the media gate (§3) is unchanged. Everything below was built
and verified on `luxedge-cloudflare-staging` (versions `1355ca21` → `2d92f6b6`)
and in the test suite; §2b was then re-verified live on production as well.

## 1. RESOLVED — order persistence (was "payment without an order")

Supabase PostgREST answers HTTP 402 for the service-role key as well, so a
customer could complete a real Stripe payment whose order row was never written.
That is now fixed on the D1 path:

* `cloudflare/d1/migrations/0002_commerce.sql` — `luxedge_orders`,
  `inventory_reservations`, `order_financials`, `processed_webhook_events`,
  including the two idempotency indexes (unique `stripe_session_id`, and the
  partial unique `stripe_payment_intent`).
* `worker/d1/commerce.ts` — the D1 implementation of the exact calls
  `api/checkout-onsite.ts`, `api/webhook.ts` and `api/admin/erp.ts` make, with a
  table/column allowlist, parameterised SQL, the four inventory RPCs
  (reserve/consume/release/decrement, upsert-free and atomically guarded
  against oversell), and Stripe event-id idempotency.
* Verified end-to-end against real SQLite in `api/__tests__/checkout-d1.test.ts`
  (checkout → pending order → paid, duplicate → 409, out-of-stock, declined
  payment, wrong amount, replayed verify) — 9 tests, all reading real rows.
* Production D1 and staging D1 both carry the schema **and** the 9 historical
  orders + 2 reservations, count-verified (`scripts/d1-import.mjs verify`).

### A second defect this uncovered

`api/checkout-onsite.ts` writes `shipping_method`, `shipping_carrier`,
`shipping_service`, `shipping_rate_id`, `paid_at` and `customer_phone` — and
**none of those columns exist on the live `luxedge_orders` table** (only the
unused `orders` table has some of them). So the insert was being rejected on the
Supabase path too: the failure was never only the 402. The columns are added in
`0002_commerce.sql` and recorded for Supabase in
`supabase/migrations/0033_luxedge_orders_checkout_columns.sql` (idempotent,
additive, NOT applied live).

## 2. RESOLVED — buyer authentication

All "17 buyer accounts" are **QA fixtures**, measured from the live `profiles`
export: 3 `customer` rows with `buyer-debug-*` / `buyer-contract-*` emails and 14
`admin` rows on `luxedge.test` / `tmp.lx` / `luxedge.local` (plus the owner's two
logins). `orders`, `order_items` and `addresses` are all empty. There is no real
buyer, so no bcrypt hash is migrated and no fixture account is preserved — the
implementation starts clean (the plan's PATH C).

* `cloudflare/d1/migrations/0003_buyer_auth.sql` — users, sessions, one-time
  activation tokens, durable rate limits, auth audit log. Only one-way values
  are stored: PBKDF2 hashes, and the SHA-256 of every session token / activation
  code.
* `worker/auth/password.ts` — PBKDF2-SHA256, versioned
  (`pbkdf2-sha256$v1$<iters>$<salt>$<hash>`), unique per-user salt, constant-time
  compare, `needsRehash()` for transparent upgrades. **Measured on the real
  runtime**: 100 000 iterations works, and the runtime hard-refuses more
  (`NotSupportedError: iteration counts above 100000 are not supported`), so
  100 000 is the platform ceiling and is documented as such rather than chosen.
* `worker/auth/store.ts` — sessions (HttpOnly + Secure + SameSite=Lax cookie;
  server-side expiry **and** revocation; rotation on every authentication; all
  other sessions revoked on a password change), activation codes (single use,
  expiring, regenerating revokes the previous one), durable rate limits, audit.
* `api/auth/index.ts` — signup / login / logout / me / activate / forgot /
  password, plus a benchmark route that is closed unless `AUTH_BENCH=1`. Identity
  always comes from the resolved session; no route accepts a user id or a role.
* `api/admin/buyers.ts` — admin-issued one-time codes (`requireAdmin`, the
  existing guard, unchanged) + account listing and disable.
* Client: `src/services/buyerAuth.ts`, wired into `src/store/authStore.ts` and
  `src/App.tsx` so **buyer** sign-in/up/out use the cookie routes. **Admin**
  sign-in uses the same routes too, gated by a server-derived role (see below).

39 security tests (`api/__tests__/auth-routes.test.ts`) cover registration,
duplicate email, activation (valid/wrong/expired/reused/regenerated/cross-user),
correct and wrong password, logout, expired/revoked/tampered sessions, protected
routes, two-user isolation, admin-vs-buyer authorization, login and activation
rate limits, CSRF/origin enforcement, session rotation, disabled accounts, and
self-service recovery (indistinguishable answers for known/unknown addresses,
no caller-chosen recipient, no lockout of a working account).
Live-verified on staging too (see the migration doc).

### 2b. RESOLVED (2026-09-30) — Admin Console HTTP 402 lockout

Admin sign-in was deliberately left on Supabase Auth while buyers moved to D1 —
and Supabase Auth answers the project-wide 402, so `https://luxedge.us/admin/login`
showed **HTTP 402** and the owner was locked out of their own store.

* `cloudflare/d1/migrations/0004_buyer_roles.sql` — `buyer_users.role`
  (`'buyer'` default) + index; applied to **staging and production** D1.
* `api/_lib/auth.ts` `sessionAdmin()` — resolves the cookie server-side and
  re-reads `role` from the row; `adminAuth` checks it first, so a buyer cookie
  gets 403 and can never fall through to the legacy JWT/remote-verify paths
  (which stay as rollback routes).
* `src/App.tsx` / `src/store/authStore.ts` — admin sign-in calls
  `POST /api/auth/login`; `ACTIVATION_REQUIRED` switches the login card to an
  activation form (code + new password ≥ 10 chars).
* `scripts/bootstrap-admin.mjs` — breaks the first-admin chicken-and-egg locally
  via `wrangler d1 execute` (issuing a code already requires an admin): ensures
  the identity with `role='admin'`, prints ONE activation code (SHA-256 only is
  stored; re-running revokes the old code). Parity with `worker/auth/tokens.ts`
  is asserted by `scripts/bootstrap-admin.test.ts`.

Verified live on staging v `2d92f6b6`: login-before-activation `403
ACTIVATION_REQUIRED` (not 402), activate `200`, login `200 role=admin` +
`lx_buyer` cookie, `/api/admin/buyers` `200`/`401`/`403` (cookie/none/buyer),
UI login renders the dashboard, buyer signup/login unchanged and still barred
from admin routes.

**Shipped to production** (2026-09-30): v `704d9643`, then `cd544ac9` which
fixed a 503 the first deploy exposed — `api/admin/buyers.ts` had its own
`rt.backend === 'd1'` gate, so with `DATA_BACKEND` unset an admin could sign in
but not list accounts; it now keys off the `DB` binding like `authDb()` (the
`isD1Backend()` storefront cutover gates are untouched). Re-verified on
`luxedge.us`: `ACTIVATION_REQUIRED` (not 402) → activate `200` → login `200
role=admin` → admin list `200`/`401`, browser login renders the dashboard, and
`POST /api/auth/login` no longer produces any auth 402.

### 2c. RESOLVED (2026-10-01) — self-service "send me a code"

Recovery no longer needs the owner to be sitting in the Admin Console first.
`POST /api/auth/forgot` takes an email address, issues a one-time code through
the same `issueActivationCode()` the admin route uses, and mails it with the
`SEND_MAIL` binding. `src/App.tsx` exposes it as **Forgot password? → Send me a
one-time code** on `/admin/login`, and as **Forgot password?** on the buyer
sign-in page (which now shows the server's own wording in a notice banner).

Three properties are load-bearing and each has a test:

* **No enumeration oracle.** Known and unknown addresses get a byte-identical
  200, including the delivery wording. The response describes the *deployment*
  (does this Worker have a mail binding?), never the account. Whether a message
  actually went out is recorded in `buyer_auth_audit`, not returned.
* **No caller-chosen recipient.** The destination is a server constant — the
  account's verified address (`8002salman@gmail.com`, `RECOVERY_MAIL_TO`). A
  `to` in the request body is ignored, so the route cannot be repurposed as a
  relay. This is the same trust model as the admin-issued codes, automated.
* **No lockout.** Self-service issuance passes `markRequiresActivation: false`,
  so a request can never set `requires_activation = 1` on an account that has a
  working password. Anyone can type anyone's address into a public form; if that
  could disable the password, the form would be a denial-of-service for every
  account. Redemption still replaces the password. Rate limited 10/h per IP and
  3/h per address (each issue revokes the previous code, so a flood would also
  keep invalidating a legitimate one).

`[[env.staging.send_email]]` was added to `wrangler.toml`: without it, staging
could not deliver and the only path that matters — does a real code actually
reach the inbox? — was untestable before shipping. Verified live on both: the
audit log shows `recovery_code_requested` followed by `recovery_code_mailed`
(Cloudflare accepted the message) on staging v `eaf095f4` and production v
`22386778`.

### The one thing that genuinely does not exist at $0

**Email goes to the owner's verified inbox, not to the customer.** The only
binding available is Cloudflare's `send_email`, which by design posts to
*verified destinations* — it cannot mail an arbitrary customer. So a recovery
request mails the code to the operator, who relays it, and the buyer redeems it
at `/account` or `/admin/login`. New signups work immediately and are marked
`emailVerified: false` honestly, because nothing was sent. Sending to arbitrary
recipients would need the Workers Paid plan (or a real transactional provider).

## 3. STILL BLOCKED — 335 product images

Unchanged and re-verified live this sprint: every Supabase Storage object still
returns **HTTP 402 `exceed_egress_quota`**, so recovery is impossible and the
bytes exist only behind that service. `scripts/supabase-image-recovery.mjs`
probes one object first and, on 402, exits having changed nothing (run this
sprint: `probe -> HTTP 402 -> restricted`, no download, no edit). When Storage
answers 200 it downloads, verifies the real image signature, deduplicates by
content hash, writes `public/product-media/<hash>.<ext>` (static assets — R2 is
forbidden, it needs a card) and emits the D1 UPDATE statements for deliberate
application.

69 of the 71 affected products have no other image anywhere. No placeholder or
lookalike was substituted, because that would be fabricating product data.

## 4. NOT DONE ON PURPOSE — static routing is unchanged

`run_worker_first = true` remains. Pattern-array form is supported by the
installed Wrangler, but enumerating "page routes" is not possible (client routes
are arbitrary), and with `not_found_handling = "none"` every non-enumerated SPA
route would 404 from the Asset Worker. The obvious alternative — switching to
`single-page-application` — is the change `wrangler.toml` records as having
caused the "stale shell answered with HTML / page hangs on text" incident. This
needs a browser-level staging pass, not a guess, so it is reported as **not
optimised** rather than shipped.

## 5. Deliberately NOT done

| Not done | Reason |
| --- | --- |
| Production cutover | §3 fails the media gate |
| Any production deploy at all | Not permitted while a mandatory gate is red |
| Enabling R2 | Requires a payment method — forbidden |
| Deleting/altering Supabase or its Storage | Retained as recovery source and archive |
| Migrating admin auth | It keeps its existing verified-JWT guard |
| Touching `ads.txt` / AdSense / consent code | Explicitly out of bounds |
| Committing identity data | The "17 accounts" are fixtures; nothing to migrate |

## 6. Owner decision still open

**Images.** Either wait for Supabase Storage to be restored/renewed (then run the
recovery utility, which does the rest), or accept a cutover while 335 images are
broken — they are broken *today*, so it is not a regression, but it is not a
quality bar this migration should set on its own.

Until that is answered the honest verdict stays
`MIGRATION READY — WAITING FOR SUPABASE STORAGE IMAGE RECOVERY`.
