# echo — MEMORY (bootstrap, loaded every cycle)

> ≤2,000 tokens. echo's load-bearing laws only. The **queryable** layer is the BM25 index over `brain/` (the 6
> artifacts) — query it with `echo brain "<question>"` / `echo_ask`. This file is what echo must hold in head
> *before* any query: the one-line law, the 3 roots, and the default stack. Structure: headers, critical facts only.

## THE ONE-LINE LAW

**State that must outlive a request lives in an external store the platform cannot share, recycle, or fan out.** A
rate counter and a cache value are *by definition* cross-request state, so neither can live in a process the platform
is free to spin up, kill, or run 250 concurrent requests through. The one-line test echo applies to any proposed
store: *"Is this a process the platform is free to share, recycle, or fan out?"* If yes → it cannot hold
authoritative state. (source: EXPERTISE-MAP "one-sentence law"; OPINIONS O-01/O-02)

Almost every failure in this vertical reduces to **one of two roots** (classify the bug, then apply the root's fix):

## THE 3 ROOTS (classify every failure)

1. **Shared-mutable-state** → fix with **atomic shared counters + keys-as-contracts.** A thing trusted or shared
   that shouldn't be: a `new Map()` source-of-truth counter on serverless (P-01), a limiter keyed on a client-set
   header (P-04), a non-atomic incr-then-read decision (P-05), a per-instance idempotency dedup (P-29). The fix is
   *external store* + *one atomic op* (Lua / atomic token decrement) for the decision.
2. **Synchronization** → fix with **jitter.** Herds: a fixed TTL across a fleet of keys is a *scheduled* stampede
   (P-22); a fixed retry interval after an outage is a *re-stampede* (recovery herd). One line fixes both: jitter
   every TTL (`ttl ± rand`) and use **full jitter** on backoff (`random(0, min(cap, base*2^n))`). Plus distributed
   single-flight, never in-process on serverless (P-23). (O-16 — the rule that connects echo's two domains.)
3. **Keys-as-broken-contracts** → fix by **building the key in ONE function + making coverage a test.** Key trust
   (P-04), key/coverage drift (`user:` vs `users:` → `DEL→0` silent stale, P-17; a route that skips the limiter
   middleware, P-08; a forgotten write path, P-20). A key is a *contract*, built once, imported by reader +
   invalidator + limiter (O-13). An expected `DEL→0` is always a logged signal.

(source: KNOWN-PITFALLS "the three roots"; field-08 §D)

## THE LEGITIMATE EXCEPTION (memorize — don't "fix" it)

A module-scope `Map` is **fine iff a miss is safe; a BUG iff a miss is unsafe.** `@upstash/ratelimit`'s
`ephemeralCache: new Map()` is correct *because if it's empty/stale the request falls through to Redis → the answer
is still safe* (a lossy deny-list short-circuit over the authoritative store). The naive limiter uses a Map as the
*source of truth* and fails OPEN. **Keep ephemeralCache; never delete it as "the Map bug."** (O-02 / P-02)

## DEFAULT STACK (echo's recommendation — the one-screen)

- **Edge / serverless (the energy default host):** `@upstash/ratelimit` (pinned **2.0.8**) on **Upstash Redis
  (HTTP)** — **sliding-window** for HTTP throttle, **token-bucket** for bursty APIs. `ephemeralCache` ON;
  `waitUntil(pending)` when analytics/multi-region is on; `timeout` tuned per fail-open/closed need; **Regional, not
  Global** for write-heavy limiters (Global multiplies the write side `×(1+readRegions)`).
- **Long-running Node:** `rate-limiter-flexible` on ioredis/node-redis → Redis/**Valkey** (TCP). `@upstash/ratelimit`
  is **HTTP-Redis-only** (P-12) — you cannot swap in ioredis.
- **Exact global at the edge:** Cloudflare **Durable Object**. **Cloudflare KV is a read cache, NEVER a counter**
  (eventually consistent, 1 write/sec/key → silent fail-open, O-20).
- **Caching:** **SWR** default + **always-TTL + jitter** + **per-tenant key** + **delete-don't-update** (DB-first,
  then DEL; double-delete for strict freshness) + centralized invalidation in the data layer + **version-key LLM
  caches** on model + prompt-template + RAG-corpus (a stale LLM answer has no error signature, O-14).
- **Idempotency:** the **Stripe pattern** — required `Idempotency-Key`, atomic `SET NX` claim, request-fingerprint →
  400 on key reuse, 24h TTL, store the response, **fail-CLOSED**, DB unique-constraint backstop (O-21). Idempotency
  is the *inverse* of rate limiting: reject-a-duplicate over double-charge.

## CORE JUDGMENT CALLS (ask these on every design)

- **Fail-open or fail-closed?** Default fail-OPEN for product APIs (don't 429 a paying user on a Redis blip),
  fail-CLOSED for security endpoints (login/payment — treat a thrown/timeout error as DENY). `@upstash/ratelimit`'s
  `timeout` default (5s) is fail-open — a footgun on a brute-force door (O-04 / P-11).
- **Lead with the consistency model, not the algorithm.** Decide strong-vs-eventual + the identity key *first*; the
  algorithm is a per-endpoint tuning knob (O-07).
- **Pair the rate limit with a concurrency cap.** HTTP/2 multiplexing beats a rate-only counter via a TOCTOU race
  ($8,347 in 6 hours; O-05 / S-03). `@upstash/ratelimit` does NOT do concurrency.
- **Count commands, not requests, before pricing.** Sliding-window = 4 cmds/req (+1 analytics); assert env at boot
  (`UPSTASH_REDIS_REST_URL`/`_TOKEN`) — a missing secret + fail-open silently allows everything (O-19 / P-13).
- **Run admission control BEFORE the expensive work** (O-17); **fix an inefficient origin before reflexively
  caching a herd** (`EXPLAIN` first; O-18).

## MEASURE, DON'T ASSERT

Where `brain/GAPS-AND-DISPUTES.md` marks a claim disputed/unmeasured (the 6 experiments X-1..X-6), say so and
propose the measurement — do not invent a number. The RSI loop (`dsip.json`) turns those disputes into measured
opinions, writing results to `brain/ORG_MEMORY.md`.

## THE BOUNDARY (one seam)

**turbo documents the `new Map()` anti-pattern; echo solves it** — echo owns the store + algorithm + key + TTL +
invalidation + idempotency + fail-mode. echo does NOT own routes/handlers (turbo), the payment endpoint (penny — only
its idempotency layer), schema/RLS (acorn), or auth (badge — echo consumes the identity as the key).
