import { CASE_HISTORY_SOURCE, fetchCaseTransactionHistory } from '@/lib/case-history';
import { analyzeWalletTransactions, formatEth, type WalletTransaction } from '@/lib/wallet-analysis';
import { MAX_WALLETS_PER_CASE } from '@/lib/case-constants';

const TEMPORAL_WINDOW_MS = 24 * 60 * 60 * 1_000;
const MAX_TEMPORAL_EVIDENCE = 50;
const FETCH_CONCURRENCY = 1;
const CASE_TRANSACTION_PAGE_SIZE = 1_000;
const CASE_TRANSACTION_PAGE_LIMIT = 5;

export type CaseAnalysisInput = {
  id: string;
  caseCode: string;
  title: string;
  wallets: string[];
};

export type TransactionEvidence = {
  hash: string;
  timestamp: string | null;
  observedBy: string;
  from: string;
  to: string | null;
  valueEth: string;
};

type RelationRecord = {
  wallets: Set<string>;
  transactions: Map<string, TransactionEvidence>;
};

type WalletHistory = {
  address: string;
  transactions: WalletTransaction[];
};

export type AddressConnectionEvidence = {
  address: string;
  caseAWallets: string[];
  caseBWallets: string[];
  caseATransactions: TransactionEvidence[];
  caseBTransactions: TransactionEvidence[];
};

export type DirectTransferEvidence = TransactionEvidence & {
  fromCase: 'A' | 'B';
  toCase: 'A' | 'B';
};

export type TemporalEvidence = {
  counterparty: string;
  caseATransaction: TransactionEvidence;
  caseBTransaction: TransactionEvidence;
  differenceMinutes: number;
};

export type WalletActivity = {
  address: string;
  transactionCount: number;
  successfulTransactionCount: number;
  riskLevel: string;
  riskSignals: string[];
  latestTransactions: TransactionEvidence[];
};

export type CaseConnectionAnalysis = {
  source: typeof CASE_HISTORY_SOURCE | 'Live Alchemy normal Ethereum transfers' | 'Live Etherscan normal Ethereum transactions';
  generatedAt: string;
  caseA: { id: string; caseCode: string; title: string; walletCount: number };
  caseB: { id: string; caseCode: string; title: string; walletCount: number };
  walletActivity: WalletActivity[];
  sharedWallets: string[];
  sharedCounterparties: AddressConnectionEvidence[];
  sharedDestinations: AddressConnectionEvidence[];
  sharedSources: AddressConnectionEvidence[];
  directTransfers: DirectTransferEvidence[];
  temporalRelationships: TemporalEvidence[];
  connectionScore: {
    value: number;
    definition: string;
    components: Array<{ label: string; count: number }>;
  };
  riskSignals: string[];
  limitations: string[];
};

function normalized(value: string) {
  return value.trim().toLowerCase();
}

function toEvidence(transaction: WalletTransaction, observedBy: string): TransactionEvidence {
  return {
    hash: transaction.hash.toLowerCase(),
    timestamp: transaction.timestamp,
    observedBy,
    from: normalized(transaction.from),
    to: transaction.to ? normalized(transaction.to) : null,
    valueEth: /^\d+$/.test(transaction.value) ? formatEth(BigInt(transaction.value)) : 'Unavailable',
  };
}

function recordRelation(
  relations: Map<string, RelationRecord>,
  relatedAddress: string | null,
  wallet: string,
  transaction: WalletTransaction,
) {
  if (!relatedAddress) return;
  const address = normalized(relatedAddress);
  const record = relations.get(address) || { wallets: new Set<string>(), transactions: new Map<string, TransactionEvidence>() };
  record.wallets.add(normalized(wallet));
  record.transactions.set(`${normalized(wallet)}:${transaction.hash.toLowerCase()}`, toEvidence(transaction, normalized(wallet)));
  relations.set(address, record);
}

function relationshipMaps(histories: WalletHistory[]) {
  const counterparties = new Map<string, RelationRecord>();
  const destinations = new Map<string, RelationRecord>();
  const sources = new Map<string, RelationRecord>();

  for (const history of histories) {
    const wallet = normalized(history.address);
    for (const transaction of history.transactions) {
      if (transaction.status !== 'success') continue;
      const from = normalized(transaction.from);
      const to = transaction.to ? normalized(transaction.to) : null;

      if (from === wallet && to && to !== wallet) {
        recordRelation(counterparties, to, wallet, transaction);
        recordRelation(destinations, to, wallet, transaction);
      }
      if (to === wallet && from !== wallet) {
        recordRelation(counterparties, from, wallet, transaction);
        recordRelation(sources, from, wallet, transaction);
      }
    }
  }

  return { counterparties, destinations, sources };
}

