import { execSql as sql } from './supabase-admin.mjs';
import crypto from 'crypto';

async function fetchCategory(id) {
  const res = await fetch(`https://luxedge.us/api/db/categories?id=eq.${id}`, {
    headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
  });
  if (!res.ok) throw new Error('Failed to fetch D1 API');
  return res.json();
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('--- END-TO-END SYNC TEST ---');
  
  const testId = crypto.randomUUID();
  console.log(`1. Creating test category in Supabase: ${testId}...`);
  
  await sql(`
    INSERT INTO public.categories (id, name, slug, description, is_active, updated_at) 
    VALUES ('${testId}', 'E2E Test Category', '${testId}', 'Test', true, now())
  `);
  
  console.log('Waiting for Webhook -> Queue -> D1 Sync...');
  
  let found = false;
  for (let i = 0; i < 20; i++) {
    await sleep(2000);
    const cats = await fetchCategory(testId);
    if (cats.length > 0) {
      found = true;
      console.log(`✅ Success! Test category ${testId} appeared in D1 API in ~${(i+1)*2} seconds.`);
      break;
    }
    process.stdout.write('.');
  }
  
  if (!found) {
    console.error(`\n❌ Failed to sync INSERT. Test category not found in D1 after 40 seconds.`);
  }

  console.log(`\n2. Deleting test category from Supabase: ${testId}...`);
  await sql(`DELETE FROM public.categories WHERE id = '${testId}'`);
  
  console.log('Waiting for Webhook -> Queue -> D1 Sync...');
  let removed = false;
  for (let i = 0; i < 20; i++) {
    await sleep(2000);
    const cats = await fetchCategory(testId);
    if (cats.length === 0) {
      removed = true;
      console.log(`✅ Success! Test category ${testId} disappeared from D1 API in ~${(i+1)*2} seconds.`);
      break;
    }
    process.stdout.write('.');
  }

  if (!removed) {
    console.error(`\n❌ Failed to sync DELETE. Test category still present in D1 after 40 seconds.`);
  }

  if (found && removed) {
    console.log('\n✅ END-TO-END TEST PASSED! The auto-sync system is fully operational.');
  }
}

main().catch(console.error);
