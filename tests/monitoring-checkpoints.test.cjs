const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { load } = require('./load-typescript.cjs');
const { provider, database } = require('./monitoring-fixture.cjs');
const { runWalletMonitor, seedMonitorTransactions } = load('src/lib/monitoring.ts');
const address = '0x' + 'a'.repeat(40), to = '0x' + 'b'.repeat(40);
const monitor = { id: '11111111-1111-4111-8111-111111111111', user_id: '22222222-2222-4222-8222-222222222222', address };
const transaction = (index, block = index) => ({ hash: '0x' + index.toString(16).padStart(64, '0'),
  blockNumber: String(block), timestamp: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  from: address, to, value: index === 4 ? '1000000000000000000000' : '100000000000000000', status: 'success' });

test('151 new transfers reach baseline checkpoint; qualifying transfer outside newest 100 creates alert', async t => {
  const history = Array.from({ length: 154 }, (_, i) => transaction(i + 1));
  const source = provider(t, history.slice(0, 3)); const db = database();
  await seedMonitorTransactions(db, monitor.id, address, monitor.user_id);
  source.setHistory(history);
  const result = await runWalletMonitor(db, monitor);
  assert.equal(result.error, undefined); assert.equal(result.newTransactionCount, 151);
  assert.equal(db.state.transactions.length, 154); assert.equal(db.state.cursor.confirmedBlock, 154);
  assert.ok(db.state.alerts.some(a => a.source_transaction_hash === transaction(4).hash && a.alert_type === 'unusual_movement'));
  assert.equal(db.state.last_successful_check_at, result.checkedAt);
  assert.equal(source.calls.length, 2); assert.equal(source.calls[0].from, 4);
  const replay = await runWalletMonitor(db, monitor);
  assert.equal(replay.newTransactionCount, 0); assert.equal(replay.newAlertCount, 0); assert.equal(replay.error, undefined);
});

test('interruption retains committed page progress, not complete success; retry recovers all rows', async t => {
  const source = provider(t, Array.from({ length: 151 }, (_, i) => transaction(i + 1)));
  source.failOnCall(2); const db = database();
  const interrupted = await runWalletMonitor(db, monitor);
  assert.match(interrupted.error, /interrupted/); assert.equal(interrupted.newTransactionCount, 100);
  assert.equal(db.state.cursor.confirmedBlock, 0); assert.equal(db.state.cursor.scanTo, 151);
  assert.equal(db.state.last_successful_check_at, null);
  const resumed = await runWalletMonitor(db, monitor);
  assert.equal(resumed.error, undefined); assert.equal(resumed.newTransactionCount, 51);
  assert.equal(db.state.transactions.length, 151); assert.equal(db.state.alerts.length, 1);
  assert.equal(db.state.cursor.confirmedBlock, 151);
});

test('bounded catch-up pins upper range while newer blocks arrive and eventually processes both ranges', async t => {
  const source = provider(t, Array.from({ length: 450 }, (_, i) => transaction(i + 1)));
  const db = database();
  const first = await runWalletMonitor(db, monitor);
  assert.match(first.error, /incomplete/); assert.equal(source.calls.length, 2);
  assert.equal(db.state.cursor.scanTo, 450); assert.equal(db.state.cursor.confirmedBlock, 0);
  source.setHistory(Array.from({ length: 470 }, (_, i) => transaction(i + 1)));
  let result;
  for (let i = 0; i < 5; i++) { result = await runWalletMonitor(db, monitor); if (!result.error) break; }
  assert.equal(result.error, undefined); assert.equal(db.state.cursor.confirmedBlock, 450);
  assert.equal(db.state.transactions.length, 450);
  assert.ok(source.calls.every(call => call.to === 450));
  assert.equal((await runWalletMonitor(db, monitor)).error, undefined);
  assert.equal(db.state.cursor.confirmedBlock, 470); assert.equal(db.state.transactions.length, 470);
});

