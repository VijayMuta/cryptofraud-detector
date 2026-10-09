const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { load } = require('./load-typescript.cjs');
const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40);
const H = '0x' + 'ab'.repeat(32), J = '0x' + 'cd'.repeat(32);
const amount = '1000000000000000001';
function provider(receipts) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/alchemy.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, {
    exports, require: name => name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`) : require(name),
    process: { env: { ALCHEMY_API_KEY: 'fixture' } }, AbortSignal, setTimeout, console: { error() {} },
    fetch: async (_url, options) => {
      const request = JSON.parse(options.body);
      if (Array.isArray(request)) return Response.json(receipts(request));
      return Response.json({ result: { transfers: request.params[0].fromAddress ? [H, J].map(hash => ({
        hash, from: A, to: B, blockNum: '0x10', rawContract: { value: '0x' + BigInt(amount).toString(16) },
        metadata: { blockTimestamp: '2026-01-01T00:00:00Z' },
      })) : [] } });
    },
  });
  return exports;
}
const receipt = (id, transactionHash, status = '0x1') => ({ id, result: { transactionHash, status } });
for (const [label, hash] of [['missing', undefined], ['malformed', '0x123'], ['mismatched', J]]) {
  for (const status of ['0x1', '0x0']) test(`AUD-M01: ${label} receipt identity never establishes execution (${status})`, async () => {
    const api = provider(() => [receipt(0, hash, status), receipt(1, J)]);
    const rows = await api.fetchAlchemyTransactionHistory(A);
    assert.equal(rows[0].status, 'unknown');
    assert.equal(rows[1].status, 'success');
    await assert.rejects(api.fetchAlchemyTransactionHistory(A, { requireReceipts: true }), /receipts could not be verified/);
  });
}
test('AUD-M01: matching hashes, case-insensitive identity, out-of-order success and failure preserve exact amounts', async () => {
  const rows = await provider(() => [receipt(1, J, '0x0'), receipt(0, H.toUpperCase())]).fetchAlchemyTransactionHistory(A);
  assert.equal(rows[0].status, 'success');
  assert.equal(rows[1].status, 'failed');
  assert.ok(rows.every(row => row.value === amount));
});
for (const reverse of [false, true]) {
  for (const [label, conflict] of [['hash', receipt(0, J)], ['status', receipt(0, H, '0x0')], ['missing hash', receipt(0, undefined)], ['RPC error', { id: 0, error: { code: 429 } }]]) {
    test(`AUD-M01: conflicting ${label} remains unknown (reversed: ${reverse})`, async () => {
      const responses = [receipt(0, H), conflict];
      const api = provider(() => [...(reverse ? [...responses].reverse() : responses), receipt(1, J)]);
      const rows = await api.fetchAlchemyTransactionHistory(A);
      assert.equal(rows[0].status, 'unknown');
      assert.equal(rows[1].status, 'success');
      await assert.rejects(api.fetchAlchemyTransactionHistory(A, { requireReceipts: true }), /receipts could not be verified/);
    });
  }
}
test('AUD-M01: pending and unavailable receipts remain unknown', async () => {
  const rows = await provider(() => [{ id: 0, result: null }]).fetchAlchemyTransactionHistory(A);
  assert.ok(rows.every(row => row.status === 'unknown'));
});
test('AUD-M01: receipt hashes cannot override swapped RPC associations or invalid IDs', async () => {
  const rows = await provider(() => [receipt(0, J), receipt(1, H), receipt(-1, H), receipt(0.5, H), receipt('0', H), receipt(2, H)]).fetchAlchemyTransactionHistory(A);
  assert.ok(rows.every(row => row.status === 'unknown'));
});
test('AUD-M01: identical duplicate responses are also ambiguous', async () => {
  const rows = await provider(() => [receipt(0, H), receipt(0, H), receipt(1, J)]).fetchAlchemyTransactionHistory(A);
  assert.equal(rows[0].status, 'unknown');
  assert.equal(rows[1].status, 'success');
});
test('AUD-M01: throttled retry cannot rehabilitate conflicting identity', async () => {
  let calls = 0;
  const api = provider(batch => {
    if (++calls === 1) return [receipt(0, J), { id: 1, error: { code: 429 } }];
    assert.deepEqual(batch.map(row => row.params[0]), [J]);
    return [receipt(0, J)];
  });
  const rows = await api.fetchAlchemyTransactionHistory(A, { requireReceipts: true, allowPartialReceipts: true });
  assert.equal(rows[0].status, 'unknown');
  assert.equal(rows[1].status, 'success');
  assert.equal(calls, 2);
});
