// scripts/final-audit.mjs — Comprehensive regression & verification audit
async function runAudit() {
  const routes = [
    { name: 'Homepage', url: 'https://luxedge.us/' },
    { name: 'Shop', url: 'https://luxedge.us/shop' },
    { name: 'Category: Dog Supplies', url: 'https://luxedge.us/category/dog-supplies' },
    { name: 'Category: Cat Supplies', url: 'https://luxedge.us/category/cat-supplies' },
    { name: 'Category: Pet Beds', url: 'https://luxedge.us/category/pet-beds' },
    { name: 'Product 1', url: 'https://luxedge.us/product/adjustable-pet-car-seatbelt-tether-2-pack' },
    { name: 'Product 2', url: 'https://luxedge.us/product/bone-charm-pendant-necklace' },
    { name: 'Product 3', url: 'https://luxedge.us/product/bungee-pet-car-seatbelt-leash' },
    { name: 'Account Route', url: 'https://luxedge.us/account' },
    { name: 'Cart Route', url: 'https://luxedge.us/cart' },
    { name: 'Checkout Page', url: 'https://luxedge.us/checkout' },
    { name: 'ads.txt', url: 'https://luxedge.us/ads.txt' },
    { name: 'robots.txt', url: 'https://luxedge.us/robots.txt' },
    { name: 'sitemap.xml', url: 'https://luxedge.us/sitemap.xml' },
  ];

  console.log('--- Checking Live Routes ---');
  for (const r of routes) {
    const res = await fetch(r.url);
    const text = await res.text();
    console.log(`${r.name.padEnd(25)} | HTTP ${res.status} | Size: ${text.length} chars | OK: ${res.ok}`);
  }

  console.log('\n--- Checking AdSense Freeze ---');
  const adsTxtRes = await fetch('https://luxedge.us/ads.txt');
  const adsTxt = await adsTxtRes.text();
  console.log('ads.txt status:', adsTxtRes.status);
  console.log('ads.txt contents:\n' + adsTxt.trim());

  const homeRes = await fetch('https://luxedge.us/');
  const homeHtml = await homeRes.text();
  const hasAdsenseClient = homeHtml.includes('ca-pub-') || homeHtml.includes('adsbygoogle');
  console.log('Homepage contains AdSense client/script:', hasAdsenseClient);

  console.log('\n--- Checking D1 Sync Queue Endpoint ---');
  const syncRes = await fetch('https://luxedge.us/api/db/sync', { method: 'GET' });
  console.log('Sync endpoint status (GET expected 401 or method guard):', syncRes.status);

  console.log('\n--- Checking No Public Supabase Catalog Reads ---');
  // Check if frontend uses Supabase or D1
  const clientJsRes = await fetch('https://luxedge.us/assets/index-TgoTQaym.js');
  const clientJs = await clientJsRes.text();
  const hasD1Api = clientJs.includes('/api/db');
  console.log('Client bundle routes storefront reads to /api/db:', hasD1Api);
}

runAudit();
