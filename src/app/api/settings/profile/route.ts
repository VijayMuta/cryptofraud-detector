import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/request-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function context(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return { user: null, admin: null };
  try {
    return { user, admin: getSupabaseAdmin() };
  } catch {
    return { user, admin: null };
  }
}

export async function GET(request: NextRequest) {
  const { user, admin } = await context(request);
  if (!user) return response({ error: 'Sign in to view settings.' }, 401);
  if (!admin) return response({ error: 'Settings are not configured on this server.' }, 503);

  const { data, error } = await admin
    .from('profiles')
    .select('full_name,role,updated_at')
    .eq('id', user.id)
    .maybeSingle();
  if (error) return response({ error: 'Unable to load your profile.' }, 500);

  return response({
    profile: {
      email: user.email || 'Unavailable',
      fullName: data?.full_name || '',
      role: data?.role || 'analyst',
      updatedAt: data?.updated_at || null,
    },
    system: {
      alchemyConfigured: Boolean(process.env.ALCHEMY_API_KEY),
      monitoringConfigured: Boolean(process.env.ETHERSCAN_API_KEY && process.env.CRON_SECRET),
    },
    verifiedAt: new Date().toISOString(),
  });
}

export async function PATCH(request: NextRequest) {
  const { user, admin } = await context(request);
  if (!user) return response({ error: 'Sign in to update settings.' }, 401);
  if (!admin) return response({ error: 'Settings are not configured on this server.' }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return response({ error: 'Enter valid profile changes.' }, 400);
  }
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  if (fullName.length > 120) return response({ error: 'Full name must be 120 characters or fewer.' }, 400);

  // Only the display name is user-editable. Role assignment remains an
  // authorized administrative database operation and is never user-controlled.
  const { data, error } = await admin
    .from('profiles')
    .update({ full_name: fullName })
    .eq('id', user.id)
    .select('full_name,role,updated_at')
    .single();
  if (error || !data) return response({ error: 'Unable to update your profile.' }, 500);

  return response({
    profile: {
      email: user.email || 'Unavailable',
      fullName: data.full_name || '',
      role: data.role,
      updatedAt: data.updated_at,
    },
  });
}
