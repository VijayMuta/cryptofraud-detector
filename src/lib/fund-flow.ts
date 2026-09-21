import { analyzeWalletTransactions, type WalletTransaction } from '@/lib/wallet-analysis';
import { lookupCustodialAttribution, normalizeAttributionAddress, normalizeAttributionNetwork, TRUSTED_CUSTODIAL_RECORDS, type CustodialAttributionRecord } from '@/lib/custodial-attribution';
import type { WalletEvidence } from '@/lib/freeze-hold';

export type FlowFilters = { direction: 'all' | 'incoming' | 'outgoing'; minWei: bigint; limit: number; repeatedOnly: boolean; splittingOnly: boolean };
export const DEFAULT_FLOW_FILTERS: FlowFilters = { direction: 'all', minWei: 0n, limit: 40, repeatedOnly: false, splittingOnly: false };
export const MAX_FLOW_NODES = 24;
export const MAX_FLOW_TRANSACTIONS = 100;
export function parseMinimumEth(value: string): bigint | null {
  if (!/^\d+(\.\d{0,18})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
}

export function buildFundFlow(reportedWallets: string[], wallets: WalletEvidence[], filters: FlowFilters = DEFAULT_FLOW_FILTERS, trustedRecords: readonly CustodialAttributionRecord[] = TRUSTED_CUSTODIAL_RECORDS) {
  const reported = new Set(reportedWallets.map(normalizeAttributionAddress).filter((address): address is string => !!address));
  const byHash = new Map<string, WalletTransaction>();
  const conflicts = new Set<string>();
  let invalid = 0;
  for (const wallet of wallets) {
    if (normalizeAttributionNetwork(wallet.network) !== 'eip155:1' || !reported.has(wallet.address.toLowerCase())) continue;
    for (const raw of wallet.transactions) {
      if (!/^0x[0-9a-f]{64}$/i.test(raw.hash)) { invalid++; continue; }
      const tx = { ...raw, hash: raw.hash.toLowerCase(), from: raw.from.toLowerCase(), to: raw.to?.toLowerCase() || null };
      const old = byHash.get(tx.hash);
      if (old && (old.from !== tx.from || old.to !== tx.to || old.value !== tx.value || old.status !== tx.status || old.timestamp !== tx.timestamp)) conflicts.add(tx.hash);
      else byHash.set(tx.hash, tx);
    }
  }
  const eligible = [...byHash.values()].filter(tx => !conflicts.has(tx.hash) && tx.status === 'success' && normalizeAttributionAddress(tx.from) && tx.to && normalizeAttributionAddress(tx.to) && /^\d+$/.test(tx.value) && BigInt(tx.value) > 0n && (reported.has(tx.from) || reported.has(tx.to!)))
    .sort((a, b) => (Date.parse(b.timestamp || '') || 0) - (Date.parse(a.timestamp || '') || 0) || a.hash.localeCompare(b.hash));
  const analyses = new Map([...reported].filter(address => wallets.some(wallet => wallet.address.toLowerCase() === address && normalizeAttributionNetwork(wallet.network) === 'eip155:1')).map(address => [address, analyzeWalletTransactions(address, [...byHash.values()].filter(tx => !conflicts.has(tx.hash) && (tx.from === address || tx.to === address)))]));
  const splittingHashes = new Set([...analyses.values()].flatMap(analysis => analysis.splittingAlarm?.transactionHashes || []));
  const destinationCounts = new Map<string, number>();
  for (const tx of eligible) if (reported.has(tx.from)) destinationCounts.set(tx.to!, (destinationCounts.get(tx.to!) || 0) + 1);
  const filtered = eligible.filter(tx => (filters.direction === 'all' || (filters.direction === 'incoming' ? reported.has(tx.to!) : reported.has(tx.from))) && BigInt(tx.value) >= filters.minWei && (!filters.repeatedOnly || (destinationCounts.get(tx.to!) || 0) > 1) && (!filters.splittingOnly || splittingHashes.has(tx.hash)));
  const selected: WalletTransaction[] = [];
  const addresses = new Set<string>();
  const limit = Math.min(MAX_FLOW_TRANSACTIONS, Math.max(1, Number.isFinite(filters.limit) ? Math.floor(filters.limit) : 40));
  for (const tx of filtered) {
    if (selected.length >= limit) break;
    const newAddresses = new Set([tx.from, tx.to!].filter(address => !addresses.has(address)));
    if (addresses.size + newAddresses.size > MAX_FLOW_NODES) continue;
    addresses.add(tx.from); addresses.add(tx.to!); selected.push(tx);
  }
  const groups = new Map<string, { id: string; from: string; to: string; transactions: WalletTransaction[]; totalWei: bigint; splitting: boolean }>();
  for (const tx of selected) {
    const id = tx.from + ':' + tx.to;
    const edge = groups.get(id) || { id, from: tx.from, to: tx.to!, transactions: [], totalWei: 0n, splitting: false };
    edge.transactions.push(tx); edge.totalWei += BigInt(tx.value); edge.splitting ||= splittingHashes.has(tx.hash); groups.set(id, edge);
  }
  const nodes = [...addresses].map(address => {
    const incoming = eligible.filter(tx => tx.to === address), outgoing = eligible.filter(tx => tx.from === address);
    const times = [...incoming, ...outgoing].map(tx => tx.timestamp).filter((at): at is string => !!at && Number.isFinite(Date.parse(at))).sort((a, b) => Date.parse(a) - Date.parse(b));
    return { address, reported: reported.has(address), incomingCount: incoming.length, outgoingCount: outgoing.length, incomingWei: incoming.reduce((sum, tx) => sum + BigInt(tx.value), 0n), outgoingWei: outgoing.reduce((sum, tx) => sum + BigInt(tx.value), 0n), first: times[0] || null, latest: times[times.length - 1] || null, repeated: (destinationCounts.get(address) || 0) > 1, analysis: analyses.get(address) || null, attribution: lookupCustodialAttribution('Ethereum Mainnet', address, trustedRecords), connectedCaseWallets: [...new Set([...incoming, ...outgoing].flatMap(tx => [tx.from, tx.to!]).filter(other => reported.has(other) && other !== address))] };
  });
  const shownDestinations = new Map<string, number>();
  for (const tx of selected) if (reported.has(tx.from)) shownDestinations.set(tx.to!, (shownDestinations.get(tx.to!) || 0) + 1);
  return { nodes, edges: [...groups.values()], retrieved: byHash.size, eligible: eligible.length, matching: filtered.length, displayed: selected.length, excluded: byHash.size - eligible.length + invalid, conflicts: conflicts.size, totalWei: selected.reduce((sum, tx) => sum + BigInt(tx.value), 0n), counterparties: nodes.filter(node => !node.reported).length, repeatedDestinations: [...shownDestinations.values()].filter(count => count > 1).length, splittingSignals: nodes.filter(node => node.analysis?.splittingAlarm).length, verifiedEndpoints: nodes.filter(node => node.attribution.status === 'VERIFIED').length };
}
export type FundFlowGraph = ReturnType<typeof buildFundFlow>;
