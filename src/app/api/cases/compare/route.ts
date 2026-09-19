import { NextRequest, NextResponse } from 'next/server';
import { analyzeCaseConnection } from '@/lib/case-analysis';
import { caseAnalysisInput, getCaseWallets, getOwnedCase } from '@/lib/cases';
import { getRequestUser } from '@/lib/request-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { AlchemyServiceError, logEthereumFailure } from '@/lib/alchemy';

export const dynamic = 'force-dynamic';
// Preserve the full evidence window while allowing provider throttling retries.
export const maxDuration = 300;

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return response({ error: 'Sign in to compare cases.' }, 401);
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return response({ error: 'Case comparison is not configured on this server.' }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return response({ error: 'Choose two cases to compare.' }, 400);
  }
  const caseAId = typeof body.caseAId === 'string' ? body.caseAId : '';
  const caseBId = typeof body.caseBId === 'string' ? body.caseBId : '';
  if (!caseAId || !caseBId || caseAId === caseBId) return response({ error: 'Choose two different cases to compare.' }, 400);

  try {
    const [caseA, caseB] = await Promise.all([
      getOwnedCase(admin, user.id, caseAId),
      getOwnedCase(admin, user.id, caseBId),
    ]);
    if (!caseA || !caseB) return response({ error: 'One or both cases were not found.' }, 404);

    const [walletsA, walletsB] = await Promise.all([
      getCaseWallets(admin, caseA.id),
      getCaseWallets(admin, caseB.id),
    ]);
    if (walletsA.length === 0 || walletsB.length === 0) {
      return response({ error: 'Both cases need at least one Ethereum wallet before comparison.' }, 400);
    }

    const analysis = await analyzeCaseConnection(
      caseAnalysisInput(caseA, walletsA),
      caseAnalysisInput(caseB, walletsB),
    );
    const [firstCase, secondCase] = [caseA, caseB].sort((left, right) => left.id.localeCompare(right.id));
    const { error: reviewError } = await admin
      .from('case_connection_reviews')
      .upsert(
        {
          case_a_id: firstCase.id,
          case_b_id: secondCase.id,
          created_by: user.id,
          analysis,
          // Legacy discriminator is constrained to 'etherscan' by the existing
          // schema. The JSON evidence's analysis.source records the actual provider.
          source: 'etherscan',
          generated_at: new Date().toISOString(),
        },
        { onConflict: 'created_by,case_a_id,case_b_id' },
      );
    if (reviewError) return response({ error: 'Live comparison completed, but the evidence review could not be saved.' }, 500);

    return response({ analysis });
  } catch (error) {
    logEthereumFailure('case_comparison', error);
    const message = error instanceof AlchemyServiceError ? error.message : error instanceof Error && error.message.includes('up to')
      ? error.message
      : 'Unable to retrieve live Ethereum data for case comparison.';
    return response({ error: message }, error instanceof AlchemyServiceError && error.kind === 'configuration' ? 503 : 502);
  }
}
