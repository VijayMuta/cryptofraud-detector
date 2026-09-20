'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { authenticatedFetch } from '@/lib/client-api';
import { REPORT_STATUSES, STATUS_LABELS, type ReportStatus } from '@/lib/victim-reports';
export function VictimReportSummary() {
  const [counts, setCounts] = useState<Record<ReportStatus, number> | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => { let active = true; setCounts(null); setError(''); authenticatedFetch('/api/victim-reports?summary=1').then(response => response.json()).then(data => { if (active) setCounts(data.counts); }).catch(() => { if (active) setError('Report counts unavailable. Report storage may require setup.'); }); return () => { active = false; }; }, [version]);
  return <section className="panel p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold text-white">Your victim reports</h2><div className="flex gap-3"><button className="text-xs text-cyan-200" onClick={() => setVersion(value => value + 1)}>Refresh counts</button><Link className="text-sm text-cyan-200" href="/report">Open intake</Link></div></div><p className="mt-2 text-xs text-slate-400">Private allegation counts, not verified fraud findings.</p>{error ? <p role="status" className="mt-3 text-xs text-amber-100">{error}</p> : !counts ? <p role="status" className="mt-3 text-xs text-slate-400">Loading report counts…</p> : <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">{REPORT_STATUSES.map(status => <div key={status}><dt className="text-xs text-slate-400">{STATUS_LABELS[status]}</dt><dd className="mt-2 font-mono text-xl text-white">{counts[status]}</dd></div>)}</dl>}</section>;
}
