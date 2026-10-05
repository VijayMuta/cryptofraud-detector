# AUD-H04: complete persisted splitting context

Monitoring previously supplied only the cursor's latest 100 stored transactions
to the splitting detector. Incoming traffic could evict outgoing transfers still
within the existing 24-hour window, causing a missed alert despite complete ingestion.

Before persisting a provider page, monitoring now loads successful, positive,
non-self outgoing transactions for that monitor from the earliest eligible new
trigger minus the existing splitting window through the latest eligible trigger.
The existing service-role client reads `monitor_transactions`; numeric amounts and
block numbers are selected as text. Incoming rows cannot consume the context pages.

Reads request 100 rows, ordered by the unique per-monitor transaction hash, and
continue after the last returned hash. Exact remaining counts establish completion
and detect inconsistent pagination. A short page never implies exhaustion: lower
server row caps are supported. Missing counts, empty pages with remaining rows,
invalid evidence, nonadvancing hashes, database errors, and budget expiration fail
the current monitoring page before its persistence RPC. The existing check deadline
also bounds database requests and is checked again before persistence.

Persisted context is merged with observed outgoing evidence by hash. Stored hashes
cannot trigger new alerts. AUD-H03's new-trigger-first selection and deterministic
ranking remain unchanged. The cursor sample still supplies other analytics; their
thresholds and context are unchanged. The shared splitting-window constant is
exported without changing its value.

STAB-01/STAB-02 persistence is unchanged: evidence, alerts, and checkpoint commit
together. Context failure preserves earlier committed pages and the current page
remains retryable; diagnostic error/check time may update. Concurrent checks or
enrollment change the cursor revision, so stale work is rejected by the existing
atomic RPC. No permissions, RLS policies, database objects, or provider settings change.

## Release and limitations

No Supabase migration is required. Existing monitoring migrations remain prerequisites;
do not reapply them for this fix. Validate and release the application normally when
authorized. This work does not deploy or backfill alerts missed before the fix.

Completeness covers eligible **persisted** context plus the current provider page;
it does not add pre-enrollment history or resolve provider omissions/reorganizations.
Very large outgoing windows may exceed the existing check budget and remain visibly
incomplete until a check can finish. Exact counts and additional reads add database
work; context has no silent total-row truncation. General detector complexity and
the existing one-selected-splitting-window-per-provider-page behavior are unchanged.

Tests exercise the actual TypeScript detector and monitoring functions with the
transaction simulator and the real Supabase query builder with mocked HTTP responses.
They do not execute live PostgreSQL or production providers.
