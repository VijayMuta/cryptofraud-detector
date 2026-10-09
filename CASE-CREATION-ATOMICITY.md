# Atomic case creation (AUD-M02)

## Contract

`POST /api/cases` requires a UUID `Idempotency-Key` header in addition to the
existing authenticated session and validated case details. The server derives
the owner from `getRequestUser`; caller-supplied owner fields are ignored.

The server calls only `public.create_case_atomic`. It never falls back to
separate case/wallet inserts, including when the migration is absent. Fresh
creation returns HTTP 201; a replay returns HTTP 200 with the same case ID.
Both return the existing `case` object with `wallets`, plus `created`.

The RPC validates inputs, normalizes/deduplicates wallets, and enforces the
existing eight-wallet capacity. A unique `(user_id, idempotency_key)` ledger
entry arbitrates concurrent calls. PostgreSQL waits for a competing insert to
commit or roll back. The ledger, case, initial wallets, and any installed case
activity triggers commit together. Errors escape the function, rolling back
the transaction. There is no partial-write recovery path.

The ledger records normalized original inputs. Same key/different inputs is
HTTP 409, never an overwrite or a new case. Different keys may create cases
with identical details. Replays return current case details and membership;
they do not overwrite later investigator edits. A deleted case leaves a ledger
tombstone and replays return HTTP 410 rather than recreating it.

## Browser attempts

The Cases form (including victim-report-prefilled drafts) stores the random
attempt UUID in session storage, scoped to owner and a SHA-256 digest of
normalized inputs. It stores no case title, notes, wallet list, or credentials.
Retrying unchanged inputs in the same tab, including after a reload, reuses
the key. Only a confirmed successful response clears it. A later intentional
submission of identical details then gets a new key. Concurrent form submissions
are blocked, and recovered cases are deduplicated by ID in the displayed list.

If storage is unavailable, creation fails before the request is sent. Changing
inputs starts a different attempt. After an uncertain result, retry the original
details or inspect the case list before changing inputs. Closing/clearing the
tab's session storage or using another independent tab/device loses this local
association. API clients must retain their UUID until the outcome is resolved.
The server cannot recognize a retry submitted with a different key without
incorrectly deduplicating legitimate identical cases.

## Migration and release (manual; not run by the application)

1. Prerequisites: `supabase-schema.sql`, then `supabase-phase5-schema.sql`.
   Leave all previously applied migrations in place. Existing activity migrations
   are compatible; this migration neither creates nor replaces their triggers.
2. After approval, validate `supabase-case-creation.sql` in a disposable/staging
   database with the deployed schema. Verify two simultaneous calls with the same
   owner/key return one case, then inject a failing wallet trigger and verify no
   case, wallet, ledger or activity rows survive. Remove the test trigger in staging.
3. Verify `anon` and `authenticated` cannot execute the RPC or read/write its
   ledger, and `service_role` can execute it. Confirm preexisting case/wallet RLS
   policies remain unchanged. No browser service-role credential is needed.
4. Drain old case-creation requests. Apply the **new** `supabase-case-creation.sql`
   once, then release the matching API and client together. Old clients without
   an attempt key receive 400 and must reload. Do not run old sequential writers
   alongside the new path during the transition.
5. Verify create, same-key replay, distinct-key identical creation, and the
   case list/detail and victim-report draft flows in staging before production
   rollout. No production data repair is included in this change.

The migration uses `SECURITY INVOKER`, an empty search path, qualified application
tables, RLS with no client policies on the ledger, and RPC execution only for
`service_role`. The ledger grants that role only SELECT/INSERT/UPDATE. Existing
case and wallet permissions/RLS are unchanged. The owner must exist in
`auth.users` through the ledger foreign key; the trusted API validates the human
session before supplying that owner.

Keep ledger entries for the lifetime of retry protection. They retain original
normalized details even after case deletion; deleting an auth user cascades its
entries. No automatic expiry or cleanup is installed. Do not prune them or
remove the migration as a rollback while outstanding retry keys may exist.

## Validation boundary

`tests/case-creation.test.cjs` reproduces the original sequential-write bug,
exercises the API with an isolated transactional RPC model, checks browser retry
state, and statically checks SQL transaction/security structure. It does not run
the migration or replace the staging PostgreSQL checks above. No database,
provider or production calls are required for these tests.
