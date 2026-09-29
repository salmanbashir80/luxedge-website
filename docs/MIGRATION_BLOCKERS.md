# Migration blockers — evidence and the decision the owner must make

Companion to [CLOUDFLARE_MIGRATION.md](CLOUDFLARE_MIGRATION.md). Every claim here
was verified against live systems on 2026-09-29; nothing is inferred. Read this
before approving a production cutover.

## Status summary

| Gate | State |
| --- | --- |
| D1 schema + storefront read path | ✅ built, verified on staging |
| Production D1 data | ✅ populated, counts verified |
| **Buyer auth** | ❌ **cannot be migrated safely at $0** |
| **Product images** | ❌ **335/427 bytes unreachable** |
| **Commerce order persistence** | ❌ **broken today by the same 402** |
| Static-asset routing | ⚠ prepared, not shipped |
| Production cutover | 🚫 not taken |

---

## 1. Buyer auth (PHASE 2 / 3 / 4 / 5)

### Live reality

| Fact | Value |
| --- | --- |
| `auth.users` total | **17** |
| email-confirmed | 15 |
| ever signed in | 13 |
| **signed in within 30 days** | **12** |
| password-bearing | 17 |
| **password hash algorithm** | **`$2a$` bcrypt, length 60 — all 17** |
| identity providers | `email` ×17 (no OAuth) |
| account creation window | 2026-08-11 → 2026-09-06 |
| `public.profiles` | 17 rows |
| `public.customers` | 3 rows |
| **`wishlist_items`** | **table does not exist** — the wishlist is `localStorage`-only |
| `addresses` / `orders` | 0 rows |
| `luxedge_orders.user_id` | column does not exist |

### AUTH FEATURE MATRIX

| Feature | Current implementation | Required for cutover | Replacement |
| --- | --- | --- | --- |
| Signup | Supabase GoTrue `signUp` (`src/services/supabase.ts:235`) | yes | Worker + D1 (PBKDF2) |
| Login | GoTrue `signInWithPassword` (`:218`) | yes | Worker + D1 (PBKDF2 verify) |
| Logout | GoTrue `signOut` (`:253`) | yes | delete D1 session + clear cookie |
| Session refresh | GoTrue token refresh (`getSession`, `getFreshAccessToken`) | yes | opaque session + sliding expiry |
| Password reset | GoTrue email reset — **not implemented in the app** | yes | **blocked — see below** |
| Email verification | GoTrue `email_confirmed_at` | desirable | **blocked — see below** |
| Profile | `public.profiles` (17 rows) | yes | D1 (or defer) |
| Wishlist ownership | `localStorage` only, no server table | no server change | none needed |
| Cart ownership | `localStorage` | no | none |
| Order ownership | `orders`/`addresses` empty; no `user_id` on `luxedge_orders` | yes | D1 orders (see §3) |
| Admin role | separate token route, **not** Supabase Auth | unchanged | leave as-is |
| API authorization | `getAccessToken()`/`getFreshAccessToken()` (18/11 call sites) | yes | session cookie → server-side resolve |

### Why credentials cannot be migrated

All 17 accounts use **bcrypt `$2a$`**. bcrypt is not available in WebCrypto, so
verifying it in a Worker means a pure-JS implementation. On the **Workers Free
plan the CPU budget is 10 ms per request**, and a cost-factor-10 bcrypt verify
costs far more than that — the request would be killed with Error 1102.

> Do not weaken password security to fit the CPU budget. Do not re-hash bcrypt
> with a cheaper KDF.

**Therefore PATH B applies: migrate identities (ids/emails/profile ownership) and
require secure password re-enrollment.** This is safe to choose because those
accounts are **already locked out today** — Supabase Auth returns 402 — and they
own no server-side data that could be lost (wishlist is local, orders/addresses
are empty).

### Why password reset also cannot be delivered at $0

Reset is mandatory for PATH B (`12` accounts signed in within 30 days). The only
email infrastructure in the repo is the Cloudflare **`send_email` (`SEND_MAIL`)
binding** (`api/email/send.ts`, `api/email/contact.ts`, `wrangler.toml`), which by
design delivers **only to verified destination addresses** — it is an owner
notification channel, not a transactional provider for arbitrary buyer inboxes.
Adding a real transactional provider means a new (paid, card-requiring) service,
which the rules forbid.

Remaining $0-compatible option, for the owner to approve: **admin-issued one-time
reset codes**. The owner already has authenticated admin access and only 17
accounts exist, so identity can be confirmed out-of-band and a code issued from
the admin panel. This needs a small admin endpoint but no email provider.

**Auth is therefore BLOCKED pending a decision, not merely unimplemented.**

---

## 2. Product images (PHASE 7 / 8 / 9)

Live `product_images` (427 rows) by host:

