const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./load-typescript.cjs');
const { NextRequest } = require('next/server');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const caseId = '11111111-1111-4111-8111-111111111111';
const bookmarkId = '22222222-2222-4222-8222-222222222222';
const noteId = '33333333-3333-4333-8333-333333333333';
const event = {
  id: '44444444-4444-4444-8444-444444444444', case_id: caseId,
  actor_user_id: '55555555-5555-4555-8555-555555555555',
  event_type: 'EVIDENCE_BOOKMARK_NOTE_CREATED',
  event_timestamp: '2026-09-29T20:50:09.982257+00:00',
  metadata: { noteId, bookmarkId }, origin: 'database',
};

test('persisted bookmark-note activity survives GET validation and renders in All and Evidence', async t => {
  const auth = load('src/lib/request-auth.ts');
  const admin = load('src/lib/supabase-admin.ts');
  const cases = load('src/lib/cases.ts');
  const originals = [auth.getRequestUser, admin.getSupabaseAdmin, cases.getOwnedCase, React.useState, React.useEffect, React.useContext];
  t.after(() => {
    [auth.getRequestUser, admin.getSupabaseAdmin, cases.getOwnedCase, React.useState, React.useEffect, React.useContext] = originals;
  });
  auth.getRequestUser = async () => ({ id: event.actor_user_id });
  cases.getOwnedCase = async () => ({ id: caseId, case_code: 'CF-regression' });
  let rows = [structuredClone(event)];
  const filters = [];
  admin.getSupabaseAdmin = () => ({ from(table) {
    assert.equal(table, 'case_activity_events');
    return {
      select() { return this; },
      eq(key, value) { filters.push([key, value]); return this; },
      order() { return this; },
      async range(start, end) { assert.deepEqual([start, end], [0, 99]); return { data: rows, error: null }; },
    };
  } });
  const route = load('src/app/api/cases/[id]/activity/route.ts');
  const get = () => route.GET(new NextRequest('http://localhost/api/cases/' + caseId + '/activity'), { params: Promise.resolve({ id: caseId }) });
  const response = await get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const payload = await response.json();
  assert.deepEqual(payload.events, [event]);
  assert.equal(payload.nextOffset, null);
  assert.deepEqual(filters, [['case_id', caseId]]);

  // Render the actual page's loaded state with the API response. This tests its
  // category predicate and markup, not browser fetching or effect scheduling.
  React.useEffect = () => {};
  const Page = load('src/app/(dashboard)/cases/[id]/activity/page.tsx').default;
  const render = category => {
    const states = [payload.events, false, '', 0, category, payload.caseCode];
    React.useState = () => { assert.ok(states.length); return [states.shift(), () => {}]; };
    React.useContext = () => ({ id: caseId });
    const tree = Page();
    React.useContext = originals[5];
    assert.equal(states.length, 0);
    React.useState = originals[3];
    return renderToStaticMarkup(tree);
  };
  for (const category of ['All', 'Evidence']) {
    const html = render(category);
    assert.match(html, /EVIDENCE_BOOKMARK_NOTE_CREATED/);
    assert.match(html, /Private investigator note added to saved evidence/);
    assert.match(html, /2026-09-29T20:50:09.982Z/);
    assert.ok(html.includes(bookmarkId));
    assert.ok(html.includes(noteId));
  }
  assert.doesNotMatch(render('Case'), /EVIDENCE_BOOKMARK_NOTE_CREATED/);

  // A rejected row fails the request visibly; it must not be silently dropped
  // while older events continue to be returned as a successful response.
  for (const metadata of [{ bookmarkId }, { noteId, bookmarkId, note_text: 'private sentinel' }]) {
    rows = [{ ...event, metadata }];
    const rejected = await get();
    assert.equal(rejected.status, 503);
    const body = await rejected.text();
    assert.doesNotMatch(body, /private sentinel|"events"/);
  }
});
