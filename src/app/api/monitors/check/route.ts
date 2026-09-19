import { NextRequest, NextResponse } from 'next/server';
import { runWalletMonitor, type WalletMonitor } from '@/lib/monitoring';
import { getRequestUser } from '@/lib/request-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return noStore({ error: 'Sign in to check a monitored wallet.' }, 401);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return noStore({ error: 'A wallet monitor is required.' }, 400);
  }
  const monitorId = typeof body.monitorId === 'string' ? body.monitorId : '';
  if (!monitorId) return noStore({ error: 'A wallet monitor is required.' }, 400);

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return noStore({ error: 'Wallet monitoring is not configured on this server.' }, 503);
  }

  const { data: monitor, error } = await admin
    .from('wallet_monitors')
    .select('id,user_id,address,network,is_active,last_checked_at,last_successful_check_at,last_error,created_at,updated_at')
    .eq('id', monitorId)
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle();
  if (error) return noStore({ error: 'Unable to load wallet monitor.' }, 500);
  if (!monitor) return noStore({ error: 'An active wallet monitor was not found.' }, 404);

  const result = await runWalletMonitor(admin, monitor as WalletMonitor);
  return noStore({ result }, result.error ? 502 : 200);
}
