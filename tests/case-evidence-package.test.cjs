const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { load } = require('./load-typescript.cjs');
const { buildCaseEvidencePackage: build, PACKAGE_NOTICES, classifyPackageEvent } = load('src/lib/case-evidence-package.ts');
const { canonicalSerialize, createEvidencePayload, createIntegrityRecord, verifyEvidence } = load('src/lib/evidence-integrity.ts');
// Synthetic fixtures only; no production attribution or blockchain records are added.
const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40);
const record = { id: 'case-1', case_code: 'CASE-1', title: 'Fixture', description: '', status: 'open', created_by: 'user', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', wallets: [{ id: 'wallet-1', case_id: 'case-1', added_by: 'user', address: A, network: 'ethereum', added_at: '2026-01-01T00:00:00Z' }] };
const tx = { hash: '0x' + '1'.repeat(64), from: A, to: B, value: '1000000000000000001', timestamp: null, blockNumber: '1', status: 'success' };
const wallet = { address: A, network: 'Ethereum Mainnet', dataSource: 'Test fixture', verifiedAt: '2026-01-02T00:00:00Z', transactions: [tx] };
const input = { record, wallets: [wallet], generatedAt: '2026-01-03T00:00:00Z' };
const payload = data => createEvidencePayload('case-evidence-package', data);

test('package projection is deterministic, JSON safe and does not mutate inputs', () => {
  const before = structuredClone(input);
  assert.deepEqual(build(input), build(structuredClone(input)));
  assert.deepEqual(input, before);
  assert.doesNotThrow(() => canonicalSerialize(build(input)));
  assert.equal(build(input).observedEvidence.transfers[0].valueWei, tx.value);
});
test('private records, observations, derived fingerprint and attribution are separate', () => {
  const data = build(input);
  assert.equal(data.privateRecords.classification, 'private-case-report-record');
  assert.equal(data.observedEvidence.transfers[0].classification, 'observed-blockchain-evidence');
  assert.equal(data.derivedSignals.moneyFingerprint[0].classification, 'derived-investigative-signal');
  assert.equal(data.observedEvidence.transfers[0].timestamp, null);
  assert.ok(data.custodialAttribution.addresses.every(item => item.status === 'UNATTRIBUTED / UNKNOWN' && item.record === null));
  assert.equal(classifyPackageEvent({ category: 'Custodial Attribution' }), 'verified-custodial-attribution');
  assert.deepEqual(data.investigatorDisclaimers, PACKAGE_NOTICES);
});
test('missing sources remain explicit without invented transactions or findings', () => {
  const data = build({ record, generatedAt: input.generatedAt, issues: ['Provider unavailable'] });
  assert.equal(data.observedEvidence.transfers.length, 0);
  assert.equal(data.derivedSignals.moneyFingerprint.length, 0);
  assert.equal(data.availability.unavailableWallets[0].status, 'UNAVAILABLE / NOT GENERATED');
  assert.equal(data.availability.crossWalletAnalysis, 'UNAVAILABLE / NOT GENERATED');
  assert.ok(data.limitations.includes('Provider unavailable'));
  assert.equal(data.custodialAttribution.addresses[0].status, 'UNATTRIBUTED / UNKNOWN');
  const empty = build({ ...input, wallets: [{ ...wallet, transactions: [] }] });
  assert.equal(empty.availability.walletDatasetsLoaded, 1);
  assert.equal(empty.availability.unavailableWallets.length, 0);
  assert.match(empty.availability.fundSplitting, /UNAVAILABLE/);
});
test('failed, unknown and conflicting records remain raw evidence, never derived movement', () => {
  for (const rows of [[{ ...tx, status: 'failed' }], [{ ...tx, status: 'unknown' }], [tx, { ...tx, value: '2' }]]) {
    const data = build({ ...input, wallets: [{ ...wallet, transactions: rows }] });
    assert.equal(data.observedEvidence.walletDatasets[0].transactions.length, rows.length);
    assert.equal(data.observedEvidence.transfers.length, 0);
    assert.equal(data.derivedSignals.moneyFingerprint.length, 0);
  }
});
test('unrelated wallets, networks, reports and cross-case analysis are not included', () => {
  const data = build({ ...input, wallets: [{ ...wallet, address: B }, { ...wallet, network: 'other' }], reports: [{ id: 'unrelated' }], connections: { caseA: { id: 'other' }, caseB: { id: record.id } } });
  assert.equal(data.observedEvidence.walletDatasets.length, 0);
  assert.equal(data.privateRecords.reports.length, 0);
  assert.equal(data.derivedSignals.connectionAnalysis, null);
});
test('explicit report links preserve unavailable status and private allegations', () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  const linked = { ...record, description: `Source intake report: ${id}` };
  assert.deepEqual(build({ ...input, record: linked }).availability.unavailableReports, [id]);
  const report = { id, suspect_wallet: A, network: 'ethereum', incident_type: 'Allegation', incident_date: '2025-12-01', approximate_loss: '1', loss_currency: 'ETH', transaction_hash: null, created_at: record.created_at };
  const data = build({ ...input, record: linked, reports: [report] });
  assert.equal(data.privateRecords.reports.length, 1);
  assert.equal(data.investigationTimeline.events.find(event => event.type === 'Victim Report').classification, 'private-case-report-record');
});
test('package SHA-256 uses existing canonicalization and detects substantive changes', async () => {
  const data = build(input), evidence = payload(data);
  const integrity = await createIntegrityRecord(evidence);
  assert.equal(integrity.hash, createHash('sha256').update(canonicalSerialize(evidence)).digest('hex'));
  const exported = JSON.parse(JSON.stringify({ ...data, integrity }));
  assert.equal((await verifyEvidence(payload(exported), integrity.hash)).status, 'MATCH');
  exported.generatedAt = 'different export time';
  assert.equal((await verifyEvidence(payload(exported), integrity.hash)).status, 'MATCH');
  exported.observedEvidence.walletDatasets[0].verifiedAt = 'changed retrieval time';
  assert.equal((await verifyEvidence(payload(exported), integrity.hash)).status, 'MISMATCH');
  assert.equal((await verifyEvidence(null, integrity.hash)).status, 'UNAVAILABLE');
  assert.equal((await verifyEvidence(evidence, 'invalid')).status, 'INVALID_HASH');
});
