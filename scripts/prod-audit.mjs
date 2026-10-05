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
  const urls = [
    '/',
    '/shop',
    '/blog',
    '/sitemap.xml',
    '/robots.txt',
    '/ads.txt',
    '/google-products.xml',
    '/api/db/products',
    '/api/db/categories'
  ];

  console.log(`Starting Production Audit on ${domain}\n`);
  
  let failed = false;

  for (const p of urls) {
    const res = await fetchUrl(`${domain}${p}`);
    console.log(`[${res.status}] ${p}`);
    if (!res.ok && res.status !== 401) {
      console.log(`  -> FAILED: ${res.status}`);
      failed = true;
    }
    if (p === '/sitemap.xml') {
      if (res.body.includes('DATABASE UNAVAILABLE')) {
        console.log('  -> EMERGENCY SITEMAP DETECTED');
        failed = true;
      }
    }
    if (p === '/api/db/products' && res.ok) {
      try {
        const json = JSON.parse(res.body);
        console.log(`  -> Fetched ${json.length} products`);
      } catch(e) {
        console.log(`  -> Failed to parse JSON`);
      }
    }
  }

  // GA4 and AdSense verification
  const home = await fetchUrl(`${domain}/`);
  if (home.ok) {
    const hasAdSenseMeta = home.body.includes('google-adsense-account');
    console.log(`[OK] AdSense Meta Tag: ${hasAdSenseMeta}`);
    if (!hasAdSenseMeta) failed = true;
  }

  if (failed) {
    console.log('\nPRODUCTION NOT STABLE');
  } else {
    console.log('\nPRODUCTION STABLE — SAFE TO LEAVE UNDER ADSENSE REVIEW');
  }
}

checkSite();
