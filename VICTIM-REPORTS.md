# CHAINTRACE Victim Reports

## Database setup required

Run **`supabase-victim-reports.sql`** manually in your Supabase SQL Editor before using report persistence. This change does not apply SQL automatically, modify production data, or edit `.env.local`. The new database feature must not be considered operational until this migration and live checks pass.

The previous intake page stored allegations directly as investigation cases. Those existing cases remain unchanged. There was no dedicated report table in the supplied schemas. The new table stores structured allegation fields and neutral review status, with a database-generated UUID and timestamps. Loss amounts use validated decimal text to preserve the submitted precision without floating-point changes. This is a reported amount, not a blockchain balance or verified loss.

## Access and privacy

- Existing server Supabase authentication establishes the user ID. Browser-supplied ownership, IDs, timestamps and submission status are ignored.
- RLS permits only owner reads. Anonymous access and authenticated direct writes are revoked. Mutations follow the existing Cases architecture: server service-role access, validation and explicit owner filters.
- Owners may change only the neutral workflow status through the API. There is no cross-user reviewer/admin access in this version. Status changes do not verify allegations.
- Lists, exact status counts and same-wallet counts are owner-scoped. No global duplicate count reveals another user's report.
- Text is untrusted and rendered through React text nodes, never HTML. Reports are not sent to AI. The case draft copies only a minimal labeled summary/reference, not free-text descriptions or notes.
- No attachments or personal contact fields. Reference information is optional. The form warns against submitting secrets and unnecessary personal information.
- Private fields, database errors and credentials are not logged. Missing storage returns an explicit setup error instead of a fake success or zero count.

## Workflow

- `/report`: submit an allegation and view a paginated private register.
- `/report/[id]`: inspect original claims, update neutral status, inspect a private same-wallet report count.
- **Investigate Wallet** opens the existing `/investigate?address=...` flow. The investigator runs its existing real blockchain analysis.
- **Prepare Investigation Case** retrieves the owned report and prefills the existing Cases form. The user must explicitly submit that form; the existing Cases API creates the case. Its description preserves the source report UUID. No new case-management API, automatic case creation, durable foreign-key association or merge is introduced.
- **Check reported transaction** calls the existing authenticated transaction API on demand. Provider-derived fields are shown separately; original claims remain unchanged. An existing transaction does not prove the allegation. Observations are not saved to the intake row.
- Dashboard report counts are loaded independently so missing migration cannot break existing case/alert metrics. Counts can be refreshed separately.

## Verification

Run `node --test tests/victim-reports.test.cjs` and `npm run build`. Unit tests use isolated database mocks and do not create fake reports in Supabase.

After applying the SQL, verify real persistence and RLS with two test accounts: submit with account A, confirm A can read/update it, confirm B receives 404 and cannot read it via Supabase directly, then exercise report-to-investigation and case preparation. Confirm direct authenticated database writes are denied. Mobile browser verification and live transaction verification should be performed in an authenticated session.

Limits: Ethereum Mainnet only; no attachments; no cross-user review queue; no status audit-history table; repeated submissions are separate allegations, not proof of independent corroboration. If a submission request is interrupted, check the private register before retrying to avoid an unintended duplicate.
