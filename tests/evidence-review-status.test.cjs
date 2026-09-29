const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const { load } = require('./load-typescript.cjs');
const { NextRequest } = require('next/server');
const review = load('src/lib/evidence-review-status.ts');
const activity = load('src/lib/case-activity.ts');
const caseId = '11111111-1111-4111-8111-111111111111', otherCase = '22222222-2222-4222-8222-222222222222';
const bookmarkId = '33333333-3333-4333-8333-333333333333', otherBookmark = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555', otherUser = '66666666-6666-4666-8666-666666666666';
const now = '2026-09-30T01:00:00.000Z', eventType = 'EVIDENCE_REVIEW_STATUS_CHANGED';

test('review status has four controlled values, strict requests and an unattributed default', () => {
  assert.deepEqual(Object.values(review.EVIDENCE_REVIEW_STATUSES), ['Unreviewed', 'In Review', 'Verified', 'Needs Follow-up']);
  for (const status of Object.keys(review.EVIDENCE_REVIEW_STATUSES)) assert.equal(review.validateReviewRequest({ status }), status);
  for (const status of ['', 'Verified', 'fraud', 'open', '__proto__', 'toString', null, [], {}, 1]) {
    assert.equal(review.isEvidenceReviewStatus(status), false);
    assert.throws(() => review.validateReviewRequest({ status }));
  }
  for (const key of ['updated_by', 'userId', 'case_id', 'bookmark_id', 'updated_at', 'previousStatus', 'note_text', 'token']) {
    assert.throws(() => review.validateReviewRequest({ status: 'verified', [key]: 'spoof' }));
  }
  for (const body of [null, [], {}, 'verified', Object.create({ status: 'verified' }), { status: 'verified', [Symbol('extra')]: 1 }]) assert.throws(() => review.validateReviewRequest(body));
  assert.throws(() => review.validateReviewRequest(Object.defineProperty({}, 'status', { get() { assert.fail('Getter executed'); } })));
  assert.deepEqual(review.defaultEvidenceReview(caseId, bookmarkId), { case_id: caseId, bookmark_id: bookmarkId, status: 'unreviewed', updated_by: null, updated_at: null });
});

