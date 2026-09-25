'use client';
import { resolveCustodialTarget, TRUSTED_CUSTODIAL_RECORDS } from '@/lib/custodial-attribution';
import Link from 'next/link';
import { flushSync } from 'react-dom';
import { AuthorizedEscalation } from '@/components/authorized-escalation';
import { validateEscalation, externalResponseError, snapshotPackage, ESCALATION_NOTICE, type InternalStatus, type TargetDetails, type AuditEntry, type ExternalResponse } from '@/lib/authorized-escalation';
import { FreezeHoldEvidenceReport, FreezeHoldPrintReport } from '@/components/freeze-hold-print-report';
import { useEffect, useMemo, useState } from 'react';
import { WalletAddress } from '@/components/wallet-address';
import { authenticatedFetch } from '@/lib/client-api';
import { recordCaseActivity } from '@/lib/case-activity-client';
import { downloadFile } from '@/lib/download';
import { EvidenceIntegrity, useEvidenceIntegrity } from '@/components/evidence-integrity';
import { createEvidencePayload, createIntegrityRecord } from '@/lib/evidence-integrity';
import type { FreezeHoldPrintPackage } from '@/components/freeze-hold-print-report';
import type { InvestigationCase, CaseWallet } from '@/lib/cases';
import type { CaseConnectionAnalysis } from '@/lib/case-analysis';
import type { AlertRow } from '@/lib/alerts';
import { normalizeAttributionAddress } from '@/lib/custodial-attribution';
import { EVIDENCE_NOTICES, PRODUCT_STATEMENT, REQUEST_TYPES, summarizeEvidence, type WalletEvidence } from '@/lib/freeze-hold';

