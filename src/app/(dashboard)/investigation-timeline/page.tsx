'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { authenticatedFetch } from '@/lib/client-api';
import { buildInvestigationTimeline, linkedReportIds, orderTimeline, TIMELINE_DISCLAIMER, TIMELINE_FILTERS, type TimelineCase, type TimelineEvent, type TimelineFilter } from '@/lib/investigation-timeline';
import type { WalletEvidence } from '@/lib/freeze-hold';
import type { VictimReport } from '@/lib/victim-reports';
import type { CaseConnectionAnalysis } from '@/lib/case-analysis';

const inputClass = 'mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white';
const buttonClass = 'rounded-xl border border-cyan-400/25 px-4 py-2.5 text-sm text-cyan-100 hover:bg-cyan-400/10 disabled:opacity-40';
const displayTime = (value: string | null) => value ? new Date(value).toISOString().replace('T', ' ').replace('Z', ' UTC') : 'Timestamp unavailable';

export default function InvestigationTimelinePage() {
  const [cases, setCases] = useState<TimelineCase[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    authenticatedFetch('/api/cases', { signal: controller.signal }).then(response => response.json()).then(data => {
      if (controller.signal.aborted) return;
      if (!Array.isArray(data.cases)) throw new Error('Case evidence unavailable.');
      setCases(data.cases);
      const requested = new URLSearchParams(window.location.search).get('case');
      if (data.cases.some((record: TimelineCase) => record.id === requested)) setSelected(requested!);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  const record = cases.find(record => record.id === selected);
  return <div className="space-y-6 pb-10">
    <header className="panel-primary p-6">
      <p className="eyebrow">CHAINTRACE / Case chronology</p>
      <h1 className="mt-3 text-3xl font-semibold text-white">Investigation Timeline</h1>
      <p className="mt-3 text-sm text-slate-300">Follow observed transfers, review investigative signals, and inspect the evidence behind each event.</p>
    </header>
    <section className="panel space-y-4 p-5">
      <label className="block text-sm">Investigation / Case<select className={inputClass} value={selected} disabled={loading} onChange={event => setSelected(event.target.value)}><option value="">{loading ? 'Loading cases…' : 'Select a case'}</option>{cases.map(record => <option key={record.id} value={record.id}>{record.case_code} · {record.title}</option>)}</select></label>
      {error && <p role="alert" className="text-red-300">{error} <button className={buttonClass} onClick={() => setAttempt(value => value + 1)}>Retry</button></p>}
      {!loading && !error && !cases.length && <p>No cases available. <Link href="/cases" className="text-cyan-200">Create a case</Link> to begin.</p>}
      {!loading && cases.length > 0 && !record && <p className="text-sm text-slate-400">Select a case to review its chronology.</p>}
    </section>
    <section className="panel space-y-2 p-5 text-xs leading-6 text-slate-400"><p>{TIMELINE_DISCLAIMER}</p><p>CHAINTRACE does not autonomously freeze, reverse, seize, or block blockchain assets.</p></section>
    {record && <TimelineWorkspace key={record.id} record={record} />}
  </div>;
}

function TimelineWorkspace({ record }: { record: TimelineCase }) {
  const [wallets, setWallets] = useState<WalletEvidence[]>([]);
  const [reports, setReports] = useState<VictimReport[]>([]);
  const [connections, setConnections] = useState<CaseConnectionAnalysis | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [filter, setFilter] = useState<TimelineFilter>('All');
  const [order, setOrder] = useState<'oldest' | 'newest'>('oldest');
  const [selectedId, setSelectedId] = useState('');
  const [limit, setLimit] = useState(100);
  useEffect(() => {
    if (!attempt) return;
    const controller = new AbortController();
    const options = { signal: controller.signal };
    setLoading(true); setWallets([]); setReports([]); setConnections(null); setIssues([]); setSelectedId('');
    async function load() {
      const collected: WalletEvidence[] = [], loadedReports: VictimReport[] = [], warnings: string[] = [];
      for (const wallet of record.wallets) {
        if (controller.signal.aborted) return;
        try { collected.push(await (await authenticatedFetch(`/api/wallet?address=${encodeURIComponent(wallet.address)}`, options)).json()); }
        catch (error) { warnings.push(`${wallet.address}: ${error instanceof Error ? error.message : 'Wallet evidence unavailable.'}`); }
      }
      for (const id of linkedReportIds(record)) {
        if (controller.signal.aborted) return;
        try { loadedReports.push((await (await authenticatedFetch(`/api/victim-reports/${encodeURIComponent(id)}`, options)).json()).report); }
        catch { warnings.push(`Referenced victim report ${id} unavailable to this session.`); }
      }
      let analysis: CaseConnectionAnalysis | null = null;
      if (record.wallets.length > 1 && !controller.signal.aborted) {
        try { analysis = (await (await authenticatedFetch(`/api/cases/${encodeURIComponent(record.id)}/analysis`, options)).json()).analysis; }
        catch { warnings.push('Cross-wallet analysis unavailable. Retrieved transfers remain available.'); }
      }
      if (!controller.signal.aborted) { setWallets(collected); setReports(loadedReports); setConnections(analysis); setIssues(warnings); setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [attempt, record]);
  const timeline = useMemo(() => buildInvestigationTimeline({ record, wallets, reports, connections }), [record, wallets, reports, connections]);
  const ordered = useMemo(() => orderTimeline(timeline.events, order, filter), [timeline, order, filter]);
  const selected = timeline.events.find(event => event.id === selectedId);
  const shownDated = ordered.dated.slice(0, limit);
  const shownUndated = ordered.undated.slice(0, Math.max(0, limit - shownDated.length));
  const total = ordered.dated.length + ordered.undated.length;
  const selectEvent = (event: TimelineEvent) => setSelectedId(event.id);
  return <>
    <section className="panel space-y-4 p-5">
      <h2 className="text-lg font-semibold text-white">{record.case_code} · {record.title}</h2>
      <div className="flex flex-wrap items-center gap-4"><button className={buttonClass} disabled={loading} onClick={() => setAttempt(value => value + 1)}>{loading ? 'Loading evidence…' : 'Load / Refresh Evidence'}</button><Link className="text-sm text-cyan-200" href={`/fund-flow?case=${encodeURIComponent(record.id)}`}>Fund Flow Graph</Link><Link className="text-sm text-cyan-200" href={`/freeze-hold?case=${encodeURIComponent(record.id)}`}>Freeze/Hold Intelligence</Link><Link className="text-sm text-cyan-200" href="/reports">Reports</Link></div>
      <p role="status" className="text-sm text-slate-300">{wallets.length}/{record.wallets.length} wallet datasets loaded · {timeline.transferCount} unique observed transfers</p>
      {!attempt && <p className="text-xs text-slate-400">Case records are shown below. Load evidence to retrieve blockchain activity and explicitly referenced victim reports.</p>}
      {!record.wallets.length && <p className="text-sm">No wallets in this case. <Link href={`/cases/${record.id}`} className="text-cyan-200">Add case wallets</Link>.</p>}
      {attempt > 0 && !loading && !timeline.transferCount && <p className="text-sm text-slate-400">No eligible transfers in the retrieved evidence. This does not establish an absence of activity.</p>}
      {wallets.map(wallet => <p key={wallet.address} className="break-all text-xs text-slate-400">{wallet.address} · {wallet.dataSource} · Retrieved: {wallet.verifiedAt || 'Unavailable'}</p>)}
      {issues.map(issue => <p key={issue} role="alert" className="break-words text-xs text-amber-200">{issue}</p>)}
      <details className="text-xs leading-6 text-slate-400"><summary className="cursor-pointer text-cyan-200">Evidence coverage and limitations</summary><p>Only retrieved normal Ethereum Mainnet transfers with successful execution and positive value are shown. Token transfers, internal transfers, and complete historical coverage are not provided. Signals reference their supporting hashes; they are not additional transfers. Victim reports are included only when explicitly referenced by the case. Freeze/Hold drafts and report exports are not persisted evidence of external escalation and are not added as events.</p>{timeline.warnings.map((warning, index) => <p key={index} className="mt-2">{warning}</p>)}</details>
    </section>
    <section className="panel space-y-4 p-5">
      <div className="flex flex-wrap gap-2" aria-label="Timeline categories">{TIMELINE_FILTERS.map(value => <button key={value} aria-pressed={filter === value} className={`${buttonClass} ${filter === value ? 'bg-cyan-400/15' : ''}`} onClick={() => { setFilter(value); setLimit(100); }}>{value}</button>)}</div>
      <label className="block max-w-xs text-sm">Chronological order<select className={inputClass} value={order} onChange={event => { setOrder(event.target.value as 'oldest' | 'newest'); setLimit(100); }}><option value="oldest">Oldest → Newest</option><option value="newest">Newest → Oldest</option></select></label>
    </section>
    <div className="grid items-start gap-6 xl:grid-cols-[1.2fr_1fr]">
      <section className="panel min-w-0 p-5" aria-label="Chronological timeline" aria-busy={loading}>
        <h2 className="text-lg font-semibold text-white">Chronological evidence</h2><p className="mt-2 text-xs text-slate-400">All times displayed in UTC. {total} events match this filter.</p>
        {!total && <p className="py-6 text-sm text-slate-400">No evidence events match this category.</p>}
        <ol className="mt-5 space-y-3 border-l border-cyan-400/25 pl-4">{shownDated.map(event => <EventCard key={event.id} event={event} selected={event.id === selectedId} onSelect={selectEvent} />)}</ol>
        {ordered.undated.length > 0 && <><h3 className="mt-8 text-sm font-semibold text-amber-200">Timestamp unavailable</h3><p className="mt-2 text-xs text-slate-400">These records have no reliable single event time and are not placed in the chronology.</p><ol className="mt-4 space-y-3">{shownUndated.map(event => <EventCard key={event.id} event={event} selected={event.id === selectedId} onSelect={selectEvent} />)}</ol></>}
        {total > limit && <button className={`${buttonClass} mt-5`} onClick={() => setLimit(value => value + 100)}>Show more evidence ({total - limit} remaining)</button>}
      </section>
      <aside className="panel min-w-0 p-5 xl:sticky xl:top-5" aria-label="Evidence Inspector">
        <h2 className="text-lg font-semibold text-white">Evidence Inspector</h2>
        {!selected ? <p className="mt-4 text-sm text-slate-400">Select a timeline event to inspect its source records.</p> : <div className="mt-4 space-y-4 text-sm">
          <h3 className="text-cyan-200">{selected.type}</h3><p>{selected.description}</p><p className="text-xs text-slate-400">{selected.timestampMeaning}: {displayTime(selected.timestamp)}</p><p className="text-xs">Source: {selected.source}</p>
          {selected.addresses.map((address, index) => { const attribution = timeline.attributions.find(item => item.address === address.toLowerCase()); return <div key={`${address}:${index}`} className="break-all text-xs"><p className="font-mono">{address}</p><p className="mt-1 text-slate-400">{attribution?.status || 'UNATTRIBUTED / UNKNOWN'}{attribution?.status === 'VERIFIED' ? ` · ${attribution.attribution}` : ''}</p></div>; })}
          {selected.hashes.length > 0 && <details open><summary className="text-xs text-cyan-200">Supporting transaction hashes ({selected.hashes.length})</summary>{selected.hashes.map(hash => <p key={hash} className="mt-2 break-all font-mono text-xs">{hash}</p>)}</details>}
          <details open><summary className="cursor-pointer text-cyan-200">Underlying evidence (exact available fields)</summary><pre className="mt-3 max-h-[36rem] overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-950 p-3 text-xs leading-6">{JSON.stringify(selected.details, null, 2)}</pre></details>
        </div>}
      </aside>
    </div>
  </>;
}

function EventCard({ event, selected, onSelect }: { event: TimelineEvent; selected: boolean; onSelect: (event: TimelineEvent) => void }) {
  return <li><button onClick={() => onSelect(event)} aria-pressed={selected} className={`w-full space-y-2 rounded-xl border p-4 text-left hover:bg-cyan-400/5 ${selected ? 'border-cyan-300 bg-cyan-400/10' : 'border-slate-700 bg-slate-950/40'}`}>
    <span className="inline-block rounded-full border border-cyan-400/25 px-2 py-1 text-xs text-cyan-200">{event.type}</span><span className="block text-xs text-slate-400">{displayTime(event.timestamp)} · {event.timestampMeaning}</span>
    <span className="block text-sm text-slate-200">{event.description}</span>
    {event.addresses.map((address, index) => <span key={`${address}:${index}`} className="block break-all font-mono text-xs text-slate-300">{address}</span>)}
    {event.valueWei !== undefined && <span className="block break-all text-xs text-cyan-100">Observed value: {event.valueWei} wei (ETH)</span>}
    {event.category === 'Transfers' && <span className="block break-all font-mono text-xs text-slate-400">Transaction: {event.hashes[0]}</span>}
    <span className="block text-xs text-slate-500">{event.network ? `${event.network} · ` : ''}{event.source}</span>
  </button></li>;
}
