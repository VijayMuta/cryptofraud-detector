import { NextRequest, NextResponse } from 'next/server';
import { getCaseWallets, getOwnedCase, isCaseStatus } from '@/lib/cases';
import { getRequestUser } from '@/lib/request-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function context(request: NextRequest, caseId: string) {
  const user = await getRequestUser(request);
  if (!user) return { error: response({ error: 'Sign in to access cases.' }, 401), admin: null, user: null, caseRecord: null };
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return { error: response({ error: 'Case management is not configured on this server.' }, 503), admin: null, user: null, caseRecord: null };
  }
  try {
    const caseRecord = await getOwnedCase(admin, user.id, caseId);
    if (!caseRecord) return { error: response({ error: 'Case not found.' }, 404), admin: null, user: null, caseRecord: null };
    return { error: null, admin, user, caseRecord };
  } catch {
    return { error: response({ error: 'Unable to load the case.' }, 500), admin: null, user: null, caseRecord: null };
  }
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const current = await context(request, params.id);
  if (current.error || !current.admin || !current.caseRecord) return current.error!;

  try {
    const wallets = await getCaseWallets(current.admin, current.caseRecord.id);
    return response({ case: { ...current.caseRecord, wallets } });
  } catch {
    return response({ error: 'Unable to load case wallets.' }, 500);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const current = await context(request, params.id);
  if (current.error || !current.admin || !current.user || !current.caseRecord) return current.error!;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return response({ error: 'Enter valid case changes.' }, 400);
  }

  const update: Record<string, string> = {};
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.trim().length < 2 || body.title.trim().length > 160) {
      return response({ error: 'Case title must be between 2 and 160 characters.' }, 400);
    }
    update.title = body.title.trim();
  }
  if (body.description !== undefined) {
    if (typeof body.description !== 'string' || body.description.trim().length > 5000) {
      return response({ error: 'Case description must be 5,000 characters or fewer.' }, 400);
    }
    update.description = body.description.trim();
  }
  if (body.status !== undefined) {
    if (!isCaseStatus(body.status)) return response({ error: 'Choose a valid case status.' }, 400);
    update.status = body.status;
  }
  if (Object.keys(update).length === 0) return response({ error: 'No supported case changes were provided.' }, 400);

  const { data, error } = await current.admin
    .from('investigation_cases')
    .update(update)
    .eq('id', current.caseRecord.id)
    .eq('created_by', current.user.id)
    .select('id,case_code,title,description,status,created_by,created_at,updated_at')
    .single();
  if (error) return response({ error: 'Unable to update the case.' }, 500);

  return response({ case: data });
}
