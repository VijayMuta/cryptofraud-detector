const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./load-typescript.cjs');
const { validateEscalation, externalResponseError, snapshotPackage, INTERNAL_STATUSES } = load('src/lib/authorized-escalation.ts');
const base = () => ({ requestId: 'preserved-id', case: { id: 'case-id', code: 'CT-1' }, reportedSuspectWallets: ['0x' + 'a'.repeat(40)], network: 'Ethereum Mainnet', blockchainObservedFacts: { transactions: [] }, analyticalSignals: [], crossWalletEvidence: null, monitoringAlerts: [], custodialEndpoints: [], targetEntity: 'Manual target', reason: 'Review requested', analystNotes: 'No transaction history currently available' });
test('missing optional evidence does not block an otherwise complete package', () => {
  const validation = validateEscalation(base());
  assert.equal(validation.filter(row => row.required && row.state !== 'AVAILABLE').length, 0);
  assert.equal(validation.find(row => row.label === 'Transaction evidence').state, 'MISSING');
  assert.equal(validation.find(row => row.label === 'Custodial endpoint attribution').state, 'MISSING');
  const missing = validateEscalation({ ...base(), reason: ' ', analystNotes: '' });
  assert.deepEqual(missing.filter(row => row.required && row.state === 'MISSING').map(row => row.label), ['Reason for request', 'Investigator notes']);
});
test('not-applicable needs an explanation and cannot bypass required fields or hide existing evidence', () => {
  const validation = validateEscalation({ ...base(), reason: '' }, { 'Cross-wallet evidence': 'Single-wallet investigation', 'Reason for request': 'Not needed', 'Blockchain network': 'Ignore' });
  assert.equal(validation.find(row => row.label === 'Cross-wallet evidence').state, 'NOT APPLICABLE');
  assert.equal(validation.find(row => row.label === 'Reason for request').state, 'MISSING');
  assert.equal(validation.find(row => row.label === 'Blockchain network').state, 'AVAILABLE');
});
test('snapshot detaches evidence and preserves request identity', () => {
  const original = base();
  const saved = snapshotPackage(original);
  original.reportedSuspectWallets.push('changed');
  original.analystNotes = 'edited';
  assert.equal(saved.requestId, 'preserved-id');
  assert.equal(saved.reportedSuspectWallets.length, 1);
  assert.notEqual(saved.analystNotes, original.analystNotes);
});
test('external statuses are separate and need confirmation, reference, entity, and valid past date', () => {
  assert.ok(!INTERNAL_STATUSES.includes('ACKNOWLEDGED'));
  const response = { referenceId: 'REF-1', entity: 'Authority', respondedAt: '2026-01-01T00:00:00Z', status: 'ACTIONED', notes: '', confirmed: true };
  const now = Date.parse('2026-02-01T00:00:00Z');
  assert.equal(externalResponseError(response, now), null);
  for (const change of [{ confirmed: false }, { referenceId: ' ' }, { entity: '' }, { respondedAt: 'invalid' }, { respondedAt: '2027-01-01T00:00:00Z' }, { status: 'FUNDS FROZEN' }]) assert.ok(externalResponseError({ ...response, ...change }, now));
});
