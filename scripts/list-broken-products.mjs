import http from 'node:http';
import https from 'node:https';

async function run() {
  const domain = 'https://luxedge.us';
  const [productsRes, imagesRes] = await Promise.all([
    fetch(`${domain}/api/db/products`),
    fetch(`${domain}/api/db/product_images`)
  ]);

  const products = await productsRes.json();
  const images = await imagesRes.json();

  const imagesByProduct = {};
  for (const img of images) {
    if (!imagesByProduct[img.product_id]) imagesByProduct[img.product_id] = [];
    imagesByProduct[img.product_id].push(img);
  }

  const affectedProducts = [];

  for (const p of products) {
    if (p.status === 'active') {
      const productImages = imagesByProduct[p.id] || [];
      const primaryImg = productImages.find(i => i.is_primary) || productImages[0];
      const imgUrl = primaryImg ? (primaryImg.public_url || primaryImg.url) : null;
      
      let broken = false;
      if (imgUrl) {
        if (imgUrl.includes('supabase.co')) {
          broken = true;
        } else {
          try {
            const res = await fetch(imgUrl, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
            if (!res.ok) broken = true;
          } catch (e) {
            broken = true;
          }
        }
      } else {
        broken = true;
      }
      
      if (broken) {
        affectedProducts.push({ 
          id: p.id, 
          title: p.title, 
          imgUrl,
          images: productImages.map(i => ({ url: i.public_url || i.url, is_primary: i.is_primary }))
        });
      }
    }
  }

  console.log(`Found ${affectedProducts.length} broken products.`);
  console.log(JSON.stringify(affectedProducts, null, 2));
}

run();
