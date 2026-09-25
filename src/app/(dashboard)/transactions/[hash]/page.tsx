import { TransactionDeepDive } from '@/components/transaction-deep-dive';

export default function TransactionPage({ params, searchParams }: { params: { hash: string }; searchParams: { case?: string | string[] } }) {
  const caseId = typeof searchParams.case === 'string' ? searchParams.case : '';
  return <TransactionDeepDive key={`${params.hash}:${caseId}`} hash={params.hash} caseId={caseId} />;
}
