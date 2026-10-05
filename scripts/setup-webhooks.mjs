import { execSql as sql } from './supabase-admin.mjs';
import fs from 'fs';

const secret = fs.readFileSync('.freebuff/sync-secret', 'utf8').trim();

const TABLES = [
  'products', 'categories', 'product_images', 'product_variants',
  'coupons', 'blog_posts', 'media_videos'
];

async function main() {
  console.log('Creating generic sync function...');
  const funcQuery = `
    CREATE OR REPLACE FUNCTION sync_to_cloudflare() RETURNS trigger AS $$
    BEGIN
      PERFORM net.http_post(
        url := 'https://luxedge.us/api/db/sync',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer ${secret}"}'::jsonb,
        body := jsonb_build_object(
          'type', TG_OP,
          'table', TG_TABLE_NAME,
          'schema', TG_TABLE_SCHEMA,
          'record', (CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE row_to_json(NEW) END),
          'old_record', (CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE row_to_json(OLD) END)
        )
      );
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;
  `;
  try {
    await sql(funcQuery);
    console.log('✅ Function created.');
  } catch (err) {
    console.error('❌ Failed to create function:', err.message);
    return;
  }

  for (const table of TABLES) {
    const triggerName = `sync_d1_${table}`;
    console.log(`Setting up webhook for ${table}...`);
    
    try {
      await sql(`DROP TRIGGER IF EXISTS "${triggerName}" ON "public"."${table}";`);
      
      const query = `
        CREATE TRIGGER "${triggerName}" 
        AFTER INSERT OR DELETE OR UPDATE ON "public"."${table}" 
        FOR EACH ROW 
        EXECUTE FUNCTION sync_to_cloudflare();
      `;
      await sql(query);
      console.log(`✅ Webhook created for ${table}`);
    } catch (err) {
      console.error(`❌ Failed to create webhook for ${table}:`, err.message);
    }
  }
}

main().catch(console.error);
