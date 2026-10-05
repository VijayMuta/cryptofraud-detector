const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { load } = require('./load-typescript.cjs');
const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40), H = '0x' + '1'.repeat(64);
const row = { hash: H, from: A, to: B, value: '1', timestamp: '2026-01-01T00:00:00.000Z', blockNumber: '16', status: 'success' };
// Run unchanged provider modules in memory with isolated configuration/transport.
// No actual environment variables, provider requests, or database writes.
function provider(file, fetch) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: name => name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`) : require(name), process: { env: { ALCHEMY_API_KEY: 'fixture', ETHERSCAN_API_KEY: 'fixture' } }, fetch, URL, AbortController, AbortSignal, setTimeout, clearTimeout, console }, { filename: file });
  return exports;
}
const json = result => Response.json(result);
function alchemy(rawContract) {
  return provider('src/lib/alchemy.ts', async (_url, options) => {
    const request = JSON.parse(options.body);
    if (Array.isArray(request)) return json(request.map(r => ({ id: r.id, result: { status: '0x1', transactionHash: H } })));
    return json({ result: { transfers: request.params[0].fromAddress ? [{ hash: H, from: A, to: B, blockNum: '0x10', metadata: { blockTimestamp: row.timestamp }, rawContract }] : [] } });
  });
}

test('FINAL-H01: Alchemy missing/malformed raw amounts fail visibly, never become zero evidence', async () => {
  for (const raw of [undefined, null, {}, { value: null }, { value: '' }, { value: '0x' }, { value: 'bad' }, { value: 0 }]) {
    await assert.rejects(alchemy(raw).fetchAlchemyTransactionHistory(A), /amount.*unavailable|amount.*invalid/i);
  }
});

test('FINAL-H01: actual zero and exact positive Alchemy amounts preserve transaction facts', async () => {
  for (const value of ['0', '1', '1000000000000000001']) {
    const result = await alchemy({ value: '0x' + BigInt(value).toString(16) }).fetchAlchemyTransactionHistory(A);
    assert.equal(result.length, 1);
    for (const key of ['hash', 'from', 'to', 'timestamp', 'blockNumber', 'status']) assert.equal(result[0][key], row[key]);
    assert.equal(result[0].value, value);
  }
});

test('FINAL-H01: Etherscan baseline rejects unknown amounts without silently dropping rows', async () => {
  for (const value of [undefined, null, '', 'bad', '-1', '1.5', 0]) {
    const api = provider('src/lib/etherscan.ts', async () => json({ status: '1', result: [{ hash: H, from: A, to: B, blockNumber: '16', timeStamp: '1767225600', value, isError: '0' }] }));
    await assert.rejects(api.fetchEthereumTransactions(A, 100), /amount.*unavailable|amount.*invalid/i);
  }
});

test('FINAL-H01: valid zero and positive Etherscan values remain exact', async () => {
  for (const value of ['0', '1', '1000000000000000001']) {
    const api = provider('src/lib/etherscan.ts', async () => json({ status: '1', result: [{ hash: H, from: A, to: B, blockNumber: '16', timeStamp: '1767225600', value, isError: '0' }] }));
    const result = await api.fetchEthereumTransactions(A, 100);
    assert.equal(result[0].value, value); assert.equal(result[0].hash, H);
  }
});

test('FINAL-H01: analytics and Freeze/Hold cannot summarize unavailable successful amounts as zero', () => {
  const { analyzeWalletTransactions } = load('src/lib/wallet-analysis.ts');
  const { summarizeEvidence } = load('src/lib/freeze-hold.ts');
  for (const value of ['', 'bad', undefined, null]) {
    assert.throws(() => analyzeWalletTransactions(A, [{ ...row, value }]), /amount.*unavailable|amount.*invalid/i);
    assert.throws(() => summarizeEvidence([{ address: A, transactions: [{ ...row, value }], network: 'Ethereum Mainnet', dataSource: 'Fixture', verifiedAt: row.timestamp }]), /amount.*unavailable|amount.*invalid/i);
  }
});

test('FINAL-H01: invalid enrollment amount never reaches atomic persistence; valid retry succeeds', async t => {
  const etherscan = load('src/lib/etherscan.ts');
  const original = etherscan.fetchEthereumTransactions;
  t.after(() => { etherscan.fetchEthereumTransactions = original; });
  const { seedMonitorTransactions } = load('src/lib/monitoring.ts');
  let calls = 0, amount = '';
  etherscan.fetchEthereumTransactions = async () => [{ ...row, value: amount, status: 'unknown' }];
  const admin = { rpc: async (name, args) => {
    calls++;
    assert.equal(name, 'enroll_wallet_monitor');
    assert.equal(args.p_transactions[0].value_wei, amount);
    return { data: { monitor: { id: 'monitor', user_id: 'owner', address: A, network: 'ethereum', is_active: true }, baselineTransactionCount: 1 }, error: null };
  } };
  await assert.rejects(seedMonitorTransactions(admin, null, A, 'owner'), /amount.*unavailable|amount.*invalid/i);
  assert.equal(calls, 0);
  amount = '1000000000000000001';
  await seedMonitorTransactions(admin, null, A, 'owner');
  assert.equal(calls, 1);
});
