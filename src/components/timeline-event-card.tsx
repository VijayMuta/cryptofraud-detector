'use client';

import { TransactionLink } from '@/components/transaction-link';
import type { TimelineEvent } from '@/lib/investigation-timeline';

const displayTime = (value: string | null) => value ? new Date(value).toISOString().replace('T', ' ').replace('Z', ' UTC') : 'Timestamp unavailable';

export function TimelineEventCard({ event, selected, onSelect, caseId }: { caseId?: string; event: TimelineEvent; selected: boolean; onSelect: (event: TimelineEvent) => void }) {
  return <li className={`rounded-xl border ${selected ? 'border-cyan-300 bg-cyan-400/10' : 'border-slate-700 bg-slate-950/40'}`}><button type="button" onClick={() => onSelect(event)} aria-pressed={selected} className="w-full space-y-2 rounded-xl p-4 text-left hover:bg-cyan-400/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
    <span className="inline-block rounded-full border border-cyan-400/25 px-2 py-1 text-xs text-cyan-200">{event.type}</span><span className="block text-xs text-slate-400">{displayTime(event.timestamp)} · {event.timestampMeaning}</span>
    <span className="block text-sm text-slate-200">{event.description}</span>
    {event.addresses.map((address, index) => <span key={`${address}:${index}`} className="block break-all font-mono text-xs text-slate-300">{address}</span>)}
    {event.valueWei !== undefined && <span className="block break-all text-xs text-cyan-100">Observed value: {event.valueWei} wei (ETH)</span>}
    <span className="block text-xs text-slate-500">{event.network ? `${event.network} · ` : ''}{event.source}</span>
  </button>{event.category === 'Transfers' && <p className="break-all px-4 pb-4 text-xs text-slate-400">Transaction: <TransactionLink hash={event.hashes[0]} caseId={caseId} /></p>}</li>;
}
