const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./load-typescript.cjs');
const { buildFundFlow, DEFAULT_FLOW_FILTERS, parseMinimumEth } = load('src/lib/fund-flow.ts');
const { analyzeWalletTransactions } = load('src/lib/wallet-analysis.ts');
// Isolated test fixtures only; never used by application evidence loaders.
const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40), C = '0x' + 'c'.repeat(40), D = '0x' + 'd'.repeat(40);
const tx = (n, overrides = {}) => ({ hash: '0x' + n.toString(16).padStart(64, '0'), from: A, to: B, value: '1000000000000000001', timestamp: `2026-01-01T00:${String(n % 60).padStart(2, '0')}:00Z`, blockNumber: '1', status: 'success', ...overrides });
const evidence = (transactions, address = A) => ({ address, transactions, network: 'Ethereum Mainnet', dataSource: 'Test-only fixture', verifiedAt: '2026-01-02T00:00:00Z' });
test('every edge has actual observed evidence; unrelated, failed, unknown and missing data never create paths', () => {
  const rows = [tx(1), tx(2, { status: 'failed' }), tx(3, { status: 'unknown' }), tx(4, { to: null }), tx(5, { from: C, to: D }), tx(6, { value: '' }), tx(7, { value: '0' })];
  const graph = buildFundFlow([A, C], [evidence(rows.filter(t => t.from !== C))]);
  assert.equal(graph.edges.length, 1);
  assert.deepEqual(graph.edges[0].transactions.map(t => t.hash), [rows[0].hash]);
  assert.ok(graph.edges.every(edge => edge.transactions.every(t => rows.some(row => row.hash === t.hash && row.from === edge.from && row.to === edge.to))));
  assert.equal(buildFundFlow([A], [evidence([tx(5, { from: C, to: D })])]).edges.length, 0);
});
test('aggregation uses exact wei and deduplicates transactions observed by multiple case wallets', () => {
  const rows = [tx(1), tx(2), tx(3, { from: B, to: A, value: '7' })];
  const graph = buildFundFlow([A, B], [evidence(rows), evidence(rows, B)]);
  assert.equal(graph.retrieved, 3); assert.equal(graph.displayed, 3); assert.equal(graph.edges.length, 2);
  assert.equal(graph.edges.find(e => e.from === A).totalWei, 2000000000000000002n);
  assert.equal(graph.totalWei, 2000000000000000009n);
  assert.equal(graph.nodes.find(n => n.address === B).repeated, true);
});
test('unknown addresses stay unknown; only valid verified records expose identity', () => {
  const records = [{ id: 'test', address: B, network: 'ethereum', entityName: 'Test-only custodian', entityType: 'Custodian', status: 'VERIFIED', sourceName: 'Test source', verifiedAt: '2025-01-01T00:00:00Z' }];
  const graph = records => buildFundFlow([A], [evidence([tx(1)])], DEFAULT_FLOW_FILTERS, records);
  assert.equal(graph([]).verifiedEndpoints, 0);
  assert.ok(graph([]).nodes.every(n => n.attribution.status === 'UNATTRIBUTED / UNKNOWN' && n.attribution.record === null));
  assert.equal(graph(records).verifiedEndpoints, 1);
  for (const override of [{ status: 'POSSIBLE / UNVERIFIED' }, { verifiedAt: null }, { sourceName: '' }, { network: 'another network' }, { verifiedAt: '2999-01-01T00:00:00Z' }]) assert.equal(graph([{ ...records[0], ...override }]).verifiedEndpoints, 0);
});
test('fund splitting reuses existing wallet analysis and only marks supporting observed paths', () => {
  const rows = [tx(1), tx(2, { to: C }), tx(3, { to: D })];
  const expected = analyzeWalletTransactions(A, rows);
  assert.ok(expected.splittingAlarm);
  const graph = buildFundFlow([A], [evidence(rows)]);
  assert.deepEqual(graph.nodes.find(n => n.address === A).analysis.splittingAlarm, expected.splittingAlarm);
  assert.equal(graph.splittingSignals, 1);
  assert.ok(graph.edges.every(e => e.splitting && e.transactions.every(t => expected.splittingAlarm.transactionHashes.includes(t.hash))));
});
test('empty evidence and contradictory copies never create edges', () => {
  const empty = buildFundFlow([A], []);
  assert.deepEqual(empty.nodes, []); assert.deepEqual(empty.edges, []); assert.equal(empty.totalWei, 0n);
  const conflict = buildFundFlow([A, B], [evidence([tx(1)]), evidence([tx(1, { value: '2' })], B)]);
  assert.equal(conflict.conflicts, 1); assert.deepEqual(conflict.edges, []);
});
test('filters and bounds preserve evidence and exact minimums', () => {
  const rows = [tx(1), tx(2), tx(3, { from: B, to: A, value: '7' })];
  const graph = filters => buildFundFlow([A], [evidence(rows)], { ...DEFAULT_FLOW_FILTERS, ...filters });
  assert.equal(graph({ direction: 'incoming' }).totalWei, 7n);
  assert.equal(graph({ direction: 'outgoing' }).displayed, 2);
  assert.equal(graph({ minWei: 1000000000000000002n }).displayed, 0);
  assert.equal(graph({ repeatedOnly: true }).displayed, 2);
  assert.equal(graph({ splittingOnly: true }).displayed, 0);
  assert.equal(graph({ limit: 1 }).displayed, 1);
  const many = Array.from({ length: 150 }, (_, n) => tx(n + 1, { to: '0x' + (n + 1).toString(16).padStart(40, '0') }));
  const bounded = buildFundFlow([A], [evidence(many)], { ...DEFAULT_FLOW_FILTERS, limit: 10000 });
  assert.ok(bounded.nodes.length <= 24); assert.ok(bounded.displayed <= 100); assert.equal(bounded.retrieved, 150);
  assert.equal(parseMinimumEth('1.000000000000000001'), 1000000000000000001n);
  for (const invalid of ['-1', 'NaN', '1e3', '0.0000000000000000001']) assert.equal(parseMinimumEth(invalid), null);
});
