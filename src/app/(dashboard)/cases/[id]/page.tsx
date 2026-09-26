'use client';

import { WalletAddress } from '@/components/wallet-address';
import { CaseNotes } from '@/components/case-notes';
import { CaseBookmarks } from '@/components/case-bookmarks';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  FileText,
  FolderKanban,
  Loader2,
  Network,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Trash2,
  WalletCards,
} from 'lucide-react';
import { CaseConnectionAnalysisPanel } from '@/components/case-connection-analysis';
import { MAX_WALLETS_PER_CASE } from '@/lib/case-constants';
import type { CaseConnectionAnalysis } from '@/lib/case-analysis';
import { authenticatedFetch } from '@/lib/client-api';
import { recordCaseActivity } from '@/lib/case-activity-client';

type CaseStatus = 'open' | 'investigating' | 'closed' | 'archived';

type CaseWallet = {
  id: string;
  case_id: string;
  address: string;
  network: 'ethereum';
  added_at: string;
};

type CaseRecord = {
  id: string;
  case_code: string;
  title: string;
  description: string;
  status: CaseStatus;
  created_at: string;
  updated_at: string;
  wallets: CaseWallet[];
};

const ETHEREUM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unavailable';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date);
}

function abbreviate(value: string, start = 10, end = 8) {
  return value.length > start + end ? `${value.slice(0, start)}...${value.slice(-end)}` : value;
}

function statusClass(status: CaseStatus) {
  if (status === 'investigating') return 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200';
  if (status === 'closed') return 'border-slate-600 bg-slate-800 text-slate-300';
  if (status === 'archived') return 'border-slate-700 bg-slate-900 text-slate-500';
  return 'border-violet-400/30 bg-violet-400/10 text-violet-200';
}

