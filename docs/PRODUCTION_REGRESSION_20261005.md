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

## Screenshots

Captured/displayed inline in this conversation: first PDP with loaded gallery/title/price; Campaign Manager after reload; reopened QA editor showing persisted copy and NOT PUBLISHED preview; earlier AI failure and empty flagship UI. DOM metadata values are recorded above and in URL JSON evidence. Screenshot tool returns inline images, not filesystem paths; no downloadable screenshot files are claimed. No green D1-chip screenshot is claimed because that chip was absent.
