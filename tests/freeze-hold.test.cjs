const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./load-typescript.cjs');
const { summarizeEvidence } = load('src/lib/freeze-hold.ts');
const A = `0x${'a'.repeat(40)}`, B = `0x${'b'.repeat(40)}`;
const tx = (n, status, overrides = {}) => ({ hash: `0x${n.toString(16).padStart(64, '0')}`, from: A, to: B, value: '100', blockNumber: '1', timestamp: null, status, ...overrides });
const wallet = transactions => ({ address: A, transactions, dataSource: 'Test fixture', verifiedAt: '2026-01-01T00:00:00Z', network: 'Ethereum Mainnet' });
test('no evidence invents neither endpoints nor behavioral findings', () => {
  assert.deepEqual(summarizeEvidence([]), { transactions: [], behavioral: [], endpoints: [] });
  const empty = summarizeEvidence([wallet([])]);
  assert.equal(empty.behavioral[0].moneyFingerprint, null);
  assert.equal(empty.behavioral[0].fundSplitting, null);
});
test('only successful outgoing value transfers establish destinations; no ownership inferred', () => {
  const bad = [tx(1, 'failed'), tx(2, 'unknown'), tx(3, 'success', { value: '0' }), tx(4, 'success', { from: B, to: A }), tx(5, 'success', { to: A })];
  assert.deepEqual(summarizeEvidence([wallet(bad)]).endpoints, []);
  const good = tx(6, 'success');
  const result = summarizeEvidence([wallet([...bad, good]), wallet([good])]);
  assert.equal(result.transactions.length, 6);
  assert.equal(result.endpoints.length, 1);
  assert.equal(result.endpoints[0].status, 'UNATTRIBUTED / UNKNOWN');
  assert.equal(result.endpoints[0].address, B);
  assert.doesNotThrow(() => JSON.stringify(result));
});
