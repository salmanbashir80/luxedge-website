import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import handler from '../img-proxy';

afterEach(() => vi.unstubAllGlobals());

describe('image proxy width regression', () => {
  it.each(['0', '1', '2', '-1', 'junk', '', '800oops'])('does not request a tiny/invalid width for w=%s', async width => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }));
    vi.stubGlobal('fetch', fetcher);
    const req = { method: 'GET', headers: { host: 'luxedge.us' }, url: `/api/img-proxy?url=${encodeURIComponent('https://oss-cf.cjdropshipping.com/photo.jpg')}&w=${width}` } as IncomingMessage;
    const res = { writeHead: vi.fn(), end: vi.fn() } as unknown as ServerResponse;
    await handler(req, res);
    expect(fetcher.mock.calls[0][1].cf.image.width).toBe(800);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'image/jpeg' }));
  });
  it('preserves safe thumbnail widths', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/webp' } }));
    vi.stubGlobal('fetch', fetcher);
    const req = { method: 'GET', headers: { host: 'luxedge.us', accept: 'image/webp' }, url: `/api/img-proxy?url=${encodeURIComponent('https://oss-cf.cjdropshipping.com/photo.jpg')}&w=400` } as IncomingMessage;
    const res = { writeHead: vi.fn(), end: vi.fn() } as unknown as ServerResponse;
    await handler(req, res);
    expect(fetcher.mock.calls[0][1].cf.image).toMatchObject({ width: 400, format: 'webp' });
  });
});
