const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./load-typescript.cjs');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const OWNER = '11111111-1111-4111-8111-111111111111';
const KEY = '22222222-2222-4222-8222-222222222222';
const A = '0x' + 'a'.repeat(40);
function route(t, db, user = { id: OWNER }) {
  const auth = load('src/lib/request-auth.ts'), admin = load('src/lib/supabase-admin.ts');
  const originals = [auth.getRequestUser, admin.getSupabaseAdmin];
  auth.getRequestUser = async () => user;
  admin.getSupabaseAdmin = () => db;
  t.after(() => { [auth.getRequestUser, admin.getSupabaseAdmin] = originals; });
  return (body = {}, key = KEY) => load('src/app/api/cases/route.ts').POST(new Request('http://localhost/api/cases', {
    method: 'POST', headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ title: 'Test case', description: '', status: 'open', wallets: [A], ...body }),
  }));
}

test('AUD-M02: initial wallet insertion failure leaves no partially committed case', async t => {
  const committedCases = [];
  const db = {
    // Original sequential API commits the case before the wallet failure.
    from(table) {
      const query = {
        insert(row) { if (table === 'investigation_cases') committedCases.push({ id: KEY, ...row }); return query; },
        select() { return query; },
        single: async () => ({ data: committedCases[0], error: null }),
        then(resolve) { return Promise.resolve({ error: { code: '23514' } }).then(resolve); },
      };
      return query;
    },
    // A rejected transaction must expose no writes to the caller.
    rpc: async () => ({ data: null, error: { code: '23514' } }),
  };
  const result = await route(t, db)();
  assert.ok(result.status >= 500);
  assert.equal(committedCases.length, 0, 'wallet insertion failure must roll back the case');
});

