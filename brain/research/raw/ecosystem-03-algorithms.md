# echo ECOSYSTEM-03 — rate-limit algorithms with explicit taste

> The four algorithms echo must know cold. Primary source: Upstash official docs (the most-used
> serverless implementation) + brandur.org (the canonical GCRA reference). Quoted verbatim where
> formulas are load-bearing. Retrieved 2026-06-16.

## The four algorithms, ranked by when echo should reach for each

### 1. Fixed Window — cheapest, leakiest
"Divides time into fixed durations/windows … the current time is used to determine the window
and a counter is increased. If the counter is larger than the set limit, the request is
rejected." (source: upstash.com/docs/redis/sdks/ratelimit-ts/algorithms, 2026-06)
- **PRO:** "Very cheap in terms of data size and computation." One Redis `INCR` + `EXPIRE`.
- **CON (the killer):** "Can cause high bursts at the window boundaries to leak through" — a
  client can fire `limit` requests at 00:00:59 and another `limit` at 00:01:00, i.e. **2× the
  limit in a 1-second span.** Also causes **request stampedes** ("whenever a new window begins").
- **echo taste:** default ONLY for coarse, non-abuse-sensitive quotas (e.g. "100 emails/day").
  Never for security-sensitive throttling.

### 2. Sliding Window (counter approximation) — Upstash's recommended default
Builds on fixed window but weights the previous window by elapsed fraction. **The exact formula
(verbatim from Upstash docs):**
```
limit = 10
// 4 requests from the old window, weighted + requests in current window
rate = 4 * ((60 - 15) / 60) + 5 = 8
return rate < limit   // True means we should allow the request
```
(source: upstash.com/docs/redis/sdks/ratelimit-ts/algorithms, 2026-06)
- **PRO:** "Solves the issue near boundary from fixed window." Bounded memory (two counters, not
  a log of timestamps).
- **CON:** "Is only an approximation, because it assumes a uniform request flow in the previous
  window, but this is fine in most cases." More storage/compute than fixed.
- **echo taste:** **THE sane default** for HTTP API throttling. It is the sliding-window-LOG's
  accuracy at the fixed-window's memory cost. The approximation error is bounded and only
  matters under adversarial non-uniform bursts.
- **GOTCHA echo must document:** the `reset` field for sliding window is **NOT an exact reset
  time** — "the reset time is the start time of the next window." (source: same page). Clients
  that show "try again in X seconds" from `reset` will be slightly wrong.

### 3. Token Bucket — best for smoothing + intentional burst
"A bucket filled with `{maxTokens}` tokens that refills constantly at `{refillRate}` per
`{interval}`. Every request removes one token; if none, the request is rejected." API:
`Ratelimit.tokenBucket(refillRate, interval, maxTokens)` e.g. `tokenBucket(5, "10 s", 10)`.
(source: upstash.com/docs/redis/sdks/ratelimit-ts/algorithms, 2026-06)
- **PRO:** "Bursts of requests are smoothed out … you can process them at a constant rate" and
  you can "set a higher initial burst limit by setting `maxTokens` higher than `refillRate`."
- **CON:** "Expensive in terms of computation."
- **echo taste:** reach for this when you WANT to allow a controlled burst (e.g. a user who
  hasn't called in an hour gets `maxTokens` immediately) but cap sustained rate. The classic
  "API credits" model.
- **LIMITATION:** Upstash token bucket is **NOT supported for `MultiRegionRatelimit`** (source:
  same page). echo must steer multi-region users to fixed/sliding window.

### 4. GCRA (Generic Cell Rate Algorithm) — the connoisseur's choice, NOT in @upstash/ratelimit
GCRA is a leaky-bucket variant that tracks state as a single timestamp, the **TAT (Theoretical
Arrival Time)**. "TAT is seeded on the first request by adding a duration representing cost to
current time. For subsequent requests, compare current time against `TAT - (τ + T)`. If current
time exceeds this threshold, allow and increment TAT by emission interval `T`; otherwise deny."
(source: brandur.org/rate-limiting, Brandur Leach — canonical GCRA explainer)
- Params: **`T` = emission interval** ("derived from the rate at which we want the bucket to
  refill"); **`τ` (tau) = burst capacity**. rate_period + max_burst in human terms.
- **Why practitioners prefer GCRA** (brandur, who built Stripe's limiter): leaky-bucket-with-drip
  "requires a background drip process that creates fundamental stability risks if it fails or
  lags"; fixed/time-bucketed "allows a buggy or rogue script to burn an account's entire rate
  limit immediately." **GCRA needs NO drip process** — it's a stateless time calculation storing
  exactly ONE value per key (the TAT). Most memory-efficient AND burst-correct.
- **Stated downside:** "Clock drift could throw off the algorithm and lead to false positives
  (users locked out)." Mitigation: use the **store's clock** (Redis `TIME`), never app-server
  clocks. (source: brandur.org/rate-limiting)
- **echo taste:** GCRA is the **most elegant** algorithm and the right pick for a custom Redis
  Lua limiter where memory-per-key matters at huge key cardinality. But it is **NOT in
  @upstash/ratelimit** — you reach for `redis-gcra` (Losant, Lua), `throttled` (Go), or
  hand-rolled Lua. **The honest call: for 95% of echo's serverless cases, Upstash sliding-window
  is the pragmatic default; GCRA is the expert escalation when you control the Redis Lua layer.**

## The decision rule (echo's opinion, distilled)
1. Multi-region needed? → **fixed window** (sliding window in multi-region = "large number of
   commands … long request processing times", per Upstash's own warning; token bucket
   unsupported).
2. Single-region HTTP throttle? → **sliding window** (the default).
3. Want intentional burst + constant drain (API credits)? → **token bucket**.
4. Own the Redis Lua + huge key cardinality + want minimal memory? → **GCRA** (one TAT per key).
5. At the Cloudflare edge? → the native **Workers `ratelimit` binding** (sliding-window, but
   **per-PoP not global** — see ecosystem-05) or a **Durable Object** for exact global counting.
