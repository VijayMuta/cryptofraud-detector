import { Loader2 } from 'lucide-react';

export default function Loading() {
  return <div role="status" aria-busy="true" className="space-y-6"><div className="panel p-6"><p className="eyebrow">CHAINTRACE workspace</p><p className="mt-3 flex items-center gap-2 text-sm text-slate-300"><Loader2 size={18} className="animate-spin text-cyan-300" />Loading investigation workspace…</p></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">{[0, 1, 2, 3].map((item) => <div key={item} className="panel h-32 animate-pulse" />)}</div><div aria-hidden="true" className="panel h-64 animate-pulse" /></div>;
}
