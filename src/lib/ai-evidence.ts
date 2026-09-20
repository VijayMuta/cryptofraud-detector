import { fetchAlchemyWallet } from '@/lib/alchemy';
import { analyzeWalletTransactions, formatEth } from '@/lib/wallet-analysis';
import { summarizeIntelligence } from '@/lib/blockchain-intelligence';
import { analyzeCaseConnection } from '@/lib/case-analysis';
import { caseAnalysisInput, getCaseWallets, getOwnedCase } from '@/lib/cases';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { AssistantError } from '@/lib/ai-provider';
import type { EvidenceContext, EvidenceFact } from '@/lib/ai-contract';

export type ContextTarget = { kind: 'wallet' | 'case'; value: string };
const disclaimer = 'Analytical signals are not proof of fraud, ownership, identity, coordination or intent. Attribution and subsequent fund movement beyond retrieved transfers are unknown.';
function collector() {
  const facts: EvidenceFact[] = [];
  const add = (text: string, topics: string[], hashes: string[] = [], signal = false) => {
    facts.push({ id: `E${facts.length + 1}`, text, topics, hashes: [...new Set(hashes)].filter(hash => /^0x[0-9a-f]{64}$/i.test(hash)).slice(0, 10), section: signal ? 'Analytical Signals' : 'Observed Evidence' });
  };
  return { facts, add };
}

export async function authorizeCase(userId: string, caseId: string) {
  const admin = getSupabaseAdmin();
  const record = await getOwnedCase(admin, userId, caseId);
  if (!record) throw new AssistantError('Case not found or access is unavailable.', 404);
  return { admin, record };
}

