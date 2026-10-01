import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/request-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getOwnedCase } from '@/lib/cases';
import { isUuid } from '@/lib/case-activity';
import { defaultEvidenceReview, reviewFields, validateReviewRequest } from '@/lib/evidence-review-status';

export const dynamic = 'force-dynamic';
type Params = { params: { id: string; bookmarkId: string } };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
async function context(request: NextRequest, { id, bookmarkId }: Params['params']) {
  const user = await getRequestUser(request);
  if (!user) return { error: reply({ error: 'Sign in to access evidence review status.' }, 401) };
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
    const { data, error } = await ctx.admin!.from('case_evidence_review_statuses').select(reviewFields)
      .eq('case_id', params.id).eq('bookmark_id', params.bookmarkId).maybeSingle();
    if (error) throw error;
    return reply({ review: data || defaultEvidenceReview(params.id, params.bookmarkId) });
  } catch { return reply({ error: 'Unable to load review status. Check that the evidence review status migration is installed, then retry.' }, 503); }
}
export async function PUT(request: NextRequest, { params: routeParams }: { params: Promise<Params['params']> }) {
  const params = await routeParams;
  try {
    const ctx = await context(request, params); if (ctx.error) return ctx.error;
    let status;
    try {
      const raw = await request.text();
      if (raw.length > 1024) return reply({ error: 'Review status request is too large.' }, 413);
      status = validateReviewRequest(JSON.parse(raw));
    } catch { return reply({ error: 'Supply one supported review status and no other fields.' }, 400); }
    // One database statement: the trigger audits real transitions atomically.
    const { data, error } = await ctx.admin!.from('case_evidence_review_statuses').upsert({
      case_id: params.id, bookmark_id: params.bookmarkId, status, updated_by: ctx.user!.id,
    }, { onConflict: 'bookmark_id' }).select(reviewFields).single();
    if (error?.code === '23503') return reply({ error: 'Bookmark no longer available. Refresh saved evidence.' }, 404);
    if (error || !data) throw error || new Error('Review status unavailable.');
    return reply({ review: data });
  } catch { return reply({ error: 'Review status save could not be confirmed. Refresh review status before retrying.' }, 503); }
}
