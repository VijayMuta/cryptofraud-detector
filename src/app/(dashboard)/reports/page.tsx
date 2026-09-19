'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Download, FileJson2, FileText, Loader2, Printer, RefreshCw, ShieldCheck } from 'lucide-react';
import { authenticatedFetch } from '@/lib/client-api';

type CaseWallet = { id: string; address: string; network: 'ethereum'; added_at: string };
type CaseRecord = {
  id: string;
  case_code: string;
  title: string;
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
  wallets: CaseWallet[];
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date);
}

function csvValue(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function safeFilePart(value: string) {
  return value.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'report';
}

function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function Reports() {
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadCases = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await authenticatedFetch('/api/cases');
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = typeof payload === 'object' && payload !== null && typeof (payload as Record<string, unknown>).error === 'string'
          ? (payload as Record<string, unknown>).error as string
          : 'Unable to load private cases.';
        throw new Error(message);
      }
      const loaded = typeof payload === 'object' && payload !== null && Array.isArray((payload as Record<string, unknown>).cases)
        ? (payload as Record<string, unknown>).cases as CaseRecord[]
        : [];
      setCases(loaded);
      setSelectedId((current) => current || loaded[0]?.id || '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load private cases.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadCases(); }, [loadCases]);

  const selectedCase = useMemo(() => cases.find((item) => item.id === selectedId) || null, [cases, selectedId]);
  const generatedAt = new Date().toISOString();

  function reportPayload(caseRecord: CaseRecord) {
    return {
      generatedAt,
      reportType: 'CryptoFraud Detector evidence-led case export',
      caseInformation: {
        caseId: caseRecord.case_code,
        title: caseRecord.title,
        status: caseRecord.status,
        createdAt: caseRecord.created_at,
        updatedAt: caseRecord.updated_at,
        analystNotes: caseRecord.description || 'Unavailable',
      },
      walletInformation: caseRecord.wallets.map((wallet) => ({ address: wallet.address, network: wallet.network, addedAt: wallet.added_at })),
      evidenceScope: [
        'This export contains private case information and associated reported wallet addresses.',
        'Wallet balance, transactions, Money Fingerprint, Fund Splitting analysis, and Case Merge findings must be generated from an active live investigation before they can be treated as current evidence.',
        'No ownership, exchange identity, or criminal activity is asserted by this report.',
      ],
    };
  }

  function exportJson() {
    if (!selectedCase) return;
    downloadFile(`${safeFilePart(selectedCase.case_code)}-report.json`, `${JSON.stringify(reportPayload(selectedCase), null, 2)}\n`, 'application/json');
  }

  function exportCsv() {
    if (!selectedCase) return;
    const rows = [
      ['Section', 'Field', 'Value'],
      ['Case information', 'Case ID', selectedCase.case_code],
      ['Case information', 'Title', selectedCase.title],
      ['Case information', 'Status', selectedCase.status],
      ['Case information', 'Created', selectedCase.created_at],
      ['Case information', 'Updated', selectedCase.updated_at],
      ['Analyst notes', 'Description', selectedCase.description || 'Unavailable'],
      ...selectedCase.wallets.map((wallet) => ['Wallet information', 'Reported wallet', `${wallet.address} (${wallet.network})`]),
      ['Evidence scope', 'Limitation', 'No live blockchain analysis is included unless generated and reviewed in the investigation workspace.'],
    ];
    downloadFile(`${safeFilePart(selectedCase.case_code)}-report.csv`, `${rows.map((row) => row.map(csvValue).join(',')).join('\n')}\n`, 'text/csv;charset=utf-8');
  }

  return <div className="mx-auto max-w-6xl space-y-6 pb-10"><header className="flex flex-col gap-4 border-b border-slate-800 pb-6 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300">Investigation documentation</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Reports</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Prepare an evidence-led export from a private case record. Exports preserve known facts and make unavailable or ungenerated evidence explicit.</p></div><button type="button" onClick={() => void loadCases()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-60">{loading ? <Loader2 size={17} className="animate-spin" /> : <RefreshCw size={17} />}Refresh cases</button></header>{error && <div role="alert" className="flex gap-2 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200"><AlertCircle size={18} className="shrink-0" />{error}</div>}<section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 sm:p-6"><label htmlFor="report-case" className="text-sm font-medium text-slate-200">Private case to export</label><div className="mt-2 flex flex-col gap-3 sm:flex-row"><select id="report-case" value={selectedId} onChange={(event) => setSelectedId(event.target.value)} disabled={loading || cases.length === 0} className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white outline-none focus:border-cyan-400"><option value="">{loading ? 'Loading cases…' : 'Select a case'}</option>{cases.map((caseRecord) => <option key={caseRecord.id} value={caseRecord.id}>{caseRecord.case_code} · {caseRecord.title}</option>)}</select>{selectedCase && <Link href={`/cases/${selectedCase.id}`} className="inline-flex items-center justify-center rounded-xl border border-cyan-400/25 px-4 py-3 text-sm font-medium text-cyan-200 hover:bg-cyan-400/[0.07]">Open case</Link>}</div></section>{!loading && cases.length === 0 && !error && <section className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/30 p-10 text-center"><FileText size={27} className="mx-auto text-cyan-300" /><h2 className="mt-4 text-lg font-medium text-white">No private cases are available</h2><p className="mt-2 text-sm text-slate-500">Create a case or submit a suspect wallet report before preparing an export.</p><Link href="/report" className="mt-5 inline-flex rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400">Submit a report</Link></section>}{selectedCase && <><section id="report-preview" className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 sm:p-6"><div className="flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-medium uppercase tracking-[0.16em] text-cyan-300">Report preview</p><h2 className="mt-2 text-xl font-semibold text-white">{selectedCase.case_code} · {selectedCase.title}</h2><p className="mt-2 text-sm text-slate-400">Generated {formatDate(generatedAt)} UTC</p></div><span className="rounded-full border border-slate-700 bg-slate-950/45 px-3 py-1.5 text-xs capitalize text-slate-300">{selectedCase.status}</span></div><div className="mt-6 grid gap-5 lg:grid-cols-2"><ReportSection title="Case information"><Definition label="Case ID" value={selectedCase.case_code} /><Definition label="Created" value={formatDate(selectedCase.created_at)} /><Definition label="Last updated" value={formatDate(selectedCase.updated_at)} /><Definition label="Analyst notes" value={selectedCase.description || 'Unavailable'} /></ReportSection><ReportSection title="Wallet information"><Definition label="Reported wallets" value={selectedCase.wallets.length ? `${selectedCase.wallets.length} associated wallet${selectedCase.wallets.length === 1 ? '' : 's'}` : 'Unavailable'} />{selectedCase.wallets.length === 0 ? <p className="mt-4 text-sm text-slate-500">No wallet address is associated with this case.</p> : <ul className="mt-4 space-y-2">{selectedCase.wallets.map((wallet) => <li key={wallet.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 font-mono text-xs text-cyan-200 break-all">{wallet.address}<span className="ml-2 font-sans text-slate-500">{wallet.network}</span></li>)}</ul>}</ReportSection><ReportSection title="Analysis evidence"><Definition label="Money Fingerprint" value="Generate and review in Wallet Investigation; unavailable in this saved case export." /><Definition label="Fund Splitting analysis" value="Generate and review in Wallet Investigation; unavailable in this saved case export." /><Definition label="Case Merge findings" value="Generate and review from Cases; no unverified finding is added here." /></ReportSection><ReportSection title="Evidence language"><Definition label="FACT" value="Private case record fields and wallet addresses above." /><Definition label="UNKNOWN" value="Wallet ownership, exchange identity, intent, and ungenerated blockchain analysis." /><Definition label="INFERENCE" value="Not included without reviewed evidence." /></ReportSection></div></section><section className="grid gap-3 sm:grid-cols-3"><button type="button" onClick={exportJson} className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-400/25 bg-cyan-400/[0.06] px-4 py-3 text-sm font-medium text-cyan-100 hover:bg-cyan-400/[0.1]"><FileJson2 size={17} />Download JSON</button><button type="button" onClick={exportCsv} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/50 px-4 py-3 text-sm font-medium text-slate-200 hover:bg-slate-800"><Download size={17} />Download CSV</button><button type="button" onClick={() => window.print()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-violet-400/25 bg-violet-400/[0.06] px-4 py-3 text-sm font-medium text-violet-100 hover:bg-violet-400/[0.1]"><Printer size={17} />Print / Save PDF</button></section></>}<div className="rounded-xl border border-violet-400/20 bg-violet-400/[0.05] p-4 text-xs leading-5 text-violet-100"><ShieldCheck size={16} className="mr-2 inline-block" />Reports preserve evidence and can support authorized hold or freeze requests. This application itself cannot freeze blockchain assets.</div></div>;
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-slate-800 bg-slate-950/35 p-4"><h3 className="text-sm font-semibold text-slate-100">{title}</h3><div className="mt-4 space-y-3">{children}</div></section>;
}

function Definition({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-slate-300">{value}</p></div>;
}
