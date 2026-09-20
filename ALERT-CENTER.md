# CHAINTRACE Alert Center

No new table or migration is required. Uses existing `monitor_alerts`, `monitor_transactions`, `wallet_monitors` and their owner-based RLS from `supabase-schema.sql`.

## Data and rules

The existing monitor generates `fund_splitting` and `unusual_movement` alerts. This change does not generate alerts, alter thresholds, backfill data or add unsupported types. Lists and counts come only from stored database rows. Alert details use the saved analysis snapshot and matching monitored transaction; no live blockchain calls are made by the alert center.

The high/critical fields are investigation priorities. Current generators emit high priority. Fund splitting requires successful positive outgoing transfers to at least three destinations within 24 hours and a newly stored trigger. Unusual movement requires a newly stored outgoing successful transfer at least four times the average of other recent successful transactions, at least three baseline transactions and a positive average. Current rule descriptions are not a versioned historical rule audit.

Wei values are selected as text (`value_wei::text`) to preserve precision through JSON; malformed or unsafe numeric values are unavailable. See [PostgREST casting documentation](https://docs.postgrest.org/en/v14/references/api/tables_views.html#casting-columns).

## API and authorization

- `/api/alerts?page=1`: 20-row pagination; validated `q`, `wallet`, `severity`, `status`, `type`, `from` and `to` filters. Dates filter detection time in UTC, with inclusive final day. Search supports full/partial 0x-prefixed wallet or transaction hashes. Very broad searches matching more than 500 monitors require a narrower prefix.
- Default `/api/alerts` remains compatible with existing consumers (latest 100 rows). `overview=1` adds exact full-dataset counts, used by Dashboard. `summary=1` returns overview only.
- Summary cards cover all owned stored alerts, independent of list filters. Priority and needs-review exclude closed alerts. Recent means detected in the past 24 hours. Monitored wallets counts active monitors. Latest check and success times are the most recent across owned monitors, not coverage guarantees.
- `/api/alerts/[id]` checks the joined monitor owner before reading associated transaction evidence. Only allowlisted evidence fields leave the server; private user IDs, raw database errors and monitor error bodies are excluded.
- PATCH checks alert ownership and limits the mutation to the authorized ID and monitor ID. Only existing `new`, `reviewing`, `closed` statuses are accepted. Closed is not confirmation of fraud or resolution of the incident. No dismissed/reviewed columns are invented.
- Responses use `Cache-Control: no-store`. All operations use existing Supabase server authentication and user scoping. No `.env.local` edits or schema changes.

## Investigation workflow

Links prefill existing Wallet Investigation and Blockchain Intelligence; investigators explicitly run their existing analyses. Money Fingerprint and Fund Splitting links target existing sections. Those analyses may retrieve a newer or different sample than the historical alert.

Case selection loads only owned cases through existing APIs. The action adds the monitored wallet through the existing case-wallet endpoint and confirms success only after a returned wallet. A case that contains the wallet is labeled accordingly; this does not fabricate an alert-to-case association. Alert attachments and audit history are not implemented.

Monitoring is polling, not streaming. `vercel.json` requests checks every five minutes; deployment scheduling, provider limits and monitor backlog can delay execution. Refreshing the page refreshes database records only.

## Verification and limits

Run `node --test tests/alerts.test.cjs` and `npm run build`. Tests use isolated database fixtures, never production inserts. Cover populated/empty APIs, exact counts, filter/query construction, wallet/hash search, ownership, cross-user denial, status validation, malformed evidence, partial detail failures and database outages.

Authenticated browser checks with existing alerts and mobile layout still require a connected browser and live test session. No alerts are fabricated to populate an empty database. RLS policies are reused, not newly deployed or live-verified by mocked tests. No streaming connection or background browser polling is added.
