// Read-only public mainnet smoke test. Never print raw provider errors or secrets.
const assert = require('node:assert/strict');
const { load } = require('./load-typescript.cjs');
require('@next/env').loadEnvConfig(process.cwd());
const { fetchAlchemyWallet, logEthereumFailure } = load('src/lib/alchemy.ts');
const { analyzeWalletTransactions } = load('src/lib/wallet-analysis.ts');
const { summarizeIntelligence } = load('src/lib/blockchain-intelligence.ts');
(async () => {
  try {
    const wallet = await fetchAlchemyWallet('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
    const analysis = analyzeWalletTransactions(wallet.address, wallet.transactions);
    const summary = summarizeIntelligence(wallet.address, wallet.transactions, analysis);
    assert.ok(wallet.transactions.length <= 50);
    assert.equal(analysis.totalReceivedWei, analysis.incomingTransactions.reduce((sum, row) => sum + BigInt(row.value), 0n));
    assert.equal(analysis.totalSentWei, analysis.outgoingTransactions.reduce((sum, row) => sum + BigInt(row.value), 0n));
    console.log(JSON.stringify({ provider: wallet.dataSource, retrieved: wallet.transactions.length, successful: analysis.successfulTransactionCount, observedDays: summary.timeline.length, unknown: summary.unknownStatuses }));
  } catch (error) {
    logEthereumFailure('wallet_lookup', error);
    console.error('Live public-wallet check failed. No raw provider errors logged.');
    process.exitCode = 1;
  }
})();
