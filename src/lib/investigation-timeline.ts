import type { InvestigationCase, CaseWallet } from '@/lib/cases';
import type { VictimReport } from '@/lib/victim-reports';
import type { CaseConnectionAnalysis } from '@/lib/case-analysis';
import type { WalletEvidence } from '@/lib/freeze-hold';
import { analyzeWalletTransactions, type WalletTransaction } from '@/lib/wallet-analysis';
import { lookupCustodialAttribution, normalizeAttributionAddress, normalizeAttributionNetwork, TRUSTED_CUSTODIAL_RECORDS, type CustodialAttributionRecord } from '@/lib/custodial-attribution';

export const TIMELINE_DISCLAIMER = 'Timeline events represent observed blockchain and case evidence. Risk signals and wallet connections are investigative indicators and do not by themselves prove fraud, common ownership or coordinated activity.';
export const TIMELINE_FILTERS = ['All', 'Transfers', 'Signals', 'Connections', 'Custodial Attribution'] as const;
export type TimelineFilter = typeof TIMELINE_FILTERS[number];
export type TimelineEvent = {
  id: string;
  type: 'Victim Report' | 'Case Created' | 'Observed Incoming Transfer' | 'Observed Outgoing Transfer' | 'Fund Splitting Signal' | 'Repeated Destination Signal' | 'Cross-Wallet Connection' | 'Verified Custodial Endpoint' | 'Investigation Evidence';
  category: Exclude<TimelineFilter, 'All'> | 'Case evidence';
  timestamp: string | null;
  timestampMeaning: string;
  addresses: string[];
  hashes: string[];
  network?: string;
  valueWei?: string;
  description: string;
  source: string;
  details: unknown;
};
export type TimelineCase = InvestigationCase & { wallets: CaseWallet[] };

