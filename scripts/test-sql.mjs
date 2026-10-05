import { sql } from './supabase-export.mjs';

async function main() {
  const triggers = await sql("SELECT trigger_name, action_statement FROM information_schema.triggers WHERE trigger_schema = 'public'");
  console.log(triggers);
}

main().catch(console.error);
