const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const { load } = require('./load-typescript.cjs');
const { EVIDENCE_TAGS, validateTagAssignment } = load('src/lib/evidence-tags.ts');
const { ACTIVITY_DEFINITIONS, validateActivityMetadata, exportActivity } = load('src/lib/case-activity.ts');
const caseId = '11111111-1111-4111-8111-111111111111', otherCase = '22222222-2222-4222-8222-222222222222';
const bookmarkId = '33333333-3333-4333-8333-333333333333', otherBookmark = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555', otherUser = '66666666-6666-4666-8666-666666666666';
const now = '2026-09-29T00:00:00.000Z';

test('exact controlled tag identifiers only; arbitrary metadata and property tricks rejected', () => {
  assert.deepEqual(Object.values(EVIDENCE_TAGS), ['Exchange', 'Bridge', 'Mixer', 'Victim Transfer', 'Suspect Transfer', 'Funding Source', 'Destination', 'Intermediate Wallet', 'High Value', 'Review Required']);
  for (const tagId of Object.keys(EVIDENCE_TAGS)) assert.equal(validateTagAssignment({ tagId }), tagId);
  for (const value of [null, [], {}, 'exchange', { tagId: 'Exchange' }, { tagId: '__proto__' }, { tagId: 'toString' }, { tagId: 'fraud' }, { tagId: '<script>' }, { tagId: ['exchange'] }, { tagId: null }, Object.create({ tagId: 'exchange' })]) assert.throws(() => validateTagAssignment(value));
  for (const key of ['note', 'payload', 'metadata', 'created_by', 'created_at', 'case_id', 'bookmark_id', 'token', 'label']) assert.throws(() => validateTagAssignment({ tagId: 'exchange', [key]: 'secret' }));
  assert.throws(() => validateTagAssignment(Object.defineProperty({}, 'tagId', { get() { assert.fail('Getter executed'); } })));
  assert.throws(() => validateTagAssignment({ tagId: 'exchange', [Symbol('secret')]: true }));
});

test('tag audit metadata and export allow only bookmark UUID and controlled tag identifier', () => {
  for (const event_type of ['EVIDENCE_TAG_ADDED', 'EVIDENCE_TAG_REMOVED']) {
    for (const tagId of Object.keys(EVIDENCE_TAGS)) {
      const metadata = { bookmarkId, tagId };
      assert.deepEqual(validateActivityMetadata(event_type, metadata), metadata);
      const output = JSON.parse(exportActivity(caseId, [{ id: otherBookmark, case_id: caseId, actor_user_id: userId, event_type, metadata, origin: 'database', event_timestamp: now }], now));
      assert.deepEqual(output.events[0].metadata, metadata);
      for (const key of ['noteText', 'provider', 'response', 'token', 'label', 'transactionHash']) assert.throws(() => validateActivityMetadata(event_type, { ...metadata, [key]: 'secret' }));
    }
    for (const metadata of [{ bookmarkId: 'bad', tagId: 'exchange' }, { bookmarkId, tagId: 'unsafe' }, { bookmarkId }, { tagId: 'exchange' }]) assert.throws(() => validateActivityMetadata(event_type, metadata));
  }
});

