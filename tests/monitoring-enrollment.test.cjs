const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const { load } = require('./load-typescript.cjs');
const { provider, database } = require('./monitoring-fixture.cjs');
const { seedMonitorTransactions, runWalletMonitor } = load('src/lib/monitoring.ts');
const address = '0x' + 'a'.repeat(40), to = '0x' + 'b'.repeat(40);
const monitor = { id: '11111111-1111-4111-8111-111111111111', user_id: '22222222-2222-4222-8222-222222222222',
  address, network: 'ethereum', is_active: false, updated_at: '2026-01-01T00:00:00.000Z' };
const tx = n => ({ hash: '0x' + n.toString(16).padStart(64, '0'), from: address, to, blockNumber: String(n),
  timestamp: '2026-01-01T00:00:00.000Z', status: 'success', value: n === 4 ? '1000000000000000000000' : '100000000000000000' });
const baseline = [tx(1), tx(2), tx(3)];
function route(t, db, user = { id: monitor.user_id }) {
  const auth = load('src/lib/request-auth.ts'), admin = load('src/lib/supabase-admin.ts');
  const originals = [auth.getRequestUser, admin.getSupabaseAdmin];
  auth.getRequestUser = async () => user;
  admin.getSupabaseAdmin = () => db;
  t.after(() => { [auth.getRequestUser, admin.getSupabaseAdmin] = originals; });
  const { POST } = load('src/app/api/monitors/route.ts');
  return () => POST(new Request('http://localhost/api/monitors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, user_id: 'spoofed-owner' }) }));
}

test('first enrollment creates baseline, cursor and activation together; qualifying history stays suppressed', async t => {
  provider(t, [...baseline, tx(4)]); const db = database(); const post = route(t, db);
  const response = await post(), body = await response.json();
  assert.equal(response.status, 201); assert.equal(body.created, true);
  assert.equal(body.baselineTransactionCount, 4); assert.equal(body.monitor.is_active, true);
  assert.equal(body.monitor.user_id, monitor.user_id);
  assert.equal(db.state.cursor.confirmedBlock, 4); assert.equal(db.state.transactions.length, 4);
  assert.ok(db.state.transactions.every(row => row.analysis === null));
  const checked = await runWalletMonitor(db, body.monitor);
  assert.equal(checked.error, undefined); assert.equal(checked.newAlertCount, 0);
  assert.equal(checked.newTransactionCount, 0); assert.equal(db.state.alerts.length, 0);
  assert.equal((await post()).status, 200); assert.equal(db.enrollments.length, 1, 'active retry does not re-seed');
});

for (const existing of [false, true]) {
  test(`competing ${existing ? 'inactive re-enrollments' : 'first enrollments'} reject delayed baseline and preserve the arriving alert`, async t => {
    provider(t, baseline);
    const db = database(existing ? { monitor } : {}), post = route(t, db);
    const etherscan = load('src/lib/etherscan.ts');
    let release, entered, calls = 0;
    const delayed = new Promise(resolve => { release = resolve; });
    const waiting = new Promise(resolve => { entered = resolve; });
    etherscan.fetchEthereumTransactions = async () => {
      if (++calls === 1) return baseline;
      entered(); await delayed; return [...baseline, tx(4)];
    };
    const first = post(), second = post();
    await waiting;
    assert.equal((await first).status, existing ? 200 : 201);
    release();
    assert.equal((await second).status, 409);
    assert.equal(db.state.transactions.length, 3, 'loser cannot insert its later snapshot');
    assert.equal(db.state.cursor.confirmedBlock, 3);
    etherscan.fetchMonitoringHeadBlock = async () => 4;
    etherscan.fetchMonitoringPage = async () => [tx(4)];
    const check = await runWalletMonitor(db, db.state.monitor);
    assert.equal(check.error, undefined); assert.equal(check.newTransactionCount, 1); assert.equal(check.newAlertCount, 1);
    assert.equal(db.state.alerts[0].source_transaction_hash, tx(4).hash);
    assert.ok(db.state.transactions.find(row => row.transaction_hash === tx(4).hash).analysis);
    assert.equal((await post()).status, 200);
    assert.equal(calls, 2, 'retry sees active monitor and does not fetch another baseline');
    const replay = await runWalletMonitor(db, db.state.monitor);
    assert.equal(replay.newTransactionCount, 0); assert.equal(replay.newAlertCount, 0);
    assert.equal(db.state.transactions.length, 4); assert.equal(db.state.alerts.length, 1);
  });
}

test('paused re-enrollment resets the cursor, preserves duplicate rows and suppresses legitimate new baseline', async t => {
  const source = provider(t, baseline); const db = database();
  await seedMonitorTransactions(db, null, address, monitor.user_id);
  const originalRows = db.state.transactions;
  db.setActive(false); const observed = db.state.monitor;
  source.setHistory([...baseline, tx(4)]);
  const enrolled = await seedMonitorTransactions(db, observed.id, address, observed.user_id, observed.updated_at);
  assert.equal(enrolled.monitor.is_active, true); assert.equal(db.state.cursor.confirmedBlock, 4);
  assert.equal(db.state.cursor.revision, 1); assert.equal(db.state.transactions.length, 4);
  for (const row of originalRows) assert.deepEqual(db.state.transactions.find(saved => saved.transaction_hash === row.transaction_hash), row);
  assert.equal((await runWalletMonitor(db, enrolled.monitor)).newAlertCount, 0);
});

test('inactive-active-inactive transition invalidates an older enrollment snapshot before baseline writes', async t => {
  provider(t, [...baseline, tx(4)]); const db = database({ monitor });
  db.setActive(true); db.setActive(false); const before = db.state;
  await assert.rejects(seedMonitorTransactions(db, monitor.id, address, monitor.user_id, monitor.updated_at), e => e.status === 409);
  assert.deepEqual(db.state, before);
});

for (const stage of ['enrollment-rpc', 'enrollment-baseline', 'enrollment-cursor', 'enrollment-activation']) {
  test(`${stage} failure rolls back first enrollment and retry succeeds without sequential fallback`, async t => {
    provider(t, baseline); const db = database(), before = db.state;
    db.failAt(stage);
    await assert.rejects(seedMonitorTransactions(db, null, address, monitor.user_id), /Atomic/);
    assert.deepEqual(db.state, before);
    await seedMonitorTransactions(db, null, address, monitor.user_id);
    assert.equal(db.state.monitor.is_active, true); assert.equal(db.state.transactions.length, 3);
  });
}

test('lost enrollment response is safe: POST retry returns active monitor without swallowing later transactions', async t => {
  const source = provider(t, baseline), db = database(), post = route(t, db);
  db.failAt('enrollment-response'); assert.equal((await post()).status, 502);
  source.setHistory([...baseline, tx(4)]);
  assert.equal((await post()).status, 200); assert.equal(db.enrollments.length, 1);
  assert.equal((await runWalletMonitor(db, db.state.monitor)).newAlertCount, 1);
});

test('failed re-enrollment preserves the old baseline, cursor and inactive state', async t => {
  const source = provider(t, baseline), db = database();
  await seedMonitorTransactions(db, null, address, monitor.user_id);
  db.setActive(false); const before = db.state;
  source.setHistory([...baseline, tx(4)]);
  db.failAt('enrollment-activation');
  await assert.rejects(seedMonitorTransactions(db, monitor.id, address, monitor.user_id, before.monitor.updated_at));
  assert.deepEqual(db.state, before);
  await seedMonitorTransactions(db, monitor.id, address, monitor.user_id, before.monitor.updated_at);
  assert.equal(db.state.monitor.is_active, true); assert.equal(db.state.cursor.confirmedBlock, 4);
});

test('empty first baseline still establishes checkpoint and activates atomically', async t => {
  provider(t, []); const db = database();
  const result = await seedMonitorTransactions(db, null, address, monitor.user_id);
  assert.equal(result.baselineTransactionCount, 0); assert.equal(result.monitor.is_active, true);
  assert.equal(db.state.cursor.confirmedBlock, 0); assert.equal(db.state.cursor.scanFrom, 1);
});

test('wrong owner, monitor, address, network and absent expected state cannot write baseline', async t => {
  provider(t, baseline);
  for (const override of [{ user: 'wrong-owner' }, { id: 'wrong-monitor' }, { address: to }, { network: 'other' }, { expected: null }]) {
    const db = database({ monitor: { ...monitor, ...(override.network ? { network: override.network } : {}) } }), before = db.state;
    await assert.rejects(seedMonitorTransactions(db, override.id || monitor.id, override.address || address,
      override.user || monitor.user_id, Object.hasOwn(override, 'expected') ? override.expected : monitor.updated_at));
    assert.deepEqual(db.state, before);
  }
});

test('unauthenticated API and browser RPC roles cannot enroll monitors', async t => {
  provider(t, baseline); const db = database();
  assert.equal((await route(t, db, null)()).status, 401); assert.equal(db.enrollments.length, 0);
  for (const role of ['anon', 'authenticated']) {
    const browser = database({ role }), before = browser.state;
    await assert.rejects(seedMonitorTransactions(browser, null, address, monitor.user_id));
    assert.deepEqual(browser.state, before);
  }
});

test('migration locks and checks state before baseline insert, wraps reset/activation, and is service-only', () => {
  const sql = fs.readFileSync('supabase-monitoring-enrollment.sql', 'utf8').replace(/--[^\n]*/g, '');
  const insert = sql.indexOf('insert into public.monitor_transactions');
  assert.ok(sql.indexOf('for update') < insert);
  assert.ok(sql.indexOf('if m.is_active') < insert);
  assert.ok(sql.indexOf('m.updated_at is distinct from p_expected_updated_at') < insert);
  assert.match(sql, /id = p_monitor_id and user_id = p_user_id and address = p_address and network = 'ethereum'/);
  assert.match(sql, /on conflict \(user_id, address, network\) do nothing/);
  assert.match(sql, /on conflict \(monitor_id, transaction_hash\) do nothing/);
  assert.ok(sql.indexOf('perform public.get_wallet_monitor_cursor') > insert);
  assert.ok(sql.indexOf('set is_active = true') > sql.indexOf('perform public.get_wallet_monitor_cursor'));
  assert.match(sql, /security invoker set search_path = ''/);
  assert.match(sql, /revoke all on function[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(sql, /grant execute on function[\s\S]*to service_role/);
  assert.doesNotMatch(sql, /exception\s+when|security definer|create policy|alter table|delete from/i);
  const routeSource = fs.readFileSync('src/app/api/monitors/route.ts', 'utf8').split('export async function POST')[1].split('export async function PATCH')[0];
  assert.doesNotMatch(routeSource, /\.insert\(|\.upsert\(|\.update\(/);
});
