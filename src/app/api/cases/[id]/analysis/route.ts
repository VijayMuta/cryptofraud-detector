import { NextRequest, NextResponse } from 'next/server';
import { analyzeCaseConnection } from '@/lib/case-analysis';
import { caseAnalysisInput, getCaseWallets, getOwnedCase } from '@/lib/cases';
import { getRequestUser } from '@/lib/request-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { AlchemyServiceError, logEthereumFailure } from '@/lib/alchemy';

export const dynamic = 'force-dynamic';
// Paginated histories and provider backoff can exceed the former 60-second budget.
export const maxDuration = 300;

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getRequestUser(request);
  if (!user) return response({ error: 'Sign in to analyze a case.' }, 401);
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return response({ error: 'Case analysis is not configured on this server.' }, 503);
  }

  try {
    const caseRecord = await getOwnedCase(admin, user.id, params.id);
    if (!caseRecord) return response({ error: 'Case not found.' }, 404);
    const wallets = await getCaseWallets(admin, caseRecord.id);
    if (wallets.length === 0) return response({ error: 'Add at least one Ethereum wallet before running analysis.' }, 400);

    const analysis = await analyzeCaseConnection(
      caseAnalysisInput(caseRecord, wallets),
      caseAnalysisInput(caseRecord, wallets),
      { sameCase: true },
    );
    return response({ analysis });
  } catch (error) {
    logEthereumFailure('case_analysis', error);
    const message = error instanceof AlchemyServiceError ? error.message : error instanceof Error && error.message.includes('up to')
      ? error.message
      : 'Unable to retrieve live Ethereum data for this case.';
    return response({ error: message }, error instanceof AlchemyServiceError && error.kind === 'configuration' ? 503 : 502);
  }
}
