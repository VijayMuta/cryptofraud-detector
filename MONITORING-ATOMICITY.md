# STAB-01: atomic monitoring persistence

## Manual migration order

`supabase-monitoring-atomicity.sql` requires the monitoring tables, uniqueness
constraints, and permissions from the already-installed `supabase-schema.sql`.
It is independent of case/evidence migrations. Do not rerun older migrations.
An operator must apply this new migration before running the updated monitor code.
The migration has not been applied by this change.

It adds only `public.persist_wallet_monitor_check`; no tables, policies, existing
rows, schedules, providers, or environment variables change. Creation and execution
privilege changes are enclosed in one migration transaction. Only `service_role`
receives EXECUTE; PUBLIC, anon, and authenticated do not. The function uses
SECURITY INVOKER, an empty search path, and schema-qualified tables. Existing
service-role table privileges and owner-read RLS remain unchanged. Existing API
authentication/ownership checks remain in place; the function additionally checks
the supplied owner/address against the active Ethereum monitor and locks that row.

## Persistence behavior

The existing detectors calculate candidates from the same latest-100 transaction
sample with the same thresholds and formatting. A single RPC inserts transactions
with their analysis, filters candidate alerts to the hashes actually inserted,
inserts alerts, and updates successful-check status. Any database error aborts the
whole call. Existing transaction and alert uniqueness constraints remain effective.
The row lock serializes overlapping checks for a monitor.

Baseline seeding is unchanged. Existing/baseline transactions are not updated and
cannot produce new alerts through this RPC. Alert payloads are constructed only
by the existing server-side detectors, not supplied by browser callers.

After a failed RPC the application may separately record failure time/message;
that diagnostic write cannot mark success or persist transaction/alert evidence.
No sequential-write fallback exists when the function is absent or unavailable.
If a response is lost after commit, retry deduplicates the already-committed set.

## Automated verification

Run `node --test tests/monitoring-atomicity.test.cjs tests/eth-formatting.test.cjs tests/alerts.test.cjs`.
The new tests use an explicitly transactional in-memory RPC simulator, including
failure after transaction/analysis insertion, after alert insertion, before final
commit, and after commit but before response delivery. They exercise the real
monitoring code and detectors, retries, deduplication, baseline suppression,
fund-splitting alerts, empty checks, and missing-function failures. SQL structure
and access restrictions are checked separately. These tests do not execute SQL
or prove PostgreSQL runtime behavior; no local PostgreSQL runtime was available.

## Manual database and browser verification

Use a disposable local/test Supabase project with test-owned monitoring records;
do not inject failures into production. Install the prerequisite schema and then
this migration there. Before production use:

1. Verify anon/authenticated RPC calls fail with permission denied. Verify the
   service role can call it, while a mismatched owner/address or inactive/missing
   monitor fails without persisting evidence.
2. Prepare a service-role RPC payload with a fresh transaction hash, its analysis,
   and a detector-derived alert for that hash. In the test copy only, set that
   alert's severity to an invalid value to force the existing CHECK constraint to
   fail after transaction insertion. Confirm no transaction, analysis, or alert
   was committed and `last_successful_check_at` did not advance. Restore the valid
   severity, repeat the same payload, and confirm the complete set persists.
3. In the disposable project, temporarily add a BEFORE UPDATE trigger on
   `wallet_monitors` which raises when this fixture's successful-check timestamp
   changes. Repeat with another fresh hash and valid alert. Confirm even the
   transaction and alert inserts roll back. Remove the test trigger, retry the
   identical payload, and confirm both persist. Never ship that test trigger.
4. Replay the successful payload and issue two concurrent calls for another fresh
   payload. Confirm one transaction per monitor/hash and one alert per
   monitor/hash/type, with analysis present and accurate returned counts.
5. Seed a qualifying historical baseline using the existing UI workflow, then
   check it: no historical alert should appear. In a test account, verify a later
   qualifying check creates the expected real alert and repeated **Check now**
   does not duplicate it. Verify failures remain visible and a successful retry
   clears the error. Verify another account cannot check the monitor.
6. After test verification, an authorized operator applies only the new migration
   to the intended Supabase project before releasing this application change.

## Limitations and rollback

This fixes future persistence atomicity, not historical missing alerts. No backfill
is performed: old baseline and previously committed hashes remain suppressed.
Retries use the current provider sample; transactions that fall out of the existing
latest-100 window may not be retrievable on retry. Sampling, scheduling, detector
accuracy, and baseline setup concurrency are unchanged and outside STAB-01.
Failure-status recording remains best effort and can fail during a database outage;
overlapping attempts can still report status timestamps out of chronological order.

Until the migration is applied, checks fail closed with a migration/retry message.
Do not remove the function while the updated application depends on it. A code
rollback reintroduces the original persistence risk; the unused function can remain
without changing existing monitoring behavior. No rollback or deployment is run
as part of this change.