test('more than one page within the same block resumes without dropping same-block transfers', async t => {
  const source = provider(t, Array.from({ length: 250 }, (_, i) => transaction(i + 1, 1)));
  const db = database();
  assert.match((await runWalletMonitor(db, monitor)).error, /incomplete/);
  assert.equal(db.state.cursor.nextPage, 3); assert.equal(db.state.transactions.length, 200);
  assert.equal((await runWalletMonitor(db, monitor)).error, undefined);
  assert.equal(db.state.transactions.length, 250); assert.equal(db.state.cursor.confirmedBlock, 1);
  assert.deepEqual(source.calls.map(call => call.page), [1, 2, 3]);
});

test('checkpoint failure rolls back STAB-01 evidence; retry and stale replay are safe', async t => {
  provider(t, Array.from({ length: 151 }, (_, i) => transaction(i + 1)));
  const db = database(); db.failAt('cursor');
  assert.match((await runWalletMonitor(db, monitor)).error, /atomically/);
  assert.equal(db.state.transactions.length, 0); assert.equal(db.state.alerts.length, 0);
  assert.equal(db.state.cursor.revision, 0);
  const stale = db.calls[0];
  assert.equal((await runWalletMonitor(db, monitor)).error, undefined);
  const committed = db.state;
  assert.ok((await db.rpc('persist_wallet_monitor_page', stale)).error);
  assert.deepEqual(db.state, committed);
});

test('baseline suppression initializes from stored history, never from the current provider head', async t => {
  const source = provider(t, Array.from({ length: 4 }, (_, i) => transaction(i + 1)));
  const db = database(); await seedMonitorTransactions(db, monitor.id, address, monitor.user_id);
  source.setHistory(Array.from({ length: 105 }, (_, i) => transaction(i + 1)));
  const result = await runWalletMonitor(db, monitor);
  assert.equal(result.error, undefined); assert.equal(result.newTransactionCount, 101);
  assert.equal(db.state.alerts.length, 0, 'qualifying baseline transaction cannot create a retrospective alert');
  assert.ok(db.state.transactions.slice(0, 4).every(row => row.analysis === null));
});

test('provider behind checkpoint fails instead of regressing the confirmed boundary', async t => {
  const source = provider(t, [transaction(10)]); const db = database();
  await seedMonitorTransactions(db, monitor.id, address, monitor.user_id);
  source.setHistory([transaction(9)]);
  assert.match((await runWalletMonitor(db, monitor)).error, /behind/);
  assert.equal(db.state.cursor.confirmedBlock, 10); assert.equal(db.calls.length, 0);
});

test('expired retrieval budget fails incomplete without advancing progress', async t => {
  provider(t, [transaction(1)]); const db = database();
  assert.match((await runWalletMonitor(db, monitor, Date.now() - 1)).error, /incomplete/);
  assert.equal(db.state.cursor.confirmedBlock, 0); assert.equal(db.calls.length, 0);
});

test('monitoring provider uses fixed ascending ranges and rejects malformed pages instead of exhaustion', async () => {
  let payload, requested;
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/etherscan.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module, exports: module.exports,
    require: () => load('src/lib/ethereum-address.ts'),
    process: { env: { ETHERSCAN_API_KEY: 'isolated-fixture' } }, URL, AbortController, setTimeout, clearTimeout,
    fetch: async url => { requested = url; return { ok: true, headers: { get: () => 'application/json' }, json: async () => payload }; },
  });
  const api = module.exports;
  const row = { hash: transaction(1).hash, blockNumber: '20', from: address, to, value: '100', timeStamp: '1700000000', isError: '0' };
  payload = { status: '1', result: [row] };
  assert.equal((await api.fetchMonitoringPage(address, 10, 30, 2)).length, 1);
  for (const [key, value] of Object.entries({ startblock: '10', endblock: '30', page: '2', offset: '100', sort: 'asc' })) assert.equal(requested.searchParams.get(key), value);
  for (const invalid of [{}, [{ ...row, hash: '' }], [{ ...row, blockNumber: '31' }], [row, row]]) {
    payload = { status: '1', result: invalid };
    await assert.rejects(api.fetchMonitoringPage(address, 10, 30, 1));
  }
  payload = { status: '0', message: 'No transactions found', result: [] };
  assert.equal((await api.fetchMonitoringPage(address, 10, 30, 1)).length, 0);
});

