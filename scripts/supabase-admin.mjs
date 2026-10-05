import fs from 'fs';
import https from 'https';

const SUPABASE_PROJECT_REF = 'eidujmfbcfrjjleitaqp';
let tokenCache = '';
function getPat() {
  if (tokenCache) return tokenCache;
  if (process.env.SUPABASE_ACCESS_TOKEN) return (tokenCache = process.env.SUPABASE_ACCESS_TOKEN);
  try {
    tokenCache = fs.readFileSync('.freebuff/supabase-pat', 'utf8').trim();
    if (tokenCache) return tokenCache;
  } catch (err) {}
  throw new Error('No SUPABASE_ACCESS_TOKEN in env and .freebuff/supabase-pat not found');
}

export function execSql(query) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query });
    const req = https.request(
      `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getPat()}`,
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          if (res.statusCode !== 200 && res.statusCode !== 201) {
            reject(new Error(`HTTP ${res.statusCode} (pg/query) -> ${body}`));
            return;
          }
          if (res.headers['content-type']?.includes('application/json')) {
            try {
              resolve(JSON.parse(body));
            } catch (err) {
              reject(new Error('Failed to parse pg/query JSON: ' + body));
            }
          } else {
            resolve(body);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