test('review API enforces authentication, real ownership and bookmark membership; upserts trusted transitions only', async t => {
  const auth = load('src/lib/request-auth.ts'), admin = load('src/lib/supabase-admin.ts');
  const originals = [auth.getRequestUser, admin.getSupabaseAdmin];
  t.after(() => { [auth.getRequestUser, admin.getSupabaseAdmin] = originals; });
  const route = load('src/app/api/cases/[id]/bookmarks/[bookmarkId]/review-status/route.ts');
  const cases = [{ id: caseId, created_by: userId }, { id: otherCase, created_by: otherUser }];
  const bookmarks = [{ id: bookmarkId, case_id: caseId }, { id: otherBookmark, case_id: otherCase }];
  let stored = null, writes = [], touched = [], failureTable = '', failureCode = '', noData = false;
  const queries = [];
  admin.getSupabaseAdmin = () => ({ from(table) {
    touched.push(table);
    assert.ok(['investigation_cases', 'case_evidence_bookmarks', 'case_evidence_review_statuses'].includes(table));
    const filters = []; let input;
    const execute = () => {
      queries.push({ table, filters });
      if (table === failureTable) return { error: { code: failureCode, message: 'private provider secret' } };
      if (input) {
        writes.push(input);
        if (noData) return { data: null };
        stored = { ...input, updated_at: now }; return { data: stored };
      }
      const source = table === 'investigation_cases' ? cases : table === 'case_evidence_bookmarks' ? bookmarks : stored ? [stored] : [];
      return { data: source.find(row => filters.every(([key, value]) => row[key] === value)) || null };
    };
    return {
      select() { return this; }, eq(key, value) { filters.push([key, value]); return this; },
      maybeSingle: async () => execute(), single: async () => execute(),
      upsert(row, options) { assert.equal(table, 'case_evidence_review_statuses'); assert.deepEqual(options, { onConflict: 'bookmark_id' }); input = row; return this; },
    };
  } });
  const call = (method, body = { status: 'in_review' }, id = caseId, bookmark = bookmarkId) => route[method](new NextRequest('http://localhost/api/review', {
    method, ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  }), { params: { id, bookmarkId: bookmark } });
  auth.getRequestUser = async () => null;
  for (const method of ['GET', 'PUT']) assert.equal((await call(method)).status, 401);
  assert.deepEqual(touched, []);
  auth.getRequestUser = async () => ({ id: userId });
  for (const method of ['GET', 'PUT']) {
    assert.equal((await call(method, undefined, otherCase, otherBookmark)).status, 404);
    assert.equal((await call(method, undefined, caseId, otherBookmark)).status, 404);
    assert.equal((await call(method, undefined, caseId, userId)).status, 404);
    assert.equal((await call(method, undefined, 'bad')).status, 404);
    assert.equal((await call(method, undefined, caseId, 'bad')).status, 400);
  }
  assert.ok(!touched.includes('case_evidence_review_statuses'));
  assert.deepEqual((await (await call('GET')).json()).review, review.defaultEvidenceReview(caseId, bookmarkId));
  assert.deepEqual(queries.at(-1), { table: 'case_evidence_review_statuses', filters: [['case_id', caseId], ['bookmark_id', bookmarkId]] });
  assert.equal(writes.length, 0);
  for (const body of [null, [], {}, { status: 'fraud' }, { status: 'Verified' }, { status: 'verified', updated_by: otherUser }, { status: 'verified', updated_at: now }, { status: 'verified', case_id: otherCase }, { status: 'verified', bookmark_id: otherBookmark }, '{bad']) {
    assert.equal((await call('PUT', body)).status, 400);
  }
  assert.equal((await call('PUT', { status: 'x'.repeat(1025) })).status, 413);
  assert.equal(writes.length, 0);
  for (const status of ['in_review', 'verified', 'needs_follow_up', 'unreviewed', 'unreviewed']) {
    const result = await call('PUT', { status });
    assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.deepEqual(writes.at(-1), { case_id: caseId, bookmark_id: bookmarkId, status, updated_by: userId });
    assert.deepEqual((await result.json()).review, { ...writes.at(-1), updated_at: now });
    assert.equal((await (await call('GET')).json()).review.status, status);
  }
  auth.getRequestUser = async () => ({ id: otherUser });
  for (const method of ['GET', 'PUT']) assert.equal((await call(method)).status, 404);
  assert.equal(writes.length, 5);
  auth.getRequestUser = async () => ({ id: userId });
  for (const table of ['investigation_cases', 'case_evidence_bookmarks', 'case_evidence_review_statuses']) {
    failureTable = table;
    for (const method of ['GET', 'PUT']) {
      const result = await call(method); assert.equal(result.status, 503);
      assert.doesNotMatch(await result.text(), /private provider secret/);
    }
  }
  failureCode = '23503'; assert.equal((await call('PUT')).status, 404);
  failureTable = ''; noData = true; assert.equal((await call('PUT')).status, 503);
  assert.equal(route.DELETE, undefined); assert.equal(route.POST, undefined);
});

test('review audit metadata is exact, controlled and distinct from case workflow statuses', () => {
  const metadata = { bookmarkId, previousStatus: 'unreviewed', status: 'verified' };
  assert.deepEqual(activity.validateActivityMetadata(eventType, metadata), metadata);
  for (const previousStatus of Object.keys(review.EVIDENCE_REVIEW_STATUSES)) {
    for (const status of Object.keys(review.EVIDENCE_REVIEW_STATUSES)) {
      const check = () => activity.validateActivityMetadata(eventType, { bookmarkId, previousStatus, status });
      if (status === previousStatus) assert.throws(check); else assert.doesNotThrow(check);
    }
  }
  for (const input of [{ ...metadata, note_text: 'private' }, { ...metadata, payload: {} }, { ...metadata, token: 'secret' }, { ...metadata, bookmarkId: 'bad' }, { ...metadata, status: 'open' }, { ...metadata, previousStatus: 'closed' }, { status: 'verified' }]) assert.throws(() => activity.validateActivityMetadata(eventType, input));
  assert.throws(() => activity.validateActivityMetadata('CASE_STATUS_CHANGED', { previousStatus: 'unreviewed', status: 'verified' }));
  assert.doesNotThrow(() => activity.validateActivityMetadata('CASE_STATUS_CHANGED', { previousStatus: 'open', status: 'closed' }));
  const event = { id: otherBookmark, case_id: caseId, actor_user_id: userId, event_type: eventType, metadata, event_timestamp: now, origin: 'database' };
  assert.deepEqual(JSON.parse(activity.exportActivity(caseId, [event], now)).events[0].metadata, metadata);
});

