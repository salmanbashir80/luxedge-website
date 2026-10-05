import { execSql } from './scripts/supabase-admin.mjs';
execSql("UPDATE products SET updated_at = NOW() WHERE id = '92697308-1552-4086-9e57-8a92497c037c'").then(() => console.log('ok'));
