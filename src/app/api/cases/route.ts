import { NextRequest, NextResponse } from 'next/server';
import { isEthereumAddress } from '@/lib/etherscan';
import { MAX_WALLETS_PER_CASE } from '@/lib/case-constants';
import { getOwnedCaseList } from '@/lib/case-list';
import { isCaseStatus } from '@/lib/cases';
import { getRequestUser } from '@/lib/request-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    { success: status < 400, ...body },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function authenticatedAdmin(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return { user: null, admin: null };
  try {
    return { user, admin: getSupabaseAdmin() };
  } catch {
    return { user, admin: null };
  }
}

function readAddresses(value: unknown) {
  if (!Array.isArray(value)) return [];
  const addresses: string[] = [];

  for (const valueAddress of value) {
    if (typeof valueAddress !== 'string') return null;
    const address = valueAddress.trim();
    if (!isEthereumAddress(address)) return null;
    addresses.push(address.toLowerCase());
  }

  return Array.from(new Set(addresses));
}

export async function GET(request: NextRequest) {
  const { user, admin } = await authenticatedAdmin(request);
  if (!user) return response({ error: 'Sign in to view cases.' }, 401);
  if (!admin) return response({ error: 'Case management is not configured on this server.' }, 503);

  try {
    return response({ cases: await getOwnedCaseList(admin, user.id) });
  } catch {
    return response({ error: 'Unable to load complete cases and wallets. Please retry.' }, 500);
  }
}

export async function POST(request: NextRequest) {
  const { user, admin } = await authenticatedAdmin(request);
  if (!user) return response({ error: 'Sign in to create a case.' }, 401);
  if (!admin) return response({ error: 'Case management is not configured on this server.' }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return response({ error: 'Enter case details.' }, 400);
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const status = body.status === undefined ? 'open' : body.status;
  const addresses = readAddresses(body.wallets);
  if (title.length < 2 || title.length > 160) return response({ error: 'Case title must be between 2 and 160 characters.' }, 400);
  if (description.length > 5000) return response({ error: 'Case description must be 5,000 characters or fewer.' }, 400);
  if (!isCaseStatus(status)) return response({ error: 'Choose a valid case status.' }, 400);
  if (addresses === null) return response({ error: 'Every suspect wallet must be a valid Ethereum address.' }, 400);
  if (addresses.length > MAX_WALLETS_PER_CASE) {
    return response({ error: `A live cross-wallet analysis supports up to ${MAX_WALLETS_PER_CASE} suspect wallets per case.` }, 400);
  }
  const key = request.headers.get('Idempotency-Key') || '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
    return response({ error: 'A valid case creation attempt key is required.' }, 400);
  }
  const unavailable = () => response({ error: 'Case creation could not be confirmed. Retry the same attempt; do not start a new attempt until its outcome is known.' }, 503);
  try {
    const { data, error } = await admin.rpc('create_case_atomic', {
      p_user_id: user.id, p_idempotency_key: key, p_title: title,
      p_description: description, p_status: status, p_wallets: addresses,
    });
    if (error?.code === 'PT409') return response({ error: 'This creation attempt already used different details. Retry its original details or review your case list.' }, 409);
    if (error?.code === 'PT410') return response({ error: 'The case created by this attempt is no longer available. This attempt cannot recreate it.' }, 410);
    if (error?.code === '22023') return response({ error: 'Invalid case creation details.' }, 400);
    if (error?.code === 'PGRST202' || error?.code === '42883' || error?.code === '42P01') {
      return response({ error: 'Atomic case creation is unavailable. An administrator must apply supabase-case-creation.sql before cases can be created. Retry the same attempt afterward.' }, 503);
    }
    const record = data?.case;
    if (error || typeof data?.created !== 'boolean' || !record || typeof record.id !== 'string' ||
        record.created_by !== user.id || typeof record.case_code !== 'string' ||
        !Array.isArray(record.wallets) || record.wallets.some(wallet => wallet.case_id !== record.id || wallet.added_by !== user.id)) return unavailable();
    return response({ case: record, created: data.created }, data.created ? 201 : 200);
  } catch {
    return unavailable();
  }
}
