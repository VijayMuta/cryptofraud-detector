const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const { load } = require('./load-typescript.cjs');
const { validateBookmark } = load('src/lib/case-bookmarks.ts');
const { validateActivityMetadata, ACTIVITY_DEFINITIONS, exportActivity } = load('src/lib/case-activity.ts');
const caseId = '11111111-1111-4111-8111-111111111111', otherCase = '22222222-2222-4222-8222-222222222222';
const bookmarkId = '33333333-3333-4333-8333-333333333333', userId = '44444444-4444-4444-8444-444444444444';
const hash = '0x' + 'a'.repeat(64), input = { transactionHash: hash, network: 'ethereum' };
test('bookmark validation canonicalizes hash and accepts only known networks/labels', () => {
  assert.deepEqual(validateBookmark({ ...input, transactionHash: '0x' + 'A'.repeat(64) }), { transaction_hash: hash, network: 'ethereum', label: null });
  for (const label of [null, 'Review', 'Key transfer', 'Follow up']) assert.equal(validateBookmark({ ...input, label }).label, label);
  for (const body of [null, [], {}, { ...input, network: 'bitcoin' }, { ...input, transactionHash: 'bad' }, { ...input, transactionHash: hash + '0' }, { ...input, label: '<script>secret</script>' }, { ...input, label: 'x'.repeat(10000) }]) assert.throws(() => validateBookmark(body));
});
test('arbitrary metadata, credentials, API payloads, identity and timestamp fields are rejected', () => {
  for (const key of ['metadata', 'response', 'apiKey', 'password', 'authorization', 'cookie', 'created_by', 'case_id', 'created_at', 'noteText']) assert.throws(() => validateBookmark({ ...input, [key]: { sensitive: 'secret' } }));
  assert.throws(() => validateBookmark(JSON.parse('{"transactionHash":"' + hash + '","network":"ethereum","__proto__":{}}')));
});
test('bookmark audit metadata and exported events contain identifiers only', () => {
  const metadata = { bookmarkId, transactionHash: hash, network: 'ethereum' };
  for (const event_type of ['EVIDENCE_BOOKMARK_CREATED', 'EVIDENCE_BOOKMARK_REMOVED']) {
    assert.deepEqual(validateActivityMetadata(event_type, metadata), metadata);
    for (const extra of ['label', 'response', 'metadata', 'token']) assert.throws(() => validateActivityMetadata(event_type, { ...metadata, [extra]: 'private' }));
    assert.throws(() => validateActivityMetadata(event_type, { ...metadata, bookmarkId: 'bad' }));
    const json = exportActivity(caseId, [{ id: bookmarkId, case_id: caseId, actor_user_id: userId, event_type, metadata, origin: 'database', event_timestamp: '2026-09-26T00:00:00Z' }], '2026-09-26T00:00:00Z');
    assert.equal(JSON.parse(json).events[0].metadata.transactionHash, hash);
  }
});
test('API ownership, creation, duplicates, case scoping, removal and safe errors', async t => {
  const auth = load('src/lib/request-auth.ts'), adminModule = load('src/lib/supabase-admin.ts'), cases = load('src/lib/cases.ts');
  const originals = [auth.getRequestUser, adminModule.getSupabaseAdmin, cases.getOwnedCase];
  t.after(() => { [auth.getRequestUser, adminModule.getSupabaseAdmin, cases.getOwnedCase] = originals; });
  const { NextRequest } = require('next/server'), route = load('src/app/api/cases/[id]/bookmarks/route.ts');
  const params = { params: { id: caseId } };
  const req = (method, body, query = '') => new NextRequest('http://localhost/api/cases/' + caseId + '/bookmarks' + query, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let touched = 0, rows = [], failure = null;
  const queries = [];
  adminModule.getSupabaseAdmin = () => ({ from(table) {
    assert.equal(table, 'case_evidence_bookmarks'); touched++;
    let inserted, deleting = false; const filters = [];
    return {
      select() { if (deleting) {
        queries.push(filters);
        if (failure) return Promise.resolve({ error: failure });
        const removed = rows.filter(row => filters.every(([key, value]) => row[key] === value));
        rows = rows.filter(row => !removed.includes(row));
        return Promise.resolve({ data: removed.map(row => ({ id: row.id })), error: null });
      } return this; },
      eq(key, value) { filters.push([key, value]); return this; },
      order(key, options) { queries.push([key, options]); return this; },
      range(from, to) { queries.push(filters); return Promise.resolve({ data: rows.filter(row => filters.every(([key, value]) => row[key] === value)).slice(from, to + 1), error: failure }); },
      insert(row) { inserted = row; return this; }, delete() { deleting = true; return this; },
      single() {
        if (failure) return Promise.resolve({ error: failure });
        if (rows.some(row => row.case_id === inserted.case_id && row.network === inserted.network && row.transaction_hash === inserted.transaction_hash)) return Promise.resolve({ error: { code: '23505' } });
        const data = { id: bookmarkId, created_at: '2026-09-26T00:00:00Z', ...inserted }; rows.push(data); return Promise.resolve({ data });
      },
    };
  } });
  auth.getRequestUser = async () => null;
  for (const method of ['GET', 'POST', 'DELETE']) assert.equal((await route[method](req(method, method === 'POST' ? input : undefined), params)).status, 401);
  auth.getRequestUser = async () => ({ id: userId }); cases.getOwnedCase = async () => null;
  for (const method of ['GET', 'POST', 'DELETE']) assert.equal((await route[method](req(method, method === 'POST' ? input : undefined), params)).status, 404);
  assert.equal(touched, 0);
  cases.getOwnedCase = async (_admin, user, id) => { assert.equal(user, userId); assert.equal(id, caseId); return { id }; };
  assert.equal((await route.POST(req('POST', input), { params: { id: 'bad' } })).status, 404);
  assert.equal((await route.POST(req('POST', { ...input, created_by: 'spoof' }), params)).status, 400);
  assert.equal((await route.POST(req('POST', { ...input, response: { secret: 'x' } }), params)).status, 400);
  assert.equal((await route.POST(req('POST', { ...input, label: 'x'.repeat(3000) }), params)).status, 413);
  assert.equal(touched, 0);
  const created = await route.POST(req('POST', input), params);
  assert.equal(created.status, 201); assert.equal(created.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await created.json()).bookmark, { id: bookmarkId, created_at: '2026-09-26T00:00:00Z', case_id: caseId, created_by: userId, transaction_hash: hash, network: 'ethereum', label: null });
  assert.equal((await route.POST(req('POST', { ...input, transactionHash: '0x' + 'A'.repeat(64) }), params)).status, 409);
  assert.equal(rows.length, 1);
  rows.push({ ...rows[0], id: otherCase, case_id: otherCase });
  const listed = await (await route.GET(req('GET'), params)).json(); assert.equal(listed.bookmarks.length, 1);
  assert.ok(queries.some(q => q[0] === 'created_at' && q[1].ascending === false));
  assert.equal((await route.GET(req('GET', undefined, '?offset=-1'), params)).status, 400);
  assert.equal((await route.DELETE(req('DELETE', undefined, '?bookmarkId=bad'), params)).status, 400);
  assert.equal((await route.DELETE(req('DELETE', undefined, '?bookmarkId=' + otherCase), params)).status, 404);
  assert.equal(rows.length, 2);
  assert.equal((await route.DELETE(req('DELETE', undefined, '?bookmarkId=' + bookmarkId), params)).status, 200);
  assert.equal(rows.length, 1); assert.equal(rows[0].case_id, otherCase);
  assert.equal((await route.DELETE(req('DELETE', undefined, '?bookmarkId=' + bookmarkId), params)).status, 404);
  assert.deepEqual((await (await route.GET(req('GET'), params)).json()).bookmarks, []);
  failure = { message: 'provider secret' };
  for (const method of ['GET', 'POST', 'DELETE']) {
    const result = await route[method](req(method, method === 'POST' ? input : undefined, '?bookmarkId=' + bookmarkId), params);
    assert.equal(result.status, 503); assert.doesNotMatch(await result.text(), /provider secret/);
  }
});
test('generic activity API rejects both database-only bookmark event types', async t => {
  const auth = load('src/lib/request-auth.ts'), adminModule = load('src/lib/supabase-admin.ts'), cases = load('src/lib/cases.ts');
  const originals = [auth.getRequestUser, adminModule.getSupabaseAdmin, cases.getOwnedCase];
  t.after(() => { [auth.getRequestUser, adminModule.getSupabaseAdmin, cases.getOwnedCase] = originals; });
  auth.getRequestUser = async () => ({ id: userId }); cases.getOwnedCase = async () => ({ id: caseId });
  adminModule.getSupabaseAdmin = () => ({ from() { throw Error('Unexpected insert'); } });
  const { NextRequest } = require('next/server'), route = load('src/app/api/cases/[id]/activity/route.ts');
  for (const eventType of ['EVIDENCE_BOOKMARK_CREATED', 'EVIDENCE_BOOKMARK_REMOVED']) {
    const req = new NextRequest('http://localhost', { method: 'POST', body: JSON.stringify({ eventType, metadata: { bookmarkId, transactionHash: hash, network: 'ethereum' }, operationId: bookmarkId }) });
    assert.equal((await route.POST(req, { params: { id: caseId } })).status, 400);
  }
});
test('migration retains every activity type, denies browser writes and defines atomic minimal audit triggers', () => {
  const sql = fs.readFileSync('supabase-case-bookmarks.sql', 'utf8');
  for (const type of Object.keys(ACTIVITY_DEFINITIONS)) assert.ok(sql.includes("'" + type + "'"));
  assert.match(sql, /unique\(case_id, network, transaction_hash\)/);
  assert.match(sql, /transaction_hash ~ '\^0x\[0-9a-f\]\{64\}\$'/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public.case_evidence_bookmarks from public, anon, authenticated/);
  assert.match(sql, /c.id = case_id and c.created_by = auth.uid\(\)/);
  assert.doesNotMatch(sql, /for (insert|update|delete) to authenticated/i);
  assert.match(sql, /created_by = new.created_by for share/);
  assert.match(sql, /after insert or delete on public.case_evidence_bookmarks/);
  const audit = sql.split('function public.record_case_bookmark_activity() returns trigger')[1].split('end; $$;')[0];
  assert.match(audit, /jsonb_build_object\('bookmarkId',row_data.id,'transactionHash',row_data.transaction_hash,'network',row_data.network\)/);
  assert.doesNotMatch(audit, /row_data.label|exception when|response|token/i);
  assert.match(audit, /if owner_id is null then return row_data/);
});
