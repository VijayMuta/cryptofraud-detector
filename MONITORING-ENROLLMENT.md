# AUD-H01: atomic wallet monitor baseline enrollment

## Scope and cause

Previously, enrollment inserted baseline hashes, reset the checkpoint and activated
the monitor in separate database requests. Two requests could observe an inactive
monitor, then one could activate it before the other inserted a later snapshot.
The second request's checkpoint reset failed, but its inserted hashes remained.
STAB-01 correctly suppressed alerts for those existing hashes, permanently hiding
the newly arrived qualifying transaction from normal monitoring.

This change fixes enrollment only. It does not change providers, schedules,
detector thresholds, ETH formatting, pagination, or AUD-H02/H03/H04/H05.

## Transaction and concurrency contract

`POST /api/monitors` verifies the user and reads only that user's Ethereum monitor.
An already active monitor is returned without fetching/seeding another baseline.
Otherwise the server retrieves the same latest-100 provider baseline and calls
`enroll_wallet_monitor` once. There is no sequential persistence fallback.

For an existing monitor, the RPC selects the matching ID, owner, address and network
FOR UPDATE. Before inserting any baseline hash, it requires the row to remain
inactive and its `updated_at` to match the exact timestamp observed by the route.
The timestamp is passed through unchanged, avoiding JavaScript precision loss.
State changes, including activation followed by pausing, invalidate old requests.

For first enrollment, a null monitor ID means "expect no monitor." An inactive row
is inserted inside the same transaction. The existing unique owner/address/network
constraint serializes competing inserts. A conflict raises SQLSTATE 40001 rather
than reusing a winner's row with a delayed snapshot. This also prevents partially
created monitor rows if first enrollment fails.

After validation, the RPC inserts baseline transactions using the existing unique
monitor/hash constraint and ON CONFLICT DO NOTHING. Existing evidence and analysis
are never overwritten. It calls STAB-02's `get_wallet_monitor_cursor(..., true)`
while still inactive, then activates the monitor and updates check status. All
operations commit together. Any error rolls them all back. Lock order remains
monitor first, cursor second, matching STAB-01/STAB-02.

A stale request returns HTTP 409 with refresh/retry guidance. The rejected request
cannot insert its later snapshot. A normal check then processes that new activity
and can create its alert. An HTTP retry after activation returns the active monitor
without reseeding, including after a lost commit response. RPC errors or uncertain
responses fail closed; no client-supplied owner or transaction payload is accepted
by the HTTP enrollment endpoint.

Legitimate re-enrollment of a paused monitor continues to suppress its newly
retrieved historical baseline. Baseline checkpoint semantics remain the maximum
stored block, including prior evidence. This is distinct from replaying a stale
enrollment snapshot after another request has activated the monitor.

## Manual migration and release order — not executed

Prerequisites, already installed on the described production system:

1. `supabase-schema.sql`
2. `supabase-monitoring-atomicity.sql` (STAB-01)
3. `supabase-monitoring-checkpoints.sql` (STAB-02)

Do not reapply those migrations. Apply only **`supabase-monitoring-enrollment.sql`**
once as a complete transaction. It adds one RPC and its execution permissions;
it does not alter tables, policies, existing RPCs or historical rows.

For rollout, temporarily prevent new enrollment requests and drain old enrollment
workers, apply the additive migration, release the matching application, then
restore enrollment access. Do not mix the old sequential enrollment implementation
with the new one: old workers can still perform their former baseline writes.
Existing monitor checks do not depend on this new RPC and keep their current
STAB-01/STAB-02 behavior. No environment-variable change is required.

## Security

The new function uses SECURITY INVOKER, an empty search path and schema-qualified
objects. EXECUTE is revoked from PUBLIC, anon, authenticated and service_role,
then granted only to service_role in the same migration transaction. Table grants
and RLS policies are unchanged. The route derives the owner from verified auth;
the RPC validates the existing monitor identity and state under lock. Baseline
rows cannot choose a target monitor: the function uses its validated monitor ID.
As with existing server RPCs, the service role is a trusted caller, not an end-user
identity inferred from `auth.uid()`.

## Verification before release

Automated tests use the real route/helper/detectors with an in-memory transaction
contract simulator. They test both race paths, rollback, lost-response retries,
identity rejection, baseline suppression and alert retention. SQL structure and
grants are checked statically. This is not PostgreSQL lock or RLS execution testing.

In a disposable Supabase project, an operator should:

1. Apply prerequisites and the new migration in the order above. Confirm the
   function exists with SECURITY INVOKER and empty search_path. Verify anon and
   authenticated cannot execute it; only service_role has application execution.
2. Call the RPC with a null monitor ID, null expected timestamp, real test-user ID,
   canonical address, checked-at timestamp and a valid baseline array. Confirm one
   active monitor, unique baseline rows, null baseline analysis, no alerts and a
   cursor at the maximum stored block. Also test an empty baseline.
3. Pause the monitor. Capture its exact `updated_at`. Open two database sessions.
   In session A, BEGIN and invoke the RPC with that ID/timestamp and baseline T1;
   leave the transaction uncommitted. In session B, invoke it with the same
   identity/timestamp but baseline T2 containing one additional qualifying hash.
   Confirm B waits. COMMIT A; B must fail with 40001 and its additional hash must
   not exist. ROLLBACK B if its explicit transaction is now aborted.
4. Repeat with two first-enrollment calls (null ID) for a fresh owner/address pair.
   The unique constraint must allow one winner and reject the other before any
   losing baseline rows are written. If the winner rolls back instead, the waiting
   first enrollment may legitimately succeed and must be internally atomic.
5. Run Check now with the additional qualifying transaction present in provider
   history. Confirm its evidence, analysis and alert persist exactly once. Replay
   and retry the rejected POST: neither baseline nor alerts should duplicate.
6. Change the monitor active then inactive after capturing its timestamp. Attempt
   enrollment using the old timestamp: reject without baseline/cursor changes.
   Retry using freshly read inactive state: legitimate re-enrollment should work.
7. Try a wrong monitor ID, owner, address, network or missing expected timestamp.
   Confirm no existing-monitor baseline writes. Verify unauthenticated HTTP POST
   returns 401 and a forged body owner is ignored in favor of the authenticated user.
8. In the disposable project only, inject a failing cursor or activation trigger.
   Invoke first enrollment and re-enrollment. Confirm baseline, cursor, activation
   and newly created monitor row all roll back, then remove the test trigger and
   retry. Also simulate a lost response after commit; POST retry should return the
   active monitor without consuming a newer provider baseline.
9. Re-run existing STAB-01 failure injection and STAB-02 >100-row, incomplete,
   checkpoint, interrupted-retry and replay checks. Confirm successful historical
   baseline rows remain suppressed and pagination behavior is unchanged.

## Rollback and limitations

The migration is additive and performs no backfill. Leave the function installed
if code rollback is necessary. Do not drop it while new enrollment callers exist.
Returning to the old enrollment route reintroduces AUD-H01; keep enrollment disabled
until a safe version is restored rather than treating old code as a safe rollback.
Existing checks can continue independently. No automatic rollback is provided.

This does not repair hashes/alerts swallowed before the fix. Provider completeness,
same-block baseline suppression, reorg/late-indexing limitations, bounded detection
context and STAB-02 retrieval budgets remain unchanged. The state comparison relies
on the existing `wallet_monitors` updated-at trigger; privileged writes that disable
or bypass it are outside the application contract. Database permissions/locking and
production behavior still require the manual verification above. No SQL is applied,
environment changed, or deployment performed by this local implementation.
