'use client';
import { useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '@/lib/client-api';
import { EVIDENCE_REVIEW_STATUSES, REVIEW_NOTICE, type EvidenceReview, type EvidenceReviewStatus } from '@/lib/evidence-review-status';

/** Parent keys this component by case/bookmark so responses cannot cross bookmarks. */
export function EvidenceReviewStatusControl({ caseId, bookmarkId, disabled = false }: { caseId: string; bookmarkId: string; disabled?: boolean }) {
  const [review, setReview] = useState<EvidenceReview | null>(null);
  const [selected, setSelected] = useState<EvidenceReviewStatus>('unreviewed');
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [attempt, setAttempt] = useState(0);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const pending = useRef(false), active = useRef(true);
  const endpoint = `/api/cases/${encodeURIComponent(caseId)}/bookmarks/${encodeURIComponent(bookmarkId)}/review-status`;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setMessage(''); setReview(null);
    async function load() {
      try {
        const data = await (await authenticatedFetch(endpoint, { signal: controller.signal })).json();
        if (!controller.signal.aborted) { setReview(data.review); setSelected(data.review.status); }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to load review status.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load(); return () => controller.abort();
  }, [endpoint, attempt]);
  async function save() {
    if (pending.current || loading || disabled || !review || selected === review.status || error) return;
    pending.current = true; setSaving(true); setError(''); setMessage('');
    try {
      const data = await (await authenticatedFetch(endpoint, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: selected }),
      })).json();
      if (active.current) { setReview(data.review); setSelected(data.review.status); setMessage('Review status saved. Status changes are recorded in Case Activity.'); }
    } catch (e) {
      if (active.current) setError((e instanceof Error ? e.message : 'Save could not be confirmed.') + ' Refresh review status before retrying.');
    } finally { pending.current = false; if (active.current) setSaving(false); }
  }
  return <section className="space-y-2 rounded-lg border border-slate-800 p-3" aria-label="Evidence review status">
    <p className="text-sm text-cyan-200">Review status: {loading ? 'Loading...' : error ? 'Unconfirmed — refresh required' : review ? EVIDENCE_REVIEW_STATUSES[review.status] : 'Unavailable'}</p>
    <p className="text-xs text-slate-400">{REVIEW_NOTICE}</p>
    {review?.updated_at && <p className="break-all text-xs text-slate-400">Last changed by {review.updated_by} · <time dateTime={review.updated_at}>{new Date(review.updated_at).toISOString()} UTC</time></p>}
    <label className="block text-xs text-slate-400">Review workflow state
      <select className="field mt-1" value={selected} disabled={loading || saving || disabled || !!error || !review} onChange={e => { setSelected(e.target.value as EvidenceReviewStatus); setMessage(''); }}>
        {Object.entries(EVIDENCE_REVIEW_STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="button-secondary" disabled={loading || saving || disabled || !!error || !review || selected === review.status} onClick={() => void save()}>{saving ? 'Saving review status...' : 'Save review status'}</button>
      <button type="button" className="button-secondary" disabled={loading || saving || disabled} onClick={() => { if (!pending.current) { setLoading(true); setAttempt(x => x + 1); } }}>Refresh review status</button>
    </div>
    {loading && <p role="status" className="text-xs">Loading review status...</p>}
    {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
    {message && <p role="status" className="text-sm text-cyan-200">{message}</p>}
  </section>;
}
