'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, FileWarning, Loader2, ShieldCheck } from 'lucide-react';
import { authenticatedFetch } from '@/lib/client-api';

type SubmittedCase = { id: string; case_code: string; title: string };
const ETHEREUM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

export default function ReportWallet() {
  const [submitted, setSubmitted] = useState<SubmittedCase | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const wallet = String(form.get('wallet') || '').trim();
    const transactionHash = String(form.get('transactionHash') || '').trim();
    const amount = String(form.get('amount') || '').trim();
    const dateTime = String(form.get('dateTime') || '').trim();
    const description = String(form.get('description') || '').trim();
    const reference = String(form.get('reference') || '').trim();
    setError('');
    if (!ETHEREUM_ADDRESS_PATTERN.test(wallet)) { setError('Enter a valid Ethereum wallet address beginning with 0x.'); return; }
    if (transactionHash && !HASH_PATTERN.test(transactionHash)) { setError('Transaction hash must be a 0x-prefixed 64-character Ethereum transaction hash.'); return; }
    const reportDetails = [
      'Victim / authorized analyst report',
      transactionHash ? `Transaction hash: ${transactionHash}` : null,
      amount ? `Approximate amount: ${amount}` : null,
      dateTime ? `Reported incident date/time: ${dateTime}` : null,
      reference ? `Reference: ${reference}` : null,
      description ? `Description: ${description}` : null,
    ].filter(Boolean).join('\n');
    setSubmitting(true);
    try {
      const response = await authenticatedFetch('/api/cases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `Wallet report: ${wallet}`, description: reportDetails, status: 'open', wallets: [wallet] }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to submit the report.');
      setSubmitted(payload.case as SubmittedCase);
      event.currentTarget.reset();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : 'Unable to submit the report.'); }
    finally { setSubmitting(false); }
  }

  if (submitted) return <div className="mx-auto max-w-2xl py-10"><section className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-8 text-center"><CheckCircle2 size={32} className="mx-auto text-emerald-300" /><p className="mt-4 text-xs font-medium uppercase tracking-[0.18em] text-emerald-200">Report submitted</p><h1 className="mt-2 text-2xl font-semibold text-white">Case {submitted.case_code} created</h1><p className="mt-3 text-sm leading-6 text-slate-300">Your report was saved as a private investigation case. It does not determine fraud or freeze assets.</p><div className="mt-6 flex flex-wrap justify-center gap-3"><Link href={`/cases/${submitted.id}`} className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400">Open case</Link><button type="button" onClick={() => setSubmitted(null)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">Submit another report</button></div></section></div>;

  return <div className="mx-auto max-w-4xl space-y-6 pb-10"><header className="border-b border-slate-800 pb-6"><p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300">Evidence intake</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Report a suspect wallet</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Create a private case with the reported Ethereum wallet and the facts you can safely share. Never include a private key, seed phrase, password, or one-time code.</p></header>{error && <div role="alert" className="flex gap-2 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200"><AlertCircle size={18} className="shrink-0" />{error}</div>}<form onSubmit={submitReport} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 sm:p-6"><div className="grid gap-5 md:grid-cols-2"><Field label="Wallet address" required><input name="wallet" required autoComplete="off" spellCheck={false} placeholder="0x…" className="field font-mono" /></Field><Field label="Blockchain network"><div className="field flex items-center text-slate-300"><span className="mr-2 h-2 w-2 rounded-full bg-cyan-300" />Ethereum Mainnet</div></Field><Field label="Transaction hash"><input name="transactionHash" autoComplete="off" spellCheck={false} placeholder="0x…" className="field font-mono" /></Field><Field label="Approximate amount"><input name="amount" placeholder="For example: 1.25 ETH" className="field" /></Field><Field label="Date and time"><input name="dateTime" type="datetime-local" className="field" /></Field><Field label="Reference (optional)"><input name="reference" maxLength={300} placeholder="Police / ticket / internal reference" className="field" /></Field><div className="md:col-span-2"><Field label="Description"><textarea name="description" rows={5} maxLength={5000} placeholder="Describe the observed facts, what happened, and any context useful to an authorized investigator." className="field resize-y" /></Field></div></div><div className="mt-6 flex flex-col justify-between gap-4 border-t border-slate-800 pt-5 sm:flex-row sm:items-center"><p className="flex max-w-xl gap-2 text-xs leading-5 text-slate-500"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-cyan-300" />Submitted information becomes part of a private case record. Evidence attachments are not enabled in this workflow.</p><button disabled={submitting} className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60">{submitting ? <Loader2 size={17} className="animate-spin" /> : <FileWarning size={17} />}{submitting ? 'Submitting report' : 'Submit report'}</button></div></form></div>;
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactNode }) { return <label className="block text-sm font-medium text-slate-300"><span className="mb-2 block">{label}{required && <span className="text-cyan-300"> *</span>}</span>{children}</label>; }
