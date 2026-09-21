import { isEthereumAddress } from '@/lib/ethereum-address';

export const ATTRIBUTION_STATUSES = ['VERIFIED', 'POSSIBLE / UNVERIFIED', 'UNATTRIBUTED / UNKNOWN'] as const;
export type AttributionStatus = typeof ATTRIBUTION_STATUSES[number];
export type CustodialAttributionRecord = {
  id: string;
  network: string;
  address: string;
  entityName: string;
  entityType: string;
  status: AttributionStatus;
  sourceName: string;
  sourceReference?: string;
  verifiedAt: string | null;
  notes?: string;
};
export type CustodialEndpoint = {
  address: string;
  network: string;
  status: 'VERIFIED' | 'UNATTRIBUTED / UNKNOWN';
  attribution: string;
  record: CustodialAttributionRecord | null;
  possibleRecords: CustodialAttributionRecord[];
};

// Trust boundary: only reviewed, source-backed public attribution records belong
// here. Never populate this registry from user input, target forms, or behavior.
// No trusted dataset/API is configured. No demo records ship in production.
export const TRUSTED_CUSTODIAL_RECORDS: readonly CustodialAttributionRecord[] = Object.freeze([]);
export const UNKNOWN_ATTRIBUTION = 'No verified custodial attribution is currently available for this address.';
export const ATTRIBUTION_NOTICE = 'Custodial attribution is not proof of fraud and does not give CHAINTRACE control over assets.';

export function normalizeAttributionAddress(value: string): string | null {
  const address = value.trim();
  return isEthereumAddress(address) ? address.toLowerCase() : null;
}
export function normalizeAttributionNetwork(value: string): string | null {
  return ['ethereum', 'ethereum mainnet', 'eip155:1'].includes(value.trim().toLowerCase()) ? 'eip155:1' : null;
}

/** trustedRecords is an explicit trusted provider/test boundary, never analyst input. */
export function lookupCustodialAttribution(network: string, address: string, trustedRecords: readonly CustodialAttributionRecord[] = TRUSTED_CUSTODIAL_RECORDS, now = Date.now()): CustodialEndpoint {
  const normalizedAddress = normalizeAttributionAddress(address);
  const normalizedNetwork = normalizeAttributionNetwork(network);
  const unknown: CustodialEndpoint = { address: normalizedAddress || address, network: normalizedNetwork || network, status: 'UNATTRIBUTED / UNKNOWN', attribution: UNKNOWN_ATTRIBUTION, record: null, possibleRecords: [] };
  if (!normalizedAddress || !normalizedNetwork) return unknown;
  const matches = trustedRecords.filter(record => normalizeAttributionNetwork(record.network) === normalizedNetwork && normalizeAttributionAddress(record.address) === normalizedAddress && record.id.trim() && record.entityName.trim() && record.entityType.trim() && record.sourceName.trim());
  const verified = matches.filter(record => record.status === 'VERIFIED' && !!record.verifiedAt && Number.isFinite(Date.parse(record.verifiedAt)) && Date.parse(record.verifiedAt) <= now);
  // Conflicting verified identities are not silently resolved into ownership.
  const identities = new Set(verified.map(record => record.entityName.trim().toLowerCase() + ':' + record.entityType.trim().toLowerCase()));
  if (verified.length && identities.size === 1) {
    const record = [...verified].sort((a, b) => Date.parse(b.verifiedAt!) - Date.parse(a.verifiedAt!))[0];
    return { ...unknown, status: 'VERIFIED', attribution: 'Exact network/address match in the trusted attribution registry.', record: { ...record, address: normalizedAddress, network: normalizedNetwork } };
  }
  return { ...unknown, possibleRecords: matches.filter(record => record.status === 'POSSIBLE / UNVERIFIED').map(record => ({ ...record, address: normalizedAddress, network: normalizedNetwork })) };
}

/** Manual entity names/references cannot create or upgrade registry records. */
export function resolveCustodialTarget(selectedAddress: string, endpoints: readonly CustodialEndpoint[], manualName: string, manualType: string) {
  const normalized = normalizeAttributionAddress(selectedAddress);
  const endpoint = normalized ? endpoints.find(item => item.address === normalized && item.status === 'VERIFIED' && item.record?.status === 'VERIFIED') : undefined;
  return endpoint?.record
    ? { entityName: endpoint.record.entityName, entityType: endpoint.record.entityType, source: 'BLOCKCHAIN/ATTRIBUTION VERIFIED', endpoint }
    : { entityName: manualName, entityType: manualType, source: 'ANALYST-ENTERED / UNVERIFIED', endpoint: null };
}
