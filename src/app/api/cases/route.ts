import { NextRequest, NextResponse } from 'next/server';
import { isEthereumAddress } from '@/lib/etherscan';
import { MAX_WALLETS_PER_CASE } from '@/lib/case-constants';
import {
  caseFields,
  caseWalletFields,
  isCaseStatus,
  type CaseWallet,
  type InvestigationCase,
} from '@/lib/cases';
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

  const { data: cases, error: caseError } = await admin
    .from('investigation_cases')
    .select(caseFields)
    .eq('created_by', user.id)
    .order('updated_at', { ascending: false });
  if (caseError) return response({ error: 'Unable to load cases.' }, 500);

  const caseRows = (cases || []) as InvestigationCase[];
  const ids = caseRows.map((caseRecord) => caseRecord.id);
  let wallets: CaseWallet[] = [];
  if (ids.length > 0) {
    const { data, error } = await admin
      .from('case_wallets')
      .select(caseWalletFields)
      .in('case_id', ids)
      .order('added_at', { ascending: true });
    if (error) return response({ error: 'Unable to load case wallets.' }, 500);
    wallets = (data || []) as CaseWallet[];
  }

  return response({
    cases: caseRows.map((caseRecord) => ({
      ...caseRecord,
      wallets: wallets.filter((wallet) => wallet.case_id === caseRecord.id),
    })),
  });
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

  const { data: caseRecord, error: caseError } = await admin
    .from('investigation_cases')
    .insert({ title, description, status, created_by: user.id })
    .select(caseFields)
    .single();
  if (caseError || !caseRecord) return response({ error: 'Unable to create the case.' }, 500);

  if (addresses.length > 0) {
    const { error: walletError } = await admin.from('case_wallets').insert(
      addresses.map((address) => ({ case_id: caseRecord.id, address, network: 'ethereum', added_by: user.id })),
    );
    if (walletError) return response({ error: 'Case created, but its suspect wallets could not be saved.' }, 500);
  }

  const { data: wallets } = await admin
    .from('case_wallets')
    .select(caseWalletFields)
    .eq('case_id', caseRecord.id)
    .order('added_at', { ascending: true });

  return response({ case: { ...(caseRecord as InvestigationCase), wallets: (wallets || []) as CaseWallet[] } }, 201);
}
