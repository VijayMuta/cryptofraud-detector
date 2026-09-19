import Link from 'next/link';
import { ArrowRight, Bot, BrainCircuit, CircleDashed, Clock3, FileSearch, Fingerprint, MessageSquareText, ShieldAlert, Sparkles } from 'lucide-react';

const prompts = [
  'Summarize this wallet activity.',
  'Explain the Money Fingerprint.',
  'What risk indicators were observed?',
  'Show the major fund movements.',
  'Which transactions require review?',
  'Explain the available evidence limits.',
];

const responseTypes = [
  { label: 'Verified evidence', detail: 'A returned transaction, value, timestamp, address, or case record.', tone: 'cyan' },
  { label: 'Observed pattern', detail: 'A calculation based only on the currently returned evidence.', tone: 'violet' },
  { label: 'Risk indicator', detail: 'A behavioral signal that warrants review; it is not proof of fraud.', tone: 'amber' },
  { label: 'Unknown', detail: 'Ownership, intent, service identity, and any data not returned by the source.', tone: 'slate' },
];

export default function AIAssistant() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-10">
      <header className="page-header">
        <div>
          <p className="eyebrow">Evidence-grounded analyst copilot</p>
          <h1 className="page-title">CryptoFraud Intelligence Assistant</h1>
          <p className="page-description">A controlled interpretation layer for verified blockchain evidence. It does not invent wallet ownership, exchange identities, transaction paths, or case relationships.</p>
        </div>
        <div className="status-chip border-slate-700 bg-slate-900/75 text-slate-300"><CircleDashed size={13} className="text-slate-500" />NO ACTIVE EVIDENCE CONTEXT</div>
      </header>

      <section className="command-panel p-5 sm:p-7">
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-center">
          <div>
            <div className="flex items-center gap-3">
              <span className="cf-brand-mark flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-400/25 text-cyan-200"><Bot size={24} /></span>
              <div><p className="eyebrow">Analyst copilot</p><h2 className="mt-1 text-xl font-semibold text-white">Start from a verified wallet investigation</h2></div>
            </div>
            <p className="mt-5 max-w-2xl text-sm leading-6 text-slate-300">The assistant becomes available inside Wallet Investigation after the platform receives data from its configured blockchain source. Responses are generated from that loaded dataset only and stay explicitly evidence-bound.</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/investigate" className="button-primary"><Sparkles size={17} />Open investigation workspace</Link>
              <Link href="/blockchain-intelligence" className="button-secondary"><FileSearch size={17} />Look up evidence</Link>
            </div>
          </div>
          <aside className="rounded-xl border border-cyan-400/15 bg-slate-950/45 p-5">
            <p className="meta-label">Evidence context</p>
            <div className="mt-4 space-y-4">
              <ContextRow label="Wallet analysis" value="Not loaded" />
              <ContextRow label="Transaction references" value="Unavailable" />
              <ContextRow label="Analysis timestamp" value="Unavailable" />
            </div>
            <p className="mt-5 border-t border-slate-800 pt-4 text-xs leading-5 text-slate-500">The assistant will show source, network, and verification time once real data is loaded.</p>
          </aside>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="panel p-5 sm:p-6">
          <div className="flex items-center gap-2 text-cyan-300"><MessageSquareText size={18} /><p className="eyebrow">Suggested questions</p></div>
          <h2 className="mt-2 text-lg font-semibold text-white">Investigation prompts</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">These prompts are available after a wallet is analyzed. They remain intentionally unavailable here until evidence context exists.</p>
          <div className="mt-5 grid gap-2">
            {prompts.map((prompt, index) => <div key={prompt} className="group flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/35 px-3.5 py-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-cyan-400/15 bg-cyan-400/[0.045] font-mono text-[10px] text-cyan-200">0{index + 1}</span><p className="text-sm text-slate-300">{prompt}</p><ArrowRight size={15} className="ml-auto text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-cyan-200" /></div>)}
          </div>
        </section>

        <section className="panel p-5 sm:p-6">
          <div className="flex items-center gap-2 text-cyan-300"><BrainCircuit size={18} /><p className="eyebrow">Response protocol</p></div>
          <h2 className="mt-2 text-lg font-semibold text-white">Clear evidence language</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">Each response must separate what was returned, what was observed, and what cannot be concluded.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {responseTypes.map((item) => <ResponseType key={item.label} {...item} />)}
          </div>
          <div className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/[0.055] p-4 text-xs leading-5 text-amber-100"><ShieldAlert size={15} className="mr-2 inline-block" />When evidence is insufficient, the required response is: “Insufficient verified blockchain evidence to determine this.”</div>
        </section>
      </div>

      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-800/90 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="eyebrow">Evidence references</p><h2 className="mt-1 text-lg font-semibold text-white">Analysis traceability</h2></div>
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><Clock3 size={14} />Awaiting a verified analysis</span>
        </div>
        <div className="grid gap-px bg-slate-800 md:grid-cols-3">
          <ReferenceTile icon={Fingerprint} label="Wallet context" value="No analyzed wallet" detail="Load a wallet from the investigation workspace." />
          <ReferenceTile icon={FileSearch} label="Transactions" value="No returned references" detail="Only returned transaction hashes can be cited." />
          <ReferenceTile icon={ShieldAlert} label="Risk evidence" value="Not assessed" detail="Signals appear only after evidence-backed analysis." />
        </div>
      </section>
    </div>
  );
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4"><span className="text-xs text-slate-500">{label}</span><span className="text-right font-mono text-xs text-slate-300">{value}</span></div>;
}

function ResponseType({ label, detail, tone }: { label: string; detail: string; tone: string }) {
  const toneClass = tone === 'cyan' ? 'border-cyan-400/18 bg-cyan-400/[0.045] text-cyan-200' : tone === 'violet' ? 'border-violet-400/18 bg-violet-400/[0.045] text-violet-200' : tone === 'amber' ? 'border-amber-400/18 bg-amber-400/[0.045] text-amber-200' : 'border-slate-700 bg-slate-950/40 text-slate-300';
  return <article className={`rounded-xl border p-4 ${toneClass}`}><p className="text-[10px] font-semibold uppercase tracking-[0.15em]">{label}</p><p className="mt-2 text-xs leading-5 text-slate-400">{detail}</p></article>;
}

function ReferenceTile({ icon: Icon, label, value, detail }: { icon: typeof Fingerprint; label: string; value: string; detail: string }) {
  return <article className="bg-slate-950/35 p-5"><Icon size={18} className="text-cyan-300" /><p className="mt-4 meta-label">{label}</p><p className="mt-2 text-sm font-medium text-slate-200">{value}</p><p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p></article>;
}
