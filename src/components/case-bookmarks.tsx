'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '@/lib/client-api';
import { BOOKMARK_LABELS, type CaseBookmark } from '@/lib/case-bookmarks';
import { transactionDeepDiveUrl } from '@/lib/transaction-deep-dive';

export function BookmarkEntry({ bookmark, busy, onRemove }: { bookmark: CaseBookmark; busy: boolean; onRemove: () => void }) {
  const href = transactionDeepDiveUrl(bookmark.transaction_hash, bookmark.case_id);
  return <li className="space-y-2 rounded-lg border border-slate-800 p-4">
    {href && <Link className="break-all font-mono text-sm text-cyan-200" href={href}>{bookmark.transaction_hash}</Link>}
    <p className="text-sm">Ethereum Mainnet{bookmark.label ? ` · ${bookmark.label}` : ''}</p>
    <p className="break-all text-xs text-slate-400">Saved by {bookmark.created_by} · {new Date(bookmark.created_at).toISOString()} UTC</p>
    <button type="button" className="button-secondary" disabled={busy} onClick={onRemove}>Remove bookmark</button>
  </li>;
}

export function CaseBookmarks({ caseId }: { caseId: string }) {
  const [bookmarks, setBookmarks] = useState<CaseBookmark[]>([]), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0);
  const removing = useRef(false), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setBookmarks([]);
    async function load() {
      try {
        let offset: number | null = 0;
        const rows = new Map<string, CaseBookmark>();
        do {
          const data = await (await authenticatedFetch(`/api/cases/${encodeURIComponent(caseId)}/bookmarks?offset=${offset}`, { signal: controller.signal })).json();
          for (const row of data.bookmarks as CaseBookmark[]) rows.set(row.id, row);
          offset = data.nextOffset;
        } while (offset !== null && !controller.signal.aborted);
        if (!controller.signal.aborted) setBookmarks([...rows.values()]);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to load saved evidence.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load(); return () => controller.abort();
  }, [caseId, attempt]);
  async function remove(bookmark: CaseBookmark) {
    if (removing.current || !window.confirm('Remove this transaction bookmark from the case? Its activity history will remain.')) return;
    removing.current = true; setBusy(true); setError('');
    try {
      await authenticatedFetch(`/api/cases/${encodeURIComponent(caseId)}/bookmarks?bookmarkId=${encodeURIComponent(bookmark.id)}`, { method: 'DELETE' });
      if (active.current) setBookmarks(rows => rows.filter(row => row.id !== bookmark.id));
    } catch (e) { if (active.current) setError(e instanceof Error ? e.message : 'Removal could not be confirmed. Refresh saved evidence.'); }
    finally { removing.current = false; if (active.current) setBusy(false); }
  }
  return <section className="panel space-y-4 p-5" aria-label="Saved Evidence">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold text-white">Case Evidence / Saved Evidence</h2><button className="button-secondary" disabled={loading || busy} onClick={() => setAttempt(x => x + 1)}>Refresh saved evidence</button></div>
    <p className="text-sm text-slate-400">Open Transaction Deep Dive and choose Save to case to bookmark a transaction. Saved references are not frozen evidence snapshots or proof of fraud.</p>
    {loading && <p role="status">Loading saved evidence...</p>}
    {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
    {!loading && !error && !bookmarks.length && <p className="text-sm text-slate-400">No transactions have been bookmarked in this case.</p>}
    <ol className="space-y-3" aria-label="Saved evidence, newest first">{bookmarks.map(bookmark => <BookmarkEntry key={bookmark.id} bookmark={bookmark} busy={busy} onRemove={() => void remove(bookmark)} />)}</ol>
  </section>;
}

/** Mount only for a successfully retrieved, matching Ethereum transaction. */
export function SaveTransactionBookmark({ hash, initialCaseId }: { hash: string; initialCaseId: string }) {
  const [cases, setCases] = useState<{ id: string; case_code: string; title: string }[]>([]);
  const [selected, setSelected] = useState(''), [label, setLabel] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const saving = useRef(false), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    authenticatedFetch('/api/cases', { signal: controller.signal }).then(r => r.json()).then(data => {
      if (!Array.isArray(data.cases)) throw new Error('Cases unavailable.');
      if (!controller.signal.aborted) { setCases(data.cases); setSelected(data.cases.some((c: { id: string }) => c.id === initialCaseId) ? initialCaseId : ''); }
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [initialCaseId, attempt]);
  async function save() {
    if (saving.current || loading || !selected) return;
    saving.current = true; setBusy(true); setError(''); setMessage('');
    try {
      await authenticatedFetch(`/api/cases/${encodeURIComponent(selected)}/bookmarks`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionHash: hash, network: 'ethereum', label: label || null }),
      });
      if (active.current) setMessage('Transaction bookmarked and recorded in Case Activity.');
    } catch (e) { if (active.current) setError(e instanceof Error ? e.message : 'Save could not be confirmed. Check saved evidence before retrying.'); }
    finally { saving.current = false; if (active.current) setBusy(false); }
  }
  return <section className="panel space-y-3 p-5" aria-label="Bookmark transaction evidence">
    <h2 className="text-lg font-semibold text-white">Save to case</h2>
    <p className="text-xs text-slate-400">Save this transaction reference to one of your cases. Opening it later retrieves current evidence.</p>
    <label className="block text-sm">Investigation case<select className="field mt-2" disabled={loading || busy} value={selected} onChange={e => { setSelected(e.target.value); setMessage(''); setError(''); }}><option value="">Select a case</option>{cases.map(c => <option key={c.id} value={c.id}>{c.case_code} · {c.title}</option>)}</select></label>
    <label className="block text-sm">Optional label<select className="field mt-2" disabled={busy} value={label} onChange={e => setLabel(e.target.value)}><option value="">No label</option>{BOOKMARK_LABELS.map(value => <option key={value}>{value}</option>)}</select></label>
    <button className="button-primary" disabled={busy || loading || !selected} onClick={() => void save()}>{busy ? 'Saving...' : 'Bookmark evidence'}</button>
    {selected && <Link className="ml-3 text-sm text-cyan-200" href={`/cases/${encodeURIComponent(selected)}`}>View case saved evidence</Link>}
    {loading && <p role="status">Loading your cases...</p>}
    {!loading && !cases.length && !error && <p>No cases available. <Link className="text-cyan-200" href="/cases">Create a case</Link> first.</p>}
    {error && <p role="alert" className="text-amber-200">{error} {!cases.length && <button className="button-secondary" onClick={() => setAttempt(x => x + 1)}>Retry cases</button>}</p>}
    {message && <p role="status" className="text-cyan-200">{message}</p>}
  </section>;
}
