# STAB-02: checkpoint-based bounded monitoring

## Cause and remediation

The previous monitor fetched only the newest 100 normal Ethereum transactions.
More than 100 transfers between checks could permanently fall outside that sample,
including qualifying alerts, while the check still reported success. STAB-01 made
that sample atomic but did not establish retrieval coverage.

STAB-02 retrieves ascending 100-row pages from the stored confirmed block plus
one. The newest observed transaction block pins the upper boundary for the entire
catch-up, including retries. This covers forward from the previous checkpoint;
it does not search backwards for a checkpoint hash. Initialization uses the maximum
stored transaction block, never the live provider head. An empty baseline starts
at block 1. Explicit re-enrollment resets an inactive monitor to its stored baseline.

Each invocation retrieves at most two pages, with a 25-second retrieval budget.
Cron stops starting work after 45 seconds and checks the oldest checked monitors
first. Provider requests use the remaining budget, capped at ten seconds. Database
requests and analysis are not forcibly cancelled by these budgets.

Full pages advance the resume position but leave the confirmed boundary and
previous successful-check timestamp unchanged. The next request restarts at the
last block inclusively, using page 1 when that block advances and incrementing the
page when it does not. This limits offsets across large histories and handles
multiple pages in a single block. Overlapping rows are deduplicated by STAB-01.
Exactly full pages require a further request to prove exhaustion.

A short page confirms completion only after the pinned head block has been seen.
The application rejects early exhaustion, malformed rows, unordered pages and
duplicates within a page. SQL independently rejects completion without persisted
evidence at the witnessed head. Errors or page/time limits report incomplete
coverage and retain committed progress. Newly arriving blocks wait for the next
range after completion. Provider errors do not reset the cursor.

The page RPC locks the monitor, verifies ownership, active state, expected cursor
revision and range, then calls STAB-01 and updates the cursor in the same database
transaction. Any failure rolls back that page's evidence, analysis, alerts, status
and cursor together. Previously committed pages remain durable. Stale concurrent
pages fail and must reload the cursor. Lost responses are safe to retry; response
counts may understate writes whose successful response was lost.

Detector thresholds are unchanged. Each page is analyzed with up to 100 recently
stored transactions as context. Only newly inserted transaction hashes can create
alerts. Baseline rows retain their existing analysis and cannot generate retroactive
alerts. Both older-than-newest-100 and later-page alert cases are covered by tests.

## Manual migration order (not executed)

1. Verify `supabase-schema.sql` is already installed; do not rerun existing schema.
2. Install `supabase-monitoring-atomicity.sql` (STAB-01) if not already installed.
3. Quiesce cron and manual monitoring checks and drain older application workers.
4. Apply `supabase-monitoring-checkpoints.sql` once, as one transaction.
5. Release the matching STAB-02 application, then resume checks. Do not mix old
   latest-100 workers with checkpoint workers: old workers do not advance cursors.

The new migration creates `wallet_monitor_cursors` and two RPC functions. Existing
monitors initialize lazily from stored history. There is no historical backfill and
no environment-variable change. This work does not apply SQL or release code.
Do not drop the functions/table while STAB-02 code is running. Rolling code back
reintroduces the latest-100 coverage gap; coordinate any later re-upgrade with the
cursor state rather than silently resetting it.

## Security and RLS

The cursor table has RLS enabled with no browser policies. PUBLIC, anon and
authenticated have no cursor-table or new RPC access. Only service_role receives
SELECT/INSERT/UPDATE on the cursor table and EXECUTE on the new RPCs. Functions use
SECURITY INVOKER, an empty search path, schema-qualified objects and monitor
owner/address/network/state validation. Existing owner-read policies, API user
authentication, cron authorization, STAB-01 privileges and unique constraints are
unchanged. Alert candidates remain server-generated. The service key must remain
server-only, as before.

## Local validation and manual verification

Local commands:

```
node --test tests/monitoring-checkpoints.test.cjs tests/monitoring-atomicity.test.cjs tests/eth-formatting.test.cjs tests/alerts.test.cjs
node --test tests/*.test.cjs
npm.cmd run typecheck
npm.cmd run build
git diff --check
```

Tests execute real TypeScript monitoring and detector logic against an in-memory
transaction contract simulator. They do not execute PostgreSQL. SQL access and
transaction structure are reviewed and checked statically. Before release, an
operator should perform these checks in a disposable test Supabase project:

1. Install prerequisites and STAB-02 in the order above. Verify anon/authenticated
   cannot read cursors or execute either RPC. Test mismatched owners, addresses,
   inactive monitors and stale revisions with the service role; all must fail.
2. Seed a known baseline, then supply more than 100 subsequent normal transactions
   through a controlled provider fixture. Include unusual transfers both outside
   the newest 100 and on a later ascending page, and splitting across a page edge.
   Use Check now repeatedly and verify every hash and expected alert is stored once.
3. With more than two pages, verify partial checks display an error/incomplete
   state and preserve `last_successful_check_at` and `confirmed_block`. Interrupt
   the second retrieval, resume, and verify the pinned upper range does not move.
4. Test more than 200 transactions in one block and an exactly full final page.
   Verify completion requires exhaustion, and later blocks are picked up in the
   following range. Return an empty page before the witnessed head: no success.
5. In the disposable database only, inject a failing cursor-update trigger and
   repeat STAB-01's invalid-alert/status fault tests from MONITORING-ATOMICITY.md.
   Verify the entire page rolls back, including evidence and alerts. Remove the
   test triggers, retry, replay and issue concurrent requests; inspect uniqueness
   and revision advancement. Also simulate a lost response after commit.
6. Confirm baseline-only checks produce no alerts, re-enrollment suppresses its
   baseline, another user cannot check the monitor, and cron resumes oldest work.

## Remaining limitations

- Coverage relies on a truthful, consistently ordered provider response. The head
  guard catches premature exhaustion before that block, not arbitrary omissions
  within a block or internally truncated histories that still include the head.
- Blocks are observed provider boundaries, not consensus-finalized checkpoints.
  Reorganizations and late indexing at/below a confirmed block are not reconciled.
  Historical gaps predating initialization are not repaired. Baseline suppression
  applies through its highest stored block, including unseeded rows in that block.
- Normal Ethereum transactions only; internal transfers and token events are not
  added. Extreme single-block histories remain subject to provider paging limits;
  provider errors retain incomplete status for a later retry/operator review.
- Detector context is bounded, not a full 24-hour history for arbitrarily busy
  wallets. Pagination can change statistical context relative to the old sample;
  tests establish representative alert retention, not detection of every anomaly.
- Baseline setup concurrency and best-effort diagnostic status writes remain as
  before. A stale attempt can overwrite a newer diagnostic error/time, but cannot
  advance its checkpoint or write duplicate evidence. Large backlogs require
  repeated checks; scheduling throughput is unchanged.
- PostgreSQL execution, live provider behavior and browser verification remain
  manual. No SQL migration was applied during local validation.
