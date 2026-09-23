'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '@/lib/client-api';
import { downloadFile } from '@/lib/download';
import { EvidenceIntegrity, useEvidenceIntegrity } from '@/components/evidence-integrity';
import { createEvidencePayload } from '@/lib/evidence-integrity';
import { buildCaseEvidencePackage, type CaseEvidencePackage } from '@/lib/case-evidence-package';
import { linkedReportIds, type TimelineCase } from '@/lib/investigation-timeline';
import type { WalletEvidence } from '@/lib/freeze-hold';
import type { VictimReport } from '@/lib/victim-reports';
import type { CaseConnectionAnalysis } from '@/lib/case-analysis';

export default function EvidencePackagePage() {
  const [cases, setCases] = useState<TimelineCase[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<CaseEvidencePackage | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    authenticatedFetch('/api/cases', { signal: controller.signal }).then(response => response.json()).then(data => {
      if (!Array.isArray(data.cases)) throw new Error('Case records unavailable.');
      if (!controller.signal.aborted) setCases(data.cases);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); request.current?.abort(); };
  }, [attempt]);
  const record = cases.find(item => item.id === selected);
  const payload = snapshot ? createEvidencePayload('case-evidence-package', snapshot) : null;
  const integrity = useEvidenceIntegrity(payload, { caseId: snapshot?.privateRecords.case.id, caseCode: snapshot?.privateRecords.case.case_code });

  async function generate() {
    if (!record) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const options = { signal: controller.signal };
    setBusy(true); setSnapshot(null); setError('');
    try {
      // Refresh the selected private record before retrieving its evidence.
      const data = await (await authenticatedFetch(`/api/cases/${encodeURIComponent(record.id)}`, options)).json();
      const current: TimelineCase = data.case;
      if (!current || current.id !== record.id || !Array.isArray(current.wallets)) throw new Error('Selected case record unavailable.');
      const wallets: WalletEvidence[] = [], reports: VictimReport[] = [], issues: string[] = [];
      for (const wallet of current.wallets) {
        if (controller.signal.aborted) return;
        if (wallet.network !== 'ethereum') { issues.push(`${wallet.address}: unsupported network; evidence unavailable.`); continue; }
        try {
          const result = await (await authenticatedFetch(`/api/wallet?address=${encodeURIComponent(wallet.address)}`, options)).json();
          if (typeof result.address !== 'string' || result.address.toLowerCase() !== wallet.address.toLowerCase() || !Array.isArray(result.transactions) || typeof result.network !== 'string' || typeof result.dataSource !== 'string' || typeof result.verifiedAt !== 'string') throw new Error('Invalid wallet evidence response.');
          wallets.push(result);
        } catch { issues.push(`${wallet.address}: wallet evidence unavailable from the existing API.`); }
      }
      for (const id of linkedReportIds(current)) {
        if (controller.signal.aborted) return;
        try {
          const result = await (await authenticatedFetch(`/api/victim-reports/${encodeURIComponent(id)}`, options)).json();
          if (result.report?.id?.toLowerCase() !== id) throw new Error('Report unavailable.');
          reports.push(result.report);
        } catch { issues.push(`Referenced private report ${id} unavailable to this session.`); }
      }
      let connections: CaseConnectionAnalysis | null = null;
      if (current.wallets.length > 1 && !controller.signal.aborted) {
        try {
          const result = await (await authenticatedFetch(`/api/cases/${encodeURIComponent(current.id)}/analysis`, options)).json();
          if (result.analysis?.caseA?.id !== current.id || result.analysis?.caseB?.id !== current.id) throw new Error('Analysis unavailable.');
          connections = result.analysis;
        } catch { issues.push('Cross-wallet analysis unavailable from the existing API.'); }
      }
      if (!controller.signal.aborted) setSnapshot(buildCaseEvidencePackage({ record: current, wallets, reports, connections, issues, generatedAt: new Date().toISOString() }));
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Package generation failed.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }

  function exportJson() {
    if (!snapshot || !integrity.record) return;
    try { downloadFile(`${snapshot.privateRecords.case.case_code.replace(/[^a-z0-9_-]/gi, '-')}-evidence-package.json`, JSON.stringify({ ...snapshot, integrity: integrity.record }, null, 2) + '\n', 'application/json'); }
    catch { setError('Download unavailable. Please try again.'); }
  }

  return <div className="case-evidence-package mx-auto max-w-6xl space-y-6 pb-10">
    <header className="panel-primary p-6"><Link href="/reports" className="text-sm text-cyan-200 print:hidden">← Reports</Link><p className="eyebrow mt-4">CHAINTRACE / Investigation documentation</p><h1 className="mt-3 text-3xl font-semibold text-white">Case Evidence Package</h1><p className="mt-3 text-sm text-slate-300">A source-backed snapshot of private case records, retrieved blockchain evidence and investigative signals.</p></header>
    <section className="panel space-y-4 p-5 print:hidden">
      <label className="block text-sm" htmlFor="package-case">Existing private case</label><select id="package-case" className="field" value={selected} disabled={loading} onChange={event => { request.current?.abort(); setSelected(event.target.value); setSnapshot(null); setBusy(false); setError(''); }}><option value="">{loading ? 'Loading cases…' : 'Select a case'}</option>{cases.map(item => <option key={item.id} value={item.id}>{item.case_code} · {item.title}</option>)}</select>
      <p className="text-xs leading-6 text-slate-400">Generate retrieves evidence through the existing authenticated APIs. Failed sources remain explicitly unavailable. This export contains private records; review it before sharing.</p>
      <button className="button-primary" disabled={!record || busy || loading} onClick={() => void generate()}>{busy ? 'Retrieving evidence…' : snapshot ? 'Regenerate package' : 'Generate package'}</button>
      {!loading && !cases.length && !error && <p>No cases available. <Link href="/cases" className="text-cyan-200">Create a case</Link> to begin.</p>}
      {error && <p role="alert" className="text-sm text-amber-200">{error} {!cases.length && <button className="button-secondary" onClick={() => setAttempt(value => value + 1)}>Retry cases</button>}</p>}
    </section>
    {snapshot && <>
      <PackagePreview data={snapshot} />
      <EvidenceIntegrity payload={payload} integrity={integrity} />
      <div className="flex flex-wrap gap-3 print:hidden"><button className="button-primary" disabled={!integrity.record} onClick={exportJson}>Download JSON</button><button className="button-secondary" disabled={!integrity.record} onClick={() => window.print()}>Print / Save as PDF</button></div>
    </>}
  </div>;
}

