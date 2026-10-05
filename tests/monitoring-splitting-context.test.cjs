const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./load-typescript.cjs');
const { provider, database } = require('./monitoring-fixture.cjs');
const { runWalletMonitor, seedMonitorTransactions } = load('src/lib/monitoring.ts');
const { fetchMonitoringSplittingContext } = load('src/lib/monitoring-splitting-context.ts');
const { analyzeWalletTransactions } = load('src/lib/wallet-analysis.ts');
const address = '0x' + 'a'.repeat(40), other = i => '0x' + i.toString(16).padStart(40, '0');
const monitor = { id: '11111111-1111-4111-8111-111111111111', user_id: '22222222-2222-4222-8222-222222222222', address };
const tx = i => ({ hash: '0x' + i.toString(16).padStart(64, '0'), blockNumber: String(i),
  timestamp: new Date(Date.UTC(2026, 0, 1) + i * 12000).toISOString(),
  from: address, to: other(i), value: '1000000000000000000', status: 'success' });
const prefix = () => Array.from({ length: 101 }, (_, index) => {
  const row = tx(index + 1);
  return index < 2 ? row : { ...row, from: other(index + 1), to: address };
});
async function setup(t, rows = prefix(), options = {}) {
  const source = provider(t, []), db = database(options);
  await seedMonitorTransactions(db, null, address, monitor.user_id);
  source.setHistory(rows);
  for (let i = 0; i < 10; i++) {
    const result = await runWalletMonitor(db, monitor);
    if (!result.error) return { source, db };
    assert.match(result.error, /Saved progress will resume/);
  }
  assert.fail('fixture failed to complete catch-up');
}
function assertSplit(db, hashes = [1, 2, 102]) {
  const alerts = db.state.alerts.filter(row => row.alert_type === 'fund_splitting');
  assert.equal(alerts.length, 1);
  assert.deepEqual(alerts[0].details.transactionHashes, hashes.map(i => tx(i).hash));
  assert.deepEqual(alerts[0].details.analysis.splittingAlarm.transactionHashes, hashes.map(i => tx(i).hash));
  assert.equal(alerts[0].source_transaction_hash, tx(hashes.at(-1)).hash);
  return alerts[0];
}

test('AUD-H04: 99 incoming rows cannot evict the two outgoing hashes needed by tx 102', async t => {
  const { source, db } = await setup(t);
  assert.equal(db.state.transactions.length, 101);
  assert.equal(db.state.cursor.confirmedBlock, 101);
  assert.equal(db.state.alerts.length, 0);
  const before = db.contextCalls.length;
  source.setHistory([...prefix(), tx(102)]);
  const result = await runWalletMonitor(db, monitor);
  assert.equal(result.error, undefined); assert.equal(result.newAlertCount, 1);
  assert.equal(db.state.transactions.length, 102);
  assert.equal(db.state.cursor.confirmedBlock, 102);
  assert.equal(assertSplit(db).details.totalWei, '3000000000000000000');
  assert.equal(db.contextCalls.length - before, 1, 'incoming rows are filtered in the database');
  assert.equal((await runWalletMonitor(db, monitor)).newAlertCount, 0);
  assertSplit(db);
});

for (const cap of [100, 17, 1]) {
  test(`AUD-H04: complete keyset pagination with persisted context page cap ${cap}`, async t => {
    const rows = Array.from({ length: 205 }, (_, i) => ({ ...tx(i + 1), to: other(1) }));
    const { source, db } = await setup(t, rows, { contextPageCap: cap });
    const before = db.contextCalls.length;
    source.setHistory([...rows, { ...tx(206), to: other(2) }, { ...tx(207), to: other(3) }]);
    const result = await runWalletMonitor(db, monitor);
    assert.equal(result.error, undefined); assert.equal(result.newAlertCount, 1);
    assert.equal(db.contextCalls.length - before, Math.ceil(205 / cap));
    assertSplit(db, Array.from({ length: 207 }, (_, i) => i + 1));
    assert.equal(db.state.transactions.length, 207);
    assert.equal((await runWalletMonitor(db, monitor)).newAlertCount, 0);
  });
}

