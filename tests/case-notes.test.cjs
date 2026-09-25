const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const { load } = require('./load-typescript.cjs');
const { validateCaseNote, MAX_CASE_NOTE_LENGTH } = load('src/lib/case-notes.ts');
const { validateActivityMetadata, ACTIVITY_DEFINITIONS } = load('src/lib/case-activity.ts');
const caseId = '11111111-1111-4111-8111-111111111111';
const noteId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';

test('notes reject empty, non-text, null characters and over-limit input; preserve plain text and Unicode', () => {
  for (const value of ['', ' \r\n\t', '\u00a0\u2003', null, undefined, {}, [], 12, 'a\0b', 'a'.repeat(5001)]) assert.throws(() => validateCaseNote(value));
  assert.equal(validateCaseNote('  First\nSecond  '), 'First\nSecond');
  assert.equal(validateCaseNote('<script>alert(1)</script>'), '<script>alert(1)</script>');
  assert.equal(validateCaseNote('a'.repeat(MAX_CASE_NOTE_LENGTH)).length, 5000);
  assert.equal(Array.from(validateCaseNote('🔎'.repeat(5000))).length, 5000);
  assert.throws(() => validateCaseNote('🔎'.repeat(5001)));
});

test('note activity contains only a valid note reference, never note content', () => {
  assert.deepEqual(validateActivityMetadata('CASE_NOTE_CREATED', { noteId }), { noteId });
  assert.equal(ACTIVITY_DEFINITIONS.CASE_NOTE_CREATED[2], 'case-notes');
  for (const metadata of [{ noteId: 'bad' }, { noteId, note_text: 'private' }, { noteId, noteText: 'private' }, { noteId, excerpt: 'private' }, { noteId, author_user_id: userId }]) assert.throws(() => validateActivityMetadata('CASE_NOTE_CREATED', metadata));
});

test('note routes enforce identity, ownership, body validation, trusted authors, ordering and safe failures', async t => {
  const auth = load('src/lib/request-auth.ts'), adminModule = load('src/lib/supabase-admin.ts'), cases = load('src/lib/cases.ts');
  const originals = [auth.getRequestUser, adminModule.getSupabaseAdmin, cases.getOwnedCase];
  t.after(() => { [auth.getRequestUser, adminModule.getSupabaseAdmin, cases.getOwnedCase] = originals; });
  const { NextRequest } = require('next/server');
  const route = load('src/app/api/cases/[id]/notes/route.ts');
  const params = { params: { id: caseId } };
  const get = offset => new NextRequest(`http://localhost/api/cases/${caseId}/notes?offset=${offset || 0}`);
  const post = body => new NextRequest(`http://localhost/api/cases/${caseId}/notes`, { method: 'POST', body: JSON.stringify(body) });
  const calls = []; let inserted, rows = [], error = null;
  const chain = {
    select(fields) { calls.push(['select', fields]); return this; },
    eq(...args) { calls.push(['eq', ...args]); return this; },
    order(...args) { calls.push(['order', ...args]); return this; },
    range(...args) { calls.push(['range', ...args]); return Promise.resolve({ data: rows, error }); },
    insert(row) { inserted = row; calls.push(['insert']); return this; },
    single: async () => ({ data: error ? null : { id: noteId, ...inserted, created_at: '2026-09-26T00:00:00Z', updated_at: '2026-09-26T00:00:00Z' }, error }),
  };
  adminModule.getSupabaseAdmin = () => ({ from: table => { assert.equal(table, 'case_notes'); return chain; } });
  auth.getRequestUser = async () => null;
  assert.equal((await route.GET(get(), params)).status, 401);
  assert.equal((await route.POST(post({ noteText: 'private' }), params)).status, 401);
  auth.getRequestUser = async () => ({ id: userId });
  cases.getOwnedCase = async () => null;
  assert.equal((await route.GET(get(), params)).status, 404);
  assert.equal((await route.POST(post({ noteText: 'private' }), params)).status, 404);
  assert.equal(calls.length, 0);
  assert.equal((await route.GET(get(), { params: { id: 'bad' } })).status, 404);
  cases.getOwnedCase = async (_admin, user, id) => { assert.equal(user, userId); assert.equal(id, caseId); return { id }; };
  for (const body of [{ noteText: '' }, { noteText: ' ' }, { noteText: 'x'.repeat(5001) }, { noteText: 7 }, { noteText: 'note', author_user_id: 'spoof' }, { noteText: 'note', case_id: noteId }, { noteText: 'note', created_at: 'spoof' }, {}, null]) assert.equal((await route.POST(post(body), params)).status, 400);
  const malformed = new NextRequest('http://localhost', { method: 'POST', body: '{' });
  assert.equal((await route.POST(malformed, params)).status, 400);
  assert.equal((await route.POST(post({ noteText: 'x'.repeat(65001) }), params)).status, 413);
  assert.equal(calls.length, 0);
  const response = await route.POST(post({ noteText: '  private note\nline two  ' }), params);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(inserted, { case_id: caseId, author_user_id: userId, note_text: 'private note\nline two' });
  assert.equal((await response.json()).note.id, noteId);
  calls.length = 0;
  assert.deepEqual(await (await route.GET(get(), params)).json(), { notes: [], nextOffset: null });
  assert.deepEqual(calls.slice(1), [['eq', 'case_id', caseId], ['order', 'created_at', { ascending: false }], ['order', 'id', { ascending: false }], ['range', 0, 49]]);
  rows = Array.from({ length: 50 }, () => ({ id: noteId }));
  assert.equal((await (await route.GET(get(50), params)).json()).nextOffset, 100);
  for (const offset of [-1, 'NaN', 1.5]) assert.equal((await route.GET(get(offset), params)).status, 400);
  error = { message: 'private note or database credential' };
  for (const result of [await route.GET(get(), params), await route.POST(post({ noteText: 'private' }), params)]) {
    assert.equal(result.status, 503); assert.doesNotMatch(await result.text(), /database credential|private note/);
  }
  cases.getOwnedCase = async () => { throw Error('database credential'); };
  assert.equal((await route.GET(get(), params)).status, 503);
});

