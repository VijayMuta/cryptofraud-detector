'use client';

import Link from 'next/link';
import { InvestigationWorkflow } from '@/components/investigation-workflow';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bell,
  Bot,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  ShieldCheck,
  ShieldAlert,
  Siren,
  UserRound,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { getSupabaseBrowser } from '@/lib/supabase';

type NavItem = { name: string; path: string; icon: LucideIcon };
type UserRole = 'analyst' | 'reviewer' | 'admin';

const primaryNav: NavItem[] = [
  { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { name: 'Wallet Investigation', path: '/investigate', icon: Search },
  { name: 'Cases', path: '/cases', icon: FolderKanban },
  { name: 'Alerts', path: '/alerts', icon: Siren },
  { name: 'Blockchain Intelligence', path: '/blockchain-intelligence', icon: Network },
  { name: 'AI Assistant', path: '/ai', icon: Bot },
  { name: 'Victim Report', path: '/report', icon: ShieldAlert },
  { name: 'Reports', path: '/reports', icon: FileText },
  { name: 'Settings', path: '/settings', icon: Settings },
];

function isUserRole(value: unknown): value is UserRole {
  return value === 'analyst' || value === 'reviewer' || value === 'admin';
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('analyst');
  const [checking, setChecking] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let active = true;

    async function loadIdentity() {
      try {
        const { data } = await supabase.auth.getUser();
        if (!data.user) {
          router.replace('/login');
          return;
        }
        if (!active) return;
        setEmail(data.user.email || 'Authorized analyst');

        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', data.user.id)
          .maybeSingle();
        if (active && isUserRole(profile?.role)) setRole(profile.role);
      } catch {
        router.replace('/login');
      } finally {
        if (active) setChecking(false);
      }
    }

    void loadIdentity();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace('/login');
        return;
      }
      setEmail(session.user.email || 'Authorized analyst');
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    function focusCommandBar(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileOpen(false);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', focusCommandBar);
    return () => window.removeEventListener('keydown', focusCommandBar);
  }, []);

  const navItems = useMemo(
    () => role === 'admin'
      ? [...primaryNav, { name: 'Admin Dashboard', path: '/admin', icon: UsersRound }]
      : primaryNav,
    [role],
  );

  async function signOut() {
    await getSupabaseBrowser().auth.signOut();
    router.replace('/login');
  }

  function runGlobalSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = globalSearch.trim();
    router.push(term ? `/blockchain-intelligence?query=${encodeURIComponent(term)}` : '/blockchain-intelligence');
    setMobileOpen(false);
  }

  const displayRole = role === 'admin' ? 'Administrator' : role === 'reviewer' ? 'Reviewer' : 'Authorized analyst';
  const initials = email.slice(0, 1).toUpperCase() || 'A';

  if (checking) {
    return <div role="status" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 text-sm text-slate-400"><ShieldCheck size={32} className="text-cyan-300" /><span className="font-semibold tracking-[0.2em] text-white">CHAINTRACE</span><span>Checking secure session…</span></div>;
  }

  return (
    <div className="app-shell relative min-h-screen bg-[#060b16]/80 text-slate-300 md:flex">
      <a href="#workspace" className="skip-link">Skip to investigation workspace</a>
      {mobileOpen && <button type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-40 bg-slate-950/80 md:hidden" />}
      <aside className={`cf-sidebar fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col border-r border-cyan-950/70 bg-[#07101e]/95 backdrop-blur-xl transition-all duration-300 md:sticky md:top-0 md:h-screen ${mobileOpen ? 'w-72 translate-x-0' : '-translate-x-full md:translate-x-0'} ${collapsed ? 'md:w-[76px]' : 'md:w-72'}`}>
        <div className={`flex h-[76px] items-center border-b border-cyan-950/70 ${collapsed ? 'justify-center px-3' : 'justify-between px-5'}`}>
          <Link href="/dashboard" onClick={() => setMobileOpen(false)} className="flex min-w-0 items-center gap-3" aria-label="CHAINTRACE dashboard">
            <span className="cf-brand-mark relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/30 text-cyan-100 before:absolute before:inset-1 before:rounded-lg before:border before:border-cyan-200/10"><ShieldCheck size={21} /></span>
            {!collapsed && <span className="min-w-0"><span className="block text-lg font-bold tracking-[0.16em] text-white">CHAINTRACE</span><span className="mt-0.5 block truncate text-[10px] uppercase tracking-[0.14em] text-cyan-300">Blockchain investigations</span></span>}
          </Link>
          <button type="button" onClick={() => setMobileOpen(false)} className="text-slate-400 hover:text-white md:hidden" aria-label="Close navigation"><X size={20} /></button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Primary navigation">
          {navItems.map((item, index) => {
            const Icon = item.icon;
            const active = pathname === item.path || (item.path === '/cases' && pathname.startsWith('/cases/')) || (item.path === '/blockchain-intelligence' && pathname === '/intelligence');
            return <div key={item.name}>{!collapsed && (index === 0 || index === 4) && <p className={`px-3 pb-2 ${index === 4 ? 'pt-5' : 'pt-2'} text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600`}>{index === 0 ? 'Operations' : 'Intelligence'}</p>}<Link href={item.path} aria-current={active ? 'page' : undefined} onClick={() => setMobileOpen(false)} title={collapsed ? item.name : undefined} className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${active ? 'bg-cyan-400/[0.1] text-cyan-100 ring-1 ring-inset ring-cyan-300/20 shadow-lg shadow-cyan-950/20' : 'text-slate-400 hover:translate-x-0.5 hover:bg-slate-900/80 hover:text-slate-100'}`}><span className={`absolute bottom-2 left-0 top-2 w-0.5 rounded-r-full bg-cyan-300 transition ${active ? 'opacity-100 shadow-[0_0_12px_rgba(103,232,249,0.8)]' : 'opacity-0'}`} /><Icon size={18} className={`shrink-0 transition ${active ? 'scale-110 text-cyan-200' : 'group-hover:text-cyan-200'}`} /><span className={collapsed ? 'sr-only' : 'truncate'}>{item.name}</span>{active && !collapsed && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.8)]" aria-hidden="true" />}</Link></div>;
          })}
        </nav>
        <div className="border-t border-cyan-950/70 p-3">
          <div className={`mb-3 flex items-center gap-3 rounded-xl border border-slate-800/80 bg-slate-900/55 p-3 ${collapsed ? 'justify-center' : ''}`}>
            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-400/15 text-xs font-semibold text-violet-100">{initials}<span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0a1422] bg-emerald-300" /></span>
            {!collapsed && <span className="min-w-0"><span className="block truncate text-xs text-slate-200">{email}</span><span className="mt-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500"><span className="h-1 w-1 rounded-full bg-emerald-300" />{displayRole}</span></span>}
          </div>
          <button type="button" onClick={() => void signOut()} title={collapsed ? 'Sign out' : undefined} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-900 hover:text-white ${collapsed ? 'justify-center' : ''}`}><LogOut size={17} /><span className={collapsed ? 'sr-only' : ''}>Sign out</span></button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="command-header sticky top-0 z-30 flex h-[76px] items-center gap-3 border-b border-cyan-950/60 px-4 backdrop-blur-xl md:px-6">
          <button type="button" onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-900 hover:text-white md:hidden" aria-label="Open navigation" aria-expanded={mobileOpen}><Menu size={21} /></button>
          <button type="button" onClick={() => setCollapsed((current) => !current)} className="hidden rounded-lg p-2 text-slate-400 hover:bg-slate-900 hover:text-white md:inline-flex" aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}>{collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}</button>
          <form onSubmit={runGlobalSearch} className="relative min-w-0 max-w-2xl flex-1"><label htmlFor="global-search" className="sr-only">Search an Ethereum wallet address or transaction hash</label><Search size={17} className="pointer-events-none absolute left-3 top-3 text-cyan-300/70" /><input ref={searchInputRef} id="global-search" value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} className="command-input" placeholder="Search wallet or transaction hash…" />{globalSearch ? <button type="button" onClick={() => setGlobalSearch('')} className="absolute right-12 top-2.5 rounded-md p-1 text-slate-500 hover:bg-slate-800 hover:text-white" aria-label="Clear global search"><X size={15} /></button> : null}<kbd className="pointer-events-none absolute right-3 top-2.5 hidden rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 sm:block">Ctrl K</kbd></form>
          <div className="ml-auto hidden items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-3 py-1.5 text-[10px] font-semibold tracking-[0.12em] text-emerald-200 xl:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.8)]" />SECURE SESSION</div>
          <div className="hidden items-center gap-1.5 rounded-full border border-cyan-400/15 bg-cyan-400/[0.045] px-3 py-1.5 text-[10px] font-semibold tracking-[0.11em] text-cyan-100 2xl:flex"><Network size={13} className="text-cyan-300" />ETHEREUM READY</div>
          <Link href="/alerts" aria-label="Open alerts" className="relative rounded-lg p-2 text-slate-400 hover:bg-slate-900 hover:text-white"><Bell size={19} /></Link>
          <Link href="/settings" aria-label="Open your profile settings" className="hidden items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/55 px-2 py-1.5 text-left transition hover:border-slate-700 sm:flex"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-400/15 text-violet-200"><UserRound size={15} /></span><span className="max-w-28 truncate text-xs text-slate-300">{email}</span></Link>
        </header>
        <main id="workspace" tabIndex={-1} className="min-w-0 px-4 py-6 sm:px-6 lg:px-8"><div className="mx-auto max-w-[1600px]"><InvestigationWorkflow />{children}<footer className="mt-8 flex flex-wrap justify-between gap-3 border-t border-slate-800 pt-5 text-xs leading-5 text-slate-400"><span className="font-semibold tracking-widest text-slate-300">CHAINTRACE</span><span>Risk signals are not proof of fraud. Connections do not prove common ownership. No autonomous fund freezing.</span></footer></div></main>
      </div>
    </div>
  );
}
