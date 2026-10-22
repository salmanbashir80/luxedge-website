# AGENTS.md — Luxedge (react-vite-tailwind SPA + Cloudflare Worker + Supabase)

Operational knowledge that is not recoverable from reading the code.

## Database reality (Supabase, project eidujmfbcfrjjleitaqp)
- Repo `supabase/migrations/*.sql` LAG the live schema: `products.title/description/compare_at_amount/image_url` and `product_images.public_url` exist live (verified 200) but were never committed. Migration `0025_reconcile_out_of_band_catalog_columns.sql` adds them idempotently (`ADD COLUMN IF NOT EXISTS`) but has never been applied live (no-op there). Only `products.price_amount` is genuinely absent live (PostgreSQL 42703).
- `src/services/__tests__/select-schema.test.ts` treats the migrations as the single source of truth for column existence (parses CREATE TABLE + ALTER TABLE incl. DO-block DDL); it will fail on any live-only column until a reconciling migration is committed. For "does this column exist?" questions, probe live (anon key) rather than trusting migrations.
- PostgREST explicit `?select=` with ANY nonexistent column 400s the whole query — symptom is a silently empty storefront/blog/sitemap with no console error. This is why every public read select is an exported constant guarded by the contract test.

## Storefront behavior
- `/shop` only shows `status in (active,published)` AND commerce-ready (stored `commerce_readiness = 'COMMERCE_READY'` or derived from supplier+cost evidence). Live: 35 active products, 28 visible. A sparse storefront is usually this gate or the select-400 failure, not a fetch bug.
- Live `products.tags` is heterogeneous: 7 CJ rows store comma-separated TEXT (`horse,grooming,brush,tack,equestrian`), 28 store jsonb arrays, and a few carry a JSON string array. ONE tolerant parser serves every reader: `parseTagList()` in `src/features/catalog/tags.ts` (jsonb array, JSON string, or comma/`;`/`|` text; never throws) — used by the storefront mapper, the admin repository, and CSV import. Do NOT introduce a second tags parser: a strict array-only path silently wipes string-tag rows to `[]` on admin edit (fixed once, must not regress). `strArr()` in repository.ts stays array-only on purpose for structured id-list/features columns where comma-splitting would be a bug.
- Console noise in dev preview: `site_events` POST 400/aborts are expected anon-RLS analytics-write noise, not defects. One dead Pexels image (server 404) is content-side (`public/blog-seo.json` / hardcoded blog defaults), not product data.

## Environment / config
- `.env` (not `.env.local`) holds `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DEEPSEEK_API_KEY`, `SCRAPE_DO_TOKEN`; `.env.local` holds only `VERCEL_OIDC_TOKEN`. Values are bare (unquoted, single-line) — parse line-by-line; a regex spanning lines will swallow the whole file.
- Production worker secrets (AdSense OAuth, CJ API, etc.) live only as Cloudflare bindings; every `wrangler deploy` must pass `keep_vars` or they are dropped (CJ admin page then shows OFFLINE).

## Deployment / CI
- Vercel deploy checks fail with a known platform-wide deploy-outputs outage; before blaming a branch, compare against main's own newest Production deployment — identical failure = the outage. main is not branch-protected; the established move is `gh pr merge N --admin` after that check.
- Establish PRs with only your own files staged (worktree routinely carries other threads' uncommitted files — docs/*.md, screenshots, check_session.ps1 — never include them).
- Post-deploy proof: `wrangler deployments list` is OLDEST-first (grep the newest rows); admin-gated worker API routes answering 401 without a token prove the route is live; sitemap.xml must return 200 with a non-empty `<urlset>`.
- DEPLOY AUTH TRAP: `.env`'s `CLOUDFLARE_API_TOKEN` belongs to a DIFFERENT account (`fd383fa3…`, himalayankoh.pk@gmail.com) than the one luxedge.us lives in (`f542683e…`, 8002salman@gmail.com), so a bare `wrangler deploy` fails account-config mismatch. The working login is the wrangler OAuth session in `%APPDATA%/xdg.config/.wrangler/config/default.toml`; deploy with the env token unset: `env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID npx wrangler deploy`. Confirm with `env -u CLOUDFLARE_API_TOKEN npx wrangler whoami` (must show f542683e / 8002salman).
- The site is AdSense-facing: never touch ad code (`AdSenseAd`, `marketing.ts`, `index.html` consent injection), `/ads.txt`, `robots.txt`, or the `keep_vars` secret set.

## Dev / preview quirks (Windows)
- Vite dev servers on this machine go stale: the port keeps listening but every request hangs (curl HTTP 000). Detected by `curl` timeouts; fixed by killing the port owner (`Get-NetTCPConnection -LocalPort 5174 -State Listen` → `Stop-Process`) and relaunching with the run doc recipe (`--host 127.0.0.1 --port 5174 --strictPort`, PowerShell Start-Process with separate stdout/stderr log files).
- preview_click and native `el.click()` often do NOT fire React handlers in this app's preview; dispatching `new MouseEvent('click', { bubbles: true, cancelable: true, view: window })` on the element from `preview_evaluate` reliably does.
- `npx vitest run` also runs test copies under `.claude/worktrees/*` (other threads) — a doubled test-file count is expected there, not duplication in this checkout.