# Deployment Provenance

Maps each **live production artifact** back to the exact commit that produced it.

Why this file exists: production is served by a Cloudflare Worker built from a *working tree*, not
from a tag or CI pipeline. A Worker version ID (e.g. `2b90d11b-…`) therefore says nothing on its own
about which code is running. Each deploy that matters gets an entry here so the question
"*what commit is live right now?*" has a written, checkable answer.

**Production host:** `https://luxedge.us`
**Worker:** `luxedge-production` (`wrangler.toml`: `main = "worker/index.ts"`, assets from `dist/`)
**Account:** `f542683e97458480452b0b8ef37a898a`
**Deploy command:** `WRANGLER_SEND_METRICS=false npx wrangler deploy --name luxedge-production`
(see `docs/SALMAN_OS_SEO_BRIDGE.md`)

---

## Ledger

### Entry 1 — Luxedge Sales & Profit Management

| Field | Value |
| --- | --- |
| Feature | Luxedge Sales & Profit Management module (`/admin/sales`) |
| **Live Worker version** | `2b90d11b-12bf-4f38-9a81-c5147d110ac8` |
| Worker version created | `2026-09-24T20:16:22.038Z` |
| Deploy author | `8002salman@gmail.com` |
| **Commit that is live** | `2a2a14cc769b0aabd45d9fe6a938d4bb989ec8a8` |
| Commit subject | `feat(sales): add Luxedge Sales & Profit Management admin module` |
| Base (parent) commit | `d6a851654e7cdb08bd676a4af04277ba5b7097e8` |
| Commit date | `2026-09-25` |

**Important ordering note:** the Worker was deployed *before* the commit existed — the deploy came
from the uncommitted working tree. Commit `2a2a14c` was created afterwards from that same tree and
is byte-for-byte the code that was deployed, which is why this entry records a commit that is newer
than the deploy.

**Evidence that `2a2a14c` == the live artifact**

| Check | Result |
| --- | --- |
| Fresh `npm run build` of `2a2a14c` vs live `/assets/index-D8mU0Fu2.js` | byte-identical, sha256 `640914db172ba0b33a8acaf4b0b709dd9ac1525747b23d7807dd1ccf0353865c` (632,763 bytes) |
| Fresh build vs live `/assets/AdminSection-CJfT5f7f.js` | byte-identical, sha256 `1fc54277db19cc20c05e38a410b9eed79b91de295fff3065ec4594c9a7c313da` (1,696,270 bytes) |
| `GET /api/admin/sales` with no session | `401` (admin-gated route is live; was `404` before the deploy) |
| Authenticated production click-through | all 5 tabs (Overview / Orders / Expenses / Reports / Export-Sheets) rendered real content; every `/api/admin/sales` call `200`; console clean; no writes |
| Test suite | 1617 passed, 8 skipped |
| Migration | `0032_sales_management.sql` applied and live-verified |

---

### Entry 2 — Safe sitemap fallback + egress reduction (issue #138)

| Field | Value |
| --- | --- |
| Fix | `/sitemap.xml` degrades to a minimal static emergency feed when the DB is unavailable; `product_images` reads gain the server-side `url=not.like.data:*` egress filter |
| **Live Worker version** | `d18b84bb-5a21-486e-80d1-9742271d0f80` |
| Worker version created | `2026-09-29` |
| Deploy author | `8002salman@gmail.com` |
| **Commit that is live** | `476a492779d50e13de4f9c0d8742ba321b5cb946` |
| Commit subject | `fix(seo): add safe sitemap fallback and reduce Supabase egress` |
| Base (parent) commit | `e7ea2d1` |

