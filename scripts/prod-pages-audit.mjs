import http from 'node:http';
import https from 'node:https';

async function fetchUrl(url, opts = {}) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(timeoutId);
    let body = await res.text();
    return { status: res.status, ok: res.ok, body, headers: res.headers };
  } catch (err) {
    return { status: 0, ok: false, error: err.message };
  }
}

async function checkPages() {
  const domain = 'https://luxedge.us';
  const urls = [
    '/product/adjustable-pet-car-seatbelt-tether-2-pack',
    '/product/bone-charm-pendant-necklace',
    '/blog/best-bird-feeder-buyers-guide',
    '/category/bird-supplies'
  ];

  for (const u of urls) {
    const res = await fetchUrl(`${domain}${u}`);
    console.log(`[${res.status}] ${u}`);
    if (!res.ok) {
      console.log(`  -> FAILED`);
    } else {
      // Check for canonical and no placeholder text
      if (res.body.includes('<link rel="canonical"')) {
        console.log('  -> Canonical OK');
      }
      if (res.body.toLowerCase().includes('database unavailable') || res.body.toLowerCase().includes('402')) {
        console.log('  -> ERROR text found in HTML');
      }
    }
  }
}

checkPages();
