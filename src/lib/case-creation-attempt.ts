import type { CaseStatus } from '@/lib/cases';

export type CaseCreationInput = { title: string; description: string; status: CaseStatus; wallets: string[] };
type AttemptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Store only an opaque key and a request digest, never case notes or credentials.
 * Same owner + normalized details retries the pending attempt across reloads.
 * Confirmed success removes it, so an identical later case is a new attempt.
 */
export async function caseCreationAttempt(storage: AttemptStorage, owner: string, input: CaseCreationInput) {
  const payload = {
    title: input.title.trim(), description: input.description.trim(), status: input.status,
    wallets: [...new Set(input.wallets.map(address => address.trim().toLowerCase()))].sort(),
  };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const storageKey = `chaintrace:case-creation:${owner}:${fingerprint}`;
  let key = storage.getItem(storageKey);
  if (key === null) {
    key = crypto.randomUUID();
    storage.setItem(storageKey, key); // Fail before sending if persistence is unavailable.
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
    throw new Error('Saved case creation attempt is invalid. Review your case list before clearing this tab’s session storage.');
  }
  return { key, payload, complete: () => storage.removeItem(storageKey) };
}
