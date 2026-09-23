import { buildInvestigationTimeline, linkedReportIds, orderTimeline, type TimelineCase, type TimelineEvent } from '@/lib/investigation-timeline';
import { normalizeAttributionNetwork, lookupCustodialAttribution } from '@/lib/custodial-attribution';
import type { WalletEvidence } from '@/lib/freeze-hold';
import type { VictimReport } from '@/lib/victim-reports';
import type { CaseConnectionAnalysis } from '@/lib/case-analysis';

export const PACKAGE_NOTICES = [
  'Risk signals are investigative indicators and are not proof of fraud.',
  'Wallet connections do not prove common ownership or coordinated activity.',
  'CHAINTRACE does not autonomously freeze, reverse, seize, or block blockchain assets.',
  'Authorized intervention requires the appropriate exchange, custodian, or competent authority.',
];
export function classifyPackageEvent(event: TimelineEvent) {
  if (event.category === 'Transfers') return 'observed-blockchain-evidence';
  if (event.category === 'Custodial Attribution') return 'verified-custodial-attribution';
  if (event.id.startsWith('fingerprint:') || event.category === 'Signals' || event.category === 'Connections') return 'derived-investigative-signal';
  return 'private-case-report-record';
}
export type PackageInput = {
  record: TimelineCase; wallets?: WalletEvidence[]; reports?: VictimReport[];
  connections?: CaseConnectionAnalysis | null; issues?: string[]; generatedAt: string;
};

/** Projection of supplied evidence; no fetching or new analytics. Export time is supplied by the caller. */
export function buildCaseEvidencePackage(input: PackageInput) {
  const { record } = input;
  const wallets = (input.wallets || []).filter(wallet => normalizeAttributionNetwork(wallet.network) === 'eip155:1' && record.wallets.some(item => item.address.toLowerCase() === wallet.address.toLowerCase() && normalizeAttributionNetwork(item.network) === 'eip155:1'));
  const reports = (input.reports || []).filter(report => linkedReportIds(record).includes(report.id.toLowerCase()));
  const connections = input.connections?.caseA.id === record.id && input.connections.caseB.id === record.id ? input.connections : null;
  const timeline = buildInvestigationTimeline({ record, wallets, reports, connections });
  const ordered = orderTimeline(timeline.events);
  const events = [...ordered.dated, ...ordered.undated].map(event => ({ ...event, classification: classifyPackageEvent(event) }));
  const missing = record.wallets.filter(wallet => !wallets.some(item => item.address.toLowerCase() === wallet.address.toLowerCase()));
  const attributions = [...timeline.attributions];
  for (const wallet of record.wallets) if (!attributions.some(item => item.address === wallet.address.toLowerCase())) attributions.push(lookupCustodialAttribution(wallet.network, wallet.address));
  const findings = (predicate: (event: TimelineEvent) => boolean) => events.filter(predicate);
  return {
    packageType: 'CHAINTRACE Case Evidence Package', packageVersion: 1,
    generatedAt: input.generatedAt,
    privateRecords: { classification: 'private-case-report-record', case: record, reports },
    observedEvidence: { classification: 'observed-blockchain-evidence', walletDatasets: wallets, transfers: findings(event => event.category === 'Transfers') },
    investigationTimeline: { datedCount: ordered.dated.length, undatedCount: ordered.undated.length, transferCount: timeline.transferCount, events },
    derivedSignals: {
      classification: 'derived-investigative-signal',
      moneyFingerprint: findings(event => event.id.startsWith('fingerprint:')),
      fundSplitting: findings(event => event.type === 'Fund Splitting Signal'),
      crossWalletConnections: findings(event => event.category === 'Connections'),
      connectionAnalysis: connections,
    },
    custodialAttribution: { classification: 'registry-attribution-status', addresses: attributions },
    availability: {
      walletDatasetsLoaded: wallets.length, walletDatasetsExpected: record.wallets.length,
      unavailableWallets: missing.map(wallet => ({ address: wallet.address, network: wallet.network, status: 'UNAVAILABLE / NOT GENERATED' })),
      unavailableReports: linkedReportIds(record).filter(id => !reports.some(report => report.id.toLowerCase() === id)),
      crossWalletAnalysis: connections ? 'AVAILABLE' : 'UNAVAILABLE / NOT GENERATED',
      moneyFingerprint: events.some(event => event.id.startsWith('fingerprint:')) ? 'AVAILABLE FOR ELIGIBLE EVIDENCE' : 'UNAVAILABLE: no eligible transfers',
      fundSplitting: timeline.transferCount ? 'Computed over eligible evidence; an empty result means no configured signal in this sample.' : 'UNAVAILABLE: no eligible transfers',
      freezeHold: 'NOT INCLUDED: local drafts and exports are not persisted evidence of external intervention.',
    },
    limitations: [
      'Private case and report records contain investigator notes and allegations, not independently verified blockchain facts.',
      'Retrieved wallet datasets preserve provider records, including failed or unknown execution status. Only eligible successful positive-value transfers enter the timeline and its derived signals.',
      'Coverage is limited to retrieved normal Ethereum Mainnet transfers. Token transfers, internal transfers, off-chain activity and complete historical coverage are unavailable.',
      'Missing evidence or an empty signal result does not establish absence of activity. Retrieval and generation times are not blockchain transaction times.',
      'Cross-wallet API analysis may use a different retrieval window; its source, timestamp and limitations are preserved separately.',
      'This package is a local snapshot. No external submission, acknowledgement, freeze or hold is asserted.',
      ...timeline.warnings, ...(input.issues || []),
    ],
    investigatorDisclaimers: [...PACKAGE_NOTICES],
  };
}
export type CaseEvidencePackage = ReturnType<typeof buildCaseEvidencePackage>;
