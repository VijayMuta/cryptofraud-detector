import { lookupCustodialAttribution, ATTRIBUTION_NOTICE } from '@/lib/custodial-attribution';
import { analyzeWalletTransactions, formatEth, type WalletTransaction } from '@/lib/wallet-analysis';

export const PRODUCT_STATEMENT = 'CHAINTRACE enables an authorized freeze/hold intelligence workflow by detecting suspicious fund movement, identifying potential custodial endpoints, generating verifiable blockchain evidence, and escalating an intervention request to participating exchanges/custodians or competent authorities.';
export const EVIDENCE_NOTICES = [
  'CHAINTRACE does not autonomously freeze blockchain assets. Actual freezing or holding of funds requires action by an appropriately authorized exchange, custodian, or competent authority.',
  'Risk signals are investigative indicators and are not proof of fraud.',
  'Wallet connections do not by themselves prove common ownership or coordinated activity.',
  'Any freeze or hold decision remains the responsibility of the authorized receiving entity or competent authority.',
  ATTRIBUTION_NOTICE,
];
export const REQUEST_TYPES = ['Temporary Hold Review', 'Freeze Review', 'Enhanced Due Diligence Review', 'Transaction Monitoring Request', 'Law-Enforcement / Authority Escalation'] as const;
export const STATUSES = ['DRAFT', 'READY FOR REVIEW', 'PREPARED FOR AUTHORIZED ESCALATION', 'ACKNOWLEDGED', 'UNDER REVIEW', 'ACTIONED', 'DECLINED', 'CLOSED'] as const;
export type RequestStatus = typeof STATUSES[number];
export type WalletEvidence = { address: string; transactions: WalletTransaction[]; dataSource: string; verifiedAt: string; network: string };

export function summarizeEvidence(wallets: WalletEvidence[]) {
  const transactions = [...new Map(wallets.flatMap(wallet => wallet.transactions).map(tx => [tx.hash.toLowerCase(), tx])).values()];
  const addresses = new Set(wallets.map(wallet => wallet.address.toLowerCase()));
  const destinations = [...new Set(transactions.filter(tx => tx.status === 'success' && addresses.has(tx.from.toLowerCase()) && tx.to && tx.to.toLowerCase() !== tx.from.toLowerCase() && /^\d+$/.test(tx.value) && BigInt(tx.value) > 0n).map(tx => tx.to!.toLowerCase()))];
  const behavioral = wallets.map(wallet => {
    const analysis = analyzeWalletTransactions(wallet.address, wallet.transactions);
    return {
      address: wallet.address, source: wallet.dataSource, retrievedAt: wallet.verifiedAt,
      riskSignals: analysis.risk.signals,
      moneyFingerprint: analysis.successfulTransactionCount ? {
        incomingEth: formatEth(analysis.totalReceivedWei), outgoingEth: formatEth(analysis.totalSentWei),
        counterparties: analysis.counterparties.length, transfersPerDay: analysis.frequency.transactionsPerDay,
        averageEth: formatEth(analysis.averageTransactionWei),
        largestEth: analysis.largestTransaction ? formatEth(analysis.largestTransaction.valueWei) : null,
      } : null,
      fundSplitting: analysis.splittingAlarm ? { ...analysis.splittingAlarm, totalWei: analysis.splittingAlarm.totalWei.toString() } : null,
    };
  });
  return { transactions, behavioral, endpoints: destinations.map(address => lookupCustodialAttribution('Ethereum Mainnet', address)) };
}
