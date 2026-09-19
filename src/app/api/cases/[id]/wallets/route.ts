import { NextRequest, NextResponse } from 'next/server';
import { caseWalletFields, getCaseWallets, getOwnedCase } from '@/lib/cases';
import { MAX_WALLETS_PER_CASE } from '@/lib/case-constants';
import { isEthereumAddress } from '@/lib/etherscan';
import { getRequestUser } from '@/lib/request-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getRequestUser(request);
  if (!user) return response({ error: 'Sign in to add a suspect wallet.' }, 401);
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return response({ error: 'Case management is not configured on this server.' }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return response({ error: 'Enter a wallet address.' }, 400);
  }
  const providedAddress = typeof body.address === 'string' ? body.address.trim() : '';
  if (!isEthereumAddress(providedAddress)) return response({ error: 'Enter a valid Ethereum wallet address.' }, 400);

  try {
    const caseRecord = await getOwnedCase(admin, user.id, params.id);
    if (!caseRecord) return response({ error: 'Case not found.' }, 404);
    const existingWallets = await getCaseWallets(admin, caseRecord.id);
    if (existingWallets.length >= MAX_WALLETS_PER_CASE) {
      return response({ error: `A live cross-wallet analysis supports up to ${MAX_WALLETS_PER_CASE} suspect wallets per case.` }, 400);
    }
    const { data, error } = await admin
      .from('case_wallets')
      .insert({ case_id: caseRecord.id, address: providedAddress.toLowerCase(), network: 'ethereum', added_by: user.id })
      .select(caseWalletFields)
      .single();
    if (error) {
      if (error.code === '23505') return response({ error: 'This wallet is already associated with the case.' }, 409);
      return response({ error: 'Unable to add the suspect wallet.' }, 500);
    }
    return response({ wallet: data }, 201);
  } catch {
    return response({ error: 'Unable to add the suspect wallet.' }, 500);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getRequestUser(request);
  if (!user) return response({ error: 'Sign in to remove a suspect wallet.' }, 401);
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return response({ error: 'Case management is not configured on this server.' }, 503);
  }
  const walletId = request.nextUrl.searchParams.get('walletId') || '';
  if (!walletId) return response({ error: 'A case wallet is required.' }, 400);

  try {
    const caseRecord = await getOwnedCase(admin, user.id, params.id);
    if (!caseRecord) return response({ error: 'Case not found.' }, 404);
    const { error } = await admin
      .from('case_wallets')
      .delete()
      .eq('id', walletId)
      .eq('case_id', caseRecord.id);
    if (error) return response({ error: 'Unable to remove the suspect wallet.' }, 500);
    const wallets = await getCaseWallets(admin, caseRecord.id);
    return response({ wallets });
  } catch {
    return response({ error: 'Unable to remove the suspect wallet.' }, 500);
  }
}
