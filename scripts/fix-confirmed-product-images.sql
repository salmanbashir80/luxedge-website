-- Only confirmed broken photo references. Existing files/products are retained.
-- Original rows and rollback are recorded in docs/PRODUCT_IMAGE_FIX_2026-10-04.md.
UPDATE products SET image_url = '/img/hk/hk-salt-gallery.jpg'
WHERE id = '92697308-1552-4086-9e57-8a92497c037c'
AND image_url = 'https://eidujmfbcfrjjleitaqp.supabase.co/storage/v1/object/public/product-media/catalog/horse/hk-salt-gallery.jpg';

-- Correct a truncated filename to the identical, verified original supplier photo.
UPDATE product_images SET
  url = 'https://oss-cf.cjdropshipping.com/product/2026/01/26/03/b3ad9b11-8bf3-4ce6-942a-f4416665bb84_trans.jpeg',
  public_url = 'https://oss-cf.cjdropshipping.com/product/2026/01/26/03/b3ad9b11-8bf3-4ce6-942a-f4416665bb84_trans.jpeg'
WHERE id = 'a18e9f76-6944-417b-b06e-920e26130327'
AND product_id = 'c4d6170d-68e4-4070-b164-f6284bfce2a6'
AND is_primary = 0
AND url = 'https://oss-cf.cjdropshipping.com/product/2026/01/26/03/b3ad9b11-8bf3-4ce6-942a-f4416665bb_trans.jpeg';

-- Preserve the row, but use the product's verified original instead of a dead
-- guessed alternate filename. Gallery deduplication shows it only once.
UPDATE product_images SET
  url = 'https://oss-cf.cjdropshipping.com/product/2024/01/24/03/b967276c-071e-4a8f-9bf1-dac37499b43f.jpg',
  public_url = 'https://oss-cf.cjdropshipping.com/product/2024/01/24/03/b967276c-071e-4a8f-9bf1-dac37499b43f.jpg'
WHERE id = 'd251c049-4709-4f44-bede-6410427bbec1'
AND product_id = '36b99839-2f5f-48b7-a987-27360869a861'
AND is_primary = 0
AND url = 'https://oss-cf.cjdropshipping.com/product/2024/01/24/03/b967276c-071e-4a8f-9bf1-dac37499b4a8.jpg';
