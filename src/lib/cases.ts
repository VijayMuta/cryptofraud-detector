import type { SupabaseClient } from '@supabase/supabase-js';
import type { CaseAnalysisInput } from '@/lib/case-analysis';

export const CASE_STATUSES = ['open', 'investigating', 'closed', 'archived'] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];

export type InvestigationCase = {
  id: string;
  case_code: string;
  title: string;
  description: string;
  status: CaseStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type CaseWallet = {
  id: string;
  case_id: string;
  address: string;
  network: 'ethereum';
  added_by: string;
  added_at: string;
};

export const caseFields = 'id,case_code,title,description,status,created_by,created_at,updated_at';
export const caseWalletFields = 'id,case_id,address,network,added_by,added_at';

export function isCaseStatus(value: unknown): value is CaseStatus {
  return typeof value === 'string' && (CASE_STATUSES as readonly string[]).includes(value);
}

export async function getOwnedCase(admin: SupabaseClient, userId: string, caseId: string) {
  const { data, error } = await admin
    .from('investigation_cases')
    .select(caseFields)
    .eq('id', caseId)
    .eq('created_by', userId)
    .maybeSingle();

  if (error) throw new Error('Unable to load the case.');
  return data as InvestigationCase | null;
}

export async function getCaseWallets(admin: SupabaseClient, caseId: string) {
  const { data, error } = await admin
    .from('case_wallets')
    .select(caseWalletFields)
    .eq('case_id', caseId)
    .order('added_at', { ascending: true });

  if (error) throw new Error('Unable to load case wallets.');
  return (data || []) as CaseWallet[];
}

export function caseAnalysisInput(caseRecord: InvestigationCase, wallets: CaseWallet[]): CaseAnalysisInput {
  return {
    id: caseRecord.id,
    caseCode: caseRecord.case_code,
    title: caseRecord.title,
    wallets: wallets.map((wallet) => wallet.address),
  };
}
