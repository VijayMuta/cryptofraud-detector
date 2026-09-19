import { createPublicClient, formatEther, getAddress, http, isAddress } from 'viem';
import { mainnet } from 'viem/chains';
import type { WalletTransaction } from '@/lib/wallet-analysis';

const MAX_TRANSACTIONS = 50;
const ALCHEMY_RPC_BASE_URL = 'https://eth-mainnet.g.alchemy.com/v2';
const MAX_RATE_LIMIT_RETRIES = 6;

type JsonRpcResponse<T> = {
  result?: T;
  error?: unknown;
};

type AlchemyAssetTransfer = {
  blockNum?: unknown;
  hash?: unknown;
  from?: unknown;
  to?: unknown;
  rawContract?: unknown;
  metadata?: unknown;
};

type AlchemyTransfersResult = {
  transfers?: unknown;
  pageKey?: unknown;
};

type FailureKind = 'configuration' | 'network' | 'timeout' | 'http' | 'rpc' | 'invalid_response' | 'receipts' | 'address';

export class AlchemyServiceError extends Error {
  constructor(message: string, readonly kind: FailureKind = 'invalid_response', readonly method = 'alchemy_getAssetTransfers', readonly status?: number, readonly rpcCode?: number) {
    super(message);
    this.name = 'AlchemyServiceError';
  }
}

// Never log provider errors, response bodies, URLs, or viem exceptions: they can
// contain the credential embedded in the RPC URL. Only allowlisted fields leave here.
export function logEthereumFailure(operation: 'wallet_lookup' | 'case_analysis' | 'case_comparison', error: unknown) {
  console.error('Ethereum retrieval failed', {
    operation,
    provider: error instanceof AlchemyServiceError ? 'Alchemy' : 'unknown',
    kind: error instanceof AlchemyServiceError ? error.kind : 'internal',
    method: error instanceof AlchemyServiceError ? error.method : undefined,
    httpStatus: error instanceof AlchemyServiceError ? error.status : undefined,
    rpcCode: error instanceof AlchemyServiceError ? error.rpcCode : undefined,
  });
}

function configuredEndpoint() {
  const apiKey = process.env.ALCHEMY_API_KEY;
  if (!apiKey) throw new AlchemyServiceError('The Ethereum data service is not configured.', 'configuration');
  return alchemyUrl(apiKey);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function alchemyUrl(apiKey: string) {
  return `${ALCHEMY_RPC_BASE_URL}/${encodeURIComponent(apiKey)}`;
}

function hexToDecimal(value: unknown) {
  const hex = readString(value);
  if (!/^0x[0-9a-f]+$/i.test(hex)) return '';

  try {
    return BigInt(hex).toString();
  } catch {
    return '';
  }
}

function weiFromRawContract(rawContract: unknown) {
  if (!isRecord(rawContract)) return '0';
  return hexToDecimal(rawContract.value) || '0';
}

function timestampFromMetadata(metadata: unknown) {
  if (!isRecord(metadata)) return null;
  const timestamp = readString(metadata.blockTimestamp);
  return timestamp || null;
}

function normalizeTransfer(transfer: AlchemyAssetTransfer): WalletTransaction | null {
  const hash = readString(transfer.hash);
  const from = readString(transfer.from).trim().toLowerCase();
  if (!hash || !from) return null;

  const to = readString(transfer.to).trim().toLowerCase();
  return {
    hash: hash.toLowerCase(),
    timestamp: timestampFromMetadata(transfer.metadata),
    from,
    to: to || null,
    value: weiFromRawContract(transfer.rawContract),
    blockNumber: hexToDecimal(transfer.blockNum),
    status: 'unknown',
  };
}

async function alchemyRequest<T>(
  endpoint: string,
  method: string,
  params: unknown[],
  attempt = 0,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new AlchemyServiceError('Unable to reach the Ethereum data service. Please retry.', error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network', method);
  }

  if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
    await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
    return alchemyRequest<T>(endpoint, method, params, attempt + 1);
  }
  if (!response.ok) throw new AlchemyServiceError('The Ethereum data service is unavailable. Please retry.', 'http', method, response.status);
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new AlchemyServiceError('The Ethereum data service returned an invalid response.');
  }

  let payload: JsonRpcResponse<T>;
  try {
    payload = (await response.json()) as JsonRpcResponse<T>;
  } catch {
    throw new AlchemyServiceError('The Ethereum data service returned an invalid response.');
  }

  if (!isRecord(payload)) throw new AlchemyServiceError('The Ethereum data service returned an invalid response.', 'invalid_response', method);
  if (payload.error || payload.result === undefined) {
    const code = isRecord(payload.error) && typeof payload.error.code === 'number' ? payload.error.code : undefined;
    if (code === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
      return alchemyRequest<T>(endpoint, method, params, attempt + 1);
    }
    throw new AlchemyServiceError('The Ethereum data service could not retrieve this wallet. Please retry.', 'rpc', method, undefined, code);
  }

  return payload.result;
}

