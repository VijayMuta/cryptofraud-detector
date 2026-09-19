import { NextRequest, NextResponse } from 'next/server';
import { runWalletMonitor, type WalletMonitor } from '@/lib/monitoring';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: 'Wallet monitoring is not configured on this server.' }, { status: 503 });
  }

  // Sequential checks respect Etherscan's rate limits. The next cron run picks
  // up any remaining active monitors, oldest checks first.
  const { data: monitors, error } = await admin
    .from('wallet_monitors')
    .select('id,user_id,address,network,is_active,last_checked_at,last_successful_check_at,last_error,created_at,updated_at')
    .eq('is_active', true)
    .order('last_checked_at', { ascending: true, nullsFirst: true })
    .limit(25);
  if (error) return NextResponse.json({ error: 'Unable to load active wallet monitors.' }, { status: 500 });

  const results = [];
  for (const monitor of (monitors || []) as WalletMonitor[]) {
    results.push(await runWalletMonitor(admin, monitor));
  }

  return NextResponse.json(
    {
      checked: results.length,
      newTransactions: results.reduce((total, result) => total + result.newTransactionCount, 0),
      newAlerts: results.reduce((total, result) => total + result.newAlertCount, 0),
      failures: results.filter((result) => result.error).length,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
