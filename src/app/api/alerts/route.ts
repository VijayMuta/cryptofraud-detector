import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/request-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sign in to view monitoring alerts.' }, { status: 401 });
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: 'Wallet monitoring is not configured on this server.' }, { status: 503 });
  }

  const { data, error } = await admin
    .from('monitor_alerts')
    .select('id,alert_type,severity,title,description,source_transaction_hash,risk_score,status,created_at,wallet_monitors!inner(address,user_id)')
    .eq('wallet_monitors.user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: 'Unable to load monitoring alerts.' }, { status: 500 });
  }

  const alerts = (data || []).map((alert: Record<string, unknown>) => {
    const monitor = alert.wallet_monitors as { address?: string } | { address?: string }[] | null;
    const wallet = Array.isArray(monitor) ? monitor[0]?.address : monitor?.address;
    const { wallet_monitors: _monitor, ...rest } = alert;
    return { ...rest, wallet: wallet || null };
  });

  return NextResponse.json({ alerts }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sign in to update monitoring alerts.' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Enter a valid alert update.' }, { status: 400 });
  }

  const alertId = typeof body.alertId === 'string' ? body.alertId : '';
  const status = body.status;
  if (!alertId || (status !== 'new' && status !== 'reviewing' && status !== 'closed')) {
    return NextResponse.json({ error: 'Choose a valid alert status.' }, { status: 400 });
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: 'Wallet monitoring is not configured on this server.' }, { status: 503 });
  }

  const { data: ownedAlert, error: ownershipError } = await admin
    .from('monitor_alerts')
    .select('id,wallet_monitors!inner(user_id)')
    .eq('id', alertId)
    .eq('wallet_monitors.user_id', user.id)
    .maybeSingle();
  if (ownershipError) {
    return NextResponse.json({ error: 'Unable to verify alert access.' }, { status: 500 });
  }
  if (!ownedAlert) {
    return NextResponse.json({ error: 'Alert not found.' }, { status: 404 });
  }

  const { data, error } = await admin
    .from('monitor_alerts')
    .update({ status })
    .eq('id', alertId)
    .select('id,status')
    .single();
  if (error || !data) {
    return NextResponse.json({ error: 'Unable to update the alert.' }, { status: 500 });
  }

  return NextResponse.json({ alert: data }, { headers: { 'Cache-Control': 'no-store' } });
}
