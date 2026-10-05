// ============================================================================
// LUXEDGE — Image Proxy (CORS/ORB bypass)
//
// Proxies external product images (CJ Dropshipping CDN) through the worker
// so browsers can load them without CORS/ORB restrictions.
// Usage: /api/img-proxy?url=<encoded-image-url>
// ============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import { normalizeImageWidth } from '../src/lib/product-images';
const ALLOWED_HOSTS = [
  'cf.cjdropshipping.com',
  'oss-cf.cjdropshipping.com',
  'img.ltwebstatic.com',
  'ae01.alicdn.com',
];

function isAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    return ALLOWED_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch {
    return false;
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    });
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const target = url.searchParams.get('url');

  if (!target || !isAllowed(target)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Missing or disallowed url parameter');
    return;
  }

  const width = normalizeImageWidth(url.searchParams.get('w'));

  const clientAccept = ((req.headers['accept'] as string) || '').toLowerCase();
  let negotiatedFormat: 'avif' | 'webp' | 'auto' = 'auto';
  if (clientAccept.includes('image/avif')) {
    negotiatedFormat = 'avif';
  } else if (clientAccept.includes('image/webp')) {
    negotiatedFormat = 'webp';
  }

  try {
    const upstream = await fetch(target, {
      cf: {
        image: {
          width: width,
          quality: 80,
          format: negotiatedFormat,
          fit: 'scale-down',
        },
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': (req.headers['accept'] as string) || 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
      redirect: 'follow',
    } as any);

    if (!upstream.ok) {
      res.writeHead(upstream.status, { 'Content-Type': 'text/plain' });
      res.end(`Upstream returned ${upstream.status}`);
      return;
    }

    const contentType = upstream.headers.get('content-type') || (negotiatedFormat === 'avif' ? 'image/avif' : negotiatedFormat === 'webp' ? 'image/webp' : 'image/jpeg');
    const cacheControl = upstream.headers.get('cache-control') || 'public, max-age=86400';
    const cfResized = upstream.headers.get('cf-resized');

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      'Access-Control-Allow-Origin': '*',
      'Vary': 'Accept',
    };
    if (cfResized) {
      headers['cf-resized'] = cfResized;
    }

    res.writeHead(200, headers);

    const body = await upstream.arrayBuffer();
    res.end(Buffer.from(body));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Image proxy error');
  }
}
