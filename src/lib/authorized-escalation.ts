import type { FreezeHoldPrintPackage } from '@/components/freeze-hold-print-report';

export const INTERNAL_STATUSES = ['DRAFT', 'READY FOR REVIEW', 'PREPARED FOR AUTHORIZED ESCALATION', 'CLOSED'] as const;
export type InternalStatus = typeof INTERNAL_STATUSES[number];
export const EXTERNAL_STATUSES = ['ACKNOWLEDGED', 'UNDER REVIEW', 'ACTIONED', 'DECLINED'] as const;
export type ExternalStatus = typeof EXTERNAL_STATUSES[number];
export const ENTITY_TYPES = ['Cryptocurrency Exchange', 'Custodian', 'Compliance Team', 'Law-Enforcement / Competent Authority', 'Other Authorized Entity'] as const;
export type TargetDetails = { entityType: string; attributionStatus: 'VERIFIED' | 'POSSIBLE' | 'UNVERIFIED / MANUAL ENTRY'; contactReference: string; attributionReference: string };
export type ExternalResponse = { referenceId: string; entity: string; respondedAt: string; status: ExternalStatus; notes: string; confirmed: boolean; recordedAt: string; source: 'Analyst recorded' };
export type AuditEntry = { at: string; action: string; status: string; source: 'CHAINTRACE' | 'Analyst recorded'; note: string };
export type EvidenceValidation = { label: string; state: 'AVAILABLE' | 'MISSING' | 'NOT APPLICABLE'; required: boolean; explanation: string };
export const ESCALATION_NOTICE = 'CHAINTRACE provides blockchain investigation, evidence preparation and authorized escalation intelligence. It does not autonomously freeze, reverse or seize blockchain assets.';
export const SUBMISSION_NOTICE = 'External submission is performed through an authorized channel outside CHAINTRACE unless an approved integration is configured.';

export function validateEscalation(data: FreezeHoldPrintPackage, notApplicable: Record<string, string> = {}): EvidenceValidation[] {
  const txs = data.blockchainObservedFacts.transactions;
  const rows: [string, boolean, boolean][] = [
    ['Case reference', !!data.case.id && !!data.case.code, true],
    ['Reported / suspect wallet', data.reportedSuspectWallets.length > 0, true],
    ['Blockchain network', !!data.network, true],
    ['Transaction evidence', txs.length > 0, false],
    ['Transaction hashes', txs.some(tx => /^0x[0-9a-f]{64}$/i.test(tx.hash)), false],
    ['Transaction timestamps', txs.some(tx => !!tx.timestamp && Number.isFinite(Date.parse(tx.timestamp))), false],
    ['Behavioral analysis', data.analyticalSignals.length > 0, false],
    ['Money Fingerprint', data.analyticalSignals.some(row => !!row.moneyFingerprint), false],
    ['Fund Splitting analysis', data.analyticalSignals.some(row => !!row.fundSplitting), false],
    ['Cross-wallet evidence', !!data.crossWalletEvidence, false],
    ['Monitoring alerts', data.monitoringAlerts.length > 0, false],
    ['Custodial endpoint attribution', data.custodialEndpoints.some(row => row.status === 'VERIFIED CUSTODIAL ENDPOINT'), false],
    ['Target entity', !!data.targetEntity?.trim(), true],
    ['Reason for request', !!data.reason.trim(), true],
    ['Investigator notes', !!data.analystNotes.trim(), true],
  ];
  return rows.map(([label, available, required]) => {
    const explanation = !available && !required ? notApplicable[label]?.trim() : '';
    return { label, required, state: available ? 'AVAILABLE' : explanation ? 'NOT APPLICABLE' : 'MISSING', explanation: explanation ? `Analyst assessment: ${explanation}` : available ? 'Present in this package.' : required ? 'Required before review/preparation.' : 'Optional; unavailable or not observed. Does not block preparation.' };
  });
}

export function externalResponseError(response: Omit<ExternalResponse, 'recordedAt' | 'source'>, now = Date.now()) {
  if (!response.confirmed) return 'Confirm that the status is based on a verified external response.';
  if (!response.referenceId.trim() || !response.entity.trim()) return 'Enter the external reference ID and responding entity.';
  if (!(EXTERNAL_STATUSES as readonly string[]).includes(response.status)) return 'Choose a valid external response status.';
  const date = Date.parse(response.respondedAt);
  if (!Number.isFinite(date) || date > now) return 'Enter a valid response date/time that is not in the future.';
  return null;
}

export function snapshotPackage<T>(data: T): T {
  // The package contains JSON-safe evidence. Detach it from future live state.
  return JSON.parse(JSON.stringify(data)) as T;
}
