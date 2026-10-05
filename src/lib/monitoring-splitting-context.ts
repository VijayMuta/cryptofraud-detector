import type { SupabaseClient } from '@supabase/supabase-js';
import { SPLITTING_WINDOW_MS, type AnalyzedTransaction } from '@/lib/wallet-analysis';

const PAGE_SIZE = 100;
const INCOMPLETE = 'Monitoring splitting context is incomplete. No checkpoint was advanced for this page; retry the check.';

/** Complete persisted context for new triggers, independent of the cursor's sample.
 * Monitor writes are append-only. Concurrent enrollment/checks change the cursor
 * revision, so the existing persistence RPC rejects a stale read before commit.
 */
export async function fetchMonitoringSplittingContext(
  admin: SupabaseClient, monitorId: string, address: string,
  triggers: AnalyzedTransaction[], deadline: number,
): Promise<AnalyzedTransaction[]> {
  const eligible = triggers.filter(tx => tx.to && tx.valueWei > 0n && tx.timestampMs !== null);
  if (!eligible.length) return [];
  const start = Math.min(...eligible.map(tx => tx.timestampMs!)) - SPLITTING_WINDOW_MS;
  const end = Math.max(...eligible.map(tx => tx.timestampMs!));
  const rows: AnalyzedTransaction[] = [];
  let after: string | null = null;
  let expectedRemaining: number | null = null;
  for (;;) {
    if (Date.now() >= deadline) throw new Error(INCOMPLETE);
    let query = admin.from('monitor_transactions')
      // Never deserialize numeric(78,0) through a JavaScript number.
      .select('monitor_id,transaction_hash,block_number::text,occurred_at,from_address,to_address,value_wei::text,status', { count: 'exact' })
      .eq('monitor_id', monitorId).eq('from_address', address).eq('status', 'success')
      .neq('to_address', address).gt('value_wei', '0')
      .gte('occurred_at', new Date(start).toISOString()).lte('occurred_at', new Date(end).toISOString())
      .order('transaction_hash', { ascending: true }).limit(PAGE_SIZE);
    if (after !== null) query = query.gt('transaction_hash', after);
    const { data, error, count } = await query.abortSignal(AbortSignal.timeout(Math.max(1, deadline - Date.now())));
    if (Date.now() >= deadline || error || !Array.isArray(data) ||
        !Number.isSafeInteger(count) || count === null || count < 0 ||
        data.length > PAGE_SIZE || data.length > count ||
        (expectedRemaining !== null && count !== expectedRemaining) ||
        (!data.length && count !== 0)) throw new Error(INCOMPLETE);
    for (const row of data) {
      const hash = row.transaction_hash;
      const time = typeof row.occurred_at === 'string' ? Date.parse(row.occurred_at) : NaN;
      if (row.monitor_id !== monitorId || row.from_address !== address || row.status !== 'success' ||
          typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/.test(hash) || (after !== null && hash <= after) ||
          typeof row.to_address !== 'string' || !/^0x[0-9a-f]{40}$/.test(row.to_address) || row.to_address === address ||
          typeof row.value_wei !== 'string' || !/^\d+$/.test(row.value_wei) || BigInt(row.value_wei) <= 0n ||
          typeof row.block_number !== 'string' || !/^\d+$/.test(row.block_number) ||
          !Number.isFinite(time) || time < start || time > end) throw new Error(INCOMPLETE);
      rows.push({ hash, blockNumber: row.block_number, timestamp: row.occurred_at,
        from: row.from_address, to: row.to_address, value: row.value_wei,
        status: 'success', direction: 'outgoing', valueWei: BigInt(row.value_wei), timestampMs: time });
      after = hash;
    }
    expectedRemaining = count - data.length;
    if (expectedRemaining === 0) return rows;
    // A server cap may make any page short. Advance by its actual final hash,
    // never by the requested page size or by assuming a short page is complete.
  }
}
