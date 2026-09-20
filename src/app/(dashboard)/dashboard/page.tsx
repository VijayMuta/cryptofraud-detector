'use client';

import Link from 'next/link';
import { VictimReportSummary } from '@/components/victim-report-summary';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowRight, BellRing, Clock, Database, FolderKanban, Loader2, Network, Radar, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { authenticatedFetch } from '@/lib/client-api';

type CaseRecord = { id: string; case_code: string; title: string; status: 'open' | 'investigating' | 'closed' | 'archived'; created_at: string; updated_at: string; wallets: { address: string }[] };
type AlertRecord = { id: string; severity: 'critical' | 'high'; status: 'new' | 'reviewing' | 'closed'; created_at: string; title: string };
type TimelineEvent = { id: string; kind: 'case' | 'alert'; title: string; detail: string; at: string; href: string; tone: 'cyan' | 'red' | 'amber' };

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date);
}

function statusClass(status: CaseRecord['status']) {
  return status === 'investigating' ? 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200' : status === 'open' ? 'border-violet-400/25 bg-violet-400/10 text-violet-200' : 'border-slate-700 bg-slate-800 text-slate-300';
}

export default function Dashboard() {
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [alertOverview, setAlertOverview] = useState<{ total: number; needsReview: number; critical: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [casesResponse, alertsResponse] = await Promise.all([authenticatedFetch('/api/cases'), authenticatedFetch('/api/alerts?overview=1')]);
      const [casePayload, alertPayload] = await Promise.all([casesResponse.json(), alertsResponse.json()]);
      if (!casesResponse.ok) throw new Error(typeof casePayload?.error === 'string' ? casePayload.error : 'Unable to load cases.');
      if (!alertsResponse.ok) throw new Error(typeof alertPayload?.error === 'string' ? alertPayload.error : 'Unable to load alerts.');
      setCases(Array.isArray(casePayload?.cases) ? casePayload.cases : []);
      setAlerts(Array.isArray(alertPayload?.alerts) ? alertPayload.alerts : []);
      if (typeof alertPayload?.summary?.critical !== 'number' || typeof alertPayload?.summary?.needsReview !== 'number' || typeof alertPayload?.summary?.total !== 'number') throw new Error('Alert overview is unavailable.');
      setAlertOverview(alertPayload.summary);
      setVerifiedAt(new Date().toISOString());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load investigation workspace.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);

  const stats = useMemo(() => ({
    active: cases.filter((item) => item.status === 'open' || item.status === 'investigating').length,
    investigating: cases.filter((item) => item.status === 'investigating').length,
    critical: alertOverview?.critical ?? 0,
    wallets: new Set(cases.flatMap((item) => item.wallets.map((wallet) => wallet.address.toLowerCase()))).size,
  }), [alerts, cases, alertOverview]);

  const timeline = useMemo<TimelineEvent[]>(() => [
    ...cases.map((item) => ({ id: `case-${item.id}`, kind: 'case' as const, title: item.title, detail: `${item.case_code} · ${item.status.replace('-', ' ')}`, at: item.updated_at, href: `/cases/${item.id}`, tone: 'cyan' as const })),
    ...alerts.map((item) => ({ id: `alert-${item.id}`, kind: 'alert' as const, title: item.title, detail: `${item.severity} alert · ${item.status.replace('-', ' ')}`, at: item.created_at, href: '/alerts', tone: item.severity === 'critical' ? 'red' as const : 'amber' as const })),
  ].filter((item) => !Number.isNaN(Date.parse(item.at))).sort((left, right) => Date.parse(right.at) - Date.parse(left.at)).slice(0, 6), [alerts, cases]);

  return <div className="space-y-6 pb-10">
    <header className="panel-primary relative overflow-hidden px-5 py-6 sm:px-7 sm:py-7">
      <div className="pointer-events-none absolute inset-y-0 right-0 w-2/5 bg-[radial-gradient(circle_at_70%_30%,rgba(34,211,238,0.16),transparent_54%)]" />
      <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2"><p className="eyebrow">CHAINTRACE / Investigation operations</p><span className="status-chip border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-200"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />Secure workspace</span></div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Investigation Command Center</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Trace the Money. Detect the Pattern. Connect the Cases.</p>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-slate-500"><span className="inline-flex items-center gap-1.5"><Database size={14} className="text-cyan-300" />Private case workspace</span><span className="inline-flex items-center gap-1.5"><Network size={14} className="text-cyan-300" />Source and retrieval time shown per analysis</span><span className="inline-flex items-center gap-1.5"><Clock size={14} className="text-cyan-300" />{verifiedAt ? `Workspace refreshed ${formatDate(verifiedAt)} UTC` : 'Awaiting workspace data'}</span></div>
        </div>
        <div className="flex flex-wrap gap-3"><button type="button" onClick={() => void loadWorkspace()} disabled={loading} className="button-secondary">{loading ? <Loader2 size={17} className="animate-spin" /> : <RefreshCw size={17} />}Refresh</button><Link href="/investigate" className="button-primary"><Search size={17} />Investigate wallet</Link></div>
      </div>
    </header>

    {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200"><AlertTriangle size={18} className="mt-0.5 shrink-0" />{error}</div>}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Investigation metrics">
      <Metric label="Active cases" value={stats.active} detail="Open or under investigation" icon={FolderKanban} tone="cyan" loading={loading || Boolean(error)} />
      <Metric label="Investigations" value={stats.investigating} detail="Currently in evidence review" icon={Radar} tone="violet" loading={loading || Boolean(error)} />
      <Metric label="Critical alerts" value={stats.critical} detail="Unresolved monitoring signals" icon={AlertTriangle} tone="red" loading={loading || Boolean(error)} />
      <Metric label="Case wallets" value={stats.wallets} detail="Reported across your private cases" icon={ShieldCheck} tone="emerald" loading={loading || Boolean(error)} />
    </section>

    <VictimReportSummary />

    <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-800/90 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="eyebrow">Case activity</p><h2 className="mt-1 text-lg font-semibold text-white">Recent investigations</h2></div><Link href="/cases" className="inline-flex items-center gap-1 text-sm font-medium text-cyan-200 hover:text-cyan-100">View case register<ArrowRight size={16} /></Link>
        </div>
        {loading ? <div className="flex h-64 items-center justify-center text-sm text-slate-400"><Loader2 size={17} className="mr-2 animate-spin" />Loading authorized case data…</div> : cases.length === 0 ? <div className="empty-state m-5"><FolderKanban size={24} className="mx-auto text-cyan-300" /><p className="mt-3 font-medium text-slate-200">No private cases yet.</p><p className="mx-auto mt-1 max-w-md text-xs leading-5">Create a case or submit a wallet allegation report to begin an investigation.</p></div> : <div className="divide-y divide-slate-800/90">{cases.slice(0, 5).map((caseRecord) => <Link key={caseRecord.id} href={`/cases/${caseRecord.id}`} className="group flex flex-col gap-3 px-5 py-4 transition hover:bg-cyan-400/[0.035] sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-cyan-200">{caseRecord.case_code}</span><span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusClass(caseRecord.status)}`}>{caseRecord.status}</span></div><p className="mt-2 truncate text-sm font-medium text-white">{caseRecord.title}</p><p className="mt-1 text-xs text-slate-500">Updated {formatDate(caseRecord.updated_at)} UTC · {caseRecord.wallets.length} reported wallet{caseRecord.wallets.length === 1 ? '' : 's'}</p></div><ArrowRight size={18} className="shrink-0 text-slate-500 transition group-hover:translate-x-0.5 group-hover:text-cyan-200" /></Link>)}</div>}
      </section>

      <section className="panel p-5">
        <div className="flex items-center gap-2 text-cyan-300"><Activity size={18} /><p className="eyebrow">Investigation status</p></div><h2 className="mt-2 text-lg font-semibold text-white">Evidence workflow</h2>
        <div className="mt-5 space-y-1"><WorkflowStep title="Record" detail="Capture a reported wallet and incident context." href="/report" /><WorkflowStep title="Analyze" detail="Retrieve normal-transfer data through the configured source." href="/investigate" /><WorkflowStep title="Monitor" detail="Review configured alerts and preserve response status." href="/alerts" /><WorkflowStep title="Connect" detail="Compare case evidence without inferring ownership." href="/cases" /></div>
        <div className="evidence-note mt-5"><ShieldCheck size={16} className="mr-2 inline-block" />The platform can flag patterns and preserve evidence. A risk indicator does not establish fraud or wallet ownership.</div>
      </section>
    </div>

    <section className="panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-800/90 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="eyebrow">Network activity</p><h2 className="mt-1 text-lg font-semibold text-white">Operational coverage snapshot</h2></div>
        <p className="text-xs text-slate-500">Derived from your private case and monitoring records</p>
      </div>
      {loading ? <div className="flex h-36 items-center justify-center text-sm text-slate-400"><Loader2 size={17} className="mr-2 animate-spin" />Retrieving workspace coverage…</div> : stats.active + alerts.length + stats.wallets === 0 ? <div className="empty-state m-5"><Network size={24} className="mx-auto text-cyan-300" /><p className="mt-3 font-medium text-slate-200">No verified network activity available.</p><p className="mx-auto mt-1 max-w-md text-xs leading-5">Create a case, analyze a reported wallet, or enable monitoring to begin building an operational view.</p></div> : <div className="grid gap-px bg-slate-800 md:grid-cols-3"><CoverageMeter label="Active case coverage" value={stats.active} detail="Open or investigating private cases" max={Math.max(cases.length, 1)} tone="cyan" /><CoverageMeter label="Alert review queue" value={alertOverview?.needsReview ?? 0} detail="Unresolved stored monitoring alerts" max={Math.max(alertOverview?.total ?? 0, 1)} tone="amber" /><CoverageMeter label="Case wallet coverage" value={stats.wallets} detail="Reported wallets across active records" max={Math.max(stats.wallets, 1)} tone="violet" /></div>}
    </section>

    <section className="panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-800/90 px-5 py-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="eyebrow">Operational timeline</p><h2 className="mt-1 text-lg font-semibold text-white">Recent case and alert events</h2></div><Link href="/alerts" className="inline-flex items-center gap-1 text-sm font-medium text-cyan-200 hover:text-cyan-100">Open alert center<ArrowRight size={16} /></Link></div>
      {loading ? <div className="flex h-36 items-center justify-center text-sm text-slate-400"><Loader2 size={17} className="mr-2 animate-spin" />Retrieving workspace activity…</div> : timeline.length === 0 ? <div className="empty-state m-5">No verified workspace activity is available yet.</div> : <div className="grid divide-y divide-slate-800/90 md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-3">{timeline.map((event) => <Link key={event.id} href={event.href} className="group flex gap-3 p-5 transition hover:bg-cyan-400/[0.035]"><span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${event.tone === 'red' ? 'border-red-400/20 bg-red-400/10 text-red-200' : event.tone === 'amber' ? 'border-amber-400/20 bg-amber-400/10 text-amber-200' : 'border-cyan-400/20 bg-cyan-400/10 text-cyan-200'}`}>{event.kind === 'alert' ? <BellRing size={15} /> : <FolderKanban size={15} />}</span><span className="min-w-0"><span className="block truncate text-sm font-medium text-slate-200 group-hover:text-white">{event.title}</span><span className="mt-1 block text-xs text-slate-500">{event.detail}</span><span className="mt-2 block text-[11px] text-slate-600">{formatDate(event.at)} UTC</span></span></Link>)}</div>}
    </section>
  </div>;
}

