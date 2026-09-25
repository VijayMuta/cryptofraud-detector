import Link from 'next/link';
import { transactionDeepDiveUrl } from '@/lib/transaction-deep-dive';

export function TransactionLink({ hash, caseId }: { hash: string; caseId?: string }) {
  const href = transactionDeepDiveUrl(hash, caseId);
  return href ? <Link className="break-all font-mono text-xs text-cyan-200 underline decoration-cyan-400/70 underline-offset-4 hover:text-cyan-100 hover:decoration-cyan-100 focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300" href={href}>{hash}</Link> : <span className="break-all font-mono text-xs">{hash || 'UNAVAILABLE'}</span>;
}
