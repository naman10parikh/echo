---
title: "echo KNOWN-PITFALLS — Version-Specific Gotchas with Detection + Avoidance"
type: synthesis
created: "2026-06-16"
updated: "2026-06-16"
tags: [pitfalls, gotchas, version-specific, detection, avoidance, upstash, redis, cloudflare, nextjs, rate-limiting, caching]
synthesist: SYNTHESIS / taste-node (CP123 Wave-R)
sources: ["brain/research/raw/ecosystem-01,02,03,04,05,08.md", "brain/research/raw/field-01,02,03,04,07.md"]
summary: "The fast-lookup gotcha table. Each pitfall: WHAT bites · the VERSION/CONDITION it bites under · how to DETECT it (a grep/command/symptom) · how to AVOID it. Distinct from BATTLE-TESTED-SCENARIOS (narrative eval tasks) — this is the reference an agent scans mid-build before touching a limiter/cache surface."
related: ["[[echo BATTLE-TESTED-SCENARIOS]]", "[[echo OPINIONS]]", "[[echo EXPERTISE-MAP]]", "[[echo TOOL-MATRIX]]"]
---

# echo KNOWN-PITFALLS

> **How to use.** Before editing any echo rate-limit/cache code, scan the table for the surface you're touching
> (Upstash · Redis store · Cloudflare · Next.js · invalidation · idempotency · cost). Each row is **symptom →
> version/condition → detection → fix**. Version-pinned so a future agent knows when a pitfall expired. The
> **detection** column is the load-bearing part — it's what makes the pitfall *checkable*, not just *memorable*.
> 🔴 = correctness/security · 🟠 = silent-stale/cost/coverage · 🟡 = ergonomics/right-tool.

---

## A. State placement (the founding pitfalls)

### P-01 🔴 — `new Map()` / module-scope counter or cache on serverless is racy, not just empty
- **Bites:** any rate-limit counter or cache value stored in a `Map`/`Set`/`{}`/LRU at module scope in `app/api/**`
  (or any serverless handler) used as the *source of truth*. Also the lazy-init `if (!cachedClient) cachedClient =
  createClient()` when the ref holds state.
