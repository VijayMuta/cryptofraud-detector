const assert = require('node:assert/strict');
const { load } = require('./load-typescript.cjs');
const etherscan = load('src/lib/etherscan.ts');

function provider(t, initial) {
  const originals = [etherscan.fetchEthereumTransactions, etherscan.fetchMonitoringPage, etherscan.fetchMonitoringHeadBlock];
  let history = initial, failCall = null;
  const calls = [];
  etherscan.fetchEthereumTransactions = async (_address, limit) => structuredClone(history.slice().reverse().slice(0, limit));
  etherscan.fetchMonitoringHeadBlock = async () => Math.max(0, ...history.map(row => Number(row.blockNumber)));
  etherscan.fetchMonitoringPage = async (_address, from, to, page) => {
    calls.push({ from, to, page });
    if (calls.length === failCall) throw new Error('Simulated interrupted provider retrieval');
    return structuredClone(history.filter(row => Number(row.blockNumber) >= from && Number(row.blockNumber) <= to)
      .sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber) || a.hash.localeCompare(b.hash)).slice((page - 1) * 100, page * 100));
  };
  t.after(() => { [etherscan.fetchEthereumTransactions, etherscan.fetchMonitoringPage, etherscan.fetchMonitoringHeadBlock] = originals; });
  return { calls, setHistory(rows) { history = rows; }, failOnCall(n) { failCall = n; } };
}

