'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Database, FileClock, Loader2, RefreshCw, ServerCog, ShieldCheck, UsersRound } from 'lucide-react';
import { authenticatedFetch } from '@/lib/client-api';

type Overview = {
  users: number;
  cases: number;
  alerts: number;
  roles: Array<{ role: 'analyst' | 'reviewer' | 'admin'; count: number }>;
  system: {
    alchemyConfigured: boolean;
    supabaseConfigured: boolean;
    auditLogs: string;
  };
  verifiedAt: string;
};

function isOverview(value: unknown): value is Overview {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Record<string, unknown>;
  return typeof payload.users === 'number'
    && typeof payload.cases === 'number'
    && typeof payload.alerts === 'number'
    && Array.isArray(payload.roles)
    && typeof payload.system === 'object'
    && payload.system !== null
    && typeof payload.verifiedAt === 'string';
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date);
}

export default function Admin() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await authenticatedFetch('/api/admin/overview');
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = typeof payload === 'object' && payload !== null && typeof (payload as Record<string, unknown>).error === 'string'
          ? (payload as Record<string, unknown>).error as string
          : 'Unable to load the administrative overview.';
        throw new Error(message);
      }
      if (!isOverview(payload)) throw new Error('The administrative service returned an invalid response.');
      setOverview(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load the administrative overview.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  if (loading) return <div className="flex h-56 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/40 text-sm text-slate-400"><Loader2 size={18} className="mr-2 animate-spin" />Verifying administrator access…</div>;

  if (error) return <section className="mx-auto max-w-2xl rounded-2xl border border-red-400/20 bg-red-400/[0.06] p-8 text-center"><AlertCircle size={28} className="mx-auto text-red-300" /><h1 className="mt-4 text-xl font-semibold text-white">Administration unavailable</h1><p role="alert" className="mt-3 text-sm leading-6 text-red-200">{error}</p><p className="mt-3 text-xs leading-5 text-slate-500">This workspace does not reveal administrative data to an account without an administrator role.</p></section>;

  return <div className="mx-auto max-w-7xl space-y-6 pb-10"><header className="flex flex-col gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300">Authorized administration</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Admin Dashboard</h1><p className="mt-2 text-sm text-slate-400">Operational overview for authorized administrators. Role changes are deliberately not available here.</p></div><button onClick={() => void loadOverview()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-60"><RefreshCw size={17} />Refresh</button></header><section className="grid gap-3 sm:grid-cols-3"><Metric label="Registered users" value={String(overview?.users ?? 0)} detail="Profiles in Supabase" icon={UsersRound} /><Metric label="Private cases" value={String(overview?.cases ?? 0)} detail="Investigation case records" icon={Database} /><Metric label="Monitoring alerts" value={String(overview?.alerts ?? 0)} detail="Stored alert evidence" icon={ShieldCheck} /></section><div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]"><section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 sm:p-6"><div className="flex items-center gap-2 text-cyan-300"><UsersRound size={18} /><p className="text-xs font-medium uppercase tracking-wide">Role distribution</p></div><h2 className="mt-2 text-lg font-semibold text-white">Accounts by role</h2><div className="mt-5 grid gap-3 sm:grid-cols-3">{overview?.roles.map((item) => <article key={item.role} className="rounded-xl border border-slate-800 bg-slate-950/45 p-4"><p className="text-xs capitalize text-slate-500">{item.role}</p><p className="mt-2 font-mono text-2xl text-white">{item.count}</p></article>)}</div><p className="mt-5 text-xs leading-5 text-slate-500">Profiles are created at sign-up. The database schema prevents a normal user from changing their own role.</p></section><section className="rounded-2xl border border-violet-400/20 bg-violet-400/[0.045] p-5 sm:p-6"><div className="flex items-center gap-2 text-violet-200"><ServerCog size={18} /><p className="text-xs font-medium uppercase tracking-wide">System health</p></div><h2 className="mt-2 text-lg font-semibold text-white">Service configuration</h2><div className="mt-5 space-y-3"><ServiceRow label="Alchemy server integration" available={overview?.system.alchemyConfigured ?? false} /><ServiceRow label="Supabase server integration" available={overview?.system.supabaseConfigured ?? false} /></div><p className="mt-5 text-xs leading-5 text-slate-400">No secret value is exposed by this overview; it reports only whether server-side configuration is present.</p></section></div><section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 sm:p-6"><div className="flex items-center gap-2 text-cyan-300"><FileClock size={18} /><p className="text-xs font-medium uppercase tracking-wide">Auditability</p></div><h2 className="mt-2 text-lg font-semibold text-white">Audit log status</h2><p className="mt-3 text-sm leading-6 text-slate-400">{overview?.system.auditLogs || 'Unavailable'}</p><p className="mt-3 text-xs text-slate-500">Overview last verified {overview ? `${formatTimestamp(overview.verifiedAt)} UTC` : 'Unavailable'}.</p></section></div>;
}

function Metric({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: typeof UsersRound }) {
  return <article className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"><div className="flex items-center justify-between"><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><Icon size={17} className="text-slate-500" /></div><p className="mt-3 font-mono text-2xl text-cyan-200">{value}</p><p className="mt-2 text-xs text-slate-500">{detail}</p></article>;
}

function ServiceRow({ label, available }: { label: string; available: boolean }) {
  return <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/45 p-3"><span className="text-sm text-slate-300">{label}</span><span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${available ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200' : 'border-red-400/25 bg-red-400/10 text-red-200'}`}>{available ? 'Configured' : 'Unavailable'}</span></div>;
}
