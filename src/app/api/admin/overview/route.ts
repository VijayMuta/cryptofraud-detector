import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/request-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

type Role = 'analyst' | 'reviewer' | 'admin';

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function countRows(table: string, filters: Array<[string, string]> = []) {
  const admin = getSupabaseAdmin();
  let query = admin.from(table).select('*', { count: 'exact', head: true });
  for (const [column, value] of filters) query = query.eq(column, value);
  const { count, error } = await query;
  if (error) throw new Error(`Unable to count ${table}.`);
  return count || 0;
}

export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return response({ error: 'Sign in to access administration.' }, 401);

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return response({ error: 'Administration is not configured on this server.' }, 503);
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError) return response({ error: 'Unable to verify administrative access.' }, 500);
  if (profile?.role !== 'admin') return response({ error: 'Administrator access is required.' }, 403);

  try {
    const roles: Role[] = ['analyst', 'reviewer', 'admin'];
    const [users, cases, alerts, roleCounts] = await Promise.all([
      countRows('profiles'),
      countRows('investigation_cases'),
      countRows('monitor_alerts'),
      Promise.all(roles.map(async (role) => ({ role, count: await countRows('profiles', [['role', role]]) }))),
    ]);

    return response({
      users,
      cases,
      alerts,
      roles: roleCounts,
      system: {
        alchemyConfigured: Boolean(process.env.ALCHEMY_API_KEY),
        supabaseConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
        auditLogs: 'Unavailable — an audit-log table is not configured in the current schema.',
      },
      verifiedAt: new Date().toISOString(),
    });
  } catch {
    return response({ error: 'Unable to load the administrative overview.' }, 500);
  }
}
