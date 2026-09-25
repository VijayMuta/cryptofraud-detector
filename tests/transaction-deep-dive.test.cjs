const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./load-typescript.cjs');
const { isTransactionHash, transactionDeepDiveUrl, normalizeTransactionEvidence: normalize, transactionInvestigationContext: context, transactionAttributions } = load('src/lib/transaction-deep-dive.ts');
// Synthetic fixtures are confined to automated tests.
const H = '0x' + 'a'.repeat(64), A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40);
const record = { id: 'case-1', wallets: [{ address: A, network: 'ethereum' }, { address: B, network: 'ethereum' }] };
const response = { transaction: { hash: H, from: A, to: B, valueWei: '1000000000000000001', blockNumber: '123', timestamp: '2026-01-01T00:00:00Z', status: 'success' }, network: 'Ethereum Mainnet', dataSource: 'Alchemy', verifiedAt: '2026-01-02T00:00:00Z' };
const evidence = (changes = {}) => normalize({ ...response, transaction: { ...response.transaction, ...changes } }, H);

test('hash validation and navigation reject invalid identifiers and safely encode case context', () => {
  assert.equal(isTransactionHash(H), true);
  assert.equal(isTransactionHash('0x' + 'A'.repeat(64)), true);
  for (const value of [null, 42, A, '', H + '0', H.slice(1), ' ' + H, '0x' + 'g'.repeat(64), 'javascript:alert(1)']) {
    assert.equal(isTransactionHash(value), false);
    assert.equal(transactionDeepDiveUrl(value), null);
  }
  assert.equal(transactionDeepDiveUrl(H, 'case/?&x=1'), `/transactions/${H}?case=case%2F%3F%26x%3D1`);
});
test('normalization preserves exact value, blockchain time and retrieval time separately', () => {
  const result = evidence();
  assert.equal(result.valueWei, '1000000000000000001');
  assert.equal(result.valueEth, '1.000000000000000001');
  assert.equal(result.timestamp, response.transaction.timestamp);
  assert.equal(result.retrievedAt, response.verifiedAt);
  assert.equal(result.status, 'success');
  assert.equal(evidence({ valueWei: '0' }).valueEth, '0');
  assert.throws(() => normalize({}, H));
  assert.throws(() => normalize(response, '0x' + 'b'.repeat(64)));
});
test('missing or malformed fields never become invented timestamps, zero values or successful status', () => {
  for (const changes of [{}, { valueWei: 1e18, valueEth: '100', blockNumber: 'bad', timestamp: '2026-01-01', status: 'fraud', to: 'bad' }]) {
    const result = normalize({ transaction: { hash: H, ...changes } }, H);
    assert.equal(result.valueWei, null); assert.equal(result.valueEth, null);
    assert.equal(result.timestamp, null); assert.equal(result.blockNumber, null);
    assert.equal(result.status, 'unknown'); assert.equal(result.to, null);
    assert.equal(result.dataSource, null); assert.equal(result.network, null);
  }
  assert.equal(evidence({ blockNumber: null }).status, 'unknown');
  assert.equal(evidence({ blockNumber: null }).timestamp, null);
});
test('case matching is network aware and case insensitive, without inferring ownership', () => {
  const upper = { ...record, wallets: record.wallets.map(wallet => ({ ...wallet, address: '0x' + wallet.address.slice(2).toUpperCase() })) };
  const result = context(evidence(), upper);
  assert.equal(result.senderIsCaseWallet, true);
  assert.equal(result.recipientIsCaseWallet, true);
  assert.equal(result.betweenInvestigatedWallets, true);
  assert.equal(result.observations.length, 3);
  assert.deepEqual(result, context(evidence(), upper));
  assert.equal(context(evidence(), { ...record, wallets: [{ address: A, network: 'other' }] }).senderIsCaseWallet, false);
  assert.equal(context({ ...evidence(), network: 'other' }, record).senderIsCaseWallet, null);
  assert.equal(context(evidence(), null).senderIsCaseWallet, null);
  assert.deepEqual(context(evidence(), null).observations, []);
});
test('one-sided and missing endpoints preserve the supported context only', () => {
  const result = context(evidence(), { ...record, wallets: [record.wallets[0]] });
  assert.equal(result.senderIsCaseWallet, true); assert.equal(result.recipientIsCaseWallet, false);
  assert.equal(result.observations.length, 1);
  assert.equal(context(evidence({ to: null }), record).recipientIsCaseWallet, null);
  assert.equal(context(evidence({ from: null }), record).senderIsCaseWallet, null);
});
test('failed, unverified, zero-value, unknown-value and self transactions do not establish movement between wallets', () => {
  for (const changes of [{ status: 'failed' }, { status: 'unknown' }, { valueWei: '0' }, { valueWei: null }, { to: A }]) {
    const result = context(evidence(changes), record);
    assert.equal(result.betweenInvestigatedWallets, false);
    assert.ok(!result.observations.some(item => item.includes('two distinct')));
  }
  assert.match(context(evidence({ to: A }), record).observations.join(' '), /same case wallet/);
});
test('empty trusted registry yields unknown attribution, missing addresses never acquire labels', () => {
  const endpoints = transactionAttributions(evidence());
  assert.equal(endpoints.length, 2);
  assert.ok(endpoints.every(item => item.status === 'UNATTRIBUTED / UNKNOWN' && item.record === null));
  assert.equal(transactionAttributions(evidence({ from: null, to: null })).length, 0);
});

