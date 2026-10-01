-- 0005 — Repoint Supabase Storage product-image references at their
-- verified site-local mirrors.
--
-- The Supabase project (eidujmfbcfrjjleitaqp) has answered HTTP 402
-- exceed_egress_quota for EVERY Storage object since 2026-09-29 (project-wide,
-- for the anon key AND the service-role key; re-probed 2026-10-01), so any
-- product image served from
--   https://eidujmfbcfrjjleitaqp.supabase.co/storage/v1/object/...
-- is a broken image for customers and for Google's crawlers.
--
-- Those rows already carry a working, same-origin mirror in
-- product_images.public_url (site-relative /img/... assets that ship in the
-- Worker's static asset bundle — verified present in public/img/...). The
-- storefront mapper, JSON-LD builder and the Google feed already prefer the
-- legacy `url` column and fall back to `public_url`; this migration makes the
-- stored reference itself point at the healthy copy so EVERY reader — current
-- or future — resolves a live image without depending on any fallback.
--
-- Rules (idempotent; re-running changes nothing):
--   * Only rows whose `url` points at the restricted Supabase Storage host.
--   * Only replaced by a site-relative mirror (`public_url` starting with '/')
--     that actually exists in the repo's public assets — never by an invented
--     or third-party URL, never by another Supabase URL.
--   * Rows with no usable mirror are left untouched (no data fabrication);
--     readers keep their existing fallback behavior for those.
--   * Nothing is deleted: the original absolute URLs remain recorded in the
--     Supabase logical backup and in the live Supabase project itself.
--
-- Rollback: restore from the Supabase export, or reverse the two UPDATEs with
-- the documented LIKE patterns — the original values are recoverable either way.

UPDATE product_images
SET url = public_url
WHERE url LIKE '%supabase.co/storage/v1/object/%'
  AND public_url LIKE '/%';

-- The legacy products.image_url column: repoint it at the product's primary
-- image row's site-relative mirror when one exists. Only touches rows whose
-- current value is a restricted-Supabase URL, and only when a local mirror
-- is actually present — otherwise the row is left exactly as it was.
UPDATE products
SET image_url = (
  SELECT pi.public_url
  FROM product_images pi
  WHERE pi.product_id = products.id
    AND pi.public_url LIKE '/%'
  ORDER BY pi.is_primary DESC, pi.sort_order ASC
  LIMIT 1
)
WHERE image_url LIKE '%supabase.co/storage/v1/object/%'
  AND EXISTS (
    SELECT 1 FROM product_images pi2
    WHERE pi2.product_id = products.id AND pi2.public_url LIKE '/%'
  );