test('activity GET accepts review events and generic POST rejects fabrication without writing', async t => {
  const auth = load('src/lib/request-auth.ts'), admin = load('src/lib/supabase-admin.ts'), cases = load('src/lib/cases.ts');
  const originals = [auth.getRequestUser, admin.getSupabaseAdmin, cases.getOwnedCase];
  t.after(() => { [auth.getRequestUser, admin.getSupabaseAdmin, cases.getOwnedCase] = originals; });
  auth.getRequestUser = async () => ({ id: userId }); cases.getOwnedCase = async () => ({ id: caseId });
  let touched = false;
  const event = { id: otherBookmark, case_id: caseId, actor_user_id: userId, event_type: eventType, metadata: { bookmarkId, previousStatus: 'in_review', status: 'verified' }, origin: 'database', event_timestamp: now };
  admin.getSupabaseAdmin = () => ({ from(table) {
    touched = true; assert.equal(table, 'case_activity_events');
    return { select() { return this; }, eq() { return this; }, order() { return this; }, range: async () => ({ data: [event] }) };
  } });
  const route = load('src/app/api/cases/[id]/activity/route.ts'), params = { params: { id: caseId } };
  const post = await route.POST(new NextRequest('http://localhost', { method: 'POST', body: JSON.stringify({ eventType, operationId: otherBookmark, metadata: event.metadata }) }), params);
  assert.equal(post.status, 400); assert.equal(touched, false);
  const get = await route.GET(new NextRequest('http://localhost'), params);
  assert.equal(get.status, 200); assert.deepEqual((await get.json()).events, [event]);
});

test('new migration retains events, owner RLS, composite membership, atomic audits and same-status suppression', () => {
  const sql = fs.readFileSync('supabase-evidence-review-status.sql', 'utf8');
  for (const type of Object.keys(activity.ACTIVITY_DEFINITIONS)) assert.ok(sql.includes("'" + type + "'"));
  const statuses = sql.match(/check \(status in \(([^)]+)\)\)/)[1].match(/'[^']+'/g).map(s => s.slice(1, -1));
  assert.deepEqual(statuses, Object.keys(review.EVIDENCE_REVIEW_STATUSES));
  assert.match(sql, /bookmark_id uuid primary key/);
  assert.match(sql, /foreign key \(bookmark_id, case_id\) references public.case_evidence_bookmarks\(id, case_id\) on delete cascade/);
  assert.match(sql, /updated_by uuid not null references auth.users\(id\) on delete restrict/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public.case_evidence_review_statuses from public, anon, authenticated, service_role/);
  assert.match(sql, /grant select, insert, update on public.case_evidence_review_statuses to service_role/);
  assert.match(sql, /c.id = case_id and c.created_by = auth.uid\(\)/);
  assert.doesNotMatch(sql, /for (insert|update|delete) to authenticated|grant[^;]*delete/i);
  assert.match(sql, /b.id = new.bookmark_id and b.case_id = new.case_id and c.created_by = new.updated_by/);
  assert.match(sql, /for share of b, c/);
  assert.match(sql, /new.bookmark_id is distinct from old.bookmark_id or new.case_id is distinct from old.case_id/);
  assert.match(sql, /if new.status is not distinct from old.status then return old; end if/);
  assert.match(sql, /new.updated_at := clock_timestamp\(\)/);
  assert.match(sql, /after insert or update on public.case_evidence_review_statuses/);
  const audit = sql.split('function public.record_case_evidence_review_activity() returns trigger')[1].split('end; $$;')[0];
  assert.match(audit, /if tg_op = 'INSERT' then previous_status := 'unreviewed'; else previous_status := old.status/);
  assert.match(audit, /if new.status is not distinct from previous_status then return new/);
  assert.match(audit, /jsonb_build_object\('bookmarkId',new.bookmark_id,'previousStatus',previous_status,'status',new.status\),'database'/);
  assert.doesNotMatch(audit, /note_text|exception when|raise notice|payload|token/);
  assert.match(sql, /^--[^\n]*\nbegin;/); assert.match(sql, /commit;\s*$/);
  assert.doesNotMatch(sql, /insert into public.case_evidence_review_statuses/);
});

