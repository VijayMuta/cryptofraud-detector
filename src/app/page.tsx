import Link from 'next/link';
import {
  ArrowRight,
  FileWarning,
  GitBranch,
  Radar,
  Search,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';

const capabilities = [
  {
    icon: Search,
    eyebrow: 'Evidence retrieval',
    title: 'Investigate wallet activity',
    detail:
      'Retrieve current Ethereum balance, transaction count, and normal transfer activity through the server-side data source.',
  },
  {
    icon: Radar,
    eyebrow: 'Behavioral review',
    title: 'Surface observable patterns',
    detail:
      'Review transfer frequency, fund distribution, counterparties, and explainable indicators without making unsupported claims.',
  },
  {
    icon: GitBranch,
    eyebrow: 'Case intelligence',
    title: 'Connect verified evidence',
    detail:
      'Compare authorized private cases only when the retrieved blockchain evidence supports a relationship.',
  },
];

export default function LandingPage() {
  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-[#060b16] text-slate-300">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[38rem] bg-[radial-gradient(circle_at_50%_-10%,rgba(34,211,238,0.16),transparent_44%),radial-gradient(circle_at_85%_18%,rgba(124,58,237,0.12),transparent_30%)]" />
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" className="flex items-center gap-3" aria-label="CryptoFraud Detector home">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10 text-cyan-200 shadow-lg shadow-cyan-950/20">
            <ShieldCheck size={21} />
          </span>
          <span>
            <span className="block text-sm font-semibold tracking-wide text-white">CryptoFraud Detector</span>
            <span className="block text-[10px] font-medium uppercase tracking-[0.15em] text-cyan-300">Investigation platform</span>
          </span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-900 hover:text-white">
            Sign in
          </Link>
          <Link href="/register" className="rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/45 hover:bg-cyan-400/15">
            Create account
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 pb-20 pt-16 sm:px-8 sm:pt-24 lg:pb-28">
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/[0.06] px-3 py-1.5 text-xs font-medium text-cyan-100">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
            Blockchain fraud intelligence &amp; investigation platform
          </div>
          <h1 className="mt-7 text-4xl font-semibold tracking-tight text-white sm:text-6xl lg:text-7xl">
            Trace the Money.<br />
            <span className="bg-gradient-to-r from-cyan-200 via-cyan-300 to-violet-300 bg-clip-text text-transparent">Detect the Pattern. Connect the Cases.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-slate-400 sm:text-lg">
            An evidence-driven blockchain intelligence platform for analyzing reported cryptocurrency wallet activity, identifying suspicious fund movements, connecting related cases, and supporting authorized investigation workflows.
          </p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/investigate" className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">
              <Search size={17} /> Start investigation
            </Link>
            <Link href="/report" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/65 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:border-cyan-400/35 hover:bg-slate-900">
              <FileWarning size={17} className="text-cyan-200" /> Report suspicious wallet
            </Link>
            <a href="#workflow" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/65 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:border-cyan-400/35 hover:bg-slate-900">
              View workflow <ArrowRight size={17} className="text-cyan-200" />
            </a>
          </div>
        </div>

        <div id="workflow" className="mx-auto mt-16 max-w-6xl overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/45 shadow-2xl shadow-slate-950/50 backdrop-blur">
          <div className="grid gap-px bg-slate-800 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="bg-[#0a1222]/90 p-6 sm:p-8">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300">How it works</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">Evidence before conclusions.</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">
                The platform separates facts returned by blockchain data from observations, risk indicators, inferences, and information that remains unknown.
              </p>
              <div className="mt-7 grid gap-3 sm:grid-cols-3">
                {['Record', 'Analyze', 'Connect'].map((step, index) => (
                  <div key={step} className="rounded-xl border border-slate-800 bg-slate-950/45 p-4">
                    <span className="font-mono text-xs text-cyan-300">0{index + 1}</span>
                    <p className="mt-3 text-sm font-medium text-slate-100">{step}</p>
                  </div>
                ))}
              </div>
            </div>
            <aside className="bg-cyan-400/[0.045] p-6 sm:p-8">
              <ShieldAlert size={24} className="text-cyan-200" />
              <h2 className="mt-5 text-lg font-semibold text-white">Built for responsible investigation</h2>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                CryptoFraud Detector can analyze, monitor, flag, preserve evidence, and support authorized response workflows. It never requests private keys or seed phrases.
              </p>
              <p className="mt-4 rounded-xl border border-cyan-400/15 bg-slate-950/35 p-3 text-xs leading-5 text-cyan-100">
                Blockchain assets can only be held or frozen through legitimate authorized exchange or authority controls.
              </p>
            </aside>
          </div>
        </div>
      </section>

      <section className="border-y border-slate-800/80 bg-slate-950/30">
        <div className="mx-auto grid max-w-7xl gap-5 px-5 py-16 sm:grid-cols-3 sm:px-8">
          {capabilities.map((capability) => {
            const Icon = capability.icon;
            return (
              <article key={capability.title} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 transition hover:-translate-y-0.5 hover:border-cyan-400/25 hover:bg-slate-900/60">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/[0.07] text-cyan-200">
                  <Icon size={19} />
                </span>
                <p className="mt-5 text-[11px] font-medium uppercase tracking-[0.15em] text-cyan-300">{capability.eyebrow}</p>
                <h2 className="mt-2 text-base font-semibold text-white">{capability.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">{capability.detail}</p>
              </article>
            );
          })}
        </div>
      </section>

      <footer className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-8 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p>CryptoFraud Detector · Trace the Money. Detect the Pattern. Connect the Cases.</p>
        <Link href="/login" className="inline-flex items-center gap-1 text-cyan-200 hover:text-cyan-100">Authorized access <ArrowRight size={13} /></Link>
      </footer>
    </main>
  );
}
