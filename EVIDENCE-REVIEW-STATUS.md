# Case Evidence Review Status

Saved Evidence shows each bookmark's investigator workflow state:

| Stored value | Display label |
| --- | --- |
| `unreviewed` | Unreviewed |
| `in_review` | In Review |
| `verified` | Verified |
| `needs_follow_up` | Needs Follow-up |

Any transition between these four states is allowed, including a return to
Unreviewed. Review status is an investigator workflow state, **not proof that
an address, transaction, or person committed fraud**. Verified is not an
independent blockchain verification, integrity check, or legal conclusion.

## Setup: new migration only

In the intended Supabase project's SQL Editor, review and run the **entire
`supabase-evidence-review-status.sql` file, including BEGIN and COMMIT, once**.
Test in a development project first. Install only missing prerequisites in this
order; never rerun or modify a previously applied migration:

1. `supabase-schema.sql`
2. `supabase-phase5-schema.sql`
3. `supabase-case-activity.sql`
4. `supabase-case-notes.sql`
5. `supabase-case-bookmarks.sql`
6. `supabase-evidence-tags.sql`
7. `supabase-evidence-bookmark-notes.sql`
8. **`supabase-evidence-review-status.sql` (new)**

For the project with Bookmark Notes already installed, only step 8 is required.
The new migration depends on the composite bookmark key installed by Bookmark
Notes and retains all prior activity event types. Do not rerun older scripts
that restore narrower activity constraints. This migration is transactional but
is not intended to be rerun after successful installation. No SQL is applied
automatically. No migration was applied during implementation.

## Storage and security

`public.case_evidence_review_statuses` has `bookmark_id` as its primary key,
`case_id`, a constrained `status`, `updated_by`, and database-managed `updated_at`.
A composite foreign key `(bookmark_id, case_id)` prevents case/bookmark
mismatches and cascades on bookmark removal. Case deletion also cascades.
`updated_by` references `auth.users`. Membership keys cannot be changed by an
update. A case index supports owner-scoped reads.

A missing row means Unreviewed for both existing and new bookmarks. Reads do
not insert rows or create audit events; the default response has null updater
and timestamp. The first explicit write persists a row. An initial explicit
Unreviewed write records its updater/time but creates no status-change event.
There is no backfill and no additional write in bookmark creation.

RLS allows SELECT only by the authenticated case owner. Anonymous access and
direct authenticated INSERT/UPDATE/DELETE are denied. The server role receives
SELECT/INSERT/UPDATE only. The API authenticates, checks real case ownership,
and verifies bookmark membership before any status access. The database trigger
rechecks owner/membership and locks the parents during the write. No client
supplied user ID, timestamp or case/bookmark override is accepted. Privileged
database administrators retain access, as with existing features. Attribution
uses the server-validated updater; privileged maintenance could supply an owner
ID and is not independent proof of human identity.

## API and UI

`GET/PUT /api/cases/[id]/bookmarks/[bookmarkId]/review-status`:

- GET returns `{ review: { bookmark_id, case_id, status, updated_by, updated_at } }`,
  including the effective default for a missing row.
- PUT accepts exactly `{ "status": "in_review" }` and returns the persisted
  review row with HTTP 200. Unknown fields and arbitrary statuses are rejected.
- Responses use `Cache-Control: no-store`. Signed-out requests return 401;
  inaccessible cases and foreign/missing bookmarks return 404; malformed bookmark
  IDs and invalid bodies return 400; bodies over 1,024 JavaScript string units
  return 413. Unconfirmed writes and database failures return safe 503 messages.

Each Saved Evidence entry loads its review status separately. The UI displays
the current status, controlled selector, Save and Refresh buttons, updater/time
when present, and the workflow disclaimer. Loading and failures are explicit;
a failed read is not presented as Unreviewed. Successful saves update the visible
state; failures require refresh before another save. Buttons disable during
loading/saving and a synchronous guard prevents repeated in-flight submissions.
Changing the selection alone performs no write. Existing tags, filtering, notes,
and bookmark APIs retain their behavior. If the new migration is missing, review
controls show a recoverable error without blocking tags or notes.

## Audit and concurrency

