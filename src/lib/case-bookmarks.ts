export const BOOKMARK_LABELS = ['Review', 'Key transfer', 'Follow up'] as const;
export type CaseBookmark = { id: string; case_id: string; created_by: string; transaction_hash: string; network: 'ethereum'; label: string | null; created_at: string };
export const bookmarkFields = 'id,case_id,created_by,transaction_hash,network,label,created_at';
export function validateBookmark(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Invalid bookmark.');
  const body = value as Record<string, unknown>;
  if (Reflect.ownKeys(body).some(key => !['transactionHash', 'network', 'label'].includes(String(key)))) throw new Error('Unsupported bookmark fields.');
  if (typeof body.transactionHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(body.transactionHash)) throw new Error('Enter a valid Ethereum transaction hash.');
  if (body.network !== 'ethereum') throw new Error('Only Ethereum Mainnet bookmarks are supported.');
  if (body.label !== undefined && body.label !== null && !(BOOKMARK_LABELS as readonly unknown[]).includes(body.label)) throw new Error('Choose a supported bookmark label.');
  return { transaction_hash: body.transactionHash.toLowerCase(), network: 'ethereum' as const, label: (body.label ?? null) as string | null };
}
