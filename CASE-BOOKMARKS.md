# Case Evidence Bookmarks

Transaction Deep Dive shows **Save to case** after it retrieves a matching
Ethereum Mainnet transaction. Select one of your cases, optionally choose
Review, Key transfer or Follow up, and click **Bookmark evidence**. Existing
case context is preselected when it belongs to your account; standalone
transaction views also support case selection.

Case Details includes **Case Evidence / Saved Evidence**, newest first, with
transaction links, creator account UUIDs and UTC timestamps. Opening a link
retrieves current transaction evidence. **Remove bookmark** requires an explicit
confirmation and leaves its audit history intact. Refresh retries failed reads.

## Manual migration (never applied automatically)

In the intended Supabase project's SQL Editor, review and run the complete
`supabase-case-bookmarks.sql`, including BEGIN and COMMIT, after these existing
prerequisites have been installed in order:

1. `supabase-schema.sql`
2. `supabase-phase5-schema.sql`
3. `supabase-case-activity.sql`
4. `supabase-case-notes.sql`

Install only missing prerequisites. The bookmarks migration extends the activity
event constraint while retaining all existing event types. Do not rerun the
older notes migration after this migration: it restores the older constraint
and can fail if bookmark events already exist. The bookmarks migration itself
is transactional and rerunnable. Test in development before production use.

## Storage, security and audit

`case_evidence_bookmarks` stores id, case_id, created_by, transaction_hash,
network, optional label, and created_at. It contains no transaction payload or
free-form metadata. Labels use a fixed allowlist, so that field cannot receive
arbitrary sensitive text. Unknown request fields (including metadata, response,
credentials, creator, case and timestamp overrides) are rejected. Hashes are
validated and lowercased; Ethereum Mainnet is the only supported network.

`GET/POST/DELETE /api/cases/[id]/bookmarks` use the existing session validator
and verify case ownership on every request before accessing bookmarks. DELETE
requires a bookmarkId query parameter and filters by both case ID and bookmark
ID; a missing or different-case bookmark returns 404. GET reads 50-row pages
with a timestamp/id order. All responses are non-cacheable. Missing/inaccessible
cases share a non-disclosing 404; unauthenticated requests receive 401.

RLS permits only case-owner reads. Direct browser inserts, updates and deletes
remain denied. The existing service-role server pattern is reused; no privileged
credential is included in a browser module. Database validation also checks
the creator equals the case owner. Existing authentication and RLS are unchanged.

The database unique constraint on (case_id, network, transaction_hash) prevents
duplicates, including concurrent submissions and differently cased hashes.
Duplicate creation returns 409 without updating the existing label or recording
another event. UI controls also guard repeated clicks. A transaction may be
bookmarked separately in multiple cases owned by the investigator.

AFTER INSERT/DELETE triggers record EVIDENCE_BOOKMARK_CREATED and
EVIDENCE_BOOKMARK_REMOVED with exactly bookmarkId, transactionHash and network.
Labels and transaction payloads are never copied into activity. Both mutations
are atomic with their corresponding audit insert: an audit failure rolls back
the primary write. Deleting no row cannot create an event. The generic activity
POST endpoint rejects both event types. No historical events are synthesized.

Actor attribution follows existing activity triggers: service-role case writes
are attributed to the case owner because application routes enforce that access
model. Direct SQL without a user JWT has no actor. A privileged service-role
maintenance script can also be attributed to the owner; this is not independent
proof of human identity. Case deletion cascades bookmarks and activity together.

## Limits and validation

Bookmarks preserve references, not evidence snapshots or proof of fraud. The UI
requires successful transaction retrieval before offering save, but the bookmark
API validates identifiers and ownership without re-fetching transaction evidence.
An authorized owner can submit a syntactically valid hash directly to the API;
this does not assert the transaction exists or succeeded. Labels are predefined,
not free text. Bookmarks are not automatically included in Evidence Packages.

A lost HTTP response can make a successful mutation appear unconfirmed. Refresh
saved evidence before retrying; duplicate inserts return 409 and repeated deletes
return 404. There is no offline queue. Pagination is not a transactional snapshot
under concurrent writes. Privileged administrators retain database access.

Run focused tests with `node --test tests/case-bookmarks.test.cjs tests/case-activity.test.cjs tests/case-notes.test.cjs`,
the full suite with `node --test tests/*.test.cjs`, then `npm.cmd run typecheck`
and `npm.cmd run build`. Schema/policy/atomic-trigger tests inspect migration SQL;
API tests mock persistence and do not execute PostgreSQL.

Local validation passed: 23 focused bookmark/activity/notes tests, 118 full-suite
tests, and the standalone TypeScript check. No database migration was applied.

After manually installing the migration, verify with two accounts that a case's
non-owner cannot read/create/remove its bookmarks. Save a transaction, repeat
the save, refresh Case Details, follow its link, remove it, and repeat removal.
Confirm exactly one creation and one removal event, containing identifiers only.
Also check audit-insert failure rolls back mutations in a development database.
