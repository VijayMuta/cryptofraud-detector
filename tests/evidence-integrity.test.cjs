const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { load } = require('./load-typescript.cjs');
const { canonicalSerialize, createEvidencePayload, sha256Evidence, createIntegrityRecord, verifyEvidence } = load('src/lib/evidence-integrity.ts');

test('canonical JSON sorts nested keys, preserves arrays and JSON primitive values', () => {
  assert.equal(canonicalSerialize({ z: [null, true, false, 1.25, 'é\n'], a: { z: 2, a: 1 } }), '{"a":{"a":1,"z":2},"z":[null,true,false,1.25,"é\\n"]}');
  assert.equal(canonicalSerialize({ a: { b: 1, a: 2 }, z: 3 }), canonicalSerialize({ z: 3, a: { a: 2, b: 1 } }));
  assert.notEqual(canonicalSerialize([1, 2]), canonicalSerialize([2, 1]));
  assert.equal(canonicalSerialize(-0), '0');
});
test('SHA-256 matches independent standard implementation for UTF-8 canonical bytes', async () => {
  for (const value of [null, '', { unicode: '证据 🔍', amountWei: '1000000000000000001' }, [false, 123]]) {
    const expected = createHash('sha256').update(canonicalSerialize(value), 'utf8').digest('hex');
    assert.equal(await sha256Evidence(value), expected);
  }
});
test('invalid JSON-domain values fail instead of silently losing evidence', () => {
  const circular = {}; circular.self = circular;
  const sparse = Array(2);
  const extraArray = [1]; extraArray.note = 'evidence';
  assert.throws(() => canonicalSerialize(Object.defineProperty([1], 'hidden', { value: 'evidence' })));
  assert.throws(() => canonicalSerialize(createEvidencePayload('case-report', Object.defineProperty({}, 'hidden', { value: 'evidence' }))));
  for (const value of [undefined, NaN, Infinity, 1n, new Date(), new Map(), circular, sparse, extraArray, { field: undefined }, { fn() {} }, { [Symbol('evidence')]: 1 }, Object.defineProperty({}, 'hidden', { value: 1 }), { get amount() { throw Error('must not invoke getter'); } }]) assert.throws(() => canonicalSerialize(value));
});
test('equivalent evidence ignores export/integrity generation metadata but retains substantive nested timestamps', async () => {
  const a = createEvidencePayload('case-report', { generatedAt: 'one', caseInformation: { title: 'Case', updatedAt: 'original' }, walletInformation: [] });
  const b = createEvidencePayload('case-report', { walletInformation: [], caseInformation: { updatedAt: 'original', title: 'Case' }, generatedAt: 'two', integrity: { hash: 'old' } });
  const left = await createIntegrityRecord(a, { caseId: 'private-id', caseCode: 'CT-1' });
  const right = await createIntegrityRecord(b, { caseId: 'private-id', caseCode: 'CT-1' });
  assert.equal(left.hash, right.hash);
  assert.equal(left.algorithm, 'SHA-256');
  assert.equal(left.packageVersion, 'chaintrace-evidence-v1');
  assert.equal(left.caseCode, 'CT-1');
  b.evidence.caseInformation.updatedAt = 'changed';
  assert.notEqual(await sha256Evidence(b), left.hash);
});
test('verification gives MATCH/MISMATCH without claiming tampering and supports uppercase hex', async () => {
  const payload = createEvidencePayload('freeze-hold', { reason: 'Review', transactions: [{ value: '1' }] });
  const { hash } = await createIntegrityRecord(payload);
  assert.equal((await verifyEvidence(payload, ' ' + hash.toUpperCase() + ' ')).status, 'MATCH');
  const changed = createEvidencePayload('freeze-hold', { reason: 'Review', transactions: [{ value: '2' }] });
  const result = await verifyEvidence(changed, hash);
  assert.equal(result.status, 'MISMATCH');
  assert.match(result.message, /may have changed/);
  assert.doesNotMatch(result.message, /tamper|fraud/);
});
test('empty/invalid hash, unavailable evidence, and hashing errors have explicit states', async () => {
  for (const input of ['', ' ', 'x'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), '0x' + 'a'.repeat(64)]) assert.equal((await verifyEvidence({}, input)).status, 'INVALID_HASH');
  assert.equal((await verifyEvidence(null, 'a'.repeat(64))).status, 'UNAVAILABLE');
  assert.equal((await verifyEvidence({ amount: undefined }, 'a'.repeat(64))).status, 'ERROR');
});
test('export can be independently rehashed, without self-reference; audit additions change content', async () => {
  const original = { generatedAt: 'export-time', case: { id: 'case-1' }, analystNotes: 'Review only', auditTrail: [{ action: 'Prepared', at: 'time-1' }], externalResponses: [] };
  const withExportAudit = { ...original, auditTrail: [...original.auditTrail, { action: 'Export', at: 'time-2' }] };
  const integrity = await createIntegrityRecord(createEvidencePayload('freeze-hold', withExportAudit));
  const exported = JSON.parse(JSON.stringify({ ...withExportAudit, integrity }));
  assert.equal((await verifyEvidence(createEvidencePayload('freeze-hold', exported), integrity.hash)).status, 'MATCH');
  assert.equal((await verifyEvidence(createEvidencePayload('freeze-hold', original), integrity.hash)).status, 'MISMATCH');
  exported.analystNotes = 'Changed notes';
  assert.equal((await verifyEvidence(createEvidencePayload('freeze-hold', exported), integrity.hash)).status, 'MISMATCH');
});
test('package type/version are part of hashed payload; serialization does not mutate evidence', async () => {
  const data = { z: 1, a: [2, 1] }, before = JSON.stringify(data);
  const first = createEvidencePayload('case-report', data);
  assert.notEqual(await sha256Evidence(first), await sha256Evidence(createEvidencePayload('freeze-hold', data)));
  assert.notEqual(await sha256Evidence(first), await sha256Evidence({ ...first, version: 'future' }));
  assert.equal(JSON.stringify(data), before);
});
test('missing or failing platform cryptography produces an error, never a false match', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    for (const crypto of [undefined, { subtle: { digest: async () => { throw Error('unavailable'); } } }]) {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: crypto });
      assert.equal((await verifyEvidence({ observed: true }, 'a'.repeat(64))).status, 'ERROR');
      await assert.rejects(() => createIntegrityRecord(createEvidencePayload('case-report', { case: 'test' })));
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else delete globalThis.crypto;
  }
});
