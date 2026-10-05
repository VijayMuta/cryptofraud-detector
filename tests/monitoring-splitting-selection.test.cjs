const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./load-typescript.cjs');
const { provider, database } = require('./monitoring-fixture.cjs');
const { runWalletMonitor, seedMonitorTransactions } = load('src/lib/monitoring.ts');
const { analyzeWalletTransactions } = load('src/lib/wallet-analysis.ts');
const address = '0x' + 'a'.repeat(40);
const monitor = { id: '11111111-1111-4111-8111-111111111111', user_id: '22222222-2222-4222-8222-222222222222', address };
const tx = (i, day = 3) => ({ hash: '0x' + i.toString(16).padStart(64, '0'),
  blockNumber: String(i), timestamp: new Date(Date.UTC(2026, 0, day, 0, i)).toISOString(),
  from: address, to: '0x' + i.toString(16).padStart(40, '0'),
  value: '100000000000000000000', status: 'success' });
const baseline = () => [1, 2, 3, 4].map(i => tx(i, 1));
const fresh = () => [5, 6, 7].map(i => tx(i));
async function setup(t) {
  const source = provider(t, baseline()), db = database();
  await seedMonitorTransactions(db, null, address, monitor.user_id);
  return { source, db };
}
function assertNewEvidence(db, rows = fresh()) {
  assert.equal(db.state.alerts.length, 1);
  const alert = db.state.alerts[0];
  assert.equal(alert.alert_type, 'fund_splitting');
  assert.equal(alert.source_transaction_hash, rows.at(-1).hash);
  assert.deepEqual(alert.details.transactionHashes, rows.map(row => row.hash));
  assert.deepEqual(alert.details.analysis.splittingAlarm.transactionHashes, rows.map(row => row.hash));
  assert.equal(alert.details.totalWei, String(rows.reduce((sum, row) => sum + BigInt(row.value), 0n)));
  assert.equal(alert.details.windowStart, rows[0].timestamp);
  assert.equal(alert.details.windowEnd, rows.at(-1).timestamp);
  assert.equal(alert.details.destinationCount, 3);
}

test('AUD-H03: stronger four-recipient baseline cannot suppress a separate new three-recipient split', async t => {
  const { source, db } = await setup(t);
  assert.equal((await runWalletMonitor(db, monitor)).newAlertCount, 0);
  assert.equal(db.state.alerts.length, 0, 'baseline alone is suppressed');
  source.setHistory([...baseline(), ...fresh()]);
  const general = analyzeWalletTransactions(address, [...baseline(), ...fresh()]);
  assert.equal(general.splittingAlarm.destinationCount, 4, 'general ranking is unchanged');
  const result = await runWalletMonitor(db, monitor);
  assert.equal(result.error, undefined);
  assert.equal(result.newTransactionCount, 3);
  assert.equal(result.newAlertCount, 1);
  assertNewEvidence(db);
  assert.equal(db.state.cursor.confirmedBlock, 7);
  assert.equal((await runWalletMonitor(db, monitor)).newAlertCount, 0);
  assertNewEvidence(db);
});

for (const stage of ['alerts', 'response']) {
  test(`AUD-H03: new split survives ${stage} failure and retry without duplicates`, async t => {
    const { source, db } = await setup(t);
    source.setHistory([...baseline(), ...fresh()]); db.failAt(stage);
    assert.ok((await runWalletMonitor(db, monitor)).error);
    assert.equal(db.state.alerts.length, stage === 'response' ? 1 : 0);
    assert.equal((await runWalletMonitor(db, monitor)).error, undefined);
    assertNewEvidence(db);
    assert.equal((await runWalletMonitor(db, monitor)).newAlertCount, 0);
  });
}

for (const [label, patch] of Object.entries({ failed: { status: 'failed' }, unknown: { status: 'unknown' },
  zero: { value: '0' }, malformed: { value: 'bad' }, missing: { value: undefined },
  unrelated: { from: '0x' + 'b'.repeat(40) }, self: { to: address },
  undated: { timestamp: null }, invalidDate: { timestamp: 'invalid' }, noRecipient: { to: null } })) {
  test(`AUD-H03: ${label} third transfer cannot complete new splitting evidence`, async t => {
    const { source, db } = await setup(t);
    const rows = fresh(); Object.assign(rows[2], patch);
    source.setHistory([...baseline(), ...rows]);
    const result = await runWalletMonitor(db, monitor);
    if (label === 'malformed' || label === 'missing') assert.ok(result.error, 'invalid amounts fail closed');
    else assert.equal(result.error, undefined);
    assert.equal(db.state.alerts.length, 0);
  });
}

test('AUD-H03: historical context may complete a new split across checks', async t => {
  const rows = fresh(), source = provider(t, rows.slice(0, 2)), db = database();
  await seedMonitorTransactions(db, null, address, monitor.user_id);
  source.setHistory(rows);
  assert.equal((await runWalletMonitor(db, monitor)).newAlertCount, 1);
  assertNewEvidence(db, rows);
  assert.equal((await runWalletMonitor(db, monitor)).newAlertCount, 0);
});

test('AUD-H03: equal new windows select deterministically independent of page order', async t => {
  const { source, db } = await setup(t);
  const rows = [...fresh(), ...[8, 9, 10].map(i => tx(i, 5))];
  for (const row of rows) row.timestamp = row.blockNumber < 8 ? '2026-01-03T00:00:00.000Z' : '2026-01-05T00:00:00.000Z';
  source.setHistory([...baseline(), ...rows]);
  const etherscan = load('src/lib/etherscan.ts'), original = etherscan.fetchMonitoringPage;
  etherscan.fetchMonitoringPage = async (...args) => (await original(...args)).reverse();
  assert.equal((await runWalletMonitor(db, monitor)).newAlertCount, 1);
  assertNewEvidence(db, rows.slice(0, 3));
  etherscan.fetchMonitoringPage = original;
  const second = database();
  source.setHistory(baseline());
  await seedMonitorTransactions(second, null, address, monitor.user_id);
  source.setHistory([...baseline(), ...rows]);
  await runWalletMonitor(second, monitor);
  assert.deepEqual(second.state.alerts[0].details, db.state.alerts[0].details);
});