// Isolated RPC contract model: staged writes become visible only on commit.
// SQL structure/security are checked below; this does not execute PostgreSQL.
function database() {
  let state = { cases: [], wallets: [], attempts: {} }, failure, queue = Promise.resolve();
  const calls = [];
  return {
    calls, get state() { return structuredClone(state); },
    fail(stage) { failure = stage; },
    deleteCase(id) { state.cases = state.cases.filter(row => row.id !== id); state.wallets = state.wallets.filter(row => row.case_id !== id); },
    from() { throw new Error('Sequential database writes are forbidden'); },
    rpc(name, args) {
      calls.push({ name, args });
      const run = queue.then(async () => {
        assert.equal(name, 'create_case_atomic');
        const fail = failure; failure = undefined;
        if (fail === 'rpc') return { data: null, error: { code: 'PGRST202', message: 'private database detail' } };
        const draft = structuredClone(state);
        const key = args.p_user_id + ':' + args.p_idempotency_key;
        const payload = JSON.stringify({ title: args.p_title, description: args.p_description, status: args.p_status, wallets: [...args.p_wallets].sort() });
        const previous = draft.attempts[key];
        if (previous && previous.payload !== payload) return { error: { code: 'PT409' } };
        let record = previous && draft.cases.find(row => row.id === previous.id);
        if (previous && !record) return { error: { code: 'PT410' } };
        if (!previous) {
          record = { id: randomUUID(), created_by: args.p_user_id, title: args.p_title, description: args.p_description,
            status: args.p_status, case_code: 'CF-TEST', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
          draft.cases.push(record);
          for (const address of args.p_wallets) {
            draft.wallets.push({ id: randomUUID(), case_id: record.id, address, network: 'ethereum', added_by: args.p_user_id, added_at: new Date().toISOString() });
            if (fail === 'wallet') return { error: { code: '23514' } };
          }
          draft.attempts[key] = { id: record.id, payload };
          if (fail === 'ledger') return { error: { code: 'XX000' } };
        }
        state = draft;
        if (fail === 'response') throw new Error('private transport detail after commit');
        return { data: { case: { ...record, wallets: draft.wallets.filter(row => row.case_id === record.id) }, created: !previous }, error: null };
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}

test('AUD-M02: complete creation returns existing consumer shape and authenticated owner', async t => {
  const db = database(), post = route(t, db);
  const result = await post({ user_id: 'spoofed', created_by: 'spoofed' }), body = await result.json();
  assert.equal(result.status, 201); assert.equal(body.created, true);
  assert.equal(body.case.id, db.state.cases[0].id);
  assert.equal(body.case.created_by, OWNER); assert.equal(body.case.wallets[0].added_by, OWNER);
  assert.equal(body.case.wallets[0].case_id, body.case.id); assert.equal(body.case.wallets[0].address, A);
  assert.equal(db.calls[0].args.p_user_id, OWNER);
});
for (const stage of ['wallet', 'ledger', 'rpc']) test(`AUD-M02: ${stage} failure rolls back and same-key retry succeeds`, async t => {
  const db = database(), post = route(t, db); db.fail(stage);
  assert.equal((await post()).status, 503);
  assert.deepEqual(db.state, { cases: [], wallets: [], attempts: {} });
  assert.equal((await post()).status, 201);
  assert.equal(db.state.cases.length, 1); assert.equal(db.state.wallets.length, 1);
});
test('AUD-M02: response lost after commit is safely replayed without duplicate case or wallets', async t => {
  const db = database(), post = route(t, db); db.fail('response');
  const failed = await post(); assert.equal(failed.status, 503);
  assert.ok(!(await failed.text()).includes('private transport'));
  const id = db.state.cases[0].id;
  const replay = await post(), body = await replay.json();
  assert.equal(replay.status, 200); assert.equal(body.created, false); assert.equal(body.case.id, id);
  assert.equal(db.state.cases.length, 1); assert.equal(db.state.wallets.length, 1);
});
test('AUD-M02: concurrent same-key requests converge on one committed case', async t => {
  const db = database(), post = route(t, db);
  const responses = await Promise.all(Array.from({ length: 6 }, () => post()));
  assert.equal(responses.filter(row => row.status === 201).length, 1);
  const bodies = await Promise.all(responses.map(row => row.json()));
  assert.equal(new Set(bodies.map(body => body.case.id)).size, 1);
  assert.equal(db.state.cases.length, 1); assert.equal(db.state.wallets.length, 1);
});
test('AUD-M02: concurrent retry after a failed transaction can create the complete case', async t => {
  const db = database(), post = route(t, db); db.fail('wallet');
  const responses = await Promise.all([post(), post()]);
  assert.deepEqual(responses.map(row => row.status), [503, 201]);
  assert.equal(db.state.cases.length, 1);
});
test('AUD-M02: identical details with different keys create distinct legitimate cases', async t => {
  const db = database(), post = route(t, db);
  const first = await (await post()).json(), second = await (await post({}, randomUUID())).json();
  assert.notEqual(first.case.id, second.case.id); assert.equal(db.state.cases.length, 2);
});
test('AUD-M02: the same key is isolated between authenticated owners', async t => {
  const db = database(), user = { id: OWNER }, post = route(t, db, user);
  const first = await (await post()).json(); user.id = KEY;
  const second = await (await post()).json();
  assert.notEqual(first.case.id, second.case.id);
  assert.equal(first.case.created_by, OWNER); assert.equal(second.case.created_by, KEY);
  assert.equal(db.state.cases.length, 2);
});
test('AUD-M02: same key with changed details conflicts instead of changing or creating a case', async t => {
  const db = database(), post = route(t, db); await post();
  assert.equal((await post({ title: 'Different title' })).status, 409);
  assert.equal(db.state.cases.length, 1); assert.equal(db.state.cases[0].title, 'Test case');
});
test('AUD-M02: deleted case cannot be recreated by a stale retry', async t => {
  const db = database(), post = route(t, db); const body = await (await post()).json(); db.deleteCase(body.case.id);
  assert.equal((await post()).status, 410); assert.equal(db.state.cases.length, 0);
});
test('AUD-M02: duplicate wallet inputs normalize to one association', async t => {
  const db = database(), post = route(t, db);
  const body = await (await post({ wallets: [A, A, ' ' + A + ' '] })).json();
  assert.equal(body.case.wallets.length, 1); assert.deepEqual(db.calls[0].args.p_wallets, [A]);
});
test('AUD-M02: zero and maximum wallets remain supported', async t => {
  const db = database(), post = route(t, db);
  assert.equal((await post({ wallets: [] })).status, 201);
  const wallets = Array.from({ length: 8 }, (_, i) => '0x' + (i + 1).toString(16).padStart(40, '0'));
  const result = await post({ wallets }, randomUUID());
  assert.equal(result.status, 201); assert.equal((await result.json()).case.wallets.length, 8);
});
test('AUD-M02: valid checksummed input remains accepted and normalized', async t => {
  const db = database(), post = route(t, db);
  const address = '0x5Aeda56215b167893e80B4fE645BA6d5Bab767DE';
  // Use the existing validator's canonical checksum fixture.
  const valid = '0x52908400098527886E0F7030069857D2E4169EE7';
  const response = await post({ wallets: [valid, valid.toLowerCase()] });
  assert.equal(response.status, 201);
  assert.deepEqual(db.calls[0].args.p_wallets, [valid.toLowerCase()]);
  assert.equal((await post({ wallets: [address.slice(0, 3) + 'a' + address.slice(4)] }, randomUUID())).status, 400);
});
for (const [label, body] of [
  ['invalid address', { wallets: ['invalid'] }], ['non-string address', { wallets: [null] }],
  ['over limit', { wallets: Array.from({ length: 9 }, (_, i) => '0x' + (i + 1).toString(16).padStart(40, '0')) }],
  ['invalid title', { title: '' }], ['long description', { description: 'x'.repeat(5001) }], ['invalid status', { status: 'invalid' }],
]) test(`AUD-M02: ${label} rejected before RPC`, async t => {
  const db = database(); assert.equal((await route(t, db)(body)).status, 400); assert.equal(db.calls.length, 0);
});
test('AUD-M02: unauthorized requests never reach RPC', async t => {
  const db = database(); assert.equal((await route(t, db, null)()).status, 401); assert.equal(db.calls.length, 0);
});
test('AUD-M02: missing or invalid key rejected before RPC', async t => {
  const db = database(), post = route(t, db);
  for (const key of ['', 'invalid']) assert.equal((await post({}, key)).status, 400);
  assert.equal(db.calls.length, 0);
});
test('AUD-M02: RPC errors and invalid ownership responses never become success', async t => {
  const db = database(), post = route(t, db);
  for (const result of [{ error: { code: 'XX000', message: 'private-detail' } }, { data: null },
    { data: { created: true, case: { id: KEY, created_by: 'other', case_code: 'CF-X', wallets: [] } } }]) {
    db.rpc = async () => result;
    const response = await post(); assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('private-detail'));
  }
});

test('AUD-M02: migration uses a restricted atomic RPC, owner-scoped uniqueness and deletion tombstone', () => {
  const sql = fs.readFileSync('supabase-case-creation.sql', 'utf8');
  assert.match(sql, /primary key \(user_id, idempotency_key\)/i);
  assert.match(sql, /references auth\.users\(id\)/i);
  assert.match(sql, /references public\.investigation_cases\(id\) on delete set null/i);
  assert.match(sql, /alter table public\.case_creation_requests enable row level security/i);
  assert.match(sql, /language plpgsql security invoker set search_path = ''/i);
  assert.doesNotMatch(sql, /security definer|create policy/i);
  assert.match(sql, /revoke all on function public\.create_case_atomic[\s\S]*from public, anon, authenticated, service_role;/i);
  assert.match(sql, /grant execute on function public\.create_case_atomic[\s\S]*to service_role;/i);
  assert.match(sql, /grant select, insert, update on public\.case_creation_requests to service_role;/i);
  assert.match(sql, /on conflict \(user_id, idempotency_key\) do nothing/i);
  assert.match(sql, /where user_id = p_user_id and idempotency_key = p_idempotency_key for update/i);
  assert.match(sql, /attempt\.request_payload is distinct from payload/i);
  assert.match(sql, /where id = attempt\.case_id and created_by = p_user_id for share/i);
  assert.match(sql, /cardinality\(addresses\) > 8/);
  assert.equal(load('src/lib/case-constants.ts').MAX_WALLETS_PER_CASE, 8);
  assert.match(sql, /select distinct lower\(btrim\(address\)\)/i);
  const functionBody = sql.slice(sql.indexOf('begin\n', sql.indexOf('declare')), sql.indexOf('end;\n$$;'));
  assert.ok(functionBody.indexOf('insert into public.investigation_cases') < functionBody.indexOf('insert into public.case_wallets'));
  assert.doesNotMatch(functionBody.replace(/--[^\n]*/g, ''), /\bexception\s+when|\bcommit\b|\brollback\b/i);
});

function storage() {
  const entries = new Map();
  return { entries, getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
}
test('AUD-M02: browser attempt survives retry/reload and rotates only after confirmed success', async () => {
  const { caseCreationAttempt } = load('src/lib/case-creation-attempt.ts'), store = storage();
  const input = { title: ' Test case ', description: ' private note ', status: 'open', wallets: [A, A] };
  const first = await caseCreationAttempt(store, OWNER, input);
  const retry = await caseCreationAttempt(store, OWNER, { ...input, title: 'Test case', wallets: [A] });
  assert.equal(retry.key, first.key);
  assert.ok(!JSON.stringify([...store.entries]).includes('private note'));
  const otherOwner = await caseCreationAttempt(store, KEY, input); assert.notEqual(otherOwner.key, first.key);
  first.complete();
  const next = await caseCreationAttempt(store, OWNER, input); assert.notEqual(next.key, first.key);
});
test('AUD-M02: unavailable browser persistence fails before a creation request can be sent', async () => {
  const { caseCreationAttempt } = load('src/lib/case-creation-attempt.ts');
  await assert.rejects(caseCreationAttempt({ ...storage(), setItem() { throw new Error('storage unavailable'); } }, OWNER,
    { title: 'Test', description: '', status: 'open', wallets: [] }), /storage unavailable/);
});
test('AUD-M02: victim report draft uses the same keyed form without automatic case creation', () => {
  const { reportCaseDraft } = load('src/lib/victim-reports.ts');
  const page = fs.readFileSync('src/app/(dashboard)/cases/page.tsx', 'utf8');
  assert.equal(typeof reportCaseDraft, 'function');
  assert.match(page, /reportCaseDraft\(data.report\)/);
  assert.match(page, /'Idempotency-Key': attempt.key/);
  assert.match(page, /caseCreationAttempt\(window.sessionStorage, data.session.user.id/);
  assert.ok(page.indexOf('attempt.complete()') > page.indexOf('if (!created?.id'));
  assert.match(page, /current.filter\(item => item.id !== created.id\)/);
});
