# echo ECOSYSTEM-06 — idempotency caches (the other half of echo)

> Why echo owns this: an idempotency key store IS a cache with exactly-once semantics — same
> distributed-state problem as rate limiting (atomic, shared, TTL'd, must survive cold start).
> The canonical reference is Stripe. Sources cited inline. Retrieved 2026-06-16.

## What idempotency keys are (and why retries make them mandatory)
A client sends a unique `Idempotency-Key` header (usually a UUID) with a mutating request. The
server stores `key → {response, request-fingerprint, status}`. If the same key arrives again,
the server returns the **stored response** instead of re-executing — so a network retry of
"charge $50" charges once, not twice. (source: stripe.com/blog/idempotency; zuplo.com/learning-
center/implementing-idempotency-keys-in-rest-apis, 2026)

## The Stripe pattern (the gold standard echo teaches)
1. **Required on mutating endpoints.** "Stripe's APIs require `Idempotency-Key` on payment
   requests … implemented on mutating endpoints by allowing clients to pass a unique value in
   the special `Idempotency-Key` header." (source: stripe.com/blog/idempotency)
2. **Request-fingerprint check (the critical correctness gate).** "If the key exists but
   parameters differ, Stripe returns **400 Bad Request** to prevent key reuse across different
   operations." Implementation: hash the request body and store it with the key; on replay,
   compare hashes — same → return cached response; different → 400 (the client is misusing one
   key for two operations). (source: stripe.com/blog/idempotency; codelit.io/blog/api-
   idempotency-patterns)
3. **24-hour expiry.** "Stripe expires idempotency keys after 24 hours, which balances
   deduplication coverage with storage costs." → TTL the key. (source: stripe.com/blog/idempotency)
4. **Atomic claim to beat the race.** "Leverage atomic operations … to prevent race conditions
   when storing idempotency keys." Two concurrent requests with the SAME key must not both
   execute. Pattern: atomic `SET key <in-progress> NX` (Redis) — first wins and proceeds,
   second sees the in-progress marker and either waits or returns 409. (source: codelit.io;
   medium.com/@akash22675/designing-idempotent-api-endpoints-for-payments)
5. **Recovery points / state machine.** Stripe's deeper design stores a *progress* state so a
   request that crashed mid-way (charged the card but didn't write the DB row) resumes at the
   right step on retry rather than re-charging. (source: stripe.com/blog/idempotency —
   "recovery points")

## Redis implementation specifics (the store echo reaches for)
- **Shared store mandatory in multi-server/serverless:** "the idempotency store should be shared
  (Redis or central DB) so requests hitting different servers see the same key." A per-instance
  Map is WRONG here for the same reason as rate limiting (cold start + Fluid Compute racing).
  (source: medium.com/@shbhggrwl/designing-idempotent-apis; zuplo.com)
- **Redis Cluster slot pinning:** "idempotency keys for the same API should hash to the same
  Redis slot, with a fallback to database constraints if Redis is unavailable." Use hash-tags
  `{...}` in the key so related keys co-locate. (source: zuplo.com)
- **DB unique-constraint fallback (fail-closed):** if Redis is down, a UNIQUE constraint on the
  key column in Postgres gives you idempotency at the DB layer — the durable backstop. echo's
  taste: **idempotency should fail-CLOSED** (unlike rate limiting which often fails-open) —
  better to reject a duplicate-uncertain request than double-charge. (source: zuplo.com;
  codelit.io)

## The Idempotency-Key HTTP RFC (standardization, 2026 status)
- There is an **IETF draft RFC** ("The Idempotency-Key HTTP Header Field") standardizing the
  header name and semantics across vendors — Stripe, others converging on it. echo should emit
  the standard header, not a bespoke one. (source: httptoolkit.com/blog/idempotency-keys/, which
  tracks the RFC; datatracker.ietf.org draft-ietf-httpapi-idempotency-key-header)

## echo's idempotency checklist (the deliverable shape)
1. Accept `Idempotency-Key` header on all non-GET mutating routes (reject if missing on
   payment-class endpoints).
2. Atomic claim: `SET idemp:{key} INPROGRESS NX EX 86400`. If it returns nil → key in flight or
   done → look up stored result; if INPROGRESS → 409/retry-after; if a stored response → return it.
3. Store request fingerprint (hash of method+path+body). On replay with **different** fingerprint
   → **400** (key reuse across operations).
4. On success, atomically overwrite `idemp:{key}` with the serialized response + status, keep the
   24h TTL.
5. Fail-CLOSED if the store is unavailable (or fall back to a DB unique constraint).
6. Never cache a GET under idempotency (GETs are already idempotent by HTTP semantics).

## How this differs from rate limiting (echo owns BOTH, but they invert one knob)
| Axis | Rate limiting | Idempotency |
|---|---|---|
| Store | distributed, atomic | distributed, atomic |
| TTL | window length (s–min) | 24h (per Stripe) |
| Key | identifier (ip/user/apikey) | client-supplied UUID |
| On store failure | usually **fail-OPEN** (avail > strict) | **fail-CLOSED** (correctness > avail) |
| Atomic primitive | INCR / Lua | SET NX / Lua |
Both are "remember something across requests in a shared store" — the exact class the turbo
boundary hands to echo.
