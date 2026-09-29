# Luxedge → Cloudflare-first, $0 architecture

Migration of the storefront's Supabase data dependency to Cloudflare D1, with the
emergency sitemap it was forced by. Status, evidence, runbook and remaining
blockers live here; update this file whenever the cutover state changes.

## Why this migration exists (the incident)

Supabase project `eidujmfbcfrjjleitaqp` is hard-restricted:

```
HTTP 402 {"message":"Service for this project is restricted due to the following
violations: exceed_egress_quota. The project owner must upgrade their plan or
remove spend caps to restore service."}
```

That is **project-wide**, not key/RLS/schema: PostgREST, Supabase Auth **and
Supabase Storage** all return 402 for the anon key *and* the service-role key.
Verified 2026-09-29.

Consequences actually observed in production (not inferred):

| Surface | State with Supabase 402 | Evidence |
| --- | --- | --- |
| `/shop` | renders **0 products** | browser snapshot: "0 products / New premium pet essentials are being curated" |
| Product images | **335 of 427** (78%) are Supabase-Storage URLs → 402 | host histogram of the live `product_images` export |
| `/sitemap.xml` | emergency static feed (12 URLs) | `x-luxedge-sitemap-mode: emergency` |
| Supabase Auth | 402 → sign-in unavailable | `/auth/v1/health` 402 |
| `/google-products.xml` | 502 (its DB-unreachable branch) | live probe |

The storefront was **silently broken** — the same "empty with no console error"
failure mode `AGENTS.md` already documents for PostgREST select-400s.

## The export route (why the migration was unblocked)

The **Supabase Management API** SQL endpoint is independent of the PostgREST
restriction and still works:

```
POST https://api.supabase.com/v1/projects/<ref>/database/query
Authorization: Bearer <personal access token>
```

So the live schema and data were readable for a real migration. Tooling:
`scripts/supabase-export.mjs` (read-only by construction — it refuses any
statement that is not a single `SELECT`/`WITH`).

Captured 2026-09-29: **673 columns / 53 tables / 8,013 rows**, all non-empty
tables exported to a local logical backup with exact counts verified
(`products` 117, `product_images` 427, `categories` 11, `blog_posts` 10,
`media_videos` 27, `site_events` 6,610, `luxedge_orders` 9, …).

## Verified Cloudflare Free-tier limits (2026-09-29)

Read from the official docs, not from memory:

| Product | Free limit |
| --- | --- |
| Workers requests | 100,000/day (Error 1027 above) |
| Workers CPU | 10 ms per HTTP request; 10 ms per cron |
| Workers static assets | 20,000 files/version, 25 MiB each |
| **Cron triggers** | **5 per account** |
| D1 databases | 10 per account; 500 MB per database; 5 GB per account |
| D1 queries | 50 per Worker invocation |
| D1 rows read | 5,000,000/day |
| D1 rows written | 100,000/day |
| D1 egress | no charge |
| R2 | 10 GB-month, 1M Class A, 10M Class B — **requires enabling in the dashboard** |

## What was built

| Piece | Path |
| --- | --- |
| D1 migration (10 tables, 11 indexes) | `cloudflare/d1/migrations/0001_storefront_read.sql` |
| Schema generator (from the live schema) | `scripts/d1-generate-schema.mjs` |
| Read-only Supabase export tooling | `scripts/supabase-export.mjs` |
| Import tooling + count verification | `scripts/d1-import.mjs` |
| PostgREST-path → SQLite translator | `worker/d1/query.ts` |
| Backend switch (request-scoped) | `worker/d1/runtime.ts` |
| Single public-read entry point | `worker/d1/read.ts` |
| Column type-coercion registry | `worker/d1/table-schema.ts` |
| Public allowlisted read API | `worker/db-api.ts` |
| Client adapter + switch | `src/services/db.ts` (`WorkerDbAdapter`) |

### Architecture

```
luxedge.us
  ├── static assets ── Cloudflare Static Assets (`dist`, ASSETS binding)
  ├── dynamic ──────── Worker (worker/index.ts)
  │                     ├── /sitemap.xml, /google-products.xml, SSR pages  → read layer
  │                     ├── /api/db/<table>  public, allowlisted, read-only
  │                     └── /api/*            admin/webhook (still Supabase-backed)
  └── relational data ─ Cloudflare D1 (`DB`)
```

### The seam

The Worker's public reads were already written as PostgREST path strings, e.g.

```
products?select=id,slug,name&status=in.(active,published)&order=slug.asc&limit=500
```

`worker/d1/read.ts` accepts **the same strings**, so `worker/sitemap.ts` and
`worker/seo-meta.ts` each changed exactly one helper and none of their queries,
select constants or eligibility rules. On the client, every public read already
went through the `DbAdapter` interface in `src/services/db.ts`, so the D1 backend
is one new adapter rather than a rewrite.

### Type adaptation (deliberate, not silent)

| Postgres | D1/SQLite | Read-back |
| --- | --- | --- |
| `boolean` | `INTEGER 0/1` | real booleans (`is_primary === true` must not break) |
| `jsonb` / `text[]` | `TEXT` | **tolerant** parse — JSON when JSON, else the raw string |
| `uuid` | `TEXT` | unchanged |
| `timestamptz` | `TEXT` | ISO-8601 preserved verbatim |
| `numeric` | `NUMERIC` | money keeps precision |

