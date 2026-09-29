# Case Evidence Tags / Classification

Tags are investigator classifications, not automated conclusions or proof of fraud.
They classify existing Case Evidence Bookmarks without copying transactions,
notes, provider responses, or other evidence payloads. Existing bookmark labels
(Review, Key transfer, Follow up) remain independent and unchanged.

## Controlled vocabulary

| Stable identifier | UI label |
| --- | --- |
| exchange | Exchange |
| bridge | Bridge |
| mixer | Mixer |
| victim_transfer | Victim Transfer |
| suspect_transfer | Suspect Transfer |
| funding_source | Funding Source |
| destination | Destination |
| intermediate_wallet | Intermediate Wallet |
| high_value | High Value |
| review_required | Review Required |

The application allowlist is `src/lib/evidence-tags.ts`; PostgreSQL enforces the
same identifiers with a CHECK constraint. Adding vocabulary requires a future
migration plus an application change. Arbitrary names and metadata are rejected.

## Schema and security

`public.case_evidence_tags` is a normalized assignment table:

- `bookmark_id`: UUID foreign key to `case_evidence_bookmarks`, ON DELETE CASCADE.
- `tag_id`: controlled text identifier; composite primary key `(bookmark_id, tag_id)`.
- `created_by`: authenticated owner UUID, referencing `auth.users` with DELETE RESTRICT.
- `created_at`: server timestamp, forced to `clock_timestamp()` by an insert trigger.

The primary key prevents duplicates, including racing requests. Assignments
cannot be updated through the API. Service-role table privileges are explicitly
limited to SELECT/INSERT/DELETE. Browser clients have owner-only SELECT RLS and
no write grants or policies. Reads join through the bookmark to its case owner.
An insert validation trigger additionally checks that the supplied creator owns
the case and locks the parent rows for the statement's transaction.

The existing authenticated request validator and server-only Supabase admin
client are reused. Every tag request verifies the case owner server-side and
looks up the bookmark under that case before accessing assignments. Actors are
derived from the validated session, never accepted from the request. The parent
bookmark list remains case-scoped and embeds tags in its paginated query.
No service-role credentials are imported by browser code. Existing RLS policies
and authentication behavior are unchanged.

## API

`/api/cases/[id]/bookmarks/[bookmarkId]/tags` supports:

- GET: `{ tags: [{ bookmark_id, tag_id, created_by, created_at }] }`, including an empty array.
- POST with JSON `{ "tagId": "exchange" }`: 201 and `{ tag: assignment }`.
- DELETE with the same JSON body: 200 and `{ removed: true }`.

Every response uses `Cache-Control: no-store`. Unauthenticated requests return
401; absent or inaccessible cases/bookmarks return non-disclosing 404s; malformed
bookmark UUIDs and invalid/extra tag fields return 400; mutation bodies over
1,024 characters return 413. Duplicate assignment returns 409; removing an absent
assignment returns 404. Database failures return safe 503 messages without raw
database details. Refresh after an unconfirmed mutation before retrying.

## Audit behavior

Database AFTER INSERT/DELETE triggers emit `EVIDENCE_TAG_ADDED` and
`EVIDENCE_TAG_REMOVED`. Metadata has exactly `bookmarkId` and `tagId`. The event
retains the case, actor UUID, timestamp and database origin through the existing
Case Activity table. Trigger failure rolls back the tag change. Duplicate inserts
and deletes matching no assignment emit no events. The generic activity POST API
rejects both types; reads and audit exports validate their metadata allowlists.

Actor attribution follows existing triggers: owner-checked API service-role
writes are attributed to the case owner. Privileged service-role maintenance
writes also appear as the owner; direct SQL without a JWT has a null audit actor.
This is not independent verification of human identity. Bookmark deletion
cascades assignments, preserves earlier tag events, and logs the existing
bookmark-removal event without synthetic per-tag removals. Case deletion removes
the bookmarks, tags and activity together. No historical events are backfilled.

## Workflow

