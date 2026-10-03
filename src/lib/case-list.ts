import type { SupabaseClient } from '@supabase/supabase-js';
import { caseFields, caseWalletFields, type InvestigationCase, type CaseWallet } from '@/lib/cases';

export const CASE_LIST_PAGE_SIZE = 200;
export const CASE_WALLET_BATCH_SIZE = 50;

const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

async function allPages<T extends { id: string }>(
  fetchPage: (after: string | null) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  let after: string | null = null;
  for (;;) {
    const { data, error } = await fetchPage(after);
    if (error || !Array.isArray(data)) throw new Error('Case retrieval incomplete.');
    // A short page may reflect a lower server-side row cap. Only an empty
    // page establishes exhaustion of the remaining ID range.
    if (!data.length) return rows;
    for (const row of data) {
      if (typeof row.id !== 'string' || (after !== null && row.id <= after)) {
        throw new Error('Case retrieval did not advance.');
      }
      rows.push(row);
      after = row.id;
    }
  }
}

/** Retrieve complete membership before publishing any successful case list. */
export async function getOwnedCaseList(admin: SupabaseClient, userId: string) {
  // Immutable UUID cursors avoid offset shifts and mutable updated_at cursors.
  const cases = await allPages<InvestigationCase>(after => {
    let query = admin.from('investigation_cases').select(caseFields)
      .eq('created_by', userId).order('id', { ascending: true }).limit(CASE_LIST_PAGE_SIZE);
    if (after !== null) query = query.gt('id', after);
    return query;
  });
  const walletsByCase = new Map<string, CaseWallet[]>(cases.map(row => [row.id, []]));
  for (let offset = 0; offset < cases.length; offset += CASE_WALLET_BATCH_SIZE) {
    const ids = cases.slice(offset, offset + CASE_WALLET_BATCH_SIZE).map(row => row.id);
    const wallets = await allPages<CaseWallet>(after => {
      let query = admin.from('case_wallets').select(caseWalletFields)
        .in('case_id', ids).order('id', { ascending: true }).limit(CASE_LIST_PAGE_SIZE);
      if (after !== null) query = query.gt('id', after);
      return query;
    });
    for (const wallet of wallets) {
      if (!ids.includes(wallet.case_id)) throw new Error('Unexpected case wallet membership.');
      walletsByCase.get(wallet.case_id)!.push(wallet);
    }
  }
  // PostgreSQL returns these timestamptz fields in a consistent UTC format.
  // Preserve newest-case / oldest-wallet display order, with unique tie-breakers.
  cases.sort((a, b) => compareText(b.updated_at, a.updated_at) || compareText(a.id, b.id));
  return cases.map(row => ({
    ...row,
    wallets: walletsByCase.get(row.id)!.sort((a, b) => compareText(a.added_at, b.added_at) || compareText(a.id, b.id)),
  }));
}
