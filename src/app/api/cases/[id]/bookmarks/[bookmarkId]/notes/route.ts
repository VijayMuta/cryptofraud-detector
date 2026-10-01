import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/request-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getOwnedCase } from '@/lib/cases';
import { isUuid } from '@/lib/case-activity';
import { bookmarkNoteFields, validateBookmarkNoteRequest } from '@/lib/evidence-bookmark-notes';

export const dynamic = 'force-dynamic';
type Params = { params: { id: string; bookmarkId: string } };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
async function context(request: NextRequest, { id, bookmarkId }: Params['params']) {
  const user = await getRequestUser(request);
  if (!user) return { error: reply({ error: 'Sign in to access bookmark notes.' }, 401) };
  if (!isUuid(id)) return { error: reply({ error: 'Case not found or not accessible.' }, 404) };
  if (!isUuid(bookmarkId)) return { error: reply({ error: 'A valid bookmark ID is required.' }, 400) };
  const admin = getSupabaseAdmin();
  if (!await getOwnedCase(admin, user.id, id)) return { error: reply({ error: 'Case not found or not accessible.' }, 404) };
  const { data, error } = await admin.from('case_evidence_bookmarks').select('id').eq('case_id', id).eq('id', bookmarkId).maybeSingle();
  if (error) throw error;
  if (!data) return { error: reply({ error: 'Bookmark not found in this case.' }, 404) };
  return { admin, user };
}

export async function GET(request: NextRequest, { params: routeParams }: { params: Promise<Params['params']> }) {
  const params = await routeParams;
  try {
    const ctx = await context(request, params); if (ctx.error) return ctx.error;
    const offset = Number(request.nextUrl.searchParams.get('offset') || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > Number.MAX_SAFE_INTEGER - 49) return reply({ error: 'Invalid notes page.' }, 400);
    const { data, error } = await ctx.admin!.from('case_evidence_bookmark_notes').select(bookmarkNoteFields)
      .eq('case_id', params.id).eq('bookmark_id', params.bookmarkId)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 49);
    if (error) throw error;
    return reply({ notes: data || [], nextOffset: data?.length === 50 ? offset + 50 : null });
  } catch { return reply({ error: 'Unable to load bookmark notes. Check that the bookmark notes migration is installed, then retry.' }, 503); }
}

export async function POST(request: NextRequest, { params: routeParams }: { params: Promise<Params['params']> }) {
  const params = await routeParams;
  try {
    const ctx = await context(request, params); if (ctx.error) return ctx.error;
    let noteText: string;
    try {
      const raw = await request.text();
      // Allows 2,000 supplementary Unicode characters encoded as JSON surrogate pairs.
      if (raw.length > 26000) return reply({ error: 'Note request is too large.' }, 413);
      noteText = validateBookmarkNoteRequest(JSON.parse(raw));
    } catch (error) { return reply({ error: error instanceof SyntaxError ? 'Enter a valid note request.' : error instanceof Error ? error.message : 'Invalid note.' }, 400); }
    // The database trigger records the event in the same transaction as this insert.
    const { data, error } = await ctx.admin!.from('case_evidence_bookmark_notes').insert({
      case_id: params.id, bookmark_id: params.bookmarkId, author_user_id: ctx.user!.id, note_text: noteText,
    }).select(bookmarkNoteFields).single();
    if (error?.code === '23503') return reply({ error: 'Bookmark no longer available. Refresh saved evidence.' }, 404);
    if (error || !data) throw error || new Error('Note unavailable.');
    return reply({ note: data }, 201);
  } catch { return reply({ error: 'Note save could not be confirmed. Refresh bookmark notes before retrying to avoid a duplicate.' }, 503); }
}
