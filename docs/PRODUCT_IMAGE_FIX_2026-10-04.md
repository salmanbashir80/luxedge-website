# Product image repair — 2026-10-04

## Evidence before changes

- Latest GitHub main: `6a0798b`; local Antigravity edits are preserved.
- Production version before fix: `a9a38539-3831-43c8-bd29-932a5bb4cdb2`.
- Cat window perch gallery requested `w=0`; browser decoded a 1-pixel image.
- The same source with `w=800` decoded correctly at 784 × 787 pixels.
- Public audit: 32/32 active product routes HTTP 200 with self-canonicals.
- 59/62 distinct active image references decoded correctly with safe width.
- Two secondary supplier URLs returned HTTP 404; one salt-block card cover
  still pointed at quota-blocked Supabase despite an identical local file.

## Focused fix

Gallery mapping no longer passes Array.map's index as image width. Shared
width validation protects both frontend URLs and the proxy (64–1600 pixels;
invalid/tiny widths fall back to 800). Already-proxied card URLs use their
requested size. No ads, authentication, checkout, SEO routes, or secrets changed.

The conditional D1 updates in `scripts/fix-confirmed-product-images.sql`
retain all products, image rows, filenames, and source files. The two bad
secondary references point to their product's existing verified original;
the gallery deduplicates them, rather than fabricating extra photographs.

## Reference snapshot and rollback

The salt-block product `92697308-1552-4086-9e57-8a92497c037c` originally had
`image_url=https://eidujmfbcfrjjleitaqp.supabase.co/storage/v1/object/public/product-media/catalog/horse/hk-salt-gallery.jpg`.

Dog bed secondary image `a18e9f76-6944-417b-b06e-920e26130327` originally had
both `url` and `public_url` set to
`https://oss-cf.cjdropshipping.com/product/2026/01/26/03/b3ad9b11-8bf3-4ce6-942a-f4416665bb_trans.jpeg`.
Its `is_primary=0`, `sort_order=1` remain unchanged.

Dog shoes secondary image `d251c049-4709-4f44-bede-6410427bbec1` originally had
both `url` and `public_url` set to
`https://oss-cf.cjdropshipping.com/product/2024/01/24/03/b967276c-071e-4a8f-9bf1-dac37499b4a8.jpg`.
Its `is_primary=0`, `sort_order=9500` remain unchanged.

Rollback consists only of restoring those three identified values; nothing
was deleted. Do not roll back unless intentionally restoring broken references.

## Supplier-photo identity repair

