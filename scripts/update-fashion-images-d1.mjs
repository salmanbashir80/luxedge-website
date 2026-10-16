import fs from 'fs';

const imageMapping = {
  // Floral Midi Dress
  'floral-midi-dress': '/images/fashion/floral-midi-dress.jpg',
  'sample-floral-midi-dress': '/images/fashion/floral-midi-dress.jpg',

  // Satin Evening Maxi
  'satin-evening-maxi-dress': '/images/fashion/satin-maxi-dress.jpg',
  'sample-satin-evening-maxi-dress': '/images/fashion/satin-maxi-dress.jpg',

  // Bralette Sets
  'lace-bralette-and-brief-set': '/images/fashion/lingerie-bralette.jpg',
  'sample-lace-bralette-and-brief-set': '/images/fashion/lingerie-bralette.jpg',

  // Corsets, Teddies & Bodysuits
  'floral-lace-corset-bodysuit': '/images/fashion/lingerie-plunge-corset.jpg',
  'sample-plunge-push-up-lace-corset-top': '/images/fashion/lingerie-plunge-corset.jpg',
  'sample-strappy-cutout-lace-teddy': '/images/fashion/lingerie-strappy-teddy.jpg',
  'sample-underwire-embroidered-lace-bra-and-panty-set': '/images/fashion/lingerie-red-lace-set.jpg',
  'sample-sheer-floral-lace-plunge-bodysuit': '/images/fashion/lingerie-sheer-bodysuit.jpg',

  // Chemise & Slips & Sleepwear
  'silk-charmeuse-chemise-nightdress': '/images/fashion/lingerie-chemise.jpg',
  'sample-seductive-backless-satin-slip-dress': '/images/fashion/lingerie-satin-slip.jpg',
  'satin-camisole-sleep-set': '/images/fashion/lingerie-chemise.jpg',
  'sample-satin-camisole-sleep-set': '/images/fashion/lingerie-chemise.jpg',
  'seamless-high-waist-shapewear': '/images/fashion/lingerie-sheer-bodysuit.jpg',
  'sample-seamless-high-waist-shapewear': '/images/fashion/lingerie-sheer-bodysuit.jpg',

  // Robes
  'luxury-satin-kimono-robe': '/images/fashion/lingerie-robe.jpg',
  'sample-silk-satin-robe-and-babydoll-set': '/images/fashion/lingerie-robe.jpg',

  // Tailored Suits & Sets
  'womens-tailored-blazer-and-trouser-set': '/images/fashion/tailored-blazer-suit.jpg',
  'sample-women-s-tailored-blazer-and-trouser-set': '/images/fashion/tailored-blazer-suit.jpg',
  'womens-casual-two-piece-co-ord-set': '/images/fashion/tailored-blazer-suit.jpg',
  'sample-women-s-casual-two-piece-co-ord-set': '/images/fashion/tailored-blazer-suit.jpg',

  // Bags
  'structured-tote-handbag': '/images/fashion/structured-tote-bag.jpg',
  'sample-structured-tote-handbag': '/images/fashion/structured-tote-bag.jpg',
  'mini-crossbody-bag': '/images/fashion/structured-tote-bag.jpg',
  'sample-mini-crossbody-bag': '/images/fashion/structured-tote-bag.jpg',
  'sample-women-s-zip-wallet': '/images/fashion/structured-tote-bag.jpg',

  // Outerwear & Jackets
  'womens-long-trench-coat': '/images/fashion/jackets-outerwear.jpg',
  'sample-women-s-long-trench-coat': '/images/fashion/jackets-outerwear.jpg',
  'womens-cropped-denim-jacket': '/images/fashion/jackets-outerwear.jpg',
  'sample-women-s-cropped-denim-jacket': '/images/fashion/jackets-outerwear.jpg',

  // Shoes
  'womens-classic-white-sneakers': '/images/fashion/sneakers-shoes.jpg',
  'sample-women-s-classic-white-sneakers': '/images/fashion/sneakers-shoes.jpg',
  'mens-casual-lace-up-sneakers': '/images/fashion/sneakers-shoes.jpg',
  'sample-men-s-casual-lace-up-sneakers': '/images/fashion/sneakers-shoes.jpg',
  'womens-block-heel-sandals': '/images/fashion/sneakers-shoes.jpg',
  'sample-women-s-block-heel-sandals': '/images/fashion/sneakers-shoes.jpg',
  'sample-women-s-ankle-boots': '/images/fashion/sneakers-shoes.jpg',

  // Jewelry
  'gold-tone-layered-necklace': '/images/fashion/jewelry.jpg',
  'sample-gold-tone-layered-necklace': '/images/fashion/jewelry.jpg',
  'adjustable-tennis-bracelet': '/images/fashion/jewelry.jpg',
  'sample-adjustable-tennis-bracelet': '/images/fashion/jewelry.jpg',
  'pearl-drop-earrings': '/images/fashion/jewelry.jpg',
  'sample-pearl-drop-earrings': '/images/fashion/jewelry.jpg',
  'sample-stainless-steel-minimalist-ring': '/images/fashion/jewelry.jpg',
  'sample-minimalist-pendant-jewelry-set': '/images/fashion/jewelry.jpg',

  // Watches
  'womens-minimalist-watch': '/images/fashion/watches.jpg',
  'sample-women-s-minimalist-watch': '/images/fashion/watches.jpg',
  'sample-men-s-classic-analog-watch': '/images/fashion/watches.jpg',

  // Sunglasses & Accessories
  'womens-cat-eye-sunglasses': '/images/fashion/sunglasses-accessories.jpg',
  'sample-women-s-cat-eye-sunglasses': '/images/fashion/sunglasses-accessories.jpg',
  'sample-women-s-fashion-belt': '/images/fashion/sunglasses-accessories.jpg',

  // Men's Clothing
  'mens-casual-oxford-shirt': '/images/fashion/men-clothing.jpg',
  'sample-men-s-casual-oxford-shirt': '/images/fashion/men-clothing.jpg',
  'mens-essential-crew-neck-t-shirt': '/images/fashion/men-clothing.jpg',
  'sample-men-s-essential-crew-neck-t-shirt': '/images/fashion/men-clothing.jpg',
  'mens-zip-up-hoodie': '/images/fashion/men-clothing.jpg',
  'sample-men-s-zip-up-hoodie': '/images/fashion/men-clothing.jpg',

  // Jeans & Pants
  'mens-slim-fit-chino-pants': '/images/fashion/jeans-pants.jpg',
  'sample-men-s-slim-fit-chino-pants': '/images/fashion/jeans-pants.jpg',

  // Women's Tops & Swimwear
  'womens-basic-cotton-crop-top': '/images/fashion/women-clothing.jpg',
  'sample-women-s-basic-cotton-crop-top': '/images/fashion/women-clothing.jpg',
  'womens-classic-button-up-blouse': '/images/fashion/women-clothing.jpg',
  'sample-women-s-classic-button-up-blouse': '/images/fashion/women-clothing.jpg',
  'two-piece-bikini-set': '/images/fashion/women-clothing.jpg',
  'sample-two-piece-bikini-set': '/images/fashion/women-clothing.jpg',
  'one-piece-ruched-swimsuit': '/images/fashion/women-clothing.jpg',
  'sample-one-piece-ruched-swimsuit': '/images/fashion/women-clothing.jpg',
  'sample-lightweight-beach-cover-up': '/images/fashion/women-clothing.jpg',

  // Dresses
  'ribbed-knit-bodycon-mini-dress': '/images/fashion/dresses-tops.jpg',
  'sample-ribbed-knit-bodycon-mini-dress': '/images/fashion/dresses-tops.jpg',

  // Beauty
  'velvet-matte-lipstick': '/images/fashion/women-clothing.jpg',
  'sample-velvet-matte-lipstick': '/images/fashion/women-clothing.jpg',
  'sample-liquid-foundation': '/images/fashion/women-clothing.jpg',
  'sample-eyeshadow-palette': '/images/fashion/women-clothing.jpg',
  'sample-waterproof-mascara': '/images/fashion/women-clothing.jpg',
  'sample-makeup-brush-set': '/images/fashion/women-clothing.jpg',
};

const sqlStatements = Object.entries(imageMapping).map(([slug, img]) => {
  return `UPDATE products SET image_url = '${img}' WHERE slug = '${slug}';`;
});

// Also update product_images table if present
sqlStatements.push(`
  UPDATE product_images 
  SET public_url = (SELECT image_url FROM products WHERE products.id = product_images.product_id)
  WHERE EXISTS (SELECT 1 FROM products WHERE products.id = product_images.product_id AND products.image_url IS NOT NULL);
`);

const sql = sqlStatements.join('\n');
fs.writeFileSync('scripts/update-fashion-images.sql', sql);
console.log(`Generated ${sqlStatements.length} update statements in scripts/update-fashion-images.sql`);