Open Case Details → Saved Evidence. Assigned tags appear as readable chips.
Choose an unassigned tag and click **Add tag**; each chip has an explicitly
labelled remove button. Controls disable during mutations and a synchronous
guard prevents repeated submissions. Loading, no-tags, no-bookmarks, no-filter-
matches, success and error states are displayed. **Refresh saved evidence**
reloads authoritative state after errors or changes in another tab. The tag
filter runs over all loaded bookmark pages. Refresh Case Activity to inspect
the new events; automatic activity refresh was not added.

## Exact manual migration step and prerequisites

Nothing applies SQL automatically. In the intended Supabase project's SQL
Editor, after reviewing/testing in a development project, paste and run the
**complete `supabase-evidence-tags.sql` file, including BEGIN and COMMIT, once**.
The prerequisite installation order is:

1. `supabase-schema.sql`
2. `supabase-phase5-schema.sql`
3. `supabase-case-activity.sql`
4. `supabase-case-notes.sql`
5. `supabase-case-bookmarks.sql`
6. **`supabase-evidence-tags.sql` — the new migration**

Install only missing prerequisites; do not rerun already applied migrations.
Older activity/notes/bookmarks scripts restore earlier event constraints and
must not be run after this feature migration. This new migration is transactional
and intentionally not rerunnable after successful installation. It extends the
activity event constraint while retaining every existing event type. Existing
migration files have not been changed. Install it before using this application's
updated Saved Evidence list, which now selects the tag relationship.

## Verification and limitations

Automated commands:

```text
node --test tests/evidence-tags.test.cjs tests/case-bookmarks.test.cjs tests/case-activity.test.cjs tests/case-notes.test.cjs
node --test tests/*.test.cjs
npm.cmd run typecheck
npm.cmd run build
```

API tests use mocked persistence with the real case-ownership query. Migration
tests inspect SQL, constraints and trigger definitions; they do not execute
PostgreSQL. Render tests inspect static markup, not browser interactions.

Local verification on 2026-09-29: all 29 focused tests and all 124 full-suite
tests passed. `npm.cmd run typecheck` and `npm.cmd run build` both completed
successfully. No migration or live database verification was performed.

After manually installing the migration in a development database:

1. Create cases/bookmarks with accounts A and B. Check unauthenticated requests
   receive 401 and neither account can GET/POST/DELETE tags on the other's case,
   including a foreign bookmark ID under its own case URL.
2. As A, add each allowed tag, refresh, filter by tag, remove tags, and verify
   empty states and readable labels. Try malformed UUIDs, missing bookmarks,
   arbitrary tags and extra fields; verify the documented errors.
3. Send two simultaneous POSTs for one new assignment. Expect one 201, one 409,
   one row and one EVIDENCE_TAG_ADDED event. Remove twice: expect 200 then 404
   and one EVIDENCE_TAG_REMOVED event. Re-adding after removal is allowed.
4. Inspect Case Activity and its JSON export. Confirm metadata contains only
   bookmarkId/tagId and actor/timestamp/origin are correct. Attempt generic
   activity POSTs for both tag events and confirm rejection.
5. Using each account's authenticated Supabase client, verify owner-only SELECT
   and denied direct INSERT/UPDATE/DELETE. Check anonymous access is denied.
6. In an isolated development database transaction, temporarily force an audit
   insert failure; verify tag insert/delete rolls back, then roll back the test
   transaction. No such fault injection is performed by the application.
7. Delete a bookmark and verify all assignments disappear, earlier tag events
   remain, and no synthetic tag removals appear. Delete a disposable case and
   verify its assignments and activity are also removed.

Tags do not change scoring, provider retrieval, evidence packages, or transaction
payloads. There is no custom vocabulary, bulk tagging, offline queue, or automatic
cross-tab synchronization. Filtering loads all bookmark pages and is not designed
for very large cases; concurrent pagination is not a transactional snapshot.
Network response loss may leave a committed operation unconfirmed; refresh before
retrying. Privileged database administrators retain access. Live PostgreSQL/RLS,
rollback, and browser interaction checks require the manual steps above.
