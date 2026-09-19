'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AlertCircle, BellRing, CheckCircle2, Eye, Loader2, LockKeyhole, Palette, Save, ServerCog, ShieldCheck, UserRound } from 'lucide-react';
import { authenticatedFetch } from '@/lib/client-api';

type Profile = {
  email: string;
  fullName: string;
  role: 'analyst' | 'reviewer' | 'admin';
  updatedAt: string | null;
};

type SettingsResponse = {
  profile: Profile;
  system: { alchemyConfigured: boolean; monitoringConfigured: boolean };
  verifiedAt: string;
};

function isSettingsResponse(value: unknown): value is SettingsResponse {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  if (typeof result.profile !== 'object' || result.profile === null || typeof result.system !== 'object' || result.system === null) return false;
  const profile = result.profile as Record<string, unknown>;
  const system = result.system as Record<string, unknown>;
  return typeof profile.email === 'string'
    && typeof profile.fullName === 'string'
    && (profile.role === 'analyst' || profile.role === 'reviewer' || profile.role === 'admin')
    && typeof system.alchemyConfigured === 'boolean'
    && typeof system.monitoringConfigured === 'boolean'
    && typeof result.verifiedAt === 'string';
}

function formatTimestamp(value: string | null) {
  if (!value) return 'Unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Unavailable'
    : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date) + ' UTC';
}

export default function Settings() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await authenticatedFetch('/api/settings/profile');
      const payload: unknown = await response.json();
      if (!response.ok) {
        const reason = typeof payload === 'object' && payload !== null && typeof (payload as Record<string, unknown>).error === 'string'
          ? (payload as Record<string, unknown>).error as string
          : 'Unable to load settings.';
        throw new Error(reason);
      }
      if (!isSettingsResponse(payload)) throw new Error('The settings service returned an invalid response.');
      setSettings(payload);
      setFullName(payload.profile.fullName);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await authenticatedFetch('/api/settings/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const reason = typeof payload === 'object' && payload !== null && typeof (payload as Record<string, unknown>).error === 'string'
          ? (payload as Record<string, unknown>).error as string
          : 'Unable to update your profile.';
        throw new Error(reason);
      }
      if (!settings || typeof payload !== 'object' || payload === null || typeof (payload as Record<string, unknown>).profile !== 'object') {
        throw new Error('The settings service returned an invalid response.');
      }
      const profile = (payload as { profile: Profile }).profile;
      setSettings({ ...settings, profile });
      setFullName(profile.fullName);
      setMessage('Profile display name saved.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to update your profile.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex h-56 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/40 text-sm text-slate-400"><Loader2 size={18} className="mr-2 animate-spin" />Loading secure workspace settings…</div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <header className="border-b border-slate-800 pb-6">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300">Workspace configuration</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Settings</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Manage your profile and review the safeguards applied to this investigation workspace.</p>
      </header>

      {error && <div role="alert" className="flex gap-2 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200"><AlertCircle size={18} className="shrink-0" />{error}</div>}
      {message && <div role="status" className="flex gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.08] p-4 text-sm text-emerald-100"><CheckCircle2 size={18} className="shrink-0" />{message}</div>}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <form onSubmit={saveProfile} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 sm:p-6">
          <div className="flex items-center gap-2 text-cyan-300"><UserRound size={18} /><p className="text-xs font-medium uppercase tracking-wide">Profile</p></div>
          <h2 className="mt-2 text-lg font-semibold text-white">Analyst identity</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">Your name is displayed within the protected workspace. Role assignment cannot be changed from this page.</p>
          <label className="mt-5 block text-sm font-medium text-slate-200" htmlFor="full-name">Full name</label>
          <input id="full-name" value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={120} className="field mt-2" autoComplete="name" />
          <label className="mt-4 block text-sm font-medium text-slate-200" htmlFor="profile-email">Email</label>
          <input id="profile-email" value={settings?.profile.email || 'Unavailable'} readOnly className="field mt-2 cursor-not-allowed opacity-70" />
          <div className="mt-4 flex flex-wrap gap-3 text-xs">
            <span className="rounded-full border border-violet-400/25 bg-violet-400/[0.08] px-3 py-1.5 capitalize text-violet-100">{settings?.profile.role || 'analyst'} role</span>
            <span className="rounded-full border border-slate-700 bg-slate-950/50 px-3 py-1.5 text-slate-400">Updated {formatTimestamp(settings?.profile.updatedAt || null)}</span>
          </div>
          <button disabled={saving} className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60">{saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}{saving ? 'Saving profile' : 'Save profile'}</button>
        </form>

        <section className="rounded-2xl border border-violet-400/20 bg-violet-400/[0.045] p-5 sm:p-6">
          <div className="flex items-center gap-2 text-violet-200"><ServerCog size={18} /><p className="text-xs font-medium uppercase tracking-wide">System information</p></div>
          <h2 className="mt-2 text-lg font-semibold text-white">Server configuration</h2>
          <div className="mt-5 space-y-3">
            <ServiceRow label="Alchemy wallet and transaction lookup" configured={settings?.system.alchemyConfigured || false} />
            <ServiceRow label="Scheduled monitoring integration" configured={settings?.system.monitoringConfigured || false} />
          </div>
          <p className="mt-5 text-xs leading-5 text-slate-400">These indicators report configuration only. No API key or secret is exposed, and live blockchain data is marked verified only after a successful lookup.</p>
          <p className="mt-3 text-xs text-slate-500">System state checked {formatTimestamp(settings?.verifiedAt || null)}.</p>
        </section>
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        <SettingCard icon={LockKeyhole} title="Security" detail="Authentication is handled by Supabase. Use password recovery if you need to change your password; never disclose passwords, private keys, seed phrases, or OTP codes." />
        <SettingCard icon={BellRing} title="Notifications" detail="Monitoring is enabled individually from Wallet Investigation. Alerts appear only when a monitored wallet has newly observed activity after its saved baseline." />
        <SettingCard icon={Palette} title="Appearance" detail="The evidence workspace uses a focused dark theme with high-contrast controls, visible focus indicators, and reduced-motion support." />
        <SettingCard icon={Eye} title="Accessibility" detail="The workspace supports keyboard navigation, responsive layouts, semantic headings, and scrollable tables on smaller screens." />
      </section>

      <div className="rounded-xl border border-cyan-400/15 bg-cyan-400/[0.05] p-4 text-xs leading-5 text-cyan-100"><ShieldCheck size={16} className="mr-2 inline-block" />Server-side settings allow a user to update only their display name. Roles remain protected administrative data.</div>
    </div>
  );
}

function ServiceRow({ label, configured }: { label: string; configured: boolean }) {
  return <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/45 p-3"><span className="text-sm text-slate-300">{label}</span><span className={'rounded-full border px-2.5 py-1 text-xs font-medium ' + (configured ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200' : 'border-slate-700 bg-slate-800 text-slate-400')}>{configured ? 'Configured' : 'Unavailable'}</span></div>;
}

function SettingCard({ icon: Icon, title, detail }: { icon: typeof ShieldCheck; title: string; detail: string }) {
  return <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5"><span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/[0.07] text-cyan-200"><Icon size={19} /></span><h2 className="mt-4 text-base font-semibold text-white">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-400">{detail}</p></article>;
}
