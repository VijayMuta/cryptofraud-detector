# Evidence Bookmark Notes: setup and testing

In Case Details → Saved Evidence, expand **Private bookmark notes** beneath a
bookmark. Notes load on first opening, newest first, with the author's account
UUID and explicit UTC creation time. Add a short observation with **Add bookmark
note**. Loading, empty, success and error states are shown. **Refresh bookmark
notes** retries reads and checks authoritative state after an uncertain save.
Closing and reopening the area preserves its draft while that bookmark remains
mounted. Existing Case Notes and Evidence Tags remain independent.

## Schema, privacy and authorization

`public.case_evidence_bookmark_notes` stores `id`, `case_id`, `bookmark_id`,
`author_user_id`, `note_text`, and `created_at`. UUID and timestamp defaults are
database generated; a validation trigger overwrites the creation timestamp.
Each row references the owning investigation case and an existing author in
`auth.users`. A composite foreign key `(bookmark_id, case_id)` references a new
unique constraint `(id, case_id)` on `case_evidence_bookmarks`, preventing a note
from claiming a different case than its bookmark. Both parent deletions cascade
notes. An index supports case/bookmark queries ordered by creation time and ID.

RLS permits only the authenticated case owner's SELECT. Anonymous access and
direct authenticated INSERT/UPDATE/DELETE are denied. The server role receives
SELECT/INSERT only; there is no note edit/delete API. Privileged database
administrators retain access. Privacy follows the existing case-owner model,
not encryption against database administrators.

Both API methods authenticate with `getRequestUser`, check ownership through
`getOwnedCase`, and look up the bookmark filtered by both case ID and bookmark
ID. All note queries are also scoped to both IDs. The author comes only from
the validated session. An insert trigger rechecks case/bookmark membership and
author ownership, locking the parents for the transaction. Browser code uses
`authenticatedFetch` and never imports the server admin client or credentials.

## Validation and API

`GET/POST /api/cases/[id]/bookmarks/[bookmarkId]/notes`:

- GET accepts a nonnegative integer `offset` and returns `{ notes, nextOffset }`
  in 50-row pages, ordered by `created_at DESC, id DESC`.
- POST accepts exactly `{ "noteText": "A private observation" }`, returning
  201 with `{ note }`. Author, IDs, timestamp, and metadata overrides are rejected.
- Notes are trimmed, must contain non-whitespace text, and are limited to 2,000
  Unicode code points. Null characters and non-string values are rejected.
  The database also checks length and non-whitespace content.
- JSON bodies over 26,000 JavaScript string units receive 413; this permits
  maximum-length JSON-escaped supplementary Unicode text. Invalid requests
  receive 400; unauthenticated requests receive 401. Missing/inaccessible cases
  and absent/wrong-case bookmarks receive non-disclosing 404s. Invalid bookmark
  UUIDs receive 400. Database failures receive safe 503s without raw details.
- Every response uses `Cache-Control: no-store`.

Notes render as React text with preserved line breaks; markup is displayed
literally and escaped. HTML, Markdown rendering, and rich-text execution are
not supported. Nothing copies note text to tags, provider payloads, or audit
metadata. Submission controls disable while saving and use a synchronous guard
against repeated clicks. Failed saves preserve the draft in the mounted area.

## Audit behavior

An AFTER INSERT trigger creates `EVIDENCE_BOOKMARK_NOTE_CREATED` in the same
database transaction. Its metadata contains exactly `bookmarkId` and `noteId`.
The event's actor is the server-validated author, as with Case Notes. An audit
failure rolls back the note insert; the API does not separately log events.
Activity reads/exports validate the identifier allowlist. The generic activity
POST endpoint rejects this database-only event, preventing client fabrication.

Deleting a bookmark deletes its notes, while its case's prior note-creation
events remain. No note-deletion events are synthesized. Deleting the case
cascades both notes and activity. No events are backfilled. Privileged
maintenance inserts can be attributed to a supplied owner, consistent with
Case Notes; actor attribution is not independent proof of human identity.

## Exact manual Supabase migration step

The migration is already applied in the project used for the successful manual
browser retest. Do not rerun it there. The instructions below are for projects
where the migration has not yet been installed.

No SQL is run automatically. In the intended Supabase project's SQL Editor,
review and run the **entire `supabase-evidence-bookmark-notes.sql` file, including
BEGIN and COMMIT, once**, after these prerequisites are installed in order:

