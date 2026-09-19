export type WalletTransaction = {
  hash: string;
  timestamp: string | null;
  from: string;
  to: string | null;
  value: string;
  blockNumber: string;
  status: 'success' | 'failed' | 'unknown';
};

export type TransactionDirection = 'incoming' | 'outgoing' | 'self' | 'unclassified';

export type AnalyzedTransaction = WalletTransaction & {
  direction: TransactionDirection;
  valueWei: bigint;
  timestampMs: number | null;
};

export type Counterparty = {
  address: string;
  incomingCount: number;
  outgoingCount: number;
  incomingWei: bigint;
  outgoingWei: bigint;
};

export type FundSplittingAlarm = {
  start: string;
  end: string;
  transactionCount: number;
  destinationCount: number;
  totalWei: bigint;
  transactionHashes: string[];
};

export type RiskAssessment = {
  score: number | null;
  level: 'No signal observed' | 'Low' | 'Moderate' | 'Elevated' | 'Insufficient data';
  signals: string[];
};

export type WalletAnalysis = {
  transactionCount: number;
  successfulTransactionCount: number;
  failedTransactionCount: number;
  incomingTransactions: AnalyzedTransaction[];
  outgoingTransactions: AnalyzedTransaction[];
  counterparties: Counterparty[];
  totalReceivedWei: bigint;
  totalSentWei: bigint;
  netFlowWei: bigint;
  averageTransactionWei: bigint | null;
  largestTransaction: AnalyzedTransaction | null;
  frequency: {
    timestampedTransactionCount: number;
    windowMs: number | null;
    transactionsPerDay: number | null;
  };
  splittingAlarm: FundSplittingAlarm | null;
  risk: RiskAssessment;
};

const ZERO_WEI = BigInt('0');
const DAY_MS = 24 * 60 * 60 * 1_000;
const SPLITTING_WINDOW_MS = DAY_MS;
const SPLITTING_DESTINATION_THRESHOLD = 3;

function safeWei(value: string) {
  if (!/^\d+$/.test(value)) return ZERO_WEI;
  return BigInt(value);
}

function timestampMs(timestamp: string | null) {
  if (!timestamp) return null;
  const value = Date.parse(timestamp);
  return Number.isNaN(value) ? null : value;
}

function directionFor(transaction: WalletTransaction, address: string): TransactionDirection {
  const normalizedAddress = address.toLowerCase();
  const from = transaction.from.toLowerCase();
  const to = transaction.to?.toLowerCase();

  if (from === normalizedAddress && to === normalizedAddress) return 'self';
  if (from === normalizedAddress) return 'outgoing';
  if (to === normalizedAddress) return 'incoming';
  return 'unclassified';
}

function addCounterparty(
  counterparties: Map<string, Counterparty>,
  address: string | null,
  direction: 'incoming' | 'outgoing',
  valueWei: bigint,
) {
  if (!address) return;

  const key = address.toLowerCase();
  const current = counterparties.get(key) || {
    address,
    incomingCount: 0,
    outgoingCount: 0,
    incomingWei: ZERO_WEI,
    outgoingWei: ZERO_WEI,
  };

  if (direction === 'incoming') {
    current.incomingCount += 1;
    current.incomingWei += valueWei;
  } else {
    current.outgoingCount += 1;
    current.outgoingWei += valueWei;
  }

  counterparties.set(key, current);
}

