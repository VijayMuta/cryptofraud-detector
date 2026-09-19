'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShieldCheck, LockKeyhole, Mail, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { getSupabaseBrowser } from '@/lib/supabase';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data } = await getSupabaseBrowser().auth.getSession();
        if (data.session) router.replace('/dashboard');
      } catch {
        // Environment setup is explained when the form is submitted.
      }
    };
    checkSession();
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const { error } = await getSupabaseBrowser().auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.replace('/dashboard');
      router.refresh();
    } catch (error: any) {
      setMessage(error?.message || 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-blue-600/10 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(103,232,249,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(103,232,249,0.025)_1px,transparent_1px)] bg-[size:36px_36px]" />
      <div className="w-full max-w-md relative">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-cyan-400/10 border border-cyan-400/20 flex items-center justify-center">
            <ShieldCheck className="text-cyan-300" size={30} />
          </div>
          <p className="eyebrow">Secure analyst access</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">CryptoFraud Detector</h1>
          <p className="mt-2 text-sm text-slate-400">Enter the protected investigation workspace.</p>
        </div>

        <form onSubmit={handleSubmit} className="panel-primary p-6 sm:p-7">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-white">Sign in</h2>
            <p className="text-sm text-slate-500 mt-1">Access your fraud investigation workspace.</p>
          </div>

          {message && (
            <div className="mb-5 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300 flex gap-2">
              <AlertCircle size={18} className="shrink-0" />
              <span>{message}</span>
            </div>
          )}

          <label className="block text-sm text-slate-300 mb-2">Email</label>
          <div className="relative mb-4">
            <Mail className="absolute left-3 top-3 text-slate-500" size={18} />
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" required placeholder="analyst@example.com" className="field pl-10" />
          </div>

          <label className="block text-sm text-slate-300 mb-2">Password</label>
          <div className="relative mb-3">
            <LockKeyhole className="absolute left-3 top-3 text-slate-500" size={18} />
            <input value={password} onChange={e => setPassword(e.target.value)} type="password" required minLength={6} placeholder="••••••••" className="w-full rounded-lg border border-slate-700 bg-slate-900/80 pl-10 pr-3 py-3 text-white outline-none focus:border-cyan-400" />
          </div>

          <div className="flex justify-end mb-6">
            <Link href="/reset-password" className="text-sm text-cyan-300 hover:text-cyan-200">Forgot password?</Link>
          </div>

          <button disabled={loading} className="button-primary w-full py-3">
            {loading ? <Loader2 className="animate-spin" size={18} /> : <ArrowRight size={18} />}
            {loading ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="text-center text-sm text-slate-500 mt-6">
            New analyst? <Link href="/register" className="text-cyan-300 hover:text-cyan-200">Create an account</Link>
          </p>
        </form>
        <p className="text-center text-xs text-slate-600 mt-5">Phase 2 • Authentication and PostgreSQL via Supabase</p>
      </div>
    </main>
  );
}