test('browser cannot fabricate CASE_NOTE_CREATED through the generic activity endpoint', async t => {
  const auth = load('src/lib/request-auth.ts'), adminModule = load('src/lib/supabase-admin.ts'), cases = load('src/lib/cases.ts');
  const originals = [auth.getRequestUser, adminModule.getSupabaseAdmin, cases.getOwnedCase];
  t.after(() => { [auth.getRequestUser, adminModule.getSupabaseAdmin, cases.getOwnedCase] = originals; });
  auth.getRequestUser = async () => ({ id: userId }); cases.getOwnedCase = async () => ({ id: caseId });
  adminModule.getSupabaseAdmin = () => ({ from() { throw Error('Must not insert'); } });
  const { NextRequest } = require('next/server');
  const route = load('src/app/api/cases/[id]/activity/route.ts');
  const request = new NextRequest('http://localhost', { method: 'POST', body: JSON.stringify({ eventType: 'CASE_NOTE_CREATED', metadata: { noteId }, operationId: noteId }) });
  assert.equal((await route.POST(request, { params: { id: caseId } })).status, 400);
});

test('migration preserves activity types, restricts notes to owner reads/server inserts, and atomically audits IDs only', () => {
  const sql = fs.readFileSync('supabase-case-notes.sql', 'utf8');
  for (const eventType of Object.keys(ACTIVITY_DEFINITIONS)) assert.ok(sql.includes("'" + eventType + "'"));
  assert.match(sql, /alter table public.case_notes enable row level security/);
  assert.match(sql, /revoke all on public.case_notes from public, anon, authenticated/);
  assert.match(sql, /c.id = case_id and c.created_by = auth.uid\(\)/);
  assert.match(sql, /created_by = new.author_user_id for share/);
  assert.match(sql, /char_length\(note_text\) between 1 and 5000/);
  assert.doesNotMatch(sql, /for (insert|update|delete) to authenticated/i);
  assert.match(sql, /after insert on public.case_notes/);
  const audit = sql.split('function public.record_case_note_activity() returns trigger')[1].split('end; $$;')[0];
  assert.match(audit, /jsonb_build_object\('noteId',new.id\)/);
  assert.doesNotMatch(audit, /note_text|exception when|raise notice/i);
  assert.match(sql, /new.updated_at := new.created_at/);
});

test('rendered note markup is escaped as plain text and timestamp is UTC', () => {
  const Module = require('node:module'), path = require('node:path'), ts = require('typescript');
  const file = path.resolve('src/components/case-notes.tsx');
  const compiled = new Module(file, module); compiled.filename = file; compiled.paths = Module._nodeModulePaths(path.dirname(file));
  const originalRequire = compiled.require.bind(compiled);
  compiled.require = name => name.startsWith('@/') ? load('src/' + name.slice(2) + '.ts') : originalRequire(name);
  compiled._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText, file);
  const html = require('react-dom/server').renderToStaticMarkup(require('react').createElement(compiled.exports.CaseNoteEntry, { note: {
    id: noteId, case_id: caseId, author_user_id: userId, note_text: '<script>alert(1)</script>\n<img src=x onerror=alert(1)>', created_at: '2026-09-26T05:30:00+05:30', updated_at: '2026-09-26T00:00:00Z',
  } }));
  assert.doesNotMatch(html, /<script|<img/); assert.match(html, /&lt;script&gt;/);
  assert.match(html, /2026-09-26 00:00:00.000 UTC/); assert.match(html, new RegExp(userId));
});
