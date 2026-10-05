import http from 'node:http';
import https from 'node:https';

async function fetchUrl(url, opts = {}) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(timeoutId);
    let body = '';
    if (res.headers.get('content-type')?.includes('application/json')) {
      body = await res.text();
    } else {
      body = await res.text();
    }
    return { status: res.status, ok: res.ok, body, headers: res.headers };
  } catch (err) {
    return { status: 0, ok: false, error: err.message };
  }
}

async function checkSite() {
  const domain = 'https://luxedge.us';
  
  const [productsRes, imagesRes] = await Promise.all([
    fetchUrl(`${domain}/api/db/products`),
    fetchUrl(`${domain}/api/db/product_images`)
  ]);

  if (!productsRes.ok || !imagesRes.ok) {
    console.log("Failed to fetch products or images");
    return;
  }

  const products = JSON.parse(productsRes.body);
  const images = JSON.parse(imagesRes.body);

  let publicProducts = 0;
  let heldProducts = 0;
  let workingImages = 0;
  let brokenImages = 0;

  const imageMap = {};
  for (const img of images) {
    if (img.is_primary) {
      imageMap[img.product_id] = img.public_url || img.url;
    }
  }

  for (const p of products) {
    if (p.status === 'active' && p.commerce_readiness === 'COMMERCE_READY') {
      publicProducts++;
      const imgUrl = imageMap[p.id];
      if (imgUrl) {
        // Fast HEAD request
        try {
          const res = await fetch(imgUrl, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
          if (res.ok) {
            workingImages++;
          } else {
            brokenImages++;
          }
        } catch (e) {
          brokenImages++;
        }
      } else {
        brokenImages++; // No primary image counts as broken for this test
      }
    } else {
      heldProducts++;
    }
  }

  console.log(`\nReport totals:`);
  console.log(`- public products: ${publicProducts}`);
  console.log(`- working primary images: ${workingImages}`);
  console.log(`- broken primary images: ${brokenImages}`);
  console.log(`- held/unpublished products: ${heldProducts}`);
}

checkSite();
