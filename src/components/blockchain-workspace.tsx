'use client';

import Link from 'next/link';
import { TransactionLink } from '@/components/transaction-link';
import { useMemo, useState, type ReactNode } from 'react';
import { WalletAddress } from './wallet-address';
import { directionFor, formatEth, type WalletAnalysis, type WalletTransaction } from '@/lib/wallet-analysis';
import { summarizeIntelligence } from '@/lib/blockchain-intelligence';

function date(value: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : 'Unavailable';
}

export function BlockchainWorkspace({ address, transactions, analysis }: { address: string; transactions: WalletTransaction[]; analysis: WalletAnalysis }) {
  const summary = useMemo(() => summarizeIntelligence(address, transactions, analysis), [address, transactions, analysis]);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const filtered = transactions.filter(transaction => filter === 'all' || directionFor(transaction, address) === filter);
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, pages - 1);
  const confirmed = analysis.successfulTransactionCount > 0;
  const value = (wei: bigint | null) => confirmed ? formatEth(wei) : 'Unavailable';
  const sources = analysis.counterparties.filter(party => party.incomingCount > 0);
  const destinations = analysis.counterparties.filter(party => party.outgoingCount > 0);

  return <div className="space-y-6">
    <section className="panel p-5 space-y-4">
      <p role="status" className="text-sm text-cyan-200">Wallet data retrieved · Ethereum Mainnet</p>
      <WalletAddress address={address} />
      <p className="text-xs leading-6 text-slate-400">Observed dataset: up to 50 most recent external ETH transfers, merged from incoming and outgoing results. This is not complete wallet history. Internal transfers, tokens, gas costs and pending activity are excluded. First observed means earliest in this sample, not wallet creation. Balance is a separate current snapshot.</p>
      <p className="text-xs leading-6 text-slate-400">{analysis.successfulTransactionCount} receipt-confirmed successful · {analysis.failedTransactionCount} failed · {summary.unknownStatuses} unverified. Value totals, counterparties, Money Fingerprint and behavioral signals use successful receipts only. Timeline and transaction rows include all retrieved statuses. {summary.missingTimestamps} records lack usable timestamps.</p>
      <div className="flex flex-wrap gap-3">
        <Link className="button-primary" href={`/investigate?address=${address}`}>Investigate Wallet</Link>
        <Link className="button-secondary" href={`/investigate?address=${address}#monitoring`}>Open wallet monitoring</Link>
        <Link className="button-secondary" href="/cases">Open Cases</Link>
      </div>
      <p className="text-xs text-slate-500">Monitoring opens the existing investigation workflow; analyze the prefilled wallet to access its controls. Use Cases to select a case and add this wallet using its copied address.</p>
    </section>
    {transactions.length === 0 && <p className="empty-state">No external ETH transfers were returned. This does not establish that the wallet has no other blockchain activity.</p>}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Successful incoming" value={String(analysis.incomingTransactions.length)} />
      <Stat label="Successful outgoing" value={String(analysis.outgoingTransactions.length)} />
      <Stat label="First observed activity" value={date(summary.first)} />
      <Stat label="Latest observed activity" value={date(summary.latest)} />
      <Stat label="Observed ETH received" value={value(analysis.totalReceivedWei)} />
      <Stat label="Observed ETH sent" value={value(analysis.totalSentWei)} />
      <Stat label="Average successful transfer" value={value(analysis.averageTransactionWei)} />
      <Stat label="Smallest successful transfer" value={value(summary.smallest)} />
    </section>
    <Panel title="Observable fund flow">
      <p className="text-xs text-slate-400">Direct successful external transfers only; top five sources and destinations by interaction count. No ownership or service attribution.</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-center">
        <Flow label={`Funding sources (${sources.length})`} parties={sources} incoming />
        <span aria-hidden className="text-center text-cyan-300">↓<span className="sr-only">to</span></span>
        <div className="rounded-xl border border-cyan-400/40 bg-cyan-400/5 p-4"><p className="mb-3 text-xs text-cyan-200">Investigated wallet</p><WalletAddress address={address} /></div>
        <span aria-hidden className="text-center text-cyan-300">↓</span>
        <Flow label={`Destinations (${destinations.length})`} parties={destinations} />
      </div>
    </Panel>
    <Panel title="Counterparty intelligence">
      <p className="mb-4 text-xs text-slate-400">All {analysis.counterparties.length} observed counterparties, ranked by successful interaction count. Repeated means at least two interactions; repeated destination means at least two outgoing transfers.</p>
      {!analysis.counterparties.length ? <p className="text-sm text-slate-400">Insufficient successful transfer evidence.</p> : <div className="overflow-x-auto"><table className="technical-table min-w-[700px]"><thead><tr><th>Address</th><th>Incoming / outgoing</th><th>Received / sent ETH</th><th>Relationship</th></tr></thead><tbody>{analysis.counterparties.map(party => <tr key={party.address}><td><WalletAddress address={party.address} /></td><td>{party.incomingCount} / {party.outgoingCount}</td><td>{formatEth(party.incomingWei)} / {formatEth(party.outgoingWei)}</td><td>{party.incomingCount && party.outgoingCount ? 'Bidirectional' : party.incomingCount ? 'Funding source' : 'Destination'}{party.incomingCount + party.outgoingCount >= 2 ? ' · Repeated' : ''}{party.outgoingCount >= 2 ? ' · Repeated destination' : ''}</td></tr>)}</tbody></table></div>}
    </Panel>
    <Panel title="Activity timeline · UTC">
      <p className="text-xs leading-6 text-slate-400">Daily counts across all retrieved statuses. Cyan: incoming; violet: outgoing; gray: self or unclassified. Only observed dates are shown; gaps do not prove inactivity.</p>
      {summary.peak ? <p className="mt-2 text-sm text-cyan-200">Highest observed daily activity: {summary.peak.count} transfers on {summary.peak.day} (ties may exist).</p> : <p className="mt-3 text-sm text-slate-400">No usable timestamps were returned.</p>}
      <div className="mt-4 max-h-80 space-y-3 overflow-y-auto">{summary.timeline.map(day => <div key={day.day} className="grid grid-cols-[6rem_1fr] gap-3 text-xs"><span className="text-slate-400">{day.day}</span><div><div className="flex h-3 overflow-hidden rounded bg-slate-800" style={{ width: `${Math.max(2, day.count / (summary.peak?.count || 1) * 100)}%` }} aria-hidden><span className="bg-cyan-400" style={{ width: `${day.incoming / day.count * 100}%` }} /><span className="bg-violet-400" style={{ width: `${day.outgoing / day.count * 100}%` }} /><span className="bg-slate-500" style={{ width: `${day.other / day.count * 100}%` }} /></div><p className="mt-1 text-slate-400">{day.incoming} in · {day.outgoing} out · {day.other} other</p></div></div>)}</div>
    </Panel>
    <Panel title="Behavioral signals">
      <p className="mb-4 text-sm text-amber-100">Analytical signal based on observed blockchain activity. It is not proof of fraud, ownership, or intent.</p>
      {summary.signals.length ? <ul className="list-disc space-y-3 pl-5 text-sm text-slate-300">{summary.signals.map(signal => <li key={signal}>{signal}</li>)}</ul> : <p className="text-sm text-slate-400">{confirmed ? 'No configured patterns were observed in this sample. This is not a safety determination.' : 'Insufficient receipt-confirmed activity for behavioral analysis.'}</p>}
    </Panel>
    <Panel title="Transaction activity">
      <label className="text-sm text-slate-300">Direction <select className="filter-control ml-2" value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }}><option value="all">All</option><option value="incoming">Incoming</option><option value="outgoing">Outgoing</option><option value="self">Self</option></select></label>
      <div className="mt-4 overflow-x-auto"><table className="technical-table min-w-[1050px]"><thead><tr><th>Timestamp (UTC)</th><th>Hash</th><th>Direction</th><th>From</th><th>To</th><th>ETH value</th><th>Receipt status</th></tr></thead><tbody>{filtered.slice(currentPage * 10, currentPage * 10 + 10).map(transaction => <tr key={transaction.hash}><td>{date(transaction.timestamp)}</td><td><TransactionLink hash={transaction.hash} /></td><td>{directionFor(transaction, address)}</td><td><WalletAddress address={transaction.from} /></td><td>{transaction.to ? <WalletAddress address={transaction.to} /> : 'Unavailable / creation'}</td><td>{formatEth(BigInt(transaction.value))}</td><td>{transaction.status === 'unknown' ? 'Unverified' : transaction.status}</td></tr>)}</tbody></table></div>
      {!filtered.length && <p className="py-5 text-sm text-slate-400">No retrieved transfers match this view.</p>}
      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-400"><button className="button-secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>{filtered.length} transfers · Page {currentPage + 1} of {pages}</span><button className="button-secondary" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</button></div>
    </Panel>
  </div>;
}

function Panel({ title, children }: { title: string; children: ReactNode }) { return <section className="panel p-5 sm:p-6"><h2 className="mb-4 text-lg font-semibold text-white">{title}</h2>{children}</section>; }
function Stat({ label, value }: { label: string; value: string }) { return <article className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"><p className="text-xs text-slate-400">{label}</p><p className="mt-2 break-words font-mono text-sm text-white">{value}</p></article>; }
function Flow({ label, parties, incoming = false }: { label: string; parties: WalletAnalysis['counterparties']; incoming?: boolean }) {
  return <div className="rounded-xl border border-slate-800 p-4"><h3 className="mb-3 text-sm text-slate-300">{label}</h3><div className="space-y-3">{parties.slice(0, 5).map(party => <div key={party.address}><WalletAddress address={party.address} /><p className="mt-1 text-xs text-slate-500">{incoming ? party.incomingCount : party.outgoingCount} transfers · {formatEth(incoming ? party.incomingWei : party.outgoingWei)}</p></div>)}{!parties.length && <p className="text-xs text-slate-500">No verified flow observed.</p>}</div></div>;
}
