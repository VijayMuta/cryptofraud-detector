import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/request-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getOwnedCase } from '@/lib/cases';
import { isUuid } from '@/lib/case-activity';
import { bookmarkFields, validateBookmark } from '@/lib/case-bookmarks';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
async function context(request: NextRequest, id: string) {
  const user = await getRequestUser(request);
  if (!user) return { error: reply({ error: 'Sign in to access saved evidence.' }, 401) };
  if (!isUuid(id)) return { error: reply({ error: 'Case not found or not accessible.' }, 404) };
  const admin = getSupabaseAdmin();
  if (!await getOwnedCase(admin, user.id, id)) return { error: reply({ error: 'Case not found or not accessible.' }, 404) };
  return { admin, user };
}
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await context(request, params.id); if (ctx.error) return ctx.error;
    const offset = Number(request.nextUrl.searchParams.get('offset') || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) return reply({ error: 'Invalid bookmarks page.' }, 400);
    const { data, error } = await ctx.admin!.from('case_evidence_bookmarks').select(bookmarkFields).eq('case_id', params.id)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 49);
    if (error) throw error;
    return reply({ bookmarks: data || [], nextOffset: data?.length === 50 ? offset + 50 : null });
  } catch { return reply({ error: 'Unable to load saved evidence. Check that the bookmarks migration is installed, then retry.' }, 503); }
}
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await context(request, params.id); if (ctx.error) return ctx.error;
    let bookmark;
    try {
      const raw = await request.text();
      if (raw.length > 2048) return reply({ error: 'Bookmark request is too large.' }, 413);
      bookmark = validateBookmark(JSON.parse(raw));
    } catch { return reply({ error: 'Invalid bookmark. Supply an Ethereum transaction hash, network, and optional supported label only.' }, 400); }
    const { data, error } = await ctx.admin!.from('case_evidence_bookmarks')
      .insert({ ...bookmark, case_id: params.id, created_by: ctx.user!.id }).select(bookmarkFields).single();
    if (error?.code === '23505') return reply({ error: 'This transaction is already saved in this case.' }, 409);
    if (error || !data) throw error || new Error();
    return reply({ bookmark: data }, 201);
  } catch { return reply({ error: 'Bookmark save could not be confirmed. Refresh saved evidence before retrying.' }, 503); }
}
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await context(request, params.id); if (ctx.error) return ctx.error;
    const id = request.nextUrl.searchParams.get('bookmarkId');
    if (!isUuid(id)) return reply({ error: 'A valid bookmark ID is required.' }, 400);
    const { data, error } = await ctx.admin!.from('case_evidence_bookmarks').delete().eq('case_id', params.id).eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) return reply({ error: 'Bookmark not found in this case.' }, 404);
    return reply({ removed: true });
  } catch { return reply({ error: 'Bookmark removal could not be confirmed. Refresh saved evidence before retrying.' }, 503); }
}
