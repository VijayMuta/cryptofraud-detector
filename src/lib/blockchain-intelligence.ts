import { directionFor, type WalletAnalysis, type WalletTransaction } from '@/lib/wallet-analysis';

/** Additional views over the same retrieved dataset; no provider calls or risk scores. */
export function summarizeIntelligence(address: string, transactions: WalletTransaction[], analysis: WalletAnalysis) {
  const dated = transactions.flatMap(transaction => {
    const time = transaction.timestamp ? Date.parse(transaction.timestamp) : NaN;
    return Number.isFinite(time) ? [{ transaction, time }] : [];
  }).sort((a, b) => a.time - b.time);
  const days = new Map<string, { day: string; incoming: number; outgoing: number; other: number; count: number }>();
  for (const { transaction, time } of dated) {
    const day = new Date(time).toISOString().slice(0, 10);
    const bucket = days.get(day) ?? { day, incoming: 0, outgoing: 0, other: 0, count: 0 };
    const direction = directionFor(transaction, address);
    if (direction === 'incoming') bucket.incoming++;
    else if (direction === 'outgoing') bucket.outgoing++;
    else bucket.other++;
    bucket.count++;
    days.set(day, bucket);
  }
  const timeline = [...days.values()];
  const peak = timeline.reduce<(typeof timeline)[number] | null>((best, day) => !best || day.count > best.count ? day : best, null);
  const successful = transactions.filter(transaction => transaction.status === 'success' && /^\d+$/.test(transaction.value));
  const smallest = successful.reduce<bigint | null>((min, transaction) => min === null || BigInt(transaction.value) < min ? BigInt(transaction.value) : min, null);
  const repeated = analysis.counterparties.filter(party => party.incomingCount + party.outgoingCount >= 2);
  const destinations = analysis.counterparties.filter(party => party.outgoingCount >= 2);
  const signals: string[] = [];
  if (repeated.length) signals.push(`${repeated.length} counterparties have at least two successful interactions; ${destinations.length} destinations received at least two transfers.`);
  if (analysis.splittingAlarm) signals.push(`${analysis.splittingAlarm.transactionCount} successful outgoing transfers reached ${analysis.splittingAlarm.destinationCount} destinations within 24 hours (${analysis.splittingAlarm.start} to ${analysis.splittingAlarm.end}).`);
  const interactions = analysis.counterparties.reduce((sum, party) => sum + party.incomingCount + party.outgoingCount, 0);
  const top = analysis.counterparties[0];
  if (top && interactions >= 4 && (top.incomingCount + top.outgoingCount) / interactions >= 0.5) signals.push(`The most frequent counterparty accounts for ${top.incomingCount + top.outgoingCount} of ${interactions} successful direct interactions (at least 50%).`);
  // A transparent absolute threshold, not an assertion of unusual lifetime behavior.
  let left = 0;
  let burst = 0;
  const verifiedTimes = dated.filter(entry => entry.transaction.status === 'success');
  for (let right = 0; right < verifiedTimes.length; right++) {
    while (verifiedTimes[right].time - verifiedTimes[left].time > 3_600_000) left++;
    burst = Math.max(burst, right - left + 1);
  }
  if (burst >= 5) signals.push(`${burst} successful transfers occurred within one hour, meeting the activity-burst threshold of five. This is not a comparison with lifetime activity.`);
  return { first: dated[0]?.transaction.timestamp ?? null, latest: dated[dated.length - 1]?.transaction.timestamp ?? null, timeline, peak, smallest, signals, missingTimestamps: transactions.length - dated.length, unknownStatuses: transactions.filter(transaction => transaction.status === 'unknown').length };
}
