'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '@/lib/client-api';
import { BOOKMARK_LABELS, type CaseBookmark } from '@/lib/case-bookmarks';
import { transactionDeepDiveUrl } from '@/lib/transaction-deep-dive';
import { EVIDENCE_TAGS, type EvidenceTagId, type EvidenceTagAssignment } from '@/lib/evidence-tags';
import { BookmarkNotes } from '@/components/evidence-bookmark-notes';
import { EvidenceReviewStatusControl } from '@/components/evidence-review-status';

export function BookmarkEntry({ bookmark, busy, onRemove, onTagChange }: { bookmark: CaseBookmark; busy: boolean; onRemove: () => void; onTagChange: (tagId: EvidenceTagId, remove: boolean) => Promise<boolean> }) {
  const [selected, setSelected] = useState<EvidenceTagId | ''>('');
  const tags = bookmark.tags || [];
  const available = (Object.keys(EVIDENCE_TAGS) as EvidenceTagId[]).filter(id => !tags.some(tag => tag.tag_id === id));
  const href = transactionDeepDiveUrl(bookmark.transaction_hash, bookmark.case_id);
  return <li className="space-y-2 rounded-lg border border-slate-800 p-4">
    {href && <Link className="break-all font-mono text-sm text-cyan-200" href={href}>{bookmark.transaction_hash}</Link>}
    <p className="text-sm">Ethereum Mainnet{bookmark.label ? ` · ${bookmark.label}` : ''}</p>
    <p className="break-all text-xs text-slate-400">Saved by {bookmark.created_by} · {new Date(bookmark.created_at).toISOString()} UTC</p>
    <div className="flex flex-wrap gap-2" aria-label="Assigned evidence tags">
      {!tags.length && <p className="text-xs text-slate-400">No tags assigned.</p>}
      {tags.map(tag => <span key={tag.tag_id} className="inline-flex items-center gap-2 rounded-full border border-cyan-900 bg-cyan-950/40 px-3 py-1 text-xs text-cyan-200">
        {EVIDENCE_TAGS[tag.tag_id]}<button type="button" disabled={busy} aria-label={`Remove ${EVIDENCE_TAGS[tag.tag_id]} tag`} className="rounded px-1 hover:text-white disabled:opacity-50" onClick={() => void onTagChange(tag.tag_id, true)}>×</button>
      </span>)}
    </div>
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs text-slate-400">Evidence classification<select className="field mt-1" value={available.includes(selected as EvidenceTagId) ? selected : ''} disabled={busy || !available.length} onChange={e => setSelected(e.target.value as EvidenceTagId | '')}>
        <option value="">{available.length ? 'Choose a tag' : 'All tags assigned'}</option>
        {available.map(id => <option key={id} value={id}>{EVIDENCE_TAGS[id]}</option>)}
      </select></label>
      <button type="button" className="button-secondary" disabled={busy || !selected || !available.includes(selected)} onClick={async () => { if (selected && await onTagChange(selected, false)) setSelected(''); }}>Add tag</button>
      <button type="button" className="button-secondary" disabled={busy} onClick={onRemove}>Remove bookmark</button>
    </div>
    <EvidenceReviewStatusControl key={`review:${bookmark.case_id}:${bookmark.id}`} caseId={bookmark.case_id} bookmarkId={bookmark.id} disabled={busy} />
    <BookmarkNotes key={`${bookmark.case_id}:${bookmark.id}`} caseId={bookmark.case_id} bookmarkId={bookmark.id} disabled={busy} />
  </li>;
}

