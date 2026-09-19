'use client';

import { WalletAddress } from '@/components/wallet-address';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, BellRing, CheckCircle2, ExternalLink, Filter, Loader2, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { authenticatedFetch } from '@/lib/client-api';

type AlertStatus = 'new' | 'reviewing' | 'closed';
type MonitoringAlert = {
  id: string;
  alert_type: 'fund_splitting' | 'unusual_movement';
  severity: 'high' | 'critical';
  title: string;
  description: string;
  source_transaction_hash: string;
  risk_score: number | null;
  status: AlertStatus;
  created_at: string;
  wallet: string | null;
};

function abbreviate(value: string, start = 8, end = 6) {
  return value.length > start + end ? value.slice(0, start) + '...' + value.slice(-end) : value;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Unavailable'
    : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date);
}

function displayStatus(status: AlertStatus) {
  if (status === 'reviewing') return 'Under Review';
  if (status === 'closed') return 'Resolved';
  return 'New';
}

function statusClass(status: AlertStatus) {
  if (status === 'new') return 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200';
  if (status === 'reviewing') return 'border-amber-400/25 bg-amber-400/10 text-amber-200';
  return 'border-slate-700 bg-slate-800 text-slate-300';
}

function isAlert(value: unknown): value is MonitoringAlert {
  if (typeof value !== 'object' || value === null) return false;
  const alert = value as Record<string, unknown>;
  return typeof alert.id === 'string'
    && typeof alert.title === 'string'
    && typeof alert.description === 'string'
    && typeof alert.source_transaction_hash === 'string'
    && (alert.severity === 'critical' || alert.severity === 'high')
    && (alert.status === 'new' || alert.status === 'reviewing' || alert.status === 'closed');
}

