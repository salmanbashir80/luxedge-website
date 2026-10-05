# Luxedge production regression sweep — 2026-10-05

## Scope and safety

Production: https://luxedge.us. Workspace branch: fix-campaign-storage-d1.

No live/published product or flagship campaign was edited. Explicitly requested tests wrote only an existing unpublished QA campaign and one draft product. Draft product values were restored and independently read back; only its update timestamp may differ. No ads were clicked, ad consent was accepted, AdSense review was requested, paid checkout was run, or campaign emails/claims were initiated. No deployment, commit or push was performed. Cloudflare token rotation remains pending at the user's direction.

## 1. Public routes and listings — PASS within tested scope

Homepage rendered in the browser. Shop rendered seven product cards with images, prices and working links. Catalog admin separately reported 32 publicly listable products; the first shop batch is not a claim that all 32 were displayed/tested.

Clicked through the Shop to:
- `/product/cat-window-perch-suction-cup-hammock-seat-for-sunbathing`: title, loaded gallery images, $25.95.
- `/product/foldable-pet-travel-carrier-backpack`: title, five loaded main images, $39.95, no broken main images.

Blog list rendered and clicking `/blog/dog-car-safety-seat-belt-guide` loaded the article with the correct heading/title and substantive text.

A read-only crawl of sitemap URLs and same-origin HTML links checked 71 unique URLs: all returned HTTP 200. No public 404/500 found in that crawl. Detailed results: `PRODUCTION_REGRESSION_20261005_URLS.json`. It did not crawl authenticated admin actions, external links, or every possible dynamic/query URL.

## 2. SEO, feeds and robots — PASS

Both inspected product DOMs had product-specific titles, descriptions, canonical URLs and parseable JSON-LD, including Product/Offer data on the first PDP.

Example:
- Title: Suction Cup Window Perch Hammock Seat for Cats — Sunbathing Lounger | Luxedge
- Description: Suction-mounted window hammock seat for cats. Sturdy suction cups, breathable mesh cover, no drilling required.
- Canonical: https://luxedge.us/product/cat-window-perch-suction-cup-hammock-seat-for-sunbathing
- Offer: USD 25.95, InStock.

All successful product URLs in the HTTP crawl included title/description/canonical/JSON-LD source markers; no missing required product metadata found.

- `/sitemap.xml`: 200, XML parsed without parser errors, 65 URLs.
- `/google-products.xml`: 200, XML parsed without parser errors, 32 product items.
- `/robots.txt`: 200, allows public crawl, blocks /admin and /api, declares sitemap.

## 3. Admin catalog and listing hygiene — PASS with restoration caveat

Authenticated user session opened Catalog and draft product `f496d735-2762-40f2-aed5-a8fffe1fa795`. General `AI Optimize & Save` and SEO `Research, Optimize & Save` buttons were enabled.

On this draft only, made a tiny title edit then ran General AI Optimize. UI reported saved; independent GET confirmed changed title/description and status remained draft. `Undo last optimization` restored the pre-optimization form fields and persisted them. Because the pre-optimization form contained our tiny unsaved title edit, Undo correctly retained that edit rather than the original database title.

Restored the original title/name afterwards. The normal Save button did not persist that restoration during this session; a narrow authenticated PATCH restored only those two original fields. Independent GET compared every returned field except updated_at against the original baseline: zero differences. This Save-button behavior is a caveat, not a passing manual-save result. SEO optimizer was inspected enabled but was not executed; only General auto-save/Undo was exercised.

## 4. Market Intel / Scout — FAIL

Product Scout and its Market Intelligence panel render, but Scout displays:
`D1 API 404: {"error":"Unknown or non-public table: product_scores"}`.

Read-only probes:
- `/api/db/product_scores`: 404, unknown/non-public table.
- `/api/market-intel/trends/jobs`: 402, `Could not read agent_jobs.`
- `/api/market-demand/google-ads?action=health`: 200, `not_configured`; required GOOGLE_ADS credential set missing. This is credential presence, not live provider reachability.

An exploratory request using unsupported `action=status` returned 400; corrected to documented `action=health` above. This is not reported as a site regression.

Did not click Run Scout Run or Run Analysis because code inspection shows these persist jobs/candidates and can participate in publishing workflows, contrary to the read-only requirement. No competitor/Trends success is claimed.

## 5. AdSense and consent — SAFE CODE CHECK PASS; accepted-consent runtime intentionally untested

`/ads.txt` returns 200 and contains:
`google.com, pub-5473713135927706, DIRECT, f08c47fec0942fa0`.

