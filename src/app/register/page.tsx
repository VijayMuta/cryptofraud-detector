'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShieldCheck, UserRound, Mail, LockKeyhole, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { getSupabaseBrowser } from '@/lib/supabase';

export default function Register() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true); setMessage(''); setSuccess(false);
    if (password !== confirmPassword) {
      setMessage('Passwords do not match.');
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await getSupabaseBrowser().auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      });
      if (error) throw error;
      if (data.session) router.replace('/dashboard');
      else setSuccess(true);
    } catch (error: any) {
      setMessage(error?.message || 'Unable to create account.');
    } finally { setLoading(false); }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute top-0 right-0 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-96 w-96 rounded-full bg-indigo-600/10 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(103,232,249,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(103,232,249,0.025)_1px,transparent_1px)] bg-[size:36px_36px]" />
      <div className="w-full max-w-md relative">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-cyan-400/10 border border-cyan-400/20 flex items-center justify-center"><ShieldCheck className="text-cyan-300" size={30} /></div>
          <p className="eyebrow">Authorized workspace</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Create secure access</h1>
          <p className="mt-2 text-sm text-slate-400">Set up your CryptoFraud Detector account.</p>
        </div>
        <form onSubmit={handleSubmit} className="panel-primary p-6 sm:p-7">
          {success && <div className="mb-5 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-300 flex gap-2"><CheckCircle2 size={18} /> Check your email to verify the account, then sign in.</div>}
          {message && <div className="mb-5 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300 flex gap-2"><AlertCircle size={18} /><span>{message}</span></div>}
          <label className="block text-sm text-slate-300 mb-2">Full name</label>
          <div className="relative mb-4"><UserRound className="absolute left-3 top-3 text-slate-500" size={18} /><input value={name} onChange={e => setName(e.target.value)} required placeholder="Your name" className="field pl-10" /></div>
          <label className="block text-sm text-slate-300 mb-2">Email</label>
          <div className="relative mb-4"><Mail className="absolute left-3 top-3 text-slate-500" size={18} /><input value={email} onChange={e => setEmail(e.target.value)} type="email" required placeholder="analyst@example.com" className="field pl-10" /></div>
          <label className="block text-sm text-slate-300 mb-2">Password</label>
          <div className="relative mb-4"><LockKeyhole className="absolute left-3 top-3 text-slate-500" size={18} /><input value={password} onChange={e => setPassword(e.target.value)} type="password" required minLength={8} placeholder="At least 8 characters" className="field pl-10" /></div>
          <label className="block text-sm text-slate-300 mb-2">Confirm password</label>
          <div className="relative mb-6"><LockKeyhole className="absolute left-3 top-3 text-slate-500" size={18} /><input value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} type="password" required minLength={8} placeholder="Repeat your password" className="field pl-10" /></div>
          <button disabled={loading} className="w-full rounded-lg bg-cyan-400 text-slate-950 font-semibold py-3 flex items-center justify-center gap-2 hover:bg-cyan-300 disabled:opacity-60">{loading && <Loader2 className="animate-spin" size={18} />}{loading ? 'Creating account…' : 'Create account'}</button>
          <p className="text-center text-sm text-slate-500 mt-6">Already registered? <Link href="/login" className="text-cyan-300 hover:text-cyan-200">Sign in</Link></p>
        </form>
      </div>
    </main>
  );
}
