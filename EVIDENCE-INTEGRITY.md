# Evidence integrity

Reports and Freeze/Hold calculate SHA-256 locally using Web Crypto. No evidence is sent to a hashing service. The UI supports copying/exporting the fingerprint and checking current evidence against a previously saved hash. Results are invalidated when the current payload or expected hash changes.

## Reproducing a JSON export hash

1. Read the export as JSON and save its separate `integrity` record.
2. Call `createEvidencePayload(integrity.packageType, exportedObject)`.
3. Call `verifyEvidence(payload, integrity.hash)`, or independently SHA-256 the UTF-8 bytes of `canonicalSerialize(payload)`.

The versioned payload is `{version: "chaintrace-evidence-v1", packageType, evidence}`. Only the export's **top-level** `generatedAt` and `integrity` fields are outside the hash. Object keys sort recursively using JavaScript string ordering; arrays preserve order. JSON strings, finite numbers, booleans and null use JSON encoding. Negative zero serializes as zero. Unsupported values (including undefined, BigInt, non-finite numbers, sparse arrays, accessors and cycles) fail explicitly rather than silently lose fields. This is a documented application format, not a claim of RFC 8785 compliance.

All remaining export fields are included: case facts, notes, request details, available transactions, attribution provenance, analytical findings, limitations, nested retrieval timestamps, audit entries, and analyst-recorded external responses. UI state and presentation are never passed into the evidence payload. The saved case report contains only its existing case/wallet evidence, not ungenerated blockchain findings. No evidence is fabricated to fill gaps.

Freeze/Hold adds its local export audit entry before hashing and prints/downloads/copies that exact captured package. A new audit entry or other substantive update legitimately changes its hash, including after preparation. The existing preparation/response workflow is unchanged. Integrity generation metadata is outside the payload and is not authenticated by its evidence hash. Records stay in the page session unless exported; this feature adds no database schema or persistence.

CSV/PDF include the fingerprint as a reference to canonical evidence in the corresponding JSON package; it does not fingerprint visual formatting or the CSV/PDF file bytes. Retain the JSON package and a separately trusted copy of its fingerprint. An attacker able to replace both the evidence and expected hash can create a new matching pair; this is not a signature or trusted timestamp.

SHA-256 integrity verification can detect whether the hashed evidence content has changed since the fingerprint was generated. It does not independently establish authenticity, ownership, legal admissibility, or proof of fraud. It does not prove collection identity, asset freezing, external delivery, or authority approval.

Validation: `node --test tests/*.test.cjs`, `npm.cmd run typecheck`, `npm.cmd run build`.
