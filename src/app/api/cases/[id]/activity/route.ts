import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/request-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getOwnedCase } from '@/lib/cases';
import { isUuid, isActivityType, validateActivityMetadata } from '@/lib/case-activity';
import { canonicalSerialize } from '@/lib/evidence-integrity';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
async function context(request: NextRequest, id: string) {
  const user = await getRequestUser(request);
  if (!user) return { error: reply({ error: 'Sign in to access Case Activity.' }, 401) };
  if (!isUuid(id)) return { error: reply({ error: 'Case not found or not accessible.' }, 404) };
  const admin = getSupabaseAdmin();
  const record = await getOwnedCase(admin, user.id, id);
  if (!record) return { error: reply({ error: 'Case not found or not accessible.' }, 404) };
  return { admin, user, record };
}
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await context(request, params.id);
    if (ctx.error) return ctx.error;
    const offset = Number(request.nextUrl.searchParams.get('offset') || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) return reply({ error: 'Invalid page.' }, 400);
    const { data, error } = await ctx.admin!.from('case_activity_events')
      .select('id,case_id,actor_user_id,event_type,event_timestamp,metadata,origin')
      .eq('case_id', params.id).order('event_timestamp', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 99);
    if (error) throw error;
    // Validate again before rendering/exporting persisted metadata.
    const events = (data || []).map(event => ({ ...event, metadata: validateActivityMetadata(event.event_type, event.metadata) }));
    return reply({ events, nextOffset: events.length === 100 ? offset + 100 : null, caseCode: ctx.record!.case_code });
  } catch { return reply({ error: 'Unable to load Case Activity. Check that the activity migration is installed, then retry.' }, 503); }
}
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await context(request, params.id);
    if (ctx.error) return ctx.error;
    let body;
    try {
      const text = await request.text();
      if (text.length > 4096) throw new Error();
      body = JSON.parse(text);
      if (!body || Object.keys(body).sort().join(',') !== 'eventType,metadata,operationId' || !isUuid(body.operationId) || !isActivityType(body.eventType) || ['CASE_CREATED', 'CASE_STATUS_CHANGED', 'WALLET_ADDED', 'WALLET_REMOVED', 'CASE_NOTE_CREATED', 'EVIDENCE_BOOKMARK_CREATED', 'EVIDENCE_BOOKMARK_REMOVED'].includes(body.eventType)) throw new Error();
      body.metadata = validateActivityMetadata(body.eventType, body.metadata);
    } catch { return reply({ error: 'Invalid case activity event.' }, 400); }
    const { error } = await ctx.admin!.from('case_activity_events').upsert({
      case_id: params.id, actor_user_id: ctx.user!.id, event_type: body.eventType,
      metadata: body.metadata, operation_id: body.operationId, origin: 'browser-reported',
    }, { onConflict: 'case_id,operation_id', ignoreDuplicates: true });
    if (error) throw error;
    const { data: saved, error: readError } = await ctx.admin!.from('case_activity_events')
      .select('event_type,actor_user_id,metadata').eq('case_id', params.id).eq('operation_id', body.operationId).single();
    if (readError || !saved) throw readError || new Error('Recording unconfirmed.');
    if (saved.event_type !== body.eventType || saved.actor_user_id !== ctx.user!.id || canonicalSerialize(saved.metadata) !== canonicalSerialize(body.metadata)) {
      return reply({ error: 'This operation ID already belongs to a different activity.' }, 409);
    }
    return reply({ recorded: true });
  } catch { return reply({ error: 'Case Activity recording could not be confirmed.' }, 503); }
}
