import { execSql } from './scripts/supabase-admin.mjs';
execSql("SELECT column_name FROM information_schema.columns WHERE table_name = 'products'").then(r => console.log(r.map(x=>x.column_name)));