| Host | Rows | Reachable |
| --- | --- | --- |
| `eidujmfbcfrjjleitaqp.supabase.co` (Storage) | **335** | ❌ HTTP 402 |
| `cf.cjdropshipping.com` | 42 | ✅ |
| `ae-pic-a1.aliexpress-media.com` | 24 | ✅ |
| `oss-cf.cjdropshipping.com` | 11 | ✅ |
| `images.pexels.com` | 5 | ✅ |
| `cdn11.bigcommerce.com` | 4 | ✅ |
| `himalayankoh.com` | 4 | ✅ |
| `upload.wikimedia.org` | 1 | ✅ |
| `luxedge.us` | 1 | ✅ |

### Every legitimate recovery source was checked

| Source | Result |
| --- | --- |
| Supabase Storage (public object URL) | 402 |
| Supabase Management API `/storage/buckets` | **402** (same restriction) |
| Supabase Management API object download | endpoint does not exist (404) |
| Local repository `public/**` (basename match) | **6 of 335** |
| `products.image_url` / `og_image` fallback | 2 of 71 affected products |
| `storage_path` hint → local file | 6 |
| Working external hosts for the same products | covered only 2 |
| Local backup artifacts (`.freebuff/audit/imgs*.json`) | partial snapshots, 3 `data:` rows |

**Result: of the 71 affected products, 69 have no working image from any
legitimate source.** The bytes exist only inside the restricted Storage service.

`scripts/image-recovery-audit.mjs` reproduces this audit. It never substitutes a
visually similar image and never invents a URL.

### Why R2 / Static Assets cannot solve it

- R2 is **not enabled** (API `10042`) and enabling it requires a payment method → forbidden.
- Static Assets can host bytes we *have*; we do not have these 335 files.

**This is a genuine capacity/access blocker, not a routing problem.** It resolves
by itself only if Supabase's egress quota resets or the owner restores the
project — at which point the same pipeline can mirror the images into the repo or
R2 if the owner later adds a payment method.

---

## 3. Commerce (PHASE 15) — severely broken today

Verified code paths:

- `api/checkout-onsite.ts:484` → `POST /rest/v1/luxedge_orders` (order insert).
- `api/checkout.ts:62` → `POST /rest/v1/rpc/<fn>` (order RPC).
- `api/webhook.ts` → Supabase REST writes for payment/fulfilment state.
- `api/admin/erp.ts` → `luxedge_orders` reads/writes.

With Supabase REST at **402**, these all fail. **A customer can pay and the order
cannot be persisted.** `luxedge_orders` holds 9 rows; `orders`/`order_items`/
`payments`/`order_financials` are empty.

Minimum work to clear this gate (not attempted — see §5):
1. Add `luxedge_orders` (29 columns) to the D1 migration lineage and import its 9 rows.
2. Move the order insert + webhook state transitions to server-side D1 writes
   (the Worker already holds the `DB` binding; the service-role key must not be
   needed for this).
3. Re-run checkout in Stripe test mode and prove a row lands.

This must not be done hastily: it is the payment path.

---

## 4. Static-asset routing (PHASE 10 / 11)

`run_worker_first = true` makes every JS/CSS/image/font request a Worker
invocation (~8–10 per page view → only ~9–12k page views/day before Error 1027).

Wrangler's installed schema accepts a **pattern array** for `run_worker_first`,
so static assets can bypass the User Worker. Not shipped: with
`not_found_handling = "none"` an incorrect enumeration returns a real 404 for SPA
routes, and the current value exists to stop stale hashed assets being answered
with HTML (`wrangler.toml` documents that failure). A staging pass is required
first; staging is where this should be proven.

---

## 5. What was deliberately NOT done, and why

| Not done | Reason |
| --- | --- |
| Production cutover | Blocked by §2 (media) and §1/§3 per the stated gates |
| Buyer auth implementation | Reset/verification delivery is undecidable at $0; needs the owner's choice in §1 |
| Checkout rewire to D1 | Payment path; must be a deliberate, separately verified change |
| Enabling R2 | Requires a payment method — forbidden |
| Deleting/altering Supabase | Retained as the recovery source and archive |
| Touching `ads.txt` / AdSense / consent code | Explicitly out of bounds |

## 6. Decisions needed from the owner

1. **Password reset delivery** — approve admin-issued one-time reset codes (only
   $0 option), or authorise a transactional email provider.
2. **Images** — accept a cutover with 335 broken images (it is not a regression:
   they are broken *now*), or wait for Supabase to be restored/renewed before
   mirroring and cutting over.
3. **Ordering** — fix commerce persistence (§3) before or after the read cutover.

Until (1) and (2) are answered, the honest verdict stays
`MIGRATION BLOCKED — AUTH/MEDIA/COMMERCE REQUIREMENT NOT SAFELY MET`.
