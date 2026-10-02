import { NextRequest, NextResponse } from 'next/server';
import { isEthereumAddress } from '@/lib/etherscan';
import { MonitorEnrollmentError, seedMonitorTransactions, type WalletMonitor } from '@/lib/monitoring';
import { getRequestUser } from '@/lib/request-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function requestBody(request: NextRequest) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function authenticatedAdmin(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return { user: null, admin: null };

  try {
    return { user, admin: getSupabaseAdmin() };
  } catch {
    return { user, admin: null };
  }
}

export async function GET(request: NextRequest) {
  const { user, admin } = await authenticatedAdmin(request);
  if (!user) return noStore({ error: 'Sign in to view wallet monitoring.' }, 401);
  if (!admin) return noStore({ error: 'Wallet monitoring is not configured on this server.' }, 503);

  const address = request.nextUrl.searchParams.get('address')?.trim().toLowerCase();
  let query = admin
    .from('wallet_monitors')
    .select('id,user_id,address,network,is_active,last_checked_at,last_successful_check_at,last_error,created_at,updated_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (address) query = query.eq('address', address);
  const { data, error } = await query;
  if (error) return noStore({ error: 'Unable to load wallet monitoring status.' }, 500);

  return noStore({ monitors: (data || []) as WalletMonitor[] });
}

export async function POST(request: NextRequest) {
  const { user, admin } = await authenticatedAdmin(request);
  if (!user) return noStore({ error: 'Sign in to monitor a wallet.' }, 401);
  if (!admin) return noStore({ error: 'Wallet monitoring is not configured on this server.' }, 503);

  const body = await requestBody(request);
  const providedAddress = typeof body?.address === 'string' ? body.address.trim() : '';
  if (!isEthereumAddress(providedAddress)) {
    return noStore({ error: 'Enter a valid Ethereum wallet address.' }, 400);
  }

  const address = providedAddress.toLowerCase();
  const { data: existing, error: existingError } = await admin
    .from('wallet_monitors')
    .select('id,user_id,address,network,is_active,last_checked_at,last_successful_check_at,last_error,created_at,updated_at')
    .eq('user_id', user.id)
    .eq('address', address)
    .eq('network', 'ethereum')
    .maybeSingle();

  if (existingError) return noStore({ error: 'Unable to prepare wallet monitoring.' }, 500);
  if (existing?.is_active) return noStore({ monitor: existing as WalletMonitor, created: false });

  try {
    const result = await seedMonitorTransactions(
      admin, existing?.id ?? null, address, user.id, existing?.updated_at ?? null,
    );
    return noStore({ ...result, created: !existing }, existing ? 200 : 201);
  } catch (error) {
    if (error instanceof MonitorEnrollmentError) return noStore({ error: error.message }, error.status);
    return noStore({ error: 'Unable to retrieve a live Ethereum baseline for this wallet. Please retry.' }, 502);
  }
}

export async function PATCH(request: NextRequest) {
  const { user, admin } = await authenticatedAdmin(request);
  if (!user) return noStore({ error: 'Sign in to change wallet monitoring.' }, 401);
  if (!admin) return noStore({ error: 'Wallet monitoring is not configured on this server.' }, 503);

  const body = await requestBody(request);
  const monitorId = typeof body?.monitorId === 'string' ? body.monitorId : '';
  const isActive = typeof body?.isActive === 'boolean' ? body.isActive : null;
  if (!monitorId || isActive === null) return noStore({ error: 'A monitor and status are required.' }, 400);

  const { data, error } = await admin
    .from('wallet_monitors')
    .update({ is_active: isActive })
    .eq('id', monitorId)
    .eq('user_id', user.id)
    .select('id,user_id,address,network,is_active,last_checked_at,last_successful_check_at,last_error,created_at,updated_at')
    .maybeSingle();
  if (error) return noStore({ error: 'Unable to update wallet monitoring.' }, 500);
  if (!data) return noStore({ error: 'Wallet monitor not found.' }, 404);

  return noStore({ monitor: data as WalletMonitor });
}