test('transaction API validates before provider access, preserves authentication and distinguishes not found from provider failures', async t => {
  const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
  const viem = require('viem'), { NextRequest } = require('next/server');
  let authorized = true, calls = 0, mode = 'success';
  const blockHash = '0x' + '1'.repeat(64);
  const client = {
    getTransaction: async () => {
      if (mode === 'not-found') throw new viem.TransactionNotFoundError({ hash: H });
      if (mode === 'failure') throw new Error('sensitive-provider-url');
      return { hash: H, from: A, to: B, value: 1n, blockNumber: mode === 'pending' ? null : 123n, blockHash: mode === 'pending' ? null : blockHash };
    },
    getTransactionReceipt: async () => {
      if (mode === 'partial') throw new Error('receipt unavailable');
      return { transactionHash: H, blockHash: mode === 'conflict' ? H : blockHash, blockNumber: 123n, status: 'success' };
    },
    getBlock: async () => {
      if (mode === 'partial') throw new Error('block unavailable');
      return { number: 123n, hash: mode === 'conflict' ? H : blockHash, timestamp: 1767225600n };
    },
  };
  const filename = path.resolve('src/app/api/transaction/route.ts');
  const compiled = new Module(filename, module);
  compiled.filename = filename; compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = compiled.require.bind(compiled);
  compiled.require = name => name === 'viem' ? { ...viem, createPublicClient: () => { calls++; return client; } } : name === '@/lib/request-auth' ? { getRequestUser: async () => authorized ? { id: 'owner' } : null } : name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`) : originalRequire(name);
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
  const oldKey = process.env.ALCHEMY_API_KEY, oldLog = console.error;
  process.env.ALCHEMY_API_KEY = 'test-only-key'; console.error = () => {};
  t.after(() => { if (oldKey === undefined) delete process.env.ALCHEMY_API_KEY; else process.env.ALCHEMY_API_KEY = oldKey; console.error = oldLog; });
  const get = (hash = H) => compiled.exports.GET(new NextRequest(`http://localhost/api/transaction?hash=${hash}`));
  authorized = false; assert.equal((await get()).status, 401); assert.equal(calls, 0);
  authorized = true; assert.equal((await get('invalid')).status, 400); assert.equal(calls, 0);
  delete process.env.ALCHEMY_API_KEY; assert.equal((await get()).status, 503); assert.equal(calls, 0);
  process.env.ALCHEMY_API_KEY = 'test-only-key';
  const success = await get(); assert.equal(success.status, 200);
  const data = await success.json(); assert.equal(data.transaction.status, 'success'); assert.equal(data.transaction.timestamp, '2026-01-01T00:00:00.000Z');
  for (mode of ['partial', 'conflict', 'pending']) { const data = await (await get()).json(); assert.equal(data.transaction.status, 'unknown'); assert.equal(data.transaction.timestamp, null); }
  mode = 'not-found'; assert.equal((await get()).status, 404);
  mode = 'failure'; const failed = await get(); assert.equal(failed.status, 502); assert.ok(!(await failed.text()).includes('sensitive-provider-url'));
});
