'use client';

import { WalletAddress } from '@/components/wallet-address';

import { ExternalLink, GitBranch, Link2, Network, ShieldAlert } from 'lucide-react';
import type {
  AddressConnectionEvidence,
  CaseConnectionAnalysis,
  DirectTransferEvidence,
  TemporalEvidence,
  TransactionEvidence,
} from '@/lib/case-analysis';

type Props = {
  analysis: CaseConnectionAnalysis;
  mode: 'case' | 'merge';
};

function abbreviate(value: string, start = 9, end = 7) {
  return value.length > start + end ? `${value.slice(0, start)}...${value.slice(-end)}` : value;
}

function formatTimestamp(value: string | null) {
  if (!value) return 'Timestamp unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Timestamp unavailable';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date);
}

function AddressLink({ address, className = 'text-cyan-300' }: { address: string; className?: string }) {
  return <span className={className}><WalletAddress address={address} /></span>;
}

function TransactionLink({ transaction }: { transaction: TransactionEvidence }) {
  return (
    <a
      href={`https://etherscan.io/tx/${transaction.hash}`}
      target="_blank"
      rel="noreferrer"
      title={transaction.hash}
      className="font-mono text-cyan-300 hover:text-cyan-100"
    >
      {abbreviate(transaction.hash)} <ExternalLink size={12} className="ml-1 inline" aria-label="View transaction on Etherscan" />
    </a>
  );
}

function TransactionEvidenceRow({ transaction }: { transaction: TransactionEvidence }) {
  return (
    <div className="grid gap-1 border-t border-slate-800 py-2 first:border-t-0 first:pt-0 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center md:gap-3">
      <div className="min-w-0">
        <TransactionLink transaction={transaction} />
        <p className="mt-1 truncate text-xs text-slate-500" title={`Observed by ${transaction.observedBy}`}>
          Observed by <span className="font-mono">{abbreviate(transaction.observedBy)}</span> · {formatTimestamp(transaction.timestamp)} UTC
        </p>
      </div>
      <p className="font-mono text-xs text-slate-400" title={`${transaction.from} → ${transaction.to || 'Contract creation'}`}>
        {abbreviate(transaction.from)} → {transaction.to ? abbreviate(transaction.to) : 'Contract'}
      </p>
      <p className="font-mono text-xs text-white">{transaction.valueEth}</p>
    </div>
  );
}

function EvidenceGroup({ label, transactions }: { label: string; transactions: TransactionEvidence[] }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-950/30 p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{label} ({transactions.length})</p>
      {transactions.length === 0 ? (
        <p className="text-xs text-slate-500">No transaction evidence was returned for this side of the relationship.</p>
      ) : (
        <div className="space-y-0">{transactions.map((transaction, index) => <TransactionEvidenceRow key={`${transaction.hash}-${index}`} transaction={transaction} />)}</div>
      )}
    </div>
  );
}

