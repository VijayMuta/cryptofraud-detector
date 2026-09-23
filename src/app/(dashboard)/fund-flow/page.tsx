'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { FundFlowCanvas } from '@/components/fund-flow-graph';
import { CaseConnectionAnalysisPanel } from '@/components/case-connection-analysis';
import { authenticatedFetch } from '@/lib/client-api';
import type { InvestigationCase, CaseWallet } from '@/lib/cases';
import type { CaseConnectionAnalysis } from '@/lib/case-analysis';
import type { WalletEvidence } from '@/lib/freeze-hold';
import { buildFundFlow, DEFAULT_FLOW_FILTERS, parseMinimumEth, type FlowFilters } from '@/lib/fund-flow';
import { formatEth } from '@/lib/wallet-analysis';

type CaseRecord = InvestigationCase & { wallets: CaseWallet[] };
const input = 'mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white';
const button = 'rounded-xl border border-cyan-400/25 px-4 py-3 text-sm text-cyan-100 hover:bg-cyan-400/10 disabled:opacity-40';

export default function FundFlowPage() {
  const [cases, setCases] = useState<CaseRecord[]>([]), [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    authenticatedFetch('/api/cases', { signal: controller.signal }).then(r => r.json()).then(data => {
      if (!controller.signal.aborted) {
        setCases(data.cases);
        const requested = new URLSearchParams(window.location.search).get('case');
        if (data.cases.some((item: CaseRecord) => item.id === requested)) setSelected(requested!);
      }
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  const record = cases.find(item => item.id === selected);
  return <div className="space-y-6 pb-10">
    <Link href={selected ? `/investigation-timeline?case=${encodeURIComponent(selected)}` : '/investigation-timeline'} className="inline-block text-sm text-cyan-200">Open Investigation Timeline →</Link>
    <header className="panel-primary p-6"><p className="eyebrow">Blockchain evidence</p><h1 className="mt-3 text-3xl font-semibold text-white">Fund Flow Graph</h1><p className="mt-3 text-sm">Explore observed transfers, connected case wallets, and existing analytical signals.</p></header>
    <section className="panel space-y-4 p-5"><label className="block text-sm">Investigation / Case<select className={input} value={selected} disabled={loading} onChange={e => setSelected(e.target.value)}><option value="">{loading ? 'Loading cases…' : 'Select a case'}</option>{cases.map(item => <option key={item.id} value={item.id}>{item.case_code} · {item.title}</option>)}</select></label>
      {error && <p role="alert" className="text-red-300">{error} <button className={button} onClick={() => setAttempt(n => n + 1)}>Retry</button></p>}
      {!loading && !error && !cases.length && <p>No cases available. <Link href="/cases" className="text-cyan-200">Create a case</Link> to begin.</p>}
    </section>
    {record && <Workspace key={record.id} record={record} />}
    <section className="panel space-y-3 p-5 text-xs leading-6 text-slate-400"><p>Graph connections represent observed blockchain transactions or evidence-backed aggregates. Connections do not by themselves prove common ownership, coordination, or fraudulent activity.</p><p>Custodial attribution is shown only when supported by a verified attribution record.</p></section>
  </div>;
}

function Workspace({ record }: { record: CaseRecord }) {
  const [wallets, setWallets] = useState<WalletEvidence[]>([]), [connections, setConnections] = useState<CaseConnectionAnalysis | null>(null);
  const [attempt, setAttempt] = useState(0), [loading, setLoading] = useState(false), [warnings, setWarnings] = useState<string[]>([]);
  const [filters, setFilters] = useState(DEFAULT_FLOW_FILTERS), [minimum, setMinimum] = useState('0');
  const minWei = parseMinimumEth(minimum);
  const graph = useMemo(() => buildFundFlow(record.wallets.map(w => w.address), wallets, { ...filters, minWei: minWei ?? 0n }), [record, wallets, filters, minWei]);
  useEffect(() => {
    if (!attempt) return;
    const controller = new AbortController();
    setLoading(true); setWallets([]); setConnections(null); setWarnings([]);
    async function load() {
      const collected: WalletEvidence[] = [], issues: string[] = [];
      for (const wallet of record.wallets) {
        if (controller.signal.aborted) return;
        try { collected.push(await (await authenticatedFetch(`/api/wallet?address=${encodeURIComponent(wallet.address)}`, { signal: controller.signal })).json()); }
        catch (e) { issues.push(`${wallet.address}: ${e instanceof Error ? e.message : 'Evidence unavailable'}`); }
      }
      let analysis: CaseConnectionAnalysis | null = null;
      if (record.wallets.length > 1 && !controller.signal.aborted) {
        try { analysis = (await (await authenticatedFetch(`/api/cases/${encodeURIComponent(record.id)}/analysis`, { signal: controller.signal })).json()).analysis; }
        catch { issues.push('Cross-wallet analysis unavailable. Graph still uses retrieved wallet evidence.'); }
      }
      if (!controller.signal.aborted) { setWallets(collected); setConnections(analysis); setWarnings(issues); setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [attempt, record]);
  return <>
    <section className="panel space-y-4 p-5"><h2 className="text-lg font-semibold text-white">{record.case_code} · {record.title}</h2><p className="break-all text-xs">Case ID: {record.id} · Network: Ethereum Mainnet</p><h3 className="text-sm">Reported / suspect wallets</h3>{record.wallets.map(w => <p key={w.id} className="break-all font-mono text-xs">{w.address}</p>)}{!record.wallets.length && <p>No case wallets. <Link href={`/cases/${record.id}`} className="text-cyan-200">Add wallets to this case</Link>.</p>}
      <button className={button} disabled={loading || !record.wallets.length} onClick={() => setAttempt(n => n + 1)}>{loading ? 'Loading evidence…' : 'Load / Refresh Graph Evidence'}</button>
      <p role="status" className="text-sm">{graph.retrieved} unique transactions retrieved · {wallets.length}/{record.wallets.length} wallet datasets loaded</p>
      {wallets.map(w => <p key={w.address} className="break-all text-xs text-slate-400">{w.address} · {w.dataSource} · Evidence timestamp: {w.verifiedAt || 'Unavailable'}</p>)}
      {!attempt && <p className="text-xs text-slate-400">Evidence has not been loaded.</p>}{warnings.map(w => <p key={w} role="alert" className="break-words text-xs text-amber-200">{w}</p>)}
    </section>
    <section className="panel space-y-4 p-5"><h2 className="text-lg font-semibold text-white">Graph filters</h2><div className="grid gap-4 sm:grid-cols-3"><label className="text-sm">Direction relative to case wallets<select className={input} value={filters.direction} onChange={e => setFilters({ ...filters, direction: e.target.value as FlowFilters['direction'] })}><option value="all">All</option><option value="incoming">Incoming</option><option value="outgoing">Outgoing</option></select></label><label className="text-sm">Minimum observed value (ETH)<input className={input} value={minimum} inputMode="decimal" onChange={e => setMinimum(e.target.value)} aria-invalid={minWei === null} /></label><label className="text-sm">Transaction limit<select className={input} value={filters.limit} onChange={e => setFilters({ ...filters, limit: Number(e.target.value) })}>{[20, 40, 100].map(n => <option key={n}>{n}</option>)}</select></label></div>
      {minWei === null && <p role="alert" className="text-amber-200 text-xs">Enter a nonnegative ETH amount with up to 18 decimals. Showing zero minimum until corrected.</p>}
      <div className="flex flex-wrap gap-5 text-sm"><label><input type="checkbox" checked={filters.repeatedOnly} onChange={e => setFilters({ ...filters, repeatedOnly: e.target.checked })} /> Show only repeated destinations</label><label><input type="checkbox" checked={filters.splittingOnly} onChange={e => setFilters({ ...filters, splittingOnly: e.target.checked })} /> Show fund-splitting paths</label></div>
    </section>
    <section className="panel p-5"><h2 className="text-lg font-semibold text-white">Fund-flow summary</h2><dl className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-4">{[['Wallets visualized', graph.nodes.length], ['Observed transfers', graph.displayed], ['Total observed value', formatEth(graph.totalWei)], ['Unique counterparties', graph.counterparties], ['Repeated destinations', graph.repeatedDestinations], ['Fund-splitting signals', graph.splittingSignals], ['Verified custodial endpoints', graph.verifiedEndpoints]].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1 text-lg text-white">{value}</dd></div>)}</dl><p className="mt-4 text-xs leading-6 text-slate-400">Showing {graph.displayed} of {graph.matching} matching transfers ({graph.eligible} eligible; {graph.retrieved} retrieved). Maximum 24 nodes / 100 transfers. Totals describe the displayed subset; signal badges use the retrieved evidence. {graph.excluded} records excluded: failed/unknown receipts, zero or missing values, missing endpoints, conflicts, or unrelated evidence. {graph.conflicts} conflicting hashes excluded. Recent normal Ethereum transfers only; not complete blockchain history, token transfers, or internal transfers.</p></section>
    <FundFlowCanvas graph={graph} caseId={record.id} />
    {connections && <details className="panel p-5"><summary className="cursor-pointer text-sm text-cyan-200">Existing cross-wallet intelligence</summary><p className="my-3 text-xs text-slate-400">Separate evidence retrieval at {connections.generatedAt}; these analytical relationships do not create graph edges.</p><CaseConnectionAnalysisPanel analysis={connections} mode="case" /></details>}
  </>;
}
