export const INTEGRITY_NOTICE = 'SHA-256 integrity verification can detect whether the hashed evidence content has changed since the fingerprint was generated. It does not independently establish authenticity, ownership, legal admissibility, or proof of fraud.';
export const EVIDENCE_VERSION = 'chaintrace-evidence-v1' as const;
export type EvidencePackageType = 'case-report' | 'freeze-hold' | 'case-evidence-package';
export type EvidencePayload = { version: typeof EVIDENCE_VERSION; packageType: EvidencePackageType; evidence: Record<string, unknown> };
export type IntegrityRecord = {
  algorithm: 'SHA-256'; hash: string; generatedAt: string;
  packageVersion: typeof EVIDENCE_VERSION; packageType: EvidencePackageType;
  canonicalization: 'chaintrace-json-v1'; caseId?: string; caseCode?: string;
  scope: string; notice: string;
};
export type VerificationResult = { status: 'MATCH' | 'MISMATCH' | 'INVALID_HASH' | 'UNAVAILABLE' | 'ERROR'; message: string; actualHash?: string };
export const INTEGRITY_SCOPE = 'Hash UTF-8 canonical JSON of {version, packageType, evidence}. Evidence contains every export field except the top-level generatedAt (export timestamp) and integrity (this record). Nested timestamps, audit entries, notes, and all evidence facts remain hashed. Object keys are sorted; array order is preserved. This hashes evidence content, not CSV, HTML, or PDF bytes.';

/** Strict JSON domain: reject values JSON.stringify would silently drop/coerce. */
export function canonicalSerialize(value: unknown): string {
  const ancestors = new Set<object>();
  function visit(item: unknown): string {
    if (item === null) return 'null';
    if (typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new Error('Non-finite numbers are not supported.');
      return JSON.stringify(item);
    }
    if (typeof item !== 'object') throw new Error('Evidence must contain only JSON values.');
    if (ancestors.has(item)) throw new Error('Circular evidence is not supported.');
    if (Object.getOwnPropertySymbols(item).length) throw new Error('Symbol fields are not supported.');
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.getOwnPropertyNames(item).length !== item.length + 1) throw new Error('Sparse arrays or extra array fields are not supported.');
        const values: string[] = [];
        for (let index = 0; index < item.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error('Sparse arrays or accessors are not supported.');
          values.push(visit(descriptor.value));
        }
        return '[' + values.join(',') + ']';
      }
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new Error('Evidence must use plain JSON objects.');
      return '{' + Object.getOwnPropertyNames(item).sort().map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('Hidden fields or accessors are not supported.');
        return JSON.stringify(key) + ':' + visit(descriptor.value);
      }).join(',') + '}';
    } finally { ancestors.delete(item); }
  }
  return visit(value);
}

/** Only these two top-level export-envelope fields are excluded, never nested facts. */
export function createEvidencePayload(packageType: EvidencePackageType, data: Record<string, unknown>): EvidencePayload {
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('An evidence export object is required.');
  // Preserve descriptors so unsupported hidden fields/accessors fail in hashing,
  // rather than being silently dropped or invoked while constructing the payload.
  const descriptors = Object.getOwnPropertyDescriptors(data);
  delete descriptors.generatedAt;
  delete descriptors.integrity;
  const evidence = Object.create(Object.getPrototypeOf(data), descriptors) as Record<string, unknown>;
  return { version: EVIDENCE_VERSION, packageType, evidence };
}
export async function sha256Evidence(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalSerialize(value));
  if (!globalThis.crypto?.subtle) throw new Error('Platform cryptography unavailable.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function createIntegrityRecord(payload: EvidencePayload, reference: { caseId?: string; caseCode?: string } = {}): Promise<IntegrityRecord> {
  const hash = await sha256Evidence(payload);
  return { algorithm: 'SHA-256', hash, generatedAt: new Date().toISOString(), packageVersion: payload.version, packageType: payload.packageType, canonicalization: 'chaintrace-json-v1', ...reference, scope: INTEGRITY_SCOPE, notice: INTEGRITY_NOTICE };
}
export async function verifyEvidence(payload: unknown, expectedHash: string): Promise<VerificationResult> {
  const expected = expectedHash.trim();
  if (!expected) return { status: 'INVALID_HASH', message: 'Enter a SHA-256 hash.' };
  if (!/^[0-9a-f]{64}$/i.test(expected)) return { status: 'INVALID_HASH', message: 'Enter exactly 64 hexadecimal characters for SHA-256.' };
  if (payload === null || payload === undefined) return { status: 'UNAVAILABLE', message: 'Current evidence is unavailable. Load an evidence package first.' };
  try {
    const actualHash = await sha256Evidence(payload);
    return actualHash === expected.toLowerCase()
      ? { status: 'MATCH', message: 'The current evidence package matches the supplied SHA-256 fingerprint.', actualHash }
      : { status: 'MISMATCH', message: 'The current evidence package does not match the supplied SHA-256 fingerprint. The hashed content may have changed.', actualHash };
  } catch { return { status: 'ERROR', message: 'Unable to hash this evidence package using platform SHA-256. No verification result is available.' }; }
}
