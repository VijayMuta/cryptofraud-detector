// Opt-in, read-only mainnet regression: node tests/phase5-live-regression.cjs
// Uses the existing server environment without modifying it or logging credentials.
const assert = require('node:assert/strict');
const { load } = require('./load-typescript.cjs');
require('@next/env').loadEnvConfig(process.cwd());
const { analyzeCaseConnection } = load('src/lib/case-analysis.ts');
const { logEthereumFailure } = load('src/lib/alchemy.ts');
const originalFetch = global.fetch;
const counts = { alchemy: 0, etherscan: 0, receiptRpc: 0 };
global.fetch = async (url, options) => {
  if (options?.body) {
    const body = JSON.parse(options.body);
    const calls = Array.isArray(body) ? body : [body];
    counts.receiptRpc += calls.filter(call => call.method === 'eth_getTransactionReceipt').length;
    assert.equal(counts.receiptRpc, 0, 'Phase 5 must not issue per-transaction receipts');
    counts.alchemy++;
  } else counts.etherscan++;
  return originalFetch(url, options);
};

(async () => {
  const start = Date.now();
  const input = {
    id: 'public-address-regression', caseCode: 'REGRESSION', title: 'Read-only public evidence regression',
    wallets: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', '0xd5576de575554fe28ae71c2b2adf1e9bdc9f8f74'],
  };
  try {
    const analysis = await analyzeCaseConnection(input, input, { sameCase: true });
    const result = {
      provider: analysis.source, requests: counts, elapsedMs: Date.now() - start,
      retrieved: analysis.walletActivity.reduce((sum, wallet) => sum + wallet.transactionCount, 0),
      successful: analysis.walletActivity.reduce((sum, wallet) => sum + wallet.successfulTransactionCount, 0),
      incompleteStatus: analysis.limitations.some(note => note.startsWith('Incomplete execution-status')),
      relationships: analysis.connectionScore.components,
    };
    console.log(JSON.stringify(result, null, 2));
    assert.equal(counts.receiptRpc, 0);
    assert.ok(counts.etherscan <= 12);
    assert.ok(analysis.directTransfers.length > 0, 'Expected the observed direct transfer between the regression wallets');
    assert.ok(analysis.connectionScore.value > 0);
  } catch (error) {
    // Never emit a raw fetch/viem error, which could contain the provider URL.
    logEthereumFailure('case_analysis', error);
    console.error('Live regression failed. No raw provider error or credential was logged.');
    process.exitCode = 1;
  } finally { global.fetch = originalFetch; }
})();
