import { NextRequest, NextResponse } from 'next/server';
import { fetchEthereumTransactions, isEthereumAddress } from '@/lib/etherscan';
import { seedMonitorTransactions, type WalletMonitor } from '@/lib/monitoring';
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

  if (existing) {
    try {
      await seedMonitorTransactions(admin, existing.id, address);
      const { data: monitor, error } = await admin
        .from('wallet_monitors')
        .update({
          is_active: true,
          last_checked_at: new Date().toISOString(),
          last_successful_check_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('id', existing.id)
        .eq('user_id', user.id)
        .select('id,user_id,address,network,is_active,last_checked_at,last_successful_check_at,last_error,created_at,updated_at')
        .single();
      if (error) throw error;
      return noStore({ monitor: monitor as WalletMonitor, created: false });
    } catch {
      return noStore({ error: 'Unable to retrieve a live Ethereum baseline for this wallet.' }, 502);
    }
  }

  try {
    // Obtain a real-chain baseline before enabling the monitor so historical
    // transactions never generate "new movement" alerts.
    const baseline = await fetchEthereumTransactions(address, 100);
    const { data: insertedMonitor, error: monitorInsertError } = await admin
      .from('wallet_monitors')
      .insert({ user_id: user.id, address, network: 'ethereum', is_active: false })
      .select('id,user_id,address,network,is_active,last_checked_at,last_successful_check_at,last_error,created_at,updated_at')
      .single();

    if (monitorInsertError) {
      const { data: concurrentMonitor } = await admin
        .from('wallet_monitors')
        .select('id,user_id,address,network,is_active,last_checked_at,last_successful_check_at,last_error,created_at,updated_at')
        .eq('user_id', user.id)
        .eq('address', address)
        .eq('network', 'ethereum')
        .maybeSingle();
      if (concurrentMonitor) return noStore({ monitor: concurrentMonitor as WalletMonitor, created: false });
      throw monitorInsertError;
    }

    if (baseline.length > 0) {
      const { error: baselineError } = await admin.from('monitor_transactions').upsert(
        baseline.map((transaction) => ({
          monitor_id: insertedMonitor.id,
          transaction_hash: transaction.hash.toLowerCase(),
          block_number: /^\d+$/.test(transaction.blockNumber) ? Number(transaction.blockNumber) : null,
          occurred_at: transaction.timestamp,
          from_address: transaction.from.toLowerCase(),
          to_address: transaction.to?.toLowerCase() || null,
          value_wei: /^\d+$/.test(transaction.value) ? transaction.value : '0',
          status: transaction.status,
        })),
        { onConflict: 'monitor_id,transaction_hash', ignoreDuplicates: true },
      );
      if (baselineError) throw baselineError;
    }

    const checkedAt = new Date().toISOString();
    const { data: monitor, error: activateError } = await admin
      .from('wallet_monitors')
      .update({ is_active: true, last_checked_at: checkedAt, last_successful_check_at: checkedAt, last_error: null })
      .eq('id', insertedMonitor.id)
      .select('id,user_id,address,network,is_active,last_checked_at,last_successful_check_at,last_error,created_at,updated_at')
      .single();
    if (activateError) throw activateError;

    return noStore({ monitor: monitor as WalletMonitor, created: true, baselineTransactionCount: baseline.length }, 201);
  } catch {
    return noStore({ error: 'Unable to start live wallet monitoring. Please try again shortly.' }, 502);
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
