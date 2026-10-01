import { TransactionDeepDive } from '@/components/transaction-deep-dive';

export default async function TransactionPage({ params: routeParams, searchParams: routeSearchParams }: { params: Promise<{ hash: string }>; searchParams: Promise<{ case?: string | string[] }> }) {
  const params = await routeParams;
  const searchParams = await routeSearchParams;
  const caseId = typeof searchParams.case === 'string' ? searchParams.case : '';
  return <TransactionDeepDive key={`${params.hash}:${caseId}`} hash={params.hash} caseId={caseId} />;
}
