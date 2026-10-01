import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/request-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getOwnedCase } from '@/lib/cases';
import { isUuid } from '@/lib/case-activity';
import { tagFields, validateTagAssignment } from '@/lib/evidence-tags';

export const dynamic = 'force-dynamic';
type Params = { params: { id: string; bookmarkId: string } };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
async function context(request: NextRequest, { id, bookmarkId }: Params['params']) {
  const user = await getRequestUser(request);
  if (!user) return { error: reply({ error: 'Sign in to access evidence tags.' }, 401) };
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
    const { data, error } = await ctx.admin!.from('case_evidence_tags').select(tagFields).eq('bookmark_id', params.bookmarkId).order('tag_id');
    if (error) throw error;
    return reply({ tags: data || [] });
  } catch { return reply({ error: 'Unable to load evidence tags. Check that the evidence tags migration is installed, then retry.' }, 503); }
}
async function mutate(request: NextRequest, params: Params['params'], remove: boolean) {
  try {
    const ctx = await context(request, params); if (ctx.error) return ctx.error;
    let tagId;
    try {
      const raw = await request.text();
      if (raw.length > 1024) return reply({ error: 'Tag request is too large.' }, 413);
      tagId = validateTagAssignment(JSON.parse(raw));
    } catch { return reply({ error: 'Invalid tag. Supply one supported tagId and no other fields.' }, 400); }
    if (remove) {
      const { data, error } = await ctx.admin!.from('case_evidence_tags').delete().eq('bookmark_id', params.bookmarkId).eq('tag_id', tagId).select('tag_id');
      if (error) throw error;
      if (!data?.length) return reply({ error: 'Tag assignment not found on this bookmark.' }, 404);
      return reply({ removed: true });
    }
    const { data, error } = await ctx.admin!.from('case_evidence_tags').insert({ bookmark_id: params.bookmarkId, tag_id: tagId, created_by: ctx.user!.id }).select(tagFields).single();
    if (error?.code === '23505') return reply({ error: 'This tag is already assigned to this bookmark.' }, 409);
    if (error?.code === '23503') return reply({ error: 'Bookmark no longer available. Refresh saved evidence.' }, 404);
    if (error || !data) throw error || new Error();
    return reply({ tag: data }, 201);
  } catch { return reply({ error: 'Tag change could not be confirmed. Refresh saved evidence before retrying.' }, 503); }
}
export async function POST(request: NextRequest, { params: routeParams }: { params: Promise<Params['params']> }) {
  const params = await routeParams; return mutate(request, params, false); }
export async function DELETE(request: NextRequest, { params: routeParams }: { params: Promise<Params['params']> }) {
  const params = await routeParams; return mutate(request, params, true); }