`products.tags` is deliberately read back **raw**: `parseTagList()` in
`src/features/catalog/tags.ts` is the one tolerant tags parser, and a second path
would silently wipe string-tag rows (`AGENTS.md`).

## Backend switch

```
DATA_BACKEND=d1   (Worker var)   → Worker reads D1
VITE_DATA_BACKEND=d1 (build env) → SPA reads /api/db (D1)
```

Both default to Supabase, so deploying either flag alone is inert. The switch is
explicit rather than "try D1 then fall back": a silent fallback would hide a
broken D1 migration behind a 402-ing Supabase and make the cutover unverifiable.

## Runbook

```bash
# 1. Capture the live schema (read-only, never prints credentials)
node scripts/supabase-export.mjs schema

# 2. Regenerate the D1 migration from it (never hand-edit column lists)
node scripts/d1-generate-schema.mjs

# 3. Back up + export the tables being migrated
node scripts/supabase-export.mjs counts
node scripts/supabase-export.mjs export products categories product_images \
  product_variants coupons store_settings store_offers blog_posts \
  blog_revisions media_videos

# 4. Build import SQL and verify counts match the source
node scripts/d1-import.mjs sql --all
node scripts/d1-import.mjs verify        # refuses to bless a mismatch

# 5. Apply schema + import
npx wrangler d1 migrations apply luxedge-staging-db --remote --env staging
npx wrangler d1 execute luxedge-staging-db --remote --env staging \
  --file=.freebuff/migration/sql/products.sql     # …one file per table

# 6. Deploy
npx wrangler deploy --env staging            # or: npx wrangler deploy
```

Always prefix Wrangler with
`env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID` on this machine — the
shadowing env vars point at a different account.

## Rollback

Every step is reversible and none of them touch Supabase data.

1. **Backend switch** — remove `DATA_BACKEND` (Worker) and `VITE_DATA_BACKEND`
   (build) and redeploy. Reads return to Supabase immediately.
2. **Worker version** — `wrangler deployments list` (oldest-first; grep the newest
   rows for the current version) then roll back to the previous version.
3. **Emergency sitemap stays available** — if D1 is unreachable the sitemap fails
   open to the 12-URL static feed with `x-luxedge-sitemap-mode: emergency`; it
   never falls back to the stale `public/sitemap.xml` snapshot.
4. **D1** — drop `luxedge-production-db`; nothing else references it.
5. **Source data** — the full 53-table logical backup is retained and Supabase is
   NOT deleted.

## Quota model (conservative)

Per `product` row write: 1 row + 4 index entries = 5 rows written (measured:
importing 117 products wrote 585 rows).

| Metric | Estimate | Free allowance | Headroom |
| --- | --- | --- | --- |
| D1 storage | < 5 MB (all 10 tables, 610 rows; backup is 4.7 MB incl. 6,610 `site_events`) | 500 MB/DB, 5 GB/account | ~99% |
| D1 rows read / catalog page | ~250 (products 117 + images 427 filtered by index + categories 11) | 5M/day | ~20,000 page loads/day |
| D1 rows written / day | ~0 (public reads are read-only) | 100,000/day | ~100% |
| Cron triggers | 2 used | 5/account | 3 left |
| Worker requests | **currently 1 per asset** (see below) | 100,000/day | see below |

### ⚠ Open quota item: static assets currently invoke the Worker

`wrangler.toml` has `run_worker_first = true`, so every CSS/JS/image/font request
consumes a Worker request — roughly 8–10 Worker requests per page view, i.e. only
~9–12k page views/day before Error 1027. Wrangler's schema (verified in
`node_modules/wrangler/config-schema.json`) accepts an **array of patterns**
(`["/*", "!/assets/*", …]`) so static assets can be served by the Asset Worker
without invoking the User Worker.

This is deliberately **not** shipped yet: an incorrect enumeration can 404 every
SPA page route (with `not_found_handling = "none"` the Asset Worker does not fall
back to `index.html`), and the current value exists to stop stale hashed assets
being answered with HTML — the "page hangs on text" bug documented in
`wrangler.toml`. It needs a staging verification pass before it goes to
production.

## Security notes

- **`app_settings` holds live secrets** (AdSense refresh token, `CJ_API_KEY`,
  `AI_KEY_GEMINI`, `AI_KEY_OPENROUTER` — verified in the live export). It is
  deliberately **not** migrated to D1 and is **not** reachable through
  `/api/db`; a test asserts that.
- `/api/db` is public and unauthenticated, so it is deny-by-default on both
  tables and columns, projection-limited (never `SELECT *`), and **read-only** —
  the adapter refuses writes rather than pretending they succeeded.
- Column drift between the client select constants, the API allowlist and the
  generated migration is enforced by
  `worker/__tests__/db-api.test.ts`; the coercion registry is checked against the
  same DDL. Both caught real bugs during this work
  (`product_variants.image` and `store_offers.eligible_*` did not exist live).
- `dist/.git/**` is uploaded into the asset bundle by `wrangler deploy` because
  `dist` predates the current build. Cloudflare returns 404 for those paths
  (verified on prod and staging, so **no disclosure occurred**), but the build
  output should be cleaned.
