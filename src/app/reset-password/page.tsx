'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowser } from '@/lib/supabase';
import { ArrowRight, CheckCircle2, LockKeyhole, Mail, Loader2, ShieldCheck } from 'lucide-react';

export default function ResetPassword() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const update = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mode') === 'update';

  async function requestReset(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setMessage('');
    try {
      const origin = window.location.origin;
      const { error } = await getSupabaseBrowser().auth.resetPasswordForEmail(email, { redirectTo: `${origin}/reset-password?mode=update` });
      if (error) throw error;
      setMessage('Password reset email sent. Open the email link to set a new password.');
    } catch (requestError: any) {
      setMessage(requestError?.message || 'Unable to send reset email.');
    } finally { setLoading(false); }
  }

  async function updatePassword(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setMessage('');
    try {
      const { error } = await getSupabaseBrowser().auth.updateUser({ password });
      if (error) throw error;
      setMessage('Password updated successfully. You can now sign in.');
    } catch (updateError: any) {
      setMessage(updateError?.message || 'Unable to update password.');
    } finally { setLoading(false); }
  }

  return <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10"><div className="pointer-events-none absolute -top-32 right-0 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl" /><div className="pointer-events-none absolute -bottom-32 left-0 h-96 w-96 rounded-full bg-violet-500/10 blur-3xl" /><div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(103,232,249,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(103,232,249,0.025)_1px,transparent_1px)] bg-[size:36px_36px]" /><section className="relative w-full max-w-md"><div className="mb-8 text-center"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.08] text-cyan-200"><ShieldCheck size={29} /></span><p className="mt-5 eyebrow">Identity recovery</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Password recovery</h1><p className="mt-2 text-sm text-slate-400">{update ? 'Set a new password for your analyst workspace.' : 'Request a secure reset link for your analyst workspace.'}</p></div><form onSubmit={update ? updatePassword : requestReset} className="panel-primary p-6 sm:p-7">{message && <div className="mb-5 flex gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] p-3 text-sm leading-5 text-cyan-100"><CheckCircle2 size={18} className="mt-0.5 shrink-0" />{message}</div>}{update ? <><label className="mb-2 block text-sm text-slate-300">New password</label><div className="relative mb-5"><LockKeyhole className="absolute left-3 top-3 text-slate-500" size={18} /><input value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} type="password" className="field pl-10" placeholder="At least 8 characters" /></div><button disabled={loading} className="button-primary w-full py-3">{loading ? <Loader2 className="animate-spin" size={18} /> : <ArrowRight size={18} />}{loading ? 'Updating password…' : 'Update password'}</button></> : <><label className="mb-2 block text-sm text-slate-300">Account email</label><div className="relative mb-5"><Mail className="absolute left-3 top-3 text-slate-500" size={18} /><input value={email} onChange={(event) => setEmail(event.target.value)} required type="email" className="field pl-10" placeholder="analyst@example.com" /></div><button disabled={loading} className="button-primary w-full py-3">{loading ? <Loader2 className="animate-spin" size={18} /> : <Mail size={18} />}{loading ? 'Sending secure link…' : 'Send reset email'}</button></>}<p className="mt-6 text-center text-sm"><Link href="/login" className="text-cyan-300 hover:text-cyan-200">Back to sign in</Link></p></form></section></main>;
}
