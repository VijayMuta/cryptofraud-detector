'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { authenticatedFetch } from '@/lib/client-api';
import { downloadFile } from '@/lib/download';
import { ACTIVITY_DEFINITIONS, ACTIVITY_EMPTY, ACTIVITY_NOTICE, exportActivity, orderActivity, type CaseActivity } from '@/lib/case-activity';

export default function CaseActivityPage({ params }: { params: { id: string } }) {
  const [events, setEvents] = useState<CaseActivity[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0), [category, setCategory] = useState('All');
  const [code, setCode] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setEvents([]); setCode('');
    async function load() {
      try {
        const collected = new Map<string, CaseActivity>();
        let offset: number | null = 0;
        do {
          const data = await (await authenticatedFetch(`/api/cases/${encodeURIComponent(params.id)}/activity?offset=${offset}`, { signal: controller.signal })).json();
          for (const event of data.events as CaseActivity[]) collected.set(event.id, event);
          offset = data.nextOffset;
          if (!controller.signal.aborted) setCode(data.caseCode);
        } while (offset !== null && !controller.signal.aborted);
        if (!controller.signal.aborted) setEvents(orderActivity([...collected.values()]));
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to load Case Activity.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load(); return () => controller.abort();
  }, [params.id, attempt]);
  const shown = events.filter(event => category === 'All' || ACTIVITY_DEFINITIONS[event.event_type][1] === category);
  return <div className="mx-auto max-w-5xl space-y-5 pb-10">
    <header className="panel-primary space-y-3 p-6"><Link className="text-cyan-200" href={`/cases/${encodeURIComponent(params.id)}`}>Back to case</Link><h1 className="text-3xl font-semibold text-white">Case Activity / Audit Trail</h1><p>{code}</p><p className="text-sm text-slate-400">Recorded application activity, newest first. All timestamps are UTC.</p></header>
    <section className="panel space-y-3 p-5 text-sm text-slate-400"><p>{ACTIVITY_NOTICE}</p><p>Browser-reported events describe completed local workflow actions reported by the signed-in session. Database events describe stored case changes. Neither establishes external actions. Privileged administrators can change or delete stored records; deleting a case deletes its activity.</p></section>
    <div className="flex flex-wrap gap-3"><button className="button-secondary" disabled={loading} onClick={() => setAttempt(x => x + 1)}>Refresh activity</button><button className="button-primary" disabled={loading || !!error} onClick={() => { try { downloadFile('chaintrace-case-activity.json', exportActivity(params.id, events, new Date().toISOString()) + '\n', 'application/json'); } catch { setError('Audit export unavailable. Retry loading activity.'); } }}>Download Audit Log JSON</button><label className="text-sm">Category <select className="filter-control" value={category} onChange={e => setCategory(e.target.value)}>{['All', 'Case', 'Wallet', 'Blockchain Evidence', 'Transactions', 'Evidence', 'Freeze/Hold'].map(value => <option key={value}>{value}</option>)}</select></label></div>
    {loading && <p role="status">Loading case activity...</p>}
    {error && <p role="alert" className="text-amber-200">{error}</p>}
    {!loading && !error && !events.length && <p className="panel p-6">{ACTIVITY_EMPTY}</p>}
    {!loading && !error && !!events.length && !shown.length && <p>No recorded activity matches this category.</p>}
    <ol className="space-y-3">{shown.map(event => <li key={event.id} className="panel space-y-2 p-5">
      <h2 className="font-medium text-cyan-200">{ACTIVITY_DEFINITIONS[event.event_type][0]}</h2>
      <p className="text-xs text-slate-400"><time dateTime={event.event_timestamp}>{new Date(event.event_timestamp).toISOString()} UTC</time></p>
      <p className="break-all text-xs">Actor: {event.actor_user_id || 'Unavailable'} (account ID)</p>
      <p className="text-xs">{event.event_type} · Source: {ACTIVITY_DEFINITIONS[event.event_type][2]} · {event.origin}</p>
      {(event.metadata.walletAddress || event.metadata.transactionHash || event.metadata.fingerprint) && <p className="break-all font-mono text-xs">{event.metadata.walletAddress || event.metadata.transactionHash || event.metadata.fingerprint}</p>}
      <details><summary className="cursor-pointer text-sm text-cyan-200">Inspect safe metadata</summary><pre className="mt-3 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(event.metadata, null, 2)}</pre></details>
    </li>)}</ol>
  </div>;
}