async function fetchTransfers(
  endpoint: string,
  address: `0x${string}`,
  direction: 'fromAddress' | 'toAddress',
  pageSize = MAX_TRANSACTIONS,
  pageKey?: string,
) {
  const result = await alchemyRequest<AlchemyTransfersResult>(endpoint, 'alchemy_getAssetTransfers', [
    {
      fromBlock: '0x0',
      toBlock: 'latest',
      [direction]: address,
      category: ['external'],
      withMetadata: true,
      excludeZeroValue: false,
      maxCount: `0x${pageSize.toString(16)}`,
      order: 'desc',
      ...(pageKey ? { pageKey } : {}),
    },
  ]);

  if (!isRecord(result) || !Array.isArray(result.transfers)) {
    throw new AlchemyServiceError('The Ethereum data service returned an invalid transaction history.');
  }

  const transactions = result.transfers
    .filter((transfer): transfer is AlchemyAssetTransfer => isRecord(transfer))
    .map(normalizeTransfer)
    .filter((transfer): transfer is WalletTransaction => transfer !== null);
  return { transactions, pageKey: typeof result.pageKey === 'string' && result.pageKey ? result.pageKey : undefined };
}

async function fetchTransactionStatuses(endpoint: string, hashes: string[], strict = false, attempt = 0, allowPartial = false): Promise<Map<string, WalletTransaction['status']>> {
  const statuses = new Map<string, WalletTransaction['status']>();
  if (hashes.length === 0) return statuses;
  const failed = (kind: FailureKind, status?: number, rpcCode?: number) => {
    const error = new AlchemyServiceError('Ethereum transaction receipts could not be verified. Please retry the analysis.', kind, 'eth_getTransactionReceipt', status, rpcCode);
    if (strict && !allowPartial) throw error;
    logEthereumFailure(allowPartial ? 'case_analysis' : 'wallet_lookup', error);
    return statuses;
  };

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        hashes.map((hash, index) => ({
          jsonrpc: '2.0',
          id: index,
          method: 'eth_getTransactionReceipt',
          params: [hash],
        })),
      ),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return failed('network');
  }

  if (response.status === 429 && attempt < (allowPartial ? 3 : MAX_RATE_LIMIT_RETRIES)) {
    await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
    return fetchTransactionStatuses(endpoint, hashes, strict, attempt + 1, allowPartial);
  }
  if (!response.ok) return failed('http', response.status);
  if (!response.headers.get('content-type')?.includes('application/json')) return failed('invalid_response');

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return failed('invalid_response');
  }

  if (!Array.isArray(payload)) return failed('invalid_response');

  let rateLimited = false;
  let partialRpcFailure = false;
  let partialRpcCode: number | undefined;
  for (const receiptResponse of payload) {
    if (!isRecord(receiptResponse) || typeof receiptResponse.id !== 'number') continue;
    if (receiptResponse.error) {
      const code = isRecord(receiptResponse.error) && typeof receiptResponse.error.code === 'number' ? receiptResponse.error.code : undefined;
      if (code === 429 && attempt < (allowPartial ? 3 : MAX_RATE_LIMIT_RETRIES)) { rateLimited = true; continue; }
      if (allowPartial) { partialRpcFailure = true; partialRpcCode = code; continue; }
      return failed('rpc', undefined, code);
    }
    const hash = hashes[receiptResponse.id];
    const receipt = isRecord(receiptResponse.result) ? receiptResponse.result : null;
    if (!hash || !receipt) continue;

    const status = readString(receipt.status).toLowerCase();
    if (status === '0x1') statuses.set(hash, 'success');
    if (status === '0x0') statuses.set(hash, 'failed');
  }

  if (partialRpcFailure) failed('rpc', undefined, partialRpcCode);
  if (rateLimited) {
    await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
    const retried = await fetchTransactionStatuses(endpoint, hashes.filter(hash => !statuses.has(hash)), strict, attempt + 1, allowPartial);
    for (const [hash, status] of retried) statuses.set(hash, status);
  }
  if (strict && statuses.size !== hashes.length) return failed('receipts');
  return statuses;
}