export function CaseBookmarks({ caseId }: { caseId: string }) {
  const [bookmarks, setBookmarks] = useState<CaseBookmark[]>([]), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<EvidenceTagId | ''>(''), [message, setMessage] = useState('');
  const currentCase = useRef(caseId); currentCase.current = caseId;
  const removing = useRef(false), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setMessage(''); setBookmarks([]);
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
  async function changeTag(bookmark: CaseBookmark, tagId: EvidenceTagId, removeTag: boolean) {
    if (removing.current || loading) return false;
    removing.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const response = await authenticatedFetch(`/api/cases/${encodeURIComponent(caseId)}/bookmarks/${encodeURIComponent(bookmark.id)}/tags`, {
        method: removeTag ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tagId }),
      });
      const data = await response.json() as { tag: EvidenceTagAssignment };
      if (active.current && currentCase.current === caseId) {
        setBookmarks(rows => rows.map(row => row.id !== bookmark.id ? row : { ...row, tags: removeTag ? (row.tags || []).filter(tag => tag.tag_id !== tagId) : [...(row.tags || []).filter(tag => tag.tag_id !== tagId), data.tag] }));
        setMessage(`${EVIDENCE_TAGS[tagId]} tag ${removeTag ? 'removed' : 'added'} and recorded in Case Activity.`);
      }
      return true;
    } catch (e) {
      if (active.current && currentCase.current === caseId) setError(e instanceof Error ? e.message : 'Tag change could not be confirmed. Refresh saved evidence before retrying.');
      return false;
    } finally { removing.current = false; if (active.current) setBusy(false); }
  }
  async function remove(bookmark: CaseBookmark) {
    if (removing.current || !window.confirm('Remove this transaction bookmark and its private notes from the case? Its activity history will remain.')) return;
    removing.current = true; setBusy(true); setError(''); setMessage('');
    try {
      await authenticatedFetch(`/api/cases/${encodeURIComponent(caseId)}/bookmarks?bookmarkId=${encodeURIComponent(bookmark.id)}`, { method: 'DELETE' });
      if (active.current && currentCase.current === caseId) setBookmarks(rows => rows.filter(row => row.id !== bookmark.id));
    } catch (e) { if (active.current) setError(e instanceof Error ? e.message : 'Removal could not be confirmed. Refresh saved evidence.'); }
    finally { removing.current = false; if (active.current) setBusy(false); }
  }
  return <section className="panel space-y-4 p-5" aria-label="Saved Evidence">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold text-white">Case Evidence / Saved Evidence</h2><button className="button-secondary" disabled={loading || busy} onClick={() => setAttempt(x => x + 1)}>Refresh saved evidence</button></div>
    <p className="text-sm text-slate-400">Open Transaction Deep Dive and choose Save to case to bookmark a transaction. Saved references are not frozen evidence snapshots or proof of fraud.</p>
    <p className="text-xs text-slate-400">Tags are investigator classifications, not proof of fraud.</p>
    <label className="block text-sm text-slate-300">Filter by tag<select className="field mt-1" value={filter} disabled={loading || busy} onChange={e => setFilter(e.target.value as EvidenceTagId | '')}>
      <option value="">All saved evidence</option>{(Object.keys(EVIDENCE_TAGS) as EvidenceTagId[]).map(id => <option key={id} value={id}>{EVIDENCE_TAGS[id]}</option>)}
    </select></label>
    {loading && <p role="status">Loading saved evidence...</p>}
    {busy && <p role="status">Saving evidence change...</p>}
    {message && <p role="status" className="text-sm text-cyan-200">{message}</p>}
    {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
    {!loading && !error && !bookmarks.length && <p className="text-sm text-slate-400">No transactions have been bookmarked in this case.</p>}
    {!loading && !error && bookmarks.length > 0 && filter && !bookmarks.some(bookmark => bookmark.tags?.some(tag => tag.tag_id === filter)) && <p className="text-sm text-slate-400">No saved evidence matches this tag.</p>}
    <ol className="space-y-3" aria-label="Saved evidence, newest first">{bookmarks.filter(bookmark => !filter || bookmark.tags?.some(tag => tag.tag_id === filter)).map(bookmark => <BookmarkEntry key={bookmark.id} bookmark={bookmark} busy={busy || loading} onRemove={() => void remove(bookmark)} onTagChange={(tagId, removeTag) => changeTag(bookmark, tagId, removeTag)} />)}</ol>
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