function RelationshipEvidence({
  title,
  description,
  connections,
}: {
  title: string;
  description: string;
  connections: AddressConnectionEvidence[];
}) {
  return (
    <section className="panel p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-white">{title}</h3>
          <p className="mt-1 text-xs text-slate-500">{description}</p>
        </div>
        <span className="font-mono text-sm text-cyan-200">{connections.length}</span>
      </div>
      {connections.length === 0 ? (
        <p className="rounded border border-dashed border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-500">No matching addresses were observed in the retrieved successful normal Ethereum transactions.</p>
      ) : (
        <div className="space-y-4">
          {connections.map((connection) => (
            <article key={connection.address} className="rounded-lg border border-slate-800 bg-slate-950/35 p-4">
              <AddressLink address={connection.address} className="text-violet-200" />
              <div className="mt-2 grid gap-2 text-xs text-slate-400 md:grid-cols-2">
                <p>Case A suspect wallets: {connection.caseAWallets.map((address) => abbreviate(address)).join(', ')}</p>
                <p>Case B suspect wallets: {connection.caseBWallets.map((address) => abbreviate(address)).join(', ')}</p>
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <EvidenceGroup label="Case A transaction evidence" transactions={connection.caseATransactions} />
                <EvidenceGroup label="Case B transaction evidence" transactions={connection.caseBTransactions} />
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function DirectTransferEvidenceList({ transfers }: { transfers: DirectTransferEvidence[] }) {
  return (
    <section className="panel p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-white">Direct suspect-wallet transfers</h3>
          <p className="mt-1 text-xs text-slate-500">Successful transfers where a suspect wallet sent ETH directly to another suspect wallet in the comparison.</p>
        </div>
        <span className="font-mono text-sm text-cyan-200">{transfers.length}</span>
      </div>
      {transfers.length === 0 ? (
        <p className="rounded border border-dashed border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-500">No direct successful transfer between the selected suspect wallets was observed.</p>
      ) : (
        <div className="divide-y divide-slate-800 rounded border border-slate-800 bg-slate-950/30 p-3">
          {transfers.map((transfer) => (
            <div key={transfer.hash} className="grid gap-1 py-2 first:pt-0 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center md:gap-3">
              <span className="rounded border border-violet-400/20 bg-violet-400/10 px-2 py-1 text-center text-xs text-violet-100">Case {transfer.fromCase} → Case {transfer.toCase}</span>
              <div><TransactionLink transaction={transfer} /><p className="mt-1 font-mono text-xs text-slate-400" title={`${transfer.from} → ${transfer.to}`}>{abbreviate(transfer.from)} → {transfer.to ? abbreviate(transfer.to) : 'Contract'}</p></div>
              <span className="font-mono text-sm text-white">{transfer.valueEth}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SharedWalletsList({ wallets }: { wallets: string[] }) {
  return (
    <section className="panel p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-white">Shared suspect wallets</h3>
          <p className="mt-1 text-xs text-slate-500">The same Ethereum address was associated with both selected private cases.</p>
        </div>
        <span className="font-mono text-sm text-cyan-200">{wallets.length}</span>
      </div>
      {wallets.length === 0 ? (
        <p className="rounded border border-dashed border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-500">No suspect wallet address is present in both selected cases.</p>
      ) : (
        <div className="flex flex-wrap gap-3 rounded border border-slate-800 bg-slate-950/30 p-4">{wallets.map((address) => <AddressLink key={address} address={address} className="text-violet-200" />)}</div>
      )}
    </section>
  );
}

function TemporalEvidenceList({ relationships }: { relationships: TemporalEvidence[] }) {
  return (
    <section className="panel p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-white">Transaction timing relationships</h3>
          <p className="mt-1 text-xs text-slate-500">Pairs involving the same counterparty that occurred within 24 hours. Timing alone does not establish coordination.</p>
        </div>
        <span className="font-mono text-sm text-cyan-200">{relationships.length}</span>
      </div>
      {relationships.length === 0 ? (
        <p className="rounded border border-dashed border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-500">No displayed pair involving a shared counterparty occurred within the configured 24-hour window.</p>
      ) : (
        <div className="space-y-4">
          {relationships.map((relationship, index) => (
            <article key={`${relationship.counterparty}-${relationship.caseATransaction.hash}-${relationship.caseBTransaction.hash}-${index}`} className="rounded border border-slate-800 bg-slate-950/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><AddressLink address={relationship.counterparty} className="text-violet-200" /><span className="rounded border border-amber-400/20 bg-amber-400/10 px-2 py-1 font-mono text-xs text-amber-200">{relationship.differenceMinutes} min apart</span></div>
              <div className="mt-3 grid gap-3 lg:grid-cols-2"><EvidenceGroup label="Case A transaction" transactions={[relationship.caseATransaction]} /><EvidenceGroup label="Case B transaction" transactions={[relationship.caseBTransaction]} /></div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ConnectionGraph({ analysis, mode }: Props) {
  const connection = analysis.sharedCounterparties[0] || analysis.sharedDestinations[0] || analysis.sharedSources[0];
  const leftWallet = connection?.caseAWallets[0];
  const rightWallet = connection?.caseBWallets.find((address) => address !== leftWallet) || connection?.caseBWallets[0];
  const canRender = Boolean(connection && leftWallet && rightWallet);
  const leftCase = mode === 'merge' ? `${analysis.caseA.caseCode} · ${analysis.caseA.title}` : analysis.caseA.caseCode;
  const rightCase = mode === 'merge' ? `${analysis.caseB.caseCode} · ${analysis.caseB.title}` : analysis.caseB.caseCode;

  return (
    <section className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-5">
      <div className="mb-4 flex items-center gap-2"><GitBranch size={18} className="text-cyan-300" /><div><h3 className="text-sm font-semibold uppercase tracking-wide text-white">Observed relationship graph</h3><p className="mt-1 text-xs text-slate-500">This graph renders one real path from the evidence below; it does not infer ownership or intent.</p></div></div>
      {!canRender ? (
        <p className="rounded border border-dashed border-slate-700 bg-slate-950/30 p-4 text-sm text-slate-500">No shared counterparty path is available to graph from the retrieved transaction histories.</p>
      ) : (
        <div className="flex flex-col items-center gap-2 text-center text-xs md:flex-row md:items-stretch md:justify-center md:gap-0">
          <GraphNode label={mode === 'merge' ? 'Case A' : 'Investigation case'} value={leftCase} tone="border-cyan-400/30 bg-cyan-400/10 text-cyan-100" />
          <GraphArrow />
          <GraphNode label="Suspect wallet" value={leftWallet} address />
          <GraphArrow />
          <GraphNode label="Shared counterparty" value={connection!.address} address tone="border-violet-400/30 bg-violet-400/10 text-violet-100" />
          <GraphArrow />
          <GraphNode label="Suspect wallet" value={rightWallet!} address />
          <GraphArrow />
          <GraphNode label={mode === 'merge' ? 'Case B' : 'Same investigation case'} value={rightCase} tone="border-cyan-400/30 bg-cyan-400/10 text-cyan-100" />
        </div>
      )}
    </section>
  );
}

function GraphNode({ label, value, address = false, tone = 'border-slate-700 bg-slate-900/70 text-slate-100' }: { label: string; value: string; address?: boolean; tone?: string }) {
  return <div className={`w-full rounded border p-3 md:w-36 ${tone}`}><p className="text-[10px] uppercase tracking-wide opacity-70">{label}</p><p className="mt-1 break-all font-mono text-xs">{address ? abbreviate(value, 7, 5) : value}</p></div>;
}

function GraphArrow() {
  return <div className="text-cyan-300 md:flex md:items-center md:px-1"><span className="md:hidden">↓</span><span className="hidden md:inline">→</span></div>;
}

export function CaseConnectionAnalysisPanel({ analysis, mode }: Props) {
  const uniqueActivity = Array.from(new Map(analysis.walletActivity.map((activity) => [activity.address, activity])).values());

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-violet-400/25 bg-violet-400/5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2"><Link2 size={18} className="text-violet-200" /><h2 className="text-base font-semibold text-white">Evidence-based connection signal</h2></div>
            <p className="mt-2 max-w-3xl text-sm text-violet-100">Analytical connection signal — not proof of common ownership or coordinated fraud.</p>
            <p className="mt-1 max-w-3xl text-xs text-slate-400">{analysis.connectionScore.definition}</p>
          </div>
          <div className="rounded border border-violet-400/30 bg-slate-950/30 px-4 py-3 text-right"><p className="text-[10px] uppercase tracking-wide text-violet-200">Observable connection count</p><p className="mt-1 font-mono text-2xl text-white">{analysis.connectionScore.value}</p></div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{analysis.connectionScore.components.map((component) => <div key={component.label} className="rounded border border-slate-800 bg-slate-950/30 p-3"><p className="text-xs text-slate-500">{component.label}</p><p className="mt-1 font-mono text-lg text-white">{component.count}</p></div>)}</div>
      </section>

      <ConnectionGraph analysis={analysis} mode={mode} />

      <section className="panel p-5">
        <div className="mb-3 flex items-center gap-2"><ShieldAlert size={18} className="text-amber-300" /><h3 className="text-sm font-semibold uppercase tracking-wide text-white">Observed risk signals</h3></div>
        <ul className="space-y-2 text-sm text-slate-300">{analysis.riskSignals.map((signal) => <li key={signal} className="flex gap-2"><Network size={15} className="mt-0.5 shrink-0 text-violet-300" />{signal}</li>)}</ul>
      </section>

      <section className="panel p-5">
        <div className="mb-4 flex items-center gap-2"><Network size={18} className="text-cyan-300" /><h3 className="text-sm font-semibold uppercase tracking-wide text-white">Wallet activity from live Ethereum data</h3></div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{uniqueActivity.map((activity) => <article key={activity.address} className="rounded border border-slate-800 bg-slate-950/30 p-3"><AddressLink address={activity.address} /><div className="mt-3 flex gap-4 font-mono text-xs"><span><span className="text-slate-500">Retrieved:</span> {activity.transactionCount}</span><span><span className="text-slate-500">Successful:</span> {activity.successfulTransactionCount}</span></div><p className="mt-2 text-xs text-slate-400">Risk level: <span className="text-slate-200">{activity.riskLevel}</span></p><ul className="mt-2 space-y-1 text-xs text-slate-500">{activity.riskSignals.slice(0, 2).map((signal) => <li key={signal}>• {signal}</li>)}</ul><div className="mt-3 border-t border-slate-800 pt-3"><p className="mb-2 text-[10px] uppercase tracking-wide text-slate-500">Latest retrieved transactions</p>{activity.latestTransactions.length === 0 ? <p className="text-xs text-slate-500">No normal transactions returned.</p> : <div className="space-y-2">{activity.latestTransactions.map((transaction) => <div key={transaction.hash} className="flex items-center justify-between gap-2 text-xs"><div className="min-w-0"><TransactionLink transaction={transaction} /><p className="mt-0.5 truncate text-slate-500">{formatTimestamp(transaction.timestamp)} UTC</p></div><span className="shrink-0 font-mono text-slate-300">{transaction.valueEth}</span></div>)}</div>}</div></article>)}</div>
      </section>

      <SharedWalletsList wallets={analysis.sharedWallets} />
      <DirectTransferEvidenceList transfers={analysis.directTransfers} />
      <RelationshipEvidence title="Shared counterparties" description="Addresses that transacted with suspect wallets on both sides of this analysis." connections={analysis.sharedCounterparties} />
      <RelationshipEvidence title="Repeated destination addresses" description="Addresses that received ETH from suspect wallets on both sides of this analysis." connections={analysis.sharedDestinations} />
      <RelationshipEvidence title="Shared funding sources" description="Addresses that sent ETH to suspect wallets on both sides of this analysis." connections={analysis.sharedSources} />
      <TemporalEvidenceList relationships={analysis.temporalRelationships} />

      <section className="panel p-5"><h3 className="text-sm font-semibold uppercase tracking-wide text-white">Analysis scope and limitations</h3><p className="mt-2 text-xs text-slate-500">Source: {analysis.source}. Generated {formatTimestamp(analysis.generatedAt)} UTC.</p><ul className="mt-3 space-y-2 text-sm text-slate-400">{analysis.limitations.map((limitation) => <li key={limitation}>• {limitation}</li>)}</ul></section>
    </div>
  );
}
