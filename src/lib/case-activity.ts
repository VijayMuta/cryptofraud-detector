import { canonicalSerialize, type IntegrityRecord, type VerificationResult } from '@/lib/evidence-integrity';

export const ACTIVITY_DEFINITIONS = {
  CASE_CREATED: ['Case created.', 'Case', 'case-management'],
  CASE_STATUS_CHANGED: ['Case status changed.', 'Case', 'case-management'],
  WALLET_ADDED: ['Wallet added to case.', 'Wallet', 'case-management'],
  WALLET_REMOVED: ['Wallet removed from case.', 'Wallet', 'case-management'],
  BLOCKCHAIN_EVIDENCE_REFRESHED: ['Case blockchain evidence refreshed.', 'Blockchain Evidence', 'evidence-refresh'],
  TRANSACTION_VIEWED: ['Transaction Deep Dive viewed with retrieved evidence.', 'Transactions', 'transaction-deep-dive'],
  EVIDENCE_PACKAGE_GENERATED: ['Case Evidence Package generated.', 'Evidence', 'evidence-package'],
  EVIDENCE_INTEGRITY_VERIFIED: ['Evidence integrity comparison: MATCH.', 'Evidence', 'evidence-integrity'],
  EVIDENCE_INTEGRITY_MISMATCH: ['Evidence integrity comparison: MISMATCH. Content changes may be legitimate.', 'Evidence', 'evidence-integrity'],
  FREEZE_HOLD_PACKAGE_PREPARED: ['Freeze/Hold evidence package prepared in CHAINTRACE.', 'Freeze/Hold', 'freeze-hold'],
  CASE_NOTE_CREATED: ['Investigator note added to case.', 'Case', 'case-notes'],
} as const;
export type ActivityType = keyof typeof ACTIVITY_DEFINITIONS;
export type ActivityMetadata = Record<string, string | number>;
export type CaseActivity = { id: string; case_id: string; actor_user_id: string | null; event_type: ActivityType; event_timestamp: string; metadata: ActivityMetadata; origin: 'database' | 'browser-reported' };
export const ACTIVITY_NOTICE = 'CHAINTRACE Case Activity records application actions associated with this investigation. It supports operational traceability but does not independently establish legal authenticity, external delivery, regulatory approval, or proof of fraud. It is not a substitute for server/platform security logs.';
export const ACTIVITY_EMPTY = 'No activity has been recorded for this case since audit tracking became available.';
export const ACTIVITY_WARNING = 'The action completed, but its Case Activity record could not be confirmed. Refresh Case Activity to check; do not repeat the primary action just to log it.';
export const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function isActivityType(value: unknown): value is ActivityType { return typeof value === 'string' && Object.hasOwn(ACTIVITY_DEFINITIONS, value); }
const rules: Record<string, (value: unknown) => boolean> = {
  noteId: isUuid,
  network: v => v === 'ethereum',
  walletAddress: v => typeof v === 'string' && /^0x[0-9a-f]{40}$/i.test(v),
  transactionHash: v => typeof v === 'string' && /^0x[0-9a-f]{64}$/i.test(v),
  previousStatus: v => ['open', 'investigating', 'closed', 'archived'].includes(String(v)),
  status: v => ['open', 'investigating', 'closed', 'archived'].includes(String(v)),
  requestedWallets: v => Number.isInteger(v) && Number(v) > 0 && Number(v) <= 100,
  loadedWallets: v => Number.isInteger(v) && Number(v) > 0 && Number(v) <= 100,
  provider: v => ['Alchemy', 'case-history'].includes(String(v)),
  component: v => ['case-details', 'investigation-timeline', 'freeze-hold'].includes(String(v)),
  completedAt: v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)),
  packageVersion: v => v === 'chaintrace-evidence-v1',
  packageType: v => ['case-report', 'case-evidence-package', 'freeze-hold'].includes(String(v)),
  fingerprint: v => typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v),
};
const fields: Record<ActivityType, string[]> = {
  CASE_CREATED: ['status'], CASE_STATUS_CHANGED: ['previousStatus', 'status'],
  WALLET_ADDED: ['network', 'walletAddress'], WALLET_REMOVED: ['network', 'walletAddress'],
  BLOCKCHAIN_EVIDENCE_REFRESHED: ['requestedWallets', 'loadedWallets', 'provider', 'component', 'completedAt'],
  TRANSACTION_VIEWED: ['network', 'transactionHash'],
  EVIDENCE_PACKAGE_GENERATED: ['packageVersion', 'completedAt'],
  EVIDENCE_INTEGRITY_VERIFIED: ['packageVersion', 'packageType', 'fingerprint'],
  EVIDENCE_INTEGRITY_MISMATCH: ['packageVersion', 'packageType', 'fingerprint'],
  FREEZE_HOLD_PACKAGE_PREPARED: ['completedAt'],
  CASE_NOTE_CREATED: ['noteId'],
};
/** Exact per-event scalar allowlists: no arbitrary text, nested responses or credentials. */
export function validateActivityMetadata(type: unknown, value: unknown): ActivityMetadata {
  if (!isActivityType(type) || !value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Invalid activity metadata.');
  const allowed = fields[type];
  if (Reflect.ownKeys(value).length !== allowed.length) throw new Error('Unexpected activity fields.');
  const result: ActivityMetadata = {};
  for (const key of allowed) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable || !['string', 'number'].includes(typeof descriptor.value) || !rules[key](descriptor.value)) throw new Error('Invalid activity field.');
    result[key] = descriptor.value;
  }
  if (type === 'BLOCKCHAIN_EVIDENCE_REFRESHED' && Number(result.loadedWallets) > Number(result.requestedWallets)) throw new Error('Invalid refresh counts.');
  if (type === 'CASE_STATUS_CHANGED' && result.status === result.previousStatus) throw new Error('Status did not change.');
  return result;
}
export function orderActivity(events: CaseActivity[]) { return [...events].sort((a, b) => b.event_timestamp.localeCompare(a.event_timestamp) || b.id.localeCompare(a.id)); }
export function integrityActivity(result: VerificationResult, record?: IntegrityRecord) {
  if (!record?.caseId || !result.actualHash || (result.status !== 'MATCH' && result.status !== 'MISMATCH')) return null;
  const eventType: ActivityType = result.status === 'MATCH' ? 'EVIDENCE_INTEGRITY_VERIFIED' : 'EVIDENCE_INTEGRITY_MISMATCH';
  return { caseId: record.caseId, eventType, metadata: validateActivityMetadata(eventType, {
    packageVersion: record.packageVersion, packageType: record.packageType, fingerprint: result.actualHash,
  }) };
}
export function exportActivity(caseId: string, events: CaseActivity[], generatedAt: string) {
  if (!isUuid(caseId) || !Number.isFinite(Date.parse(generatedAt))) throw new Error('Invalid export reference.');
  return canonicalSerialize({ version: 'chaintrace-case-activity-v1', caseId, generatedAt, notice: ACTIVITY_NOTICE, events: orderActivity(events).map(event => {
    if (event.case_id !== caseId) throw new Error('Activity belongs to a different case.');
    return { id: event.id, case_id: caseId, actor_user_id: event.actor_user_id, event_type: event.event_type, event_timestamp: event.event_timestamp, origin: event.origin, metadata: validateActivityMetadata(event.event_type, event.metadata) };
  }) });
}
