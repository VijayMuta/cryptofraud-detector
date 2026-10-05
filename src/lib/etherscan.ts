import type { WalletTransaction } from '@/lib/wallet-analysis';
import { isEthereumAddress } from '@/lib/ethereum-address';

const ETHERSCAN_API_URL = 'https://api.etherscan.io/v2/api';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ETHERSCAN_PAGE_SIZE = 1_000;

type EtherscanTransaction = {
  hash?: unknown;
  timeStamp?: unknown;
  from?: unknown;
  to?: unknown;
  value?: unknown;
  blockNumber?: unknown;
  txreceipt_status?: unknown;
  isError?: unknown;
};

type EtherscanResponse = {
  status?: unknown;
  message?: unknown;
  result?: unknown;
};

export class EthereumServiceError extends Error {}

export { isEthereumAddress };

export type EthereumTransactionHistoryOptions = {
  pageSize?: number;
  maxPages?: number;
  sort?: 'asc' | 'desc';
  requestIntervalMs?: number;
  onPage?: (transactions: WalletTransaction[]) => void;
  shouldContinue?: () => boolean;
};

function readString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function toIsoTimestamp(value: unknown) {
  const seconds = Number(readString(value));
  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  const date = new Date(seconds * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function transactionStatus(transaction: EtherscanTransaction): WalletTransaction['status'] {
  if (transaction.isError === '1' || transaction.txreceipt_status === '0') return 'failed';
  if (transaction.isError === '0' || transaction.txreceipt_status === '1') return 'success';
  return 'unknown';
}

function boundedInteger(value: number | undefined, fallback: number, maximum: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value as number), 1), maximum);
}

async function fetchEthereumTransactionsPage(
  address: string,
  page: number,
  limit: number,
  sort: 'asc' | 'desc',
  range?: { startBlock: number; endBlock: number; timeoutMs?: number },
): Promise<WalletTransaction[]> {
  if (!isEthereumAddress(address)) throw new EthereumServiceError('Invalid Ethereum address.');

  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) throw new EthereumServiceError('Ethereum service is not configured.');

  const url = new URL(ETHERSCAN_API_URL);
  url.searchParams.set('chainid', '1');
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', 'txlist');
  url.searchParams.set('address', address);
  url.searchParams.set('page', String(page));
  url.searchParams.set('offset', String(limit));
  url.searchParams.set('sort', sort);
  url.searchParams.set('apikey', apiKey);
  if (range) {
    url.searchParams.set('startblock', String(range.startBlock));
    url.searchParams.set('endblock', String(range.endBlock));
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), Math.min(REQUEST_TIMEOUT_MS, range?.timeoutMs ?? REQUEST_TIMEOUT_MS));

  let payload: EtherscanResponse;
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: abortController.signal,
    });

    if (!response.ok) throw new EthereumServiceError('Ethereum service request failed.');
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new EthereumServiceError('Ethereum service returned an invalid response.');
    }
    payload = (await response.json()) as EtherscanResponse;
  } catch (error) {
    if (error instanceof EthereumServiceError) throw error;
    throw new EthereumServiceError('Ethereum service request failed.');
  } finally {
    clearTimeout(timeout);
  }

  const noTransactions =
    payload?.message === 'No transactions found' && Array.isArray(payload.result) && payload.result.length === 0;

  if (payload?.status !== '1' && !noTransactions) {
    throw new EthereumServiceError('Ethereum service did not return transactions.');
  }

  const sourceTransactions = Array.isArray(payload.result) ? payload.result : [];
  // Enrollment uses the normal-history path too. Unknown value must never
  // become a persisted zero or disappear from an otherwise successful page.
  if (sourceTransactions.some(row => row && typeof row === 'object' && !/^\d+$/.test(readString(row.value)))) {
    throw new EthereumServiceError('Ethereum transaction amount is unavailable or invalid. Retry the request.');
  }
  // Monitoring must never interpret a malformed/truncated response as range exhaustion.
  if (range && (!Array.isArray(payload.result) || sourceTransactions.length > limit || sourceTransactions.some(row =>
    !row || typeof row !== 'object' || !/^0x[0-9a-f]{64}$/i.test(readString(row.hash)) ||
    !/^\d+$/.test(readString(row.blockNumber)) || !Number.isSafeInteger(Number(row.blockNumber)) ||
    Number(row.blockNumber) < range.startBlock || Number(row.blockNumber) > range.endBlock ||
    !/^0x[0-9a-f]{40}$/i.test(readString(row.from)) ||
    (readString(row.to) !== '' && !/^0x[0-9a-f]{40}$/i.test(readString(row.to))) ||
    !/^\d+$/.test(readString(row.value)) || !toIsoTimestamp(row.timeStamp)))) {
    throw new EthereumServiceError('Ethereum monitoring history is incomplete or invalid. Retry the check.');
  }
  return sourceTransactions
    .filter(
      (transaction): transaction is EtherscanTransaction =>
        typeof transaction === 'object' && transaction !== null,
    )
    .map((transaction) => ({
      hash: readString(transaction.hash),
      timestamp: toIsoTimestamp(transaction.timeStamp),
      from: readString(transaction.from),
      to: readString(transaction.to) || null,
      value: readString(transaction.value),
      blockNumber: readString(transaction.blockNumber),
      status: transactionStatus(transaction),
    }))
    .filter((transaction) => transaction.hash);
}

