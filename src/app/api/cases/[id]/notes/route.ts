import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/request-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getOwnedCase } from '@/lib/cases';
import { isUuid } from '@/lib/case-activity';
import { caseNoteFields, validateCaseNote } from '@/lib/case-notes';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
async function context(request: NextRequest, id: string) {
  const user = await getRequestUser(request);
  if (!user) return { error: reply({ error: 'Sign in to access Case Notes.' }, 401) };
  if (!isUuid(id)) return { error: reply({ error: 'Case not found or not accessible.' }, 404) };
  const admin = getSupabaseAdmin();
  if (!await getOwnedCase(admin, user.id, id)) return { error: reply({ error: 'Case not found or not accessible.' }, 404) };
  return { admin, user };
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await context(request, params.id);
    if (ctx.error) return ctx.error;
    const offset = Number(request.nextUrl.searchParams.get('offset') || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) return reply({ error: 'Invalid notes page.' }, 400);
    const { data, error } = await ctx.admin!.from('case_notes').select(caseNoteFields)
      .eq('case_id', params.id).order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 49);
    if (error) throw error;
    return reply({ notes: data || [], nextOffset: data?.length === 50 ? offset + 50 : null });
  } catch { return reply({ error: 'Unable to load Case Notes. Check that the notes migration is installed, then retry.' }, 503); }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await context(request, params.id);
    if (ctx.error) return ctx.error;
    let text: string;
    try {
      const raw = await request.text();
      // Allows JSON-escaped Unicode at the maximum note length.
      if (raw.length > 65000) return reply({ error: 'Note request is too large.' }, 413);
      const body = JSON.parse(raw);
      if (!body || Array.isArray(body) || Object.keys(body).join(',') !== 'noteText') return reply({ error: 'Provide only noteText.' }, 400);
      text = validateCaseNote(body.noteText);
    } catch (error) { return reply({ error: error instanceof SyntaxError ? 'Enter a valid note request.' : error instanceof Error ? error.message : 'Invalid note.' }, 400); }
    // The database trigger inserts CASE_NOTE_CREATED atomically. Do not log again here.
    const { data, error } = await ctx.admin!.from('case_notes')
      .insert({ case_id: params.id, author_user_id: ctx.user!.id, note_text: text })
      .select(caseNoteFields).single();
    if (error || !data) throw error || new Error('Note unavailable.');
    return reply({ note: data }, 201);
  } catch { return reply({ error: 'Note save could not be confirmed. Refresh notes before retrying to avoid a duplicate. Your draft has been kept.' }, 503); }
}