function PackagePreview({ data }: { data: CaseEvidencePackage }) {
  const record = data.privateRecords.case;
  const sections = [
    { title: 'Observed blockchain evidence', rows: data.observedEvidence.transfers, empty: 'No eligible transfers available; this does not establish absence of activity.' },
    { title: 'Money Fingerprint', rows: data.derivedSignals.moneyFingerprint, empty: data.availability.moneyFingerprint },
    { title: 'Fund Splitting signals', rows: data.derivedSignals.fundSplitting, empty: data.availability.fundSplitting },
    { title: 'Cross-wallet connections', rows: data.derivedSignals.crossWalletConnections, empty: `No timeline connections in this sample. Cross-wallet API: ${data.availability.crossWalletAnalysis}.` },
  ];
  return <article className="space-y-6" aria-label="Evidence package preview">
    <section className="panel space-y-3 p-5"><p className="eyebrow">Private case / report records</p><h2 className="text-xl font-semibold text-white">{record.case_code} · {record.title}</h2><dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt>Case record ID</dt><dd className="break-all">{record.id}</dd></div><div><dt>Status</dt><dd>{record.status}</dd></div><div><dt>Created</dt><dd>{record.created_at || 'Unavailable'}</dd></div><div><dt>Package generated</dt><dd>{data.generatedAt}</dd></div></dl><p className="whitespace-pre-wrap text-sm">{record.description || 'No case notes available.'}</p><h3 className="font-medium">Reported / case wallets</h3>{record.wallets.length ? record.wallets.map(wallet => <p key={wallet.id} className="break-all font-mono text-xs">{wallet.address} · {wallet.network}</p>) : <p>No wallets recorded.</p>}<p className="text-xs text-slate-400">{data.privateRecords.reports.length} explicitly linked private reports included. Allegations are not independently verified.</p>{data.privateRecords.reports.map(report => <p key={report.id} className="text-sm">Report {report.id}: {report.incident_type} · {report.suspect_wallet} · {report.network} · Submitted {report.created_at}</p>)}</section>
    <section className="panel space-y-3 p-5"><h2 className="text-lg font-semibold text-white">Evidence availability</h2><p>{data.availability.walletDatasetsLoaded}/{data.availability.walletDatasetsExpected} wallet datasets loaded.</p>{data.observedEvidence.walletDatasets.map(wallet => <p key={wallet.address} className="break-all text-xs">{wallet.address} · {wallet.dataSource} · Retrieved {wallet.verifiedAt || 'Unavailable'} · {wallet.transactions.length} provider records</p>)}{data.availability.unavailableWallets.map(wallet => <p key={wallet.address} className="break-all text-sm text-amber-200">{wallet.address} ({wallet.network}): {wallet.status}</p>)}{data.availability.unavailableReports.map(id => <p key={id} className="text-sm text-amber-200">Report {id}: UNAVAILABLE</p>)}<p className="text-xs">Cross-wallet API: {data.availability.crossWalletAnalysis}</p><p className="text-xs">Freeze/Hold: {data.availability.freezeHold}</p></section>
    {sections.map(section => <section key={section.title} className="panel space-y-4 p-5"><h2 className="text-lg font-semibold text-white">{section.title}</h2>{!section.rows.length && <p className="text-sm text-slate-400">{section.empty}</p>}{section.rows.map(event => <div key={event.id} className="space-y-2 border-t border-slate-700 pt-3 text-sm"><p className="text-xs uppercase text-cyan-200">{event.classification}</p><p>{event.description}</p><p className="text-xs">{event.timestampMeaning}: {event.timestamp || 'Timestamp unavailable'}</p><p className="break-all text-xs">{event.addresses.join(' → ')}</p>{event.valueWei !== undefined && <p>Value: {event.valueWei} wei</p>}<p className="text-xs text-slate-400">Source: {event.source}</p>{event.hashes.map(hash => <p key={hash} className="break-all font-mono text-xs">{hash}</p>)}{event.id.startsWith('fingerprint:') && <pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(event.details, (key, value) => key === 'evidence' ? undefined : value, 2)}</pre>}</div>)}</section>)}
    {data.derivedSignals.connectionAnalysis && <section className="panel space-y-3 p-5"><h2 className="text-lg font-semibold text-white">Cross-wallet API findings</h2><p className="text-xs text-cyan-200">Derived investigative signals</p><p className="text-xs">{data.derivedSignals.connectionAnalysis.source} · Generated {data.derivedSignals.connectionAnalysis.generatedAt}</p>{data.derivedSignals.connectionAnalysis.riskSignals.map((signal, index) => <p key={index} className="text-sm">{signal}</p>)}{data.derivedSignals.connectionAnalysis.limitations.map((notice, index) => <p key={index} className="text-xs text-slate-400">{notice}</p>)}</section>}
    <section className="panel space-y-3 p-5"><h2 className="text-lg font-semibold text-white">Custodial attribution</h2><p className="text-xs text-slate-400">Only exact matches in the existing trusted registry can establish verified attribution.</p>{!data.custodialAttribution.addresses.length && <p>No addresses available for attribution.</p>}{data.custodialAttribution.addresses.map(item => <div key={`${item.network}:${item.address}`} className="break-all text-sm"><p>{item.address} · {item.network}</p><p className="text-cyan-200">{item.status}</p><p>{item.attribution}</p>{item.status === 'VERIFIED' && item.record && <p>{item.record.entityName} · {item.record.sourceName} · Verified {item.record.verifiedAt}</p>}</div>)}</section>
    <section className="panel space-y-3 p-5"><h2 className="text-lg font-semibold text-white">Investigation Timeline summary</h2><p className="text-sm">{data.investigationTimeline.transferCount} unique eligible transfers · {data.investigationTimeline.datedCount} dated events · {data.investigationTimeline.undatedCount} undated events</p><ol className="space-y-2 text-xs">{data.investigationTimeline.events.map(event => <li key={event.id}>{event.timestamp || 'Undated aggregate / timestamp unavailable'} · {event.type} · {event.classification}<p>{event.description}</p></li>)}</ol></section>
    <section className="panel space-y-3 p-5"><h2 className="text-lg font-semibold text-white">Evidence limitations and investigator disclaimers</h2>{[...data.investigatorDisclaimers, ...data.limitations].map((notice, index) => <p key={index} className="text-sm leading-6">{notice}</p>)}</section>
    <p className="text-xs text-slate-400">This preview and printed report summarize the package. Retain the companion JSON for complete provider records, supporting evidence and independent SHA-256 verification. The fingerprint hashes canonical evidence content, not PDF file bytes.</p>
    <details className="panel p-5 print:hidden"><summary className="cursor-pointer text-cyan-200">Inspect complete package evidence</summary><p className="mt-3 text-xs">Includes raw provider records and full supporting evidence. SHA-256 metadata is attached to the JSON download.</p><pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(data, null, 2)}</pre></details>
  </article>;
}