test('checkpoint migration preserves atomic wrapper, service-only access, revision checks and incomplete status', () => {
  const sql = fs.readFileSync('supabase-monitoring-checkpoints.sql', 'utf8');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public.wallet_monitor_cursors from public, anon, authenticated, service_role/);
  assert.match(sql, /p_expected_revision is distinct from/);
  assert.match(sql, /result := public.persist_wallet_monitor_check/);
  assert.match(sql, /last_successful_check_at = previous_success/);
  assert.match(sql, /confirmed_block = p_scan_to/);
  assert.match(sql, /raise exception 'Monitoring range ended before its witnessed head'/);
  assert.match(sql, /last_block > p_scan_from then 1 else p_page \+ 1/);
  assert.doesNotMatch(sql, /exception\s+when|security definer|create policy/i);
});

test('short or empty history before the pinned head fails closed and retries safely', async t => {
  provider(t, Array.from({ length: 151 }, (_, i) => transaction(i + 1)));
  const etherscan = load('src/lib/etherscan.ts');
  const realPage = etherscan.fetchMonitoringPage;
  for (const shortened of [[], [transaction(1)]]) {
    const db = database();
    etherscan.fetchMonitoringPage = async () => shortened;
    assert.match((await runWalletMonitor(db, monitor)).error, /incomplete/);
    assert.equal(db.state.cursor.confirmedBlock, 0);
    assert.equal(db.state.last_successful_check_at, null);
    assert.equal(db.state.transactions.length, 0);
    etherscan.fetchMonitoringPage = realPage;
    assert.equal((await runWalletMonitor(db, monitor)).error, undefined);
    assert.equal(db.state.transactions.length, 151);
  }
});

test('later-page unusual movement and splitting across the page edge are retained', async t => {
  const history = Array.from({ length: 151 }, (_, i) => ({ ...transaction(i + 1), value: '100000000000000000' }));
  history[149].value = '1000000000000000000000';
  for (let i = 98; i < 103; i++) history[i].to = '0x' + String(i - 97).repeat(40);
  provider(t, history); const db = database();
  assert.equal((await runWalletMonitor(db, monitor)).error, undefined);
  assert.ok(db.state.alerts.some(a => a.alert_type === 'unusual_movement' && a.source_transaction_hash === history[149].hash));
  assert.ok(db.state.alerts.some(a => a.alert_type === 'fund_splitting'));
  const before = db.state.alerts;
  assert.equal((await runWalletMonitor(db, monitor)).newAlertCount, 0);
  assert.deepEqual(db.state.alerts, before);
});

test('a full final block page needs an exhaustion request and preserves previous success meanwhile', async t => {
  const source = provider(t, [transaction(1)]); const db = database();
  assert.equal((await runWalletMonitor(db, monitor)).error, undefined);
  const previousSuccess = db.state.last_successful_check_at;
  source.setHistory([transaction(1), ...Array.from({ length: 200 }, (_, i) => transaction(i + 2, 2))]);
  const partial = await runWalletMonitor(db, monitor);
  assert.match(partial.error, /incomplete/);
  assert.equal(db.state.cursor.confirmedBlock, 1);
  assert.equal(db.state.last_successful_check_at, previousSuccess);
  const retry = await runWalletMonitor(db, monitor);
  assert.equal(retry.error, undefined);
  assert.equal(retry.newTransactionCount, 0);
  assert.equal(db.state.cursor.confirmedBlock, 2);
  assert.equal(db.state.transactions.length, 201);
});
