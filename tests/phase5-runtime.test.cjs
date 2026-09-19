const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./load-typescript.cjs');

const { fetchAlchemyTransactionHistory, fetchAlchemyWallet, AlchemyServiceError, logEthereumFailure } = load('src/lib/alchemy.ts');
const { analyzeCaseConnection } = load('src/lib/case-analysis.ts');
const { fetchCaseTransactionHistory, CASE_HISTORY_SOURCE } = load('src/lib/case-history.ts');
// Isolated transport fixtures; none are shipped to the application or database.
const A = `0x${'a'.repeat(40)}`, B = `0x${'b'.repeat(40)}`, C = `0x${'c'.repeat(40)}`, D = `0x${'d'.repeat(40)}`;
const hash = n => `0x${n.toString(16).padStart(64, '0')}`;
function transfer(n, from, to) {
  return { hash: hash(n), from, to, blockNum: '0x10', rawContract: { value: '0xde0b6b3a7640000' }, metadata: { blockTimestamp: `2025-01-01T00:0${n}:00.000Z` } };
}
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
function receipts(batch) { return json(batch.map(request => ({ id: request.id, result: { status: '0x1' } })).reverse()); }
function indexedTransfer(row, overrides = {}) {
  return { hash: row.hash, from: row.from, to: row.to, blockNumber: BigInt(row.blockNum).toString(), value: BigInt(row.rawContract.value).toString(), timeStamp: String(Date.parse(row.metadata.blockTimestamp) / 1000), isError: '0', txreceipt_status: '1', ...overrides };
}

