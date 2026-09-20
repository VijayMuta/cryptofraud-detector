'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { authenticatedFetch } from '@/lib/client-api';
import { REPORT_STATUSES, STATUS_LABELS, reportInvestigationUrl, type ReportStatus, type VictimReport } from '@/lib/victim-reports';
import { WalletAddress } from '@/components/wallet-address';

type Observation = { transaction: { hash: string; from: string; to: string | null; valueEth: string; status: string; timestamp: string | null }; network: string; dataSource: string; verifiedAt: string };
export default function ReportDetail({ params }: { params: { id: string } }) {
  const [report, setReport] = useState<VictimReport | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<ReportStatus>('submitted');
  const [message, setMessage] = useState('');
  const [observed, setObserved] = useState<Observation | null>(null);
  const [verifyError, setVerifyError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError(''); setReport(null); setObserved(null); setVerifyError(''); setMessage('');
    try { const response = await authenticatedFetch(`/api/victim-reports/${params.id}`); const data = await response.json(); setReport(data.report); setStatus(data.report.status); setCount(data.sameWalletCount); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to load report.'); }
    finally { setLoading(false); }
  }, [params.id]);
  useEffect(() => { void load(); }, [load]);
  async function saveStatus() {
    if (saving) return;
    setSaving(true); setError(''); setMessage('');
    try { const response = await authenticatedFetch(`/api/victim-reports/${params.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); const data = await response.json(); setReport(data.report); setMessage('Workflow status updated. This does not verify the allegation.'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to update status.'); }
    finally { setSaving(false); }
  }
  async function verify() {
    if (!report?.transaction_hash || verifying) return;
    setVerifying(true); setVerifyError(''); setObserved(null);
    try { const response = await authenticatedFetch(`/api/transaction?hash=${encodeURIComponent(report.transaction_hash)}`); const data = await response.json(); if (!data.transaction || data.transaction.hash.toLowerCase() !== report.transaction_hash.toLowerCase()) throw new Error('No matching blockchain transaction was returned.'); setObserved(data); }
    catch (failure) { setVerifyError(failure instanceof Error ? failure.message : 'Unable to retrieve blockchain evidence.'); }
    finally { setVerifying(false); }
  }
  return <div className="mx-auto max-w-5xl space-y-6 pb-10"><header className="page-header"><div><p className="eyebrow">Private allegation record</p><h1 className="page-title">Victim Report</h1><p className="page-description">Victim-provided information remains separate from blockchain observations.</p></div><Link href="/report" className="button-secondary">Back to intake</Link></header>
    {loading && <p role="status" className="text-slate-400">Loading private report…</p>}{error && <div role="alert" className="panel p-4 text-sm text-red-200">{error}<button className="button-secondary ml-3" onClick={() => void load()}>Reload</button></div>}
    {report && <><section className="panel space-y-4 p-5"><p className="break-all font-mono text-sm text-cyan-200">Reference: {report.id}</p><p className="text-sm text-slate-300">{STATUS_LABELS[report.status]} · Submitted {new Date(report.created_at).toLocaleString()} · Updated {new Date(report.updated_at).toLocaleString()} (local time)</p><p className="text-xs text-amber-100">This is an allegation, not a fraud determination. Service names and incident classifications are unverified victim statements.</p><p className="text-sm text-slate-400">{count === null ? 'Same-wallet report count unavailable.' : `${count} of your private reports reference this wallet.`} No other users’ report counts are disclosed.</p><div className="flex flex-wrap gap-3"><Link className="button-primary" href={reportInvestigationUrl(report)}>Investigate Wallet</Link><Link className="button-secondary" href={`/cases?report=${report.id}`}>Prepare Investigation Case</Link></div><p className="text-xs text-slate-500">Case preparation opens the existing case form with this reference and wallet. Review and submit that form to create a case.</p></section>
    <section className="panel p-5"><h2 className="mb-4 text-lg font-semibold text-white">Victim Reported · unverified</h2><dl className="grid gap-5 md:grid-cols-2"><Entry label="Suspect wallet"><WalletAddress address={report.suspect_wallet} /></Entry><Entry label="Network">Ethereum Mainnet</Entry><Entry label="Incident type">{report.incident_type}</Entry><Entry label="Approximate loss">{report.approximate_loss} {report.loss_currency}</Entry><Entry label="Incident date">{report.incident_date}</Entry><Entry label="Reported service / exchange">{report.reported_service || 'Not supplied'}</Entry><Entry label="Transaction hash">{report.transaction_hash || 'Not supplied'}</Entry><Entry label="Reference">{report.reference || 'Not supplied'}</Entry><Entry label="Description">{report.description}</Entry><Entry label="Additional notes">{report.additional_notes || 'Not supplied'}</Entry></dl></section>
    <section className="panel space-y-4 p-5"><h2 className="text-lg font-semibold text-white">Workflow status</h2><p className="text-xs text-slate-400">You can manage your own report’s review status. A status change does not verify the report.</p><div className="flex flex-wrap gap-3"><label className="text-sm text-slate-300">Status<select className="field mt-2" value={status} disabled={saving} onChange={event => setStatus(event.target.value as ReportStatus)}>{REPORT_STATUSES.map(value => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}</select></label><button className="button-secondary self-end" disabled={saving || status === report.status} onClick={() => void saveStatus()}>{saving ? 'Saving…' : 'Save status'}</button></div>{message && <p role="status" className="text-sm text-cyan-200">{message}</p>}</section>
    <section className="panel space-y-4 p-5"><h2 className="text-lg font-semibold text-white">Blockchain Observed · separate evidence</h2><p className="text-xs leading-6 text-slate-400">Retrieve the reported transaction using the existing Ethereum provider. This does not verify the reported loss, attribution, incident type or intent. Original report fields are never overwritten.</p>{report.transaction_hash ? <button className="button-primary" disabled={verifying} onClick={() => void verify()}>{verifying ? 'Retrieving transaction…' : 'Check reported transaction'}</button> : <p className="text-sm text-slate-400">No transaction hash was reported. Use Wallet Investigation to inspect available activity.</p>}{verifyError && <p role="alert" className="text-sm text-red-200">{verifyError}</p>}{!observed && !verifying && <p className="text-xs text-slate-500">No blockchain observation loaded.</p>}{observed && <><p className="text-xs text-cyan-200">{observed.dataSource} · {observed.network} · Retrieved {observed.verifiedAt}</p><dl className="grid gap-4 md:grid-cols-2"><Entry label="Provider transaction"><a className="text-cyan-200" href={`https://etherscan.io/tx/${observed.transaction.hash}`} target="_blank" rel="noreferrer">{observed.transaction.hash}</a></Entry><Entry label="Receipt status">{observed.transaction.status}</Entry><Entry label="From"><WalletAddress address={observed.transaction.from} /></Entry><Entry label="To">{observed.transaction.to ? <WalletAddress address={observed.transaction.to} /> : 'Contract creation / no recipient'}</Entry><Entry label="On-chain transaction value">{observed.transaction.valueEth} ETH</Entry><Entry label="Timestamp">{observed.transaction.timestamp || 'Unavailable'}</Entry></dl><p className="text-xs text-amber-100">{[observed.transaction.from.toLowerCase(), observed.transaction.to?.toLowerCase()].includes(report.suspect_wallet) ? 'The reported wallet appears as sender or recipient in this transaction.' : 'The reported wallet is not the direct sender or recipient in this transaction.'} Transaction value is not a verified loss amount. This observation is not persisted to the intake report.</p></>}</section></>}
  </div>;
}
function Entry({ label, children }: { label: string; children: React.ReactNode }) { return <div className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{children}</dd></div>; }
