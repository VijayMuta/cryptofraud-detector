import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/request-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { dateValue } from '@/lib/alerts';
export class AlertError extends Error { constructor(message: string, readonly status = 500) { super(message); } }
export const alertResponse = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export const alertFailure = (error: unknown) => alertResponse({ error: error instanceof AlertError ? error.message : 'Unable to access monitoring alerts. Please retry.' }, error instanceof AlertError ? error.status : 500);
export async function alertContext(request: Request) {
  const user = await getRequestUser(request);
  if (!user) throw new AlertError('Sign in to review monitoring alerts.', 401);
  try { return { user, admin: getSupabaseAdmin() }; } catch { throw new AlertError('Wallet monitoring is not configured on this server.', 503); }
}
export const ALERT_SELECT = 'id,alert_type,severity,title,description,source_transaction_hash,risk_score,status,created_at,wallet_monitors!inner(address,user_id)';
export async function alertSummary(admin: SupabaseClient, userId: string) {
  const asOf = new Date().toISOString(), since = new Date(Date.parse(asOf) - 86400000).toISOString();
  const base = () => admin.from('monitor_alerts').select('id,wallet_monitors!inner(user_id)', { count: 'exact', head: true }).eq('wallet_monitors.user_id', userId);
  const results = await Promise.all([
    base(), base().in('severity', ['critical', 'high']).neq('status', 'closed'), base().in('status', ['new', 'reviewing']), base().gte('created_at', since).lte('created_at', asOf), base().eq('severity', 'critical').neq('status', 'closed'),
    admin.from('wallet_monitors').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('is_active', true),
    admin.from('wallet_monitors').select('last_checked_at').eq('user_id', userId).order('last_checked_at', { ascending: false, nullsFirst: false }).limit(1),
    admin.from('wallet_monitors').select('last_successful_check_at').eq('user_id', userId).order('last_successful_check_at', { ascending: false, nullsFirst: false }).limit(1),
  ]);
  if (results.some(result => result.error) || results.slice(0, 6).some(result => typeof result.count !== 'number')) throw new AlertError('Unable to load alert overview counts.');
  return { total: results[0].count!, priority: results[1].count!, needsReview: results[2].count!, recent: results[3].count!, critical: results[4].count!, monitoredWallets: results[5].count!, latestCheck: dateValue(results[6].data?.[0]?.last_checked_at), latestSuccessfulCheck: dateValue(results[7].data?.[0]?.last_successful_check_at), asOf };
}