- **Condition:** Vercel **Fluid Compute default-on (2026)** — one warm instance serves dozens (peaks past 250) of
  concurrent requests that *share* the Map → cross-user data bleed + fail-open limiter. (Also still empty on cold
  start.) **NOT reproducible in `vercel dev`** (emulators don't reuse containers).
- **Detect:** `grep -rEn 'new (Map|Set)\(|=\s*\{\}|new LRU' app/api/ packages/*/src` then check if the result is a
  *source of truth* (a counter/cache value) vs a *lossy cache over an external store* (OK — see P-02). Symptom in
  prod: "user A sees user B's data"; a limit that holds locally but not when scaled >1 instance.
- **Avoid:** externalize to Upstash/Supabase/KV/Durable-Objects, or pass the ID from the client. A DB *connection
  pool* is safe at module scope (manages its own concurrency); a raw lazily-assigned client ref is not.
- (source: field-00 REF-1/REF-2, ecosystem-00:69-75 · scenario [[echo BATTLE-TESTED-SCENARIOS]] S-01)

### P-02 🟡 — The `ephemeralCache` Map is the ONE legitimate module-scope Map — don't delete it as "the Map bug"
- **Bites:** a reviewer/agent who sees `@upstash/ratelimit`'s `ephemeralCache: new Map()` and "fixes" it as a P-01
  violation, removing the cost/DoS optimization.
- **Condition:** `@upstash/ratelimit` all versions; the Map is auto-created (default on) unless `ephemeralCache:
  false`.
- **Detect:** is the Map passed *to* `@upstash/ratelimit` as `ephemeralCache` (legit — a lossy deny-list cache over
  Redis), or is it the counter itself (P-01)? The distinction: *if this Map is empty/stale, is the answer still
  safe?* ephemeralCache empty → falls through to Redis → safe. Counter empty → grants access → bug.
- **Avoid:** keep ephemeralCache; it must be **outside the handler** (module scope), which is correct here. The law
  is "Map is OK iff it's a lossy cache over an authoritative external store, never the store itself."
- (source: ecosystem-02 §1, field-03 §3 · opinion [[echo OPINIONS]] O-02)

### P-03 🔴 — `ephermeralCache` typo silently no-ops the cache (TS won't catch it)
- **Bites:** the in-memory deny-list cache silently does nothing → every request hits Redis (cost) and the DoS
  short-circuit is gone.
- **Condition:** older `@upstash/ratelimit` where the option was misspelled `ephermeralCache` (issue #14, FIXED).
  Generalizes to ANY misspelled optional config key — TypeScript does not error on an unknown optional property in
  an options object.
- **Detect:** `grep -rn 'ephermeralCache\|ephemeralCache' .` and check spelling against the installed version's
  types; verify the cache actually fires (a `reason: "cacheBlock"` on a re-blocked identity).
- **Avoid:** pin a current version; assert the option name against the SDK's exported types; test that an
  already-blocked identity is rejected with 0 Redis commands.
- (source: ecosystem-02 §1, ecosystem-08 #14)

---

## B. Rate-limit keying & decision (the security pitfalls)

### P-04 🔴 — Keying on a client-settable header = silent total bypass
- **Bites:** the limit is completely bypassable — an attacker rotates the header for a fresh bucket per request.
  THE most-filed rate-limit CVE genre of 2026.
- **Condition:** any limiter that derives the key from `X-Forwarded-For` / `X-Forwarded-Host` / `X-Real-IP` /
  `True-Client-IP` without trusted-proxy validation (Litestar < 2.18.0, Vikunja, Homebox, Coolify, LibreTranslate,
  + 15 more in a June-2026 sweep). Also express-rate-limit #234: a proxy appending `:port` to XFF → every request a
  unique "IP."
- **Detect:** `grep -rEn "x-forwarded-for|x-forwarded-host|x-real-ip|true-client-ip" src` near key/identifier
  construction; check whether the value is validated against a trusted-proxy config or read at a fixed chain
  position. Test: rotating those headers across requests creates new buckets.
- **Avoid:** default to socket IP / the value your own infra wrote (Vercel edge overwrites XFF — trust leftmost-
  untrusted); behind auth, key on **authenticated identity** (userId/apiKey). Ensure correct `trust proxy` /
  fixed-position XFF parsing.
- (source: field-02 §1 · scenario S-02)

### P-05 🔴 — Non-atomic decision (incr then separate read) loses to HTTP/2 multiplexing
- **Bites:** a burst of concurrent requests all pass the check before increments settle (TOCTOU) → the limit is
  bypassed under multiplexed/concurrent load even with a *correct, shared* counter.
- **Condition:** any limiter doing `await redis.incr(key)` then a *separate* read/compare, hit over HTTP/2 (or any
  high concurrency). The $8,347 story: 100 streams "in the same millisecond" all see "under limit."
- **Detect:** look for two round trips per check (an `incr`/`set` and a separate `get`/compare) instead of one
  atomic op. Load-test with 100 concurrent requests in one connection — does it admit all 100?
- **Avoid:** make increment+decision one atomic op — a Lua script (`INCR`+compare, or sliding-window/GCRA Lua), or
  an atomic token-bucket decrement (`@upstash/ratelimit` does this for you). And pair the *rate* limit with a
  *concurrency* cap (P-06).
- (source: field-02 §4 · scenario S-03)

### P-06 🟠 — Rate-only limit with no concurrency cap
- **Bites:** a per-minute limit "passes," but one connection multiplexes a concurrent burst that overwhelms the
  backend within the window.
- **Condition:** HTTP/2 / HTTP/3 multiplexing (default on modern stacks); any limiter that caps requests/time but
  not in-flight concurrency.
- **Detect:** is there a concurrency/semaphore cap alongside the rate limit? `grep` for `RateLimiterConcurrency` /
  `p-limit` / `bottleneck` / a max-in-flight guard. Symptom: per-minute counter reports exactly N/min while load is
  far higher.
- **Avoid:** add a concurrency cap (max simultaneous streams per connection/identity) in addition to the rate limit.
  Rate limiting (requests/time) ≠ concurrency limiting (in-flight) — @upstash/ratelimit does NOT do concurrency
  (issue #71).
- (source: field-02 §4, ecosystem-08 #71 · scenarios S-03, S-17)

### P-07 🔴 — IPv6 keyed per-/128 → free rotation within one allocation
- **Bites:** an attacker rotates within their own /64 (18 quintillion addresses) forever; the IP limit is useless.
- **Condition:** any IP-keyed limiter on IPv6 traffic keying the full /128 (CardSort #12).
- **Detect:** check IP-key normalization — is an IPv6 address truncated to a /64 (or /56) prefix before keying?
- **Avoid:** key IPv6 on the **/64 (or /56) prefix**, never /128. (IP limits are a speed bump regardless —
  residential proxies defeat even correct IP limits; move cost via auth-scoped limits / proof-of-work / spend caps.)
- (source: field-02 §3)

### P-08 🟠 — Limiter coverage gap (some routes skip the middleware)
- **Bites:** the limiter protects most routes but an attacker finds the uncovered one; "a limiter that protects 9/10
  routes protects 0."
- **Condition:** middleware-based limiting with hand-registered routes; a new route added without the middleware
  (commitpulse #1868). Same shape as the forgotten-write-path invalidation bug (P-14).
- **Detect:** enumerate every mutating/abuse-prone route and confirm each is covered; prefer a single edge/global
  enforcement point. `grep` route definitions vs middleware application.
- **Avoid:** enforce at the edge (one chokepoint) or audit every route; make coverage a test, not a convention.
- (source: field-02 §2)

### P-09 🟠 — Ban/deny list keyed on the same spoofable identity is also bypassable
- **Bites:** even a flood-ban can be evaded because it's keyed on the same spoofable IP/header as the limiter.
- **Condition:** a ban/deny list (LibreTranslate #986) keyed on the spoofable value from P-04.
- **Detect:** check what the ban list keys on — if it's the same client-settable value as the limiter, it inherits
  the bypass.
- **Avoid:** key bans on the same stable/authenticated identity used for the limit (fix P-04 first; the ban inherits
  the fix).
- (source: field-02 §1)

---

## C. `@upstash/ratelimit` & Upstash store

### P-10 🔴 — Forgetting `context.waitUntil(pending)` on the edge silently drops writes
- **Bites:** analytics undercount, and (worse) multi-region state isn't replicated — the limiter silently drifts.
  The #1 silent edge bug with this library.
- **Condition:** Cloudflare Workers / Vercel Edge with `analytics: true` or `MultiRegionRatelimit`; the dangling
  `pending` promise is abandoned when the response returns.
- **Detect:** in any edge handler using `.limit()`, is the returned `pending` passed to `context.waitUntil()`?
  Symptom: analytics numbers lower than actual traffic.
- **Avoid:** `const { pending } = await ratelimit.limit(id); context.waitUntil(pending);` on every edge call when
  analytics/multi-region is on.
- (source: ecosystem-02 §3 · scenario S-15)

### P-11 🔴 — `timeout` makes the limiter fail-OPEN — a footgun on security endpoints
- **Bites:** when Redis is slow/unreachable, requests pass *regardless of the limit* — fine for product APIs, a
  brute-force door on login/payment endpoints.
- **Condition:** `@upstash/ratelimit` with `timeout` set (default **5s** when constructed with a timeout) — `reason:
  "timeout"` on the pass. Combined with missing env vars (P-13) it can fail-open from the first request.
- **Detect:** is `timeout` set on a security-critical limiter? Is the fail behavior fail-open where it should be
  fail-closed? Check for `reason === "timeout"` handling.
- **Avoid:** for security-critical limits, set a very low timeout and **treat a thrown/timeout error as DENY**
  (fail-closed). Use the default 5s fail-open only for availability-first product APIs.
- (source: ecosystem-02 §2 · opinion [[echo OPINIONS]] O-04)

### P-12 🟡 — `@upstash/ratelimit` is HTTP-Redis ONLY — you cannot swap in ioredis/node-redis
- **Bites:** on a long-running Node server you can't use a pooled TCP client to cut the per-command HTTP latency;
  you're stuck with the HTTP hop (1–5ms/command).
- **Condition:** `@upstash/ratelimit` any version; issue #115 OPEN as of 2026-06 (13 comments).
- **Detect:** is this a long-running Node server (not edge) where TCP pooling would matter? Is @upstash/ratelimit
  forced when ioredis is available?
- **Avoid:** for TCP-Redis rate limiting on a persistent server, use **`rate-limiter-flexible`** (speaks
  ioredis/node-redis natively, also has concurrency limiting). Reserve @upstash/ratelimit for edge/serverless where
  HTTP is the *only* way to reach Redis.
- (source: ecosystem-02 §store, ecosystem-08 #115)

### P-13 🔴 — Missing `UPSTASH_REDIS_REST_URL`/`_TOKEN` throws at first call (and fail-open hides it)
- **Bites:** `Redis.fromEnv()` throws on the first `.limit()`; if the limiter also has `timeout` fail-open, it may
  **silently allow everything**.
- **Condition:** any deploy where the two env vars aren't set (new environment, preview deploy, forgotten secret).
- **Detect:** assert env presence at boot (`if (!process.env.UPSTASH_REDIS_REST_URL) throw`); don't rely on the
  limiter to surface a missing secret.
- **Avoid:** boot-time env assertion + template both vars in `.env.example`; treat a store-init failure as
  fail-closed on security endpoints.
- (source: ecosystem-10 §env · feeds TOOL-MATRIX secrets / Wave P)

### P-14 🟠 — Dynamic limits / token-bucket-on-multi-region constraints
- **Bites:** `dynamicLimits` or token bucket silently won't work where you expect.
- **Condition:** `@upstash/ratelimit` v2.0.8+: `dynamicLimits` works with **single-region** fixedWindow/
  slidingWindow/tokenBucket only — **NOT multi-region**. Token bucket is **unsupported** in `MultiRegionRatelimit`
  entirely; sliding-window multi-region is "large number of commands… long processing times."
- **Detect:** check the algorithm × region combination: token bucket + multi-region = invalid; dynamic + multi-
  region = invalid.
- **Avoid:** keep dynamic-limit and token-bucket limiters single-region; in multi-region use fixed window
  (preferred) and tolerate small overage. (source: ecosystem-02 §4/§5, ecosystem-03 §3)

---

## D. Cost (the per-command tax)

### P-15 🟠 — Assuming 1 request = 1 Redis command (the bill blows up)
- **Bites:** a sliding-window limiter at scale costs 100–5,000× a flat Redis instance; real $600+ bills, the
  archetypal Reddit surprise.
- **Condition:** per-command pricing (Upstash $0.20/100K; **Vercel KV 2×** at $0.40/100K) + a chatty algorithm.
  Counts: **fixed=2** (`EVAL,INCR`), **sliding=4** (`EVAL,GET,GET,INCR`), **token bucket=4** (`EVAL,HMGET,HSET,
  PEXPIRE`); +1 analytics, +2 deny-list, +1 dynamic; **×(1+readRegions)** on Global for the write side.
- **Detect:** compute commands/request for the chosen algorithm × adders × regions, then × expected req/s × 86,400.
  Compare to a fixed-instance flat fee.
- **Avoid:** count commands not requests; keep write-heavy limiters **Regional**; drop unused analytics; switch to a
  fixed instance past ~100M cmds/day; consider fixed window (half the commands) where a 2× boundary burst is
  acceptable. (source: field-03 §1/§4/§5 · scenario S-16)

### P-16 🟠 — Cloudflare Workers KV as a counter/limiter store
- **Bites:** the limiter silently fails open across regions and drops writes on busy keys.
- **Condition:** CF Workers KV any plan — **eventually consistent (up to 60s cross-region)** + **1 write/sec/key**
  (un-raisable) + write p50 ~172ms; writes cost **10× reads** ($5/M vs $0.50/M).
- **Detect:** is any per-request counter/limiter/session/leaderboard backed by KV? KV is read-mostly only.
- **Avoid:** edge counters → **Durable Object** (strong, exact) or Upstash; reserve KV for read-mostly config/
  blobs/flags. (source: field-07 §1, ecosystem-04 §CF-KV · scenario S-14)

---

## E. Cache invalidation (the hard half)

### P-17 🟠 — `DEL` returning 0 is treated as success (silent stale under prefix drift)
- **Bites:** a prefix mismatch (`user:` vs `users:`, `v1:` vs `v2:`) makes `DEL` delete nothing; it returns 0, which
  is not an error, so the stale key persists silently (5 microservices, tens of thousands of sessions).
- **Condition:** reader and invalidator build the key string by hand on separate sides; any refactor that changes a
  prefix on one side.
- **Detect:** is key construction centralized in one `cacheKey(entity, id)`? Is an expected-key `DEL → 0` logged?
- **Avoid:** centralize key construction; emit a warning/metric when an expected `DEL` returns 0 (a monotonic
  "invalidations that deleted nothing" counter catches drift early). (source: field-04 §2 · scenario S-06)

### P-18 🟠 — Dual-write race: a concurrent reader repopulates the just-deleted stale value
- **Bites:** cache holds the OLD value with a fresh TTL after a correct DB-first-then-DEL, because a reader read OLD
  before commit and wrote it back after the DEL.
- **Condition:** cache-aside under concurrency; the repopulate window between DB write and the reader's set.
- **Detect:** is there a delayed-double-delete or a read lock for strict-freshness data? Test the reader/writer
  interleaving.
- **Avoid:** delete (don't update); DB first then DEL; **delayed-double-delete** (DEL after a short delay) or a
  single-flight read lock. (source: field-04 §3 · scenario S-07)

### P-19 🟠 — Invalidation only on success (a failed write leaves stale data)
- **Bites:** a method mutates the store then throws → invalidation skipped → silent indefinite stale (the source
  names rate limits as a danger zone).
- **Condition:** framework cache annotations (`@CacheInvalidateAll` and similar) that run only on success; pre-3.32
  Quarkus also had the invalidate-before-logic ordering bug.
- **Detect:** does invalidation run in a `finally` (or before+after) for store-mutating methods?
- **Avoid:** invalidate in a `finally` (or before-AND-after) when the store was/may-have-been mutated, for
  staleness-dangerous data. (source: field-04 §4 · scenario S-08)

### P-20 🟠 — Forgotten write path (invalidation lives in the controller, not the data)
- **Bites:** a second write path (admin/webhook/script) forgets to invalidate → stale reads for data edited that
  way. The #1 invalidation bug.
- **Condition:** invalidation implemented per-endpoint; any new write path.
- **Detect:** does every write path go through one invalidating data-access layer / CDC? Or is there a per-controller
  invalidation call a new controller could omit?
- **Avoid:** centralize invalidation in the data layer or CDC — make it a property of the data, not the endpoint.
  (source: field-04 §1 · scenario S-05)

### P-21 🔴 — No TTL → zombie cache entries live forever when invalidation has a bug
- **Bites:** when any invalidation scheme fails (P-17..P-20), the stale value persists indefinitely with nothing to
  flush it.
- **Condition:** any cached key written without an expiry.
- **Detect:** `grep` cache writes for a TTL/expiry argument; flag any `SET`/`put` without one.
- **Avoid:** **always set a TTL** (the safety net behind every invalidation scheme) and **jitter it**. (source:
  field-04 §5 · opinion [[echo OPINIONS]] O-10)

---

## F. Stampede / herd

### P-22 🟠 — Synchronized TTL (a scheduled stampede)
- **Bites:** thousands of keys written together (deploy/import/warm) expire in the same second → simultaneous miss →
  origin stampede.
- **Condition:** identical TTL on a batch of keys; identical retry interval after an outage (re-stampede on
  recovery).
- **Detect:** `grep` for fixed `EXPIRE`/TTL constants on bulk writes and fixed retry intervals; symptom: periodic
  origin CPU spikes on TTL boundaries.
- **Avoid:** jitter TTLs (`ttl ± rand`) and use **full jitter** on retry backoff (`random(0, min(cap, base*2^n))`).
  One line, highest ROI in the vertical. (source: field-01 §4, field-05 §4 · scenario S-09)

### P-23 🔴 — In-process single-flight as the stampede defense on serverless
- **Bites:** the `Map<key, Promise>` dedup only works within one process — across 50 warm instances it's a
  50-request stampede, not single-flight (the drizzle #5841 fix as shipped).
- **Condition:** serverless/multi-instance; any in-memory in-flight tracking presented as stampede protection.
- **Detect:** is the single-flight in-memory or in the shared store? On serverless, in-memory dedup is a latency
  optimization, not a defense.
- **Avoid:** distributed single-flight — Redis `SET lock NX EX` with Lua-guarded (UUID) release, or SWR served from
  the shared cache. (source: field-01 §1 · scenario S-04)

### P-24 🟠 — Admission control / rate limit placed AFTER the expensive work
- **Bites:** the limiter protects nothing — the expensive fill/read pool is exhausted by requests that would have
  been rejected anyway (ElectricSQL #4266 lesson 1).
- **Condition:** any pipeline that does DB/work before the rate-limit or admission gate.
- **Detect:** trace request order — does the limit check run before or after the expensive call?
- **Avoid:** run admission control / rate limiting **first**, before any expensive work. (source: field-01 §2)

### P-25 🟡 — Reflexively caching a herd that's caused by an inefficient origin
- **Bites:** you take on cache-invalidation complexity to paper over a fixable slow query (a missing index).
- **Condition:** the hot origin query is slow due to inefficiency, not intrinsic cost (Depot, Nov-2025: a missing
  composite index folding `json_extract`).
- **Detect:** `EXPLAIN` the hot query before adding a cache — is it index-covered?
- **Avoid:** fix the index/query first; cache only intrinsically-expensive redundantly-recomputed work. (source:
  field-05 §2 · scenario S-11)

---

## G. Platform-specific (Next.js / Cloudflare)

### P-26 🟠 — `revalidateTag` is LAZY (marks stale, refetches on next visit) — not an immediate purge
- **Bites:** "I revalidated but users still see old data." The tag entry is marked stale and SWR-refetched on the
  *next* visit to a page using that tag; until then the previous response is served.
- **Condition:** Next.js App Router with `profile='max'` (recommended); v15/v16. Plus the **two-cache problem**:
  server Data Cache vs client Router Cache disagree on back-navigation.
- **Detect:** does the flow require *immediate* freshness after a mutation (e.g. a user's own just-edited profile)?
  `revalidateTag` alone won't deliver it.
- **Avoid:** for read-your-writes, combine with a router refresh / the newer **`updateTag()`** (eager), or route the
  writer's reads to origin, or accept the stale window. Design tag cardinality carefully (over-broad → invalidate-
  the-world stampede; too-granular → forget one). (source: ecosystem-05, vercel/next.js #56822/#91785 · scenario
  pattern in S-05/S-07)

### P-27 🟡 — Cloudflare cache-tag purge is Enterprise-only
- **Bites:** a Cloudflare-based tag-invalidation design doesn't work on lower plans (unlike Vercel's per-deployment
  tags).
- **Condition:** Cloudflare Cache cache-tags / purge-by-tag on non-Enterprise plans.
- **Detect:** is the invalidation design assuming CF cache-tags on a non-Enterprise plan?
- **Avoid:** flag the paywall; use TTL+SWR or a Durable Object for read-your-writes on lower CF plans. (source:
  ecosystem-05 §Cloudflare)

### P-28 🟠 — Cloudflare Workers `ratelimit` binding is per-PoP, not global
- **Bites:** a determined attacker spread across Cloudflare locations gets N×limit; the binding is "permissive,
  eventually consistent, intentionally NOT an accurate accounting system" (CF's own words). `period ∈ {10,60}s`
  only.
- **Condition:** CF Workers `[[unsafe.bindings]] ratelimit` (GA 2025-09-19) used for an exact/global cap.
- **Detect:** does the use case need exact global counting (billing/hard quota)? The binding can't provide it.
- **Avoid:** use a **Durable Object** for exact global counting; reserve the binding for cheap per-PoP throttling.
  (source: ecosystem-01, ecosystem-05 §CF-binding · scenario S-19)

---

## H. Idempotency

### P-29 🔴 — Idempotency that fails-OPEN or isn't atomic (double-charge risk)
- **Bites:** a duplicate mutating request (payment retry) executes twice — because the dedup is a per-instance Map
  (P-01), or non-atomic (two concurrent same-key requests both pass the check), or fails-open on store error.
- **Condition:** any mutating/payment endpoint with naive or missing idempotency.
- **Detect:** is the claim atomic (`SET idemp:{key} INPROGRESS NX EX 86400`)? Is there a request-fingerprint check
  (different body + same key → 400)? Does store-unavailable fail-CLOSED with a DB-unique backstop?
- **Avoid:** the Stripe pattern — required `Idempotency-Key`, atomic SET NX claim, fingerprint→400, 24h TTL, store
  the response, **fail-CLOSED**, DB unique-constraint backstop, never cache a GET under idempotency. (source:
  ecosystem-06 · scenario S-13)

---

## Cross-pitfall meta-patterns (the three roots)

Every pitfall above reduces to one of three roots — when you hit a new bug, classify it:
1. **Shared-mutable-state** — P-01, P-04, P-05, P-29 (a thing trusted/shared that shouldn't be: a Map, a header, a
   non-atomic counter, a per-instance dedup).
2. **Synchronization** — P-22, P-23 (stampede), retry storms — fixed by jitter + distributed coordination.
3. **Keys-as-broken-contracts** — P-04 (key trust), P-17/P-08/P-20 (key/coverage drift) — fixed by building keys in
   one place and making coverage a test. (source: field-08 §D)
