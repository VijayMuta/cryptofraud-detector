import { fetchAlchemyTransactionHistory } from '@/lib/alchemy';
import { fetchEthereumTransactionHistory } from '@/lib/etherscan';
import type { WalletTransaction } from '@/lib/wallet-analysis';

export const CASE_HISTORY_SOURCE = 'Live Alchemy Ethereum transfers with Etherscan execution statuses' as const;

function normalized(value: string) { return value.trim().toLowerCase(); }

// A hash match is necessary but validate the transfer facts as well. Conflicting
// provider records must never create successful evidence or hide a failed transfer.
function sameTransaction(left: WalletTransaction, right: WalletTransaction) {
  return normalized(left.from) === normalized(right.from)
    && normalized(left.to || '') === normalized(right.to || '')
    && /^\d+$/.test(left.value) && /^\d+$/.test(right.value)
    && BigInt(left.value) === BigInt(right.value)
    && left.blockNumber === right.blockNumber;
}

export async function fetchCaseTransactionHistory(address: string, options: { pageSize: number; maxPages: number }) {
  const wallet = normalized(address);
  const transactions = await fetchAlchemyTransactionHistory(wallet, { ...options, verifyReceipts: false });
  if (transactions.length === 0) return transactions;

  const indexed = new Map<string, WalletTransaction>();
  const conflicting = new Set<string>();
  const remaining = new Set(transactions.map(transaction => normalized(transaction.hash)));
  try {
    await fetchEthereumTransactionHistory(wallet, {
      ...options,
      // The normal-transaction index may include calls absent from the transfers
      // index. Allow one extra status page, stopping as soon as all hashes appear.
      maxPages: options.maxPages + 1,
      sort: 'desc',
      requestIntervalMs: 500,
      onPage: page => {
        for (const transaction of page) {
          const hash = normalized(transaction.hash);
          const previous = indexed.get(hash);
          if (previous && (previous.status !== transaction.status || !sameTransaction(previous, transaction))) conflicting.add(hash);
          indexed.set(hash, transaction);
          remaining.delete(hash);
        }
      },
      shouldContinue: () => remaining.size > 0,
    });
  } catch {
    // Keep verified pages if a later page fails. Do not print errors or URLs:
    // the existing Etherscan request URL contains a server-only credential.
    console.error('Case execution-status lookup incomplete', {
      provider: 'Etherscan', method: 'account.txlist', kind: 'indexed_status_unavailable',
      indexedTransactions: indexed.size,
    });
  }

  return transactions.map(transaction => {
    const hash = normalized(transaction.hash);
    const statusRecord = indexed.get(hash);
    return {
      ...transaction,
      from: normalized(transaction.from),
      to: transaction.to ? normalized(transaction.to) : null,
      status: statusRecord && !conflicting.has(hash) && sameTransaction(transaction, statusRecord)
        ? statusRecord.status : 'unknown' as const,
    };
  });
}
