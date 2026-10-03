const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { load } = require('./load-typescript.cjs');
const { analyzeWalletTransactions, fundingSourcesFor, hasPositiveTransferredValue, directionFor, formatEth } = load('src/lib/wallet-analysis.ts');
const { BlockchainWorkspace } = load('src/components/blockchain-workspace.tsx');
const history = load('src/lib/case-history.ts');
const { analyzeCaseConnection } = load('src/lib/case-analysis.ts');
const A = `0x${'a'.repeat(40)}`, B = `0x${'b'.repeat(40)}`, C = `0x${'c'.repeat(40)}`;
const tx = (n, from, to, value = '0') => ({ hash: `0x${n.toString(16).padStart(64, '0')}`, from, to, value, timestamp: '2026-01-01T00:00:00.000Z', blockNumber: '1', status: 'success' });
const input = (id, wallets) => ({ id, caseCode: id, title: id, wallets });

test('AUD-H02: zero incoming/outgoing remain observable with unchanged direction and no funding label', () => {
  for (const row of [tx(1, B, A), tx(2, A, B)]) {
    const analysis = analyzeWalletTransactions(A, [row]);
    assert.deepEqual(fundingSourcesFor(analysis), []);
    assert.equal(directionFor(row, A), row.from === A ? 'outgoing' : 'incoming');
    assert.equal(analysis.counterparties.length, 1);
    assert.equal(analysis.successfulTransactionCount, 1);
    assert.equal([...analysis.incomingTransactions, ...analysis.outgoingTransactions][0].hash, row.hash);
    const html = renderToStaticMarkup(React.createElement(BlockchainWorkspace, { address: A, transactions: [row], analysis }));
    assert.match(html, /Funding sources \(0\)/);
    assert.doesNotMatch(html, /<td>Funding source/);
    assert.ok(html.includes(row.hash));
    assert.match(html, /0 ETH/);
    assert.match(html, row.from === A ? /Destination/ : /Incoming counterparty/);
  }
});

test('AUD-H02: positive funding counts exclude zero interactions and preserve exact evidence and A2 formatting', () => {
  const positive = tx(3, B, A, '1000000000000000001');
  const analysis = analyzeWalletTransactions(A, [tx(1, B, A), positive]);
  assert.equal(analysis.counterparties[0].incomingCount, 2);
  assert.deepEqual(fundingSourcesFor(analysis), [{ address: B, incomingCount: 1, outgoingCount: 0, incomingWei: 1000000000000000001n, outgoingWei: 0n }]);
  assert.deepEqual(analysis.incomingTransactions[1], { ...positive, direction: 'incoming', valueWei: 1000000000000000001n, timestampMs: Date.parse(positive.timestamp) });
  assert.equal(formatEth(1000000000000000001n), '1 ETH');
  assert.equal(formatEth(1n), '<0.000001 ETH');
  assert.equal(hasPositiveTransferredValue(tx(4, B, A, '1')), true);
  assert.equal(hasPositiveTransferredValue(tx(4, B, A, '000')), false);
  const html = renderToStaticMarkup(React.createElement(BlockchainWorkspace, { address: A, transactions: [positive], analysis }));
  assert.match(html, /Funding sources \(1\)/);
  assert.match(html, /<td>Funding source/);
});

test('AUD-H02: absent/malformed amounts are not mutated or asserted to be zero by the funding predicate', () => {
  for (const value of [undefined, null, '', 'unavailable', 'bad']) {
    const row = { value };
    assert.equal(hasPositiveTransferredValue(row), false);
    assert.equal(row.value, value);
  }
});

