'use client';

import { WalletAddress } from '@/components/wallet-address';

import Link from 'next/link';
import { reportCaseDraft } from '@/lib/victim-reports';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowDownUp, ChevronLeft, ChevronRight, FolderKanban, GitMerge, Loader2, Plus, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import { CaseConnectionAnalysisPanel } from '@/components/case-connection-analysis';
import type { CaseConnectionAnalysis } from '@/lib/case-analysis';
import { authenticatedFetch } from '@/lib/client-api';
import { isEthereumAddress } from '@/lib/etherscan';

type CaseWallet = { id: string; address: string; network: 'ethereum'; added_at: string };
type CaseRecord = { id: string; case_code: string; title: string; description: string; status: 'open' | 'investigating' | 'closed' | 'archived'; created_at: string; updated_at: string; wallets: CaseWallet[] };

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date);
}

function abbreviate(value: string) { return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value; }
function statusClass(status: CaseRecord['status']) {
  if (status === 'investigating') return 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200';
  if (status === 'closed') return 'border-slate-600 bg-slate-800 text-slate-300';
  if (status === 'archived') return 'border-slate-700 bg-slate-900 text-slate-500';
  return 'border-violet-400/30 bg-violet-400/10 text-violet-200';
}

export default function Cases() {
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [wallet, setWallet] = useState('');
  const [status, setStatus] = useState<CaseRecord['status']>('open');
  const [caseAId, setCaseAId] = useState('');
  const [caseBId, setCaseBId] = useState('');
  const [mergeAnalysis, setMergeAnalysis] = useState<CaseConnectionAnalysis | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | CaseRecord['status']>('all');
  const [sortBy, setSortBy] = useState<'updated' | 'created' | 'code'>('updated');
  const [page, setPage] = useState(1);

  const loadCases = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await authenticatedFetch('/api/cases');
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to load cases.');
      const loadedCases = Array.isArray(payload?.cases) ? payload.cases as CaseRecord[] : [];
      setCases(loadedCases);
      setCaseAId((current) => current || loadedCases[0]?.id || '');
      setCaseBId((current) => current || loadedCases[1]?.id || '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load cases.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadCases(); }, [loadCases]);
  useEffect(() => { setPage(1); }, [query, sortBy, statusFilter]);

  useEffect(() => {
    const reportId = new URLSearchParams(window.location.search).get('report');
    if (!reportId) return;
    let active = true;
    authenticatedFetch('/api/victim-reports/' + encodeURIComponent(reportId)).then(response => response.json()).then(data => {
      if (!active) return;
      const draft = reportCaseDraft(data.report);
      setTitle(draft.title); setDescription(draft.description); setWallet(draft.wallet);
      setMessage('Draft prepared from your private allegation report. Review and submit the case form; no case has been created yet.');
    }).catch(() => { if (active) setError('Unable to load the private source report. No report details were copied.'); });
    return () => { active = false; };
  }, []);

  const filteredCases = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return cases.filter((caseRecord) => {
      const matchesStatus = statusFilter === 'all' || caseRecord.status === statusFilter;
      const searchable = [caseRecord.case_code, caseRecord.title, caseRecord.description, ...caseRecord.wallets.map((entry) => entry.address)].join(' ').toLowerCase();
      return matchesStatus && (!normalizedQuery || searchable.includes(normalizedQuery));
    }).sort((left, right) => {
      if (sortBy === 'code') return left.case_code.localeCompare(right.case_code);
      const field = sortBy === 'created' ? 'created_at' : 'updated_at';
      return Date.parse(right[field]) - Date.parse(left[field]);
    });
  }, [cases, query, sortBy, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filteredCases.length / 8));
  const currentPage = Math.min(page, totalPages);
  const visibleCases = filteredCases.slice((currentPage - 1) * 8, currentPage * 8);

  async function createCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const walletAddress = wallet.trim();
    if (walletAddress && !isEthereumAddress(walletAddress)) {
      setError('Enter a valid Ethereum wallet address beginning with 0x.');
      return;
    }
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const response = await authenticatedFetch('/api/cases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim(), description: description.trim(), status, wallets: walletAddress ? [walletAddress] : [] }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to create case.');
      const created = payload.case as CaseRecord;
      setCases((current) => [created, ...current]);
      setCaseAId(created.id);
      setTitle(''); setDescription(''); setWallet(''); setStatus('open');
      setMessage(`Case ${created.case_code} was created.`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create case.');
    } finally {
      setSubmitting(false);
    }
  }

  async function compareCases() {
    if (!caseAId || !caseBId || caseAId === caseBId) {
      setError('Choose two different cases to run a merge analysis.');
      return;
    }
    setMerging(true);
    setError('');
    setMessage('');
    try {
      const response = await authenticatedFetch('/api/cases/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseAId, caseBId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to compare cases.');
      setMergeAnalysis(payload.analysis as CaseConnectionAnalysis);
    } catch (compareError) {
      setError(compareError instanceof Error ? compareError.message : 'Unable to compare cases.');
    } finally {
      setMerging(false);
    }
  }

  return <div className="space-y-6 pb-10">
    <header className="page-header"><div><p className="eyebrow">Private case workspace</p><h1 className="page-title">Investigation Cases</h1><p className="page-description">Create, search, and compare private case records. Case relationships are shown only when returned blockchain evidence supports them.</p></div><button type="button" onClick={() => void loadCases()} disabled={loading} className="button-secondary">{loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}Refresh</button></header>
    {error && <div role="alert" className="flex gap-2 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200"><AlertCircle size={18} className="shrink-0" />{error}</div>}
    {message && <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-200">{message}</div>}

    <div className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
      <form onSubmit={createCase} className="panel p-5 sm:p-6"><div className="mb-5 flex items-center gap-2"><Plus size={18} className="text-cyan-300" /><div><p className="eyebrow">Evidence intake</p><h2 className="mt-1 text-lg font-semibold text-white">Create a case</h2></div></div><div className="grid gap-4 md:grid-cols-2"><Field label="Case title"><input id="case-title" required minLength={2} maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} className="field" placeholder="Suspicious distribution review" /></Field><Field label="Status"><select id="case-status" value={status} onChange={(event) => setStatus(event.target.value as CaseRecord['status'])} className="filter-control w-full"><option value="open">Open</option><option value="investigating">Investigating</option><option value="closed">Closed</option><option value="archived">Archived</option></select></Field><div className="md:col-span-2"><Field label="Description"><textarea id="case-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} rows={3} className="field resize-y" placeholder="Observed facts and investigation context." /></Field></div><div className="md:col-span-2"><Field label="First suspect Ethereum wallet (optional)"><input id="case-first-suspect-wallet" type="text" value={wallet} onChange={(event) => setWallet(event.target.value)} spellCheck={false} autoCapitalize="none" autoCorrect="off" className="field font-mono" placeholder="0x…" /><p className="mt-1 text-xs text-slate-500">Checksummed and lowercase Ethereum addresses are accepted.</p></Field></div></div><button disabled={submitting} className="button-primary mt-5">{submitting ? <Loader2 size={16} className="animate-spin" /> : <FolderKanban size={16} />}Create case</button></form>

      <section className="panel-primary p-5 sm:p-6"><div className="mb-3 flex items-center gap-2"><GitMerge size={18} className="text-violet-300" /><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200">Relationship analysis</p><h2 className="mt-1 text-lg font-semibold text-white">Cross-Wallet Investigation</h2></div></div><p className="mb-4 text-sm leading-6 text-slate-400">Compare two private cases using current normal Ethereum transaction histories. Neither case is deleted or reassigned.</p><div className="grid gap-3 sm:grid-cols-2"><select aria-label="First case to compare" value={caseAId} onChange={(event) => setCaseAId(event.target.value)} className="filter-control"><option value="">First case</option>{cases.map((caseRecord) => <option key={caseRecord.id} value={caseRecord.id}>{caseRecord.case_code} · {caseRecord.title}</option>)}</select><select aria-label="Second case to compare" value={caseBId} onChange={(event) => setCaseBId(event.target.value)} className="filter-control"><option value="">Second case</option>{cases.map((caseRecord) => <option key={caseRecord.id} value={caseRecord.id}>{caseRecord.case_code} · {caseRecord.title}</option>)}</select></div><button type="button" onClick={() => void compareCases()} disabled={merging || cases.length < 2} className="button-secondary mt-4 border-violet-400/25 bg-violet-400/10 text-violet-100 hover:border-violet-300/40 hover:bg-violet-400/15">{merging ? <Loader2 size={16} className="animate-spin" /> : <GitMerge size={16} />}Compare evidence</button><p className="mt-4 rounded-xl border border-violet-400/20 bg-slate-950/30 p-3 text-xs leading-5 text-violet-100">An analytical connection signal is not proof of common ownership or coordinated fraud.</p></section>
    </div>

    {mergeAnalysis && <section><div className="mb-5"><p className="text-xs font-medium uppercase tracking-[0.16em] text-violet-200">Verified comparison result</p><h2 className="mt-1 text-xl font-semibold text-white">{mergeAnalysis.caseA.caseCode} ↔ {mergeAnalysis.caseB.caseCode}</h2><p className="mt-1 text-sm text-slate-500">Each relationship category expands to its real normal-transaction evidence.</p></div><CaseConnectionAnalysisPanel analysis={mergeAnalysis} mode="merge" /></section>}

    <section className="panel overflow-hidden"><div className="border-b border-slate-800/90 px-5 py-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="flex items-center gap-2 text-cyan-300"><SlidersHorizontal size={17} /><p className="eyebrow">Case register</p></div><h2 className="mt-2 text-lg font-semibold text-white">Your cases</h2></div><p className="text-xs text-slate-500">{loading ? 'Retrieving private records…' : `${filteredCases.length} matching case${filteredCases.length === 1 ? '' : 's'}`}</p></div><div className="mt-4 grid gap-3 md:grid-cols-[1fr_180px_180px]"><label className="relative"><span className="sr-only">Search cases</span><Search size={16} className="pointer-events-none absolute left-3 top-3 text-slate-500" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="field py-2.5 pl-9" placeholder="Search case ID, title, or wallet" /></label><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="filter-control" aria-label="Filter case status"><option value="all">All statuses</option><option value="open">Open</option><option value="investigating">Investigating</option><option value="closed">Closed</option><option value="archived">Archived</option></select><label className="relative"><ArrowDownUp size={15} className="pointer-events-none absolute left-3 top-3 text-slate-500" /><span className="sr-only">Sort cases</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)} className="filter-control w-full pl-9" aria-label="Sort cases"><option value="updated">Last updated</option><option value="created">Created date</option><option value="code">Case ID</option></select></label></div></div>
      {loading ? <div className="flex h-36 items-center justify-center text-slate-400"><Loader2 size={18} className="mr-2 animate-spin" />Loading private cases…</div> : filteredCases.length === 0 ? <div className="empty-state m-5">{cases.length === 0 ? 'No cases yet. Create a case to add a suspect wallet and begin an investigation.' : 'No case records match the current filters.'}</div> : <div className="overflow-x-auto"><table className="technical-table min-w-[920px]"><thead><tr><th>Case ID</th><th>Case details</th><th>Status</th><th>Suspect wallet</th><th>Updated</th><th className="text-right">Action</th></tr></thead><tbody>{visibleCases.map((caseRecord) => <tr key={caseRecord.id}><td><Link href={`/cases/${caseRecord.id}`} className="font-mono text-xs text-cyan-200 hover:text-cyan-100">{caseRecord.case_code}</Link></td><td><p className="max-w-sm truncate font-medium text-slate-100">{caseRecord.title}</p><p className="mt-1 max-w-sm truncate text-xs text-slate-500">{caseRecord.description || 'No analyst description recorded.'}</p></td><td><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusClass(caseRecord.status)}`}>{caseRecord.status}</span></td><td className="font-mono text-xs text-slate-400">{caseRecord.wallets.length ? <WalletAddress address={caseRecord.wallets[0].address} /> : 'Unavailable'}{caseRecord.wallets.length > 1 ? <span className="ml-1 text-slate-600">+{caseRecord.wallets.length - 1}</span> : null}</td><td className="whitespace-nowrap text-xs text-slate-400">{formatDate(caseRecord.updated_at)} UTC</td><td className="text-right"><Link href={`/cases/${caseRecord.id}`} className="inline-flex rounded-lg border border-cyan-400/25 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-400/[0.08]">Open case</Link></td></tr>)}</tbody></table></div>}
      {!loading && filteredCases.length > 0 && <div className="flex items-center justify-between border-t border-slate-800/90 px-5 py-4"><p className="text-xs text-slate-500">Page {currentPage} of {totalPages}</p><div className="flex gap-2"><button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage <= 1} className="button-secondary px-3 py-2 text-xs"><ChevronLeft size={15} />Previous</button><button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={currentPage >= totalPages} className="button-secondary px-3 py-2 text-xs">Next<ChevronRight size={15} /></button></div></div>}
    </section>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-slate-300"><span className="mb-2 block">{label}</span>{children}</label>; }