Visual verification revealed that the cat window-perch cover actually showed
a floor scratcher. The existing supplier ID was checked against its exact
[CJ product record](https://cjdropshipping.com/product/cat-hammock-suction-cup-wall-mounted-window-hammock-p-08B49D60-84C2-4967-A09A-646725121D04.html),
not a keyword-matched substitute. Three authentic hammock design photos now
form its gallery; they illustrate supplier colour options, not newly promised
stock or purchasable colour variants.

Six existing supplier-referenced listings received verified-source imagery:
cat window perch, nail grinder, stainless water fountain, retractable leash,
horse fly mask, and foldable pet carrier. The carrier source is a handled
travel bag; its legacy "backpack" wording still needs owner resolution.

Eight JPEGs (725,888 bytes total; cat-perch photos about 46–48 KB each) were
mirrored into `public/product-media/` with content-hashed filenames. This
avoids new Supabase egress and reliance on third-party browser image loading.
All files were deployed and verified HTTP 200 with identical byte lengths
BEFORE the conditional product/image-reference updates were applied.

Evidence and rollback artifacts (public product data only, no credentials):

- `.freebuff/verified-photo-manifest.json`: source page, original photo URL,
  local filename, byte count, SHA-256.
- `.freebuff/verified-photo-backup.json`: previous six product/image records.
- `.freebuff/verified-photo-repair.sql`: applied conditional reference updates.
- `.freebuff/verified-photo-rollback.sql`: exact reversal, including only the
  two newly added cat-perch gallery rows.

No original assets or products were deleted. Prices, stock, supplier IDs,
shipping, checkout, authentication, advertising and secrets were not changed.

## Final production verification

- Production: https://luxedge.us
- Worker version: `6fc8c346-aa6a-43cb-ad16-6868f7af28fc`.
- All non-image bundled Worker source sections matched deployed production
  before the first deployment: 337 sections, 0 unrelated changes.
- Both production builds passed; existing bundle-size/dynamic-import warnings
  remain unrelated to this image fix.
- Full suite: **1,818 passed**, 8 skipped, across 139 passing test files.
- Focused image/proxy/gallery/catalog suite: **57 passed**.
- Re-audit at 2026-10-04 22:04 UTC: **32/32 active product URLs HTTP 200**,
  **62/62 distinct image sources decoded at useful dimensions**, 0 load failures.
- Product self-canonicals remained correct; one visible product H1. The other
  DOM H1 is in a closed privacy dialog, not a duplicate visible product heading.
- Cat-perch gallery: real 800 × 800 photo, 3 thumbnails; selecting thumbnail 2
  changes the actual image. Native enlarged-photo control works.
- 320, 360, 390, 430 and 1366px: no horizontal overflow in the target page.
- No browser runtime errors observed on the verified target page.
- Existing Antigravity working/staged changes are preserved. These new local
  fixes were deployed directly but **not committed/pushed to GitHub**: the
  checkout contains unrelated Antigravity changes and a pre-existing staged
  catalog change, which must not be swept into an image-fix commit.

## Remaining owner-dependent content/photo mismatches

Image **availability** is now passing. That is not a claim that every product's
specifications or supplier assignment is correct. The visual contact sheet
found these unresolved mismatches; no fabricated/stock substitute was inserted:

| Product URL | Evidence / remaining owner decision |
| --- | --- |
| `/product/collapsible-cat-tunnel-with-crinkle-peek-hole-3-way-play-tube` | Cover depicts a flying disc. Assigned CJ record is an S-shaped tunnel, while the listing promises a 3-way tube. Confirm intended product before substituting its imagery. |
| `/product/no-pull-dog-harness-with-reflective-strips-front-back-clip` | Cover depicts dog clothing. Assigned supplier's plain nylon harness does not establish the promised reflective/front-and-back-clip features. Confirm exact product/variant. |
| `/product/orthopedic-memory-foam-dog-bed` | Cover depicts a cooling mat. Exact existing AliExpress item's original photo was not verified; genuine supplier photos required. |
| `/product/outdoor-hanging-bird-feeder` | Cover depicts flowers. Assigned CJ record is an acrylic cage feeder, not the promised outdoor weather-resistant seed station. Confirm supplier/product first. |
| `/product/solar-bird-bath-fountain` | Cover depicts a cat. The exact existing supplier page could not be verified; genuine product photo/source required. |
| `/product/heavy-duty-cattle-feed-trough` | Card cover depicts cattle rather than the sold trough; gallery contains a generic water-trough image. Exact sold item/source photo required. |
| `/product/foldable-pet-travel-carrier-backpack` | Photo is now the exact supplier's travel carrier, but supplier shows a handled bag, not a backpack. Confirm/correct legacy product wording without switching fulfillment to a different item. |

## Active URL inventory (availability audit)

Every route below returned HTTP 200; all corresponding stored image sources
loaded. This inventory covers ACTIVE/PUBLISHED products, not archived/admin
records. "Needs owner review" is the identity/content issue above, not an HTTP
or image-decoding failure.

| Product slug | Cover identity result |
| --- | --- |
| adjustable-pet-car-seatbelt-tether-2-pack | No obvious cover mismatch |
| bone-charm-pendant-necklace | No obvious cover mismatch |
| bungee-pet-car-seatbelt-leash | No obvious cover mismatch |
| cat-window-perch-suction-cup-hammock-seat-for-sunbathing | Exact supplier photos restored; 3-photo gallery |
| ceramic-cat-face-food-bowl-easy-clean-pet-dish | No obvious cover mismatch |
| collapsible-cat-tunnel-with-crinkle-peek-hole-3-way-play-tube | Needs owner review |
| cooling-pet-mat-ice-silk-cooling-pad-for-cats-dogs | No obvious cover mismatch |
| cozy-cat-nest-bed-round-plush-mat | No obvious cover mismatch |
| cute-cat-blankets-dog-pet-mat | No obvious cover mismatch |
| dog-bed | Dead secondary reference repaired |
| dog-clothes-spring-and-summer-clothing | No obvious cover mismatch |
| dog-poop-bags-biodegradable-waste-bag-rolls | No obvious cover mismatch |
| dual-shoulder-pet-carrier-backpack | No obvious cover mismatch |
| foldable-pet-travel-carrier-backpack | Supplier photo restored; wording needs owner review |
| heavy-duty-cattle-feed-trough | Needs owner review |
| himalayan-30-lb-trace-mineral-salt-block | Existing identical local cover restored |
| himalayan-round-rope-salt-lick-6-lb-pack-of-4 | No obvious cover mismatch |
| horse-fly-mask-with-ears | Exact supplier photo restored |
| no-pull-dog-harness-with-reflective-strips-front-back-clip | Needs owner review |
| nylon-anti-grind-dog-leash-collar | No obvious cover mismatch |
| nylon-training-collar-quick-release | No obvious cover mismatch |
| orthopedic-memory-foam-dog-bed | Needs owner review |
| outdoor-hanging-bird-feeder | Needs owner review |
| pet-shoes-wear-dog-shoes | Dead secondary reference repaired |
| polka-dot-turtleneck-dog-sweater | No obvious cover mismatch |
| portable-livestock-water-trough-30-gallon | No obvious cover mismatch |
| retractable-dog-leash-5m-one-button-lock-with-anti-slip-grip | Exact supplier photo restored |
| silicone-feeding-placemat-dogs-cats | No obvious cover mismatch |
| silicone-flying-disc-dog-toy | No obvious cover mismatch |
| solar-bird-bath-fountain | Needs owner review |
| stainless-steel-pet-water-fountain-filtered-running-water-for-cats-dogs | Exact supplier photo restored |
| usb-rechargeable-pet-nail-grinder-quiet-motor-for-dogs-cats | Exact supplier photo restored |