Production homepage source contains the adsbygoogle.js loader and `ca-pub-5473713135927706`. With browser-only consent unset, banner showed Accept All and Decline. Clicking Decline persisted `declined`, dismissed banner, and no external adsbygoogle script was loaded in DOM. No consent was accepted to trigger live ads. Therefore an external AdSense script was deliberately absent from the inspected declined-consent DOM; source loader presence is verified, accepted-consent injection is not claimed. Ad-related code, ads.txt and robots.txt were not modified.

## 6. Campaign storage / AI copy — PARTIAL PASS

Existing test draft `qa-test-draft-d1-20261005` was reused (no duplicate draft created). Campaign reads/saves returned 200, not 402. Saved title/subtitle/message survived page reload and independent no-cache GET. Final state: draft, active false, popup false, zero claims, zero emails.

Final title: QA Test Draft — Luxedge Gift for Pet Owners
Subtitle: A complimentary gift for pet owners, no purchase needed, with free shipping.
Message: Share a little about your pet and receive your Luxedge gift. Free shipping included.

No dedicated healthy D1 storage chip or backend-identity response field was present. The generic header Live indicator is not a D1 health chip. Persistence passed, but UI D1 identity/health proof remains unverified.

### AI fix and verification

Observed real provider response copied the QA title/message verbatim, including D1 and 20261005. The existing validator correctly rejects digits, so this caused the repeated failure.

Local fix:
- Remove digit-containing tokens from supplied AI text facts before prompting; add explicit rewrite/self-check instructions.
- Add one bounded corrective retry for invalid output.
- Keep every existing output validator restriction unchanged; no rejected output gets applied.
- Integrate helper into Campaign Manager, retaining stale-form protection and manual save.

The corrected prompt was sent to the actual production AI endpoint (generation only; no campaign mutation). Provider returned valid copy above. The local browser imported the actual edited helper and verified that this provider response passes while unsafe claims are still rejected. Valid copy was entered into the authorized production QA editor and persisted. Subsequently production's existing Draft copy with AI button successfully displayed `AI draft applied to this form only`; saving and reloading retained the copy.

No fix was deployed. Thus production behavior for numeric/internal identifiers using the newly edited code has NOT been verified end-to-end; local helper/browser tests plus real provider generation and production persistence were verified separately.

## Read-only flagship diagnosis

The D1 migration explicitly moves only `luxedge_campaigns_v1` and `luxedge_campaign_products_v1`. It excludes legacy `gift_drop_campaign_v1`, claim rows, inventory and email.

Read-only Supabase requests for legacy app_settings document and luxedge_orders both returned 402 `exceed_egress_quota`. The legacy loader in `api/_lib/gift-drop.ts` returns null on non-OK reads; claim inventory loader returns -1. Production `/api/admin/gift-drop` returned HTTP 200 with campaign null, empty claims, total 0, remaining -1. These defaults hide unavailability; they do not prove data deletion or genuine zero inventory.

Additional current-branch code issue: `loadCampaignBySlug()` in `api/_lib/campaigns.ts` only searches the registry and has no legacy flagship lookup despite bridge comments. A registry without `pet-gift-drop` therefore gives Campaign Manager flagship null independently of legacy document availability.

No legacy data was changed or reconstructed. Confirming original flagship contents requires restored read access/known backup and a separately authorized repair. Do not publish campaigns assuming claim storage is healthy.

## Checks after source edits

- Focused campaign tests: 44 passed.
- `npx tsc --noEmit`: exit 0.
- Full `npm test`: 147 files passed, 3 skipped; 1881 tests passed, 8 skipped.
- `npx vite build`: exit 0, large chunk/dynamic-static import warnings. Direct Vite build used to avoid rewriting public sitemap through the npm prebuild generator.

## Fixes applied, committed and deployed (same day)

Branch `fix-campaign-storage-d1`, commit `ee2a560`, pushed to origin. Deploy:
`wrangler deploy --config wrangler.toml --name luxedge-production --keep-vars`
(owner OAuth session; the exposed CLOUDFLARE_API_TOKEN was deliberately NOT
used). Deployed Version ID `e3e7bc66-3e24-4586-9df3-2559bf9b1f6c`; bundle
`index-D5f3wvy0.js` served live.

### 1. Best Sellers duplicates (section 4 of the earlier sweep — fixed)

Cause: each curated slot fell back to a FIXED array index (`active[2]`, `active[3]`,
`active[4]`) when its slug/category was missing, and the row was built only from
the first 24 oldest products, which never contained the bird/horse/cattle rows.
So the same dog card appeared as "Bestseller" and "Wild Bird", and the same cat
card as "Popular" and "Equine Choice".