test('AUD-H02: case funding requires positive evidence on both sides; other relationships are preserved', async t => {
  const original = history.fetchCaseTransactionHistory;
  t.after(() => { history.fetchCaseTransactionHistory = original; });
  const zeroA = tx(1, C, A), zeroB = tx(2, C, B);
  let rows = [zeroA, zeroB];
  history.fetchCaseTransactionHistory = async address => rows.filter(row => row.from === address || row.to === address);
  const run = () => analyzeCaseConnection(input('a', [A]), input('b', [B]));
  const zero = await run();
  assert.deepEqual(zero.sharedSources, []);
  assert.equal(zero.sharedCounterparties.length, 1);
  assert.equal(zero.temporalRelationships.length, 1);
  assert.equal(zero.walletActivity[0].latestTransactions[0].hash, zeroA.hash);
  assert.equal(zero.walletActivity[0].latestTransactions[0].valueEth, '0 ETH');
  assert.doesNotMatch(zero.riskSignals.join(' '), /sent funds/);
  const positiveA = tx(3, C, A, '1000000000000000001');
  rows.push(positiveA);
  assert.deepEqual((await run()).sharedSources, []);
  const positiveB = tx(4, C, B, '1');
  rows.push(positiveB);
  const positive = await run();
  const source = positive.sharedSources[0];
  assert.equal(source.address, C);
  assert.deepEqual(source.caseATransactions, [{ hash: positiveA.hash, timestamp: positiveA.timestamp, observedBy: A, from: C, to: A, valueEth: '1 ETH' }]);
  assert.equal(source.caseBTransactions[0].hash, positiveB.hash);
  assert.equal(source.caseBTransactions[0].valueEth, '<0.000001 ETH');
  assert.equal(positive.source, zero.source);
  rows = [tx(5, A, C), tx(6, B, C), tx(7, A, B), tx(8, A, A)];
  const outgoing = await run();
  assert.deepEqual(outgoing.sharedSources, []);
  assert.equal(outgoing.sharedDestinations.length, 1);
  assert.equal(outgoing.directTransfers.length, 1);
  assert.equal(directionFor(rows[3], A), 'self');
  assert.equal(directionFor(tx(9, B, C), A), 'unclassified');
  rows = [zeroA, zeroB, positiveA, positiveB];
  const same = await analyzeCaseConnection(input('a', [A, B]), input('a', [A, B]), { sameCase: true });
  assert.equal(same.sharedSources.length, 1);
  assert.deepEqual(same.sharedSources[0].caseATransactions.map(row => row.hash).sort(), [positiveA.hash, positiveB.hash].sort());
});

test('AUD-H02: AI funding facts and citations use only positive case evidence', async t => {
  const cases = load('src/lib/cases.ts');
  const admin = load('src/lib/supabase-admin.ts');
  const { buildEvidence } = load('src/lib/ai-evidence.ts');
  const originals = [history.fetchCaseTransactionHistory, cases.getOwnedCase, cases.getCaseWallets, admin.getSupabaseAdmin];
  t.after(() => {
    [history.fetchCaseTransactionHistory, cases.getOwnedCase, cases.getCaseWallets, admin.getSupabaseAdmin] = originals;
  });
  admin.getSupabaseAdmin = () => ({});
  cases.getOwnedCase = async () => ({ id: 'case', case_code: 'CT-1', title: 'Test' });
  cases.getCaseWallets = async () => [{ address: A }, { address: B }];
  let rows = [tx(1, C, A), tx(2, C, B)];
  history.fetchCaseTransactionHistory = async address => rows.filter(row => row.to === address);
  const zero = await buildEvidence('user', { kind: 'case', value: 'case' });
  assert.ok(zero.facts.some(fact => fact.text === '0 shared funding source relationships in the returned analysis.'));
  assert.ok(zero.facts.some(fact => fact.text.startsWith(`Shared counterparty ${C}`)));
  assert.ok(!zero.facts.some(fact => fact.text.startsWith('Shared funding source ')));
  rows.push(tx(3, C, A, '1'), tx(4, C, B, '1'));
  const positive = await buildEvidence('user', { kind: 'case', value: 'case' });
  const funding = positive.facts.find(fact => fact.text.startsWith(`Shared funding source ${C}`));
  assert.deepEqual(funding.hashes.sort(), rows.slice(2).map(row => row.hash).sort());
});
