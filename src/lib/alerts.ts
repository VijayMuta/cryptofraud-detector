export const ALERT_TYPES = { fund_splitting: 'Fund splitting signal', unusual_movement: 'Unusual outgoing ETH movement' } as const;
export const ALERT_STATUSES = { new: 'New', reviewing: 'Reviewing', closed: 'Closed' } as const;
export type AlertStatus = keyof typeof ALERT_STATUSES;
export type AlertRow = {
  id: string; alert_type: string; severity: string; title: string; description: string;
  source_transaction_hash: string | null; risk_score: number | null; status: string; created_at: string | null; wallet: string | null;
};
export type AlertSummary = { total: number; priority: number; needsReview: number; recent: number; critical: number; monitoredWallets: number; latestCheck: string | null; latestSuccessfulCheck: string | null; asOf: string };
export type AlertDetail = {
  alert: AlertRow; monitor: { active: boolean | null; lastCheck: string | null; lastSuccess: string | null };
  evidence: { totalWei: string | null; baselineAverageWei: string | null; multiplier: number | null; destinationCount: number | null; windowStart: string | null; windowEnd: string | null; hashes: string[] };
  transaction: { from: string | null; to: string | null; valueWei: string | null; timestamp: string | null; status: string } | null;
  transactionUnavailable: boolean;
};
export const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const address = (value: unknown): string | null => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value) ? value : null;
export const hash = (value: unknown): string | null => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value) ? value : null;
export const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const dateValue = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
export const wei = (value: unknown): string | null => typeof value === 'string' && /^\d{1,78}$/.test(value) ? value : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
export function normalizeAlert(input: unknown): AlertRow {
  const row = record(input), monitor = record(Array.isArray(row.wallet_monitors) ? row.wallet_monitors[0] : row.wallet_monitors);
  return { id: String(row.id || ''), alert_type: typeof row.alert_type === 'string' ? row.alert_type : 'unknown', severity: typeof row.severity === 'string' ? row.severity : 'unknown', title: typeof row.title === 'string' ? row.title : 'Stored monitoring signal', description: typeof row.description === 'string' ? row.description : 'Explanation unavailable.', source_transaction_hash: hash(row.source_transaction_hash), risk_score: typeof row.risk_score === 'number' && Number.isFinite(row.risk_score) ? row.risk_score : null, status: typeof row.status === 'string' ? row.status : 'unknown', created_at: dateValue(row.created_at), wallet: address(monitor.address) };
}
export function normalizeDetail(input: unknown, transaction: unknown, transactionUnavailable: boolean): AlertDetail {
  const row = record(input), details = record(row.details), monitor = record(Array.isArray(row.wallet_monitors) ? row.wallet_monitors[0] : row.wallet_monitors), tx = record(transaction);
  const nonnegative = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  return { alert: normalizeAlert(row), monitor: { active: typeof monitor.is_active === 'boolean' ? monitor.is_active : null, lastCheck: dateValue(monitor.last_checked_at), lastSuccess: dateValue(monitor.last_successful_check_at) }, evidence: { totalWei: wei(details.totalWei), baselineAverageWei: wei(details.baselineAverageWei), multiplier: nonnegative(details.multiplier), destinationCount: nonnegative(details.destinationCount), windowStart: dateValue(details.windowStart), windowEnd: dateValue(details.windowEnd), hashes: Array.isArray(details.transactionHashes) ? [...new Set(details.transactionHashes.map(hash).filter((value): value is string => value !== null))].slice(0, 100) : [] }, transaction: transaction ? { from: address(tx.from_address), to: address(tx.to_address), valueWei: wei(tx.value_wei), timestamp: dateValue(tx.occurred_at), status: ['success', 'failed', 'unknown'].includes(String(tx.status)) ? String(tx.status) : 'unknown' } : null, transactionUnavailable };
}
export type AlertFilters = { page: number; q: string; wallet: string; severity: string; status: string; type: string; from: string; to: string };
export function parseAlertFilters(params: URLSearchParams): AlertFilters {
  const page = Number(params.get('page') || 1), q = (params.get('q') || '').trim().toLowerCase(), wallet = (params.get('wallet') || '').trim().toLowerCase();
  const severity = params.get('severity') || 'all', status = params.get('status') || 'all', type = params.get('type') || 'all', from = params.get('from') || '', to = params.get('to') || '';
  if (!Number.isInteger(page) || page < 1 || page > 10000) throw new Error('Invalid alert page.');
  if (q && !/^0x[0-9a-f]{0,64}$/.test(q)) throw new Error('Search by a wallet address or transaction hash beginning with 0x.');
  if (wallet && !address(wallet)) throw new Error('Enter a complete valid wallet address for the wallet filter.');
  if (!['all', 'critical', 'high', 'priority'].includes(severity) || !['all', 'new', 'reviewing', 'closed', 'needs_review'].includes(status) || !['all', ...Object.keys(ALERT_TYPES)].includes(type)) throw new Error('Invalid alert filter.');
  for (const day of [from, to]) if (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !dateValue(day) || new Date(day).toISOString().slice(0, 10) !== day || day > '9998-12-31')) throw new Error('Choose valid detection dates.');
  if (from && to && from > to) throw new Error('Start date must be on or before end date.');
  return { page, q, wallet, severity, status, type, from, to };
}
export function alertInvestigationUrl(wallet: string) { return `/investigate?address=${encodeURIComponent(wallet)}`; }
