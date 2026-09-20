import { NextRequest } from 'next/server';
import { normalizeDetail, uuid, hash } from '@/lib/alerts';
import { alertContext, alertFailure, alertResponse, AlertError } from '@/lib/alert-server';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { user, admin } = await alertContext(request);
    if (!uuid(params.id)) throw new AlertError('Alert not found.', 404);
    const { data, error } = await admin.from('monitor_alerts').select('id,monitor_id,alert_type,severity,title,description,source_transaction_hash,risk_score,status,created_at,details,wallet_monitors!inner(address,user_id,is_active,last_checked_at,last_successful_check_at)').eq('id', params.id).eq('wallet_monitors.user_id', user.id).maybeSingle();
    if (error) throw new AlertError('Unable to load alert evidence.');
    if (!data) throw new AlertError('Alert not found.', 404);
    // Only read the transaction for the already-authorized monitor; no provider requests.
    const transaction = hash(data.source_transaction_hash) ? await admin.from('monitor_transactions').select('from_address,to_address,value_wei::text,occurred_at,status').eq('monitor_id', data.monitor_id).eq('transaction_hash', data.source_transaction_hash).maybeSingle() : { data: null, error: null };
    return alertResponse(normalizeDetail(data, transaction.error ? null : transaction.data, Boolean(transaction.error)));
  } catch (error) { return alertFailure(error); }
}