**Context:** Supabase `eidujmfbcfrjjleitaqp` is API-restricted (HTTP 402 `exceed_egress_quota`), so the previous fail-closed sitemap returned 503 (issue #138). This deploy serves a valid 12-URL static emergency feed (`X-Luxedge-Sitemap-Mode: emergency`) until the quota resets; dynamic mode resumes automatically on recovery.

**Evidence that `476a492` == the live artifact**

| Check | Result |
| --- | --- |
| `GET /sitemap.xml` | `200`, `application/xml; charset=utf-8`, `x-luxedge-sitemap-mode: emergency` (the replaced code path cannot emit that header) |
| Emergency body | valid XML, exactly 12 static URLs, zero `/product/`, `/category/`, `/blog`, `/shop` paths |
| `GET /robots.txt` | `200`, still references `https://luxedge.us/sitemap.xml` |
| `/`, `/about`, `/privacy`, `/shop` | all `200` |
| `GET /google-products.xml` | `502` — expected while the DB is 402-restricted; no fabricated feed data |
| Assets | upload reported no changed asset files; SPA hashes match Entry 1 (`index-D8mU0Fu2.js`) |
| Test suite | 1629 passed, 8 skipped; `tsc --noEmit` at the 6-error baseline; `npm run build` green |

---

### Entry 3 — Cloudflare D1 storefront read path (STAGING ONLY)

| Field | Value |
| --- | --- |
| Feature | D1-backed storefront reads + public `/api/db` API (staging verification) |
| Environment | `luxedge-cloudflare-staging` — **not production** |
| **Staging Worker version** | `6f515b4a-b7e9-4d7c-b5be-4f24191cefc8` |
| Deploy date | `2026-09-29` |
| **Commit that is live on staging** | `db31ccb7e7e28ad99a07918c8e1d9e10da99ac1f` |
| Commit subject | `feat(cloudflare): add D1-backed storefront read path and public data API` |
| Base (parent) commit | `c0b7c6c6676c14125da440ae4fbd39dea65d9614` |
| Build | `VITE_DATA_BACKEND=d1 npm run build` (baked so the SPA exercises the D1 path) |
| D1 databases | `luxedge-staging-db` `41b939a3-f7ee-4d8c-8bf5-83d6f8dbe0d2`, `luxedge-production-db` `43bbff72-1294-4aa8-a3f0-24ea74e82c20` (created, empty) |

**Production is unchanged by this entry.** `luxedge-production` still runs
`d18b84bb-5a21-486e-80d1-9742271d0f80` on Supabase, which is why `/shop` shows 0
products — see `docs/CLOUDFLARE_MIGRATION.md` for the blockers.

**Evidence gathered against staging**

| Check | Result |
| --- | --- |
| `/sitemap.xml` | `200`, `x-luxedge-sitemap-mode: dynamic`, 65 URLs (32 `/product/`, 10 `/category/`, 9 `/blog/`) served from D1 |
| `/api/db/products` | `200 application/json` with real rows |
| `/api/db/products?select=id,owner_notes` | `400` — non-public column refused |
| `/api/db/app_settings` | `404` — secrets table unreachable |
| `select=*` / `POST` | `400` / `405` |
| `/shop` | renders **32 products** (was 0 in production) |
| Import verification | 10/10 tables source count == exported count == imported count |

### Entry 4 — D1 commerce persistence + buyer authentication (STAGING ONLY)

| Field | Value |
| --- | --- |
| Feature | Orders persisted in D1 (checkout/webhook/ERP ledger) + Cloudflare-native buyer auth |
| Environment | `luxedge-cloudflare-staging` — **not production** |
| **Staging Worker version** | `1355ca21-c436-461d-afde-99e411e7d520` |
| Deploy date | `2026-09-29` |
| **Commit that is live on staging** | `a894718da4bc2519c80363eb1f5fa5f6256d8ddf` |
| Commit subjects | `fix(commerce): persist Stripe orders in Cloudflare D1` (`91514a0`), `feat(auth): replace restricted Supabase buyer auth with D1 sessions` (`a894718`) |
| Pushed | `2e5ca2b..a894718` on `main` (both commits are on origin — nothing here is local-only) |
| D1 migrations applied | `0002_commerce.sql`, `0003_buyer_auth.sql` — to **staging and production** D1 (schema only) |

**Production is unchanged by this entry.** `luxedge-production` still runs
`d18b84bb-5a21-486e-80d1-9742271d0f80`; the new routes are absent there
(`GET /api/auth/me` → `404`) and `/sitemap.xml` is still
`x-luxedge-sitemap-mode: emergency`. The production D1 binding remains inert
(no `DATA_BACKEND` var).

**Evidence gathered against staging**

| Check | Result |
| --- | --- |
| `POST /api/auth/signup` with no `Origin` header | `403 {"error":"Missing Origin header."}` (CSRF guard live) |
| `POST /api/auth/signup` (Origin + JSON) | `200` + `Set-Cookie: lx_buyer=…; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` |
| `GET /api/auth/me` with that cookie / without it | `200` (same user) / `401` |
| `POST /api/auth/login` correct / wrong password | `200` (rotated token) / `401 {"code":"INVALID_CREDENTIALS"}` |
| `POST /api/auth/logout`, then replay the old cookie | logout `200`, replay `401` — revocation is server-side |
| KDF benchmark (`/api/auth/_bench`, `AUTH_BENCH=1`) | 100 000 iterations `200`; 120 000+ → `NotSupportedError: iteration counts above 100000 are not supported` |
| D1 counts after import (production **and** staging, identical) | products 117, product_images 427, categories 11, coupons 14, blog_posts 10, media_videos 27, luxedge_orders 9, inventory_reservations 2, buyer_users 0 |
| Staging test account | created, verified, then deleted — `buyer_users` and `buyer_sessions` are empty again |
| `/api/auth/_bench` after the final deploy | `404` (the benchmark var is removed; the route is closed) |

The intermediate staging versions from the same sprint were
`44220acf` (first auth deploy), `5af600da` (bench diagnostics), `463cb84b`
(100 000-iteration KDF), then the final `1355ca21` with the benchmark route
disabled.

---

### Entry 5 — Admin Console 402 unlock (STAGING ONLY)

| Field | Value |
| --- | --- |
| Feature | Admin sign-in moved off the restricted Supabase Auth to D1 sessions (server-derived `role`) + first-admin bootstrap CLI |
| Environment | `luxedge-cloudflare-staging` — **not production** |
| **Staging Worker version** | `2d92f6b6-171a-4794-888d-2ab20cd59120` |
| Deploy date | `2026-09-30` |
| **Commit that is live on staging** | `237d08b3d716b1ad8fd21217f91c89d6a6100cc5` |
| Commit subject | `fix(auth): unlock the Admin Console from the Supabase 402 lockout` |
| Base (parent) commit | `f0618aa95b950d41e4b4b93762d96b1ef4d14681` |
| D1 migrations applied | `0004_buyer_roles.sql` — to **staging and production** D1 (additive: `buyer_users.role` + index) |

Ordering note (same as Entry 1): the Worker was deployed from the working
tree *before* the commit existed; `237d08b` was then created from that same
tree and is byte-for-byte the code that is live on staging.

**Production is unchanged by this entry.** `luxedge-production` still runs
`d18b84bb-5a21-486e-80d1-9742271d0f80`, so `https://luxedge.us/admin/login`
still shows the 402 until the fix is deployed there. Production D1 carries the
0004 schema (harmless: no code reads `role` until the Worker ships) and the
`DB` binding is still inert (no `DATA_BACKEND` var).

**Evidence gathered against staging (live network, 2026-09-30)**

| Check | Result |
| --- | --- |
| `POST /api/auth/login` before activation | `403 {"code":"ACTIVATION_REQUIRED"}` — was `HTTP 402` from Supabase Auth |
| `node scripts/bootstrap-admin.mjs --db staging` | identity ensured with `role='admin'`; one-time code printed once (hash only in D1), expires 14 days |
| `POST /api/auth/activate` (email + code + password) | `200` `role:"admin"`, `requiresActivation:false` |
| `POST /api/auth/login` after activation | `200` + `Set-Cookie: lx_buyer=…` + `role:"admin"` |
| `GET /api/auth/me` with that cookie | `200` (role re-derived from the D1 row) |
| `GET /api/admin/buyers` cookie / none / buyer cookie | `200` / `401` / `403 "admin role required"` |
| UI login at `/admin/login` (browser) | lands on the rendered `/admin` dashboard; network shows `POST /api/auth/login → 200`, no auth 402 |
| Buyer regression | signup `200 role:"buyer"`, login `200`, buyer cookie on admin API `403`; QA account deleted afterwards |
| Remaining console 402s on `/admin` | only `supabase.co/rest/v1/{products,product_variants,product_images,categories}` — the known storefront-read gate, out of scope for this fix |

Suite state at deploy: `npx vitest run` 1,741 passed / 8 skipped / 0 failed
(134 files, incl. `scripts/bootstrap-admin.test.ts` parity + 3 new admin-auth
security tests); `tsc --noEmit` still reports exactly the 6 pre-existing
baseline errors; `npm run build` clean.

---

### Entry 6 — Admin Console 402 unlock, LIVE ON PRODUCTION

| Field | Value |
| --- | --- |
| Feature | Admin sign-in on D1 sessions + first-admin bootstrap, shipped to `luxedge.us` (incl. the `/api/admin/buyers` 503 fix) |
| Environment | **`luxedge-production` — live** |
| **Live Worker version** | `cd544ac9-2672-44ac-a786-1f6f6a2078e3` (first upload `704d9643-e915-4be1-b534-ae4d029f600a`) |
| Deploy date | `2026-09-30` |
| **Commit that is live** | `7f31e2d4ef3181d132eb5946a613d0c11714c42f` |
| Commit subjects | `fix(auth): unlock the Admin Console from the Supabase 402 lockout` (`237d08b`), `fix(auth): let admins manage buyer accounts without DATA_BACKEND` (`7f31e2d`) |
| Base (parent) commit | `a751e99109c16a41dfd11a74a9165184f5a5fea6` |
| Deploy command | `env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID npx wrangler deploy --keep-vars` (bindings verified intact: `SEND_MAIL`, `DB (luxedge-production-db)`, all vars) |
| D1 migrations | `0004_buyer_roles.sql` applied to production D1 **before** the deploy (additive, inert until this Worker) |

Ordering note (same as Entries 1 and 5): the first deploy (`704d9643`) came
from the working tree before the fix commit existed; the follow-up deploy
(`cd544ac9`) carried the `api/admin/buyers.ts` gate fix; `7f31e2d` was then
committed from that tree and is byte-for-byte the code now serving production.

**Evidence gathered against `https://luxedge.us` (live, 2026-09-30)**

| Check | Result |
| --- | --- |
| `POST /api/auth/login` before activation (the reported bug) | `403 {"code":"ACTIVATION_REQUIRED"}` — previously `HTTP 402` from Supabase Auth |
| `node scripts/bootstrap-admin.mjs --db production` | identity `admin@luxedge.us` created with `role=admin`; one-time code printed once (SHA-256 stored only) |
| `POST /api/auth/activate` → `POST /api/auth/login` | `200 role:"admin"` → `200 role:"admin"` + `Set-Cookie: lx_buyer=…` |
| `GET /api/admin/buyers` cookie / none | `200` (account list) / `401` — after the `cd544ac9` gate fix (first deploy answered `503 "Database unavailable."`) |
| Browser login at `luxedge.us/admin/login` | renders dashboard as Store Owner; `POST /api/auth/login → 200`, no auth 402 |
| `GET /sitemap.xml` after deploy | `200`, `x-luxedge-sitemap-mode: emergency`, 12 URLs — unchanged |
| Storefront reads | still `supabase.co/rest/v1` 402 (cutover switches remain unset — by design, see blockers doc) |

Suite state at deploy: `npx vitest run` 1,741 passed / 8 skipped / 0 failed;
`tsc --noEmit` exactly the 6 baseline errors; `npm run build` clean.

---

### Entry 7 — Self-service recovery codes, LIVE ON PRODUCTION

| Field | Value |
| --- | --- |
| Feature | `POST /api/auth/forgot` + "Forgot password?" on `/admin/login` and the buyer sign-in page; code mailed to the account's verified inbox |
| Environment | **`luxedge-production` — live** (staging `luxedge-cloudflare-staging` also live) |
| **Live Worker version** | production `22386778-f0ad-49d2-8469-222956fde8d2`; staging `eaf095f4-1746-4720-b3de-ab8d1f3a7a25` (first staging upload `0d4f7e6a-977c-4498-b051-b49215637198`) |
| Deploy date | `2026-10-01` |
| **Commit that is live** | the commit that adds this entry — subject `feat(auth): let accounts request their own one-time recovery code`. Deployed from the working tree before it was committed (same ordering note as Entries 1, 5, 6). |
| Base (parent) commit | `1116c23e6e1b0baf4e5673aab40feb82159b265f` (docs entry 6) |
| Deploy commands | `env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID npx wrangler deploy --env staging`, then `… npx wrangler deploy --keep-vars` (production bindings verified intact: `SEND_MAIL`, `DB (luxedge-production-db)`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, `YOUTUBE_*`) |
| Config change | `[[env.staging.send_email]] name = "SEND_MAIL"` added to `wrangler.toml` — staging had no mail binding, so the one path that matters (a real code reaching the inbox) was untestable before shipping |
| D1 migrations | none (no schema change; `issueActivationCode` gained an option only) |

Ordering note (same as Entries 1, 5 and 6): the staging deploy ran before the
edit that added the staging mail binding — the first staging upload therefore
honestly answered `channel: "operator-manual"` — and the second upload
(`eaf095f4`) is the one that can deliver.

**Hash-level proof**

```
sha256(dist/assets/index-C7Otebn4.js) = 20f417cca44427b0017b496b88f426e10d17cdbddc4b2468f4b1c0af8d74aa0d
sha256(curl https://luxedge.us/assets/index-C7Otebn4.js) = 20f417cca44427b0017b496b88f426e10d17cdbddc4b2468f4b1c0af8d74aa0d
```

**Evidence gathered live (2026-10-01)**

* `POST /api/auth/forgot` on `luxedge.us` → `200 {ok:true, channel:
  "email-operator", delivery:{configured:true}}`; the **same body** for an
  address with no account (no enumeration oracle).
* Cross-origin POST (`Origin: https://evil.example`) → `403`, nothing written.
* A caller-supplied `to` is ignored: the mail still goes to
  `RECOVERY_MAIL_TO` and `attacker@evil.example` never appears in the message.
* `buyer_auth_audit` on production shows `recovery_code_requested` followed by
  **`recovery_code_mailed`** for `admin@luxedge.us` — Cloudflare accepted the
  send (a rejection would have logged `recovery_code_mail_failed` instead).
  The same pair appears on staging.
* `/admin/login` renders both **Forgot password?** and **Have an activation
  code? Use it →**, and the forgot card names the verified inbox it will mail.
* No regression: `GET /sitemap.xml` still `200`; `npx tsc --noEmit` exactly the
  6 baseline errors; `npx vitest run` 1750 passed / 8 skipped / 0 failed;
  `npm run build` clean.

## Adding an entry

1. Note the Worker version `npx wrangler deployments list` reports for the deploy (with
   `env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID` if a stray API token shadows your login).
2. Commit the deployed tree.
3. Add a row here with the Worker version, the commit SHA, and at least one hash-level comparison
   between a fresh build and the live asset.

## Verifying an entry

```bash
# 1. which Worker versions exist, newest first
env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID \
  npx wrangler deployments list --name luxedge-production

# 2. rebuild the recorded commit in a throwaway worktree, so your own checkout is never touched
git worktree add --detach /tmp/luxedge-provenance <commit>
(cd /tmp/luxedge-provenance && npm ci && npm run build)
sha256sum /tmp/luxedge-provenance/dist/assets/index-D8mU0Fu2.js
curl -fsS https://luxedge.us/assets/index-D8mU0Fu2.js | sha256sum
git worktree remove /tmp/luxedge-provenance
```

Equal hashes mean the recorded commit is what production is serving. A mismatch means something was
deployed that was never committed — add an entry documenting the uncommitted delta rather than
silently rewriting this one.
