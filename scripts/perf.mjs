// scripts/perf.mjs — Performance and Network Profiler
import { performance } from 'node:perf_hooks';

async function profileMobileShop() {
  console.log('--- Profiling Initial Mobile /shop Visit ---');
  
  // 1. Fetch /shop page shell HTML
  const t0 = performance.now();
  const htmlRes = await fetch('https://luxedge.us/shop', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }
  });
  const htmlTtfb = performance.now() - t0;
  const htmlBuf = await htmlRes.arrayBuffer();
  const html = new TextDecoder().decode(htmlBuf);
  console.log('Shop HTML TTFB:', htmlTtfb.toFixed(1) + ' ms');
  console.log('Shop HTML Size:', htmlBuf.byteLength, 'bytes');

  // Parse resources from HTML
  const jsMatch = html.match(/src="(\/assets\/index-[A-Za-z0-9_-]+\.js)"/);
  const cssMatch = html.match(/href="(\/assets\/index-[A-Za-z0-9_-]+\.css)"/);
  
  let totalTransferred = htmlBuf.byteLength;
  let totalRequests = 1;
  let jsTransferred = 0;
  let cssTransferred = 0;

  if (cssMatch) {
    const cssRes = await fetch('https://luxedge.us' + cssMatch[1], { headers: { 'Accept-Encoding': 'gzip, deflate, br' } });
    const cssBuf = await cssRes.arrayBuffer();
    cssTransferred = cssBuf.byteLength;
    totalTransferred += cssTransferred;
    totalRequests++;
    console.log('CSS:', cssMatch[1], cssTransferred, 'bytes');
  }

  if (jsMatch) {
    const jsRes = await fetch('https://luxedge.us' + jsMatch[1], { headers: { 'Accept-Encoding': 'gzip, deflate, br' } });
    const jsBuf = await jsRes.arrayBuffer();
    jsTransferred = jsBuf.byteLength;
    totalTransferred += jsTransferred;
    totalRequests++;
    console.log('Main JS:', jsMatch[1], jsTransferred, 'bytes');
  }

  // Dependent chunks loaded on boot: react and storefrontIcons
  const reactRes = await fetch('https://luxedge.us/assets/react-DFxmOrpz.js');
  const reactBuf = await reactRes.arrayBuffer();
  jsTransferred += reactBuf.byteLength;
  totalTransferred += reactBuf.byteLength;
  totalRequests++;

  const iconsRes = await fetch('https://luxedge.us/assets/storefrontIcons-DfN1X8eK.js');
  const iconsBuf = await iconsRes.arrayBuffer();
  jsTransferred += iconsBuf.byteLength;
  totalTransferred += iconsBuf.byteLength;
  totalRequests++;

  // 2. Fetch categories API
  const catT0 = performance.now();
  const catRes = await fetch('https://luxedge.us/api/db/categories?select=id,name,slug,is_active&order=sort_order');
  const catTtfb = performance.now() - catT0;
  const catBuf = await catRes.arrayBuffer();
  totalTransferred += catBuf.byteLength;
  totalRequests++;
  console.log('Categories API TTFB:', catTtfb.toFixed(1) + ' ms, Size:', catBuf.byteLength, 'bytes');

  // 3. Fetch products API (Initial batch for /shop)
  const prodT0 = performance.now();
  const prodRes = await fetch('https://luxedge.us/api/db/products?limit=24&offset=0&status=in.(active,published)', {
    headers: { 'Accept-Encoding': 'gzip, deflate, br' }
  });
  const prodTtfb = performance.now() - prodT0;
  const prodBuf = await prodRes.arrayBuffer();
  const prodJson = JSON.parse(new TextDecoder().decode(prodBuf));
  const prodApiTransferred = prodBuf.byteLength;
  totalTransferred += prodApiTransferred;
  totalRequests++;
  console.log('Products API TTFB:', prodTtfb.toFixed(1) + ' ms, Transferred:', prodApiTransferred, 'bytes');

  // 4. Initial viewport images (at 390px mobile, 4 product cards visible in initial viewport)
  let imageTransferred = 0;
  const viewportProducts = prodJson.slice(0, 4);
  for (const p of viewportProducts) {
    if (p.image_url) {
      const imgUrl = 'https://luxedge.us/api/img-proxy?url=' + encodeURIComponent(p.image_url) + '&w=400';
      const imgRes = await fetch(imgUrl, { headers: { 'Accept': 'image/avif,image/webp,image/*' } });
      const imgBuf = await imgRes.arrayBuffer();
      imageTransferred += imgBuf.byteLength;
      totalTransferred += imgBuf.byteLength;
      totalRequests++;
    }
  }

  console.log('\n--- Mobile /shop Summary ---');
  console.log('Total Requests:', totalRequests);
  console.log('Total Transferred Data:', totalTransferred, 'bytes (' + (totalTransferred / 1024).toFixed(1) + ' KB)');
  console.log('JS Transferred:', jsTransferred, 'bytes (' + (jsTransferred / 1024).toFixed(1) + ' KB)');
  console.log('Product API Transferred:', prodApiTransferred, 'bytes (' + (prodApiTransferred / 1024).toFixed(1) + ' KB)');
  console.log('Image Transferred (Initial Viewport):', imageTransferred, 'bytes (' + (imageTransferred / 1024).toFixed(1) + ' KB)');
  console.log('Products Fetched Initially:', prodJson.length);
  console.log('All 117 Products Fetched:', prodJson.length === 117 ? 'YES' : 'NO');

  // Measure TTFBs for Homepage, Shop, Product
  console.log('\n--- TTFB Measurements ---');
  const homeT0 = performance.now();
  await (await fetch('https://luxedge.us/')).text();
  const homeTtfb = performance.now() - homeT0;
  console.log('Homepage TTFB:', homeTtfb.toFixed(1) + ' ms');

  const shopT0 = performance.now();
  await (await fetch('https://luxedge.us/shop')).text();
  const shopTtfb = performance.now() - shopT0;
  console.log('Shop TTFB:', shopTtfb.toFixed(1) + ' ms');

  const prodPageT0 = performance.now();
  await (await fetch('https://luxedge.us/product/adjustable-pet-car-seatbelt-tether-2-pack')).text();
  const prodPageTtfb = performance.now() - prodPageT0;
  console.log('Product Page TTFB:', prodPageTtfb.toFixed(1) + ' ms');
}

profileMobileShop();
