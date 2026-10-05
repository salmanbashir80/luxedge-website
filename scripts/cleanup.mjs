import { execSql } from './supabase-admin.mjs';
async function run() {
  await execSql("DELETE FROM categories WHERE id IN ('613da132-8e8a-479c-96bc-56c9969eb252', '43c9953e-787f-428b-abe6-c0bae6e4bc10')");
}
run().catch(console.error);
