'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  ExternalLink,
  GitBranch,
  Loader2,
  Network,
  Search,
  ShieldCheck,
  Waypoints,
} from 'lucide-react';
import { analyzeWalletTransactions, formatEth, type WalletTransaction } from '@/lib/wallet-analysis';
import { authenticatedFetch } from '@/lib/client-api';

type AddressResult = {
  address: string;
  balanceWei: string;
  transactionCount: number;
  transactions: WalletTransaction[];
  dataSource: string;
  network: string;
  verifiedAt: string;
};

type TransactionResult = {
  hash: string;
  from: string;
  to: string | null;
  valueWei: string;
  valueEth: string;
  blockNumber: string | null;
  timestamp: string | null;
  status: 'success' | 'failed' | 'unknown';
};

type TransactionResponse = {
  transaction: TransactionResult;
  dataSource: string;
  network: string;
  verifiedAt: string;
};

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isWalletTransaction(value: unknown): value is WalletTransaction {
  return isRecord(value)
    && typeof value.hash === 'string'
    && typeof value.from === 'string'
    && (typeof value.to === 'string' || value.to === null)
    && typeof value.value === 'string'
    && typeof value.blockNumber === 'string'
    && (value.timestamp === null || typeof value.timestamp === 'string')
    && (value.status === 'success' || value.status === 'failed' || value.status === 'unknown');
}

function parseAddressResult(value: unknown): AddressResult | null {
  if (!isRecord(value)
    || typeof value.address !== 'string'
    || typeof value.balanceWei !== 'string'
    || typeof value.transactionCount !== 'number'
    || typeof value.dataSource !== 'string'
    || typeof value.network !== 'string'
    || typeof value.verifiedAt !== 'string') return null;

  return {
    address: value.address,
    balanceWei: value.balanceWei,
    transactionCount: value.transactionCount,
    transactions: Array.isArray(value.transactions) ? value.transactions.filter(isWalletTransaction) : [],
    dataSource: value.dataSource,
    network: value.network,
    verifiedAt: value.verifiedAt,
  };
}

function parseTransactionResponse(value: unknown): TransactionResponse | null {
  if (!isRecord(value) || !isRecord(value.transaction)
    || typeof value.dataSource !== 'string'
    || typeof value.network !== 'string'
    || typeof value.verifiedAt !== 'string') return null;
  const transaction = value.transaction;
  if (typeof transaction.hash !== 'string'
    || typeof transaction.from !== 'string'
    || (typeof transaction.to !== 'string' && transaction.to !== null)
    || typeof transaction.valueWei !== 'string'
    || typeof transaction.valueEth !== 'string'
    || (typeof transaction.blockNumber !== 'string' && transaction.blockNumber !== null)
    || (typeof transaction.timestamp !== 'string' && transaction.timestamp !== null)
    || (transaction.status !== 'success' && transaction.status !== 'failed' && transaction.status !== 'unknown')) return null;

  return { transaction: transaction as TransactionResult, dataSource: value.dataSource, network: value.network, verifiedAt: value.verifiedAt };
}

function abbreviate(value: string, start = 10, end = 8) {
  return value.length > start + end ? `${value.slice(0, start)}...${value.slice(-end)}` : value;
}

function timestamp(value: string | null) {
  if (!value) return 'Unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date);
}

function formatWei(value: string) {
  return /^\d+$/.test(value) ? formatEth(BigInt(value)) : 'Unavailable';
}

