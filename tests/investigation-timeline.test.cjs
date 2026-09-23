const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./load-typescript.cjs');
const { buildInvestigationTimeline: build, orderTimeline, linkedReportIds } = load('src/lib/investigation-timeline.ts');
// Synthetic fixtures are confined to tests; production loads authenticated evidence only.
const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40), C = '0x' + 'c'.repeat(40), D = '0x' + 'd'.repeat(40);
const record = { id: 'case-1', case_code: 'CASE-1', title: 'Test case', description: '', created_at: '2026-01-02T00:00:00Z', wallets: [{ id: 'wallet-1', address: A, network: 'ethereum', added_at: '2026-01-03T00:00:00Z' }] };
const tx = (n, overrides = {}) => ({ hash: '0x' + n.toString(16).padStart(64, '0'), from: A, to: B, value: '1000000000000000001', timestamp: `2026-01-01T00:${String(n).padStart(2, '0')}:00Z`, status: 'success', blockNumber: String(n), ...overrides });
const evidence = (transactions, address = A) => ({ address, transactions, network: 'Ethereum Mainnet', dataSource: 'Test fixture', verifiedAt: '2026-02-01T00:00:00Z' });
const timeline = (rows, extra = {}, records) => build({ record, wallets: [evidence(rows)], ...extra }, records);
const transfers = result => result.events.filter(event => event.category === 'Transfers');

