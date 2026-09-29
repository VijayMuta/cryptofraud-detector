/** Investigator classifications only; these labels do not establish fraud. */
export const EVIDENCE_TAGS = {
  exchange: 'Exchange',
  bridge: 'Bridge',
  mixer: 'Mixer',
  victim_transfer: 'Victim Transfer',
  suspect_transfer: 'Suspect Transfer',
  funding_source: 'Funding Source',
  destination: 'Destination',
  intermediate_wallet: 'Intermediate Wallet',
  high_value: 'High Value',
  review_required: 'Review Required',
} as const;
export type EvidenceTagId = keyof typeof EVIDENCE_TAGS;
export type EvidenceTagAssignment = { bookmark_id: string; tag_id: EvidenceTagId; created_by: string; created_at: string };
export const tagFields = 'bookmark_id,tag_id,created_by,created_at';
export function isEvidenceTagId(value: unknown): value is EvidenceTagId {
  return typeof value === 'string' && Object.hasOwn(EVIDENCE_TAGS, value);
}
export function validateTagAssignment(value: unknown): EvidenceTagId {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== 1) throw new Error('Supply a controlled tagId only.');
  const descriptor = Object.getOwnPropertyDescriptor(value, 'tagId');
  if (!descriptor || !('value' in descriptor) || !isEvidenceTagId(descriptor.value)) throw new Error('Choose a supported evidence tag.');
  return descriptor.value;
}
