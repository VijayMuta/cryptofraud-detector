import { NextRequest } from 'next/server';
import { normalizeAlert, parseAlertFilters, uuid } from '@/lib/alerts';
import { alertContext, alertFailure, alertResponse, alertSummary, ALERT_SELECT, AlertError } from '@/lib/alert-server';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const { user, admin } = await alertContext(request);
    if (request.nextUrl.searchParams.get('summary') === '1') return alertResponse({ summary: await alertSummary(admin, user.id) });
    let filters;
    try { filters = parseAlertFilters(request.nextUrl.searchParams); } catch (error) { throw new AlertError(error instanceof Error ? error.message : 'Invalid filters.', 400); }
    const paginated = request.nextUrl.searchParams.has('page');
    const pageSize = paginated ? 20 : 100; // Preserve existing Dashboard/API consumers.
    let query = admin.from('monitor_alerts').select(ALERT_SELECT, { count: 'exact' }).eq('wallet_monitors.user_id', user.id);
    if (filters.wallet) query = query.eq('wallet_monitors.address', filters.wallet);
    if (filters.q) {
      const monitors = await admin.from('wallet_monitors').select('id', { count: 'exact' }).eq('user_id', user.id).ilike('address', '%' + filters.q + '%').limit(500);
      if (monitors.error) throw new AlertError('Unable to search monitored wallets.');
      if (typeof monitors.count !== 'number') throw new AlertError('Unable to verify wallet search coverage.');
      if (monitors.count > (monitors.data || []).length) throw new AlertError('This prefix matches too many monitored wallets. Enter more of the address or hash.', 400);
      const ids = (monitors.data || []).map(row => row.id).filter(uuid);
      // q contains only validated hex characters, IDs only validated UUIDs.
      query = ids.length ? query.or('source_transaction_hash.ilike.%' + filters.q + '%,monitor_id.in.(' + ids.join(',') + ')') : query.ilike('source_transaction_hash', '%' + filters.q + '%');
    }
    if (filters.severity === 'priority') query = query.in('severity', ['critical', 'high']);
    else if (filters.severity !== 'all') query = query.eq('severity', filters.severity);
    if (filters.status === 'needs_review') query = query.in('status', ['new', 'reviewing']);
    else if (filters.status !== 'all') query = query.eq('status', filters.status);
    if (filters.type !== 'all') query = query.eq('alert_type', filters.type);
    if (filters.from) query = query.gte('created_at', filters.from + 'T00:00:00.000Z');
    if (filters.to) query = query.lt('created_at', new Date(Date.parse(filters.to) + 86400000).toISOString());
    const { data, error, count } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range((filters.page - 1) * pageSize, filters.page * pageSize - 1);
    if (error || typeof count !== 'number') throw new AlertError('Unable to load monitoring alerts.');
    const summary = request.nextUrl.searchParams.get('overview') === '1' ? await alertSummary(admin, user.id) : undefined;
    return alertResponse({ alerts: (data || []).map(normalizeAlert), total: count, page: filters.page, pageSize, ...(summary ? { summary } : {}) });
  } catch (error) { return alertFailure(error); }
}
export async function PATCH(request: NextRequest) {
  try {
    const { user, admin } = await alertContext(request);
    const raw = await request.text();
    if (raw.length > 2048) throw new AlertError('Alert update is too large.', 413);
    let body;
    try { body = JSON.parse(raw); } catch { throw new AlertError('Enter a valid alert update.', 400); }
    if (!body || !uuid(body.alertId) || !['new', 'reviewing', 'closed'].includes(body.status)) throw new AlertError('Choose a valid alert and status.', 400);
    const { data: owned, error: ownershipError } = await admin.from('monitor_alerts').select('id,monitor_id,wallet_monitors!inner(user_id)').eq('id', body.alertId).eq('wallet_monitors.user_id', user.id).maybeSingle();
    if (ownershipError) throw new AlertError('Unable to verify alert access.');
    if (!owned) throw new AlertError('Alert not found.', 404);
    const { data, error } = await admin.from('monitor_alerts').update({ status: body.status }).eq('id', owned.id).eq('monitor_id', owned.monitor_id).select('id,status').maybeSingle();
    if (error) throw new AlertError('Unable to update the alert.');
    if (!data) throw new AlertError('Alert no longer exists. Refresh the list.', 404);
    return alertResponse({ alert: data });
  } catch (error) { return alertFailure(error); }
}
