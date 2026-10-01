import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchEthereumTransactions } from '@/lib/etherscan';
import {
  analyzeWalletTransactions,
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
  const blockNumber = /^\d+$/.test(transaction.blockNumber) ? Number(transaction.blockNumber) : null;

  return {
    monitor_id: monitorId,
    transaction_hash: transactionHash(transaction),
    block_number: Number.isSafeInteger(blockNumber) ? blockNumber : null,
    occurred_at: transaction.timestamp,
    from_address: transaction.from.toLowerCase(),
    to_address: transaction.to?.toLowerCase() || null,
    value_wei: /^\d+$/.test(transaction.value) ? transaction.value : '0',
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
  const splitting = analysis.splittingAlarm;
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
      analysis: analysisSnapshot(analysis),
      windowStart: splitting.start,
      windowEnd: splitting.end,
      transactionHashes: splitting.transactionHashes,
      destinationCount: splitting.destinationCount,
      totalWei: splitting.totalWei.toString(),
    },
  };
}

export async function seedMonitorTransactions(
  admin: SupabaseClient,
  monitorId: string,
  address: string,
) {
  const transactions = await fetchEthereumTransactions(address, 100);
  if (transactions.length === 0) return 0;

  const { error } = await admin
    .from('monitor_transactions')
    .upsert(
      transactions.map((transaction) => monitoringTransactionRow(monitorId, transaction)),
      { onConflict: 'monitor_id,transaction_hash', ignoreDuplicates: true },
    );

  if (error) throw new Error('Unable to save the wallet monitoring baseline.');
  return transactions.length;
}

export async function runWalletMonitor(
  admin: SupabaseClient,
  monitor: WalletMonitor,
): Promise<MonitorCheckResult> {
  const checkedAt = new Date().toISOString();

  try {
    const transactions = await fetchEthereumTransactions(monitor.address, 100);
    const rows = transactions.map((transaction) => monitoringTransactionRow(monitor.id, transaction));
    const analysis = analyzeWalletTransactions(monitor.address, transactions);
    // Calculate candidates without writing. The RPC filters them to hashes it
    // actually inserts, preserving baseline suppression and concurrent deduplication.
    const candidateHashes = new Set(transactions.map(transactionHash));
    const alerts = unusualMovementAlerts(monitor, transactions, candidateHashes, analysis);
    const splittingAlert = fundSplittingAlert(monitor, analysis, candidateHashes);
    if (splittingAlert) alerts.push(splittingAlert);

    const { data, error: persistenceError } = await admin.rpc('persist_wallet_monitor_check', {
      p_monitor_id: monitor.id,
      p_user_id: monitor.user_id,
      p_address: monitor.address,
      p_checked_at: checkedAt,
      p_transactions: rows,
      p_analysis: analysisSnapshot(analysis),
      p_alerts: alerts,
    });
    // Never fall back to separate writes, including when the migration is missing.
    if (persistenceError) throw new Error('Unable to atomically save the wallet monitoring check. Verify the monitoring atomicity migration is installed, then retry.');
    if (!data || !Number.isInteger(data.newTransactionCount) || data.newTransactionCount < 0 ||
        !Number.isInteger(data.newAlertCount) || data.newAlertCount < 0) {
      throw new Error('Wallet monitoring persistence could not be confirmed. Retry the check.');
    }

    return {
      monitorId: monitor.id,
      address: monitor.address,
      newTransactionCount: data.newTransactionCount,
      newAlertCount: data.newAlertCount,
      checkedAt,
    };
  } catch (error) {
    const message = noDataError(error);
    await admin
      .from('wallet_monitors')
      .update({ last_checked_at: checkedAt, last_error: message.slice(0, 500) })
      .eq('id', monitor.id);

    return {
      monitorId: monitor.id,
      address: monitor.address,
      newTransactionCount: 0,
      newAlertCount: 0,
      checkedAt,
      error: message,
    };
  }
}
