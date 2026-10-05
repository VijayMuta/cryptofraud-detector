import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchEthereumTransactions, fetchMonitoringHeadBlock, fetchMonitoringPage } from '@/lib/etherscan';
import {
  analyzeWalletTransactions,
  findFundSplittingAlarm,
  formatEth,
  type WalletAnalysis,
  type WalletTransaction,
} from '@/lib/wallet-analysis';

const ZERO_WEI = BigInt(0);
const UNUSUAL_MOVEMENT_MULTIPLIER = BigInt(4);

export type WalletMonitor = {
  id: string;
  user_id: string;
  address: string;
  network: 'ethereum';
  is_active: boolean;
  last_checked_at: string | null;
  last_successful_check_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type AlertInsert = {
  monitor_id: string;
  source_transaction_hash: string;
  alert_type: 'fund_splitting' | 'unusual_movement';
  severity: 'high' | 'critical';
  title: string;
  description: string;
  risk_score: number | null;
  details: Record<string, unknown>;
};

export type MonitorCheckResult = {
  monitorId: string;
  address: string;
  newTransactionCount: number;
  newAlertCount: number;
  checkedAt: string;
  error?: string;
};

function transactionHash(transaction: WalletTransaction) {
  return transaction.hash.toLowerCase();
}

function analysisSnapshot(analysis: WalletAnalysis) {
  return {
    risk: analysis.risk,
    transactionCount: analysis.transactionCount,
    successfulTransactionCount: analysis.successfulTransactionCount,
    failedTransactionCount: analysis.failedTransactionCount,
    totalReceivedWei: analysis.totalReceivedWei.toString(),
    totalSentWei: analysis.totalSentWei.toString(),
    netFlowWei: analysis.netFlowWei.toString(),
    splittingAlarm: analysis.splittingAlarm
      ? {
          ...analysis.splittingAlarm,
          totalWei: analysis.splittingAlarm.totalWei.toString(),
        }
      : null,
  };
}

function monitoringTransactionRow(monitorId: string, transaction: WalletTransaction) {
  if (typeof transaction.value !== 'string' || !/^\d+$/.test(transaction.value)) {
    throw new Error('Transaction amount is unavailable or invalid. Retry the request.');
  }
  const blockNumber = /^\d+$/.test(transaction.blockNumber) ? Number(transaction.blockNumber) : null;

  return {
    monitor_id: monitorId,
    transaction_hash: transactionHash(transaction),
    block_number: Number.isSafeInteger(blockNumber) ? blockNumber : null,
    occurred_at: transaction.timestamp,
    from_address: transaction.from.toLowerCase(),
    to_address: transaction.to?.toLowerCase() || null,
    value_wei: transaction.value,
    status: transaction.status,
  };
}

function noDataError(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'The Ethereum transaction check failed.';
}

function unusualMovementAlerts(
  monitor: WalletMonitor,
  transactions: WalletTransaction[],
  newlyInsertedHashes: Set<string>,
  analysis: WalletAnalysis,
) {
  const alerts: AlertInsert[] = [];

  for (const transaction of analysis.outgoingTransactions) {
    const hash = transactionHash(transaction);
    if (!newlyInsertedHashes.has(hash) || transaction.valueWei <= ZERO_WEI) continue;

    const baseline = analyzeWalletTransactions(
      monitor.address,
      transactions.filter((candidate) => transactionHash(candidate) !== hash),
    );
    const average = baseline.averageTransactionWei;

    if (
      baseline.successfulTransactionCount < 3 ||
      average === null ||
      average <= ZERO_WEI ||
      transaction.valueWei < average * UNUSUAL_MOVEMENT_MULTIPLIER
    ) {
      continue;
    }

    alerts.push({
      monitor_id: monitor.id,
      source_transaction_hash: hash,
      alert_type: 'unusual_movement',
      severity: 'high',
      title: 'Unusual outgoing ETH movement',
      description: `${formatEth(transaction.valueWei)} is at least ${UNUSUAL_MOVEMENT_MULTIPLIER.toString()}x the average of the other recent successful transactions observed for this wallet.`,
      risk_score: Math.max(analysis.risk.score || 0, 40),
      details: {
        analysis: analysisSnapshot(analysis),
        baselineAverageWei: average.toString(),
        multiplier: Number(UNUSUAL_MOVEMENT_MULTIPLIER),
      },
    });
  }

  return alerts;
}

function fundSplittingAlert(
  monitor: WalletMonitor,
  analysis: WalletAnalysis,
  newlyInsertedHashes: Set<string>,
) {
  // Stable hash ordering resolves equal timestamps without provider-order ties.
  // Filter eligible triggering windows BEFORE ranking, so an older stronger
  // pattern cannot suppress new evidence. Historical rows remain context.
  const splitting = findFundSplittingAlarm(
    [...analysis.outgoingTransactions].sort((a, b) => a.hash.toLowerCase().localeCompare(b.hash.toLowerCase())),
    newlyInsertedHashes,
  );
  if (!splitting || splitting.transactionHashes.length === 0) return null;

  const triggeringHash = splitting.transactionHashes[splitting.transactionHashes.length - 1].toLowerCase();
  if (!newlyInsertedHashes.has(triggeringHash)) return null;

  return {
    monitor_id: monitor.id,
    source_transaction_hash: triggeringHash,
    alert_type: 'fund_splitting' as const,
    severity: 'high' as const,
    title: 'Suspicious fund splitting detected',
    description: `${splitting.transactionCount} successful outgoing transfers sent ${formatEth(splitting.totalWei)} to ${splitting.destinationCount} distinct addresses within 24 hours.`,
    risk_score: analysis.risk.score,
    details: {
      analysis: analysisSnapshot({ ...analysis, splittingAlarm: splitting }),
      windowStart: splitting.start,
      windowEnd: splitting.end,
      transactionHashes: splitting.transactionHashes,
      destinationCount: splitting.destinationCount,
      totalWei: splitting.totalWei.toString(),
    },
  };
}

export class MonitorEnrollmentError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function seedMonitorTransactions(
  admin: SupabaseClient,
  monitorId: string | null,
  address: string,
  userId: string,
  expectedUpdatedAt: string | null = null,
) {
  const transactions = await fetchEthereumTransactions(address, 100);
  // Fetch first, then validate the observed state UNDER the database lock before
  // any baseline write. Never fall back to sequential seed/reset/activation.
  const { data, error } = await admin.rpc('enroll_wallet_monitor', {
    p_monitor_id: monitorId, p_user_id: userId, p_address: address,
    p_expected_updated_at: expectedUpdatedAt, p_checked_at: new Date().toISOString(),
    p_transactions: transactions.map(transaction => {
      const { monitor_id: _monitorId, ...row } = monitoringTransactionRow(monitorId, transaction);
      return row;
    }),
  });
  if (error?.code === '40001') {
    throw new MonitorEnrollmentError('Wallet monitoring changed during enrollment. Refresh and retry.', 409);
  }
  if (error || !data?.monitor || data.monitor.user_id !== userId || data.monitor.address !== address ||
      data.monitor.network !== 'ethereum' || data.monitor.is_active !== true ||
      typeof data.monitor.id !== 'string' || (monitorId !== null && data.monitor.id !== monitorId) ||
      data.baselineTransactionCount !== transactions.length) {
    throw new MonitorEnrollmentError('Atomic wallet enrollment could not be confirmed. Verify the baseline enrollment migration is installed, then retry.', 502);
  }
  return data as { monitor: WalletMonitor; baselineTransactionCount: number };
}

type MonitorCursor = {
  confirmedBlock: number; scanFrom: number; scanTo: number | null;
  nextPage: number; revision: number; context: WalletTransaction[];
};
const INCOMPLETE = 'Monitoring coverage is incomplete. Saved progress will resume on the next check.';

export async function runWalletMonitor(
  admin: SupabaseClient,
  monitor: WalletMonitor,
  deadline = Date.now() + 25_000,
): Promise<MonitorCheckResult> {
  const checkedAt = new Date().toISOString();
  let newTransactionCount = 0, newAlertCount = 0;
  try {
    const identity = { p_monitor_id: monitor.id, p_user_id: monitor.user_id, p_address: monitor.address };
    const { data: initial, error: cursorError } = await admin.rpc('get_wallet_monitor_cursor', identity);
    if (cursorError || !initial) throw new Error('Monitoring checkpoint unavailable. Verify the monitoring checkpoint migration is installed, then retry.');
    let cursor = initial as MonitorCursor;
    const remaining = () => Math.max(1, deadline - Date.now());
    if (Date.now() >= deadline) throw new Error(INCOMPLETE);
    const head = cursor.scanTo ?? await fetchMonitoringHeadBlock(monitor.address, remaining());
    if (head < cursor.confirmedBlock) throw new Error('Ethereum history is behind the confirmed monitoring boundary. Retry the check.');
    // At most two 100-row pages per invocation. Every committed page carries its
    // resume cursor in the same transaction; interruption never skips a page.
    for (let pages = 0; pages < 2; pages++) {
      if (Date.now() >= deadline) throw new Error(INCOMPLETE);
      const page = head < cursor.scanFrom ? [] : await fetchMonitoringPage(
        monitor.address, cursor.scanFrom, head, cursor.nextPage, remaining(),
      );
      const unique = new Map(cursor.context.map(row => [transactionHash(row), row]));
      for (const row of page) unique.set(transactionHash(row), row);
      const transactions = [...unique.values()];
      const complete = page.length < 100;
      // The head query witnessed a transaction in this block. A short page
      // before that block is not proof that the pinned range is exhausted.
      if (complete && head > cursor.confirmedBlock &&
          !transactions.some(row => Number(row.blockNumber) === head)) {
        throw new Error(INCOMPLETE);
      }
      const analysis = analyzeWalletTransactions(monitor.address, transactions);
      const candidateHashes = new Set(page.map(transactionHash));
      const alerts = unusualMovementAlerts(monitor, transactions, candidateHashes, analysis);
      const contextHashes = new Set(cursor.context.map(transactionHash));
      const splittingAlert = fundSplittingAlert(monitor, analysis,
        new Set([...candidateHashes].filter(hash => !contextHashes.has(hash))));
      if (splittingAlert) alerts.push(splittingAlert);
      const { data, error } = await admin.rpc('persist_wallet_monitor_page', {
        ...identity, p_checked_at: checkedAt,
        p_expected_revision: cursor.revision, p_scan_from: cursor.scanFrom,
        p_scan_to: head, p_page: cursor.nextPage, p_complete: complete,
        p_transactions: page.map(row => monitoringTransactionRow(monitor.id, row)),
        p_analysis: analysisSnapshot(analysis), p_alerts: alerts,
      });
      // STAB-01 is called inside this RPC. Never fall back to separate writes.
      if (error || !data || !Number.isInteger(data.newTransactionCount) || data.newTransactionCount < 0 ||
          !Number.isInteger(data.newAlertCount) || data.newAlertCount < 0 || !data.cursor) {
        throw new Error('Unable to atomically save monitoring evidence and checkpoint. Verify the monitoring checkpoint migration is installed, then retry.');
      }
      newTransactionCount += data.newTransactionCount;
      newAlertCount += data.newAlertCount;
      cursor = data.cursor;
      if (complete) return { monitorId: monitor.id, address: monitor.address, newTransactionCount, newAlertCount, checkedAt };
    }
    throw new Error(INCOMPLETE);
  } catch (error) {
    const message = noDataError(error);
    await admin.from('wallet_monitors')
      .update({ last_checked_at: checkedAt, last_error: message.slice(0, 500) }).eq('id', monitor.id);
    return { monitorId: monitor.id, address: monitor.address, newTransactionCount, newAlertCount, checkedAt, error: message };
  }
}