test('AUD-H04: later context-page failure preserves checkpoint and retry recovers the split exactly once', async t => {
  const options = { contextPageCap: 1 };
  const { source, db } = await setup(t, prefix(), options);
  const before = db.state;
  options.failContextPage = db.contextCalls.length + 2;
  source.setHistory([...prefix(), tx(102)]);
  const result = await runWalletMonitor(db, monitor);
  assert.match(result.error, /splitting context is incomplete/);
  assert.deepEqual(db.state.cursor, before.cursor);
  assert.deepEqual(db.state.transactions, before.transactions);
  assert.equal(db.state.last_successful_check_at, before.last_successful_check_at);
  assert.equal(db.state.alerts.length, 0);
  assert.equal((await runWalletMonitor(db, monitor)).newAlertCount, 1);
  assertSplit(db);
  assert.equal((await runWalletMonitor(db, monitor)).newAlertCount, 0);
});

for (const [name, mutate] of Object.entries({
  missingCount: result => ({ ...result, count: null }),
  earlyEmpty: result => ({ ...result, data: [] }),
  malformedAmount: result => ({ ...result, data: result.data.map(row => ({ ...row, value_wei: 'bad' })) }),
  missingAmount: result => ({ ...result, data: result.data.map(row => ({ ...row, value_wei: undefined })) }),
  roundedNumber: result => ({ ...result, data: result.data.map(row => ({ ...row, value_wei: 1e18 })) }),
  wrongMonitor: result => ({ ...result, data: result.data.map(row => ({ ...row, monitor_id: 'other' })) }),
  duplicateHash: result => ({ ...result, data: [result.data[0], result.data[0]] }),
})) {
  test(`AUD-H04: ${name} context fails closed before persistence`, async t => {
    const options = {}, { source, db } = await setup(t, prefix(), options);
    const before = db.state;
    options.contextResponse = mutate;
    source.setHistory([...prefix(), tx(102)]);
    assert.match((await runWalletMonitor(db, monitor)).error, /splitting context is incomplete/);
    assert.deepEqual(db.state.cursor, before.cursor);
    assert.deepEqual(db.state.transactions, before.transactions);
    assert.equal(db.state.last_successful_check_at, before.last_successful_check_at);
    assert.equal(db.state.alerts.length, 0);
  });
}

test('AUD-H04: changed remaining count on a later context page fails closed', async t => {
  const options = { contextPageCap: 1 }, { source, db } = await setup(t, prefix(), options);
  const before = db.state, fail = db.contextCalls.length + 2;
  options.contextResponse = (result, call) => call === fail ? { ...result, count: result.count + 1 } : result;
  source.setHistory([...prefix(), tx(102)]);
  assert.match((await runWalletMonitor(db, monitor)).error, /splitting context is incomplete/);
  assert.deepEqual(db.state.cursor, before.cursor);
  assert.equal(db.state.transactions.length, 101);
});

test('AUD-H04: a zero database cap cannot masquerade as context exhaustion', async t => {
  const options = {}, { source, db } = await setup(t, prefix(), options);
  options.contextPageCap = 0;
  source.setHistory([...prefix(), tx(102)]);
  assert.match((await runWalletMonitor(db, monitor)).error, /splitting context is incomplete/);
  assert.equal(db.state.cursor.confirmedBlock, 101);
});