function Metric({ label, value, detail, icon: Icon, tone, loading }: { label: string; value: number; detail: string; icon: typeof FolderKanban; tone: 'cyan' | 'violet' | 'red' | 'emerald'; loading: boolean }) {
  const styles = { cyan: 'text-cyan-200 border-cyan-400/20 bg-cyan-400/[0.07]', violet: 'text-violet-200 border-violet-400/20 bg-violet-400/[0.07]', red: 'text-red-200 border-red-400/20 bg-red-400/[0.07]', emerald: 'text-emerald-200 border-emerald-400/20 bg-emerald-400/[0.07]' }[tone];
  return <article className="metric-card"><div className="flex items-start justify-between gap-3"><p className="meta-label">{label}</p><span className={`flex h-8 w-8 items-center justify-center rounded-lg border ${styles}`}><Icon size={16} /></span></div><p className="mt-5 font-mono text-3xl font-medium text-white">{loading ? '—' : value}</p><p className="mt-2 text-xs text-slate-500">{detail}</p></article>;
}

function WorkflowStep({ title, detail, href }: { title: string; detail: string; href: string }) {
  return <Link href={href} className="group flex items-center gap-3 rounded-xl px-3 py-3 transition hover:bg-slate-800/65"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/[0.06] text-[10px] font-mono text-cyan-200">{title.slice(0, 1)}</span><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-slate-200">{title}</span><span className="block text-xs leading-5 text-slate-500">{detail}</span></span><ArrowRight size={15} className="shrink-0 text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-cyan-200" /></Link>;
}

function CoverageMeter({ label, value, detail, max, tone }: { label: string; value: number; detail: string; max: number; tone: 'cyan' | 'amber' | 'violet' }) {
  const percent = Math.min(100, Math.max(0, Math.round((value / max) * 100)));
  const color = tone === 'amber' ? 'bg-amber-300' : tone === 'violet' ? 'bg-violet-300' : 'bg-cyan-300';
  const valueColor = tone === 'amber' ? 'text-amber-200' : tone === 'violet' ? 'text-violet-200' : 'text-cyan-200';
  return <article className="bg-slate-950/35 p-5"><div className="flex items-start justify-between gap-4"><p className="meta-label">{label}</p><p className={`font-mono text-2xl ${valueColor}`}>{value}</p></div><div className="mt-5 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className={`h-full rounded-full ${color}`} style={{ width: `${percent}%` }} /></div><p className="mt-3 text-xs leading-5 text-slate-500">{detail}</p></article>;
}