function sortNewestFirst(left: WalletTransaction, right: WalletTransaction) {
  const leftTime = left.timestamp ? Date.parse(left.timestamp) : 0;
  const rightTime = right.timestamp ? Date.parse(right.timestamp) : 0;
  return rightTime - leftTime;
}

export async function fetchAlchemyTransactionHistory(address: string, options: { pageSize?: number; maxPages?: number; requireReceipts?: boolean; allowPartialReceipts?: boolean; verifyReceipts?: boolean } = {}) {
  const endpoint = configuredEndpoint();
  const normalizedAddress = address.trim().toLowerCase();
  if (!isAddress(normalizedAddress)) throw new AlchemyServiceError('Invalid Ethereum wallet address.', 'address');
  const pageSize = Math.min(1000, Math.max(1, Math.floor(options.pageSize || MAX_TRANSACTIONS)));
  const maxPages = Math.min(5, Math.max(1, Math.floor(options.maxPages || 1)));
  async function directionHistory(direction: 'fromAddress' | 'toAddress') {
    const transactions: WalletTransaction[] = [];
    let pageKey: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const result = await fetchTransfers(endpoint, normalizedAddress as `0x${string}`, direction, pageSize, pageKey);
      transactions.push(...result.transactions);
      if (!result.pageKey) break;
      pageKey = result.pageKey;
    }
    return transactions;
  }
  const [outgoing, incoming] = await Promise.all([directionHistory('fromAddress'), directionHistory('toAddress')]);
  const transactions = Array.from(new Map([...outgoing, ...incoming].map(transaction => [transaction.hash, transaction])).values())
    .sort(sortNewestFirst).slice(0, pageSize * maxPages);
  // Bulk case analysis supplies execution statuses from indexed normal-transaction
  // data instead. Never fan out receipt RPCs when this option is disabled.
  if (options.verifyReceipts === false) return transactions;
  // Small receipt batches avoid provider batch limits. Case analysis explicitly
  // reports unknown receipts as incomplete coverage, never successful evidence.
  const batchSize = 50;
  const receiptDeadline = Date.now() + 20_000;
  for (let offset = 0; offset < transactions.length; offset += batchSize) {
    if (options.allowPartialReceipts && Date.now() >= receiptDeadline) break;
    const chunk = transactions.slice(offset, offset + batchSize);
    const statuses = await fetchTransactionStatuses(endpoint, chunk.map(transaction => transaction.hash), options.requireReceipts, 0, options.allowPartialReceipts);
    for (const transaction of chunk) transaction.status = statuses.get(transaction.hash) || transaction.status;
    if (options.allowPartialReceipts && statuses.size < chunk.length) break;
  }
  return transactions;
}

export async function fetchAlchemyWallet(address: string) {
  const normalizedAddress = getAddress(address);
  const client = createPublicClient({ chain: mainnet, transport: http(configuredEndpoint()) });
  const [balance, transactionCount, transactions] = await Promise.all([
    client.getBalance({ address: normalizedAddress }),
    client.getTransactionCount({ address: normalizedAddress }),
    fetchAlchemyTransactionHistory(normalizedAddress),
  ]);
  return {
    success: true,
    network: 'Ethereum Mainnet',
    address: normalizedAddress,
    balanceWei: balance.toString(),
    balanceEth: formatEther(balance),
    transactionCount,
    transactions,
    dataSource: 'Alchemy',
    verifiedAt: new Date().toISOString(),
  };
}