test('AUD-H04: inclusive 24-hour boundary, exact wei, and eligibility filters are preserved', async t => {
  const trigger = { ...tx(20), timestamp: '2026-01-02T00:00:00.000Z' };
  const rows = [
    { ...tx(1), timestamp: '2026-01-01T00:00:00.000Z', value: '1000000000000000001' },
    { ...tx(2), timestamp: '2025-12-31T23:59:59.999Z' },
    { ...tx(3), value: '0' }, { ...tx(4), status: 'failed' }, { ...tx(5), status: 'unknown' },
    { ...tx(6), to: address }, { ...tx(7), to: null }, { ...tx(8), timestamp: null },
    { ...tx(9), from: other(9), to: address }, { ...tx(10), from: other(10) },
    { ...tx(11), timestamp: '2026-01-02T00:00:00.001Z' },
  ];
  const source = provider(t, rows), db = database();
  await seedMonitorTransactions(db, null, address, monitor.user_id);
  const evidence = await fetchMonitoringSplittingContext(db, monitor.id, address,
    analyzeWalletTransactions(address, [trigger]).outgoingTransactions, Date.now() + 25000);
  assert.deepEqual(evidence.map(row => row.hash), [tx(1).hash]);
  assert.equal(evidence[0].value, '1000000000000000001');
  assert.equal(evidence[0].valueWei, 1000000000000000001n);
  assert.equal(db.state.transactions.find(row => row.transaction_hash === tx(3).hash).value_wei, '0');
});

test('AUD-H04: exhausted context budget fails rather than returning partial evidence', async t => {
  const { db } = await setup(t);
  await assert.rejects(fetchMonitoringSplittingContext(db, monitor.id, address,
    analyzeWalletTransactions(address, [tx(102)]).outgoingTransactions, Date.now() - 1), /splitting context is incomplete/);
  assert.equal(db.state.cursor.confirmedBlock, 101);
});

test('AUD-H04: baseline-only split remains suppressed when only incoming activity arrives', async t => {
  const baseline = [tx(1), tx(2), tx(3)];
  const source = provider(t, baseline), db = database();
  await seedMonitorTransactions(db, null, address, monitor.user_id);
  source.setHistory([...baseline, { ...tx(4), from: other(4), to: address }]);
  const result = await runWalletMonitor(db, monitor);
  assert.equal(result.error, undefined); assert.equal(result.newAlertCount, 0);
  assert.equal(db.state.alerts.length, 0);
  assert.equal(db.state.cursor.confirmedBlock, 4);
});

test('AUD-H04: actual Supabase query preserves numeric text, scope, and short-page keyset continuation', async () => {
  const { createClient } = require('@supabase/supabase-js');
  const requests = [];
  const admin = createClient('https://fixture.invalid', 'fixture-only', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url, init) => {
      const query = new URL(url).searchParams;
      requests.push(query);
      assert.equal(query.get('monitor_id'), 'eq.' + monitor.id);
      assert.equal(query.get('from_address'), 'eq.' + address);
      assert.equal(query.get('status'), 'eq.success');
      assert.equal(query.get('to_address'), 'neq.' + address);
      assert.equal(query.get('value_wei'), 'gt.0');
      assert.equal(query.get('order'), 'transaction_hash.asc');
      assert.equal(query.get('limit'), '100');
      assert.match(query.get('select'), /value_wei::text/);
      assert.match(new Headers(init.headers).get('prefer'), /count=exact/);
      assert.equal(query.get('transaction_hash'), requests.length === 1 ? null : 'gt.' + tx(1).hash);
      const row = tx(requests.length);
      return new Response(JSON.stringify([{ monitor_id: monitor.id, transaction_hash: row.hash,
        from_address: row.from, to_address: row.to, value_wei: row.value,
        block_number: row.blockNumber, occurred_at: row.timestamp, status: row.status }]),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': `0-0/${requests.length === 1 ? 2 : 1}` } });
    } },
  });
  const evidence = await fetchMonitoringSplittingContext(admin, monitor.id, address,
    analyzeWalletTransactions(address, [tx(102)]).outgoingTransactions, Date.now() + 25000);
  assert.equal(requests.length, 2);
  assert.deepEqual(evidence.map(row => row.hash), [tx(1).hash, tx(2).hash]);
});