// In-memory transaction/cursor contract simulator, NOT a PostgreSQL engine.
// Failure injection stages all writes, publishing them together at commit.
function database(options = {}) {
  let state = { monitor: options.monitor ? structuredClone(options.monitor) : null, transactions: [], alerts: [], last_successful_check_at: null, last_error: null, cursor: null };
  let failure = null;
  const calls = [];
  const enrollments = [];
  const abort = stage => { if (failure === stage) { failure = null; throw new Error('fixture persistence failure'); } };
  const initialize = () => {
    const boundary = Math.max(0, ...state.transactions.map(row => Number(row.block_number)));
    state.cursor = { confirmedBlock: boundary, scanFrom: boundary + 1, scanTo: null, nextPage: 1, revision: (state.cursor?.revision ?? -1) + 1 };
  };
  const cursor = () => ({ ...state.cursor, context: state.transactions.slice().sort((a, b) => Number(a.block_number) - Number(b.block_number) || a.transaction_hash.localeCompare(b.transaction_hash)).slice(-100).map(row => ({
    hash: row.transaction_hash, blockNumber: String(row.block_number), timestamp: row.occurred_at,
    from: row.from_address, to: row.to_address, value: row.value_wei, status: row.status,
  })) });
  return {
    calls,
    enrollments,
    get state() { return structuredClone(state); },
    failAt(stage) { failure = stage; },
    setActive(active) {
      state.monitor.is_active = active;
      state.monitor.updated_at = new Date(Date.parse(state.monitor.updated_at) + 1).toISOString();
    },
    async rpc(name, input) {
      if (name === 'enroll_wallet_monitor') {
        enrollments.push(structuredClone(input));
        const draft = structuredClone(state);
        try {
          abort('enrollment-rpc');
          if (options.role && options.role !== 'service_role') throw new Error('permission denied');
          const stale = () => { throw Object.assign(new Error('stale enrollment'), { code: '40001' }); };
          if (input.p_monitor_id === null) {
            if (draft.monitor) stale();
            draft.monitor = { id: '11111111-1111-4111-8111-111111111111', user_id: input.p_user_id,
              address: input.p_address, network: 'ethereum', is_active: false, updated_at: input.p_checked_at };
          } else {
            const m = draft.monitor;
            if (!m || m.id !== input.p_monitor_id || m.user_id !== input.p_user_id || m.address !== input.p_address || m.network !== 'ethereum') throw new Error('monitor not found');
            if (!input.p_expected_updated_at || input.p_expected_updated_at !== m.updated_at) stale();
          }
          if (draft.monitor.is_active) stale();
          for (const row of input.p_transactions) {
            if (!draft.transactions.some(saved => saved.transaction_hash === row.transaction_hash)) {
              draft.transactions.push({ ...row, monitor_id: draft.monitor.id, analysis: null });
            }
          }
          abort('enrollment-baseline');
          const boundary = Math.max(0, ...draft.transactions.map(row => Number(row.block_number)));
          draft.cursor = { confirmedBlock: boundary, scanFrom: boundary + 1, scanTo: null, nextPage: 1, revision: (draft.cursor?.revision ?? -1) + 1 };
          abort('enrollment-cursor');
          draft.last_successful_check_at = input.p_checked_at; draft.last_error = null;
          Object.assign(draft.monitor, { is_active: true, updated_at: input.p_checked_at,
            last_checked_at: input.p_checked_at, last_successful_check_at: input.p_checked_at, last_error: null });
          abort('enrollment-activation');
          state = draft;
          abort('enrollment-response');
          return { error: null, data: { monitor: structuredClone(draft.monitor), baselineTransactionCount: input.p_transactions.length } };
        } catch (error) { return { error, data: null }; }
      }
      if (name === 'get_wallet_monitor_cursor') {
        if (!state.cursor || input.p_reset) initialize();
        return { data: structuredClone(cursor()), error: null };
      }
      assert.equal(name, 'persist_wallet_monitor_page');
      calls.push(structuredClone(input));
      const draft = structuredClone(state), fresh = new Set();
      try {
        abort('missing-rpc');
        if (input.p_expected_revision !== draft.cursor.revision || input.p_scan_from !== draft.cursor.scanFrom ||
            input.p_page !== draft.cursor.nextPage || (draft.cursor.scanTo !== null && draft.cursor.scanTo !== input.p_scan_to)) throw new Error('stale cursor');
        assert.equal(input.p_complete, input.p_transactions.length < 100);
        for (const row of input.p_transactions) {
          if (draft.transactions.some(saved => saved.transaction_hash === row.transaction_hash)) continue;
          draft.transactions.push({ ...row, analysis: input.p_analysis }); fresh.add(row.transaction_hash);
        }
        abort('transactions');
        let alertCount = 0;
        for (const row of input.p_alerts) {
          if (!fresh.has(row.source_transaction_hash)) continue;
          if (draft.alerts.some(saved => saved.source_transaction_hash === row.source_transaction_hash && saved.alert_type === row.alert_type)) continue;
          draft.alerts.push(row); alertCount++;
        }
        abort('alerts');
        if (input.p_complete) {
          if (input.p_scan_to > draft.cursor.confirmedBlock &&
              !draft.transactions.some(row => row.block_number === input.p_scan_to)) throw new Error('missing witnessed head');
          draft.last_successful_check_at = input.p_checked_at; draft.last_error = null;
          draft.cursor.confirmedBlock = input.p_scan_to; draft.cursor.scanFrom = input.p_scan_to + 1;
          draft.cursor.scanTo = null; draft.cursor.nextPage = 1;
        } else {
          const last = Math.max(...input.p_transactions.map(row => row.block_number));
          draft.cursor.scanTo = input.p_scan_to; draft.cursor.scanFrom = last;
          draft.cursor.nextPage = last > input.p_scan_from ? 1 : input.p_page + 1;
          draft.last_error = 'Monitoring coverage is incomplete';
        }
        abort('status');
        draft.cursor.revision++;
        abort('cursor');
        state = draft;
        abort('response');
        return { error: null, data: { newTransactionCount: fresh.size, newAlertCount: alertCount, cursor: structuredClone(cursor()) } };
      } catch (error) { return { error, data: null }; }
    },
    from(table) { return {
      select() {
        assert.equal(table, 'wallet_monitors');
        const filters = [];
        return { eq(key, value) { filters.push([key, value]); return this; }, async maybeSingle() {
          const m = state.monitor;
          return { data: m && filters.every(([key, value]) => m[key] === value) ? structuredClone(m) : null, error: null };
        } };
      },
      update(patch) {
        assert.equal(table, 'wallet_monitors');
        assert.deepEqual(Object.keys(patch).sort(), ['last_checked_at', 'last_error']);
        return { async eq(column) { assert.equal(column, 'id'); Object.assign(state, patch); return { error: null }; } };
      },
    }; },
  };
}

module.exports = { provider, database };