function findFundSplittingAlarm(outgoingTransactions: AnalyzedTransaction[]) {
  const transfers = outgoingTransactions
    .filter(
      (transaction) =>
        transaction.to && transaction.valueWei > ZERO_WEI && transaction.timestampMs !== null,
    )
    .sort((left, right) => (left.timestampMs || 0) - (right.timestampMs || 0));

  let strongestMatch: FundSplittingAlarm | null = null;

  for (let startIndex = 0; startIndex < transfers.length; startIndex += 1) {
    const start = transfers[startIndex];
    const destinations = new Set<string>();
    const transactionHashes: string[] = [];
    let transactionCount = 0;
    let totalWei = ZERO_WEI;

    for (let endIndex = startIndex; endIndex < transfers.length; endIndex += 1) {
      const candidate = transfers[endIndex];
      if ((candidate.timestampMs || 0) - (start.timestampMs || 0) > SPLITTING_WINDOW_MS) break;

      destinations.add((candidate.to || '').toLowerCase());
      transactionHashes.push(candidate.hash);
      transactionCount += 1;
      totalWei += candidate.valueWei;

      if (destinations.size < SPLITTING_DESTINATION_THRESHOLD) continue;

      const match = {
        start: start.timestamp || '',
        end: candidate.timestamp || '',
        transactionCount,
        destinationCount: destinations.size,
        totalWei,
        transactionHashes: transactionHashes.slice(),
      };

      if (
        !strongestMatch ||
        match.destinationCount > strongestMatch.destinationCount ||
        (match.destinationCount === strongestMatch.destinationCount &&
          match.transactionCount > strongestMatch.transactionCount)
      ) {
        strongestMatch = match;
      }
    }
  }

  return strongestMatch;
}

function calculateFrequency(transactions: AnalyzedTransaction[]) {
  const timestamps = transactions
    .map((transaction) => transaction.timestampMs)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);

  if (timestamps.length < 2) {
    return {
      timestampedTransactionCount: timestamps.length,
      windowMs: null,
      transactionsPerDay: null,
    };
  }

  const windowMs = timestamps[timestamps.length - 1] - timestamps[0];
  if (windowMs <= 0) {
    return {
      timestampedTransactionCount: timestamps.length,
      windowMs: 0,
      transactionsPerDay: null,
    };
  }

  return {
    timestampedTransactionCount: timestamps.length,
    windowMs,
    transactionsPerDay: timestamps.length / (windowMs / DAY_MS),
  };
}

function calculateRisk({
  transactionCount,
  successfulTransactionCount,
  failedTransactionCount,
  outgoingTransactions,
  counterparties,
  frequency,
  splittingAlarm,
}: Pick<
  WalletAnalysis,
  | 'transactionCount'
  | 'successfulTransactionCount'
  | 'failedTransactionCount'
  | 'outgoingTransactions'
  | 'counterparties'
  | 'frequency'
  | 'splittingAlarm'
>): RiskAssessment {
  if (successfulTransactionCount === 0) {
    return {
      score: null,
      level: 'Insufficient data',
      signals: ['No successful transactions are available in the retrieved history for behavioral analysis.'],
    };
  }

  let score = 0;
  const signals: string[] = [];
  const outboundCounterparties = counterparties.filter((counterparty) => counterparty.outgoingCount > 0);

  if (splittingAlarm) {
    score += 40;
    signals.push(
      `${splittingAlarm.destinationCount} distinct recipient addresses received funds within a 24-hour period.`,
    );
  }

  if (outboundCounterparties.length >= 10) {
    score += 15;
    signals.push(`${outboundCounterparties.length} distinct recipient addresses appear in the retrieved outgoing history.`);
  }

  if (
    frequency.transactionsPerDay !== null &&
    frequency.transactionsPerDay >= 20 &&
    successfulTransactionCount >= 10
  ) {
    score += 10;
    signals.push(`The retrieved successful transactions average ${frequency.transactionsPerDay.toFixed(1)} per day.`);
  }

  if (
    transactionCount >= 4 &&
    failedTransactionCount >= 4 &&
    failedTransactionCount / transactionCount >= 0.25
  ) {
    score += 10;
    signals.push(`${failedTransactionCount} of ${transactionCount} retrieved transactions are marked failed on-chain.`);
  }

  if (signals.length === 0) {
    return {
      score: 0,
      level: 'No signal observed',
      signals: ['No configured elevated-risk patterns were observed in this retrieved transaction set.'],
    };
  }

  const level = score >= 40 ? 'Elevated' : score >= 20 ? 'Moderate' : 'Low';
  return { score, level, signals };
}