export default function CaseDetails({ params }: { params: { id: string } }) {
  const [caseRecord, setCaseRecord] = useState<CaseRecord | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<CaseStatus>('open');
  const [newWallet, setNewWallet] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addingWallet, setAddingWallet] = useState(false);
  const [removingWalletId, setRemovingWalletId] = useState('');
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysis, setAnalysis] = useState<CaseConnectionAnalysis | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadCase = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await authenticatedFetch(`/api/cases/${encodeURIComponent(params.id)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to load the case.');
      const loaded = payload.case as CaseRecord;
      setCaseRecord(loaded);
      setTitle(loaded.title);
      setDescription(loaded.description);
      setStatus(loaded.status);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load the case.');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => { void loadCase(); }, [loadCase]);

  async function saveCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!caseRecord) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await authenticatedFetch(`/api/cases/${encodeURIComponent(caseRecord.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, status }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to save case changes.');
      setCaseRecord((current) => current ? { ...current, ...payload.case } : current);
      setMessage('Case information updated.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save case changes.');
    } finally {
      setSaving(false);
    }
  }

  async function addWallet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!caseRecord) return;
    const address = newWallet.trim();
    if (!ETHEREUM_ADDRESS_PATTERN.test(address)) {
      setError('Enter a valid Ethereum wallet address beginning with 0x.');
      return;
    }
    if (caseRecord.wallets.length >= MAX_WALLETS_PER_CASE) {
      setError(`A live cross-wallet analysis supports up to ${MAX_WALLETS_PER_CASE} suspect wallets per case.`);
      return;
    }
    setAddingWallet(true);
    setError('');
    setMessage('');
    try {
      const response = await authenticatedFetch(`/api/cases/${encodeURIComponent(caseRecord.id)}/wallets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to add the suspect wallet.');
      setCaseRecord((current) => current ? { ...current, wallets: [...current.wallets, payload.wallet as CaseWallet] } : current);
      setNewWallet('');
      setAnalysis(null);
      setMessage('Suspect wallet added. Run a new live analysis to refresh evidence.');
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : 'Unable to add the suspect wallet.');
    } finally {
      setAddingWallet(false);
    }
  }

  async function removeWallet(walletId: string) {
    if (!caseRecord) return;
    setRemovingWalletId(walletId);
    setError('');
    setMessage('');
    try {
      const response = await authenticatedFetch(`/api/cases/${encodeURIComponent(caseRecord.id)}/wallets?walletId=${encodeURIComponent(walletId)}`, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to remove the suspect wallet.');
      setCaseRecord((current) => current ? { ...current, wallets: payload.wallets as CaseWallet[] } : current);
      setAnalysis(null);
      setMessage('Suspect wallet removed. Run a new live analysis to refresh evidence.');
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Unable to remove the suspect wallet.');
    } finally {
      setRemovingWalletId('');
    }
  }

  async function runAnalysis() {
    if (!caseRecord || caseRecord.wallets.length === 0) {
      setError('Add at least one Ethereum wallet before running a live analysis.');
      return;
    }
    setAnalysisLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await authenticatedFetch(`/api/cases/${encodeURIComponent(caseRecord.id)}/analysis`);
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to retrieve live Ethereum data.');
      setAnalysis(payload.analysis as CaseConnectionAnalysis);
      const auditWarning = await recordCaseActivity(caseRecord.id, 'BLOCKCHAIN_EVIDENCE_REFRESHED', {
        requestedWallets: caseRecord.wallets.length, loadedWallets: payload.analysis.walletActivity.length,
        provider: 'case-history', component: 'case-details', completedAt: new Date().toISOString(),
      });
      if (auditWarning) setError(auditWarning);
      setMessage('Live Ethereum analysis completed. All displayed relationships include the source transactions below.');
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : 'Unable to retrieve live Ethereum data.');
    } finally {
      setAnalysisLoading(false);
    }
  }

  if (loading) return <div className="flex h-52 items-center justify-center rounded-xl border border-slate-800 bg-white/5 text-slate-400"><Loader2 size={18} className="mr-2 animate-spin" /> Loading private case…</div>;

  if (!caseRecord) return <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-5 text-sm text-red-300">{error || 'Case not found.'}<Link href="/cases" className="ml-3 underline">Return to cases</Link></div>;

  return (
    <div className="space-y-6 pb-10">
      <header className="page-header">
        <div>
          <Link href="/cases" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-cyan-200"><ArrowLeft size={15} /> All cases</Link>
          <div className="mt-3 flex flex-wrap items-center gap-3"><h1 className="text-3xl font-semibold tracking-tight text-white">{caseRecord.title}</h1><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusClass(caseRecord.status)}`}>{caseRecord.status}</span></div>
          <p className="mt-2 font-mono text-sm text-cyan-300">{caseRecord.case_code} · private investigation record</p>
        </div>
        <button onClick={() => void loadCase()} disabled={loading} className="button-secondary"><RefreshCw size={16} /> Refresh case</button>
      </header>

      {error && <div role="alert" className="mb-5 flex gap-2 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300"><AlertCircle size={18} className="shrink-0" /><span>{error}</span></div>}
      {message && <div className="mb-5 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-100">{message}</div>}

      <Link className="button-secondary inline-flex" href={`/cases/${encodeURIComponent(caseRecord.id)}/activity`}>Case Activity / Audit Trail</Link>
      <div className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
        <form onSubmit={saveCase} className="panel p-5 sm:p-6">
          <div className="mb-5 flex items-center gap-2"><FileText size={18} className="text-cyan-300" /><div><p className="eyebrow">Case management</p><h2 className="mt-1 text-lg font-semibold text-white">Case information</h2></div></div>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <label className="text-sm text-slate-400">Case title<input required minLength={2} maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} className="field mt-1" /></label>
            <label className="text-sm text-slate-400">Status<select value={status} onChange={(event) => setStatus(event.target.value as CaseStatus)} className="filter-control mt-1 w-full"><option value="open">Open</option><option value="investigating">Investigating</option><option value="closed">Closed</option><option value="archived">Archived</option></select></label>
          </div>
          <label className="mt-4 block text-sm text-slate-400">Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} rows={4} className="field mt-1 resize-y" placeholder="Observed facts and investigation context." /></label>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4 text-xs text-slate-500"><span>Created by you · {formatDate(caseRecord.created_at)} UTC</span><span>Updated {formatDate(caseRecord.updated_at)} UTC</span></div>
          <button disabled={saving} className="button-primary mt-5">{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save case</button>
        </form>

        <section className="panel-primary p-5 sm:p-6">
          <div className="flex items-center gap-2"><ShieldAlert size={18} className="text-violet-200" /><h2 className="text-sm font-semibold uppercase tracking-wide text-white">Cross-wallet investigation</h2></div>
          <p className="mt-3 text-sm text-slate-300">Retrieve current normal Ethereum transactions for this case&apos;s suspect wallets and identify only observable shared counterparties, destinations, funding sources, direct transfers, and time-proximate activity.</p>
          <p className="mt-4 rounded border border-violet-400/20 bg-slate-950/30 p-3 text-xs text-violet-100">Analytical connection signal — not proof of common ownership or coordinated fraud.</p>
          <button onClick={() => void runAnalysis()} disabled={analysisLoading || caseRecord.wallets.length === 0} className="button-primary mt-5">{analysisLoading ? <Loader2 size={16} className="animate-spin" /> : <Network size={16} />}{analysisLoading ? 'Retrieving live Ethereum data…' : 'Run live case analysis'}</button>
          {caseRecord.wallets.length < 2 && <p className="mt-3 text-xs text-slate-500">Add a second suspect wallet to identify within-case cross-wallet relationships. Single-wallet activity and risk evidence remain available.</p>}
          <p className="mt-3 text-xs text-slate-500">Analysis supports up to {MAX_WALLETS_PER_CASE} suspect wallets per case to keep live evidence retrieval reliable.</p>
        </section>
      </div>

      <section className="panel p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3"><div className="flex items-center gap-2"><WalletCards size={18} className="text-cyan-300" /><h2 className="text-sm font-semibold uppercase tracking-wide text-white">Associated suspect wallets</h2></div><span className="font-mono text-sm text-slate-400">{caseRecord.wallets.length} / {MAX_WALLETS_PER_CASE}</span></div>
        <form onSubmit={addWallet} className="mt-4 flex flex-col gap-3 sm:flex-row"><input aria-label="Ethereum wallet address to add to this case" value={newWallet} onChange={(event) => setNewWallet(event.target.value)} disabled={caseRecord.wallets.length >= MAX_WALLETS_PER_CASE} spellCheck={false} placeholder="0x… Ethereum wallet address" className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 p-2 font-mono text-sm text-white outline-none focus:border-cyan-400 disabled:opacity-50" /><button disabled={addingWallet || caseRecord.wallets.length >= MAX_WALLETS_PER_CASE} className="inline-flex items-center justify-center gap-2 rounded border border-cyan-400/30 px-4 py-2 text-sm text-cyan-200 hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-60">{addingWallet ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Add wallet</button></form>
        {caseRecord.wallets.length === 0 ? <p className="mt-5 rounded border border-dashed border-slate-700 bg-slate-900/30 p-5 text-center text-sm text-slate-500">No suspect wallets are associated with this private case yet.</p> : <div className="mt-4 divide-y divide-slate-800 rounded border border-slate-800">{caseRecord.wallets.map((wallet) => <div key={wallet.id} className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/20 p-4"><div className="min-w-0"><WalletAddress address={wallet.address} /><p className="mt-1 text-xs text-slate-500">Added {formatDate(wallet.added_at)} UTC</p></div><button onClick={() => void removeWallet(wallet.id)} disabled={removingWalletId === wallet.id} className="inline-flex items-center gap-1 rounded border border-red-400/20 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-400/10 disabled:opacity-60">{removingWalletId === wallet.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Remove</button></div>)}</div>}
      </section>

      <CaseBookmarks key={`bookmarks:${caseRecord.id}`} caseId={caseRecord.id} />
      <CaseNotes key={caseRecord.id} caseId={caseRecord.id} />

      <section className="evidence-note"><div className="flex items-center gap-2"><CalendarClock size={15} /><span>Case data is private to your account. Blockchain addresses and transactions remain public on Ethereum; this application stores only your private case metadata and saved comparison evidence.</span></div></section>

      {analysis && <section className="mt-8"><div className="mb-5 flex items-center gap-2"><FolderKanban size={20} className="text-violet-200" /><div><h2 className="text-xl font-semibold text-white">Case evidence and connection analysis</h2><p className="mt-1 text-sm text-slate-500">{analysis.source}.</p></div></div><CaseConnectionAnalysisPanel analysis={analysis} mode="case" /></section>}
    </div>
  );
}