Fix: `pickHomeBestSellers()` (src/features/catalog/merchandising.ts) resolves one
DISTINCT real product per slot (no repeated id, no shared supplier photo), only
labels a product with its own category badge, drops a slot that has no genuine
product, and the homepage loads the full first page (60) so every category is
present.

Production evidence after deploy: five distinct cards — Bestseller (Stainless
Steel Pet Water Fountain $51.95), Popular (Collapsible Cat Tunnel $24.95),
Wild Bird (Outdoor Hanging Bird Feeder $39.95), Equine Choice (Breathable Mesh
Horse Fly Mask $19.95), Farm Choice (Heavy-Duty Poly Livestock Feed Trough
$49.95). No repeated product or image.

### 2. 7 visible shop listings vs 32 feed items — explained and fixed

The storefront listing projection (`PRODUCTS_LISTING_SELECT`) omitted
`description`, while the public eligibility gate requires
`description + short_description >= 100` characters. The gate therefore judged
rows on `short_description` alone and hid most of them: 7 of the 24 loaded rows
passed, so the shop showed 7 products while `/google-products.xml` and the
sitemap (which read full rows) listed 32.

Fix: `description` is now part of the listing projection (and the first page is
60 rows).

Production evidence after deploy: the shop reports "32 products" and renders 24
unique product links with a working Load More; `/api/db/products` with
`select=...,description` returns 200. This is the real mismatch — no product was
published to equalise counts.

Remaining honest difference: the Google feed lists active products with a price
and a real image and does NOT apply the commerce-readiness gate, while the
storefront does. Today all 32 rows pass that gate (derived from supplier + cost
+ in-stock evidence), so both surfaces show 32.

### 3. "Normal Save does nothing" in the catalog editor — root cause fixed

Cause: `handleSave()` posts the WHOLE product form, which includes `tags` as an
array. Cloudflare D1's `bind()` accepts only scalars, so `UPDATE ... SET tags = ?`
with an array throws D1_TYPE_ERROR and the entire write fails — while a partial
AI-optimize save (no tags) and a single-column PATCH both succeeded. That is
exactly the earlier observation: the AI save persisted, the normal Save did not.

Fix: `api/admin/db.ts` now coerces every write value through `d1BindValue()`
(booleans for declared bool columns, JSON text for json columns, and JSON text
for any array/object, with `undefined` fields skipped instead of bound). `tags`
stays raw TEXT, so `parseTagList()` remains the single tolerant parser.

Verification: `api/__tests__/admin-db-write.test.ts` (full-form PATCH with
`tags` array, insert coercion, 401 without a token); full suite 1893 passed /
3 files skipped; `tsc --noEmit` clean; `vite build` exit 0.

Still required for a production Save/Undo round-trip: an authenticated admin
session (see below).

### 4. Flagship lookup/bridge restored (read-only)

`loadCampaignBySlug()` searched only the registry, so the Campaign Manager
showed flagship = null whenever the registry had no `pet-gift-drop` entry —
independently of the legacy document. The flagship legacy mapping now lives in
`api/_lib/campaigns.ts` as `flagshipLegacyConfig()` (read-only; the legacy
`gift_drop_campaign_v1` document stays the single source of truth) and is shared
by the public routes, the claim/state handlers and the admin manager. An
unreadable document still returns null rather than a fabricated default.

Production: `/api/campaigns` returns 200 with an empty list and
`/api/campaigns/state?slug=pet-gift-drop` 404 — honest, because Supabase still
reports `exceed_egress_quota` (402). No legacy data was written or reconstructed.

### 5. Product Scout private reads + honest unavailable state

Scout tables have not migrated to D1, and `/api/db` correctly refuses
`product_scores` (404). Scout now reads them through the authenticated private
admin route (`/api/admin/db/*`), which proxies to the existing Scout backend and
never exposes scores publicly. When that backend is unavailable (Supabase 402
today) the UI shows — and an explicit "data unavailable" message instead of
zeros or fake scores. Production: `/api/admin/db/product_scores` answers 401
without a token.

### 6. AI campaign copy

Only marked internal/QA identifiers are stripped as noise before prompting;
product measurements, pack quantities and verified offer facts stay available to
the model, every unsupported-claim rule is unchanged, and one bounded corrective
retry remains. Rejected provider output is never applied.

### 7. Post-deploy surface check

