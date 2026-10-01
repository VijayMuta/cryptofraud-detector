const assert = require('node:assert/strict');
const { test } = require('node:test');
const { NextRequest } = require('next/server');
const { load } = require('./load-typescript.cjs');

test('Next.js 15 promised route params preserve authentication and case validation', async t => {
  const auth = load('src/lib/request-auth.ts');
  const original = auth.getRequestUser;
  t.after(() => { auth.getRequestUser = original; });
  const routes = [
    'alerts/[id]', 'victim-reports/[id]', 'cases/[id]',
    'cases/[id]/activity', 'cases/[id]/analysis', 'cases/[id]/notes',
    'cases/[id]/wallets', 'cases/[id]/bookmarks',
    'cases/[id]/bookmarks/[bookmarkId]/notes',
    'cases/[id]/bookmarks/[bookmarkId]/review-status',
    'cases/[id]/bookmarks/[bookmarkId]/tags',
  ];
  for (const path of routes) {
    const route = load(`src/app/api/${path}/route.ts`);
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter(method => route[method])) {
      await t.test(`${method} ${path}`, async () => {
        const request = () => new NextRequest('http://localhost/api/test', { method });
        const context = () => ({ params: Promise.resolve({ id: 'invalid', bookmarkId: 'invalid' }) });
        auth.getRequestUser = async () => null;
        assert.equal((await route[method](request(), context())).status, 401);
        // These routes validate the ID before constructing a database client.
        if (path.startsWith('cases/') && !['cases/[id]', 'cases/[id]/analysis', 'cases/[id]/wallets'].includes(path)) {
          auth.getRequestUser = async () => ({ id: 'test-user' });
          assert.equal((await route[method](request(), context())).status, 404);
        }
      });
    }
  }
});
