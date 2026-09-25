const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const { load } = require('./load-typescript.cjs');
const activity = load('src/lib/case-activity.ts');
const { ACTIVITY_DEFINITIONS, validateActivityMetadata: validate, orderActivity, exportActivity } = activity;
const caseId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const completedAt = '2026-09-25T12:00:00.000Z';
const fixtures = {
  CASE_CREATED: { status: 'open' },
  CASE_STATUS_CHANGED: { previousStatus: 'open', status: 'closed' },
  WALLET_ADDED: { network: 'ethereum', walletAddress: '0x' + 'a'.repeat(40) },
  WALLET_REMOVED: { network: 'ethereum', walletAddress: '0x' + 'a'.repeat(40) },
  BLOCKCHAIN_EVIDENCE_REFRESHED: { requestedWallets: 2, loadedWallets: 1, provider: 'Alchemy', component: 'investigation-timeline', completedAt },
  TRANSACTION_VIEWED: { network: 'ethereum', transactionHash: '0x' + 'b'.repeat(64) },
  EVIDENCE_PACKAGE_GENERATED: { packageVersion: 'chaintrace-evidence-v1', completedAt },
  EVIDENCE_INTEGRITY_VERIFIED: { packageVersion: 'chaintrace-evidence-v1', packageType: 'case-report', fingerprint: 'c'.repeat(64) },
  EVIDENCE_INTEGRITY_MISMATCH: { packageVersion: 'chaintrace-evidence-v1', packageType: 'case-report', fingerprint: 'd'.repeat(64) },
  FREEZE_HOLD_PACKAGE_PREPARED: { completedAt },
  CASE_NOTE_CREATED: { noteId: operationId },
};
test('all supported events validate exact safe metadata without mutation', () => {
  assert.deepEqual(Object.keys(fixtures), Object.keys(ACTIVITY_DEFINITIONS));
  for (const [type, data] of Object.entries(fixtures)) {
    const before = JSON.stringify(data);
    assert.deepEqual(validate(type, data), data);
    assert.equal(JSON.stringify(data), before);
  }
});
test('invalid events, missing fields, secrets, full responses and nested objects are rejected', () => {
  for (const type of ['FUNDS_FROZEN', '__proto__', 'toString', null, 1]) assert.throws(() => validate(type, {}));
  for (const field of ['password', 'access_token', 'apiKey', 'service_role', 'cookie', 'Authorization', 'response', 'notes', '__proto__']) {
    assert.throws(() => validate('CASE_CREATED', JSON.parse(JSON.stringify({ status: 'open' }).slice(0, -1) + ',"' + field + '":"secret"}')));
  }
  for (const status of ['Bearer secret', { token: 'secret' }, ['open'], null]) assert.throws(() => validate('CASE_CREATED', { status }));
  assert.throws(() => validate('CASE_CREATED', {}));
  assert.throws(() => validate('CASE_CREATED', Object.defineProperty({}, 'status', { get() { throw Error('Getter must not execute'); } })));
  assert.throws(() => validate('CASE_STATUS_CHANGED', { status: 'open', previousStatus: 'open' }));
});
test('wallet and transaction references are constrained to Ethereum addresses and hashes', () => {
  assert.throws(() => validate('WALLET_ADDED', { network: 'ethereum', walletAddress: '<script>secret</script>' }));
  assert.throws(() => validate('TRANSACTION_VIEWED', { network: 'bitcoin', transactionHash: fixtures.TRANSACTION_VIEWED.transactionHash }));
  assert.throws(() => validate('TRANSACTION_VIEWED', { network: 'ethereum', transactionHash: 'bad' }));
  for (const loadedWallets of [0, 3, -1, 1.5]) assert.throws(() => validate('BLOCKCHAIN_EVIDENCE_REFRESHED', { ...fixtures.BLOCKCHAIN_EVIDENCE_REFRESHED, loadedWallets }));
});
test('MATCH and MISMATCH events retain safe fingerprints; mismatch and preparation labels assert no external outcomes', () => {
  assert.match(ACTIVITY_DEFINITIONS.EVIDENCE_INTEGRITY_VERIFIED[0], /MATCH/);
  assert.match(ACTIVITY_DEFINITIONS.EVIDENCE_INTEGRITY_MISMATCH[0], /may be legitimate/);
  assert.equal(ACTIVITY_DEFINITIONS.FREEZE_HOLD_PACKAGE_PREPARED[0], 'Freeze/Hold evidence package prepared in CHAINTRACE.');
  assert.doesNotMatch(ACTIVITY_DEFINITIONS.FREEZE_HOLD_PACKAGE_PREPARED[0], /funds frozen|received|approved|seized/i);
  assert.throws(() => validate('EVIDENCE_INTEGRITY_VERIFIED', { ...fixtures.EVIDENCE_INTEGRITY_VERIFIED, fingerprint: 'token' }));
});
const event = (id, time = completedAt) => ({ id, case_id: caseId, actor_user_id: null, event_type: 'CASE_CREATED', event_timestamp: time, metadata: fixtures.CASE_CREATED, origin: 'database' });
test('ordering is newest-first, stable for ties, nonmutating; empty state does not invent history', () => {
  const events = [event('a'), event('b'), event('c', '2026-09-24T12:00:00.000Z')];
  assert.deepEqual(orderActivity(events).map(x => x.id), ['b', 'a', 'c']);
  assert.deepEqual(events.map(x => x.id), ['a', 'b', 'c']);
  assert.deepEqual(orderActivity([]), []);
  assert.match(activity.ACTIVITY_EMPTY, /since audit tracking became available/);
});
test('export is canonical and deterministic with fixed generation time, case scoped, and safe', () => {
  const a = event('a'), b = event('b');
  assert.equal(exportActivity(caseId, [a, b], completedAt), exportActivity(caseId, [b, a], completedAt));
  const parsed = JSON.parse(exportActivity(caseId, [], completedAt));
  assert.equal(parsed.caseId, caseId); assert.deepEqual(parsed.events, []);
  assert.throws(() => exportActivity(operationId, [a], completedAt));
  assert.throws(() => exportActivity(caseId, [{ ...a, metadata: { ...a.metadata, token: 'secret' } }], completedAt));
});
test('isolated schema enables owner-only reads, server-only writes, atomic triggers, no historical backfill', () => {
  const sql = fs.readFileSync('supabase-case-activity.sql', 'utf8');
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /c\.id = case_id and c\.created_by = auth\.uid\(\)/);
  assert.match(sql, /revoke all on public.case_activity_events from anon, authenticated/);
  assert.doesNotMatch(sql, /for (insert|update|delete) to authenticated/i);
  assert.match(sql, /unique \(case_id, operation_id\)/);
  assert.match(sql, /old.status is distinct from new.status/);
  assert.match(sql, /after insert or delete on public.case_wallets/);
  assert.doesNotMatch(sql, /insert into public.case_activity_events[^;]*select /i);
});
test('activity API enforces session, ownership, metadata, actor derivation and idempotency', async t => {
  const auth = load('src/lib/request-auth.ts'), adminModule = load('src/lib/supabase-admin.ts'), cases = load('src/lib/cases.ts');
  const saved = [auth.getRequestUser, adminModule.getSupabaseAdmin, cases.getOwnedCase];
  t.after(() => { [auth.getRequestUser, adminModule.getSupabaseAdmin, cases.getOwnedCase] = saved; });
  const route = load('src/app/api/cases/[id]/activity/route.ts');
  const { NextRequest } = require('next/server');
  const req = body => new NextRequest('http://localhost/api/cases/' + caseId + '/activity', { method: 'POST', body: JSON.stringify(body) });
  const valid = { eventType: 'TRANSACTION_VIEWED', metadata: fixtures.TRANSACTION_VIEWED, operationId };
  const params = { params: { id: caseId } };
  let inserted;
  auth.getRequestUser = async () => null;
  assert.equal((await route.POST(req(valid), params)).status, 401);
  auth.getRequestUser = async () => ({ id: 'trusted-user' });
  const chain = { upsert: async (row, options) => { inserted = { row, options }; return { error: null }; },
    select() { return this; }, eq() { return this; }, single: async () => ({ data: inserted.row, error: null }) };
  adminModule.getSupabaseAdmin = () => ({ from: () => chain });
  cases.getOwnedCase = async () => null;
  assert.equal((await route.POST(req(valid), params)).status, 404);
  cases.getOwnedCase = async (_admin, user, id) => { assert.equal(user, 'trusted-user'); assert.equal(id, caseId); return { id }; };
  for (const body of [{ ...valid, actor_user_id: 'spoof' }, { ...valid, eventType: 'CASE_CREATED', metadata: fixtures.CASE_CREATED }, { ...valid, metadata: { ...valid.metadata, password: 'secret' } }]) assert.equal((await route.POST(req(body), params)).status, 400);
  assert.equal((await route.POST(req(valid), params)).status, 200);
  assert.equal(inserted.row.actor_user_id, 'trusted-user'); assert.equal(inserted.row.case_id, caseId);
  assert.equal(inserted.row.origin, 'browser-reported'); assert.equal(inserted.row.event_timestamp, undefined);
  assert.deepEqual(inserted.options, { onConflict: 'case_id,operation_id', ignoreDuplicates: true });
  chain.single = async () => ({ data: { ...inserted.row, event_type: 'CASE_CREATED' }, error: null });
  assert.equal((await route.POST(req(valid), params)).status, 409);
  adminModule.getSupabaseAdmin = () => ({ from: () => ({ upsert: async () => ({ error: new Error('database failure') }) }) });
  assert.equal((await route.POST(req(valid), params)).status, 503);
});