function asEvidence(
  address: string,
  left: RelationRecord,
  right: RelationRecord,
  evidenceLimit: number,
): AddressConnectionEvidence {
  const sample = (record: RelationRecord) => {
    const groups = new Map<string, TransactionEvidence[]>();
    for (const transaction of record.transactions.values()) {
      const group = groups.get(transaction.observedBy) || [];
      group.push(transaction);
      groups.set(transaction.observedBy, group);
    }
    const rows: TransactionEvidence[] = [];
    // A busy first wallet must not consume the entire display sample and hide
    // every transaction from the other wallets involved in the relationship.
    for (let index = 0; rows.length < evidenceLimit; index++) {
      let added = false;
      for (const group of groups.values()) {
        if (group[index] && rows.length < evidenceLimit) { rows.push(group[index]); added = true; }
      }
      if (!added) break;
    }
    return rows;
  };
  return {
    address,
    caseAWallets: Array.from(left.wallets).sort(),
    caseBWallets: Array.from(right.wallets).sort(),
    caseATransactions: sample(left),
    caseBTransactions: sample(right),
  };
}

function intersectRelations(
  left: Map<string, RelationRecord>,
  right: Map<string, RelationRecord>,
  sameCase: boolean,
  evidenceLimit = 12,
) {
  const connections: AddressConnectionEvidence[] = [];

  for (const [address, leftRecord] of Array.from(left.entries())) {
    const rightRecord = right.get(address);
    if (!rightRecord) continue;
    const involvedWallets = new Set<string>(
      Array.from(leftRecord.wallets).concat(Array.from(rightRecord.wallets)),
    );
    if (sameCase && involvedWallets.size < 2) continue;
    connections.push(asEvidence(address, leftRecord, rightRecord, evidenceLimit));
  }

  return connections.sort((a, b) => a.address.localeCompare(b.address));
}

function directTransfers(
  left: WalletHistory[],
  right: WalletHistory[],
  sameCase: boolean,
) {
  const leftWallets = new Set(left.map((history) => normalized(history.address)));
  const rightWallets = new Set(right.map((history) => normalized(history.address)));
  const transfers: DirectTransferEvidence[] = [];
  const seen = new Set<string>();

  // The provider returns a normal transfer in both participating wallets'
  // histories. Inspect the combined evidence and classify it by the actual
  // normalized sender and receiver, so a transfer is not missed merely
  // because it was retrieved under the receiving wallet rather than the
  // sending wallet.
  const availableHistories = sameCase ? left : left.concat(right);
  const collect = (
    senderWallets: Set<string>,
    fromCase: 'A' | 'B',
    recipientWallets: Set<string>,
    toCase: 'A' | 'B',
  ) => {
    for (const history of availableHistories) {
      for (const transaction of history.transactions) {
        const sender = normalized(transaction.from);
        const recipient = transaction.to ? normalized(transaction.to) : null;
        if (
          transaction.status !== 'success'
          || !senderWallets.has(sender)
          || !recipient
          || !recipientWallets.has(recipient)
          || (sameCase && sender === recipient)
        ) continue;
        const hash = transaction.hash.toLowerCase();
        if (seen.has(hash)) continue;
        seen.add(hash);
        transfers.push({ ...toEvidence(transaction, sender), fromCase, toCase });
      }
    }
  };

  collect(leftWallets, 'A', rightWallets, 'B');
  if (!sameCase) collect(rightWallets, 'B', leftWallets, 'A');
  return transfers;
}

