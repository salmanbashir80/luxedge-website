import { execSql } from './supabase-admin.mjs';

async function run() {
  const funcDef = await execSql(`SELECT prosrc FROM pg_proc WHERE proname = 'sync_to_cloudflare'`);
  if (!funcDef || funcDef.length === 0) {
    console.error("sync_to_cloudflare function not found");
    return;
  }
  
  const src = funcDef[0].prosrc;
  const match = src.match(/'Bearer\s+([^']+)'/);
  if (!match) {
    console.log("No literal Bearer secret found in function (maybe already migrated?).");
  } else {
    const secret = match[1];
    
    // Check if vault secret exists
    const existing = await execSql(`SELECT secret_id FROM vault.secrets WHERE name = 'luxedge_d1_sync_secret'`);
    if (existing.length === 0) {
      console.log("Inserting secret into vault.secrets...");
      await execSql(`SELECT vault.create_secret('${secret}', 'luxedge_d1_sync_secret', 'D1 Sync Webhook Secret')`);
    } else {
      console.log("Secret already exists in vault, updating...");
      await execSql(`SELECT vault.update_secret('${existing[0].secret_id}', '${secret}')`);
    }
  }

  console.log("Updating sync_to_cloudflare to read from vault.decrypted_secrets...");
  
  const newFuncSql = `
    CREATE OR REPLACE FUNCTION public.sync_to_cloudflare()
    RETURNS trigger AS $$
    DECLARE
      payload jsonb;
      request_id bigint;
      sync_secret text;
    BEGIN
      -- Read secret from Vault
      SELECT decrypted_secret INTO sync_secret
      FROM vault.decrypted_secrets
      WHERE name = 'luxedge_d1_sync_secret'
      LIMIT 1;

      IF sync_secret IS NULL THEN
        RAISE EXCEPTION 'Sync secret luxedge_d1_sync_secret not found in vault';
      END IF;

      payload := jsonb_build_object(
        'type', TG_OP,
        'table', TG_TABLE_NAME,
        'schema', TG_TABLE_SCHEMA,
        'record', CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN row_to_json(NEW) ELSE null END,
        'old_record', CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN row_to_json(OLD) ELSE null END
      );
      
      SELECT net.http_post(
        url := 'https://luxedge.us/api/db/sync',
        body := payload,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || sync_secret
        )
      ) INTO request_id;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;
  `;

  await execSql(newFuncSql);
  console.log("Function sync_to_cloudflare updated successfully!");
}

run().catch(console.error);