export function analyzeWalletTransactions(
  address: string,
  transactions?: WalletTransaction[] | null,
): WalletAnalysis {
  // This function is also used by API consumers, so retain a runtime guard in
  // addition to the nullable TypeScript signature.
  const sourceTransactions = Array.isArray(transactions) ? transactions : [];
  const completedTransactions = sourceTransactions.filter((transaction) => transaction.status === 'success');
  const analyzedTransactions = completedTransactions.map((transaction) => ({
    ...transaction,
    direction: directionFor(transaction, address),
    valueWei: safeWei(transaction.value),
    timestampMs: timestampMs(transaction.timestamp),
  }));
  const incomingTransactions = analyzedTransactions.filter(
    (transaction) => transaction.direction === 'incoming',
  );
  const outgoingTransactions = analyzedTransactions.filter(
    (transaction) => transaction.direction === 'outgoing',
  );
  const counterpartiesByAddress = new Map<string, Counterparty>();

  for (const transaction of incomingTransactions) {
    addCounterparty(counterpartiesByAddress, transaction.from, 'incoming', transaction.valueWei);
  }

  for (const transaction of outgoingTransactions) {
    addCounterparty(counterpartiesByAddress, transaction.to, 'outgoing', transaction.valueWei);
  }

  const counterparties: Counterparty[] = [];
  counterpartiesByAddress.forEach((counterparty) => counterparties.push(counterparty));
  counterparties.sort((left, right) => {
    const countDifference =
      right.incomingCount + right.outgoingCount - (left.incomingCount + left.outgoingCount);
    if (countDifference !== 0) return countDifference;

    const valueDifference = right.incomingWei + right.outgoingWei - (left.incomingWei + left.outgoingWei);
    return valueDifference > ZERO_WEI ? 1 : valueDifference < ZERO_WEI ? -1 : 0;
  });

  const totalReceivedWei = incomingTransactions.reduce(
    (total, transaction) => total + transaction.valueWei,
    ZERO_WEI,
  );
  const totalSentWei = outgoingTransactions.reduce(
    (total, transaction) => total + transaction.valueWei,
    ZERO_WEI,
  );
  const totalTransactionWei = analyzedTransactions.reduce(
    (total, transaction) => total + transaction.valueWei,
    ZERO_WEI,
  );
  const largestTransaction = analyzedTransactions.reduce<AnalyzedTransaction | null>(
    (largest, transaction) => (!largest || transaction.valueWei > largest.valueWei ? transaction : largest),
    null,
  );
  const frequency = calculateFrequency(analyzedTransactions);
  const splittingAlarm = findFundSplittingAlarm(outgoingTransactions);

  const baseAnalysis = {
    transactionCount: sourceTransactions.length,
    successfulTransactionCount: completedTransactions.length,
    failedTransactionCount: sourceTransactions.filter((transaction) => transaction.status === 'failed').length,
    incomingTransactions,
    outgoingTransactions,
    counterparties,
    totalReceivedWei,
    totalSentWei,
    netFlowWei: totalReceivedWei - totalSentWei,
    averageTransactionWei:
      completedTransactions.length > 0 ? totalTransactionWei / BigInt(completedTransactions.length) : null,
    largestTransaction,
    frequency,
    splittingAlarm,
  };

  return {
    ...baseAnalysis,
    risk: calculateRisk(baseAnalysis),
  };
}

export function formatEth(valueWei: bigint | null) {
  if (valueWei === null) return 'Unavailable';

  const sign = valueWei < ZERO_WEI ? '-' : '';
  const absoluteValue = valueWei < ZERO_WEI ? -valueWei : valueWei;
  const base = BigInt('1000000000000000000');
  const whole = absoluteValue / base;
  const remainder = absoluteValue % base;
  const fraction = remainder.toString().padStart(18, '0').slice(0, 6).replace(/0+$/, '');

  if (!fraction && remainder > ZERO_WEI) return `${sign}<0.000001 ETH`;
  return `${sign}${whole}${fraction ? `.${fraction}` : ''} ETH`;
}
