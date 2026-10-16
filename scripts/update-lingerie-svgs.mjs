import fs from 'fs';

const svgUpdates = {
  'sample-underwire-embroidered-lace-bra-and-panty-set.svg': '/images/fashion/lingerie-red-lace-set.jpg',
  'sample-plunge-push-up-lace-corset-top.svg': '/images/fashion/lingerie-plunge-corset.jpg',
  'sample-strappy-cutout-lace-teddy.svg': '/images/fashion/lingerie-strappy-teddy.jpg',
  'sample-seductive-backless-satin-slip-dress.svg': '/images/fashion/lingerie-satin-slip.jpg',
  'sample-sheer-floral-lace-plunge-bodysuit.svg': '/images/fashion/lingerie-sheer-bodysuit.jpg',
  'sample-lace-bralette-and-brief-set.svg': '/images/fashion/lingerie-bralette.jpg',
  'sample-silk-satin-robe-and-babydoll-set.svg': '/images/fashion/lingerie-robe.jpg',
  'sample-satin-camisole-sleep-set.svg': '/images/fashion/lingerie-chemise.jpg',
  'sample-seamless-high-waist-shapewear.svg': '/images/fashion/lingerie-sheer-bodysuit.jpg'
};

for (const [file, img] of Object.entries(svgUpdates)) {
  const filePath = 'public/images/fashion/samples/' + file;
  if (fs.existsSync(filePath)) {
    const title = file.replace('sample-', '').replace('.svg', '').replace(/-/g, ' ');
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 960 960" width="100%" height="100%" role="img">
  <title>${title}</title>
  <image href="${img}" xlink:href="${img}" x="0" y="0" width="960" height="960" preserveAspectRatio="xMidYMid slice" />
</svg>
`;
    fs.writeFileSync(filePath, svg);
    console.log('Updated', file, '->', img);
  }
}
