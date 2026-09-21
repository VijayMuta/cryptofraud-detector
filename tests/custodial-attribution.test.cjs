const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./load-typescript.cjs');
const { lookupCustodialAttribution, resolveCustodialTarget, TRUSTED_CUSTODIAL_RECORDS, normalizeAttributionAddress } = load('src/lib/custodial-attribution.ts');
const { snapshotPackage, validateEscalation } = load('src/lib/authorized-escalation.ts');
const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40);
// Synthetic test fixtures only. Never imported by production code.
const record = { id: 'TEST-ONLY-1', network: 'Ethereum Mainnet', address: A, entityName: 'TEST ONLY Custodian', entityType: 'Custodian', status: 'VERIFIED', sourceName: 'Test-only reviewed source', sourceReference: 'https://example.invalid/test-evidence', verifiedAt: '2025-01-01T00:00:00Z', notes: 'Synthetic fixture, not real attribution.' };
test('exact network/address verified record preserves complete provenance', () => {
  const result = lookupCustodialAttribution('ethereum', A, [record]);
  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.record.entityName, record.entityName);
  assert.equal(result.record.sourceName, record.sourceName);
  assert.equal(result.record.sourceReference, record.sourceReference);
  assert.equal(result.record.verifiedAt, record.verifiedAt);
  assert.equal(result.network, 'eip155:1');
});
test('empty production registry, unknown address, other chain, and partial addresses remain unknown', () => {
  assert.deepEqual(TRUSTED_CUSTODIAL_RECORDS, []);
  for (const [network, address, records] of [['ethereum', A, undefined], ['ethereum', B, [record]], ['polygon', A, [record]], ['ethereum', A.slice(0, -1), [record]], ['ethereum', A + '0', [record]]]) {
    const result = lookupCustodialAttribution(network, address, records);
    assert.equal(result.status, 'UNATTRIBUTED / UNKNOWN');
    assert.equal(result.record, null);
  }
});
test('Ethereum matching is case-insensitive for valid addresses and rejects bad mixed-case checksums', () => {
  assert.equal(lookupCustodialAttribution('ETHEREUM MAINNET', '  0x' + 'A'.repeat(40) + '  ', [record]).status, 'VERIFIED');
  assert.equal(normalizeAttributionAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'), '0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
  assert.equal(normalizeAttributionAddress('0xd8da6BF26964aF9D7eEd9e03E53415D37aA96045'), null);
});
test('possible, incomplete, future-dated and conflicting records never become verified', () => {
  const possible = lookupCustodialAttribution('ethereum', A, [{ ...record, status: 'POSSIBLE / UNVERIFIED', verifiedAt: null }]);
  assert.equal(possible.status, 'UNATTRIBUTED / UNKNOWN');
  assert.equal(possible.possibleRecords[0].status, 'POSSIBLE / UNVERIFIED');
  for (const override of [{ sourceName: '' }, { verifiedAt: null }, { verifiedAt: 'not a date' }, { verifiedAt: '2999-01-01' }, { entityName: '' }]) assert.equal(lookupCustodialAttribution('ethereum', A, [{ ...record, ...override }]).status, 'UNATTRIBUTED / UNKNOWN');
  assert.equal(lookupCustodialAttribution('ethereum', A, [record, { ...record, entityName: 'CONFLICTING TEST ENTITY' }]).status, 'UNATTRIBUTED / UNKNOWN');
});
test('manual targets never become verified even when their names match a verified entity', () => {
  const endpoint = lookupCustodialAttribution('ethereum', A, [record]);
  const manual = resolveCustodialTarget('', [endpoint], record.entityName, 'Custodian');
  assert.equal(manual.source, 'ANALYST-ENTERED / UNVERIFIED');
  assert.equal(manual.endpoint, null);
  const missing = resolveCustodialTarget(B, [endpoint], 'Manual', 'Other');
  assert.equal(missing.endpoint, null);
  const selected = resolveCustodialTarget(A, [endpoint], 'Untrusted different name', 'Other');
  assert.equal(selected.source, 'BLOCKCHAIN/ATTRIBUTION VERIFIED');
  assert.equal(selected.entityName, record.entityName);
});
test('export snapshot retains provenance and escalation availability uses actual records', () => {
  const endpoint = lookupCustodialAttribution('ethereum', A, [record]);
  const data = { case: { id: 'case-1', code: 'CT-1' }, network: 'Ethereum Mainnet', reportedSuspectWallets: [B], blockchainObservedFacts: { transactions: [] }, analyticalSignals: [], crossWalletEvidence: null, monitoringAlerts: [], custodialEndpoints: [endpoint], targetEntity: record.entityName, reason: 'Review', analystNotes: 'Notes' };
  assert.equal(validateEscalation(data).find(row => row.label === 'Custodial endpoint attribution').state, 'AVAILABLE');
  const exported = JSON.parse(JSON.stringify(snapshotPackage(data)));
  assert.equal(exported.custodialEndpoints[0].record.sourceReference, record.sourceReference);
  assert.equal(exported.custodialEndpoints[0].record.verifiedAt, record.verifiedAt);
  assert.equal(validateEscalation({ ...data, custodialEndpoints: [] }).find(row => row.label === 'Custodial endpoint attribution').state, 'MISSING');
});
