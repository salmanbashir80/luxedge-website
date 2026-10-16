import fs from 'fs';
import path from 'path';

const samplesDir = 'public/images/fashion/samples';

const specificMap = {
  'sample-floral-midi-dress.svg': '/images/fashion/floral-midi-dress.jpg',
  'sample-satin-evening-maxi-dress.svg': '/images/fashion/satin-maxi-dress.jpg',
  'sample-lace-bralette-and-brief-set.svg': '/images/fashion/lingerie-bralette.jpg',
  'sample-sheer-floral-lace-plunge-bodysuit.svg': '/images/fashion/lingerie-corset.jpg',
  'sample-silk-satin-robe-and-babydoll-set.svg': '/images/fashion/lingerie-robe.jpg',
  'sample-seductive-backless-satin-slip-dress.svg': '/images/fashion/lingerie-chemise.jpg',
  'sample-women-s-tailored-blazer-and-trouser-set.svg': '/images/fashion/tailored-blazer-suit.jpg',
  'sample-structured-tote-handbag.svg': '/images/fashion/structured-tote-bag.jpg',
  'sample-plunge-push-up-lace-corset-top.svg': '/images/fashion/lingerie-corset.jpg',
  'sample-strappy-cutout-lace-teddy.svg': '/images/fashion/lingerie-corset.jpg',
  'sample-underwire-embroidered-lace-bra-and-panty-set.svg': '/images/fashion/lingerie-corset.jpg',
  'sample-satin-camisole-sleep-set.svg': '/images/fashion/lingerie-chemise.jpg',
  'sample-seamless-high-waist-shapewear.svg': '/images/fashion/lingerie-chemise.jpg',
  'sample-women-s-casual-two-piece-co-ord-set.svg': '/images/fashion/tailored-blazer-suit.jpg',
  'sample-mini-crossbody-bag.svg': '/images/fashion/structured-tote-bag.jpg',
  'sample-women-s-zip-wallet.svg': '/images/fashion/structured-tote-bag.jpg',
  'sample-women-s-long-trench-coat.svg': '/images/fashion/jackets-outerwear.jpg',
  'sample-women-s-cropped-denim-jacket.svg': '/images/fashion/jackets-outerwear.jpg',
  'sample-women-s-classic-white-sneakers.svg': '/images/fashion/sneakers-shoes.jpg',
  'sample-men-s-casual-lace-up-sneakers.svg': '/images/fashion/sneakers-shoes.jpg',
  'sample-women-s-block-heel-sandals.svg': '/images/fashion/sneakers-shoes.jpg',
  'sample-women-s-ankle-boots.svg': '/images/fashion/sneakers-shoes.jpg',
  'sample-gold-tone-layered-necklace.svg': '/images/fashion/jewelry.jpg',
  'sample-adjustable-tennis-bracelet.svg': '/images/fashion/jewelry.jpg',
  'sample-pearl-drop-earrings.svg': '/images/fashion/jewelry.jpg',
  'sample-stainless-steel-minimalist-ring.svg': '/images/fashion/jewelry.jpg',
  'sample-minimalist-pendant-jewelry-set.svg': '/images/fashion/jewelry.jpg',
  'sample-women-s-minimalist-watch.svg': '/images/fashion/watches.jpg',
  'sample-men-s-classic-analog-watch.svg': '/images/fashion/watches.jpg',
  'sample-women-s-cat-eye-sunglasses.svg': '/images/fashion/sunglasses-accessories.jpg',
  'sample-women-s-fashion-belt.svg': '/images/fashion/sunglasses-accessories.jpg',
  'sample-men-s-casual-oxford-shirt.svg': '/images/fashion/men-clothing.jpg',
  'sample-men-s-essential-crew-neck-t-shirt.svg': '/images/fashion/men-clothing.jpg',
  'sample-men-s-zip-up-hoodie.svg': '/images/fashion/men-clothing.jpg',
  'sample-men-s-slim-fit-chino-pants.svg': '/images/fashion/jeans-pants.jpg',
  'sample-women-s-basic-cotton-crop-top.svg': '/images/fashion/women-clothing.jpg',
  'sample-women-s-classic-button-up-blouse.svg': '/images/fashion/women-clothing.jpg',
  'sample-two-piece-bikini-set.svg': '/images/fashion/women-clothing.jpg',
  'sample-one-piece-ruched-swimsuit.svg': '/images/fashion/women-clothing.jpg',
  'sample-lightweight-beach-cover-up.svg': '/images/fashion/women-clothing.jpg',
  'sample-ribbed-knit-bodycon-mini-dress.svg': '/images/fashion/dresses-tops.jpg',
  'sample-velvet-matte-lipstick.svg': '/images/fashion/women-clothing.jpg',
  'sample-liquid-foundation.svg': '/images/fashion/women-clothing.jpg',
  'sample-eyeshadow-palette.svg': '/images/fashion/women-clothing.jpg',
  'sample-waterproof-mascara.svg': '/images/fashion/women-clothing.jpg',
  'sample-makeup-brush-set.svg': '/images/fashion/women-clothing.jpg',
};

const files = fs.readdirSync(samplesDir).filter(f => f.endsWith('.svg'));

for (const file of files) {
  const jpgPath = specificMap[file] || '/images/fashion/women-clothing.jpg';
  const name = file.replace(/^sample-|\.svg$/g, '').replace(/-/g, ' ');
  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 960 960" width="100%" height="100%" role="img">
  <title>${name}</title>
  <image href="${jpgPath}" xlink:href="${jpgPath}" x="0" y="0" width="960" height="960" preserveAspectRatio="xMidYMid slice" />
</svg>
`;
  fs.writeFileSync(path.join(samplesDir, file), svgContent);
}

console.log(`Updated ${files.length} SVG files to embed real photography`);
