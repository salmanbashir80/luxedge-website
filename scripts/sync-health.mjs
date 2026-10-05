import { execSync } from 'child_process';
import { execSql } from './supabase-admin.mjs';

async function main() {
  console.log("=========================================");
  console.log(" LUXEDGE SYNC OPERATIONAL HEALTH REPORT");
  console.log("=========================================\n");

  console.log("[1] SUPABASE WEBHOOKS & VAULT:");
  try {
    const vault = await execSql(`SELECT name, created_at, updated_at FROM vault.secrets WHERE name = 'luxedge_d1_sync_secret'`);
    if (vault.length > 0) {
      console.log(`✅ Vault Secret Active: luxedge_d1_sync_secret (Updated: ${vault[0].updated_at})`);
    } else {
      console.log(`❌ Vault Secret MISSING.`);
    }

    const triggers = await execSql(`SELECT trigger_name, event_object_table FROM information_schema.triggers WHERE trigger_name LIKE 'sync_d1_%'`);
    console.log(`✅ Active Triggers (${triggers.length}):`, triggers.map(t => t.event_object_table).join(', '));
  } catch(e) {
    console.log(`❌ Supabase verification failed: ${e.message}`);
  }

  console.log("\n[2] CLOUDFLARE QUEUES & DLQ:");
  try {
    const qInfo = execSync('npx wrangler queues info luxedge-d1-sync', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    console.log(qInfo.trim().split('\\n').filter(l => !l.includes('npm notice')).join('\\n'));
  } catch(e) {
    console.log(`⚠️  Could not fetch main queue info.`);
  }

  try {
    const dlqInfo = execSync('npx wrangler queues info luxedge-d1-sync-dlq', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    console.log(dlqInfo.trim().split('\\n').filter(l => !l.includes('npm notice')).join('\\n'));
  } catch(e) {
    console.log(`⚠️  Could not fetch DLQ info.`);
  }

  console.log("\n[3] DRIFT STATUS:");
  try {
    execSync('node scripts/d1-sync-check.mjs', { stdio: 'inherit' });
  } catch(e) {
    // The script already prints its output, the error code just indicates drift found
  }

  console.log("\n=========================================");
}

main().catch(console.error);
