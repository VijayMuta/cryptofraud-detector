'use client';

import Link from 'next/link';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function WorkspaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section role="alert" className="panel mx-auto max-w-xl p-8 text-center"><AlertTriangle size={28} className="mx-auto text-amber-300" /><p className="eyebrow mt-5">Workspace unavailable</p><h1 className="mt-2 text-2xl font-semibold text-white">This view could not be loaded</h1><p className="mt-3 text-sm leading-6 text-slate-400">Try loading the view again. If the issue continues, return to the dashboard and reopen your investigation.</p><div className="mt-6 flex flex-wrap justify-center gap-3"><button type="button" onClick={reset} className="button-primary"><RefreshCw size={16} />Try again</button><Link href="/dashboard" className="button-secondary">Dashboard</Link></div></section>;
}
