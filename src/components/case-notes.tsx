'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { authenticatedFetch } from '@/lib/client-api';
import { MAX_CASE_NOTE_LENGTH, validateCaseNote, type CaseNote } from '@/lib/case-notes';

export function CaseNoteEntry({ note }: { note: CaseNote }) {
  return <li className="space-y-2 rounded-lg border border-slate-800 p-4">
    <p className="break-all text-xs text-slate-400">Author: {note.author_user_id || 'Unavailable'} (account ID)</p>
    <p className="text-xs text-slate-400"><time dateTime={note.created_at}>{new Date(note.created_at).toISOString().replace('T', ' ').replace('Z', ' UTC')}</time></p>
    <p className="whitespace-pre-wrap break-words text-sm text-slate-200">{note.note_text}</p>
  </li>;
}

/** Mounted with case ID as key so drafts and pending responses cannot cross cases. */
export function CaseNotes({ caseId }: { caseId: string }) {
  const [notes, setNotes] = useState<CaseNote[]>([]), [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(''), [saveError, setSaveError] = useState(''), [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const submitting = useRef(false), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError(''); setNotes([]);
    async function load() {
      try {
        let offset: number | null = 0;
        const collected = new Map<string, CaseNote>();
        do {
          const data = await (await authenticatedFetch(`/api/cases/${encodeURIComponent(caseId)}/notes?offset=${offset}`, { signal: controller.signal })).json();
          for (const note of data.notes as CaseNote[]) collected.set(note.id, note);
          offset = data.nextOffset;
        } while (offset !== null && !controller.signal.aborted);
        if (!controller.signal.aborted) setNotes([...collected.values()]);
      } catch (e) { if (!controller.signal.aborted) setLoadError(e instanceof Error ? e.message : 'Unable to load notes.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load(); return () => controller.abort();
  }, [caseId, attempt]);
  async function add(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || loading) return;
    setSaveError(''); setMessage('');
    let noteText: string;
    try { noteText = validateCaseNote(draft); }
    catch (e) { setSaveError(e instanceof Error ? e.message : 'Invalid note.'); return; }
    submitting.current = true; setSaving(true);
    try {
      const data = await (await authenticatedFetch(`/api/cases/${encodeURIComponent(caseId)}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ noteText }),
      })).json();
      if (active.current) {
        setNotes(current => [data.note, ...current]); setDraft(''); setMessage('Note saved and recorded in Case Activity.');
      }
    } catch (e) { if (active.current) setSaveError((e instanceof Error ? e.message : 'Save could not be confirmed.') + ' Refresh notes before retrying; your draft is preserved.'); }
    finally { submitting.current = false; if (active.current) setSaving(false); }
  }
  return <section className="panel space-y-4 p-5 sm:p-6" aria-label="Case Notes">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold text-white">Case Notes / Investigator Notes</h2><button type="button" className="button-secondary" disabled={loading || saving} onClick={() => setAttempt(x => x + 1)}>Refresh notes</button></div>
    <form className="space-y-3" onSubmit={add}>
      <label className="block text-sm text-slate-400" htmlFor="case-note">New investigator note</label>
      <textarea id="case-note" className="field min-h-28 resize-y" rows={4} value={draft} onChange={e => setDraft(e.target.value)} disabled={saving} placeholder="Record observations and investigation context as plain text." aria-describedby="case-note-limit" />
      <p id="case-note-limit" className="text-xs text-slate-400">{Array.from(draft.trim()).length.toLocaleString()} / {MAX_CASE_NOTE_LENGTH.toLocaleString()} characters. Notes are private to the case owner.</p>
      <button className="button-primary" disabled={loading || saving || !draft.trim() || Array.from(draft.trim()).length > MAX_CASE_NOTE_LENGTH}>{saving ? 'Saving note...' : 'Add note'}</button>
    </form>
    {saveError && <p role="alert" className="text-sm text-amber-200">{saveError}</p>}
    {message && <p role="status" className="text-sm text-cyan-200">{message}</p>}
    {loading && <p role="status" className="text-sm text-slate-400">Loading notes...</p>}
    {loadError && <p role="alert" className="text-sm text-amber-200">{loadError}</p>}
    {!loading && !loadError && !notes.length && <p className="text-sm text-slate-400">No investigator notes have been added to this case.</p>}
    <ol className="space-y-3" aria-label="Notes, newest first">{notes.map(note => <CaseNoteEntry key={note.id} note={note} />)}</ol>
  </section>;
}
