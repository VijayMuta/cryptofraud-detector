const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./load-typescript.cjs');
const { CASE_LIST_PAGE_SIZE: PAGE, CASE_WALLET_BATCH_SIZE: BATCH } = load('src/lib/case-list.ts');
const auth = load('src/lib/request-auth.ts');
const server = load('src/lib/supabase-admin.ts');
const route = load('src/app/api/cases/route.ts');
const detailRoute = load('src/app/api/cases/[id]/route.ts');
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const OWNER = uuid(900000), FOREIGN = uuid(900001);
const stamp = '2026-01-01T00:00:00.000Z';
function fixture(caseCount, walletsPerCase = 8) {
  const cases = Array.from({ length: caseCount }, (_, i) => ({ id: uuid(i + 1), created_by: OWNER, case_code: `CT-${i + 1}`, title: 'Fixture', description: '', status: 'open', created_at: stamp, updated_at: stamp }));
  const wallets = cases.flatMap((row, i) => Array.from({ length: walletsPerCase }, (_, j) => ({ id: uuid(10000 + i * walletsPerCase + j), case_id: row.id, address: '0x' + (i * walletsPerCase + j + 1).toString(16).padStart(40, '0'), network: 'ethereum', added_by: OWNER, added_at: stamp })));
  return { cases, wallets };
}
// Model filters, stable ordering, and a server cap independently of requested limits.
function database(data, { cap = 1000, fault, beforeRead } = {}) {
  const calls = [];
  return { calls, from(table) {
    const filters = [], orders = [];
    let limit = Infinity, single = false;
    const q = {
      select() { return q; },
      eq(key, value) { filters.push(['eq', key, value]); return q; },
      in(key, values) { filters.push(['in', key, values]); return q; },
      gt(key, value) { filters.push(['gt', key, value]); return q; },
      order(key, options) { orders.push([key, options.ascending]); return q; },
      limit(value) { limit = value; return q; },
      maybeSingle() { single = true; return q; },
      then(resolve, reject) {
        const call = { table, filters, orders, limit, index: calls.length };
        calls.push(call);
        return Promise.resolve().then(() => {
          beforeRead?.(call, data);
          const failure = fault?.(call);
          if (failure) return failure;
          let rows = [...(table === 'investigation_cases' ? data.cases : data.wallets)];
          for (const [op, key, value] of filters) rows = rows.filter(row => op === 'eq' ? row[key] === value : op === 'in' ? value.includes(row[key]) : row[key] > value);
          rows.sort((a, b) => { for (const [key, asc] of orders) { const diff = a[key].localeCompare(b[key]); if (diff) return diff * (asc ? 1 : -1); } return 0; });
          rows = rows.slice(0, Math.min(cap, limit));
          return { data: single ? rows[0] || null : rows, error: null };
        }).then(resolve, reject);
      },
    };
    return q;
  } };
}
function setup(t, data, options) {
  const originals = [auth.getRequestUser, server.getSupabaseAdmin];
  const db = database(data, options);
  auth.getRequestUser = async () => ({ id: OWNER });
  server.getSupabaseAdmin = () => db;
  t.after(() => { [auth.getRequestUser, server.getSupabaseAdmin] = originals; });
  return db;
}
const request = () => new Request('http://localhost/api/cases');
async function result() { const response = await route.GET(request()); return { response, body: await response.json() }; }

test('AUD-NEXT-01: >1000 wallets, multiple case pages/batches, tied timestamps, and detail membership', async t => {
  const data = fixture(PAGE + 1);
  data.cases.push({ ...data.cases[0], id: uuid(800000), created_by: FOREIGN });
  data.wallets.push({ ...data.wallets[0], id: uuid(800001), case_id: uuid(800000), added_by: FOREIGN });
  data.cases.reverse(); data.wallets.reverse();
  const db = setup(t, data);
  const { response, body } = await result();
  assert.equal(response.status, 200); assert.equal(body.success, true);
  assert.equal(body.cases.length, PAGE + 1);
  assert.equal(body.cases.flatMap(row => row.wallets).length, (PAGE + 1) * 8);
  assert.equal(new Set(body.cases.map(row => row.id)).size, PAGE + 1);
  assert.equal(new Set(body.cases.flatMap(row => row.wallets.map(wallet => wallet.id))).size, (PAGE + 1) * 8);
  assert.deepEqual(body.cases.map(row => row.id), [...body.cases.map(row => row.id)].sort());
  for (const row of body.cases) {
    assert.equal(row.created_by, OWNER);
    assert.equal(row.wallets.length, 8);
    assert.deepEqual(row.wallets.map(w => w.id), [...row.wallets.map(w => w.id)].sort());
    assert.ok(row.wallets.every(w => w.case_id === row.id && w.added_by === OWNER));
  }
  for (const call of db.calls) {
    assert.deepEqual(call.orders, [['id', true]]);
    assert.equal(call.limit, PAGE);
    if (call.table === 'investigation_cases') assert.ok(call.filters.some(f => f[1] === 'created_by' && f[2] === OWNER));
    else { const ids = call.filters.find(f => f[0] === 'in')[2]; assert.ok(ids.length <= BATCH); assert.ok(!ids.includes(uuid(800000))); }
  }
  for (const row of [body.cases[0], body.cases[BATCH], body.cases.at(-1)]) {
    const detail = await detailRoute.GET(request(), { params: Promise.resolve({ id: row.id }) });
    assert.deepEqual((await detail.json()).case.wallets.map(w => w.id).sort(), row.wallets.map(w => w.id).sort());
  }
});