1. `supabase-schema.sql`
2. `supabase-phase5-schema.sql`
3. `supabase-case-activity.sql`
4. `supabase-case-notes.sql`
5. `supabase-case-bookmarks.sql`
6. `supabase-evidence-tags.sql`
7. **`supabase-evidence-bookmark-notes.sql` — new**

Install only missing prerequisites. Do not rerun previously applied migrations:
older audit/notes/bookmarks/tags scripts restore narrower activity constraints.
The new script preserves all prior event types and is transactional, but is not
rerunnable after successful installation. Existing migration files are unchanged.
Test in a development project first. Until installed, bookmark-note requests
fail with migration guidance; existing bookmark and tag requests do not depend
on the new table.

## Automated checks

```text
node --test tests/bookmark-note-activity.test.cjs tests/evidence-bookmark-notes.test.cjs tests/evidence-tags.test.cjs tests/case-bookmarks.test.cjs tests/case-notes.test.cjs tests/case-activity.test.cjs
node --test tests/*.test.cjs
npm.cmd run typecheck
npm.cmd run build
```

Tests cover authentication, the real ownership query with mocked persistence,
case/bookmark isolation, author spoofing, validation, paginated create/list,
safe failures, escaped markup, safe audit exports, generic-event rejection,
and migration constraints/policies/triggers. SQL checks inspect the migration;
they do not execute PostgreSQL. Render tests inspect markup, not live browser
interaction. A separate read-only diagnostic verified that the live audit event
exists and passes the current retrieval/metadata validation path; it did not
execute a migration or test rollback behavior in PostgreSQL.

Local verification on 2026-09-30: all 37 focused tests and all 132 full-suite
tests passed. TypeScript typecheck and the production build both completed
successfully. Existing notes, bookmark, tag and audit regression tests passed.

The user subsequently confirmed that two `EVIDENCE_BOOKMARK_NOTE_CREATED` events
are visible in Case Activity with Category All, source bookmark-notes and origin
database. The earlier visibility issue is no longer reproducible; no corrective
migration or speculative production change was needed. See the
[audit diagnosis outcome](BOOKMARK-NOTE-AUDIT-DIAGNOSIS.md).

## Manual verification after installation

1. With accounts A and B, create separate cases/bookmarks. Confirm signed-out
   GET/POST returns 401 and B cannot read/create A's notes. Try a foreign bookmark
   under an owned case URL, a missing UUID, and a malformed UUID.
2. With A, open bookmark notes, observe the empty state, save a short multiline
   note, and refresh. Confirm text, author account UUID and UTC time. Verify
   different bookmarks and Case Notes do not share notes.
3. Reject blank/whitespace notes, more than 2,000 characters, null characters,
   and body fields attempting to override author, case, bookmark or timestamp.
   Submit markup such as `<b>literal</b>` and verify it appears as literal text.
4. Inspect Case Activity and its JSON export: exactly one creation event per
   saved note, with bookmarkId/noteId only. Try submitting this event through
   the generic activity API and verify rejection.
5. With authenticated Supabase clients, verify owner-only SELECT and denied
   direct INSERT/UPDATE/DELETE. In an isolated development transaction, attempt
   a mismatched bookmark/case and non-owner author using privileged access;
   confirm database rejection. Roll back the test transaction.
6. In an isolated development transaction, force audit insertion to fail and
   confirm the note insert rolls back. Roll back all fault-injection changes.
7. Simulate a failed read/save and verify errors, retry, draft preservation,
   disabled controls and rapid double-click protection. Refresh after uncertain
   saves. Confirm adding/removing/filtering Evidence Tags still works.
8. Remove a disposable bookmark: notes should cascade away while its prior
   activity remains. Remove a disposable case: notes and activity should cascade.

## Known limitations

No editing, deletion of individual notes, offline queue, full-text search, or
automatic cross-tab synchronization. Notes are not included in evidence
packages. Refresh Case Activity to see newly recorded events. Identical text
may intentionally be saved more than once; a lost response can leave a committed
save unconfirmed, so refresh before retrying. Pagination is not a transactional
snapshot under concurrent changes. Opening a notes area loads all its pages.
Filtering out a bookmark, refreshing all saved evidence, or navigating away
unmounts its notes area and discards an unsaved draft. Bookmark removal also
removes its persisted notes, as stated in the confirmation dialog.