test('API authentication, real ownership lookup, cross-account isolation, creation, duplicates and removal', async t => {
  const auth = load('src/lib/request-auth.ts'), adminModule = load('src/lib/supabase-admin.ts');
  const saved = [auth.getRequestUser, adminModule.getSupabaseAdmin];
  t.after(() => { [auth.getRequestUser, adminModule.getSupabaseAdmin] = saved; });
  const route = load('src/app/api/cases/[id]/bookmarks/[bookmarkId]/tags/route.ts');
  const bookmarksRoute = load('src/app/api/cases/[id]/bookmarks/route.ts');
  const { NextRequest } = require('next/server');
  const cases = [{ id: caseId, created_by: userId }, { id: otherCase, created_by: otherUser }];
  const bookmarks = [{ id: bookmarkId, case_id: caseId }, { id: otherBookmark, case_id: otherCase }];
  let rows = [], touched = [], failure = null, selectedFields = '';
  adminModule.getSupabaseAdmin = () => ({ from(table) {
    touched.push(table);
    let inserted, deleting = false; const filters = [];
    const execute = () => {
      if (failure && table === 'case_evidence_tags') return { error: failure };
      const source = table === 'investigation_cases' ? cases : table === 'case_evidence_bookmarks' ? bookmarks : rows;
      const matches = source.filter(row => filters.every(([key, value]) => row[key] === value));
      if (inserted) {
        if (rows.some(row => row.bookmark_id === inserted.bookmark_id && row.tag_id === inserted.tag_id)) return { error: { code: '23505' } };
        const data = { ...inserted, created_at: now }; rows.push(data); return { data };
      }
      if (deleting) rows = rows.filter(row => !matches.includes(row));
      return { data: matches };
    };
    return {
      select(fields) { if (table === 'case_evidence_bookmarks') selectedFields = fields; return this; },
      eq(key, value) { filters.push([key, value]); return this; },
      order() { return this; },
      maybeSingle: async () => { const result = execute(); return { ...result, data: result.data?.[0] || null }; },
      single: async () => execute(),
      insert(row) { assert.equal(table, 'case_evidence_tags'); inserted = row; return this; },
      delete() { assert.equal(table, 'case_evidence_tags'); deleting = true; return this; },
      range: async () => ({ data: execute().data.map(row => ({ ...row, tags: rows.filter(tag => tag.bookmark_id === row.id) })) }),
      then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
    };
  } });
  const call = (method, body = { tagId: 'exchange' }, id = caseId, bookmark = bookmarkId) => route[method](new NextRequest('http://localhost/api/tags', { method, ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }), { params: { id, bookmarkId: bookmark } });
  auth.getRequestUser = async () => null;
  for (const method of ['GET', 'POST', 'DELETE']) assert.equal((await call(method)).status, 401);
  assert.deepEqual(touched, []);
  auth.getRequestUser = async () => ({ id: userId });
  for (const method of ['GET', 'POST', 'DELETE']) {
    assert.equal((await call(method, undefined, otherCase, otherBookmark)).status, 404);
    assert.equal((await call(method, undefined, caseId, otherBookmark)).status, 404);
    assert.equal((await call(method, undefined, caseId, userId)).status, 404);
    assert.equal((await call(method, undefined, 'bad')).status, 404);
    assert.equal((await call(method, undefined, caseId, 'bad')).status, 400);
  }
  assert.ok(!touched.includes('case_evidence_tags'));
  for (const method of ['POST', 'DELETE']) {
    for (const body of [{ tagId: 'Exchange' }, { tagId: 'secret' }, { tagId: 'exchange', created_by: otherUser }, { tagId: 'exchange', metadata: { token: 'secret' } }, null, '{invalid']) assert.equal((await call(method, body)).status, 400);
    assert.equal((await call(method, { tagId: 'x'.repeat(1025) })).status, 413);
  }
  assert.equal(rows.length, 0);
  assert.deepEqual((await (await call('GET')).json()).tags, []);
  const result = await call('POST');
  assert.equal(result.status, 201); assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await result.json()).tag, { bookmark_id: bookmarkId, tag_id: 'exchange', created_by: userId, created_at: now });
  const duplicates = await Promise.all([call('POST'), call('POST')]);
  assert.deepEqual(duplicates.map(r => r.status), [409, 409]); assert.equal(rows.length, 1);
  assert.equal((await call('POST', { tagId: 'review_required' })).status, 201);
  rows.push({ bookmark_id: otherBookmark, tag_id: 'exchange', created_by: otherUser, created_at: now });
  assert.equal((await (await call('GET')).json()).tags.length, 2);
  // Listing saved evidence includes tags via one scoped relational select per page.
  const listing = await bookmarksRoute.GET(new NextRequest('http://localhost/api/bookmarks'), { params: { id: caseId } });
  assert.match(selectedFields, /tags:case_evidence_tags\(bookmark_id,tag_id,created_by,created_at\)/);
  const listed = (await listing.json()).bookmarks; assert.equal(listed.length, 1); assert.equal(listed[0].tags.length, 2);
  auth.getRequestUser = async () => ({ id: otherUser });
  for (const method of ['GET', 'POST', 'DELETE']) assert.equal((await call(method)).status, 404);
  assert.equal(rows.length, 3);
  auth.getRequestUser = async () => ({ id: userId });
  assert.equal((await call('DELETE')).status, 200);
  assert.equal((await call('DELETE')).status, 404);
  assert.equal(rows.length, 2); assert.ok(rows.some(row => row.bookmark_id === otherBookmark));
  assert.equal((await call('POST')).status, 201); // Explicit reclassification is allowed after removal.
  failure = { message: 'database secret', code: 'XX000' };
  for (const method of ['GET', 'POST', 'DELETE']) { const response = await call(method); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /database secret/); }
  failure = { code: '23503' };
  assert.equal((await call('POST')).status, 404);
});