test('Phase 5 shared Ethereum provider regressions', async t => {
  const originalFetch = global.fetch;
  const originalKey = process.env.ALCHEMY_API_KEY;
  const originalEtherscan = process.env.ETHERSCAN_API_KEY;
  const originalLog = console.error;
  process.env.ALCHEMY_API_KEY = 'unit-test-secret-do-not-log';
  delete process.env.ETHERSCAN_API_KEY;
  t.after(() => {
    global.fetch = originalFetch;
    console.error = originalLog;
    if (originalKey === undefined) delete process.env.ALCHEMY_API_KEY; else process.env.ALCHEMY_API_KEY = originalKey;
    if (originalEtherscan === undefined) delete process.env.ETHERSCAN_API_KEY; else process.env.ETHERSCAN_API_KEY = originalEtherscan;
  });

  await t.test('normal wallet still uses Alchemy without an Etherscan key', async () => {
    global.fetch = async (url, options) => {
      assert.match(String(url), /^https:\/\/eth-mainnet\.g\.alchemy\.com\/v2\//);
      const body = JSON.parse(options.body);
      if (Array.isArray(body)) return receipts(body);
      if (body.method === 'eth_getBalance') return json({ id: body.id, result: '0x0' });
      if (body.method === 'eth_getTransactionCount') return json({ id: body.id, result: '0x1' });
      assert.equal(body.method, 'alchemy_getAssetTransfers');
      return json({ result: { transfers: [transfer(1, A, B)] } });
    };
    const wallet = await fetchAlchemyWallet(A);
    assert.equal(wallet.dataSource, 'Alchemy');
    assert.equal(wallet.transactionCount, 1);
    assert.equal(wallet.transactions.length, 1);
    assert.equal(wallet.transactions[0].status, 'success');
  });

  await t.test('follows cursors in both directions, normalizes addresses, deduplicates hashes and maps unordered receipts', async () => {
    const calls = [];
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      if (Array.isArray(body)) return receipts(body);
      const params = body.params[0]; calls.push(params);
      assert.equal(params.fromAddress || params.toAddress, A);
      assert.equal(params.order, 'desc');
      assert.deepEqual(params.category, ['external']);
      return json({ result: params.pageKey ? { transfers: [transfer(1, A, B)] } : { transfers: [transfer(3, A.toUpperCase().replace('0X','0x'), B)], pageKey: 'next-page' } });
    };
    const history = await fetchAlchemyTransactionHistory(` ${A.toUpperCase().replace('0X','0x')} `, { pageSize: 2, maxPages: 2, requireReceipts: true });
    assert.equal(calls.length, 4);
    assert.deepEqual(history.map(row => row.hash), [hash(3), hash(1)]);
    assert.ok(history.every(row => row.from === A && row.status === 'success'));
  });

  await t.test('preserves all within-case and cross-case evidence categories', async () => {
    process.env.ETHERSCAN_API_KEY = 'unit-test-index-key';
    const evidence = [transfer(1, A, C), transfer(2, B, C), transfer(3, D, A), transfer(4, D, B), transfer(5, A, B)];
    let calls = 0;
    global.fetch = async (_url, options) => {
      if (!options.body) {
        const address = new URL(_url).searchParams.get('address');
        return json({ status: '1', result: evidence.filter(row => row.from === address || row.to === address).map(row => indexedTransfer(row)) });
      }
      const body = JSON.parse(options.body);
      assert.equal(Array.isArray(body), false, 'case analysis must not issue receipt batches');
      assert.equal(body.method, 'alchemy_getAssetTransfers');
      calls++;
      const params = body.params[0];
      return json({ result: { transfers: evidence.filter(row => params.fromAddress ? row.from === params.fromAddress : row.to === params.toAddress) } });
    };
    const a = { id: 'a', caseCode: 'A', title: 'Transport test', wallets: [A, B, A.toUpperCase().replace('0X','0x')] };
    const same = await analyzeCaseConnection(a, a, { sameCase: true });
    assert.equal(calls, 4, 'same-case duplicate wallet must not be fetched twice');
    assert.equal(same.walletActivity.length, 2);
    assert.equal(same.source, CASE_HISTORY_SOURCE);
    assert.ok(same.sharedCounterparties.some(row => row.address === C));
    assert.ok(same.sharedDestinations.some(row => row.address === C));
    assert.ok(same.sharedSources.some(row => row.address === D));
    assert.equal(same.directTransfers.length, 1);
    assert.ok(same.temporalRelationships.length > 0);
    assert.equal(same.connectionScore.value, same.connectionScore.components.reduce((sum, row) => sum + row.count, 0));
    const compared = await analyzeCaseConnection({ ...a, wallets: [A] }, { ...a, id: 'b', wallets: [B] });
    assert.equal(compared.directTransfers.length, 1);
    assert.ok(compared.sharedDestinations.some(row => row.address === C));
    assert.ok(compared.sharedSources.some(row => row.address === D));
    assert.ok(compared.temporalRelationships.length > 0);
  });

  await t.test('timing detection is not limited by the 12-row display sample', async () => {
    const evidence = Array.from({ length: 15 }, (_, i) => ({
      ...transfer(1, i < 14 ? A : B, C), hash: hash(i + 1),
      metadata: { blockTimestamp: new Date(Date.UTC(2025, 0, 1, 0, i)).toISOString() },
    }));
    global.fetch = async (url, options) => {
      if (!options.body) {
        const address = new URL(url).searchParams.get('address');
        return json({ status: '1', result: evidence.filter(row => row.from === address).map(row => indexedTransfer(row)) });
      }
      const request = JSON.parse(options.body);
      assert.equal(request.method, 'alchemy_getAssetTransfers');
      return json({ result: { transfers: evidence.filter(row => row.from === request.params[0].fromAddress) } });
    };
    const input = { id: 'timing', caseCode: 'T', title: 'Timing regression', wallets: [A, B] };
    const result = await analyzeCaseConnection(input, input, { sameCase: true });
    assert.equal(result.temporalRelationships.length, 14);
    assert.ok(result.sharedCounterparties[0].caseATransactions.some(row => row.observedBy === B));
    assert.ok(result.sharedCounterparties[0].caseATransactions.length <= 12);
  });

  await t.test('strict wallet receipt lookups reject missing receipts', async () => {
    const sizes = [];
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      if (Array.isArray(body)) { sizes.push(body.length); return receipts(body); }
      return json({ result: { transfers: Array.from({ length: 205 }, (_, i) => ({ ...transfer(1, A, B), hash: hash(i + 1) })) } });
    };
    const rows = await fetchAlchemyTransactionHistory(A, { pageSize: 300, requireReceipts: true });
    assert.equal(rows.length, 205);
    assert.deepEqual(sizes, [50, 50, 50, 50, 5]);
    global.fetch = async (_url, options) => Array.isArray(JSON.parse(options.body)) ? json([]) : json({ result: { transfers: [transfer(1, A, B)] } });
    await assert.rejects(fetchAlchemyTransactionHistory(A, { requireReceipts: true }), error => error instanceof AlchemyServiceError && error.kind === 'receipts');
  });

  await t.test('retries only throttled receipts without discarding verified evidence', async () => {
    const batches = [];
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      if (!Array.isArray(body)) return json({ result: { transfers: [transfer(1, A, B), transfer(2, A, C)] } });
      batches.push(body.map(request => request.params[0]));
      if (batches.length === 1) return json([{ id: 0, result: { status: '0x1' } }, { id: 1, error: { code: 429, message: 'Rate limited' } }]);
      return receipts(body);
    };
    const rows = await fetchAlchemyTransactionHistory(A, { requireReceipts: true });
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.status === 'success'));
    assert.deepEqual(batches.map(batch => batch.length), [2, 1]);
    assert.equal(batches[1][0], batches[0][1]);
  });

  await t.test('indexed status outages are explicitly incomplete, never false evidence or a verified zero-connection finding', async () => {
    console.error = () => {};
    global.fetch = async (_url, options) => {
      if (!options.body) return json({ status: '0', message: 'NOTOK', result: 'unit-test-secret-do-not-log' });
      const body = JSON.parse(options.body);
      if (Array.isArray(body)) return json([]);
      return json({ result: { transfers: [transfer(1, A, B)] } });
    };
    const input = { id: 'partial', caseCode: 'P', title: 'Partial coverage test', wallets: [A, B] };
    const analysis = await analyzeCaseConnection(input, input, { sameCase: true });
    assert.equal(analysis.directTransfers.length, 0);
    assert.equal(analysis.walletActivity[0].successfulTransactionCount, 0);
    assert.ok(analysis.limitations.some(note => note.includes('Incomplete execution-status verification')));
    assert.ok(analysis.riskSignals.some(note => note.includes('zero count does not establish')));
    assert.ok(!analysis.riskSignals.some(note => note.startsWith('No configured observable')));
    console.error = originalLog;
  });

  await t.test('bulk statuses preserve failure, unknown and conflicting evidence without receipt RPCs', async () => {
    const transfers = Array.from({ length: 6 }, (_, i) => transfer(i + 1, A, B));
    let calls = 0;
    global.fetch = async (_url, options) => {
      calls++;
      if (!options.body) return json({ status: '1', result: [
        indexedTransfer(transfers[0]),
        indexedTransfer(transfers[1], { isError: '1', txreceipt_status: '0' }),
        indexedTransfer(transfers[2], { isError: '', txreceipt_status: '' }),
        indexedTransfer(transfers[3], { value: '999' }),
        indexedTransfer(transfers[4]),
        indexedTransfer(transfers[4], { isError: '1', txreceipt_status: '0' }),
      ] });
      const request = JSON.parse(options.body);
      assert.equal(request.method, 'alchemy_getAssetTransfers');
      return json({ result: { transfers } });
    };
    const rows = await fetchCaseTransactionHistory(A.toUpperCase().replace('0X', '0x'), { pageSize: 1000, maxPages: 5 });
    const byHash = new Map(rows.map(row => [row.hash, row.status]));
    assert.equal(calls, 3);
    assert.deepEqual(transfers.map(row => byHash.get(row.hash)), ['success', 'failed', 'unknown', 'unknown', 'unknown', 'unknown']);
  });

  await t.test('5000 transfers use paginated status data with zero receipt RPCs', async () => {
    let alchemyCalls = 0, indexCalls = 0;
    const rows = Array.from({ length: 5000 }, (_, i) => ({ ...transfer(1, A, B), hash: hash(i + 1) }));
    global.fetch = async (_url, options) => {
      if (!options.body) {
        indexCalls++;
        const page = Number(new URL(_url).searchParams.get('page'));
        return json({ status: '1', result: rows.slice((page - 1) * 1000, page * 1000).map(row => indexedTransfer(row)) });
      }
      const request = JSON.parse(options.body);
      assert.equal(request.method, 'alchemy_getAssetTransfers');
      alchemyCalls++;
      const page = Number(request.params[0].pageKey || 0);
      return json({ result: { transfers: rows.slice(page * 1000, (page + 1) * 1000), ...(page < 4 ? { pageKey: String(page + 1) } : {}) } });
    };
    const history = await fetchCaseTransactionHistory(A, { pageSize: 1000, maxPages: 5 });
    assert.equal(history.length, 5000);
    assert.ok(history.every(row => row.status === 'success'));
    assert.equal(alchemyCalls, 10);
    assert.equal(indexCalls, 5);
  });

  await t.test('provider failures are actionable and logs never contain secrets or raw responses', async () => {
    const logged = []; console.error = (...args) => logged.push(args);
    for (const failure of ['http', 'rpc', 'network']) {
      global.fetch = async () => {
        if (failure === 'network') throw new Error('https://provider/unit-test-secret-do-not-log');
        return failure === 'http' ? json({ message: 'unit-test-secret-do-not-log' }, 429) : json({ error: { code: -32005, message: 'unit-test-secret-do-not-log' } });
      };
      await assert.rejects(fetchAlchemyTransactionHistory(A), error => {
        assert.equal(error.kind, failure);
        logEthereumFailure('case_analysis', error);
        assert.ok(!error.message.includes('unit-test-secret-do-not-log'));
        return true;
      });
    }
    assert.ok(!JSON.stringify(logged).includes('unit-test-secret-do-not-log'));
    assert.ok(logged.some(row => row[1].httpStatus === 429));
    assert.ok(logged.some(row => row[1].rpcCode === -32005));
    delete process.env.ALCHEMY_API_KEY;
    await assert.rejects(fetchAlchemyTransactionHistory(A), error => error.kind === 'configuration');
  });
});
