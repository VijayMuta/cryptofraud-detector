# CHAINTRACE evidence assistant

The `/ai` page uses authenticated `/api/ai` requests. No schema migration or chat-history database is required.

## Configuration

Set server environment variable `OPENAI_API_KEY` to enable AI selection. Optional `OPENAI_MODEL` defaults to `gpt-4.1-mini`; use a Responses API model supporting strict structured outputs. The example environment file documents names only. Never use a `NEXT_PUBLIC_` prefix. Missing credentials produce an explicit unconfigured state; deterministic evidence inspection still works.

Provider implementation: OpenAI Responses API, `store: false`, strict JSON schema, 30-second timeout, no tools or browsing. Reference: https://developers.openai.com/api/docs/guides/structured-outputs

## Evidence and response boundary

1. Authenticate the investigator with the existing Supabase request authentication.
2. Validate a wallet address or require ownership of a selected case before retrieving case wallets.
3. Reuse `fetchAlchemyWallet`, `analyzeWalletTransactions`, `summarizeIntelligence`, and `analyzeCaseConnection`. Monitor queries are scoped to the signed-in user's wallet record. Case descriptions, titles, victim text, credentials, user IDs and unrelated records are excluded from provider input.
4. Build server-owned evidence statements with stable IDs and provider-derived transaction references. Topic selection sends only the relevant compact evidence. Context is an explicit snapshot, not continuously updated history.
5. The AI returns only evidence IDs, an outcome and approved review-step IDs. Server validation rejects unknown IDs, extra prose, invalid outcomes and arbitrary steps. The UI renders server-authored fact text and transaction links, never generated factual prose. This deliberately limits explanation flexibility to prevent invented evidence. Relevance selection can still be imperfect and requires review.
6. Model instructions treat all questions/evidence as untrusted data. Models cannot fetch other cases, operate monitoring or access additional data. Case ownership is rechecked on every question. Errors are sanitized without logging raw provider responses.

## Operational limits

- One in-flight request per user per server process. Evidence snapshots are limited to 40 per process, one per user, and expire after ten minutes. Restarts, deployments or requests routed to another instance may require loading evidence again. This is not a distributed rate limiter or durable cache.
- Conversations are local React state; prior messages are not sent as facts or conversational memory. Each question uses the selected evidence snapshot.
- Wallet coverage is the existing recent external ETH sample; receipt-unverified transfers do not contribute to successful transfer analytics. Case coverage follows existing case-analysis limits.
- Case evidence summarizes relationships within one owned case, not a new two-case comparison. Up to 25 direct-transfer statements and eight relationships per category are included; full evidence remains in Cases.
- Alert contents are not included. Monitoring records alone never establish that an alert occurred.
- No automatic fraud, ownership, identity, exchange or intent determinations. No multi-hop tracing beyond observed data.
- No simulated AI fallback. Provider outages, throttling, refusals/unusable output and invalid evidence references have explicit states.

## Verification

Run `node --test tests/ai-assistant.test.cjs` and `npm run build`. Tests use isolated mock transports; they never inject fixtures into application evidence or databases. Live model quality evaluation requires a configured key and should include supported, insufficient and adversarial questions against real authorized evidence.