test('generic activity API cannot fabricate database-only tag events', async t => {
  const auth = load('src/lib/request-auth.ts'), admin = load('src/lib/supabase-admin.ts'), cases = load('src/lib/cases.ts');
  const saved = [auth.getRequestUser, admin.getSupabaseAdmin, cases.getOwnedCase];
  t.after(() => { [auth.getRequestUser, admin.getSupabaseAdmin, cases.getOwnedCase] = saved; });
  auth.getRequestUser = async () => ({ id: userId }); cases.getOwnedCase = async () => ({ id: caseId });
  admin.getSupabaseAdmin = () => ({ from() { assert.fail('Must not write a fabricated event'); } });
  const route = load('src/app/api/cases/[id]/activity/route.ts'), { NextRequest } = require('next/server');
  for (const eventType of ['EVIDENCE_TAG_ADDED', 'EVIDENCE_TAG_REMOVED']) {
    const response = await route.POST(new NextRequest('http://localhost', { method: 'POST', body: JSON.stringify({ eventType, metadata: { bookmarkId, tagId: 'exchange' }, operationId: bookmarkId }) }), { params: { id: caseId } });
    assert.equal(response.status, 400);
  }
});

test('migration enforces exact tags, uniqueness, cascade, RLS and atomic safe audit triggers', () => {
  const sql = fs.readFileSync('supabase-evidence-tags.sql', 'utf8');
  const allowed = sql.match(/tag_id text not null check \(tag_id in \(([\s\S]*?)\)\)/)[1].match(/'[^']+'/g).map(s => s.slice(1, -1));
  assert.deepEqual(allowed, Object.keys(EVIDENCE_TAGS));
  for (const type of Object.keys(ACTIVITY_DEFINITIONS)) assert.ok(sql.includes("'" + type + "'"));
  assert.match(sql, /primary key \(bookmark_id, tag_id\)/);
  assert.match(sql, /references public.case_evidence_bookmarks\(id\) on delete cascade/);
  assert.match(sql, /created_by uuid not null references auth.users\(id\)/);
  assert.match(sql, /new.created_at := clock_timestamp\(\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public.case_evidence_tags from public, anon, authenticated/);
  assert.match(sql, /grant select on public.case_evidence_tags to authenticated/);
  assert.match(sql, /where b.id = bookmark_id and c.created_by = auth.uid\(\)/);
  assert.match(sql, /c.created_by = new.created_by for share of b, c/);
  assert.doesNotMatch(sql, /for (insert|update|delete) to authenticated|grant[^;]*update/i);
  assert.match(sql, /after insert or delete on public.case_evidence_tags/);
  const audit = sql.split('function public.record_case_evidence_tag_activity() returns trigger')[1].split('end; $$;')[0];
  assert.match(audit, /jsonb_build_object\('bookmarkId',row_data.bookmark_id,'tagId',row_data.tag_id\)/);
  assert.match(audit, /if parent_case is null then return row_data/);
  assert.match(audit, /auth.role\(\) = 'service_role' then owner_id else auth.uid\(\)/);
  assert.doesNotMatch(audit, /exception when|response|secret|note_text|transaction_hash/);
  assert.match(sql, /^--[^\n]*\nbegin;/); assert.match(sql, /commit;\s*$/);
});

test('saved evidence renders controlled labels, explicit removal and excludes assigned add options', () => {
  const Module = require('node:module'), path = require('node:path'), ts = require('typescript');
  const file = path.resolve('src/components/case-bookmarks.tsx');
  const compiled = new Module(file, module); compiled.filename = file; compiled.paths = Module._nodeModulePaths(path.dirname(file));
  const originalRequire = compiled.require.bind(compiled);
  compiled.require = name => name.startsWith('@/') ? load('src/' + name.slice(2) + '.ts') : originalRequire(name);
  compiled._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText, file);
  const render = tags => require('react-dom/server').renderToStaticMarkup(require('react').createElement(compiled.exports.BookmarkEntry, { busy: true, onRemove() {}, onTagChange() {}, bookmark: { id: bookmarkId, case_id: caseId, created_by: userId, transaction_hash: '0x' + 'a'.repeat(64), network: 'ethereum', created_at: now, tags } }));
  const html = render([{ tag_id: 'exchange' }, { tag_id: 'victim_transfer' }]);
  assert.match(html, /Remove Exchange tag/); assert.match(html, /Victim Transfer/);
  assert.doesNotMatch(html, /<option value="exchange"/); assert.match(html, /<option value="bridge"/);
  assert.match(html, /disabled=""/); assert.match(render([]), /No tags assigned/);
});
