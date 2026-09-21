# Authorized Freeze/Hold Intelligence

Route: `/freeze-hold`, inside the existing authenticated dashboard layout.

Uses existing authenticated case, wallet, alert, and case-analysis APIs, and existing Money Fingerprint/Fund Splitting analytics. No AI provider, new environment variables, schema migration, or new dependency is required.

## Authorized escalation

Internal status is separate from external response status. Internal actions are Draft, Ready for Review, Prepared for Authorized Escalation, and explicit analyst closure. A ready request may return to Draft. Preparation preserves its request ID and creates a detached evidence snapshot with a preparation timestamp; evidence and target/request fields then remain locked for this session.

Validation requires a case reference, reported wallet, network, target entity, reason, and investigator notes. Transactions, timestamps, behavioral findings, cross-wallet analysis, alerts, and verified attribution are optional. Missing optional evidence is disclosed and does not block preparation. An analyst can mark a missing optional category Not Applicable with an explanation; this cannot suppress existing evidence or bypass required fields. Existing readiness calculations are preserved.

Targets can be selected from exact-address VERIFIED custodial records, or entered manually. Manual targets remain ANALYST-ENTERED / UNVERIFIED; possible analyst assessments require a reference and never change endpoint attribution. Selection of a verified endpoint derives the entity identity and provenance from its record, not the manual form. Prepared snapshots preserve this source distinction.

External responses can only be recorded after preparation. A reference ID, responding entity, valid past response time, allowed response status, and analyst confirmation are required. Responses are labeled Analyst recorded, not independently verified by CHAINTRACE. They do not change the internal status or prepared evidence. Closure is a manual internal action, not evidence of external intervention.

## Export and scope

The human-readable screen/print report and JSON include the prepared evidence, validation results, target assessment, external response records, and audit trail. Copy, download initiation, and print requests are audited. Browser saving/cancellation and external delivery cannot be confirmed by CHAINTRACE. Print content is committed to the DOM before opening the print dialog.

Everything is session-local: export before changing cases, navigating away, or reloading. Browser timestamps and page-memory history are not a durable or tamper-proof database audit. No exchange API, email service, authority integration, or freeze action is implemented. External submission takes place outside CHAINTRACE through an authorized channel.

Data coverage remains the existing recent normal Ethereum transfer sample, not complete historical/token/internal transfers. Latest alerts are bounded by the existing API and truncation/loading warnings are preserved. Risk signals are not proof of fraud; wallet connections do not establish common ownership.

Validation: `node --test tests/authorized-escalation.test.cjs tests/freeze-hold-print.test.cjs tests/freeze-hold.test.cjs` and `npm.cmd run build` on Windows.


## Custodial attribution registry

`src/lib/custodial-attribution.ts` provides a reusable lookup and an intentionally EMPTY production registry (`TRUSTED_CUSTODIAL_RECORDS`). No real dataset, paid service, attribution API, new environment variable, or demo production data is configured.

Records carry ID, network, full address, entity name/type, status, source name, optional source reference/URL, verification date, and optional notes. Only reviewed public attribution records belong in this registry. Adding a VERIFIED record requires independent review of the source, exact network/address, entity identity, and verification date. The application validates record completeness, not the truth of an external source. Never populate the registry from analyst target forms, transaction behavior, or unreviewed user submissions.

Ethereum Mainnet aliases (`ethereum`, `Ethereum Mainnet`, `eip155:1`) resolve to chain ID 1. Valid lowercase, uppercase, and EIP-55 addresses match case-insensitively; invalid mixed-case checksums, partial addresses, and other networks do not match. VERIFIED requires a source name, identity, and valid non-future verification date. Conflicting verified identities fail closed. POSSIBLE / UNVERIFIED records stay clearly separate; they do not upgrade the endpoint from UNATTRIBUTED / UNKNOWN or become selectable verified targets.

The UI, JSON, and printable report retain source references, verification dates, network/address, notes, and selected-target provenance. Verified attribution contributes to the existing readiness category only when present. Attribution is not proof of fraud and grants no power to freeze or control assets. Verification dates describe the reviewed record; there is no live source revalidation or freshness guarantee.

Attribution tests: `node --test tests/custodial-attribution.test.cjs tests/authorized-escalation.test.cjs tests/freeze-hold-print.test.cjs tests/freeze-hold.test.cjs tests/blockchain-intelligence.test.cjs`. Synthetic records exist only in test files and are not imported by production code.