| Surface | Result |
| --- | --- |
| `/` Best Sellers | PASS — 5 distinct, correctly badged cards |
| `/shop` | PASS — "32 products", 24 rendered + Load More |
| PDP (`/product/stainless-steel-...`) | PASS — 200, correct title and price 51.95 |
| `/sitemap.xml` | PASS — 200, 65 `<url>` entries |
| `/robots.txt`, `/ads.txt` | PASS — 200, unchanged |
| `/api/admin/db/product_scores` (no token) | PASS — 401 |
| `/api/admin/gift-drop`, `/api/admin/campaigns`, `/api/admin/traffic?days=7` (no token) | PASS — 401 |
| Console | Only the known AdSense/CSP report-only noise; no application errors |

### 8. BLOCKED — authenticated production QA

No admin session is available in the browser profile any more (the Supabase
session key `luxedge_sb_session` is absent; only the profile record remains), so
the live product Save/Undo round-trip, campaign draft persistence, Scout data
panel and the Gift Drop admin page could NOT be re-verified after this deploy.
Everything above is public-surface evidence plus unit/integration tests.
Owner sign-in is required to complete that round-trip.

### 9. Authenticated production QA (owner signed in, session cookie)

The earlier blocker in §8 was wrong: this build authenticates admin routes with
the same-origin session **cookie**, not a `luxedge_sb_session` localStorage
token (only the `luxedge_session` profile record exists — no `accessToken`).
Re-verified live against Version `5ea1961e-175a-4b17-99b4-c15cae69fac7`:

| Check | Result |
| --- | --- |
| Product editor Save round-trip | PASS — typed description through the UI, Save navigated to `/admin/products`, `PATCH /api/admin/db/products?id=eq.…` 200 and the value read back from D1. Probe removed afterwards; no `PROBE` residue anywhere in the catalog |
| Campaign draft save → reload | PASS — a title edit survived a full page reload; `/api/admin/campaigns` returns the same title, status `draft`, unpublished. QA draft restored to its original title |
| Product Scout | PASS — private reads proxy through `/api/admin/db/{product_candidates,product_scores,supplier_products,suppliers,agent_jobs}` and all answer **402** (Supabase egress quota), never 404. Counts render `—` with "Scout storage unavailable … No scores can be shown" |
| Gift Drop page | PASS after the fix below — no API request was ever made before it |
| `/api/suppliers/cj?action=health` | PASS — `online`, "CJ authentication succeeded" (proves `--keep-vars` preserved the production secrets) |

### 10. New defect found + fixed: admin panels required a token that never exists

Admin access is the cookie; `getAccessToken()` is always `null` in this build.
Four call sites treated that as "not signed in" and bailed out **before**
fetching, so the pages sat on an empty skeleton and the host didn't even
attempt the request:

| Site | Symptom |
| --- | --- |
| `GiftDropAdmin.load()` / `post()` | Gift Drop page rendered no config form and told the owner to seed `gift_drop_campaign_v1` — a row that already exists |
| `ADashboard.loadOrders()` | Revenue/orders KPIs and the chart never fetched; the 402 order store rendered as a real `$0.00` / "No paid orders yet" |
| `AOrders.loadOrders()` | Orders page never fetched; same fabricated zeros, ERP config never loaded |
| `AOrders.loadErpCfg()` | ERP webhook/token (masked) never displayed |

Fixed by fetching unconditionally with an optional bearer header, plus shared
honest readouts in [src/services/adminReadouts.ts](src/services/adminReadouts.ts)
so an unreachable store can never read as a fact:
`Orders data unavailable — the order store could not be read.`, `—` KPI values,
and `Gift Drop storage unavailable — … Nothing is shown as zero` (the admin API
reports `remaining: -1` for "ledger unreadable", which is not an empty campaign).

Verified live after deploy: dashboard KPI row `—` + "order store unreachable",
chart header "totals unavailable", Recent Orders and Order Status honest, Gift
Drop card "data unavailable"; Gift Drop page →
"Gift Drop storage unavailable — … Nothing is shown as zero", `— claimed`,
`… real gifts left`; Orders page → banner + four `—` KPI cards with the ERP
config now loaded. `tsc` clean, **149 test files / 1899 tests pass**.

Still blocked upstream (owner action): Supabase project `eidujmfbcfrjjleitaqp`
answers **402 `exceed_egress_quota`**, which is why orders, the gift-drop ledger
and all Scout tables are unreadable.

## Screenshots

Captured/displayed inline in this conversation: first PDP with loaded gallery/title/price; Campaign Manager after reload; reopened QA editor showing persisted copy and NOT PUBLISHED preview; earlier AI failure and empty flagship UI. DOM metadata values are recorded above and in URL JSON evidence. Screenshot tool returns inline images, not filesystem paths; no downloadable screenshot files are claimed. No green D1-chip screenshot is claimed because that chip was absent.