export default function Alerts() {
  const [alerts, setAlerts] = useState<MonitoringAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState<'all' | MonitoringAlert['severity']>('all');
  const [status, setStatus] = useState<'all' | AlertStatus>('all');
  const [query, setQuery] = useState('');

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await authenticatedFetch('/api/alerts');
      const payload: unknown = await response.json();
      if (!response.ok) {
        const reason = typeof payload === 'object' && payload !== null && typeof (payload as Record<string, unknown>).error === 'string'
          ? (payload as Record<string, unknown>).error as string
          : 'Unable to load alerts.';
        throw new Error(reason);
      }
      const rawAlerts = typeof payload === 'object' && payload !== null
        ? (payload as Record<string, unknown>).alerts
        : null;
      const rows = Array.isArray(rawAlerts) ? rawAlerts.filter(isAlert) : [];
      setAlerts(rows);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load alerts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAlerts(); }, [loadAlerts]);

  const visibleAlerts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return alerts.filter((alert) => (severity === 'all' || alert.severity === severity) && (status === 'all' || alert.status === status) && (!normalizedQuery || [alert.title, alert.description, alert.wallet || '', alert.source_transaction_hash].join(' ').toLowerCase().includes(normalizedQuery)));
  }, [alerts, query, severity, status]);
  const counts = useMemo(() => ({
    critical: alerts.filter((item) => item.severity === 'critical' && item.status !== 'closed').length,
    high: alerts.filter((item) => item.severity === 'high' && item.status !== 'closed').length,
    new: alerts.filter((item) => item.status === 'new').length,
  }), [alerts]);

  async function updateStatus(alertId: string, nextStatus: AlertStatus) {
    const current = alerts.find((alert) => alert.id === alertId);
    if (!current || current.status === nextStatus) return;
    setUpdatingId(alertId);
    setError('');
    setMessage('');
    try {
      const response = await authenticatedFetch('/api/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertId, status: nextStatus }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const reason = typeof payload === 'object' && payload !== null && typeof (payload as Record<string, unknown>).error === 'string'
          ? (payload as Record<string, unknown>).error as string
          : 'Unable to update the alert.';
        throw new Error(reason);
      }
      setAlerts((items) => items.map((alert) => alert.id === alertId ? { ...alert, status: nextStatus } : alert));
      setMessage('Alert status updated to ' + displayStatus(nextStatus) + '.');
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update the alert.');
    } finally {
      setUpdatingId('');
    }
  }

  return (
    <div className="space-y-6 pb-10">
      <header className="page-header">
        <div>
          <p className="eyebrow">Monitoring queue</p>
          <h1 className="page-title">Alert Center</h1>
          <p className="page-description">Review configured monitoring signals returned from newly detected Ethereum activity. Severity is a review priority, not proof of fraud.</p>
        </div>
        <button onClick={() => void loadAlerts()} disabled={loading} className="button-secondary">
          {loading ? <Loader2 size={17} className="animate-spin" /> : <RefreshCw size={17} />}Refresh
        </button>
      </header>

      {error && <div role="alert" className="flex gap-2 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200"><AlertCircle size={18} className="shrink-0" />{error}</div>}
      {message && <div role="status" className="flex gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.08] p-4 text-sm text-emerald-100"><CheckCircle2 size={18} className="shrink-0" />{message}</div>}

      <section className="grid gap-3 sm:grid-cols-3">
        <AlertMetric label="Critical unresolved" value={loading ? '—' : String(counts.critical)} tone="red" detail="Configured critical rule results" />
        <AlertMetric label="High unresolved" value={loading ? '—' : String(counts.high)} tone="amber" detail="Configured high rule results" />
        <AlertMetric label="New" value={loading ? '—' : String(counts.new)} tone="cyan" detail="Awaiting analyst review" />
      </section>

      <section className="panel p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-cyan-300"><Filter size={17} /><p className="text-xs font-medium uppercase tracking-wide">Filter alert evidence</p></div>
            <h2 className="mt-2 text-lg font-semibold text-white">Detected activity</h2>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="relative"><span className="sr-only">Search alert evidence</span><Search size={16} className="pointer-events-none absolute left-3 top-3 text-slate-500" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="filter-control w-full py-2 pl-9" placeholder="Search evidence" /></label>
            <select value={severity} onChange={(event) => setSeverity(event.target.value as typeof severity)} aria-label="Filter alerts by severity" className="filter-control py-2">
              <option value="all">All available severities</option><option value="critical">Critical</option><option value="high">High</option>
            </select>
            <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label="Filter alerts by status" className="filter-control py-2">
              <option value="all">All statuses</option><option value="new">New</option><option value="reviewing">Under Review</option><option value="closed">Resolved</option>
            </select>
          </div>
        </div>

        {loading && alerts.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-slate-400"><Loader2 size={18} className="mr-2 animate-spin" />Loading monitoring alerts…</div>
        ) : visibleAlerts.length === 0 ? (
          <div className="mt-5 flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-950/35 p-8 text-center">
            <BellRing size={26} className="text-cyan-300" /><p className="mt-3 text-sm text-slate-200">No alerts match the current view.</p><p className="mt-1 max-w-md text-xs leading-5 text-slate-500">Try another filter, or analyze a wallet and enable monitoring to review newly detected activity. Alerts are signals for review, not findings of fraud.</p>
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto rounded-xl border border-slate-800">
            <table className="technical-table min-w-[1120px]">
              <thead><tr><th>Severity</th><th>Alert / reason</th><th>Wallet</th><th>Evidence</th><th>Detected</th><th>Review status</th></tr></thead>
              <tbody>
                {visibleAlerts.map((alert) => (
                  <tr key={alert.id} className="hover:bg-slate-800/30">
                    <td className={'font-medium capitalize ' + (alert.severity === 'critical' ? 'text-red-200' : 'text-amber-200')}>{alert.severity}</td>
                    <td><p className="text-slate-100">{alert.title}</p><p className="mt-1 max-w-md text-xs leading-5 text-slate-500">{alert.description}</p>{alert.risk_score !== null && <p className="mt-2 font-mono text-xs text-slate-400">Configured risk score: {alert.risk_score}/100</p>}</td>
                    <td className="font-mono text-cyan-200" title={alert.wallet || undefined}>{alert.wallet ? <WalletAddress address={alert.wallet} /> : 'Unavailable'}</td>
                    <td><a href={'https://etherscan.io/tx/' + alert.source_transaction_hash} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-cyan-200 hover:text-cyan-100" title={alert.source_transaction_hash}>{abbreviate(alert.source_transaction_hash)}<ExternalLink size={13} /></a></td>
                    <td className="whitespace-nowrap text-slate-400">{formatTimestamp(alert.created_at)} UTC</td>
                    <td><label className="sr-only" htmlFor={'alert-status-' + alert.id}>Update review status for {alert.title}</label><select id={'alert-status-' + alert.id} value={alert.status} disabled={updatingId === alert.id} onChange={(event) => void updateStatus(alert.id, event.target.value as AlertStatus)} className={'rounded-lg border px-2.5 py-1.5 text-xs font-medium outline-none disabled:opacity-60 ' + statusClass(alert.status)}><option value="new">New</option><option value="reviewing">Under Review</option><option value="closed">Resolved</option></select></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="evidence-note"><ShieldAlert size={16} className="mr-2 inline-block" />Alert severity reflects configured monitoring rules and returned on-chain evidence. It does not establish criminal activity or wallet ownership.</div>
    </div>
  );
}

function AlertMetric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'red' | 'amber' | 'cyan' }) {
  const color = tone === 'red' ? 'text-red-200' : tone === 'amber' ? 'text-amber-200' : 'text-cyan-200';
  return <article className="metric-card"><p className="meta-label">{label}</p><p className={'mt-4 font-mono text-3xl ' + color}>{value}</p><p className="mt-2 text-xs text-slate-500">{detail}</p></article>;
}