test('review UI shows controlled options, default/loading/error/saving states and workflow disclaimer', () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const { EvidenceReviewStatusControl } = load('src/components/evidence-review-status.tsx');
  const original = [React.useState, React.useRef, React.useEffect];
  try {
    const render = (status, loading, saving, error) => {
      const states = [status ? { ...review.defaultEvidenceReview(caseId, bookmarkId), status } : null, status || 'unreviewed', loading, saving, 0, error, ''];
      React.useState = () => [states.shift(), () => {}]; React.useRef = value => ({ current: value }); React.useEffect = () => {};
      return renderToStaticMarkup(EvidenceReviewStatusControl({ caseId, bookmarkId }));
    };
    for (const status of Object.keys(review.EVIDENCE_REVIEW_STATUSES)) {
      const html = render(status, false, false, '');
      assert.ok(html.includes('Review status: ' + review.EVIDENCE_REVIEW_STATUSES[status]));
      for (const label of Object.values(review.EVIDENCE_REVIEW_STATUSES)) assert.ok(html.includes(label));
      assert.match(html, /not proof that an address, transaction, or person committed fraud/);
    }
    assert.match(render(null, true, false, ''), /Loading review status/);
    assert.match(render('verified', false, true, ''), /Saving review status/);
    const failed = render(null, false, false, 'Migration unavailable');
    assert.match(failed, /role="alert"/); assert.match(failed, /Unconfirmed/); assert.match(failed, /disabled=""/);
  } finally { [React.useState, React.useRef, React.useEffect] = original; }
});

test('review UI prevents duplicate in-flight writes and requires refresh after an uncertain save', async t => {
  const React = require('react'), api = load('src/lib/client-api.ts');
  const original = [React.useState, React.useRef, React.useEffect, api.authenticatedFetch];
  t.after(() => { [React.useState, React.useRef, React.useEffect, api.authenticatedFetch] = original; });
  const { EvidenceReviewStatusControl } = load('src/components/evidence-review-status.tsx');
  const states = [review.defaultEvidenceReview(caseId, bookmarkId), 'verified', false, false, 0, '', ''];
  const refs = [{ current: false }, { current: true }];
  const render = () => {
    let stateIndex = 0, refIndex = 0;
    React.useState = () => { const i = stateIndex++; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; };
    React.useRef = () => refs[refIndex++]; React.useEffect = () => {};
    return EvidenceReviewStatusControl({ caseId, bookmarkId });
  };
  const findButton = (node, text) => {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'button' && node.props.children === text) return node;
    for (const child of React.Children.toArray(node.props?.children)) { const found = findButton(child, text); if (found) return found; }
    return null;
  };
  let resolve, calls = 0;
  api.authenticatedFetch = (path, options) => {
    calls++; assert.equal(path, `/api/cases/${caseId}/bookmarks/${bookmarkId}/review-status`);
    assert.equal(options.method, 'PUT'); assert.deepEqual(JSON.parse(options.body), { status: 'verified' });
    return new Promise(done => { resolve = done; });
  };
  const button = findButton(render(), 'Save review status');
  button.props.onClick(); button.props.onClick(); assert.equal(calls, 1);
  resolve({ json: async () => ({ review: { ...states[0], status: 'verified', updated_by: userId, updated_at: now } }) });
  await new Promise(done => setImmediate(done));
  assert.equal(states[0].status, 'verified'); assert.match(states[6], /Review status saved/);
  assert.equal(findButton(render(), 'Save review status').props.disabled, true);
  states[1] = 'in_review';
  api.authenticatedFetch = async () => { calls++; throw Error('Save could not be confirmed.'); };
  findButton(render(), 'Save review status').props.onClick();
  await new Promise(done => setImmediate(done));
  assert.equal(states[0].status, 'verified'); assert.match(states[5], /Refresh review status before retrying/);
  assert.equal(findButton(render(), 'Save review status').props.disabled, true);
});
