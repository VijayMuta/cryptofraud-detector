const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./load-typescript.cjs');
const lib = load('src/lib/alerts.ts');
const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40), H = '0x' + '1'.repeat(64);
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('filters validate hex search, UTC boundaries, dates and workflow values', () => {
  assert.equal(lib.parseAlertFilters(new URLSearchParams('q=' + A.toUpperCase().replace('0X','0x'))).q, A);
  assert.equal(lib.parseAlertFilters(new URLSearchParams('q=' + H)).q, H);
  assert.equal(lib.parseAlertFilters(new URLSearchParams('status=needs_review&type=fund_splitting&from=2026-01-01&to=2026-01-02')).type, 'fund_splitting');
  for (const query of ['q=0x123),status.eq.new', 'wallet=bad', 'status=fraud', 'type=incoming', 'page=-1', 'from=2026-02-30', 'from=2026-02-02&to=2026-02-01']) assert.throws(() => lib.parseAlertFilters(new URLSearchParams(query)));
  assert.equal(lib.alertInvestigationUrl(A), '/investigate?address=' + A);
});
test('malformed stored evidence never creates fake links, zero amounts or unsafe precision', () => {
  const detail = lib.normalizeDetail({ id: uuid(1), wallet_monitors: [{ address: 'javascript:bad' }], source_transaction_hash: 'bad', details: { totalWei: '-1', transactionHashes: [H, 'not-a-hash', H], secret: 'never-return-this' }, created_at: 'invalid' }, { value_wei: 1000000000000000001, from_address: A, to_address: 'invalid', status: 'invented' }, false);
  assert.equal(detail.alert.wallet, null); assert.equal(detail.alert.source_transaction_hash, null); assert.equal(detail.alert.created_at, null);
  assert.equal(detail.transaction.valueWei, null); assert.equal(detail.evidence.totalWei, null); assert.equal(detail.transaction.to, null);
  assert.deepEqual(detail.evidence.hashes, [H]); assert.ok(!JSON.stringify(detail).includes('never-return-this'));
  assert.equal(lib.wei('1000000000000000001'), '1000000000000000001');
});

