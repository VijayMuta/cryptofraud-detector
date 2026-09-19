import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, formatEther, http } from 'viem';
import { mainnet } from 'viem/chains';
import { getRequestUser } from '@/lib/request-auth';

const ALCHEMY_RPC_BASE_URL = 'https://eth-mainnet.g.alchemy.com/v2';
const HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

export const dynamic = 'force-dynamic';

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function alchemyUrl(apiKey: string) {
  return `${ALCHEMY_RPC_BASE_URL}/${encodeURIComponent(apiKey)}`;
}

function isoTimestamp(timestamp: bigint | undefined) {
  if (timestamp === undefined) return null;
  const milliseconds = Number(timestamp) * 1_000;
  if (!Number.isSafeInteger(milliseconds)) return null;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return response({ error: 'Sign in to inspect transaction evidence.' }, 401);

  const requestedHash = request.nextUrl.searchParams.get('hash')?.trim() || '';
  if (!HASH_PATTERN.test(requestedHash)) {
    return response({ error: 'Enter a valid 0x-prefixed 64-character Ethereum transaction hash.' }, 400);
  }

  const apiKey = process.env.ALCHEMY_API_KEY;
  if (!apiKey) return response({ error: 'The Ethereum data service is not configured.' }, 503);

  const client = createPublicClient({
    chain: mainnet,
    transport: http(alchemyUrl(apiKey)),
  });
  const hash = requestedHash as `0x${string}`;

  try {
    const transaction = await client.getTransaction({ hash });
    const [receipt, block] = await Promise.all([
      client.getTransactionReceipt({ hash }).catch(() => null),
      transaction.blockNumber === null
        ? Promise.resolve(null)
        : client.getBlock({ blockNumber: transaction.blockNumber }).catch(() => null),
    ]);

    return response({
      transaction: {
        hash: transaction.hash,
        from: transaction.from,
        to: transaction.to,
        valueWei: transaction.value.toString(),
        valueEth: formatEther(transaction.value),
        blockNumber: transaction.blockNumber?.toString() || null,
        timestamp: isoTimestamp(block?.timestamp),
        status: receipt?.status === 'success' ? 'success' : receipt?.status === 'reverted' ? 'failed' : 'unknown',
      },
      dataSource: 'Alchemy',
      network: 'Ethereum Mainnet',
      verifiedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Transaction lookup error:', error);
    return response({ error: 'The Ethereum data service could not retrieve this transaction.' }, 502);
  }
}