PUT uses one PostgreSQL upsert on `bookmark_id`. The primary key and conflict
handling serialize writes to the same review row, including concurrent first
writes. The last serialized write wins; no stale-edit conflict check is offered.
The database derives the previous state from the locked OLD row (or Unreviewed
for an insert), never from client metadata.

An AFTER INSERT/UPDATE trigger records `EVIDENCE_REVIEW_STATUS_CHANGED` only
when the effective status changes. Metadata contains **exactly** `bookmarkId`,
`previousStatus`, and `status`. No note text, provider payload, or free-form
content is copied. Audit failure rolls back the status write. Same-status
updates preserve updater/time and create no event. Retrying an already-achieved
status is therefore a no-op unless an intervening transition changed the state.

The event appears under All/Evidence, source `evidence-review`, origin `database`.
Activity reads/exports validate the exact review-status metadata separately
from case-status metadata. The generic activity POST rejects this event.
No browser event is fabricated. Removing a bookmark deletes its review row but
retains prior case activity; no review-deletion event is synthesized. Removing
the case deletes its activity as before.

## Automated checks

```text
node --test tests/evidence-review-status.test.cjs tests/bookmark-note-activity.test.cjs tests/evidence-bookmark-notes.test.cjs tests/evidence-tags.test.cjs tests/case-bookmarks.test.cjs tests/case-notes.test.cjs tests/case-activity.test.cjs
node --test tests/*.test.cjs
npm.cmd run typecheck
npm.cmd run build
git diff --check
```

Validation on 2026-09-30: **44 focused tests and 139 full-suite tests passed**.
The standalone TypeScript check and production build passed. Diff/whitespace
checks passed, including new files. Applied migrations and environment files
were unchanged. No SQL or live browser verification was performed for this feature.

Tests cover controlled values, spoofing rejection, authentication, ownership,
membership, default reads, transition requests, safe errors, metadata/export,
activity retrieval and fabrication rejection, rendered UI states, and duplicate
click protection. Existing tags/notes/bookmark regressions remain included.
Database tests inspect SQL; API persistence and UI hooks are mocked. They do
not execute PostgreSQL or prove live RLS, rollback, or concurrency behavior.

## Manual verification after installing the migration

1. Sign in as owner A. Open a case with existing and newly created bookmarks.
   Each should load as Unreviewed without creating review events. Confirm tags,
   tag filtering, private bookmark notes, and transaction links still work.
2. Change a bookmark through In Review, Verified, Needs Follow-up, and Unreviewed.
   Save each change, refresh its status and reload the page. Confirm persistence,
   updater account ID, UTC timestamp, success message and workflow disclaimer.
3. Refresh Case Activity with All and Evidence. Verify one event per actual
   transition, correct previous/current values, `evidence-review`/`database`,
   and only the three allowed metadata keys in the UI and audit JSON export.
4. Save the same status again via PUT. Confirm no additional event or changed
   timestamp. Rapidly click Save: only one request should be in flight. In two
   tabs submit the same and then different statuses. Refresh both; verify one
   row and an audit chain matching actual serialized transitions.
5. Sign out and verify GET/PUT returns 401. With account B, attempt access to A's
   case/bookmark and a foreign bookmark under B's case; expect 404 and no writes.
   Attempt arbitrary statuses and `updated_by`/timestamp overrides; expect 400.
   Attempt this event through generic activity POST; expect rejection.
6. With authenticated Supabase clients in an isolated development project,
   verify owner-only SELECT and denied direct INSERT/UPDATE/DELETE. In a test
   transaction, verify database rejection of mismatched membership and non-owner
   updater. Force audit insertion to fail and verify status rollback; roll back
   all fault-injection changes. These checks are manual, not run by the tests.
7. Simulate failed reads/saves, confirm visible errors, disabled writes until
   refresh, and working retry. After a lost response, refresh before retrying.
8. Remove a disposable bookmark: review row/notes/tags disappear, prior case
   activity remains. Remove a disposable case: its activity cascades as before.

## Known limitations

One extra GET per displayed bookmark; no bulk status read or review-status
filter. No cross-tab synchronization, optimistic concurrency check, offline
queue, or automated retries. Concurrent differing writes use last-write-wins;
refresh to see another tab's change. Status is not included in evidence packages.
Live browser/SQL verification remains a manual step after migration installation.