test('stored alert API: populated/empty, filters, exact counts, owner checks, detail and failure', async t => {
  const auth = load('src/lib/request-auth.ts'), adminModule = load('src/lib/supabase-admin.ts');
  const oldAuth = auth.getRequestUser, oldAdmin = adminModule.getSupabaseAdmin;
  t.after(() => { auth.getRequestUser = oldAuth; adminModule.getSupabaseAdmin = oldAdmin; });
  const route = load('src/app/api/alerts/route.ts'), detailRoute = load('src/app/api/alerts/[id]/route.ts');
  const { NextRequest } = require('next/server');
  const req = (query = '', body) => new NextRequest('http://localhost/api/alerts' + query, body ? { method: 'PATCH', body: JSON.stringify(body) } : undefined);
  const monitor = { id: uuid(10), user_id: 'owner', address: A, is_active: true, last_checked_at: new Date().toISOString(), last_successful_check_at: new Date().toISOString() };
  const foreign = { ...monitor, id: uuid(11), user_id: 'other', address: B };
  const base = { monitor_id: monitor.id, wallet_monitors: monitor, alert_type: 'fund_splitting', severity: 'high', title: 'Test-only signal', description: 'Test-only evidence', source_transaction_hash: H, status: 'new', created_at: new Date().toISOString(), details: { totalWei: '3000000000000000000', destinationCount: 3, transactionHashes: [H] } };
  let rows = [ { ...base, id: uuid(1), severity: 'critical' }, { ...base, id: uuid(2), alert_type: 'unusual_movement', status: 'reviewing' }, { ...base, id: uuid(3), status: 'closed', created_at: '2020-01-01T00:00:00Z' }, { ...base, id: uuid(4), monitor_id: foreign.id, wallet_monitors: foreign } ];
  let failed = false, transactionFailed = false, calls = [];
  function query(table) {
    let predicates = [], options = {}, start = 0, end = Infinity, patch, one = false;
    const value = (row, key) => key.split('.').reduce((data, part) => data?.[part], row);
    const builder = {
      select(fields, opts = {}) { calls.push([table,'select',fields]); options = opts; return this; },
      eq(key,val) { calls.push([table,'eq',key,val]); predicates.push(row => value(row,key) === val); return this; },
      neq(key,val) { predicates.push(row => value(row,key) !== val); return this; },
      in(key,vals) { predicates.push(row => vals.includes(value(row,key))); return this; },
      gte(key,val) { predicates.push(row => value(row,key) >= val); return this; },
      lte(key,val) { predicates.push(row => value(row,key) <= val); return this; },
      lt(key,val) { predicates.push(row => value(row,key) < val); return this; },
      ilike(key,val) { const search = val.replaceAll('%','').toLowerCase(); predicates.push(row => String(value(row,key)).toLowerCase().includes(search)); return this; },
      or(expression) { calls.push([table,'or',expression]); const search = expression.split('%')[1]; const ids = expression.split('monitor_id.in.(')[1]?.replace(')','').split(',') || []; predicates.push(row => row.source_transaction_hash.includes(search) || ids.includes(row.monitor_id)); return this; },
      order() { return this; }, range(a,b) { start=a; end=b+1; return this; }, limit(n) { end=n; return this; },
      update(data) { calls.push([table,'update',data]); patch=data; return this; },
      maybeSingle() { one=true; return this; },
      then(resolve,reject) {
        if (failed || (table === 'monitor_transactions' && transactionFailed)) return Promise.resolve({ data:null,error:{message:'private-db-error'},count:null }).then(resolve,reject);
        const source = table === 'monitor_alerts' ? rows : table === 'wallet_monitors' ? [monitor,foreign] : [{ monitor_id: monitor.id, transaction_hash:H, from_address:A, to_address:B, value_wei:'1000000000000000001', occurred_at:base.created_at, status:'success' }];
        const matches = source.filter(row => predicates.every(p => p(row)));
        if(patch) matches.forEach(row=>Object.assign(row,patch));
        const data = matches.slice(start,end);
        return Promise.resolve({ data:options.head ? null : one ? data[0] || null : data,error:null,count:matches.length }).then(resolve,reject);
      }
    }; return builder;
  }
  adminModule.getSupabaseAdmin = () => ({ from:query });
  auth.getRequestUser = async () => null;
  assert.equal((await route.GET(req())).status,401);
  assert.equal((await route.PATCH(req('',{alertId:uuid(1),status:'closed'}))).status,401);
  assert.equal((await detailRoute.GET(req(),{params:{id:uuid(1)}})).status,401);
  auth.getRequestUser = async () => ({id:'owner'});
  let response = await route.GET(req('?page=1')); let data = await response.json();
  assert.equal(response.status,200); assert.equal(data.total,3); assert.equal(data.alerts.length,3);
  assert.ok(!data.alerts.some(row=>row.id===uuid(4))); assert.ok(!JSON.stringify(data).includes('user_id'));
  for(const [filter,expected] of [['status=needs_review',2],['severity=critical',1],['type=unusual_movement',1],['from=2020-01-01&to=2020-01-01',1],['wallet='+B,0],['q='+A,3],['q='+H,3]]) {
    const result = await (await route.GET(req('?page=1&'+filter))).json(); assert.equal(result.total,expected,filter);
  }
  assert.ok(calls.some(call=>call[0]==='wallet_monitors' && call[1]==='eq' && call[2]==='user_id' && call[3]==='owner'));
  const summary = (await (await route.GET(req('?summary=1'))).json()).summary;
  assert.equal(summary.total,3); assert.equal(summary.needsReview,2); assert.equal(summary.priority,2); assert.equal(summary.recent,2); assert.equal(summary.monitoredWallets,1); assert.equal(summary.critical,1);
  const detail = await (await detailRoute.GET(req(),{params:{id:uuid(1)}})).json();
  assert.equal(detail.transaction.valueWei,'1000000000000000001'); assert.equal(detail.evidence.destinationCount,3);
  assert.ok(calls.some(call=>call[0]==='monitor_transactions' && call[1]==='eq' && call[2]==='monitor_id' && call[3]===monitor.id));
  assert.ok(calls.some(call=>call[0]==='monitor_transactions' && call[1]==='select' && call[2].includes('value_wei::text')));
  calls=[];
  assert.equal((await detailRoute.GET(req(),{params:{id:uuid(4)}})).status,404);
  assert.equal((await route.PATCH(req('',{alertId:uuid(4),status:'closed'}))).status,404);
  assert.ok(!calls.some(call=>call[1]==='update'));
  assert.equal((await route.PATCH(req('',{alertId:uuid(1),status:'closed',user_id:'other'}))).status,200);
  assert.equal(rows[0].status,'closed');
  assert.equal((await route.PATCH(req('',{alertId:uuid(1),status:'fraud'}))).status,400);
  transactionFailed=true;
  const partial=await (await detailRoute.GET(req(),{params:{id:uuid(1)}})).json(); assert.equal(partial.transaction,null); assert.equal(partial.transactionUnavailable,true);
  transactionFailed=false; failed=true;
  response=await route.GET(req('?page=1')); assert.equal(response.status,500); assert.ok(!(await response.text()).includes('private-db-error'));
  assert.equal((await route.GET(req('?summary=1'))).status,500);
  failed=false; rows=[];
  data=await (await route.GET(req('?page=1'))).json(); assert.deepEqual(data.alerts,[]); assert.equal(data.total,0);
});
