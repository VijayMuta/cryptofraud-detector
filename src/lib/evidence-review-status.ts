export const EVIDENCE_REVIEW_STATUSES = {
  unreviewed: 'Unreviewed',
  in_review: 'In Review',
  verified: 'Verified',
  needs_follow_up: 'Needs Follow-up',
} as const;
export type EvidenceReviewStatus = keyof typeof EVIDENCE_REVIEW_STATUSES;
export type EvidenceReview = {
  bookmark_id: string; case_id: string; status: EvidenceReviewStatus;
  updated_by: string | null; updated_at: string | null;
};
export const reviewFields = 'bookmark_id,case_id,status,updated_by,updated_at';
export const REVIEW_NOTICE = 'Review status is an investigator workflow state. Even Verified is not proof that an address, transaction, or person committed fraud.';
export function isEvidenceReviewStatus(value: unknown): value is EvidenceReviewStatus {
  return typeof value === 'string' && Object.hasOwn(EVIDENCE_REVIEW_STATUSES, value);
}
export function defaultEvidenceReview(caseId: string, bookmarkId: string): EvidenceReview {
  return { case_id: caseId, bookmark_id: bookmarkId, status: 'unreviewed', updated_by: null, updated_at: null };
}
export function validateReviewRequest(value: unknown): EvidenceReviewStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== 1) throw new Error('Supply only status.');
  const field = Object.getOwnPropertyDescriptor(value, 'status');
  if (!field || !('value' in field) || !field.enumerable || !isEvidenceReviewStatus(field.value)) throw new Error('Choose a supported review status.');
  return field.value;
}