test('orders actual timestamps in both directions without mutating evidence', () => {
  const result = timeline([tx(3), tx(1), tx(2)]);
  const before = result.events.map(event => event.id);
  for (const order of ['oldest', 'newest']) {
    const dates = orderTimeline(result.events, order).dated.map(event => Date.parse(event.timestamp));
    assert.deepEqual(dates, [...dates].sort((a, b) => order === 'oldest' ? a - b : b - a));
  }
  assert.deepEqual(result.events.map(event => event.id), before);
});
test('creates incoming/outgoing events with exact transaction and provenance', () => {
  const rows = [tx(1), tx(2, { from: B, to: A })];
  const events = transfers(timeline(rows));
  assert.deepEqual(events.map(event => event.type), ['Observed Outgoing Transfer', 'Observed Incoming Transfer']);
  assert.equal(events[0].valueWei, rows[0].value);
  assert.deepEqual(events[0].details.observations[0].transaction, rows[0]);
  assert.equal(events[0].source, 'Test fixture');
  assert.equal(orderTimeline(timeline(rows).events, 'oldest', 'Transfers').dated.length, 2);
});
test('fund splitting reuses three-destination evidence and hashes', () => {
  const rows = [tx(1), tx(2, { to: C }), tx(3, { to: D })];
  const alarm = timeline(rows).events.find(event => event.type === 'Fund Splitting Signal');
  assert.ok(alarm);
  assert.deepEqual(alarm.hashes, rows.map(row => row.hash));
  assert.equal(alarm.timestamp, rows[2].timestamp);
  assert.equal(alarm.details.evidence.length, 3);
  assert.equal(timeline(rows.map(row => ({ ...row, timestamp: null }))).events.some(event => event.type === 'Fund Splitting Signal'), false);
});
test('unknown remains unknown; only source-backed verified attribution creates an endpoint', () => {
  assert.ok(timeline([tx(1)]).attributions.every(endpoint => endpoint.status === 'UNATTRIBUTED / UNKNOWN'));
  const verified = { id: 'test', network: 'ethereum', address: B, entityName: 'Test custodian', entityType: 'Custodian', status: 'VERIFIED', sourceName: 'Test reviewed source', verifiedAt: '2025-01-01T00:00:00Z' };
  const endpoints = records => timeline([tx(1)], {}, records).events.filter(event => event.type === 'Verified Custodial Endpoint');
  assert.equal(endpoints([verified]).length, 1);
  assert.equal(endpoints([verified])[0].timestamp, verified.verifiedAt);
  for (const override of [{ status: 'POSSIBLE / UNVERIFIED' }, { sourceName: '' }, { verifiedAt: null }, { verifiedAt: '2999-01-01T00:00:00Z' }, { network: 'other' }]) assert.equal(endpoints([{ ...verified, ...override }]).length, 0);
});
test('duplicate observations create one blockchain event; conflicting copies are excluded', () => {
  const input = { record: { ...record, wallets: [...record.wallets, { id: 'wallet-2', address: B, network: 'ethereum' }] }, wallets: [evidence([tx(1)]), evidence([tx(1)], B)] };
  assert.equal(transfers(build(input)).length, 1);
  assert.equal(transfers(build(input))[0].details.observations.length, 2);
  input.wallets[1].transactions[0].value = '2';
  assert.equal(transfers(build(input)).length, 0);
  assert.match(build(input).warnings.join(' '), /1 conflicting transaction hashes/);
});
test('missing/invalid/date-only timestamps stay undated, never using retrieval time', () => {
  const result = timeline([tx(1, { timestamp: null }), tx(2, { timestamp: 'bad' }), tx(3, { timestamp: '2026-01-01' })]);
  const ordered = orderTimeline(result.events, 'newest', 'Transfers');
  assert.equal(ordered.dated.length, 0);
  assert.equal(ordered.undated.length, 3);
  assert.ok(ordered.undated.every(event => event.timestamp === null));
});
test('one available timestamp can enrich duplicate evidence without fabricating a time', () => {
  const result = build({ record, wallets: [evidence([tx(1, { timestamp: null }), tx(1)])] });
  assert.equal(transfers(result).length, 1);
  assert.equal(transfers(result)[0].timestamp, tx(1).timestamp);
});
test('failed, unknown, malformed, unrelated and other-network evidence cannot imply fund movement', () => {
  const rows = [tx(1, { status: 'failed' }), tx(2, { status: 'unknown' }), tx(3, { value: '0' }), tx(4, { to: null }), tx(5, { from: C, to: D }), tx(6, { value: 'invalid' })];
  assert.equal(transfers(timeline(rows)).length, 0);
  assert.equal(transfers(timeline([], { wallets: [{ ...evidence([tx(1)]), network: 'other' }] })).length, 0);
});
test('victim report requires explicit reference; submission is separate from allegation date', () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  const report = { id, suspect_wallet: A, incident_type: 'Phishing', incident_date: '2025-12-01', created_at: '2026-01-01T00:00:00Z', approximate_loss: '3', loss_currency: 'ETH', transaction_hash: tx(1).hash };
  assert.equal(timeline([], { reports: [report] }).events.some(event => event.type === 'Victim Report'), false);
  const linked = { ...record, description: `Source intake report: ${id}` };
  assert.deepEqual(linkedReportIds(linked), [id]);
  const event = timeline([], { record: linked, reports: [report] }).events.find(event => event.type === 'Victim Report');
  assert.equal(event.timestamp, report.created_at);
  assert.match(event.description, /Victim-provided allegation/);
});
test('repeated destinations are undated aggregates with distinct supporting hashes', () => {
  const result = timeline([tx(1), tx(1), tx(2)]);
  const repeated = result.events.find(event => event.type === 'Repeated Destination Signal');
  assert.equal(repeated.timestamp, null);
  assert.equal(repeated.hashes.length, 2);
  assert.equal(result.transferCount, 2);
});
test('direct case-wallet connections reference the single canonical transfer', () => {
  const result = timeline([tx(1)], { record: { ...record, wallets: [...record.wallets, { id: 'wallet-2', address: B, network: 'ethereum' }] } });
  const connections = orderTimeline(result.events, 'oldest', 'Connections');
  assert.equal(transfers(result).length, 1);
  assert.equal(connections.undated.length, 1);
  assert.deepEqual(connections.undated[0].hashes, [tx(1).hash]);
});
test('shared-counterparty analysis retains provenance and does not reuse generatedAt as event time', () => {
  const caseRecord = { ...record, wallets: [...record.wallets, { id: 'wallet-2', address: B, network: 'ethereum' }] };
  const connections = { caseA: { id: record.id }, caseB: { id: record.id }, source: 'Test analysis source', generatedAt: '2026-02-01T00:00:00Z', limitations: ['Test coverage limit'], sharedCounterparties: [{ address: C, caseAWallets: [A], caseBWallets: [B], caseATransactions: [tx(1, { to: C })], caseBTransactions: [tx(2, { from: B, to: C })] }] };
  const result = timeline([], { record: caseRecord, connections });
  const event = result.events.find(event => event.type === 'Cross-Wallet Connection');
  assert.equal(event.timestamp, null);
  assert.equal(event.details.analysisGeneratedAt, connections.generatedAt);
  assert.equal(event.source, connections.source);
  assert.deepEqual(result.warnings, connections.limitations);
  assert.equal(timeline([], { record: caseRecord, connections: { ...connections, caseA: { id: 'unrelated' } } }).events.some(event => event.type === 'Cross-Wallet Connection'), false);
});