/** Returns the most recent normal transactions for investigation and monitoring views. */
export async function fetchEthereumTransactions(address: string, limit = 50): Promise<WalletTransaction[]> {
  return fetchEthereumTransactionsPage(address, 1, boundedInteger(limit, 50, MAX_ETHERSCAN_PAGE_SIZE), 'desc');
}

/** Fixed block ranges prevent newly mined blocks from shifting pages during catch-up. */
export async function fetchMonitoringHeadBlock(address: string, timeoutMs = REQUEST_TIMEOUT_MS) {
  const rows = await fetchEthereumTransactionsPage(address, 1, 1, 'desc', { startBlock: 0, endBlock: 999999999, timeoutMs });
  return rows.length ? Number(rows[0].blockNumber) : 0;
}

export async function fetchMonitoringPage(address: string, startBlock: number, endBlock: number, page: number, timeoutMs = REQUEST_TIMEOUT_MS) {
  if (![startBlock, endBlock, page].every(Number.isSafeInteger) || startBlock < 0 || endBlock < startBlock || page < 1) {
    throw new EthereumServiceError('Invalid monitoring history range.');
  }
  const rows = await fetchEthereumTransactionsPage(address, page, 100, 'asc', { startBlock, endBlock, timeoutMs });
  if (new Set(rows.map(row => row.hash.toLowerCase())).size !== rows.length ||
      rows.some((row, index) => index > 0 && Number(row.blockNumber) < Number(rows[index - 1].blockNumber))) {
    throw new EthereumServiceError('Ethereum monitoring history is unordered or duplicated. Retry the check.');
  }
  return rows;
}

/**
 * Retrieves consecutive pages of normal transactions for case evidence.
 * Phase 5 uses descending pages so its evidence window stays contiguous from
 * the newest transaction backwards instead of combining unrelated oldest and
 * newest result sets.
 */
export async function fetchEthereumTransactionHistory(
  address: string,
  options: EthereumTransactionHistoryOptions = {},
): Promise<WalletTransaction[]> {
  const pageSize = boundedInteger(options.pageSize, MAX_ETHERSCAN_PAGE_SIZE, MAX_ETHERSCAN_PAGE_SIZE);
  const maxPages = boundedInteger(options.maxPages, 1, 100);
  const sort = options.sort === 'asc' ? 'asc' : 'desc';
  const transactions: WalletTransaction[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    if (page > 1 && options.requestIntervalMs) {
      await new Promise(resolve => setTimeout(resolve, Math.min(1000, Math.max(0, options.requestIntervalMs || 0))));
    }
    const pageTransactions = await fetchEthereumTransactionsPage(address, page, pageSize, sort);
    transactions.push(...pageTransactions);
    options.onPage?.(pageTransactions);
    if (options.shouldContinue && !options.shouldContinue()) break;
    if (pageTransactions.length < pageSize) break;
  }

  return transactions;
}
