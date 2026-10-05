import { PUBLIC_TABLE_COLUMNS } from '../worker/db-api';
import { readJsonBody } from './_lib/providers';

interface SyncPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  schema: string;
  record: Record<string, unknown> | null;
  old_record: Record<string, unknown> | null;
}

export default async function dbSyncHandler(
  req: any,
  env: any,
  makeRes: (body: any, status?: number) => Response
): Promise<Response> {
  const secret = env.SUPABASE_D1_SYNC_SECRET;
  if (!secret) {
    return makeRes({ error: 'Sync secret not configured' }, 500);
  }
  
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || req.headers?.get?.('authorization');
  if (authHeader !== `Bearer ${secret}`) {
    return makeRes({ error: 'Unauthorized' }, 401);
  }

  if (req.method !== 'POST') {
    return makeRes({ error: 'Method not allowed' }, 405);
  }

  if (!env.D1_SYNC_QUEUE) {
    return makeRes({ error: 'Queue not configured' }, 500);
  }

  let payload: SyncPayload;
  try {
    payload = await readJsonBody(req) as SyncPayload;
  } catch {
    return makeRes({ error: 'Invalid JSON body' }, 400);
  }

  if (payload.schema !== 'public') {
    return makeRes({ error: 'Only public schema is supported' }, 400);
  }

  const table = payload.table;
  const validColumns = PUBLIC_TABLE_COLUMNS[table];
  
  if (!validColumns) {
    return makeRes({ error: `Table not supported for public sync: ${table}` }, 400);
  }

  // Explicit table removals from sync
  if (table === 'store_offers') {
    return makeRes({ error: `Table not supported: ${table}` }, 400);
  }

  try {
    const message: any = {
      type: payload.type,
      table,
    };

    if (payload.type === 'DELETE') {
      const id = payload.old_record?.id || payload.old_record?.key;
      if (!id) return makeRes({ error: 'Missing ID/Key in old_record' }, 400);
      message.id = id;
    } else {
      const record = payload.record;
      if (!record || (!record.id && !record.key)) return makeRes({ error: 'Missing record or ID/Key' }, 400);

      // Special row-level filter for store_settings
      if (table === 'store_settings') {
        const allowedKeys = ['free_shipping_enabled', 'free_shipping_threshold'];
        if (!allowedKeys.includes(record.key as string)) {
          return makeRes({ success: true, action: 'ignored', reason: 'Internal setting key' });
        }
      }

      // Explicit field mapping
      const allowedCols = new Set(validColumns);
      const filteredRecord: Record<string, unknown> = {};
      
      for (const [k, v] of Object.entries(record)) {
        if (allowedCols.has(k)) {
          filteredRecord[k] = v;
        }
      }
      message.record = filteredRecord;
      message.id = record.id || record.key;
    }

    await env.D1_SYNC_QUEUE.send(message);
    return makeRes({ success: true, action: 'enqueued', table });
  } catch (err: any) {
    return makeRes({ error: 'Enqueue failed', details: err.message }, 500);
  }
}
