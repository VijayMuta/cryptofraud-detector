const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const { load } = require('./load-typescript.cjs');
const { MAX_BOOKMARK_NOTE_LENGTH, validateBookmarkNote, validateBookmarkNoteRequest } = load('src/lib/evidence-bookmark-notes.ts');
const { ACTIVITY_DEFINITIONS, validateActivityMetadata, exportActivity } = load('src/lib/case-activity.ts');
const caseId = '11111111-1111-4111-8111-111111111111', otherCase = '22222222-2222-4222-8222-222222222222';
const bookmarkId = '33333333-3333-4333-8333-333333333333', otherBookmark = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555', otherUser = '66666666-6666-4666-8666-666666666666';
const noteId = '77777777-7777-4777-8777-777777777777', secondBookmark = '88888888-8888-4888-8888-888888888888';
const now = '2026-09-29T00:00:00.000Z';
const eventType = 'EVIDENCE_BOOKMARK_NOTE_CREATED';

test('bookmark notes validate short Unicode plain text, reject empty/invalid/overlong/null input', () => {
  assert.equal(MAX_BOOKMARK_NOTE_LENGTH, 2000);
  assert.equal(validateBookmarkNote('  observation\nsecond line  '), 'observation\nsecond line');
  assert.equal(validateBookmarkNote('😀'.repeat(2000)), '😀'.repeat(2000));
  assert.equal(validateBookmarkNote('<script>alert(1)</script>'), '<script>alert(1)</script>');
  for (const text of ['', ' \r\n\t ', '\u00a0\u2003\ufeff', null, undefined, 1, [], {}, 'x'.repeat(2001), '😀'.repeat(2001), 'a\u0000b']) assert.throws(() => validateBookmarkNote(text));
});

test('request allowlist rejects author spoofing, IDs, timestamps, payloads and getters', () => {
  assert.equal(validateBookmarkNoteRequest({ noteText: ' note ' }), 'note');
  for (const key of ['author_user_id', 'created_by', 'author', 'case_id', 'bookmark_id', 'id', 'created_at', 'metadata', 'response', 'token']) assert.throws(() => validateBookmarkNoteRequest({ noteText: 'note', [key]: 'secret' }));
  for (const body of [null, [], 'note', {}, Object.create({ noteText: 'note' }), JSON.parse('{"noteText":"note","__proto__":{}}')]) assert.throws(() => validateBookmarkNoteRequest(body));
  assert.throws(() => validateBookmarkNoteRequest(Object.defineProperty({}, 'noteText', { get() { assert.fail('Getter executed'); } })));
  assert.throws(() => validateBookmarkNoteRequest({ noteText: 'note', [Symbol('extra')]: true }));
});

