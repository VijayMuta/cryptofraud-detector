# Case Notes / Investigator Notes

Case Details now includes a plain-text notes form and newest-first notes with
author account UUID and UTC timestamp. Notes accept 1–5,000 Unicode code points
after trimming surrounding whitespace. Internal line breaks are preserved.
Empty/non-text/oversized input and null characters are rejected. React escapes
markup; there is no HTML or Markdown interpretation. Read failures have a retry
button, and failed saves retain the draft. Concurrent double-submits are blocked.

## Manual migration

In the intended Supabase project's SQL Editor, after reviewing the SQL:

1. Ensure the existing `supabase-schema.sql` and `supabase-phase5-schema.sql`
   prerequisites have already been applied.
2. If not already installed, run the complete `supabase-case-activity.sql`.
3. Run the complete `supabase-case-notes.sql`, including BEGIN and COMMIT.

Do not substitute rerunning the original activity migration for step 3: the
notes migration extends its event-type constraint. The notes migration is
transactional and rerunnable. No migration is applied by the application.

## Storage, authorization and audit

`case_notes` stores id, case_id, author_user_id, note_text, created_at, updated_at.
The case foreign key requires an existing case and cascades on case deletion.
A case/timestamp/id index supports newest-first reads. Database defaults and a
trigger set timestamps; updated_at is maintained on privileged updates, although
this feature exposes no editing or deletion endpoint.

`GET/POST /api/cases/[id]/notes` use existing session validation, service-role
server access and explicit case-owner checks. The browser supplies only
noteText. Author comes from the verified session, case ID from the checked route,
and timestamps/ID from the database. A database trigger also verifies author
equals the case owner. Missing and inaccessible cases both return 404.

RLS permits authenticated owners to SELECT notes; anonymous users cannot read
them. No browser INSERT/UPDATE/DELETE policies or grants are added. Existing
case, authentication and activity RLS are unchanged. Service-role credentials
remain exclusively on the server. Privileged database operators retain access.

An AFTER INSERT trigger adds CASE_NOTE_CREATED with origin database and exactly
`{ "noteId": "<uuid>" }` metadata to Case Activity. No full text, excerpts or
content hashes enter the audit log. Both writes commit together; audit failure
rolls back the note. The generic activity POST route rejects this event type,
preventing browser-fabricated note events. Existing activity readers and exports
validate its metadata through the common event model. No historical backfill.

## Validation and limitations

Run `node --test tests/case-notes.test.cjs tests/case-activity.test.cjs`,
`node --test tests/*.test.cjs`, `npm.cmd run typecheck`, and `npm.cmd run build`.
Tests cover authorization, author spoofing, validation boundaries, case-scoped
ordering/pagination, failure responses, audit allowlists, migration structure,
and actual React HTML escaping. Schema tests are static; no live migration or
database test is performed automatically.

After migration, manually use two accounts to confirm only the case owner can
read/add notes. Add a multiline note and markup-like text, refresh, check UTC
ordering, and verify one note-ID-only activity record per saved note.

Notes are create/read only. Lists fetch 50-row pages; concurrent writes during
pagination are not a transactional snapshot. A lost save response may hide a
successful commit: refresh notes before resubmitting the retained draft. There
is no offline queue or cross-request idempotency. Notes are not automatically
included in existing evidence packages or exports. Authentication, environment
secrets, and existing blockchain calculations are unchanged.
