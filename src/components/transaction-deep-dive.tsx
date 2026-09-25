'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { authenticatedFetch } from '@/lib/client-api';
import { isTransactionHash, normalizeTransactionEvidence, transactionAttributions, transactionInvestigationContext, TRANSACTION_CONTEXT_NOTICE, type TransactionDeepDiveEvidence } from '@/lib/transaction-deep-dive';
import type { TimelineCase } from '@/lib/investigation-timeline';

export function TransactionDeepDive({ hash, caseId }: { hash: string; caseId: string }) {
  const valid = isTransactionHash(hash);
  const [evidence, setEvidence] = useState<TransactionDeepDiveEvidence | null>(null);
  const [record, setRecord] = useState<TimelineCase | null>(null);
  const [loading, setLoading] = useState(valid);
  const [caseLoading, setCaseLoading] = useState(valid && !!caseId);
  const [error, setError] = useState('');
  const [caseError, setCaseError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    const options = { signal: controller.signal };
    setLoading(true); setEvidence(null); setError(''); setRecord(null); setCaseError(''); setCaseLoading(!!caseId);
    async function loadTransaction() {
      try {
        const data = await (await authenticatedFetch(`/api/transaction?hash=${encodeURIComponent(hash)}`, options)).json();
        const normalized = normalizeTransactionEvidence(data, hash);
        if (!controller.signal.aborted) setEvidence(normalized);
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Transaction provider/API failure. Evidence unavailable.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    async function loadCase() {
      if (!caseId) return;
      try {
        const data = await (await authenticatedFetch(`/api/cases/${encodeURIComponent(caseId)}`, options)).json();
        if (data.case?.id !== caseId || !Array.isArray(data.case.wallets)) throw new Error('Case evidence unavailable.');
        if (!controller.signal.aborted) setRecord(data.case);
      } catch { if (!controller.signal.aborted) setCaseError('Case context unavailable. The case may not exist, may not be accessible to this session, or its API may be unavailable.'); }
      finally { if (!controller.signal.aborted) setCaseLoading(false); }
    }
    void Promise.allSettled([loadTransaction(), loadCase()]);
    return () => controller.abort();
  }, [hash, caseId, valid, attempt]);
  const context = evidence ? transactionInvestigationContext(evidence, record) : null;
  const attributions = evidence ? transactionAttributions(evidence) : [];
  const query = record ? `?case=${encodeURIComponent(record.id)}` : '';
  const membership = (value: boolean | null | undefined) => value === true ? 'Yes — private case record match' : value === false ? 'No match in the selected case' : 'UNAVAILABLE';

  return <div className="mx-auto max-w-6xl space-y-6 pb-10">
    <header className="panel-primary p-6"><p className="eyebrow">CHAINTRACE / Blockchain evidence</p><h1 className="mt-3 text-3xl font-semibold text-white">Transaction Deep Dive</h1><p className="mt-3 text-sm text-slate-300">Inspect retrieved Ethereum transaction evidence and authenticated private case context.</p><p className="mt-4 break-all font-mono text-xs text-cyan-200">Requested hash: {hash}</p></header>
    <nav aria-label="Investigation navigation" className="flex flex-wrap gap-3">
      {record && <Link className="button-secondary" href={`/cases/${encodeURIComponent(record.id)}`}>Case Details</Link>}
      <Link className="button-secondary" href={`/fund-flow${query}`}>Fund Flow Graph</Link>
      <Link className="button-secondary" href={`/investigation-timeline${query}`}>Investigation Timeline</Link>
      <Link className="button-secondary" href={`/blockchain-intelligence${valid ? `?query=${encodeURIComponent(hash)}${record ? `&case=${encodeURIComponent(record.id)}` : ''}` : query}`}>Blockchain Intelligence</Link>
    </nav>
    {!valid && <section className="panel p-5" role="alert"><h2 className="font-semibold text-amber-200">Invalid transaction hash</h2><p className="mt-2 text-sm">Enter a 0x-prefixed Ethereum transaction hash containing exactly 64 hexadecimal characters. No provider request was made.</p></section>}
    {loading && <p className="panel p-5 text-cyan-200" role="status">Loading transaction evidence…</p>}
    {error && <section className="panel space-y-3 p-5" role="alert"><h2 className="font-semibold text-amber-200">Transaction evidence unavailable</h2><p className="text-sm">{error}</p><button className="button-secondary" onClick={() => setAttempt(value => value + 1)}>Retry retrieval</button></section>}
    {evidence && <section className="panel space-y-5 p-5"><h2 className="text-lg font-semibold text-white">Transaction evidence</h2><p className="eyebrow">Observed provider evidence</p><dl className="grid gap-5 sm:grid-cols-2">
      <EvidenceField label="Transaction hash" value={evidence.hash} copy />
      <EvidenceField label="Network" value={evidence.network} />
      <EvidenceField label="Block number" value={evidence.blockNumber} />
      <EvidenceField label="Blockchain timestamp" value={evidence.timestamp} />
      <EvidenceField label="From address" value={evidence.from} copy />
      <EvidenceField label="To address" value={evidence.to} copy />
      <EvidenceField label="Transaction value (ETH)" value={evidence.valueEth} copy />
      <EvidenceField label="Exact transaction value (wei)" value={evidence.valueWei} copy />
      <EvidenceField label="Receipt execution status" value={evidence.status === 'unknown' ? null : evidence.status === 'success' ? 'SUCCESS' : 'FAILED / REVERTED'} />
      <EvidenceField label="Blockchain data source" value={evidence.dataSource} />
      <EvidenceField label="Evidence retrieved at (not blockchain time)" value={evidence.retrievedAt} />
    </dl><p className="text-xs leading-6 text-slate-400">Transaction value is the native ETH value field. A failed or unverified transaction does not establish a completed transfer. A missing recipient, timestamp or block remains unavailable; no replacement value is inferred. Token transfers, internal execution effects and complete wallet history are not included.</p></section>}
    <section className="panel space-y-4 p-5"><h2 className="text-lg font-semibold text-white">Investigation Context</h2><p className="eyebrow">Private case records / deterministic matching</p>
      {caseLoading ? <p role="status" className="text-sm">Loading case context…</p> : caseError ? <p role="status" className="text-sm text-amber-200">{caseError} <button className="button-secondary" onClick={() => setAttempt(value => value + 1)}>Retry</button></p> : !record ? <p className="text-sm text-slate-400">No case context available. Open a transaction from a selected case’s Investigation Timeline or Fund Flow Graph to include its context.</p> : <><p className="text-sm">{record.case_code} · {record.title}</p><p className="text-xs text-slate-400">Matches reflect current Ethereum case wallet records, not wallet ownership or case membership at the blockchain transaction time.</p><dl className="grid gap-4 sm:grid-cols-2"><EvidenceField label="Sender is a case wallet" value={membership(context?.senderIsCaseWallet)} /><EvidenceField label="Recipient is a case wallet" value={membership(context?.recipientIsCaseWallet)} /><EvidenceField label="Both addresses are case wallets" value={context?.senderIsCaseWallet === null || context?.recipientIsCaseWallet === null || !context ? 'UNAVAILABLE' : context.senderIsCaseWallet && context.recipientIsCaseWallet ? 'Yes' : 'No'} /><EvidenceField label="Observed transfer between distinct investigated wallets" value={context?.betweenInvestigatedWallets ? 'Supported by successful execution, positive ETH value and two case wallet matches' : 'Not established by the available evidence'} /></dl></>}
      <p className="text-xs leading-6 text-amber-100">{TRANSACTION_CONTEXT_NOTICE}</p>
    </section>
    <section className="panel space-y-4 p-5"><h2 className="text-lg font-semibold text-white">Custodial attribution</h2>{!attributions.length && <p className="text-sm text-slate-400">UNATTRIBUTED / UNKNOWN — address evidence unavailable.</p>}{attributions.map(endpoint => <div key={endpoint.address} className="space-y-2 border-t border-slate-700 pt-3 text-sm"><p className="break-all font-mono text-xs">{endpoint.address}</p><p className="text-cyan-200">{endpoint.status}</p><p>{endpoint.attribution}</p>{endpoint.status === 'VERIFIED' && endpoint.record && <dl className="grid gap-3 sm:grid-cols-2"><EvidenceField label="Entity / type" value={`${endpoint.record.entityName} / ${endpoint.record.entityType}`} /><EvidenceField label="Attribution network" value={endpoint.network} /><EvidenceField label="Source" value={endpoint.record.sourceName} /><EvidenceField label="Source reference" value={endpoint.record.sourceReference || null} /><EvidenceField label="Verified at" value={endpoint.record.verifiedAt} /><EvidenceField label="Record ID" value={endpoint.record.id} /></dl>}</div>)}<p className="text-xs text-slate-400">Only source-backed matches in the existing trusted registry are shown as verified. Attribution is not proof of fraud or authority over assets.</p></section>
    <section className="panel space-y-3 p-5"><h2 className="text-lg font-semibold text-white">Evidence Interpretation</h2>{context?.observations.length ? <ul className="list-disc space-y-3 pl-5 text-sm">{context.observations.map(observation => <li key={observation}>{observation}</li>)}</ul> : <p className="text-sm text-slate-400">No case relationship observation is supported by the currently available evidence.</p>}<p className="text-xs leading-6 text-slate-400">Timeline inclusion, repeated destinations and fund-flow aggregates have not been re-evaluated here. Navigation from those views is not treated as proof that their previously retrieved evidence is still current.</p><p className="text-xs leading-6 text-slate-400">Risk signals are investigative indicators and are not proof of fraud. CHAINTRACE does not autonomously freeze, reverse, seize, or block blockchain assets. Authorized intervention requires the appropriate exchange, custodian, or competent authority.</p></section>
  </div>;
}

function EvidenceField({ label, value, copy = false }: { label: string; value: string | null; copy?: boolean }) {
  const [message, setMessage] = useState('');
  return <div><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1 break-all text-sm text-slate-100">{value ?? 'UNAVAILABLE'}</dd>{copy && value !== null && <button className="mt-2 text-xs text-cyan-200 hover:underline" aria-label={`Copy ${label.toLowerCase()}`} onClick={async () => { try { await navigator.clipboard.writeText(value); setMessage('Copied.'); } catch { setMessage('Copy unavailable. Select the value to copy manually.'); } }}>Copy</button>}{message && <p role="status" className="mt-1 text-xs text-slate-400">{message}</p>}</div>;
}