test('explicit valid integrity comparisons map to the correct case event; invalid comparisons produce none', async () => {
  const { createEvidencePayload, createIntegrityRecord, verifyEvidence } = load('src/lib/evidence-integrity.ts');
  const payload = createEvidencePayload('case-evidence-package', { observed: 1 });
  const record = await createIntegrityRecord(payload, { caseId });
  const match = activity.integrityActivity(await verifyEvidence(payload, record.hash), record);
  assert.equal(match.caseId, caseId); assert.equal(match.eventType, 'EVIDENCE_INTEGRITY_VERIFIED');
  const mismatch = activity.integrityActivity(await verifyEvidence({ changed: true }, record.hash), record);
  assert.equal(mismatch.eventType, 'EVIDENCE_INTEGRITY_MISMATCH');
  assert.notEqual(match.metadata.fingerprint, mismatch.metadata.fingerprint);
  for (const result of [await verifyEvidence(payload, 'invalid'), await verifyEvidence(null, record.hash), { status: 'ERROR' }]) assert.equal(activity.integrityActivity(result, record), null);
  assert.equal(activity.integrityActivity(await verifyEvidence(payload, record.hash)), null);
});

test('activity reads are case scoped, ordered, paginated, empty-safe, and fail closed on stored sensitive metadata', async t => {
  const auth = load('src/lib/request-auth.ts'), adminModule = load('src/lib/supabase-admin.ts'), cases = load('src/lib/cases.ts');
  const saved = [auth.getRequestUser, adminModule.getSupabaseAdmin, cases.getOwnedCase];
  t.after(() => { [auth.getRequestUser, adminModule.getSupabaseAdmin, cases.getOwnedCase] = saved; });
  const { NextRequest } = require('next/server');
  const route = load('src/app/api/cases/[id]/activity/route.ts');
  const calls = [];
  let rows = [], failure = null;
  const chain = { select() { return this; }, eq(...args) { calls.push(['eq', ...args]); return this; }, order(...args) { calls.push(['order', ...args]); return this; }, range(...args) { calls.push(['range', ...args]); return Promise.resolve({ data: rows, error: failure }); } };
  auth.getRequestUser = async () => ({ id: 'owner' });
  cases.getOwnedCase = async () => ({ id: caseId, case_code: 'CF-test' });
  adminModule.getSupabaseAdmin = () => ({ from: () => chain });
  const req = offset => new NextRequest('http://localhost/api/cases/' + caseId + '/activity?offset=' + offset);
  const params = { params: { id: caseId } };
  let response = await route.GET(req(0), params);
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).events, []);
  assert.deepEqual(calls, [['eq', 'case_id', caseId], ['order', 'event_timestamp', { ascending: false }], ['order', 'id', { ascending: false }], ['range', 0, 99]]);
  rows = Array.from({ length: 100 }, (_, i) => event(String(i)));
  response = await route.GET(req(100), params);
  assert.equal((await response.json()).nextOffset, 200);
  assert.equal((await route.GET(req(-1), params)).status, 400);
  rows = [{ ...event('bad'), metadata: { status: 'open', token: 'secret' } }];
  response = await route.GET(req(0), params);
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /secret/);
  failure = new Error('provider secret');
  assert.equal((await route.GET(req(0), params)).status, 503);
  cases.getOwnedCase = async () => null;
  assert.equal((await route.GET(req(0), params)).status, 404);
  auth.getRequestUser = async () => null;
  assert.equal((await route.GET(req(0), params)).status, 401);
});

test('client logging failure preserves primary action and returns a visible warning without leaking errors', async t => {
  const api = load('src/lib/client-api.ts');
  const original = api.authenticatedFetch;
  t.after(() => { api.authenticatedFetch = original; });
  const { recordCaseActivity } = load('src/lib/case-activity-client.ts');
  let sent;
  api.authenticatedFetch = async (_path, options) => { sent = JSON.parse(options.body); return {}; };
  assert.equal(await recordCaseActivity(caseId, 'TRANSACTION_VIEWED', fixtures.TRANSACTION_VIEWED, operationId), '');
  assert.equal(sent.operationId, operationId); assert.equal(sent.actor_user_id, undefined);
  api.authenticatedFetch = async () => { throw Error('secret internal error'); };
  const warning = await recordCaseActivity(caseId, 'TRANSACTION_VIEWED', fixtures.TRANSACTION_VIEWED, operationId);
  assert.equal(warning, activity.ACTIVITY_WARNING); assert.doesNotMatch(warning, /secret/);
});
