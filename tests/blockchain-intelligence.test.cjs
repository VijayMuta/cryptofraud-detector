const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./load-typescript.cjs');
const { analyzeWalletTransactions, directionFor } = load('src/lib/wallet-analysis.ts');
const { summarizeIntelligence } = load('src/lib/blockchain-intelligence.ts');
const { isEthereumAddress } = load('src/lib/ethereum-address.ts');
const A = `0x${'a'.repeat(40)}`, B = `0x${'b'.repeat(40)}`;
// Test-only fixtures are never used by application data paths.
const row = (n, overrides = {}) => ({ hash: `0x${n.toString(16).padStart(64, '0')}`, from: A, to: B, value: '1000000000000000000', timestamp: `2026-01-01T00:0${n}:00Z`, blockNumber: '1', status: 'success', ...overrides });
test('valid public Ethereum address and invalid input', () => {
  assert.ok(isEthereumAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'));
  for (const input of ['', '0x123', 'invalid', '0xd8da6BF26964aF9D7eEd9e03E53415D37aA96045']) assert.equal(isEthereumAddress(input), false);
});
test('observed analytics exclude unknown/failed receipts but timeline preserves them', () => {
  const rows = [row(1), row(2), row(3, { status: 'unknown' }), row(4, { status: 'failed' }), row(5, { timestamp: null, from: B, to: A })];
  const analysis = analyzeWalletTransactions(A, rows);
  const summary = summarizeIntelligence(A, rows, analysis);
  assert.equal(analysis.totalSentWei, 2000000000000000000n);
  assert.equal(analysis.totalReceivedWei, 1000000000000000000n);
  assert.equal(summary.timeline[0].count, 4);
  assert.equal(summary.missingTimestamps, 1);
  assert.equal(summary.unknownStatuses, 1);
  assert.equal(summary.smallest, 1000000000000000000n);
  assert.ok(summary.signals.some(signal => signal.includes('1 destinations')));
  assert.equal(directionFor(row(1, { to: A }), A), 'self');
});
test('burst threshold and empty/invalid timestamp states are evidence based', () => {
  const rows = [1, 2, 3, 4, 5].map(n => row(n));
  assert.ok(summarizeIntelligence(A, rows, analyzeWalletTransactions(A, rows)).signals.some(signal => signal.includes('within one hour')));
  const empty = summarizeIntelligence(A, [], analyzeWalletTransactions(A, []));
  assert.deepEqual(empty.timeline, []);
  assert.equal(empty.smallest, null);
  assert.deepEqual(empty.signals, []);
  const invalid = [row(1, { timestamp: 'invalid', status: 'unknown' })];
  const result = summarizeIntelligence(A, invalid, analyzeWalletTransactions(A, invalid));
  assert.equal(result.first, null);
  assert.equal(result.smallest, null);
});
