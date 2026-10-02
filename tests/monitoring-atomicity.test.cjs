const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const { load } = require('./load-typescript.cjs');

const etherscan = load('src/lib/etherscan.ts');
const { runWalletMonitor, seedMonitorTransactions } = load('src/lib/monitoring.ts');
const ETH = 10n ** 18n;
const address = '0x' + 'a'.repeat(40);
const recipient = '0x' + 'b'.repeat(40);
const monitor = { id: '11111111-1111-4111-8111-111111111111', user_id: '22222222-2222-4222-8222-222222222222', address };
const transfer = (index, value, to = recipient) => ({
  hash: '0x' + index.toString(16).padStart(64, '0'), from: address, to,
  value: String(value), blockNumber: '1', timestamp: '2026-01-01T00:00:00.000Z', status: 'success',
});
const movement = () => [transfer(1, ETH / 10n), transfer(2, ETH / 10n), transfer(3, ETH / 10n), transfer(4, ETH + 1n)];

const { provider, database } = require('./monitoring-fixture.cjs');

for (const stage of ['transactions', 'alerts', 'status']) {
  test(`atomic monitor rolls back at ${stage}, retries all evidence, and deduplicates replay`, async t => {
    provider(t, movement());
    const db = database(); db.failAt(stage);
    const failed = await runWalletMonitor(db, monitor);
    assert.match(failed.error, /atomically/);
    assert.equal(failed.newTransactionCount, 0); assert.equal(failed.newAlertCount, 0);
    assert.deepEqual(db.state.transactions, []); assert.deepEqual(db.state.alerts, []);
    assert.equal(db.state.last_successful_check_at, null); assert.ok(db.state.last_error);
    const retry = await runWalletMonitor(db, monitor);
    assert.equal(retry.error, undefined); assert.equal(retry.newTransactionCount, 4); assert.equal(retry.newAlertCount, 1);
    assert.equal(db.state.transactions.length, 4); assert.equal(db.state.alerts.length, 1);
    assert.ok(db.state.transactions.every(row => row.analysis.successfulTransactionCount === 4));
    assert.equal(db.state.transactions[3].value_wei, '1000000000000000001');
    assert.equal(db.state.alerts[0].alert_type, 'unusual_movement');
    assert.equal(db.state.alerts[0].source_transaction_hash, movement()[3].hash);
    assert.equal(db.state.last_successful_check_at, retry.checkedAt); assert.equal(db.state.last_error, null);
    const replay = await runWalletMonitor(db, monitor);
    assert.equal(replay.error, undefined); assert.equal(replay.newTransactionCount, 0); assert.equal(replay.newAlertCount, 0);
    assert.equal(db.state.transactions.length, 4); assert.equal(db.state.alerts.length, 1);
  });
}

test('committed check with lost response retries without duplicate transactions or alerts', async t => {
  provider(t, movement()); const db = database(); db.failAt('response');
  assert.ok((await runWalletMonitor(db, monitor)).error);
  assert.equal(db.state.transactions.length, 4); assert.equal(db.state.alerts.length, 1);
  const retry = await runWalletMonitor(db, monitor);
  assert.equal(retry.error, undefined); assert.equal(retry.newTransactionCount, 0); assert.equal(retry.newAlertCount, 0);
  assert.equal(db.state.transactions.length, 4); assert.equal(db.state.alerts.length, 1);
});

test('seeded qualifying history remains baseline: no retroactive alerts or analysis overwrites', async t => {
  provider(t, movement()); const db = database();
  assert.equal(await seedMonitorTransactions(db, monitor.id, address, monitor.user_id), 4);
  const checked = await runWalletMonitor(db, monitor);
  assert.equal(checked.error, undefined); assert.equal(checked.newTransactionCount, 0); assert.equal(checked.newAlertCount, 0);
  assert.equal(db.calls[0].p_alerts.length, 0, 'baseline lies at or below the initial checkpoint');
  assert.ok(db.state.transactions.every(row => row.analysis === null));
  assert.deepEqual(db.state.alerts, []);
});

test('fund splitting retries preserve existing detector result and deduplicate', async t => {
  const transactions = Array.from({ length: 5 }, (_, i) => transfer(i + 1, ETH, '0x' + String(i + 1).repeat(40)));
  provider(t, transactions); const db = database(); db.failAt('alerts');
  assert.ok((await runWalletMonitor(db, monitor)).error);
  const retry = await runWalletMonitor(db, monitor);
  assert.equal(retry.error, undefined); assert.equal(retry.newAlertCount, 1);
  assert.equal(db.state.alerts[0].alert_type, 'fund_splitting');
  assert.equal(db.state.alerts[0].details.totalWei, String(5n * ETH));
  assert.equal((await runWalletMonitor(db, monitor)).newAlertCount, 0);
});

test('empty and nonqualifying checks persist success without fabricating alerts', async t => {
  provider(t, []); const empty = database();
  const result = await runWalletMonitor(empty, monitor);
  assert.equal(result.error, undefined); assert.equal(result.newTransactionCount, 0); assert.equal(result.newAlertCount, 0);
  assert.equal(empty.state.last_successful_check_at, result.checkedAt);
  etherscan.fetchMonitoringHeadBlock = async () => 1;
  etherscan.fetchMonitoringPage = async () => [transfer(1, ETH)];
  const quiet = database(); const checked = await runWalletMonitor(quiet, monitor);
  assert.equal(checked.error, undefined); assert.equal(checked.newTransactionCount, 1); assert.equal(checked.newAlertCount, 0);
  assert.deepEqual(quiet.state.alerts, []);
});

test('missing RPC fails closed without separate persistence fallback', async t => {
  provider(t, movement()); const db = database(); db.failAt('missing-rpc');
  const result = await runWalletMonitor(db, monitor);
  assert.match(result.error, /migration/);
  assert.deepEqual(db.state.transactions, []); assert.deepEqual(db.state.alerts, []);
  assert.equal(db.state.last_successful_check_at, null);
});

test('migration restricts execution and retains one transactional persistence boundary', () => {
  const sql = fs.readFileSync('supabase-monitoring-atomicity.sql', 'utf8').replace(/--[^\n]*/g, '');
  assert.match(sql, /language plpgsql security invoker set search_path = ''/);
  assert.match(sql, /revoke all on function[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(sql, /grant execute on function[\s\S]*to service_role/);
  assert.match(sql, /id = p_monitor_id and user_id = p_user_id and address = p_address[\s\S]*and is_active\s+for update/);
  assert.match(sql, /on conflict \(monitor_id, transaction_hash\) do nothing\s+returning transaction_hash/);
  assert.match(sql, /where a.source_transaction_hash = any\(inserted_hashes\)/);
  assert.match(sql, /on conflict \(monitor_id, source_transaction_hash, alert_type\) do nothing/);
  assert.match(sql, /t\.status, p_analysis/);
  assert.ok(sql.indexOf('insert into public.monitor_alerts') < sql.indexOf('last_successful_check_at = p_checked_at'));
  assert.doesNotMatch(sql, /exception\s+when|security definer|create policy|alter table|delete from/i);
  assert.equal((sql.match(/commit;/gi) || []).length, 1, 'only the migration commits; function cannot partially commit');
});
