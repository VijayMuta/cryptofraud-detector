'use client';
import { authenticatedFetch } from '@/lib/client-api';
import { ACTIVITY_WARNING, validateActivityMetadata, type ActivityType, type ActivityMetadata } from '@/lib/case-activity';

/** One operation ID per completed action; reuse it if retrying delivery. Never retry the action. */
export async function recordCaseActivity(caseId: string, eventType: ActivityType, metadata: ActivityMetadata, operationId?: string): Promise<string> {
  try {
    validateActivityMetadata(eventType, metadata);
    await authenticatedFetch(`/api/cases/${encodeURIComponent(caseId)}/activity`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType, metadata, operationId: operationId || crypto.randomUUID() }),
    });
    return '';
  } catch { return ACTIVITY_WARNING; }
}