export default function BlockchainIntelligence() {
  const [query, setQuery] = useState('');
  const [addressResult, setAddressResult] = useState<AddressResult | null>(null);
  const [transactionResult, setTransactionResult] = useState<TransactionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const analysis = useMemo(
    () => addressResult ? analyzeWalletTransactions(addressResult.address, addressResult.transactions) : null,
    [addressResult],
  );

  useEffect(() => {
    const requestedQuery = new URLSearchParams(window.location.search).get('query');
    if (requestedQuery) setQuery(requestedQuery);
  }, []);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    setError('');
    setAddressResult(null);
    setTransactionResult(null);

    if (!ADDRESS_PATTERN.test(value) && !HASH_PATTERN.test(value)) {
      setError('Enter a valid Ethereum wallet address or transaction hash beginning with 0x.');
      return;
    }

    setLoading(true);
    try {
      const response = await authenticatedFetch(
        ADDRESS_PATTERN.test(value)
          ? `/api/wallet?address=${encodeURIComponent(value)}`
          : `/api/transaction?hash=${encodeURIComponent(value)}`,
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(isRecord(payload) && typeof payload.error === 'string' ? payload.error : 'Unable to retrieve blockchain evidence.');
      }
      if (ADDRESS_PATTERN.test(value)) {
        const result = parseAddressResult(payload);
        if (!result) throw new Error('The wallet service returned an invalid response.');
        setAddressResult(result);
      } else {
        const result = parseTransactionResponse(payload);
        if (!result) throw new Error('The transaction service returned an invalid response.');
        setTransactionResult(result);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to retrieve blockchain evidence.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-10">
      <header className="page-header lg:flex-row">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300">Ethereum Mainnet evidence</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Blockchain Intelligence</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Look up a verified wallet or transaction, inspect direct on-chain relationships, and continue into the full investigation workspace.</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/65 px-3 py-2 text-xs text-slate-300"><ShieldCheck size={14} className="text-cyan-300" />Authenticated, server-side data access</div>
      </header>

      <form onSubmit={search} className="command-panel p-5 sm:p-6">
        <label htmlFor="intelligence-query" className="text-sm font-medium text-slate-200">Ethereum wallet address or transaction hash</label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <div className="relative min-w-0 flex-1"><Search size={18} className="pointer-events-none absolute left-3 top-3 text-cyan-300" /><input id="intelligence-query" value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" spellCheck={false} placeholder="0x…" className="w-full rounded-xl border border-slate-700 bg-slate-950 py-3 pl-10 pr-3 font-mono text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/15" /></div>
          <button disabled={loading} className="button-primary px-5 py-3">{loading ? <Loader2 size={17} className="animate-spin" /> : <Search size={17} />}{loading ? 'Retrieving evidence' : 'Search Ethereum'}</button>
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500">Wallet searches return balance, nonce, and retrieved normal ETH transfers. Transaction searches return a verified Ethereum transaction and receipt status when available.</p>
        {error && <p role="alert" className="mt-4 flex gap-2 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200"><AlertCircle size={17} className="shrink-0" />{error}</p>}
      </form>

      {addressResult && analysis && <>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Wallet balance" value={formatWei(addressResult.balanceWei)} detail="Verified Ethereum balance" />
          <Metric label="Transaction count" value={String(addressResult.transactionCount)} detail="Ethereum account nonce" />
          <Metric label="Retrieved transfers" value={String(addressResult.transactions.length)} detail="Normal ETH transfer evidence" />
          <Metric label="Direct counterparties" value={String(analysis.counterparties.length)} detail="Successful retrieved transfers" />
        </section>
        <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2 text-cyan-300"><Waypoints size={18} /><p className="text-xs font-medium uppercase tracking-wide">Direct fund-flow evidence</p></div><h2 className="mt-2 text-lg font-semibold text-white">Connected address discovery</h2><p className="mt-1 text-sm text-slate-400">Only direct counterparties from retrieved successful normal ETH transfers are shown.</p></div><Link href={`/investigate?address=${encodeURIComponent(addressResult.address)}`} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-cyan-200 hover:text-cyan-100">Full investigation <ArrowRight size={16} /></Link></div>
            {analysis.counterparties.length === 0 ? <Empty message="No direct counterparties were found in the retrieved successful transfers." /> : <div className="mt-5 space-y-2">{analysis.counterparties.slice(0, 8).map((counterparty) => <a key={counterparty.address} href={`https://etherscan.io/address/${counterparty.address}`} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/45 p-3 transition hover:border-cyan-400/30"><div className="min-w-0"><p className="truncate font-mono text-sm text-cyan-200" title={counterparty.address}>{abbreviate(counterparty.address)}</p><p className="mt-1 text-xs text-slate-500">{counterparty.incomingCount + counterparty.outgoingCount} observed direct interaction{counterparty.incomingCount + counterparty.outgoingCount === 1 ? '' : 's'}</p></div><ExternalLink size={16} className="shrink-0 text-slate-500" /></a>)}</div>}
          </div>
          <aside className="rounded-2xl border border-violet-400/20 bg-violet-400/[0.045] p-5 sm:p-6"><div className="flex items-center gap-2 text-violet-200"><GitBranch size={18} /><p className="text-xs font-medium uppercase tracking-wide">Observed behavior</p></div><h2 className="mt-2 text-lg font-semibold text-white">Money Fingerprint preview</h2><dl className="mt-5 space-y-3 text-sm"><Row label="Incoming funds" value={formatEth(analysis.totalReceivedWei)} /><Row label="Outgoing funds" value={formatEth(analysis.totalSentWei)} /><Row label="Largest transfer" value={analysis.largestTransaction ? formatEth(analysis.largestTransaction.valueWei) : 'Unavailable'} /><Row label="Transfer frequency" value={analysis.frequency.transactionsPerDay === null ? 'Unavailable' : `${analysis.frequency.transactionsPerDay.toFixed(2)} / day`} /></dl><p className="mt-5 text-xs leading-5 text-violet-100">Money Fingerprint summarizes observable transaction behavior. It does not by itself establish fraud.</p></aside>
        </section>
        <EvidenceSource source={addressResult.dataSource} network={addressResult.network} verifiedAt={addressResult.verifiedAt} />
      </>}

      {transactionResult && <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]"><div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 sm:p-6"><div className="flex items-center gap-2 text-cyan-300"><Network size={18} /><p className="text-xs font-medium uppercase tracking-wide">Verified transaction evidence</p></div><h2 className="mt-2 text-lg font-semibold text-white">Transaction timeline entry</h2><dl className="mt-5 divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/45"><Detail label="Status" value={transactionResult.transaction.status} /><Detail label="From" value={transactionResult.transaction.from} address /><Detail label="To" value={transactionResult.transaction.to || 'Contract creation'} address={Boolean(transactionResult.transaction.to)} /><Detail label="Value" value={`${transactionResult.transaction.valueEth} ETH`} /><Detail label="Block" value={transactionResult.transaction.blockNumber || 'Unavailable'} /><Detail label="Timestamp" value={timestamp(transactionResult.transaction.timestamp)} /><Detail label="Transaction hash" value={transactionResult.transaction.hash} address /></dl></div><aside className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.05] p-5 sm:p-6"><p className="text-xs font-medium uppercase tracking-wide text-cyan-300">Flow relationship</p><div className="mt-5 space-y-3 text-center font-mono text-xs"><Node value={transactionResult.transaction.from} label="Sender" /><ArrowRight className="mx-auto text-cyan-300" size={18} /><Node value={transactionResult.transaction.to || 'Contract creation'} label="Recipient" /></div><p className="mt-6 text-xs leading-5 text-slate-400">This visualization reports the transaction&apos;s on-chain sender and recipient only. It does not verify wallet ownership or service identity.</p><a href={`https://etherscan.io/tx/${transactionResult.transaction.hash}`} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-cyan-200 hover:text-cyan-100">View source transaction <ExternalLink size={15} /></a></aside><EvidenceSource source={transactionResult.dataSource} network={transactionResult.network} verifiedAt={transactionResult.verifiedAt} /></section>}

      {!addressResult && !transactionResult && !loading && !error && <Empty message="Search an Ethereum wallet or transaction hash to begin a verified blockchain intelligence review." />}
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 break-words font-mono text-lg text-white">{value}</p><p className="mt-2 text-xs text-slate-500">{detail}</p></article>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-3"><dt className="text-slate-400">{label}</dt><dd className="max-w-[60%] text-right font-mono text-slate-100">{value}</dd></div>;
}

function Detail({ label, value, address = false }: { label: string; value: string; address?: boolean }) {
  return <div className="grid gap-2 p-4 sm:grid-cols-[10rem_minmax(0,1fr)]"><dt className="text-sm text-slate-500">{label}</dt><dd className={`break-all text-sm text-slate-200 ${address ? 'font-mono text-cyan-200' : ''}`}>{value}</dd></div>;
}

function Node({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-cyan-400/20 bg-slate-950/45 p-3"><p className="text-[10px] uppercase tracking-[0.15em] text-cyan-300">{label}</p><p className="mt-2 break-all text-slate-100">{value}</p></div>;
}

function EvidenceSource({ source, network, verifiedAt }: { source: string; network: string; verifiedAt: string }) {
  return <p className="text-xs leading-5 text-slate-500">Data source: <span className="text-slate-300">{source}</span> · {network} · last verified {timestamp(verifiedAt)} UTC.</p>;
}

function Empty({ message }: { message: string }) {
  return <section className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/30 p-10 text-center text-sm text-slate-500">{message}</section>;
}
