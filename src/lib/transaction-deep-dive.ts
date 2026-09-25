import { formatEther } from 'viem';
import { normalizeAttributionAddress, normalizeAttributionNetwork, lookupCustodialAttribution } from '@/lib/custodial-attribution';
import type { TimelineCase } from '@/lib/investigation-timeline';

export function isTransactionHash(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
}
export function transactionDeepDiveUrl(hash: string, caseId?: string) {
  if (!isTransactionHash(hash)) return null;
  return `/transactions/${hash.toLowerCase()}${caseId ? `?case=${encodeURIComponent(caseId)}` : ''}`;
}
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : null;
const decimal = (value: unknown) => typeof value === 'string' && /^\d+$/.test(value) ? value : null;
const address = (value: unknown) => typeof value === 'string' ? normalizeAttributionAddress(value) : null;
function timestamp(value: unknown) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}

/** Accept only the existing API's evidence fields, retaining unknowns as null. */
export function normalizeTransactionEvidence(payload: unknown, requestedHash: string) {
  const envelope = object(payload), tx = object(envelope.transaction);
  if (!isTransactionHash(requestedHash) || !isTransactionHash(tx.hash) || tx.hash.toLowerCase() !== requestedHash.toLowerCase()) throw new Error('Transaction evidence is unavailable or does not match the requested hash.');
  const valueWei = decimal(tx.valueWei), blockNumber = decimal(tx.blockNumber);
  const network = text(envelope.network);
  const mined = blockNumber !== null;
  return {
    hash: tx.hash.toLowerCase(), network, blockNumber,
    timestamp: mined ? timestamp(tx.timestamp) : null,
    from: address(tx.from), to: address(tx.to), valueWei,
    valueEth: valueWei === null ? null : formatEther(BigInt(valueWei)),
    status: mined && (tx.status === 'success' || tx.status === 'failed') ? tx.status : 'unknown',
    dataSource: text(envelope.dataSource), retrievedAt: timestamp(envelope.verifiedAt),
  };
}
export type TransactionDeepDiveEvidence = ReturnType<typeof normalizeTransactionEvidence>;
export const TRANSACTION_CONTEXT_NOTICE = 'Investigation relationships are context and investigative indicators, not proof of fraud, common ownership, or coordinated activity. Inclusion in a private case is not a finding against an address or transaction.';

export function transactionInvestigationContext(evidence: TransactionDeepDiveEvidence, record: TimelineCase | null) {
  const comparable = !!record && !!evidence.network && normalizeAttributionNetwork(evidence.network) === 'eip155:1';
  const wallets = new Set(comparable ? record!.wallets.filter(wallet => normalizeAttributionNetwork(wallet.network) === 'eip155:1').map(wallet => normalizeAttributionAddress(wallet.address)).filter(Boolean) : []);
  const senderIsCaseWallet = comparable && evidence.from ? wallets.has(evidence.from) : null;
  const recipientIsCaseWallet = comparable && evidence.to ? wallets.has(evidence.to) : null;
  const betweenInvestigatedWallets = senderIsCaseWallet === true && recipientIsCaseWallet === true && evidence.from !== evidence.to && evidence.status === 'success' && evidence.valueWei !== null && BigInt(evidence.valueWei) > 0n;
  const observations: string[] = [];
  if (senderIsCaseWallet) observations.push('The sender is currently recorded as a wallet in the selected private case.');
  if (recipientIsCaseWallet) observations.push('The recipient is currently recorded as a wallet in the selected private case.');
  if (betweenInvestigatedWallets) observations.push('The retrieved successful transaction carries positive ETH value between two distinct investigated wallets.');
  if (senderIsCaseWallet && recipientIsCaseWallet && evidence.from === evidence.to) observations.push('The sender and recipient are the same case wallet; this is not a transfer between distinct investigated wallets.');
  return { senderIsCaseWallet, recipientIsCaseWallet, betweenInvestigatedWallets, observations };
}
export function transactionAttributions(evidence: TransactionDeepDiveEvidence) {
  return [...new Set([evidence.from, evidence.to].filter((value): value is string => !!value))].map(address => lookupCustodialAttribution(evidence.network || 'Unavailable', address));
}