for (const count of [0, PAGE - 1, PAGE, PAGE + 1]) test(`AUD-NEXT-01: case boundary ${count} exhausts with an empty page`, async t => {
  const db = setup(t, fixture(count, 0));
  const { body } = await result();
  assert.equal(body.success, true); assert.equal(body.cases.length, count);
  assert.equal(db.calls.filter(c => c.table === 'investigation_cases').length, Math.ceil(count / PAGE) + 1);
  if (!count) assert.equal(db.calls.length, 1);
});

test('AUD-NEXT-01: database cap below requested page size cannot truncate either dataset', async t => {
  setup(t, fixture(11), { cap: 3 });
  const { body } = await result();
  assert.equal(body.cases.length, 11);
  assert.equal(body.cases.flatMap(c => c.wallets).length, 88);
});

test('AUD-NEXT-01: final display order preserves timestamps and uses IDs only to break ties', async t => {
  const data = fixture(3, 3);
  for (const row of data.cases) row.updated_at = '2026-01-01T00:00:00+00:00';
  for (const row of data.wallets) row.added_at = '2026-01-01T00:00:00+00:00';
  data.cases[1].updated_at = '2026-01-01T00:00:00.000001+00:00';
  data.wallets[0].added_at = '2026-01-01T00:00:00.000001+00:00';
  setup(t, data, { cap: 2 });
  const { body } = await result();
  assert.deepEqual(body.cases.map(c => c.id), [data.cases[1].id, data.cases[0].id, data.cases[2].id]);
  assert.deepEqual(body.cases[1].wallets.map(w => w.id), [data.wallets[1].id, data.wallets[2].id, data.wallets[0].id]);
});

test('AUD-NEXT-01: timestamp changes between pages cannot shift immutable ID cursors', async t => {
  const data = fixture(PAGE + 1, 1);
  setup(t, data, { beforeRead(call) {
    if (call.table === 'investigation_cases' && call.filters.some(f => f[0] === 'gt')) data.cases.at(-1).updated_at = '2027-01-01T00:00:00.000Z';
    if (call.table === 'case_wallets') data.wallets[0].added_at = '2025-01-01T00:00:00.000Z';
  } });
  const { body } = await result();
  assert.equal(body.cases.length, PAGE + 1);
  assert.equal(body.cases[0].id, data.cases.at(-1).id);
  assert.equal(new Set(body.cases.map(c => c.id)).size, PAGE + 1);
});

for (const stage of ['case-page', 'wallet-page', 'wallet-batch', 'transport', 'invalid-data', 'repeated-page']) {
  test(`AUD-NEXT-01: ${stage} failure never returns partial success`, async t => {
    const data = fixture(PAGE + 1);
    setup(t, data, { fault(call) {
      const next = call.filters.some(f => f[0] === 'gt');
      const wallets = call.table === 'case_wallets';
      const laterBatch = wallets && call.filters.find(f => f[0] === 'in')[2][0] !== data.cases[0].id;
      if ((stage === 'case-page' && !wallets && next) || (stage === 'wallet-page' && wallets && next) || (stage === 'wallet-batch' && laterBatch)) return { data: [], error: { message: 'private database error' } };
      if (stage === 'transport' && wallets && next) throw new Error('private network error');
      if (stage === 'invalid-data' && wallets && next) return { data: null, error: null };
      if (stage === 'repeated-page' && !wallets && next) return { data: [data.cases[0]], error: null };
    } });
    const { response, body } = await result();
    assert.equal(response.status, 500); assert.equal(body.success, false);
    assert.equal(body.cases, undefined); assert.match(body.error, /complete cases and wallets/);
    assert.doesNotMatch(body.error, /private/);
  });
}

test('AUD-NEXT-01: unauthenticated callers never query the database', async t => {
  const db = setup(t, fixture(1));
  auth.getRequestUser = async () => null;
  const { response, body } = await result();
  assert.equal(response.status, 401); assert.equal(body.success, false); assert.equal(db.calls.length, 0);
});

test('AUD-NEXT-01: all five consumer load effects display retrieval failure rather than an empty-case claim', async t => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const browser = load('src/lib/supabase.ts');
  const originals = [React.useState, React.useEffect, React.useMemo, React.useCallback, React.useRef, browser.getSupabaseBrowser, global.fetch, global.window];
  t.after(() => { [React.useState, React.useEffect, React.useMemo, React.useCallback, React.useRef, browser.getSupabaseBrowser, global.fetch, global.window] = originals; });
  setup(t, fixture(PAGE + 1), { fault: call => call.table === 'case_wallets' ? { data: null, error: {} } : null });
  browser.getSupabaseBrowser = () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) } });
  global.fetch = async () => route.GET(request());
  global.window = { location: { search: '' } };
  for (const path of ['freeze-hold', 'fund-flow', 'investigation-timeline', 'reports', 'reports/evidence-package']) {
    const Page = load(`src/app/(dashboard)/${path}/page.tsx`).default;
    const state = [], effects = []; let index = 0;
    React.useState = initial => { const i = index++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; };
    React.useEffect = effect => { effects.push(effect); };
    React.useMemo = factory => factory(); React.useCallback = callback => callback; React.useRef = value => ({ current: value });
    Page();
    const cleanup = effects.map(effect => effect());
    for (let i = 0; i < 30 && !state.some(value => typeof value === 'string' && value.includes('complete cases and wallets')); i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(state.some(value => typeof value === 'string' && value.includes('complete cases and wallets')), path);
    index = 0; React.useEffect = () => {};
    const html = renderToStaticMarkup(Page());
    assert.match(html, /role="alert"/); assert.match(html, /Unable to load complete cases and wallets/);
    assert.doesNotMatch(html, /No cases available|No wallets in this case|No case wallets/);
    for (const fn of cleanup) if (typeof fn === 'function') fn();
  }
});
