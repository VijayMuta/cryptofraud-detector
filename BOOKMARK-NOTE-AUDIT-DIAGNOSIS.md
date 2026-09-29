# Bookmark note audit visibility: retest passed

## Outcome (2026-09-30)

The user confirmed a successful manual browser retest: two
`EVIDENCE_BOOKMARK_NOTE_CREATED` events are visible in Case Activity with
Category **All**, source **bookmark-notes**, and origin **database**.
The earlier visibility issue is no longer reproducible. Its original cause
was not established; no speculative production fix was made.

No corrective migration is required by the available evidence. The original
`supabase-evidence-bookmark-notes.sql` migration is already applied in the
tested project and must not be rerun or modified in place.

## Supporting checks

Read-only database inspection found the saved note's matching audit event,
with metadata containing exactly `bookmarkId` and `noteId`. No note text was
selected. The current activity GET handler returned the event successfully
against real data in an isolated diagnostic process: authentication was stubbed
only in that process, while ownership, retrieval and metadata validation used
the real implementation. This was not a browser authentication test.

The served local activity bundle included the event definition and label.
Automated rendering confirmed visibility under All and Evidence. The subsequent
successful browser retest was reported by the user, not observed through the
browser tool.

No database writes or SQL were run during diagnosis. Authentication, RLS,
atomic note/audit insertion and identifier-only audit metadata were preserved.

## Retained regression coverage

`tests/bookmark-note-activity.test.cjs` passes a persisted-event fixture with a
PostgreSQL microsecond timestamp through the actual GET handler and renders its
response with the actual activity page. It checks All/Evidence visibility and
safe rejection of invalid or sensitive metadata. Persistence and identity are
mocked, and page state is supplied directly; this does not test browser effects.

Verification on 2026-09-30: 37 focused tests and 132 full-suite tests passed;
TypeScript checking and the production build also passed. Commands and broader
feature verification guidance are in [Evidence Bookmark Notes](EVIDENCE-BOOKMARK-NOTES.md).

No further browser connection or corrective SQL step is pending for this report.
If visibility fails again, capture the activity API status/response and browser
console error before reloading, without sharing authorization headers or tokens.
