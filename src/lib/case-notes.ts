export const MAX_CASE_NOTE_LENGTH = 5000;
export const caseNoteFields = 'id,case_id,author_user_id,note_text,created_at,updated_at';
export type CaseNote = {
  id: string; case_id: string; author_user_id: string; note_text: string;
  created_at: string; updated_at: string;
};

/** Preserve plain text, including markup as text; never interpret it as HTML. */
export function validateCaseNote(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter a plain-text note.');
  const text = value.trim();
  if (!text) throw new Error('Enter a note before saving.');
  if (Array.from(text).length > MAX_CASE_NOTE_LENGTH) throw new Error('Notes must be 5,000 characters or fewer.');
  if (text.includes('\u0000')) throw new Error('Notes cannot contain null characters.');
  return text;
}