test('API authenticates, checks real case ownership and bookmark membership, and safely creates/lists notes', async t => {
  const auth = load('src/lib/request-auth.ts'), adminModule = load('src/lib/supabase-admin.ts');
  const originals = [auth.getRequestUser, adminModule.getSupabaseAdmin];
  t.after(() => { [auth.getRequestUser, adminModule.getSupabaseAdmin] = originals; });
  const route = load('src/app/api/cases/[id]/bookmarks/[bookmarkId]/notes/route.ts');
  const { NextRequest } = require('next/server');
  const cases = [{ id: caseId, created_by: userId }, { id: otherCase, created_by: otherUser }];
  const bookmarks = [{ id: bookmarkId, case_id: caseId }, { id: secondBookmark, case_id: caseId }, { id: otherBookmark, case_id: otherCase }];
  let rows = [], touched = [], queries = [], failureTable = '', failureCode = '', insertedRow;
  adminModule.getSupabaseAdmin = () => ({ from(table) {
    touched.push(table);
    const filters = [], order = []; let inserted;
    const execute = () => {
      if (table === failureTable) return { error: { message: 'secret note text and credentials', code: failureCode } };
      const source = table === 'investigation_cases' ? cases : table === 'case_evidence_bookmarks' ? bookmarks : rows;
      assert.ok(['investigation_cases', 'case_evidence_bookmarks', 'case_evidence_bookmark_notes'].includes(table));
      if (inserted) {
        insertedRow = inserted;
        const data = { id: noteId, ...inserted, created_at: now }; rows.push(data); return { data };
      }
      return { data: source.filter(row => filters.every(([key, value]) => row[key] === value)) };
    };
    return {
      select() { return this; }, eq(key, value) { filters.push([key, value]); return this; },
      order(key, options) { order.push([key, options]); return this; },
      maybeSingle: async () => { const result = execute(); return { ...result, data: result.data?.[0] || null }; },
      insert(row) { assert.equal(table, 'case_evidence_bookmark_notes'); inserted = row; return this; },
      single: async () => execute(),
      range: async (from, to) => { queries.push({ filters, order, from, to }); const result = execute(); return { ...result, data: result.data?.slice(from, to + 1) }; },
    };
  } });
  const call = (method, body = { noteText: ' note ' }, id = caseId, bookmark = bookmarkId, query = '') => route[method](new NextRequest('http://localhost/api/notes' + query, { method, ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }), { params: { id, bookmarkId: bookmark } });
  auth.getRequestUser = async () => null;
  for (const method of ['GET', 'POST']) assert.equal((await call(method)).status, 401);
  assert.deepEqual(touched, []);
  auth.getRequestUser = async () => ({ id: userId });
  for (const method of ['GET', 'POST']) {
    assert.equal((await call(method, undefined, otherCase, otherBookmark)).status, 404);
    assert.equal((await call(method, undefined, caseId, otherBookmark)).status, 404);
    assert.equal((await call(method, undefined, caseId, noteId)).status, 404);
    assert.equal((await call(method, undefined, noteId)).status, 404);
    assert.equal((await call(method, undefined, 'bad')).status, 404);
    assert.equal((await call(method, undefined, caseId, 'bad')).status, 400);
  }
  assert.ok(!touched.includes('case_evidence_bookmark_notes'));
  for (const body of [null, [], {}, { noteText: '' }, { noteText: '  ' }, { noteText: 'x'.repeat(2001) }, { noteText: 'note', author_user_id: otherUser }, { noteText: 'note', created_by: otherUser }, { noteText: 'note', case_id: otherCase }, { noteText: 'note', bookmark_id: otherBookmark }, '{bad secret']) {
    const response = await call('POST', body); assert.equal(response.status, 400); assert.doesNotMatch(await response.text(), /secret/);
  }
  assert.equal((await call('POST', { noteText: 'x'.repeat(26001) })).status, 413);
  assert.equal(rows.length, 0);
  for (const offset of ['-1', '1.5', 'NaN', 'Infinity', '9007199254740991']) assert.equal((await call('GET', undefined, caseId, bookmarkId, '?offset=' + offset)).status, 400);
  assert.deepEqual(await (await call('GET')).json(), { notes: [], nextOffset: null });
  const response = await call('POST');
  assert.equal(response.status, 201); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(insertedRow, { case_id: caseId, bookmark_id: bookmarkId, author_user_id: userId, note_text: 'note' });
  assert.deepEqual((await response.json()).note, { id: noteId, ...insertedRow, created_at: now });
  rows.push({ id: otherBookmark, case_id: otherCase, bookmark_id: otherBookmark, note_text: 'other account secret' });
  rows.push({ id: secondBookmark, case_id: caseId, bookmark_id: secondBookmark, note_text: 'different bookmark' });
  const listed = await call('GET'); assert.equal(listed.headers.get('cache-control'), 'no-store');
  assert.equal((await listed.json()).notes.length, 1);
  assert.deepEqual(queries.at(-1), { filters: [['case_id', caseId], ['bookmark_id', bookmarkId]], order: [['created_at', { ascending: false }], ['id', { ascending: false }]], from: 0, to: 49 });
  auth.getRequestUser = async () => ({ id: otherUser });
  for (const method of ['GET', 'POST']) assert.equal((await call(method)).status, 404);
  assert.equal(rows.length, 3);
  auth.getRequestUser = async () => ({ id: userId });
  rows = Array.from({ length: 51 }, (_, i) => ({ id: String(i), case_id: caseId, bookmark_id: bookmarkId }));
  const first = await (await call('GET')).json(); assert.equal(first.notes.length, 50); assert.equal(first.nextOffset, 50);
  const last = await (await call('GET', undefined, caseId, bookmarkId, '?offset=50')).json(); assert.equal(last.notes.length, 1); assert.equal(last.nextOffset, null);
  for (const table of ['investigation_cases', 'case_evidence_bookmarks', 'case_evidence_bookmark_notes']) {
    failureTable = table;
    for (const method of ['GET', 'POST']) { const result = await call(method); assert.equal(result.status, 503); assert.doesNotMatch(await result.text(), /secret|credentials/); }
  }
  failureCode = '23503'; assert.equal((await call('POST')).status, 404);
  assert.equal(route.PATCH, undefined); assert.equal(route.DELETE, undefined);
});

test('audit metadata and export contain exactly validated bookmark and note identifiers', () => {
  const metadata = { bookmarkId, noteId };
  assert.deepEqual(validateActivityMetadata(eventType, metadata), metadata);
  for (const extra of ['noteText', 'note_text', 'response', 'metadata', 'token', 'author_user_id']) assert.throws(() => validateActivityMetadata(eventType, { ...metadata, [extra]: 'private text' }));
  for (const input of [{ bookmarkId }, { noteId }, { bookmarkId: 'bad', noteId }, { bookmarkId, noteId: 'bad' }]) assert.throws(() => validateActivityMetadata(eventType, input));
  const output = JSON.parse(exportActivity(caseId, [{ id: noteId, case_id: caseId, actor_user_id: userId, event_type: eventType, metadata, origin: 'database', event_timestamp: now }], now));
  assert.deepEqual(output.events[0].metadata, metadata);
});

