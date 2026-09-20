'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Bot, Loader2, Send, ShieldCheck } from 'lucide-react';
import { authenticatedFetch } from '@/lib/client-api';
import { isEthereumAddress } from '@/lib/ethereum-address';
import { NOT_CONFIGURED, type AssistantAnswer, type EvidenceContext, type EvidenceFact } from '@/lib/ai-contract';

const prompts = ['Summarize wallet activity', 'Explain Money Fingerprint', 'Explain risk signals', 'Check fund splitting', 'Show important counterparties', 'Summarize case connections', 'What should I investigate next?'];
type Message = { question: string; answer?: AssistantAnswer; error?: string };
type Loaded = { snapshotId: string; evidence: EvidenceContext };

export default function AIAssistant() {
  const [kind, setKind] = useState<'wallet' | 'case'>('wallet');
  const [value, setValue] = useState('');
  const [cases, setCases] = useState<{ id: string; title: string }[]>([]);
  const [caseError, setCaseError] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState<'load' | 'ask' | null>(null);
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    authenticatedFetch('/api/ai').then(response => response.json()).then(data => { if (active) setConfigured(data.configured === true); }).catch(() => { if (active) setError('Unable to check AI availability. Reload this page or load evidence to retry.'); });
    const params = new URLSearchParams(window.location.search);
    if (params.get('address')) setValue(params.get('address')!);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (kind !== 'case') return;
    let active = true;
    setCaseError('');
    authenticatedFetch('/api/cases').then(response => response.json()).then(data => { if (active) setCases(Array.isArray(data.cases) ? data.cases : []); }).catch(() => { if (active) setCaseError('Unable to load your cases. Switch context and retry.'); });
    return () => { active = false; };
  }, [kind]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [messages, busy]);
  function clearContext() { setLoaded(null); setMessages([]); setError(''); }
  async function load(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    clearContext();
    if (kind === 'wallet' && !isEthereumAddress(value.trim())) { setError('Enter a valid Ethereum wallet address.'); return; }
    if (!value.trim()) { setError('Select an investigation context.'); return; }
    lock.current = true; setBusy('load');
    try {
      const response = await authenticatedFetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'load', kind, value }) });
      const data = await response.json(); setLoaded(data); setConfigured(data.configured === true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to load evidence.'); }
    finally { lock.current = false; setBusy(null); }
  }
  async function ask(text: string) {
    if (lock.current || !loaded || !text.trim()) return;
    if (!configured) { setError(NOT_CONFIGURED); return; }
    lock.current = true; setBusy('ask'); setError(''); setQuestion('');
    setMessages(previous => [...previous, { question: text }]);
    try {
      const response = await authenticatedFetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ask', snapshotId: loaded.snapshotId, question: text }) });
      const data = await response.json();
      setMessages(previous => previous.map((message, index) => index === previous.length - 1 ? { ...message, answer: data.answer } : message));
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Unable to generate a grounded response.';
      setMessages(previous => previous.map((entry, index) => index === previous.length - 1 ? { ...entry, error: message } : entry));
      setQuestion(text);
    } finally { lock.current = false; setBusy(null); }
  }
  return <div className="mx-auto max-w-7xl space-y-6 pb-10">
    <header className="page-header"><div><p className="eyebrow">Evidence first ? AI explanation second</p><h1 className="page-title">CHAINTRACE AI</h1><p className="page-description">Evidence-Grounded Investigation Assistant</p></div><span className="status-chip"><ShieldCheck size={16} />{loaded ? 'Evidence loaded' : 'Select evidence'}</span></header>
    <p className="text-sm leading-6 text-slate-400">AI explanations are generated from available investigation evidence and should be independently reviewed. The AI selects relevant evidence and review steps; factual wording and transaction references are controlled by CHAINTRACE.</p>
    {configured === false && <p role="status" className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-4 text-sm text-amber-100">{NOT_CONFIGURED}</p>}
    <div className="grid min-w-0 gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="min-w-0 space-y-5">
        <form onSubmit={load} className="panel space-y-4 p-5"><h2 className="text-lg font-semibold text-white">Investigation context</h2>
          <label className="block text-sm text-slate-300">Evidence type<select disabled={!!busy} className="field mt-2 w-full" value={kind} onChange={event => { setKind(event.target.value as typeof kind); setValue(''); clearContext(); }}><option value="wallet">Ethereum wallet</option><option value="case">My case</option></select></label>
          <label className="block text-sm text-slate-300">{kind === 'wallet' ? 'Wallet address' : 'Owned case'}{kind === 'wallet' ? <input className="field mt-2 w-full font-mono text-xs" value={value} disabled={!!busy} onChange={event => { setValue(event.target.value); clearContext(); }} placeholder="0x?" autoComplete="off" spellCheck={false} /> : <select className="field mt-2 w-full" disabled={!!busy} value={value} onChange={event => { setValue(event.target.value); clearContext(); }}><option value="">Select your case</option>{cases.map(record => <option key={record.id} value={record.id}>{record.title}</option>)}</select>}</label>
          {caseError && kind === 'case' && <p role="alert" className="text-xs text-red-200">{caseError}</p>}
          <button className="button-primary w-full" disabled={!!busy}>{busy === 'load' && <Loader2 size={16} className="animate-spin" />}{busy === 'load' ? 'Retrieving evidence?' : 'Load / refresh evidence'}</button>
          <p className="text-xs leading-5 text-slate-500">Case analysis may take several minutes. Evidence expires after ten minutes; refresh to retrieve newer activity. Refreshing clears this conversation.</p>
        </form>
        <section className="panel p-5"><h2 className="mb-3 text-sm font-semibold text-white">Quick investigation questions</h2><div className="space-y-2">{prompts.map(prompt => <button key={prompt} disabled={!!busy} onClick={() => setQuestion(prompt)} className="w-full rounded-lg border border-slate-800 px-3 py-2 text-left text-xs text-slate-300 transition hover:border-cyan-400/40">{prompt}</button>)}</div></section>
        <div className="flex flex-wrap gap-3 text-xs text-cyan-200"><Link href="/blockchain-intelligence">Blockchain Intelligence</Link><Link href="/cases">Cases</Link></div>
      </aside>
      <section className="panel flex min-w-0 flex-col overflow-hidden">
        <div className="border-b border-slate-800 p-5"><div className="flex items-center gap-2 text-cyan-200"><Bot size={20} /><h2 className="font-semibold">Investigation conversation</h2></div><p className="mt-2 break-all text-xs text-slate-400">{loaded ? loaded.evidence.label : 'Load a wallet or a case before asking a question.'}</p></div>
        <div role="log" aria-label="Investigation conversation" aria-live="polite" className="min-h-[260px] max-h-[65vh] flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
          {!messages.length && <p className="text-sm leading-6 text-slate-500">Ask about observed fund movements, counterparties, analytical signals or case connections. Ownership, intent and service attribution require independent evidence. Questions use the selected snapshot; earlier messages are not sent as evidence.</p>}
          {messages.map((message, index) => <article key={index} className="space-y-3"><div className="ml-4 rounded-xl border border-slate-700 bg-slate-800/50 p-4"><p className="mb-2 text-xs text-slate-500">Investigator</p><p className="whitespace-pre-wrap break-words text-sm text-slate-200">{message.question}</p></div>{message.error && <p role="alert" className="rounded-xl border border-red-400/20 p-4 text-sm text-red-200">{message.error}</p>}{message.answer && <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.025] p-4"><p className="mb-3 text-xs uppercase tracking-wide text-cyan-200">CHAINTRACE AI ? evidence selection</p><p className="text-sm leading-6 text-slate-200">{message.answer.summary}</p>{(['Observed Evidence', 'Analytical Signals'] as const).map(section => { const facts = message.answer!.facts.filter(fact => fact.section === section); return facts.length ? <div key={section} className="mt-4"><h3 className="mb-2 text-sm font-semibold text-white">{section}</h3><div className="space-y-3">{facts.map(fact => <Fact key={fact.id} fact={fact} />)}</div></div> : null; })}{message.answer.steps.length > 0 && <div className="mt-4"><h3 className="text-sm font-semibold text-white">Suggested Investigation Steps</h3><ul className="mt-2 list-disc space-y-2 pl-5 text-xs leading-5 text-slate-300">{message.answer.steps.map(step => <li key={step}>{step}</li>)}</ul></div>}<details className="mt-4 text-xs leading-5 text-slate-400"><summary className="cursor-pointer text-amber-100">Limitations and sources</summary><p className="mt-2">{message.answer.source} ? {message.answer.generatedAt}</p><ul className="mt-2 list-disc space-y-2 pl-5">{message.answer.limitations.map(note => <li key={note}>{note}</li>)}</ul></details><p className="mt-4 text-xs text-amber-100">Analytical signals are not proof of fraud, ownership or intent.</p></div>}</article>)}
          {busy && <p role="status" className="flex items-center gap-2 text-sm text-cyan-200"><Loader2 size={16} className="animate-spin" />{busy === 'load' ? 'Retrieving authorized evidence?' : 'Selecting supporting evidence?'}</p>}<div ref={end} />
        </div>
        <form onSubmit={event => { event.preventDefault(); void ask(question); }} className="space-y-3 border-t border-slate-800 p-4"><label htmlFor="ai-question" className="text-sm text-slate-300">Investigation question</label><textarea id="ai-question" className="field w-full resize-y" rows={3} maxLength={2000} value={question} disabled={!!busy} onChange={event => setQuestion(event.target.value)} placeholder="What does the retrieved evidence show?" /><div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-slate-500">{question.length}/2000 ? Do not enter secrets or unrelated personal data.</span><button className="button-primary" disabled={!!busy || !loaded || !configured || !question.trim()}><Send size={16} />Send</button></div><p className="text-xs leading-5 text-slate-500">Sending shares your question and relevant evidence with the configured OpenAI provider. Case descriptions, account credentials and unrelated records are excluded.</p></form>
      </section>
    </div>
    {error && <p role="alert" className="rounded-xl border border-red-400/20 p-4 text-sm text-red-200">{error}</p>}
    {loaded && <section className="panel p-5"><h2 className="text-lg font-semibold text-white">Evidence / sources</h2><p className="mt-2 break-words text-xs text-slate-400">{loaded.evidence.source} ? Retrieved {loaded.evidence.generatedAt}</p><p className="mt-2 text-xs text-slate-400">Deterministic CHAINTRACE evidence. These statements are available even when AI is unconfigured.</p><details className="mt-4"><summary className="cursor-pointer text-sm text-cyan-200">Inspect {loaded.evidence.facts.length} evidence statements and coverage</summary><ul className="my-4 list-disc space-y-2 pl-5 text-xs text-amber-100">{loaded.evidence.limitations.map(note => <li key={note}>{note}</li>)}</ul><div className="grid gap-4 md:grid-cols-2">{loaded.evidence.facts.map(fact => <Fact key={fact.id} fact={fact} />)}</div></details></section>}
  </div>;
}
function Fact({ fact }: { fact: EvidenceFact }) {
  return <div className="min-w-0 rounded-lg border border-slate-800 p-3"><p className="break-words text-xs leading-6 text-slate-300"><span className="mr-2 font-mono text-cyan-300">[{fact.id}]</span>{fact.text}</p>{fact.hashes.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{fact.hashes.map(hash => <a key={hash} href={'https://etherscan.io/tx/' + hash} title={hash} target="_blank" rel="noreferrer" className="font-mono text-xs text-cyan-200">{hash.slice(0, 10)}?{hash.slice(-6)} ?</a>)}</div>}</div>;
}
