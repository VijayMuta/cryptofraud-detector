'use client';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { authenticatedFetch } from '@/lib/client-api';
import { INCIDENT_TYPES, STATUS_LABELS, validateReport, reportInvestigationUrl, type VictimReport } from '@/lib/victim-reports';
import { WalletAddress } from '@/components/wallet-address';

export default function ReportWallet() {
  const [submitted, setSubmitted] = useState<VictimReport | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [refresh, setRefresh] = useState(0);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current) return;
    const form = event.currentTarget;
    const parsed = validateReport(Object.fromEntries(new FormData(form)));
    setError('');
    if (!parsed.data) { setError(parsed.error!); return; }
    lock.current = true; setBusy(true);
    try {
      const response = await authenticatedFetch('/api/victim-reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed.data) });
      const payload = await response.json();
      if (!payload.report?.id) throw new Error('No saved report was returned. Submission is not confirmed.');
      setSubmitted(payload.report); setRefresh(value => value + 1); form.reset();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to submit the report.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="mx-auto max-w-5xl space-y-6 pb-10">
    <header className="page-header"><div><p className="eyebrow">Private allegation intake</p><h1 className="page-title">Report Suspicious Crypto Activity</h1><p className="page-description">Submit information about a suspected cryptocurrency fraud incident. Submitted information is an allegation and requires verification through blockchain analysis and investigation.</p></div></header>
    <section className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-4"><h2 className="text-sm font-semibold text-amber-100">Safety notice</h2><p className="mt-2 text-sm text-amber-100">Never submit seed phrases, private keys, passwords, or authentication codes.</p><p className="mt-2 text-xs text-slate-400">Avoid unnecessary personal information. Use a ticket or case reference instead of contact details. Reports are private to your account.</p></section>
    {error && <p role="alert" className="rounded-xl border border-red-400/25 p-4 text-sm text-red-200">{error}</p>}
    {submitted ? <section role="status" className="panel space-y-4 p-6"><CheckCircle2 className="text-emerald-300" /><h2 className="text-xl font-semibold text-white">Report submitted successfully.</h2><p className="text-sm text-slate-400">Saved as an allegation. Submission does not verify any claim or determine fraud.</p><dl className="space-y-2 text-sm text-slate-300"><div><dt>Reference ID</dt><dd className="break-all font-mono text-cyan-200">{submitted.id}</dd></div><div><dt>Status</dt><dd>{STATUS_LABELS[submitted.status]}</dd></div><div><dt>Reported wallet</dt><dd><WalletAddress address={submitted.suspect_wallet} /></dd></div><div><dt>Submitted</dt><dd>{new Date(submitted.created_at).toLocaleString()} (local time)</dd></div></dl><div className="flex flex-wrap gap-3"><Link className="button-primary" href={reportInvestigationUrl(submitted)}>Investigate Wallet</Link><Link className="button-secondary" href={'/report/' + submitted.id}>View Report</Link><Link className="button-secondary" href={'/cases?report=' + submitted.id}>Prepare Investigation Case</Link><button className="button-secondary" onClick={() => setSubmitted(null)}>Submit another report</button></div></section> :
    <form onSubmit={submit} className="panel p-5 sm:p-6"><fieldset disabled={busy} className="space-y-6"><legend className="mb-4 text-lg font-semibold text-white">Incident Details</legend><p className="text-xs text-slate-400">Fields marked * are required. All values below are victim-provided information, not blockchain-verified evidence.</p><div className="grid gap-5 md:grid-cols-2">
      <Field label="Incident type *"><select name="incident_type" required className="field" defaultValue=""><option value="" disabled>Select reported incident type</option>{INCIDENT_TYPES.map(type => <option key={type}>{type}</option>)}</select></Field>
      <Field label="Incident date *"><input name="incident_date" required type="date" min="2009-01-01" max={new Date().toISOString().slice(0,10)} className="field" /></Field>
      <Field label="Approximate loss amount *"><input name="approximate_loss" required inputMode="decimal" maxLength={37} placeholder="e.g. 1.25 (use 0 if no loss)" className="field" /></Field>
      <Field label="Loss currency / token symbol *"><input name="loss_currency" required maxLength={12} placeholder="ETH, USD, USDT?" className="field" /></Field>
    </div><h2 className="text-lg font-semibold text-white">Blockchain Evidence ? reported</h2><div className="grid gap-5 md:grid-cols-2">
      <Field label="Suspect wallet address *"><input name="suspect_wallet" required maxLength={42} autoComplete="off" spellCheck={false} placeholder="0x?" className="field font-mono" /></Field>
      <Field label="Blockchain / network *"><select name="network" required className="field"><option value="ethereum">Ethereum Mainnet</option></select></Field>
      <Field label="Transaction hash (optional)"><input name="transaction_hash" maxLength={66} autoComplete="off" spellCheck={false} placeholder="0x?" className="field font-mono" /></Field>
      <Field label="Service / exchange mentioned (optional)"><input name="reported_service" maxLength={200} className="field" placeholder="Unverified victim attribution" /></Field>
    </div><p className="text-xs leading-5 text-slate-400">Only Ethereum Mainnet is currently supported. Address/hash validation checks format only. It does not prove that a transaction exists or that a service owns an address.</p>
    <h2 className="text-lg font-semibold text-white">Incident Description</h2><Field label="Describe what happened *"><textarea name="description" required minLength={10} maxLength={5000} rows={5} className="field resize-y" /></Field><Field label="Reference (optional)"><input name="reference" maxLength={200} className="field" placeholder="Police / ticket / internal reference; no secrets" /></Field><Field label="Additional notes (optional)"><textarea name="additional_notes" rows={3} maxLength={2000} className="field resize-y" /></Field>
    <button className="button-primary" disabled={busy}>{busy && <Loader2 size={16} className="animate-spin" />}{busy ? 'Submitting?' : 'Submit Report'}</button></fieldset></form>}
    <ReportRegister refresh={refresh} />
  </div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block min-w-0 text-sm text-slate-300"><span className="mb-2 block">{label}</span>{children}</label>; }
function ReportRegister({ refresh }: { refresh: number }) {
  const [reports,setReports] = useState<VictimReport[]>([]), [error,setError] = useState(''), [loading,setLoading] = useState(true), [page,setPage] = useState(1), [total,setTotal] = useState(0);
  const load = useCallback(async () => { setLoading(true); setError(''); try { const response = await authenticatedFetch('/api/victim-reports?page=' + page); const data=await response.json(); setReports(data.reports); setTotal(data.total); } catch(failure) { setError(failure instanceof Error ? failure.message : 'Unable to load reports.'); } finally { setLoading(false); } }, [page]);
  useEffect(() => { void load(); }, [load, refresh]);
  return <section className="panel p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold text-white">Your submitted reports</h2><button className="button-secondary" disabled={loading} onClick={() => void load()}>Refresh</button></div>{loading ? <p role="status" className="mt-4 text-sm text-slate-400">Loading reports?</p> : error ? <p role="alert" className="mt-4 text-sm text-red-200">{error}</p> : <><p className="mt-3 text-xs text-slate-400">{total} private reports. These are allegations, not verified findings.</p><div className="mt-4 space-y-3">{reports.map(report => <Link key={report.id} href={'/report/' + report.id} className="block rounded-xl border border-slate-800 p-4 hover:border-cyan-400/40"><p className="break-all font-mono text-xs text-cyan-200">{report.id}</p><p className="mt-2 text-sm text-slate-300">{report.incident_type} ? {STATUS_LABELS[report.status]}</p><p className="mt-2 break-all text-xs text-slate-500">{report.suspect_wallet}</p></Link>)}{!reports.length && <p className="text-sm text-slate-400">No reports on this page.</p>}</div><div className="mt-4 flex items-center justify-between gap-3"><button className="button-secondary" disabled={page === 1} onClick={() => setPage(page-1)}>Previous</button><span className="text-xs text-slate-400">Page {page}</span><button className="button-secondary" disabled={page*10 >= total} onClick={() => setPage(page+1)}>Next</button></div></>}</section>;
}
