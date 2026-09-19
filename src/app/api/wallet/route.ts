import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { getRequestUser } from '@/lib/request-auth';
import { AlchemyServiceError, fetchAlchemyWallet, logEthereumFailure } from '@/lib/alchemy';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sign in to investigate Ethereum wallets.' }, { status: 401 });
  }

  const address = request.nextUrl.searchParams.get('address');

  if (!address) {
    return NextResponse.json({ error: 'Wallet address is required.' }, { status: 400 });
  }

  if (!isAddress(address)) {
    return NextResponse.json({ error: 'Invalid Ethereum wallet address.' }, { status: 400 });
  }

  const apiKey = process.env.ALCHEMY_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'The Ethereum data service is not configured.' },
      { status: 503 },
    );
  }

  try {
    return NextResponse.json(await fetchAlchemyWallet(address));
  } catch (error) {
    logEthereumFailure('wallet_lookup', error);
    const message =
      error instanceof AlchemyServiceError
        ? error.message
        : 'Unable to retrieve live Ethereum data at this time.';

    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