// Date-only reports and retrieval times must never become transaction times.
function reliableTime(value: string | null | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}
export function linkedReportIds(record: TimelineCase): string[] {
  return [...new Set([...record.description.matchAll(/Source intake report: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi)].map(match => match[1].toLowerCase()))];
}
export function orderTimeline(events: TimelineEvent[], order: 'oldest' | 'newest' = 'oldest', filter: TimelineFilter = 'All') {
  const visible = events.filter(event => filter === 'All' || event.category === filter);
  return {
    dated: visible.filter(event => reliableTime(event.timestamp)).sort((a, b) => (Date.parse(a.timestamp!) - Date.parse(b.timestamp!)) * (order === 'oldest' ? 1 : -1) || a.id.localeCompare(b.id)),
    undated: visible.filter(event => !reliableTime(event.timestamp)).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** Pure evidence projection. trustedRecords is the existing reviewed-provider/test boundary. */
export function buildInvestigationTimeline(input: { record: TimelineCase; wallets: WalletEvidence[]; reports?: VictimReport[]; connections?: CaseConnectionAnalysis | null }, trustedRecords: readonly CustodialAttributionRecord[] = TRUSTED_CUSTODIAL_RECORDS) {
  const { record } = input;
  const events: TimelineEvent[] = [];
  const warnings: string[] = [];
  const reported = new Set(record.wallets.filter(w => normalizeAttributionNetwork(w.network) === 'eip155:1').map(w => normalizeAttributionAddress(w.address)).filter((a): a is string => !!a));
  const add = (event: TimelineEvent) => events.push({ ...event, timestamp: reliableTime(event.timestamp) });
  add({ id: `case:${record.id}`, type: 'Case Created', category: 'Case evidence', timestamp: record.created_at, timestampMeaning: 'Case creation time', addresses: [], hashes: [], source: 'Private case record', description: `${record.case_code}: ${record.title}`, details: record });
  for (const wallet of record.wallets) add({ id: `wallet:${wallet.id}`, type: 'Investigation Evidence', category: 'Case evidence', timestamp: wallet.added_at, timestampMeaning: 'Wallet added to case', addresses: [wallet.address], hashes: [], network: wallet.network, source: 'Case wallet record', description: 'Wallet recorded in this case; this is not a blockchain activity timestamp or an ownership finding.', details: wallet });
  const reportIds = new Set(linkedReportIds(record));
  for (const report of input.reports || []) {
    if (!reportIds.has(report.id.toLowerCase())) continue;
    add({ id: `report:${report.id}`, type: 'Victim Report', category: 'Case evidence', timestamp: report.created_at, timestampMeaning: 'Report submission time, not incident time', addresses: [report.suspect_wallet], hashes: report.transaction_hash ? [report.transaction_hash] : [], network: report.network, source: 'Private victim report explicitly referenced in case description', description: `Victim-provided allegation: ${report.incident_type}. Reported incident date: ${report.incident_date}. Reported loss: ${report.approximate_loss} ${report.loss_currency}. Not independently verified by this report.`, details: report });
  }

  const transactions = new Map<string, { transaction: WalletTransaction; sources: Set<string>; observations: { address: string; retrievedAt: string; transaction: WalletTransaction }[] }>();
  const conflicts = new Set<string>();
  let excluded = 0;
  for (const wallet of input.wallets) {
    if (normalizeAttributionNetwork(wallet.network) !== 'eip155:1' || !reported.has(wallet.address.toLowerCase())) continue;
    for (const raw of wallet.transactions) {
      if (!/^0x[0-9a-f]{64}$/i.test(raw.hash)) { excluded++; continue; }
      const tx = { ...raw, hash: raw.hash.toLowerCase(), from: raw.from.toLowerCase(), to: raw.to?.toLowerCase() || null };
      const previous = transactions.get(tx.hash);
      if (previous) {
        const old = previous.transaction;
        if (old.from !== tx.from || old.to !== tx.to || old.value !== tx.value || old.status !== tx.status || old.blockNumber !== tx.blockNumber || (reliableTime(old.timestamp) && reliableTime(tx.timestamp) && Date.parse(old.timestamp!) !== Date.parse(tx.timestamp!))) conflicts.add(tx.hash);
        if (!reliableTime(old.timestamp) && reliableTime(tx.timestamp)) previous.transaction = tx;
        previous.sources.add(wallet.dataSource);
        previous.observations.push({ address: wallet.address, retrievedAt: wallet.verifiedAt, transaction: raw });
      } else transactions.set(tx.hash, { transaction: tx, sources: new Set([wallet.dataSource]), observations: [{ address: wallet.address, retrievedAt: wallet.verifiedAt, transaction: raw }] });
    }
  }
  const eligible: WalletTransaction[] = [];
  for (const [hash, evidence] of transactions) {
    const tx = evidence.transaction;
    if (conflicts.has(hash) || tx.status !== 'success' || !normalizeAttributionAddress(tx.from) || !tx.to || !normalizeAttributionAddress(tx.to) || !/^\d+$/.test(tx.value) || BigInt(tx.value) <= 0n || (!reported.has(tx.from) && !reported.has(tx.to))) { excluded++; continue; }
    eligible.push({ ...tx, timestamp: reliableTime(tx.timestamp) });
    const outgoing = reported.has(tx.from);
    add({ id: `tx:eip155:1:${hash}`, type: outgoing ? 'Observed Outgoing Transfer' : 'Observed Incoming Transfer', category: 'Transfers', timestamp: tx.timestamp, timestampMeaning: 'Blockchain transaction time', addresses: [tx.from, tx.to], hashes: [hash], valueWei: tx.value, network: 'Ethereum Mainnet', source: [...evidence.sources].join('; '), description: tx.from === tx.to ? 'Observed self-transfer; no net movement between distinct addresses.' : `Observed successful transfer ${outgoing ? 'from' : 'to'} a case wallet${outgoing && reported.has(tx.to) ? ' to another case wallet' : ''}.`, details: { transaction: tx, observations: evidence.observations } });
  }
  const evidenceFor = (rows: WalletTransaction[]) => rows.map(tx => ({ transaction: tx, observations: transactions.get(tx.hash)!.observations, sources: [...transactions.get(tx.hash)!.sources] }));
  const directPairs = new Map<string, WalletTransaction[]>();
  for (const tx of eligible) {
    if (!reported.has(tx.from) || !reported.has(tx.to!) || tx.from === tx.to) continue;
    const key = [tx.from, tx.to!].sort().join(':');
    directPairs.set(key, [...(directPairs.get(key) || []), tx]);
  }
  for (const [pair, rows] of directPairs) add({ id: `direct:${pair}`, type: 'Cross-Wallet Connection', category: 'Connections', timestamp: null, timestampMeaning: 'Relationship aggregate; see supporting transfer times', addresses: pair.split(':'), hashes: rows.map(tx => tx.hash), network: 'Ethereum Mainnet', source: 'Retrieved successful transfers between case wallets', description: `${rows.length} observed transfers connect these case wallets. This relationship summary is not additional transfer evidence or proof of common ownership.`, details: evidenceFor(rows) });
  for (const address of reported) {
    const rows = eligible.filter(tx => tx.from === address || tx.to === address);
    if (!rows.length) continue;
    const analysis = analyzeWalletTransactions(address, rows);
    const alarm = analysis.splittingAlarm;
    if (alarm) add({ id: `splitting:${address}`, type: 'Fund Splitting Signal', category: 'Signals', timestamp: alarm.end, timestampMeaning: 'End of observed splitting window', addresses: [address], hashes: alarm.transactionHashes, network: 'Ethereum Mainnet', valueWei: alarm.totalWei.toString(), source: 'Existing fund-splitting analysis over retrieved transaction evidence', description: `${alarm.transactionCount} outgoing transfers to ${alarm.destinationCount} destinations in the observed window. Investigative indicator only.`, details: { ...alarm, totalWei: alarm.totalWei.toString(), evidence: evidenceFor(rows.filter(tx => alarm.transactionHashes.includes(tx.hash))) } });
    add({ id: `fingerprint:${address}`, type: 'Investigation Evidence', category: 'Case evidence', timestamp: null, timestampMeaning: 'Aggregate over retrieved evidence; no single event time', addresses: [address], hashes: rows.map(tx => tx.hash), network: 'Ethereum Mainnet', source: 'Existing Money Fingerprint / wallet analysis', description: 'Observed wallet activity summary; not a finding of fraud.', details: { receivedWei: analysis.totalReceivedWei.toString(), sentWei: analysis.totalSentWei.toString(), counterparties: analysis.counterparties.length, frequency: analysis.frequency, risk: analysis.risk, evidence: evidenceFor(rows) } });
  }
  const destinations = new Set(eligible.filter(tx => reported.has(tx.from) && tx.from !== tx.to).map(tx => tx.to!));
  for (const address of destinations) {
    const rows = eligible.filter(tx => tx.to === address && reported.has(tx.from) && tx.from !== tx.to);
    if (rows.length > 1) add({ id: `repeated:${address}`, type: 'Repeated Destination Signal', category: 'Signals', timestamp: null, timestampMeaning: 'Aggregate over retrieved evidence; no single event time', addresses: [address, ...new Set(rows.map(tx => tx.from))], hashes: rows.map(tx => tx.hash), network: 'Ethereum Mainnet', source: 'Retrieved successful outgoing transfers', description: `${rows.length} distinct transfers to the same destination. This does not establish ownership or coordination.`, details: evidenceFor(rows) });
    const endpoint = lookupCustodialAttribution('Ethereum Mainnet', address, trustedRecords);
    if (endpoint.status === 'VERIFIED') add({ id: `custody:${address}`, type: 'Verified Custodial Endpoint', category: 'Custodial Attribution', timestamp: endpoint.record!.verifiedAt, timestampMeaning: 'Attribution record verification time, not fund arrival time', addresses: [address], hashes: rows.map(tx => tx.hash), network: 'Ethereum Mainnet', source: endpoint.record!.sourceName, description: endpoint.attribution, details: { endpoint, evidence: evidenceFor(rows) } });
  }
  const connections = input.connections;
  if (connections && connections.caseA.id === record.id && connections.caseB.id === record.id) {
    for (const connection of connections.sharedCounterparties) {
      const addresses = [...new Set([...connection.caseAWallets, ...connection.caseBWallets].map(a => a.toLowerCase()))];
      if (addresses.length < 2 || !addresses.every(a => reported.has(a)) || !connection.caseATransactions.length || !connection.caseBTransactions.length) continue;
      add({ id: `connection:${connection.address}`, type: 'Cross-Wallet Connection', category: 'Connections', timestamp: null, timestampMeaning: 'Relationship aggregate; analysis generation time is not a transfer time', addresses: [connection.address, ...addresses], hashes: [...new Set([...connection.caseATransactions, ...connection.caseBTransactions].map(tx => tx.hash.toLowerCase()))], network: 'Ethereum Mainnet', source: connections.source, description: 'Multiple case wallets have an observed shared counterparty. No ownership or coordination conclusion.', details: { connection, analysisGeneratedAt: connections.generatedAt, limitations: connections.limitations } });
    }
    warnings.push(...connections.limitations);
  }
  if (excluded) warnings.push(`${excluded} transaction records excluded: conflicting evidence, failed or unknown execution status, invalid or missing fields, zero value, or unrelated activity. ${conflicts.size} conflicting transaction hashes.`);
  const addresses = [...new Set(eligible.flatMap(tx => [tx.from, tx.to!]))];
  return { events, warnings, transferCount: eligible.length, attributions: addresses.map(address => lookupCustodialAttribution('Ethereum Mainnet', address, trustedRecords)) };
}
