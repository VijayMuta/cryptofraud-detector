export const MAX_BOOKMARK_NOTE_LENGTH = 2000;
export const bookmarkNoteFields = 'id,case_id,bookmark_id,author_user_id,note_text,created_at';
export type BookmarkNote = {
  id: string; case_id: string; bookmark_id: string; author_user_id: string;
  note_text: string; created_at: string;
};

/** Markup remains literal text; the UI must never interpret notes as HTML. */
export function validateBookmarkNote(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter a plain-text note.');
  const text = value.trim();
  if (!text) throw new Error('Enter a note before saving.');
  if (Array.from(text).length > MAX_BOOKMARK_NOTE_LENGTH) throw new Error('Bookmark notes must be 2,000 characters or fewer.');
  if (text.includes('\u0000')) throw new Error('Notes cannot contain null characters.');
  return text;
}

export function validateBookmarkNoteRequest(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== 1) throw new Error('Provide only noteText.');
  const field = Object.getOwnPropertyDescriptor(value, 'noteText');
  if (!field || !('value' in field)) throw new Error('Provide only noteText.');
  return validateBookmarkNote(field.value);
}
