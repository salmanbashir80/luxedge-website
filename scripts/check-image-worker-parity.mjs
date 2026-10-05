// Read-only deployment check. Existing OAuth stays in memory; never log it.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
const config = fs.readFileSync(path.join(os.homedir(), 'AppData/Roaming/xdg.config/.wrangler/config/default.toml'), 'utf8');
const token = config.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!token) throw new Error('Existing authorized OAuth unavailable');
const response = await fetch('https://api.cloudflare.com/client/v4/accounts/f542683e97458480452b0b8ef37a898a/workers/scripts/luxedge-production/content/v2', { headers: { Authorization: `Bearer ${token}` } });
if (!response.ok) throw new Error(`Worker content read failed: HTTP ${response.status}`);
const multipart = await response.formData();
const live = await multipart.get('index.js')?.text();
if (!live) throw new Error('Worker index.js missing from deployed content');
const local = fs.readFileSync('.freebuff/image-deploy/index.js', 'utf8');
// Compare every source section except the image proxy and its new pure helper.
function sections(code) {
  const result = new Map();
  const pattern = /^\/\/ ([^\r\n]+)\r?\n/gm;
  const markers = [...code.matchAll(pattern)];
  markers.forEach((match, i) => {
    const name = match[1];
    if (name === 'api/img-proxy.ts' || name === 'src/lib/product-images.ts') return;
    const text = code.slice(match.index + match[0].length, markers[i + 1]?.index ?? code.length).replace(/\r\n/g, '\n');
    result.set(name, crypto.createHash('sha256').update(text).digest('hex'));
  });
  return result;
}
const previous = sections(live), next = sections(local);
const changed = [...new Set([...previous.keys(), ...next.keys()])].filter(name => previous.get(name) !== next.get(name));
console.log(JSON.stringify({ deployedBytes: live.length, localBytes: local.length, previousSections: previous.size, nextSections: next.size, nonImageSectionsChanged: changed }, null, 2));
if (changed.length) process.exitCode = 1;
