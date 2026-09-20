import { randomUUID } from 'node:crypto';
import type { EvidenceContext } from '@/lib/ai-contract';
import type { ContextTarget } from '@/lib/ai-evidence';
import { AssistantError } from '@/lib/ai-provider';

type Snapshot = { owner: string; target: ContextTarget; evidence: EvidenceContext; expires: number };
const snapshots = new Map<string, Snapshot>();
const active = new Set<string>();
export function beginAssistantRequest(userId: string) {
  if (active.has(userId)) throw new AssistantError('An assistant request is already running. Please wait.', 429);
  active.add(userId);
  return () => { active.delete(userId); };
}
export function saveSnapshot(owner: string, target: ContextTarget, evidence: EvidenceContext) {
  for (const [id, entry] of snapshots) if (entry.expires < Date.now() || entry.owner === owner) snapshots.delete(id);
  while (snapshots.size >= 40) snapshots.delete(snapshots.keys().next().value!);
  const id = randomUUID();
  snapshots.set(id, { owner, target, evidence, expires: Date.now() + 10 * 60_000 });
  return id;
}
export function getSnapshot(owner: string, id: string) {
  const entry = snapshots.get(id);
  if (!entry || entry.owner !== owner || entry.expires < Date.now()) throw new AssistantError('Evidence session expired or unavailable. Load evidence again.', 409);
  return entry;
}