type CaseRecord = InvestigationCase & { wallets: CaseWallet[] };
const input = 'mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white focus:border-cyan-400';
const button = 'rounded-xl border border-cyan-400/25 bg-cyan-400/[0.06] px-4 py-2.5 text-sm text-cyan-100 hover:bg-cyan-400/10 disabled:opacity-40';
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="panel space-y-4 p-5 sm:p-6"><h2 className="text-lg font-semibold text-white">{title}</h2>{children}</section>;
}
export default function FreezeHoldPage() {
  const [cases, setCases] = useState<CaseRecord[]>([]), [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const [flowContext, setFlowContext] = useState({ caseId: '', wallet: '' });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setFlowContext({ caseId: params.get('case') || '', wallet: normalizeAttributionAddress(params.get('wallet') || '') || '' });
  }, []);
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
  const caseRecord = cases.find(item => item.id === selected);
  return <div className="space-y-6 pb-10">
    <header className="panel-primary p-6"><p className="eyebrow">Authorized intervention</p><h1 className="mt-3 text-3xl font-semibold text-white">Authorized Freeze/Hold Intelligence</h1><p className="mt-3 text-sm">Generate evidence-backed intervention requests for review by authorized exchanges, custodians, compliance teams, or competent authorities.</p><p className="mt-4 text-sm text-amber-200">{EVIDENCE_NOTICES[0]}</p></header>
    <Section title="Investigation / Case selection"><label className="block text-sm">Select an existing case<select className={input} value={selected} disabled={loading} onChange={e => setSelected(e.target.value)}><option value="">{loading ? 'Loading private cases…' : 'Select a case'}</option>{cases.map(item => <option key={item.id} value={item.id}>{item.case_code} · {item.title}</option>)}</select></label>
      <p className="text-xs text-amber-200">Draft packages and their detailed workflow notes stay in this page session. Completed preparation and explicit integrity checks are also recorded in persistent Case Activity. Export packages before switching cases, navigating away, or reloading.</p>
      {error && <p role="alert" className="text-red-300">{error} <button className={button} onClick={() => setAttempt(x => x + 1)}>Retry</button></p>}
      {!loading && !error && !cases.length && <p>No cases available. <Link className="text-cyan-200" href="/cases">Create a case</Link> to begin.</p>}
    </Section>
    {caseRecord && flowContext.caseId === caseRecord.id && flowContext.wallet && <section className="panel space-y-2 p-5"><h2 className="text-sm font-semibold text-white">Fund Flow Graph context</h2><p className="break-all font-mono text-xs">{flowContext.wallet}</p><p className="text-xs text-slate-400">Selected wallet reference only. Load case evidence below to independently review activity and attribution. No funds have been frozen or external request submitted.</p></section>}
    {caseRecord && <RequestWorkspace key={caseRecord.id} caseRecord={caseRecord} />}
    <p className="text-xs leading-6 text-slate-400">{PRODUCT_STATEMENT} External escalation in this version is performed manually by the analyst after export.</p>
    <p className="text-xs leading-6 text-slate-400">Victim Report → Case → Wallet Investigation → Fund Tracing → Money Fingerprint → Fund Splitting Detection → Risk Signals → Cross-Wallet Intelligence → Monitoring → Custodial Endpoint Intelligence → Authorized Freeze/Hold Intelligence → Evidence Package → Authorized External Review/Intervention</p>
  </div>;
}
function RequestWorkspace({ caseRecord }: { caseRecord: CaseRecord }) {
  const [wallets, setWallets] = useState<WalletEvidence[]>([]), [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [connections, setConnections] = useState<CaseConnectionAnalysis | null>(null);
  const [loading, setLoading] = useState(false), [warnings, setWarnings] = useState<string[]>(['Live evidence has not been loaded.']);
  const [requestType, setRequestType] = useState<string>(REQUEST_TYPES[0]), [priority, setPriority] = useState('Standard');
  const [selectedEndpoint, setSelectedEndpoint] = useState('');
  const [target, setTarget] = useState(''), [reason, setReason] = useState(''), [notes, setNotes] = useState('');
  const [status, setStatus] = useState<InternalStatus>('DRAFT');
  const [targetDetails, setTargetDetails] = useState<TargetDetails>({ entityType: 'Cryptocurrency Exchange', attributionStatus: 'UNVERIFIED / MANUAL ENTRY', contactReference: '', attributionReference: '' });
  const [notApplicable, setNotApplicable] = useState<Record<string, string>>({});
  const [responses, setResponses] = useState<ExternalResponse[]>([]);
  const [message, setMessage] = useState(''), [attempt, setAttempt] = useState(0);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [identity, setIdentity] = useState({ id: '', at: '' });
  useEffect(() => { const at = new Date().toISOString(); setIdentity({ id: crypto.randomUUID(), at }); setAudit([{ status: 'DRAFT', at, action: 'Request draft created', source: 'CHAINTRACE', note: 'Internal request created in this page session.' }]); }, []);
  useEffect(() => {
    if (!attempt) return;
    const controller = new AbortController(), options = { signal: controller.signal };
    setLoading(true); setWallets([]); setAlerts([]); setConnections(null);
    async function load() {
      const issues: string[] = [], collected: WalletEvidence[] = [], storedAlerts: AlertRow[] = [];
      for (const wallet of caseRecord.wallets) {
        if (controller.signal.aborted) return;
        try { collected.push(await (await authenticatedFetch(`/api/wallet?address=${wallet.address}`, options)).json()); }
        catch (e) { issues.push(`${wallet.address}: ${e instanceof Error ? e.message : 'Wallet evidence unavailable.'}`); }
        try {
          const data = await (await authenticatedFetch(`/api/alerts?wallet=${wallet.address}`, options)).json();
          storedAlerts.push(...data.alerts);
          if (data.total > data.alerts.length) issues.push(`Alerts for ${wallet.address}: latest ${data.alerts.length} of ${data.total} only.`);
        } catch { issues.push(`Monitoring alerts unavailable for ${wallet.address}.`); }
      }
      let analysis: CaseConnectionAnalysis | null = null;
      if (caseRecord.wallets.length > 1 && !controller.signal.aborted) {
        try { analysis = (await (await authenticatedFetch(`/api/cases/${caseRecord.id}/analysis`, options)).json()).analysis; }
        catch { issues.push('Cross-wallet analysis unavailable.'); }
      }
      if (controller.signal.aborted) return;
      if (attempt > 0 && collected.length) {
        const warning = await recordCaseActivity(caseRecord.id, 'BLOCKCHAIN_EVIDENCE_REFRESHED', {
          requestedWallets: caseRecord.wallets.length, loadedWallets: collected.length, provider: 'Alchemy',
          component: 'freeze-hold', completedAt: new Date().toISOString(),
        });
        if (warning) issues.push(warning);
      }
      if (controller.signal.aborted) return;
      setWallets(collected); setAlerts(storedAlerts); setConnections(analysis); setWarnings(issues); setLoading(false);
      setIdentity(current => ({ ...current, at: new Date().toISOString() }));
      setAudit(current => [...current, { status: 'DRAFT', at: new Date().toISOString(), action: 'Evidence package generated', source: 'CHAINTRACE', note: `${collected.length} wallet datasets loaded; ${issues.length} coverage/loading warnings recorded.` }]);
    }
    void load();
    return () => controller.abort();
  }, [attempt, caseRecord]);
  const evidence = useMemo(() => summarizeEvidence(wallets), [wallets]);
  const resolvedTarget = resolveCustodialTarget(selectedEndpoint, evidence.endpoints, target, targetDetails.entityType);
  const effectiveTargetDetails: TargetDetails = { ...targetDetails, entityType: resolvedTarget.entityType,
    source: resolvedTarget.source, verifiedEndpoint: resolvedTarget.endpoint,
    attributionStatus: resolvedTarget.endpoint ? 'VERIFIED' : targetDetails.attributionStatus === 'VERIFIED' ? 'UNVERIFIED / MANUAL ENTRY' : targetDetails.attributionStatus,
    attributionReference: resolvedTarget.endpoint?.record ? [resolvedTarget.endpoint.record.sourceName, resolvedTarget.endpoint.record.sourceReference].filter(Boolean).join(' - ') : targetDetails.attributionReference,
  };
  const hasConnections = !!connections && !!(connections.directTransfers.length || connections.sharedCounterparties.length || connections.temporalRelationships.length);
  const checklist: [string, boolean][] = [
    ['Suspect wallet address', !!caseRecord.wallets.length], ['Transaction hash(es)', !!evidence.transactions.length],
    ['Transaction timestamps', evidence.transactions.some(tx => !!tx.timestamp && Number.isFinite(Date.parse(tx.timestamp)))],
    ['Transaction values', evidence.transactions.some(tx => /^\d+$/.test(tx.value))], ['Fund-flow evidence', !!evidence.endpoints.length],
    ['Money Fingerprint', evidence.behavioral.some(row => !!row.moneyFingerprint)], ['Fund Splitting indicators', evidence.behavioral.some(row => !!row.fundSplitting)],
    ['Cross-wallet connections', hasConnections], ['Monitoring alerts', !!alerts.length], ['Case reference', true],
  ];
  const readiness: [string, boolean][] = [...checklist.filter(([label]) => !['Fund Splitting indicators', 'Cross-wallet connections', 'Monitoring alerts', 'Transaction values'].includes(label)), ['Verified endpoint attribution', evidence.endpoints.some(endpoint => endpoint.status === 'VERIFIED')], ['Analyst notes', !!notes.trim()]];
  const score = Math.round(readiness.filter(([, available]) => available).length / readiness.length * 100), locked = status !== 'DRAFT';
  const draftPackage = {
    product: 'CHAINTRACE Authorized Freeze/Hold Intelligence', requestId: identity.id, generatedAt: identity.at,
    case: { id: caseRecord.id, code: caseRecord.case_code, title: caseRecord.title, description: caseRecord.description },
    network: caseRecord.wallets.length ? 'Ethereum Mainnet' : null, reportedSuspectWallets: caseRecord.wallets.map(wallet => wallet.address),
    blockchainObservedFacts: { transactions: evidence.transactions, valueUnit: 'wei' }, custodialEndpoints: evidence.endpoints,
    analyticalSignals: evidence.behavioral, crossWalletEvidence: connections, monitoringAlerts: alerts,
    requestedIntervention: requestType, priority, targetEntity: resolvedTarget.entityName || null, targetEntitySource: resolvedTarget.source,
    reason, analystNotes: notes, evidenceChecklist: Object.fromEntries(checklist), evidenceReadiness: { percent: score, criteria: Object.fromEntries(readiness), meaning: 'Evidence availability, not fraud probability or legal sufficiency.' },
    status, auditTrail: audit, delivery: 'Internal preparation only. No exchange or authority has been contacted by CHAINTRACE.',
    limitations: ['Recent normal Ethereum transfer sample; not complete wallet history, token transfers, or internal transfers.', 'Case wallet membership is a reported association, not proof of wrongdoing.', TRUSTED_CUSTODIAL_RECORDS.length ? 'Attribution is limited to the reviewed registry and does not establish fraud or control over assets.' : 'No trusted attribution dataset/API is configured; the production registry is empty.', 'Audit times are browser timestamps; this is not a tamper-proof database audit.', ...warnings, ...(connections?.limitations || [])], notices: [...EVIDENCE_NOTICES, ESCALATION_NOTICE],
  };
  const [preparedSnapshot, setPreparedSnapshot] = useState<(typeof draftPackage & { preparedAt: string; targetDetails: TargetDetails; evidenceValidation: ReturnType<typeof validateEscalation> }) | null>(null);
  const validation = preparedSnapshot?.evidenceValidation || validateEscalation(draftPackage, notApplicable);
  const basePackageData = { ...(preparedSnapshot || draftPackage), status, auditTrail: audit,
    targetDetails: preparedSnapshot?.targetDetails || effectiveTargetDetails,
    evidenceValidation: validation, externalResponses: responses,
    externalResponseStatus: responses.length ? responses[responses.length - 1].status : null,
    externalResponseSource: responses.length ? 'Analyst recorded; not independently confirmed by CHAINTRACE' : null,
  };
  const integrityPayload = !loading && identity.id ? createEvidencePayload('freeze-hold', basePackageData) : null;
  const integrity = useEvidenceIntegrity(integrityPayload, { caseId: caseRecord.id, caseCode: caseRecord.case_code });
  const packageData = { ...basePackageData, ...(integrity.record ? { integrity: integrity.record } : {}) };
  const [printSnapshot, setPrintSnapshot] = useState<FreezeHoldPrintPackage | null>(null);
  function log(action: string, note: string, eventStatus: string = status, source: AuditEntry['source'] = 'CHAINTRACE') {
    const entry: AuditEntry = { at: new Date().toISOString(), action, status: eventStatus, source, note };
    setAudit(current => [...current, entry]);
    return entry;
  }
  function transition(next: InternalStatus) {
    if (loading || !identity.id || status === 'CLOSED' || next === status) return;
    if (preparedSnapshot && next !== 'CLOSED') return;
    if (next === 'READY FOR REVIEW' || next === 'PREPARED FOR AUTHORIZED ESCALATION') {
      const checked = validateEscalation(draftPackage, notApplicable);
      log('Evidence readiness checked', checked.map(row => row.label + ': ' + row.state).join('; '));
      const missing = checked.filter(row => row.required && row.state !== 'AVAILABLE');
      if (missing.length) { setMessage('Complete required fields: ' + missing.map(row => row.label).join(', ') + '. Optional missing evidence does not block preparation.'); return; }
      if (selectedEndpoint && !resolvedTarget.endpoint) { setMessage('The selected verified endpoint is no longer in the loaded evidence. Select an available endpoint or use manual entry.'); return; }
      if (!resolvedTarget.endpoint && effectiveTargetDetails.attributionStatus !== 'UNVERIFIED / MANUAL ENTRY' && !targetDetails.attributionReference.trim()) { setMessage('Enter a supporting reference for the analyst attribution assessment, or use UNVERIFIED / MANUAL ENTRY.'); return; }
      if (next === 'PREPARED FOR AUTHORIZED ESCALATION') {
        const at = new Date().toISOString();
        setPreparedSnapshot(snapshotPackage({ ...draftPackage, status: next, generatedAt: at, preparedAt: at, targetDetails: effectiveTargetDetails, evidenceValidation: checked }));
        log('Prepared for authorized escalation', 'Evidence snapshot locked. Nothing transmitted to an external entity.', next);
        setStatus(next); setMessage('Evidence package prepared for authorized external review.');
        void recordCaseActivity(caseRecord.id, 'FREEZE_HOLD_PACKAGE_PREPARED', { completedAt: at }).then(warning => { if (warning) setMessage(warning); });
        return;
      }
    }
    if (next === 'CLOSED' && !preparedSnapshot) return;
    setStatus(next);
    log('Internal status changed', next === 'CLOSED' ? 'Analyst closed the internal workflow; no external outcome asserted.' : 'Internal workflow update.', next);
    setMessage('Internal status updated.');
  }
  function recordResponse(response: Omit<ExternalResponse, 'recordedAt' | 'source'>) {
    if (!preparedSnapshot || loading || status === 'CLOSED') return false;
    const error = externalResponseError(response);
    if (error) { setMessage(error); return false; }
    const recorded: ExternalResponse = { ...response, referenceId: response.referenceId.trim(), entity: response.entity.trim(), respondedAt: new Date(response.respondedAt).toISOString(), recordedAt: new Date().toISOString(), source: 'Analyst recorded' };
    setResponses(current => [...current, recorded]);
    log('External response manually recorded', response.status + '; reference: ' + recorded.referenceId + '; entity: ' + recorded.entity + '. Internal status unchanged.', response.status, 'Analyst recorded');
    setMessage('External response recorded as analyst-provided information. CHAINTRACE has not independently confirmed it.');
    return true;
  }
  async function exportPackage(format: 'copy' | 'json' | 'print') {
    if (loading || !identity.id) return;
    const entry: AuditEntry = { at: new Date().toISOString(), action: format === 'print' ? 'Print / Save as PDF requested' : format === 'json' ? 'JSON download initiated' : 'Evidence package copied', status, source: 'CHAINTRACE', note: 'Local export only. No external delivery; file saving is controlled by the browser.' };
    try {
      // Include the export audit entry BEFORE hashing; never hash the integrity record itself.
      const exportData = { ...basePackageData, auditTrail: [...audit, entry] };
      const exportIntegrity = await createIntegrityRecord(createEvidencePayload('freeze-hold', exportData), { caseId: caseRecord.id, caseCode: caseRecord.case_code });
      const exportSnapshot = { ...exportData, integrity: exportIntegrity };
      const content = JSON.stringify(exportSnapshot, null, 2);
      if (format === 'copy') await navigator.clipboard.writeText(content);
      if (format === 'json') downloadFile('chaintrace-' + identity.id + '.json', content, 'application/json');
      // Commit the updated report to the DOM before opening the print dialog.
      flushSync(() => { setAudit(current => [...current, entry]); if (format === 'print') setPrintSnapshot(exportSnapshot); });
      if (format === 'print') { window.print(); setPrintSnapshot(null); }
      setMessage(format === 'print' ? 'Print dialog requested. Saving or cancellation is controlled by your browser.' : format === 'json' ? 'JSON download initiated. No external submission made.' : 'Evidence package copied.');
    } catch { setMessage('Export or SHA-256 hashing unavailable. No integrity-verified export was completed. Try again. No external submission was made.'); }
  }
  return <>
    <Section title={`${caseRecord.case_code} · ${caseRecord.title}`}><p className="text-xs">Case ID: {caseRecord.id} · Network: {caseRecord.wallets.length ? 'Ethereum Mainnet' : 'Unavailable'}</p><div className="flex flex-wrap gap-4">{caseRecord.wallets.map(wallet => <WalletAddress key={wallet.id} address={wallet.address} />)}</div>
      {!caseRecord.wallets.length && <p>No wallets attached. <Link href={`/cases/${caseRecord.id}`} className="text-cyan-200">Open case</Link> to add evidence.</p>}
      <button className={button} disabled={loading || locked || !caseRecord.wallets.length} onClick={() => setAttempt(x => x + 1)}>{loading ? 'Loading live evidence…' : 'Load / refresh case evidence'}</button><p className="text-xs text-slate-400">Uses live Alchemy data and stored alerts. Multi-wallet cases also load cross-wallet analysis. Monitoring is periodic/manual.</p><div role="status" className="text-sm text-amber-200">{warnings.map(warning => <p key={warning}>{warning}</p>)}</div>
    </Section>
    <Section title="Custodial Endpoint Intelligence"><p className="text-sm">Destination activity is blockchain-observed evidence. Identity is verified only by an exact network/address match in the trusted attribution registry. Attribution is not proof of fraud.</p>{!evidence.endpoints.some(endpoint => endpoint.status === 'VERIFIED') && <p className="text-sm text-amber-200">No verified custodial attribution is currently available.</p>}{!TRUSTED_CUSTODIAL_RECORDS.length && <p className="text-xs text-slate-400">No trusted dataset/API configured. Production attribution registry is empty.</p>}<div className="grid gap-3 md:grid-cols-2">{evidence.endpoints.map(endpoint => <div key={endpoint.address} className="space-y-2 rounded-xl border border-slate-800 p-4"><p className="break-all font-mono text-xs">{endpoint.address}</p><WalletAddress address={endpoint.address} /><p className="text-xs font-semibold text-cyan-200">{endpoint.status}</p><p className="text-xs">{endpoint.attribution}</p>{endpoint.record && <dl className="space-y-2 break-words text-sm"><dt>Entity</dt><dd>{endpoint.record.entityName} ({endpoint.record.entityType})</dd><dt>Network</dt><dd>{endpoint.network}</dd><dt>Evidence / source</dt><dd>{endpoint.record.sourceName}</dd><dt>Source reference</dt><dd>{endpoint.record.sourceReference || 'Not supplied'}</dd><dt>Verified at</dt><dd>{endpoint.record.verifiedAt}</dd>{endpoint.record.notes && <><dt>Notes</dt><dd>{endpoint.record.notes}</dd></>}</dl>}{endpoint.possibleRecords.map(record => <p key={record.id} className="text-xs text-amber-200">POSSIBLE / UNVERIFIED record: {record.entityName}; source: {record.sourceName}. Not verified ownership.</p>)}</div>)}</div></Section>
    <Section title="Investigation evidence">
      <p className="text-sm text-slate-400">{evidence.transactions.length} retrieved transactions · {alerts.length} stored alerts. Facts, analytical signals, and attribution are kept separate in the export.</p>
      <div className="grid gap-4 md:grid-cols-2">{evidence.behavioral.map(row => <div key={row.address} className="rounded-xl border border-slate-800 p-4"><WalletAddress address={row.address} /><p className="mt-2 text-xs text-slate-400">{row.source} · retrieved {row.retrievedAt}</p><h3 className="mt-3 font-medium text-white">Money Fingerprint</h3><p className="text-sm">{row.moneyFingerprint ? `Received ${row.moneyFingerprint.incomingEth}; sent ${row.moneyFingerprint.outgoingEth}; ${row.moneyFingerprint.counterparties} counterparties.` : 'Unavailable: no successful transfers in this sample.'}</p><h3 className="mt-3 font-medium text-white">Analytical signals</h3>{row.riskSignals.map(signal => <p key={signal} className="text-sm">{signal}</p>)}<p className="mt-2 text-sm">{row.fundSplitting ? `Fund Splitting: ${row.fundSplitting.transactionCount} transactions to ${row.fundSplitting.destinationCount} destinations from ${row.fundSplitting.start} to ${row.fundSplitting.end}.` : 'No Fund Splitting finding in this sample.'}</p></div>)}</div>
      <details><summary className="cursor-pointer text-sm text-cyan-200">Blockchain-observed transactions ({evidence.transactions.length})</summary><div className="mt-3 max-h-96 overflow-auto"><table className="technical-table w-full text-left text-xs"><thead><tr><th className="p-3">Hash</th><th className="p-3">Value (wei)</th><th className="p-3">Timestamp</th><th className="p-3">Receipt status</th></tr></thead><tbody>{evidence.transactions.map(tx => <tr key={tx.hash}><td className="p-3"><a className="text-cyan-200" title={tx.hash} href={`https://etherscan.io/tx/${tx.hash}`} target="_blank" rel="noreferrer">{tx.hash.slice(0, 12)}…{tx.hash.slice(-8)}</a></td><td className="p-3">{tx.value}</td><td className="p-3">{tx.timestamp || 'Unavailable'}</td><td className="p-3">{tx.status}</td></tr>)}</tbody></table></div></details>
      <p className="text-sm">Cross-wallet findings: {connections ? (hasConnections ? 'Connections observed; supporting transactions and limitations are included in the package.' : 'No connection observed in the analyzed history.') : 'Unavailable / not generated.'}</p>
      {alerts.map(alert => <div key={alert.id} className="rounded-lg border border-slate-800 p-3 text-sm"><Link href="/alerts" className="text-cyan-200">{alert.title}</Link><p>{alert.description}</p><p className="mt-1 text-xs text-slate-400">Detected: {alert.created_at || 'Unavailable'} · {alert.status}</p></div>)}
    </Section>
    <Section title="Authorized Intervention Request"><fieldset disabled={locked || loading} className="grid gap-4 md:grid-cols-2">
      <label className="text-sm">Request Type<select className={input} value={requestType} onChange={e => setRequestType(e.target.value)}>{REQUEST_TYPES.map(type => <option key={type}>{type}</option>)}</select></label>
      <label className="text-sm">Priority<select className={input} value={priority} onChange={e => setPriority(e.target.value)}>{['Standard', 'High', 'Critical'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="text-sm">Reason for Request<textarea maxLength={10000} rows={4} className={input} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <label className="text-sm">Investigator Notes<textarea maxLength={10000} rows={4} className={input} value={notes} onChange={e => setNotes(e.target.value)} /></label>
    </fieldset><h3 className="font-medium text-white">Evidence Checklist</h3><div className="grid gap-3 sm:grid-cols-2">{checklist.map(([label, available]) => <label key={label} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={available} readOnly disabled />{label}<span className="text-xs text-slate-400">{available ? 'Available' : 'Unavailable / not observed'}</span></label>)}</div><p className="text-cyan-200">Evidence Readiness: {score}%</p><p className="text-xs">Availability across eight criteria; not fraud probability or legal approval. Verified attribution requires a trusted exact-address record. Missing findings do not establish safety.</p></Section>
    <AuthorizedEscalation message={message} status={status} busy={loading || !identity.id} target={resolvedTarget.entityName} setTarget={setTarget} selectedEndpoint={selectedEndpoint} onSelectEndpoint={setSelectedEndpoint} endpoints={evidence.endpoints} targetDetails={effectiveTargetDetails} setTargetDetails={value => setTargetDetails({ entityType: value.entityType, attributionStatus: value.attributionStatus === 'VERIFIED' ? 'UNVERIFIED / MANUAL ENTRY' : value.attributionStatus, contactReference: value.contactReference, attributionReference: value.attributionReference })} validation={validation} notApplicable={notApplicable} setNotApplicable={setNotApplicable} audit={audit} responses={responses} preparedAt={preparedSnapshot?.preparedAt} onValidate={() => { log('Evidence readiness checked', validation.map(row => row.label + ': ' + row.state).join('; ')); setMessage('Evidence readiness checked. Optional missing evidence remains disclosed.'); }} onStatus={transition} onResponse={recordResponse} />
    <EvidenceIntegrity payload={integrityPayload} integrity={integrity} />
    <Section title="Evidence Package Preview"><FreezeHoldEvidenceReport data={packageData} /><div className="flex flex-wrap gap-3 print:hidden"><button disabled={loading || !identity.id} className={button} onClick={() => void exportPackage('copy')}>Copy package</button><button disabled={loading || !identity.id} className={button} onClick={() => void exportPackage('json')}>Download JSON</button><button disabled={loading || !identity.id} className={button} onClick={() => void exportPackage('print')}>Print / Save as PDF</button></div></Section>

    <FreezeHoldPrintReport data={printSnapshot || packageData} />
  </>;
}


