'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShieldCheck, LockKeyhole, Mail, ArrowRight, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { getSupabaseBrowser } from '@/lib/supabase';
import { isAuthError } from '@supabase/supabase-js';

function isRateLimitError(error: unknown) {
  return (isAuthError(error) && (
    error.status === 429 || error.code === 'over_email_send_rate_limit' || error.code === 'over_request_rate_limit'
  )) || (error instanceof Error && /rate[ _-]?limit/i.test(error.message));
}

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState('');

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
    if (loading || resending) return;
    setLoading(true);
    setMessage('');
    setNeedsConfirmation(false);
    setResendSuccess('');
    try {
      const { error } = await getSupabaseBrowser().auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.replace('/dashboard');
      router.refresh();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : '';
      if ((isAuthError(error) && error.code === 'email_not_confirmed') || /email not confirmed/i.test(errorMessage)) {
        setNeedsConfirmation(true);
        setMessage('Please verify your email before signing in. Check your inbox and spam folder for the confirmation link, or resend the confirmation email below.');
      } else {
        setMessage(isRateLimitError(error)
          ? 'Too many sign-in attempts. Please wait before trying again.'
          : errorMessage || 'Unable to sign in.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResendConfirmation() {
    if (resending || loading || !needsConfirmation) return;
    setResending(true);
    setMessage('');
    setResendSuccess('');
    try {
      const { error } = await getSupabaseBrowser().auth.resend({ type: 'signup', email });
      if (error) throw error;
      setResendSuccess('Confirmation email sent. Check your inbox and spam folder, then follow the link to verify your email before signing in.');
    } catch (error: unknown) {
      setMessage(isRateLimitError(error)
        ? 'Too many verification emails were requested. Please wait before trying again.'
        : 'Unable to resend the confirmation email. Please try again later.');
    } finally {
      setResending(false);
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
            <div role="alert" className="mb-5 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300 flex gap-2">
              <AlertCircle size={18} className="shrink-0" />
              <span>{message}</span>
            </div>
          )}

          {resendSuccess && (
            <div role="status" className="mb-5 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-300 flex gap-2">
              <CheckCircle2 size={18} className="shrink-0" />
              <span>{resendSuccess}</span>
            </div>
          )}

          {needsConfirmation && (
            <button type="button" onClick={handleResendConfirmation} disabled={resending || loading} className="mb-5 w-full rounded-lg border border-cyan-400/20 bg-cyan-400/10 py-3 text-sm font-semibold text-cyan-300 flex items-center justify-center gap-2 hover:bg-cyan-400/20 disabled:opacity-60 disabled:cursor-not-allowed">
              {resending && <Loader2 className="animate-spin" size={18} />}
              {resending ? 'Sending confirmation email…' : 'Resend confirmation email'}
            </button>
          )}

          <label className="block text-sm text-slate-300 mb-2">Email</label>
          <div className="relative mb-4">
            <Mail className="absolute left-3 top-3 text-slate-500" size={18} />
            <input value={email} disabled={loading || resending} onChange={e => {
              setEmail(e.target.value);
              setNeedsConfirmation(false);
              setResendSuccess('');
              setMessage('');
            }} type="email" required placeholder="analyst@example.com" className="field pl-10" />
          </div>

          <label className="block text-sm text-slate-300 mb-2">Password</label>
          <div className="relative mb-3">
            <LockKeyhole className="absolute left-3 top-3 text-slate-500" size={18} />
            <input value={password} onChange={e => setPassword(e.target.value)} type="password" required minLength={6} placeholder="••••••••" className="w-full rounded-lg border border-slate-700 bg-slate-900/80 pl-10 pr-3 py-3 text-white outline-none focus:border-cyan-400" />
          </div>

          <div className="flex justify-end mb-6">
            <Link href="/reset-password" className="text-sm text-cyan-300 hover:text-cyan-200">Forgot password?</Link>
          </div>

          <button disabled={loading || resending} className="button-primary w-full py-3">
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
