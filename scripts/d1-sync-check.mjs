import { sql } from './supabase-export.mjs';

const PUBLIC_TABLES = [
  'products',
  'categories',
  'product_images',
  'blog_posts',
  'media_videos',
];

async function fetchD1(table) {
  const url = `https://luxedge.us/api/db/${table}?limit=10000`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`D1 API failed for ${table}: ${res.status}`);
  return res.json();
}

async function fetchSupabase(table, d1Data) {
  // Use D1 data structure to determine columns
  if (!d1Data || d1Data.length === 0) {
    return await sql(`SELECT * FROM ${table} ORDER BY id ASC LIMIT 10000`);
  }
  const cols = Object.keys(d1Data[0]).join(', ');
  const data = await sql(`SELECT ${cols} FROM ${table} ORDER BY id ASC LIMIT 10000`);
  return data;
}

async function main() {
  console.log('Starting reconciliation check between Supabase (Authoritative) and D1 (Public Edge)...');
  
  let allOk = true;

  for (const table of PUBLIC_TABLES) {
    console.log(`\n--- Checking ${table} ---`);
    
    let supabaseData;
    let d1Data;
    try {
      d1Data = await fetchD1(table);
      supabaseData = await fetchSupabase(table, d1Data);
    } catch (err) {
      console.error(`Failed to fetch data for ${table}:`, err.message);
      allOk = false;
      continue;
    }
    
    const d1Map = new Map(d1Data.map(r => [r.id, r]));
    const spMap = new Map(supabaseData.map(r => [r.id, r]));

    let missingInD1 = 0;
    let extraInD1 = 0;
    let drift = 0;

    for (const spRow of supabaseData) {
      if (!d1Map.has(spRow.id)) {
        missingInD1++;
      } else {
        const d1Row = d1Map.get(spRow.id);
        // Compare only columns present in D1
        for (const [key, d1Val] of Object.entries(d1Row)) {
          let spVal = spRow[key];
          
          let normSp = spVal;
          let normD1 = d1Val;

          if (typeof normSp === 'boolean') normSp = normSp ? 'true' : 'false';
          else if (normSp === 1 && (typeof normD1 === 'boolean' || normD1 === 'true' || normD1 === 'false')) normSp = 'true';
          else if (normSp === 0 && (typeof normD1 === 'boolean' || normD1 === 'true' || normD1 === 'false')) normSp = 'false';
          else if (typeof normSp === 'object' && normSp !== null) {
            normSp = JSON.stringify(normSp);
            // Handle tags differences: JSON array vs CSV
            if (key === 'tags' || key === 'features' || key === 'specifications') {
               try {
                 if (Array.isArray(spVal)) normSp = spVal.join(',');
               } catch(e) {}
            }
          } else {
             normSp = String(normSp);
          }

          if (typeof normD1 === 'boolean') normD1 = normD1 ? 'true' : 'false';
          else if (typeof normD1 === 'object' && normD1 !== null) {
            normD1 = JSON.stringify(normD1);
          } else {
             normD1 = String(normD1);
          }

          // Dates
          if (key === 'created_at' || key === 'updated_at' || key === 'published_at') {
            if (typeof normSp === 'string' && normSp.includes('T') && normSp.endsWith('Z')) normSp = normSp.replace('T', ' ').replace('Z', '');
            if (typeof normD1 === 'string' && normD1.includes('T')) {
              normD1 = normD1.replace('T', ' ');
              if (normD1.endsWith('Z')) normD1 = normD1.replace('Z', '');
              if (normD1.endsWith('+00:00')) normD1 = normD1.replace('+00:00', '+00');
            }
          }
          
          if (key === 'tags' && normD1.startsWith('[') && normD1.endsWith(']')) {
             try {
               normD1 = JSON.parse(normD1).join(',');
             } catch(e) {}
          }
          if (key === 'tags' && normSp.startsWith('[') && normSp.endsWith(']')) {
             try {
               normSp = JSON.parse(normSp).join(',');
             } catch(e) {}
          }
          
          if (key === 'features' && normD1.startsWith('[') && normD1.endsWith(']')) {
             try {
               normD1 = JSON.parse(normD1).join(',');
             } catch(e) {}
          }
          if (key === 'features' && normSp.startsWith('[') && normSp.endsWith(']')) {
             try {
               normSp = JSON.parse(normSp).join(',');
             } catch(e) {}
          }

          if (key === 'url' || key === 'image_url') {
             if (normD1.includes('/')) normD1 = normD1.split('/').pop();
             if (normSp.includes('/')) normSp = normSp.split('/').pop();
          }

          // Number normalization (e.g. 10.0 vs 10)
          if (!isNaN(Number(normSp)) && !isNaN(Number(normD1)) && normSp !== '' && normD1 !== '') {
             if (Number(normSp) === Number(normD1)) {
                 normSp = normD1;
             }
          }
          
          if ((normSp === '' || normSp === 'null' || normSp === undefined || normSp === null) && (normD1 === '[]' || normD1 === 'null' || normD1 === '' || normD1 === undefined || normD1 === null)) {
              normSp = normD1;
          }

          if (normSp !== normD1 && !(spVal === null && d1Val === null)) {
            // console.log(`Drift on ${table}:${spRow.id} column ${key}: SP='${normSp}' D1='${normD1}'`);
            if (drift === 0) {
              console.log(`First mismatch in ${table} [${spRow.id}]: ${key} | SP='${normSp}' | D1='${normD1}'`);
            }
            drift++;
            break;
          }
        }
      }
    }

    for (const d1Row of d1Data) {
      if (!spMap.has(d1Row.id)) {
        extraInD1++;
      }
    }

    if (missingInD1 === 0 && extraInD1 === 0 && drift === 0) {
      console.log(`✅ OK: ${d1Data.length} rows perfectly matched.`);
    } else {
      allOk = false;
      console.log(`⚠️  DRIFT DETECTED:`);
      console.log(`  - Supabase total: ${supabaseData.length}`);
      console.log(`  - D1 total: ${d1Data.length}`);
      console.log(`  - Missing in D1: ${missingInD1}`);
      console.log(`  - Extra in D1: ${extraInD1}`);
      console.log(`  - Records with mismatched public fields: ${drift}`);
    }
  }

  console.log('\n================================');
  if (allOk) {
    console.log('✅ RECONCILIATION SUCCESS: D1 is perfectly in sync with Supabase.');
  } else {
    console.log('❌ RECONCILIATION FAILED: Drift detected. Wait for Webhook sync or run scripts/d1-import.mjs manually.');
  }
}

main().catch(console.error);