export async function buildEvidence(userId: string, target: ContextTarget): Promise<EvidenceContext> {
  const { facts, add } = collector();
  if (target.kind === 'wallet') {
    const wallet = await fetchAlchemyWallet(target.value);
    const analysis = analyzeWalletTransactions(wallet.address, wallet.transactions);
    const summary = summarizeIntelligence(wallet.address, wallet.transactions, analysis);
    add(`Investigated Ethereum wallet: ${wallet.address}. Current balance: ${formatEth(BigInt(wallet.balanceWei))}.`, ['overview']);
    add(`${wallet.transactions.length} external ETH transfers retrieved; ${analysis.successfulTransactionCount} receipt-confirmed successful, ${analysis.failedTransactionCount} failed, ${summary.unknownStatuses} unverified.`, ['overview']);
    if (summary.first) add(`First activity in this sample: ${summary.first}; latest: ${summary.latest}. This is not wallet creation or complete history.`, ['overview']);
    if (analysis.successfulTransactionCount) {
      add(`Successful observed transfers: ${analysis.incomingTransactions.length} incoming and ${analysis.outgoingTransactions.length} outgoing. Received ${formatEth(analysis.totalReceivedWei)}; sent ${formatEth(analysis.totalSentWei)}.`, ['transfers', 'fingerprint']);
      add(`Money Fingerprint: ${analysis.counterparties.length} distinct direct counterparties; average successful transfer ${formatEth(analysis.averageTransactionWei)}.`, ['fingerprint', 'counterparties']);
      if (analysis.frequency.transactionsPerDay !== null) add(`Retrieved successful activity averages ${analysis.frequency.transactionsPerDay.toFixed(1)} transfers/day over the observed timestamp span, not lifetime frequency.`, ['fingerprint']);
      if (analysis.largestTransaction) add(`Largest retrieved successful transfer: ${formatEth(analysis.largestTransaction.valueWei)}, from ${analysis.largestTransaction.from} to ${analysis.largestTransaction.to || 'unavailable recipient'}, timestamp ${analysis.largestTransaction.timestamp || 'unavailable'}.`, ['transfers', 'fingerprint'], [analysis.largestTransaction.hash]);
      const alarm = analysis.splittingAlarm;
      if (alarm) add(`Fund Splitting Alarm: ${alarm.transactionCount} successful outgoing transfers to ${alarm.destinationCount} destinations within 24 hours, from ${alarm.start} to ${alarm.end}, totaling ${formatEth(alarm.totalWei)}. This meets the existing distribution rule.`, ['splitting', 'signals'], alarm.transactionHashes, true);
      else add('The existing fund-splitting rule found no qualifying distribution to at least three destinations within 24 hours in the retrieved successful transfers. This does not establish absence outside this sample.', ['splitting']);
      for (const signal of summary.signals) add(signal, ['signals'], [], true);
      for (const signal of analysis.risk.signals) add(`Existing risk assessment explanation: ${signal}`, ['signals'], [], true);
    }
    for (const party of analysis.counterparties) {
      const related = [...analysis.incomingTransactions, ...analysis.outgoingTransactions].filter(row => row.from.toLowerCase() === party.address.toLowerCase() || row.to?.toLowerCase() === party.address.toLowerCase());
      add(`Counterparty ${party.address}: ${party.incomingCount} incoming transfers (${formatEth(party.incomingWei)} received), ${party.outgoingCount} outgoing transfers (${formatEth(party.outgoingWei)} sent).${party.outgoingCount >= 2 ? ' Repeated destination.' : ''}${party.incomingCount + party.outgoingCount >= 2 ? ' Repeated counterparty.' : ''}`, ['counterparties', 'transfers'], related.map(row => row.hash));
    }
    const limitations = ['Up to 50 recent external ETH transfers; not full wallet history. Tokens, internal transfers, gas costs and pending activity are excluded. Only receipt-confirmed successful transfers contribute to amounts, counterparties and signals. Values are formatted to at most six decimal places.', disclaimer];
    try {
      const { data, error } = await getSupabaseAdmin().from('wallet_monitors').select('is_active,last_checked_at,last_successful_check_at').eq('user_id', userId).eq('address', wallet.address.toLowerCase()).eq('network', 'ethereum');
      if (error) throw new Error();
      if (!data?.length) add('No monitoring record for this wallet was found for the signed-in investigator.', ['monitoring']);
      for (const monitor of data || []) add(`Your wallet monitoring is ${monitor.is_active ? 'active' : 'paused'}; last check: ${monitor.last_checked_at || 'not recorded'}; last successful check: ${monitor.last_successful_check_at || 'not recorded'}.`, ['monitoring']);
    } catch { limitations.push('Monitoring status could not be retrieved; no alerts or monitoring state can be inferred.'); }
    limitations.push('Alert records are not included. A monitoring record does not establish that alerts occurred.');
    return { facts, label: wallet.address, source: 'Alchemy · Ethereum Mainnet; private monitoring records where available', generatedAt: wallet.verifiedAt, limitations };
  }
  const { admin, record } = await authorizeCase(userId, target.value);
  const wallets = await getCaseWallets(admin, record.id);
  if (!wallets.length) return { facts, label: 'Selected case', source: 'CHAINTRACE case records', generatedAt: new Date().toISOString(), limitations: ['The selected case has no wallets to analyze.', disclaimer] };
  const input = caseAnalysisInput(record, wallets);
  const analysis = await analyzeCaseConnection(input, input, { sameCase: true });
  add(`${wallets.length} Ethereum wallets are recorded in this case. Case membership does not establish a blockchain relationship.`, ['overview', 'connections']);
  for (const wallet of analysis.walletActivity) add(`Case wallet ${wallet.address}: ${wallet.transactionCount} retrieved transfers; ${wallet.successfulTransactionCount} confirmed successful.`, ['overview', 'connections']);
  add(`${analysis.directTransfers.length} direct observed transfers between case wallets in the returned case analysis. Missing transfers do not establish absence of a relationship.`, ['connections', 'transfers']);
  for (const transfer of analysis.directTransfers.slice(0, 25)) add(`Direct observed transfer from ${transfer.from} to ${transfer.to || 'unavailable'}: ${transfer.valueEth} ETH at ${transfer.timestamp || 'unavailable timestamp'}.`, ['connections', 'transfers'], [transfer.hash]);
  for (const [label, relations] of [['Shared counterparty', analysis.sharedCounterparties], ['Shared destination', analysis.sharedDestinations], ['Shared funding source', analysis.sharedSources]] as const) {
    add(`${relations.length} ${label.toLowerCase()} relationships in the returned analysis.`, ['connections', 'counterparties']);
    for (const relation of relations.slice(0, 8)) add(`${label} ${relation.address} observed for case wallets ${[...new Set([...relation.caseAWallets, ...relation.caseBWallets])].join(', ')}. This does not establish common ownership.`, ['connections', 'counterparties'], [...relation.caseATransactions, ...relation.caseBTransactions].map(row => row.hash));
  }
  for (const signal of analysis.riskSignals) add(signal, ['signals', 'connections'], [], true);
  return { facts, label: 'Selected case', source: analysis.source, generatedAt: analysis.generatedAt, limitations: [...analysis.limitations, 'The assistant includes up to 25 direct-transfer statements and eight relationships per category. Open case analysis for the full returned evidence. Case titles, descriptions and victim text are not sent to the AI.', disclaimer] };
}
