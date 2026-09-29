'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { authenticatedFetch } from '@/lib/client-api';
import { MAX_BOOKMARK_NOTE_LENGTH, validateBookmarkNote, type BookmarkNote } from '@/lib/evidence-bookmark-notes';

export function BookmarkNoteEntry({ note }: { note: BookmarkNote }) {
  return <li className="space-y-1 rounded-lg border border-slate-800 p-3">
    <p className="break-all text-xs text-slate-400">Author: {note.author_user_id} (account ID)</p>
    <p className="text-xs text-slate-400"><time dateTime={note.created_at}>{new Date(note.created_at).toISOString().replace('T', ' ').replace('Z', ' UTC')}</time></p>
    <p className="whitespace-pre-wrap break-words text-sm text-slate-200">{note.note_text}</p>
  </li>;
}

/** Keyed by case/bookmark at the call site so drafts and responses cannot cross bookmarks. */
export function BookmarkNotes({ caseId, bookmarkId, disabled = false }: { caseId: string; bookmarkId: string; disabled?: boolean }) {
  const [opened, setOpened] = useState(false);
  return <details className="rounded-lg border border-slate-800 p-3" onToggle={e => { if (e.currentTarget.open) setOpened(true); }}>
    <summary className="cursor-pointer text-sm text-cyan-200">Private bookmark notes</summary>
    {opened && <BookmarkNotesBody caseId={caseId} bookmarkId={bookmarkId} disabled={disabled} />}
  </details>;
}

export function BookmarkNotesBody({ caseId, bookmarkId, disabled = false }: { caseId: string; bookmarkId: string; disabled?: boolean }) {
  const [notes, setNotes] = useState<BookmarkNote[]>([]), [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState(''), [saveError, setSaveError] = useState(''), [message, setMessage] = useState('');
  const submitting = useRef(false), active = useRef(true);
  const endpoint = `/api/cases/${encodeURIComponent(caseId)}/bookmarks/${encodeURIComponent(bookmarkId)}/notes`;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setLoadError(''); setMessage(''); setNotes([]);
    async function load() {
      try {
        let offset: number | null = 0;
        const collected = new Map<string, BookmarkNote>();
        do {
          const data = await (await authenticatedFetch(`${endpoint}?offset=${offset}`, { signal: controller.signal })).json();
          for (const note of data.notes as BookmarkNote[]) collected.set(note.id, note);
          offset = data.nextOffset;
        } while (offset !== null && !controller.signal.aborted);
        if (!controller.signal.aborted) setNotes([...collected.values()]);
      } catch (e) { if (!controller.signal.aborted) setLoadError(e instanceof Error ? e.message : 'Unable to load bookmark notes.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load(); return () => controller.abort();
  }, [endpoint, attempt]);
  async function add(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || loading || disabled || loadError) return;
    setSaveError(''); setMessage('');
    let noteText;
    try { noteText = validateBookmarkNote(draft); }
    catch (e) { setSaveError(e instanceof Error ? e.message : 'Invalid note.'); return; }
    submitting.current = true; setSaving(true);
    try {
      const data = await (await authenticatedFetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ noteText }),
      })).json();
      if (active.current) { setNotes(current => [data.note, ...current]); setDraft(''); setMessage('Bookmark note saved and recorded in Case Activity.'); }
    } catch (e) { if (active.current) setSaveError((e instanceof Error ? e.message : 'Save could not be confirmed.') + ' Your draft is preserved. Refresh notes before retrying.'); }
    finally { submitting.current = false; if (active.current) setSaving(false); }
  }
  const length = Array.from(draft.trim()).length;
  return <section className="mt-3 space-y-3" aria-label="Bookmark notes">
    <p className="text-xs text-slate-400">Private to the case owner. Plain text only; notes record investigator observations.</p>
    <button type="button" className="button-secondary" disabled={loading || saving || disabled} onClick={() => setAttempt(x => x + 1)}>Refresh bookmark notes</button>
    {loading && <p role="status" className="text-xs text-slate-400">Loading bookmark notes...</p>}
    {loadError && <p role="alert" className="text-sm text-amber-200">{loadError}</p>}
    {!loading && !loadError && !notes.length && <p className="text-xs text-slate-400">No notes have been added to this bookmark.</p>}
    <ol className="space-y-2" aria-label="Bookmark notes, newest first">{notes.map(note => <BookmarkNoteEntry key={note.id} note={note} />)}</ol>
    <form className="space-y-2" onSubmit={add}>
      <label className="block text-sm text-slate-400" htmlFor={`bookmark-note-${bookmarkId}`}>New bookmark note</label>
      <textarea id={`bookmark-note-${bookmarkId}`} aria-describedby={`bookmark-note-limit-${bookmarkId}`} className="field min-h-20 resize-y" rows={3} value={draft} onChange={e => setDraft(e.target.value)} disabled={saving || disabled} placeholder="Record a short private observation about this saved evidence." />
      <p id={`bookmark-note-limit-${bookmarkId}`} className="text-xs text-slate-400">{length.toLocaleString()} / {MAX_BOOKMARK_NOTE_LENGTH.toLocaleString()} characters.</p>
      <button type="submit" className="button-primary" disabled={loading || saving || disabled || !!loadError || !length || length > MAX_BOOKMARK_NOTE_LENGTH}>{saving ? 'Saving note...' : 'Add bookmark note'}</button>
    </form>
    {saveError && <p role="alert" className="text-sm text-amber-200">{saveError}</p>}
    {message && <p role="status" className="text-sm text-cyan-200">{message}</p>}
  </section>;
}
