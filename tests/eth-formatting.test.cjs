const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./load-typescript.cjs');
const { formatEth } = load('src/lib/wallet-analysis.ts');

const ETH = 1000000000000000000n;
const MICRO_ETH = 1000000000000n;
const LARGE = 123456789012345678901234567890n;
// Display precision stays at six decimals; exact wei is never rounded in data.
const cases = [
  ['zero wei', 0n, '0 ETH'],
  ['one wei', 1n, '<0.000001 ETH'],
  ['immediately below one micro-ETH', MICRO_ETH - 1n, '<0.000001 ETH'],
  ['exactly one micro-ETH', MICRO_ETH, '0.000001 ETH'],
  ['immediately above one micro-ETH', MICRO_ETH + 1n, '0.000001 ETH'],
  ['immediately below one ETH', ETH - 1n, '0.999999 ETH'],
  ['exactly one ETH', ETH, '1 ETH'],
  ['one ETH plus one wei (1.000000000000000001 ETH)', ETH + 1n, '1 ETH'],
  ['one ETH plus dust just below one micro-ETH', ETH + MICRO_ETH - 1n, '1 ETH'],
  ['one ETH plus one micro-ETH', ETH + MICRO_ETH, '1.000001 ETH'],
  ['multiple whole ETH plus tiny dust', 42n * ETH + 9n, '42 ETH'],
  ['large whole ETH beyond Number precision', LARGE * ETH, `${LARGE} ETH`],
  ['large whole ETH plus one wei', LARGE * ETH + 1n, `${LARGE} ETH`],
  ['six-decimal truncation without rounding', 1234567890123456789n, '1.234567 ETH'],
  ['trailing fractional zero removal', 1230000000000000000n, '1.23 ETH'],
];

for (const [label, wei, expected] of cases) {
  test(`ETH formatting: ${label}`, () => assert.equal(formatEth(wei), expected));
  if (wei !== 0n) {
    test(`ETH formatting: negative ${label}`, () => assert.equal(formatEth(-wei), `-${expected}`));
  }
}
test('ETH formatting: unavailable remains distinct from zero', () => assert.equal(formatEth(null), 'Unavailable'));

const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40);
const transaction = (index, value) => ({
  hash: '0x' + index.toString(16).padStart(64, '0'), from: A, to: B,
  value: value.toString(), blockNumber: '1', timestamp: '2026-01-01T00:00:00.000Z', status: 'success',
});

test('Freeze/Hold Money Fingerprint preserves whole ETH and exact exported evidence', () => {
  const { summarizeEvidence } = load('src/lib/freeze-hold.ts');
  const result = summarizeEvidence([{
    address: A, network: 'Ethereum Mainnet', dataSource: 'Test fixture',
    verifiedAt: '2026-01-01T00:00:00.000Z', transactions: [transaction(1, ETH + 1n)],
  }]);
  const fingerprint = result.behavioral[0].moneyFingerprint;
  assert.equal(fingerprint.outgoingEth, '1 ETH');
  assert.equal(fingerprint.averageEth, '1 ETH');
  assert.equal(fingerprint.largestEth, '1 ETH');
  assert.equal(fingerprint.incomingEth, '0 ETH');
  assert.equal(JSON.parse(JSON.stringify(result)).transactions[0].value, '1000000000000000001');
});

test('new monitoring descriptions preserve whole ETH without changing stored wei', async t => {
  const etherscan = load('src/lib/etherscan.ts');
  const original = etherscan.fetchEthereumTransactions;
  const originalPage = etherscan.fetchMonitoringPage, originalHead = etherscan.fetchMonitoringHeadBlock;
  t.after(() => { etherscan.fetchEthereumTransactions = original; etherscan.fetchMonitoringPage = originalPage; etherscan.fetchMonitoringHeadBlock = originalHead; });
  const transactions = [transaction(1, ETH / 10n), transaction(2, ETH / 10n), transaction(3, ETH / 10n), transaction(4, ETH + 1n)];
  etherscan.fetchEthereumTransactions = async () => transactions;
  etherscan.fetchMonitoringPage = async () => transactions;
  etherscan.fetchMonitoringHeadBlock = async () => 1;
  const { runWalletMonitor } = load('src/lib/monitoring.ts');
  // In-memory persistence only; no provider or database is contacted.
  const admin = require('./monitoring-fixture.cjs').database();
  const result = await runWalletMonitor(admin, { id: 'test-monitor', address: A });
  const storedTransactions = admin.state.transactions, storedAlerts = admin.state.alerts;
  assert.equal(result.error, undefined);
  assert.equal(storedAlerts.length, 1);
  assert.equal(storedAlerts[0].alert_type, 'unusual_movement');
  assert.equal(storedAlerts[0].description, '1 ETH is at least 4x the average of the other recent successful transactions observed for this wallet.');
  assert.equal(storedTransactions[3].value_wei, '1000000000000000001');
});
