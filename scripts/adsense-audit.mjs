import http from 'node:http';
import https from 'node:https';

const domain = 'https://luxedge.us';
const PUBLISHER_ID = 'pub-5473713135927706';

async function fetchUrl(url, opts = {}) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(timeoutId);
    let body = await res.text();
    return { status: res.status, ok: res.ok, body, headers: res.headers };
  } catch (err) {
    return { status: 0, ok: false, error: err.message, body: '' };
  }
}

async function audit() {
  console.log('--- ADSENSE FINAL AUDIT ---\n');

  // PART 1 & 14 - Homepage and AdSense connection
  const home = await fetchUrl(`${domain}/`);
  const hasMeta = home.body.includes('google-adsense-account');
  const hasPubId = home.body.includes(PUBLISHER_ID);
  const hasScript = home.body.includes('adsbygoogle.js');
  console.log('1. Homepage HTML:');
  console.log(`   - HTTP 200: ${home.status === 200}`);
  console.log(`   - Google AdSense Meta: ${hasMeta}`);
  console.log(`   - Publisher ID present: ${hasPubId}`);
  console.log(`   - adsbygoogle.js present: ${hasScript}`);
  console.log(`   - Noindex tag present: ${home.body.includes('noindex')}`);

  // PART 2 - ads.txt
  const adsTxt = await fetchUrl(`${domain}/ads.txt`);
  console.log('\n2. ads.txt:');
  console.log(`   - HTTP 200: ${adsTxt.status === 200}`);
  console.log(`   - Valid publisher line: ${adsTxt.body.includes(PUBLISHER_ID) && adsTxt.body.includes('google.com')}`);
  console.log(`   - Is HTML: ${adsTxt.body.toLowerCase().includes('<!doctype html')}`);

  // PART 3 - robots.txt
  const robotsTxt = await fetchUrl(`${domain}/robots.txt`);
  console.log('\n3. robots.txt:');
  console.log(`   - HTTP 200: ${robotsTxt.status === 200}`);
  console.log(`   - Body:\n${robotsTxt.body.trim()}`);

  // PART 4 & 6 & 8 & 12 & 14 - Crawlability / Routes / Trust Signals
  const routes = [
    '/shop',
    '/category/dog-supplies',
    '/category/cat-supplies',
    '/category/pet-beds',
    '/product/adjustable-pet-car-seatbelt-tether-2-pack',
    '/product/bone-charm-pendant-necklace',
    '/product/bungee-pet-car-seatbelt-leash',
    '/product/portable-pet-dog-water-bottle',
    '/product/retractable-dog-leash-with-waste-bag-dispenser',
    '/blog',
    '/about',
    '/contact',
    '/privacy',
    '/terms',
    '/shipping',
    '/returns',
    '/sitemap.xml'
  ];

  console.log('\n4. Live Routes Check:');
  for (const r of routes) {
    const res = await fetchUrl(`${domain}${r}`);
    const noindex = res.body.includes('noindex') ? ' [NOINDEX FOUND]' : '';
    console.log(`   - ${r}: HTTP ${res.status}${noindex}`);
  }

  // PART 5 & 7 - Content Quality and Policy Products
  // Fetch API products to scan titles and descriptions for risky keywords
  const productsReq = await fetchUrl(`${domain}/api/db/products?limit=100`);
  console.log('\n5. Content Quality & Policy (API scan):');
  if (productsReq.ok) {
    const products = JSON.parse(productsReq.body);
    const riskyWords = ['weapon', 'knife', 'knives', 'gun', 'firearm', 'tobacco', 'nicotine', 'cbd', 'thc', 'drug', 'adult', 'sex', 'counterfeit', 'medical', 'cure'];
    let risksFound = 0;
    for (const p of products) {
      const text = `${p.title} ${p.description || ''}`.toLowerCase();
      for (const w of riskyWords) {
        if (text.includes(` ${w} `)) {
          console.log(`   [RISK] Product: ${p.slug} contains keyword '${w}'`);
          risksFound++;
        }
      }
    }
    if (risksFound === 0) console.log('   - No explicit policy risky keywords found in product titles/descriptions.');
  }

  // Header inspection (CSP, etc.)
  console.log('\n6. HTTP Headers (CSP/Consent):');
  for (const [key, val] of Object.entries(home.headers)) {
    if (key.toLowerCase().includes('security')) {
      console.log(`   - ${key}: ${val}`);
    }
  }

  // End
  console.log('\n--- AUDIT SCRIPT COMPLETE ---');
}

audit();
