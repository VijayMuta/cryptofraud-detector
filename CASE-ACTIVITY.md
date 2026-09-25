# Case Activity / Audit Trail

Open **Case Details → Case Activity / Audit Trail** at `/cases/[id]/activity`.
The page shows newest-first application activity, UTC timestamps, account IDs
(or Unavailable), categories, component/source, provenance, references and safe
JSON metadata. Category filters operate on all loaded events. Refresh retries
failed reads; inaccessible and missing cases share a non-disclosing error.
Existing Investigation Timeline evidence and calculations are unchanged.

## Manual database setup

Review and run `supabase-case-activity.sql` in the intended Supabase project's
SQL Editor **after** `supabase-phase5-schema.sql`. Test in a development project
first. This follows the repository's standalone SQL migration convention. No
database changes are applied by the application or by this implementation.
The script is transactional and can be rerun; it creates no historical events.
After installing it, restart the local application and test with an owned case.
No deployment is required to review the local code; production rollout is a
separate user-controlled step.

The migration adds `case_activity_events`, a case/time/id index, owner-only
SELECT RLS, a case/operation UUID uniqueness constraint, and two trigger
functions on existing case and wallet tables. Case deletion cascades to its
activity. Authenticated and anonymous clients cannot insert, update or delete
activity directly. The existing service-role server architecture is retained;
the activity API checks the authenticated session and case ownership on every
read/write. No service credentials enter browser modules.

## Recorded actions

| Event | Recording point | Provenance |
| --- | --- | --- |
| CASE_CREATED | Database AFTER INSERT on investigation_cases | Database change |
| CASE_STATUS_CHANGED | Database AFTER UPDATE, only when status differs | Database change |
| WALLET_ADDED | Database AFTER INSERT on case_wallets, including initial case wallets | Database change |
| WALLET_REMOVED | Database AFTER DELETE on an existing case_wallets row | Database change |
| BLOCKCHAIN_EVIDENCE_REFRESHED | Successful deliberate Case Details analysis, Timeline evidence load/refresh, or Freeze/Hold evidence load/refresh; at least one wallet loaded | Browser-reported completion |
| TRANSACTION_VIEWED | Deep Dive has normalized Ethereum transaction evidence and an accessible case context | Browser-reported view |
| EVIDENCE_PACKAGE_GENERATED | Generate/regenerate builds and displays a Case Evidence Package snapshot | Browser-reported completion |
| EVIDENCE_INTEGRITY_VERIFIED | Explicit Verify Integrity produces MATCH for a case-associated package | Browser-reported comparison |
| EVIDENCE_INTEGRITY_MISMATCH | Explicit Verify Integrity produces a valid MISMATCH | Browser-reported comparison; changes may be legitimate |
| FREEZE_HOLD_PACKAGE_PREPARED | Validated transition to PREPARED FOR AUTHORIZED ESCALATION creates the prepared snapshot | Browser-reported internal preparation only |
| CASE_NOTE_CREATED | Database AFTER INSERT on case_notes (requires supabase-case-notes.sql) | Database change; note UUID only, no note text |

Automatic hashing, component rendering, routine case reads, failed retrievals,
invalid hash comparisons, and background analysis fetches are not events.
An explicit refresh can load only some requested wallets; its counts disclose
that partial coverage. Package generation retains existing unavailable-source
warnings and can legitimately generate a package with incomplete evidence.
Standalone transaction views without a case do not create case events.

## Recording, duplication and failure behavior

Case/wallet triggers execute in the same transaction as their primary write.
An activity insert failure rolls back that write and the existing route reports
the operation's failure. Initial case creation and initial wallet attachment
remain separate transactions, as before: a saved case still has CASE_CREATED
even if its subsequent wallet insertion fails. Unchanged status updates and
DELETE requests matching no wallet cannot produce events. No audit INSERTs run
from React case-render effects.

The reusable `recordCaseActivity` client service posts completed browser actions
to the authenticated case activity endpoint. Failures leave completed evidence
work intact and return a visible warning: recording could not be confirmed.
Do not repeat the primary action to repair a logging failure. A lost HTTP
response can mean a row was saved without confirmation; check the activity page.
There is no offline queue or automatic retry. Closing the tab before delivery
can lose browser-reported events.

Every delivery has an operation UUID. Retrying delivery with the same UUID is
deduplicated by the database; a conflicting event under that UUID returns 409.
Buttons disable while asynchronous work runs; successful actions log outside
React state updater callbacks. Evidence-load effects check their abort signal
before recording. Transaction views also retain a case/hash key in a
ref, preventing rerenders and Strict Mode effect replay from logging duplicates.
Retries within the same transaction view do not create another view event;
revisiting it after leaving the page is a new activity.

API actors come from `getRequestUser`, never from request metadata. Database
triggers use the case owner for service-role writes, consistent with the current
owner-only case routes. Direct SQL maintenance without an authenticated JWT has
no actor. A service-role maintenance script is indistinguishable from an app
write to these triggers and would attribute the case owner; this is not proof
that a particular human performed that write. Do not interpret the log as
independent identity verification.

## Data minimization and export

`case-activity.ts` defines the event types and fixed action labels/sources.
Metadata uses exact per-event scalar allowlists: validated wallet/hash strings,
status enums, numeric counts, ISO timestamps, known component/provider/package
enums and optional-by-event SHA-256 fingerprints. Unknown fields, nested data,
arbitrary notes, credential fields and provider responses are rejected. The
endpoint rejects arbitrary actor/timestamp/source fields and rejects browser
requests for database-only event types. Stored metadata is validated again on
reads and export; invalid records fail closed instead of rendering raw content.
Metadata is React text, never HTML. No email/name lookup or extra personal data
is collected; account UUIDs are displayed when available.

Download Audit Log JSON includes all loaded events (independent of the category
filter), the case UUID, generation timestamp, schema version and disclaimer.
Canonical serialization and a stable timestamp/id order produce identical bytes
for identical events and generation timestamps. Export times intentionally
change between downloads. No separate audit export fingerprint is implemented;
existing Evidence Integrity hashing behavior is unchanged. Reads page through
100-row batches; concurrent writes/deletes do not provide a transactional export
snapshot. Refresh before exporting a log under active investigation.

## Limits and validation

Browser-reported events are authenticated reports of local completion, not
server re-execution or independent verification of those actions. An authorized
owner can manually submit a supported browser event to the API. Privileged
database operators can edit/delete rows, and deleting a case deletes its log.
There is no claim of immutability, blockchain anchoring, legal certification,
external delivery, regulatory approval, proof of fraud, or asset intervention.
Application activity does not replace server/platform security logs.

Automated validation commands:

```text
node --test tests/*.test.cjs
node --test tests/case-activity.test.cjs
npm.cmd run typecheck
npm.cmd run build
```

Local validation: all 112 automated tests passed, including 11 focused activity
tests; the standalone TypeScript check passed. No existing tests were removed
or weakened. No live database migration or provider smoke script was run.

Migration tests statically check schema/policies; they do not execute PostgreSQL.
Manual checks after migration: use two accounts to confirm the second account
cannot read/write the first account's log; create a case with a wallet, update
status twice to the same value, remove the wallet twice, run the listed evidence
actions, refresh the browser, inspect metadata and export JSON. Confirm only
actual completed actions persist, matching failures show warnings, and an old
case remains empty until a tracked action occurs. Live provider scripts require
external services and are not part of the offline `.test.cjs` suite.