function timestampValue(value: string | null) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function temporalRelationships(
  sharedCounterparties: AddressConnectionEvidence[],
  sameCase: boolean,
) {
  const relationships: TemporalEvidence[] = [];
  const seen = new Set<string>();

  for (const connection of sharedCounterparties) {
    const dated = (transactions: TransactionEvidence[]) => transactions
      .map(transaction => ({ transaction, time: timestampValue(transaction.timestamp) }))
      .filter((item): item is { transaction: TransactionEvidence; time: number } => item.time !== null)
      .sort((left, right) => left.time - right.time);
    const leftTransactions = dated(connection.caseATransactions);
    const rightTransactions = dated(connection.caseBTransactions);
    let start = 0;
    for (const { transaction: left, time: leftTime } of leftTransactions) {
      while (start < rightTransactions.length && rightTransactions[start].time < leftTime - TEMPORAL_WINDOW_MS) start++;
      for (let index = start; index < rightTransactions.length && rightTransactions[index].time <= leftTime + TEMPORAL_WINDOW_MS; index++) {
        const { transaction: right, time: rightTime } = rightTransactions[index];
        if (sameCase && left.observedBy === right.observedBy) continue;
        const difference = Math.abs(leftTime - rightTime);
        if (difference > TEMPORAL_WINDOW_MS || left.hash === right.hash) continue;
        const key = `${connection.address}:${[left.hash, right.hash].sort().join(':')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        relationships.push({
          counterparty: connection.address,
          caseATransaction: left,
          caseBTransaction: right,
          differenceMinutes: Math.round(difference / 60_000),
        });
        if (relationships.length >= MAX_TEMPORAL_EVIDENCE) return relationships;
      }
    }
  }

  return relationships;
}

function walletActivity(histories: WalletHistory[]) {
  return histories.map((history) => {
    const analysis = analyzeWalletTransactions(history.address, history.transactions);
    return {
      address: normalized(history.address),
      transactionCount: analysis.transactionCount,
      successfulTransactionCount: analysis.successfulTransactionCount,
      riskLevel: analysis.risk.level,
      riskSignals: analysis.risk.signals,
      latestTransactions: history.transactions.slice(0, 5).map((transaction) => toEvidence(transaction, normalized(history.address))),
    };
  });
}

async function fetchCaseTransactions(address: string) {
  // Pages are consecutive and descending: this avoids the previous gap between
  // a small newest window and a separate oldest-first historical window.
  return fetchCaseTransactionHistory(address, {
    pageSize: CASE_TRANSACTION_PAGE_SIZE,
    maxPages: CASE_TRANSACTION_PAGE_LIMIT,
  });
}

async function fetchHistories(wallets: string[]) {
  const distinctWallets = Array.from(new Set(wallets.map(normalized)));
  if (distinctWallets.length > MAX_WALLETS_PER_CASE) {
    throw new Error(`A case can be analyzed with up to ${MAX_WALLETS_PER_CASE} wallets at one time.`);
  }

  const histories: WalletHistory[] = [];
  for (let index = 0; index < distinctWallets.length; index += FETCH_CONCURRENCY) {
    const batch = distinctWallets.slice(index, index + FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (address) => ({ address, transactions: await fetchCaseTransactions(address) })),
    );
    histories.push(...results);
  }
  return histories;
}

function riskSignals(
  sharedWallets: string[],
  sharedCounterparties: AddressConnectionEvidence[],
  sharedDestinations: AddressConnectionEvidence[],
  sharedSources: AddressConnectionEvidence[],
  direct: DirectTransferEvidence[],
  temporal: TemporalEvidence[],
) {
  const signals: string[] = [];
  if (sharedWallets.length) signals.push(`${sharedWallets.length} suspect wallet address${sharedWallets.length === 1 ? ' is' : 'es are'} present in both cases.`);
  if (direct.length) signals.push(`${direct.length} observed successful transfer${direct.length === 1 ? '' : 's'} moved directly between suspect wallets.`);
  if (sharedDestinations.length) signals.push(`${sharedDestinations.length} destination address${sharedDestinations.length === 1 ? ' is' : 'es are'} used by suspect wallets in both case histories.`);
  if (sharedSources.length) signals.push(`${sharedSources.length} source address${sharedSources.length === 1 ? ' is' : 'es are'} sent funds to suspect wallets in both case histories.`);
  if (sharedCounterparties.length) signals.push(`${sharedCounterparties.length} observable counterparty address${sharedCounterparties.length === 1 ? ' overlaps' : 'es overlap'} across the retrieved histories.`);
  if (temporal.length) signals.push(`${temporal.length} displayed transaction pair${temporal.length === 1 ? '' : 's'} involving a shared counterparty occurred within 24 hours.`);
  if (!signals.length) signals.push('No configured observable cross-wallet connection was found in the retrieved normal Ethereum transaction histories.');
  return signals;
}

export async function analyzeCaseConnection(
  caseA: CaseAnalysisInput,
  caseB: CaseAnalysisInput,
  options: { sameCase?: boolean } = {},
): Promise<CaseConnectionAnalysis> {
  const sameCase = options.sameCase === true;
  // Fetch cases sequentially so provider requests stay bounded even when a
  // comparison includes the maximum number of wallets on both sides.
  const caseAHistories = await fetchHistories(caseA.wallets);
  const caseBHistories = sameCase ? [] as WalletHistory[] : await fetchHistories(caseB.wallets);
  const rightHistories = sameCase ? caseAHistories : caseBHistories;
  const leftMaps = relationshipMaps(caseAHistories);
  const rightMaps = sameCase ? leftMaps : relationshipMaps(rightHistories);
  const sharedWallets = sameCase
    ? []
    : caseA.wallets.map(normalized).filter((address) => new Set(caseB.wallets.map(normalized)).has(address));
  const sharedCounterparties = intersectRelations(leftMaps.counterparties, rightMaps.counterparties, sameCase);
  const sharedDestinations = intersectRelations(leftMaps.destinations, rightMaps.destinations, sameCase);
  const sharedSources = intersectRelations(leftMaps.sources, rightMaps.sources, sameCase);
  const direct = directTransfers(caseAHistories, rightHistories, sameCase);
  // Display samples are capped, but detection must inspect the retrieved evidence.
  const temporal = temporalRelationships(intersectRelations(leftMaps.counterparties, rightMaps.counterparties, sameCase, Infinity), sameCase);
  const components = [
    { label: 'Shared suspect wallets', count: sharedWallets.length },
    { label: 'Shared counterparties', count: sharedCounterparties.length },
    { label: 'Shared destinations', count: sharedDestinations.length },
    { label: 'Shared sources', count: sharedSources.length },
    { label: 'Direct suspect-wallet transfers', count: direct.length },
    { label: 'Time-proximate transaction pairs', count: temporal.length },
  ];
  const histories = sameCase ? caseAHistories : caseAHistories.concat(caseBHistories);
  const unverifiedCount = histories.reduce((count, history) => count + history.transactions.filter(transaction => transaction.status === 'unknown').length, 0);
  const coverageWarning = unverifiedCount > 0
    ? `Incomplete execution-status verification: ${unverifiedCount} retrieved transfers could not be matched to consistent indexed execution-status evidence. The status provider may be unavailable or its retrieved history may not cover these transfers. These transfers are excluded from relationship evidence. Connection counts are incomplete; a zero count does not establish that no connection exists.`
    : null;
  const observedSignals = riskSignals(sharedWallets, sharedCounterparties, sharedDestinations, sharedSources, direct, temporal);
  // Keep the evidence algorithms unchanged, but do not present an incomplete
  // provider response as a verified absence of connections.
  const displayedSignals = coverageWarning
    ? [coverageWarning, ...observedSignals.filter(signal => !signal.startsWith('No configured observable'))]
    : observedSignals;

  return {
    source: CASE_HISTORY_SOURCE,
    generatedAt: new Date().toISOString(),
    caseA: { id: caseA.id, caseCode: caseA.caseCode, title: caseA.title, walletCount: caseA.wallets.length },
    caseB: { id: caseB.id, caseCode: caseB.caseCode, title: caseB.title, walletCount: caseB.wallets.length },
    walletActivity: walletActivity(caseAHistories).concat(sameCase ? [] : walletActivity(caseBHistories)),
    sharedWallets,
    sharedCounterparties,
    sharedDestinations,
    sharedSources,
    directTransfers: direct,
    temporalRelationships: temporal,
    connectionScore: {
      value: components.reduce((total, component) => total + component.count, 0),
      definition: 'A transparent, unweighted count of the observable relationship categories and transaction pairs shown below. It is not a probability, identity score, or finding of fraud.',
      components,
    },
    riskSignals: displayedSignals,
    limitations: [
      ...(coverageWarning ? [coverageWarning] : []),
      'This analysis uses only retrieved normal Ethereum transactions; token transfers, internal transfers, labels, and off-chain activity are excluded.',
      `For each wallet, analysis retrieves up to ${CASE_TRANSACTION_PAGE_SIZE * CASE_TRANSACTION_PAGE_LIMIT} most-recent external ETH transfers through consecutive Alchemy pages in both directions, deduplicated by transaction hash. Execution status comes from the existing Etherscan normal-transaction index, matched by hash and transfer facts. Only confirmed successful transfers contribute to relationship evidence; no per-transaction receipt RPCs are issued.`,
      'Coverage is limited to the external transfers returned by Alchemy, not every attempted Ethereum transaction. Missing activity is not evidence that no relationship exists.',
      'A shared counterparty or timing relationship is an analytical connection signal, not proof of common ownership or coordinated fraud.',
      `Time proximity means two displayed transactions involving the same counterparty occurred within ${TEMPORAL_WINDOW_MS / 3_600_000} hours.`,
    ],
  };
}