test('generic activity endpoint rejects fabricated bookmark note events without writing', async t => {
  const auth = load('src/lib/request-auth.ts'), admin = load('src/lib/supabase-admin.ts'), cases = load('src/lib/cases.ts');
  const saved = [auth.getRequestUser, admin.getSupabaseAdmin, cases.getOwnedCase];
  t.after(() => { [auth.getRequestUser, admin.getSupabaseAdmin, cases.getOwnedCase] = saved; });
  auth.getRequestUser = async () => ({ id: userId }); cases.getOwnedCase = async () => ({ id: caseId });
  let touched = false; admin.getSupabaseAdmin = () => ({ from() { touched = true; throw Error('Unexpected write'); } });
  const route = load('src/app/api/cases/[id]/activity/route.ts'), { NextRequest } = require('next/server');
  const response = await route.POST(new NextRequest('http://localhost', { method: 'POST', body: JSON.stringify({ eventType, metadata: { bookmarkId, noteId }, operationId: noteId }) }), { params: { id: caseId } });
  assert.equal(response.status, 400); assert.equal(touched, false);
});

test('migration enforces composite membership, owner RLS, author checks, append-only access and atomic identifier-only audit', () => {
  const sql = fs.readFileSync('supabase-evidence-bookmark-notes.sql', 'utf8');
  for (const type of Object.keys(ACTIVITY_DEFINITIONS)) {
    const migration = type === 'EVIDENCE_REVIEW_STATUS_CHANGED' ? fs.readFileSync('supabase-evidence-review-status.sql', 'utf8') : sql;
    assert.ok(migration.includes("'" + type + "'"));
  }
  assert.match(sql, /unique \(id, case_id\)/);
  assert.match(sql, /foreign key \(bookmark_id, case_id\) references public.case_evidence_bookmarks\(id, case_id\) on delete cascade/);
  assert.match(sql, /case_id uuid not null references public.investigation_cases\(id\) on delete cascade/);
  assert.match(sql, /author_user_id uuid not null references auth.users\(id\) on delete restrict/);
  assert.match(sql, /char_length\(note_text\) between 1 and 2000 and note_text ~ '\[\^\[:space:\]\]'/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public.case_evidence_bookmark_notes from public, anon, authenticated, service_role/);
  assert.match(sql, /grant select on public.case_evidence_bookmark_notes to authenticated/);
  assert.match(sql, /grant select, insert on public.case_evidence_bookmark_notes to service_role/);
  assert.doesNotMatch(sql, /for (insert|update|delete) to authenticated|grant[^;]*(update|delete)/i);
  assert.match(sql, /c.id = case_id and c.created_by = auth.uid\(\)/);
  assert.match(sql, /b.id = new.bookmark_id and b.case_id = new.case_id/);
  assert.match(sql, /c.created_by = new.author_user_id for share of b, c/);
  assert.match(sql, /new.created_at := clock_timestamp\(\)/);
  assert.match(sql, /after insert on public.case_evidence_bookmark_notes/);
  const audit = sql.split('function public.record_case_bookmark_note_activity() returns trigger')[1].split('end; $$;')[0];
  assert.match(audit, /new.case_id,new.author_user_id,'EVIDENCE_BOOKMARK_NOTE_CREATED'/);
  assert.match(audit, /jsonb_build_object\('bookmarkId',new.bookmark_id,'noteId',new.id\),'database'/);
  assert.doesNotMatch(audit, /note_text|exception when|raise notice|response|token/);
  assert.match(sql, /^--[^\n]*\nbegin;/); assert.match(sql, /commit;\s*$/);
});

test('bookmark notes render HTML as escaped plain text with account ID and explicit UTC time', () => {
  const { BookmarkNoteEntry, BookmarkNotes, BookmarkNotesBody } = load('src/components/evidence-bookmark-notes.tsx');
  const { createElement } = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const html = renderToStaticMarkup(createElement(BookmarkNoteEntry, { note: { id: noteId, case_id: caseId, bookmark_id: bookmarkId, author_user_id: userId, note_text: '<script>alert(1)</script>\n<img src=x onerror=alert(1)>', created_at: '2026-09-29T05:30:00+05:30' } }));
  assert.doesNotMatch(html, /<script|<img/); assert.match(html, /&lt;script&gt;/); assert.match(html, /&lt;img/);
  assert.match(html, /whitespace-pre-wrap/); assert.match(html, /2026-09-29 00:00:00.000 UTC/); assert.match(html, new RegExp(userId));
  const closed = renderToStaticMarkup(createElement(BookmarkNotes, { caseId, bookmarkId }));
  assert.match(closed, /Private bookmark notes/); assert.doesNotMatch(closed, /<textarea/);
  const opened = renderToStaticMarkup(createElement(BookmarkNotesBody, { caseId, bookmarkId }));
  assert.match(opened, /Loading bookmark notes/); assert.match(opened, /Plain text only/); assert.match(opened, /2,000/);
  assert.match(opened, new RegExp('id="bookmark-note-' + bookmarkId + '"')); assert.match(opened, /disabled=""/);
});
