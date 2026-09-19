import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

const steps = [
  ['Victim Report', '/report'],
  ['Wallet Investigation', '/investigate'],
  ['Fund Flow', '/investigate#fund-flow'],
  ['Money Fingerprint', '/investigate#money-fingerprint'],
  ['Risk Signals', '/investigate#risk-signals'],
  ['Monitoring', '/investigate#monitoring'],
  ['Cross-Wallet Investigation', '/cases'],
] as const;

export function InvestigationWorkflow() {
  return <nav aria-label="Investigation workflow" className="workflow-strip mb-6">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="eyebrow">From report to evidence</p><span className="text-xs text-slate-400">Analyze a wallet to unlock its evidence views</span></div>
    <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-7">
      {steps.map(([label, href], index) => <li key={label} className="min-w-0"><Link href={href} className="group flex h-full items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-3 text-xs text-slate-300 hover:border-cyan-400/40 hover:bg-cyan-400/5 hover:text-white"><span className="font-mono text-[10px] text-cyan-300">0{index + 1}</span><span className="flex-1 leading-5">{label}</span>{index < steps.length - 1 && <ArrowRight size={12} className="shrink-0 text-slate-500" />}</Link></li>)}
    </ol>
  </nav>;
}
