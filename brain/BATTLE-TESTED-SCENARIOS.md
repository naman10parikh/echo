---
title: "echo BATTLE-TESTED-SCENARIOS — Golden Eval Tasks from Real Production/Migration Failures"
type: synthesis
created: "2026-06-16"
updated: "2026-06-16"
tags: [scenarios, eval, golden-tasks, postmortems, production, migration, rate-limiting, caching, stampede, idempotency]
synthesist: SYNTHESIS / taste-node (CP123 Wave-R)
sources: ["brain/research/raw/field-01..07.md", "brain/research/raw/ecosystem-02,05,06,08.md"]
summary: "≥15 real, specific failure/migration/production scenarios with the resolution. Each is a candidate GOLDEN EVAL TASK for Wave S: a fresh agent given the SETUP should produce the RESOLUTION and pass the VERIFY check. Not hypotheticals — every one is grounded in a cited CVE, postmortem, issue thread, or dispute."
related: ["[[echo EXPERTISE-MAP]]", "[[echo OPINIONS]]", "[[echo KNOWN-PITFALLS]]"]
---

# echo BATTLE-TESTED-SCENARIOS

> **Purpose.** These are the situations echo exists to handle. Each scenario is written as a **golden eval task**:
> SETUP (the world state) → TRIGGER (what goes wrong / what's asked) → WRONG MOVE (the trap a naive agent falls
> into) → RESOLUTION (what an expert does) → VERIFY (the binary check that proves it). Wave S lifts these into
> `eval/` as L1 (assertion) / L2 (behavior) / L3 (trajectory) tasks. Every scenario cites the raw source it came
> from — these are receipts, not hypotheticals.
>
> **The fastest way to read echo's taste:** the WRONG MOVE rows. Each one is a real mistake someone shipped.

---

## S-01 🔴 The serverless in-process rate limiter (the Map-bug as a SECURITY bypass)

- **SETUP.** A Next.js app on Vercel rate-limits an auth endpoint with `const counts = new Map<string,number>()` at
  module scope, `counts.set(ip, (counts.get(ip)??0)+1)` in the handler. It "works" in `vercel dev` and in tests.
- **TRIGGER.** Shipped to prod. Either (a) brute-force attempts on `/login` sail past the "5/min" limit, or (b) a
  security review asks "does this limit actually hold across instances?"
- **WRONG MOVE.** Trust the local test. The Map is **per-process**: serverless spins up many instances, so the limit
  is per-instance not global (cold-empty → no-op), and under Fluid Compute one warm instance shares the Map across
  250+ concurrent requests (warm-racy → cross-user counter + read-modify-write race). The bug is **invisible in
  `vercel dev`** because emulators don't reuse containers.
- **RESOLUTION.** Move the counter to a shared atomic store: `@upstash/ratelimit` with `Ratelimit.slidingWindow`
  on Upstash Redis (HTTP), or a raw `INCR`+`EXPIRE`/Lua. The counter must be atomic AND shared. Key on the
  authenticated identity (or socket IP for the unauth edge), not a header.
- **VERIFY.** Concurrent load from N simulated instances against one key never exceeds the limit; `grep -r 'new Map'
  app/api/` returns no counter/cache used as a source of truth; the limit holds when the app is scaled to >1
  instance.
- (source: field-02 §2 [Traceon #12, AI-Support-Dashboard #1, gitverse-nextjs #1972], field-00 REF-1/REF-2)

---

## S-02 🔴 The X-Forwarded-For spoofing bypass (the 2026 CVE epidemic)

- **SETUP.** A framework's rate-limit middleware keys on the client IP via
  `cache_key_from_request()` → `request.headers['x-forwarded-for']`, trusting it unconditionally (no trusted-proxy
  config). Limit is "2 requests/minute." (This is verbatim Litestar GHSA-hm36-ffrh-c77c, CVSS 5.3.)
- **TRIGGER.** "Three requests with different header values (192.168.1.100, 101, 102) each return 200 OK, bypassing
  the 2-request-per-minute limit." An attacker rotates spoofed XFF values for a fresh bucket per request.
- **WRONG MOVE.** Tighten the *number* (lower the limit) or add more spoofable headers to the key. Both leave the
  bypass fully open — the key is attacker-controlled.
- **RESOLUTION.** "Default to socket IP only: don't trust proxy headers unless explicitly configured." Implement
  trusted-proxy configuration and read a *fixed position* in the XFF chain (the value your own infra wrote — on
  Vercel the edge overwrites/prepends XFF). Better: key on **authenticated identity** (userId/apiKey) behind auth;
  reserve IP limits for the genuinely-unauthenticated edge. Probe ALL the spoofable headers (`X-Forwarded-Host`,
  `X-Real-IP`, `True-Client-IP`) — Coolify's bypass was via `X-Forwarded-Host`.
- **VERIFY.** Rotating `X-Forwarded-For`/`-Host`/`X-Real-IP` across requests does NOT create new buckets (all rotated
  values hit the same limit when from the same socket); the key derivation reads only infra-written/authenticated
  values.
- (source: field-02 §1 [Litestar, Vikunja, Homebox, Coolify, LibreTranslate #986])

---

## S-03 🔴 HTTP/2 multiplexing beats a correct, Redis-backed, IP-keyed limiter ($8,347 in 6h)

- **SETUP.** A *correctly* IP-keyed, Redis-backed limiter: 100 req/min/IP, 15-min block,
  `await redis.incr(\`rate_limit:${clientIP}\`)` + expiry on the first request of each minute. No spoofing, no Map
  bug — this one looks right.
- **TRIGGER.** An attacker opens one HTTP/2 connection and multiplexes 100 concurrent streams every ~0.9s. "All 100
  arrive in the same millisecond" — the Redis counter increments 1–100, but every request makes its *decision* ("am
  I over?") before the increments settle, so all 100 see "under limit." Result: 4.2M requests/6h, auto-scaled 3→47
  EC2, RDS CPU 100% for 4h, **$8,347 bill** vs $140/day normal.
- **WRONG MOVE.** Conclude "we have rate limiting" and ship. The per-minute counter is real but the **decision is a
  TOCTOU race** (incr, then a separate compare), and there's no concurrency cap, and auto-scaling *amplified* the
  attack instead of shedding it.
- **RESOLUTION.** Three fixes: (1) make the decision **atomic** — one Lua `INCR`+compare, or an atomic token-bucket
  decrement, so "over the limit?" is decided in the same op as the increment. (2) Add a **concurrency cap** (max
  in-flight streams per connection/identity) — rate alone can't stop multiplexing. (3) Set a **backend spend cap**:
  cost alarms at a LOW threshold ($500, not $8,347) + hard ceilings on instances/DB connections so the system sheds
  rather than scales to the attack.
- **VERIFY.** A burst of 100 concurrent requests in one connection is rejected after the limit (not all admitted);
  the limiter uses one atomic op (no separate incr-then-read); a concurrency cap exists; a low cost alarm + max-
  instance ceiling are configured.
- (source: field-02 §4 [medium.com/codetodeploy, "$8,000 AWS Bill in 6 Hours"])

---

## S-04 🔴 The drizzle-orm `$withCache` cold-cache stampede (serverless single-flight is a lie)

- **SETUP.** An ORM cache feature (drizzle `$withCache`, issue #5841, June 2026) does check-then-act with no dedup:
  `if (fromCache === undefined) { result = await query(); await cache.put(...); }`. Deployed on Vercel.
- **TRIGGER.** Two+ concurrent SELECTs share the same cache key on a cold cache. PoC output:
  `DB calls fired: [ 'DB_CALL:concurrent-A', 'DB_CALL:concurrent-B' ] — STAMPEDE CONFIRMED.` Every concurrent caller
  misses, fires its own DB query.
- **WRONG MOVE.** Apply the upstream fix verbatim: `Map<cacheKey, Promise>` at module scope for in-flight dedup.
  That is **correct for a long-running server but the Map-bug on serverless** — a fresh instance's in-flight Map is
  empty (no dedup across instances), and with 50 warm instances you turn an N-request stampede into a 50-request
  one. In-process single-flight only deduplicates within one process.
- **RESOLUTION.** Use **distributed single-flight**: a Redis/Upstash `SET lock:{key} <uuid> NX EX <ttl>` so exactly
  one instance fetches the origin; others wait/poll or serve stale; release with a Lua script that DELs only if the
  UUID matches (atomic, owner-only). Or serve **stale-while-revalidate** from the shared cache so no caller blocks.
  Reserve the in-process Map version for genuinely stateful runtimes (long-running container, Durable Object).
- **VERIFY.** Under N concurrent cold-cache requests for one key across multiple instances, the origin is queried
  **once** (not once-per-instance); the lock release only deletes a lock the holder owns (UUID-guarded Lua).
- (source: field-01 §1 [drizzle-orm #5841 + PR #5862])

---

## S-05 🔴 The forgotten write path leaves stale data (the #1 invalidation bug)

- **SETUP.** The main app updates a user via `/update-profile` and correctly invalidates the cached user object.
  Three months later a teammate adds an admin dashboard with a separate `/admin/edit-user` endpoint.
- **TRIGGER.** Users edited through admin show **stale data** on read — the admin endpoint mutates the DB but never
  invalidates the cache. Two write paths, one invalidator.
- **WRONG MOVE.** Add the invalidation call to the admin controller too. It fixes *this* path but guarantees the
  *next* write path (a webhook, a migration script, a cron) will forget — invalidation-in-the-controller doesn't
  scale.
- **RESOLUTION.** Make invalidation a property of the **data, not the endpoint**: centralize it in a repository/
  data-access layer that invalidates on every write, or use DB-level change-data-capture (CDC) that fires
  invalidation regardless of which code path wrote. "Connect all write paths — regardless of which interface creates
  them — to the same invalidation mechanism."
- **VERIFY.** A write through ANY path (controller A, controller B, a raw repo call, a script) invalidates the cache;
  there is no per-endpoint invalidation call that a new endpoint could omit.
- (source: field-04 §1 [DesignGurus Bug #1, 2026-04-14])

---

## S-06 🟠 The namespace/prefix mismatch — `DEL` returns 0 and stale persists silently

- **SETUP.** Writer caches under `user:{id}`; a separate invalidation service deletes `users:{id}` (plural) — or
  `v1:user:{id}` vs `v2:user:{id}` after a refactor. Both build the key string by hand on their own side.
- **TRIGGER.** A production alert flags inconsistent user-profile reads tracing to stale cache entries across 5
  microservices and tens of thousands of sessions. The invalidation *appears* to succeed.
- **WRONG MOVE.** Trust that `DEL` succeeded because it returned without error. `DEL` returning **0** (deleted
  nothing) is NOT an error — it's identical to "the key wasn't cached." The stale key lives on under the other
  prefix.
- **RESOLUTION.** (1) **Centralize key construction** in one `cacheKey(entity, id)` function used by BOTH reader and
  invalidator — hand-built strings on each side are how prefixes drift. (2) **Treat `DEL → 0` as a logged signal**
  when you expected to delete a key; a monotonic "invalidations that deleted nothing" metric catches prefix drift
  before it's a 5-service incident.
- **VERIFY.** Reader and invalidator import the same `cacheKey()`; an expected-key `DEL` returning 0 emits a warning/
  metric; a deliberate prefix-mismatch test is caught by the metric.
- (source: field-04 §2 [WebSearch synthesis + OneUptime 2026-01-25])

---

## S-07 🟠 The dual-write race: a reader repopulates stale data after the DEL

- **SETUP.** Standard cache-aside with the correct ordering: `update_profile_in_db(id, new); r.delete(cache_key)`.
- **TRIGGER.** Under concurrency, a reader (1) misses the cache and reads the OLD value from the DB *before* the
  write commits, then (2) after the writer commits NEW and DELs the cache, the reader (3) writes the OLD value it
  read in step 1 back into the cache with a fresh TTL. Cache now serves stale until TTL or next write.
- **WRONG MOVE.** "Update the cache instead of deleting" to be more efficient — an update races *worse* (two writers
  interleave, the loser's value sticks). Or assume DB-first-then-DEL is sufficient (it isn't — the repopulate
  window remains).
- **RESOLUTION.** (1) **Delete, don't update** (forces fresh retrieval, avoids stale propagation). (2) **DB first,
  then DEL.** (3) Close the repopulate window with **delayed-double-delete** (DEL → DB write → DEL again after a
  short delay longer than a read's fetch+set window), which evicts any stale value a concurrent reader repopulated;
  or use a single-flight read lock so there's no repopulate window. (4) For data where staleness is dangerous (auth
  tokens, permissions, balances) use read-through with a per-key lock, or don't cache it.
- **VERIFY.** A concurrent reader/writer interleaving test ends with the cache holding the NEW value (or empty), not
  the OLD; the cache is deleted, not updated, on write; a second delayed delete (or read lock) is present for
  strict-freshness data.
- (source: field-04 §3 [OneUptime 2026-01-25])

---

## S-08 🟠 Success-only invalidation: a failed write leaves stale data nobody monitors

- **SETUP.** A method is annotated `@CacheInvalidateAll` (Quarkus, but the pattern is universal). The annotation
  fires **only after successful method completion**.
- **TRIGGER.** The method mutates the backing store, then throws during a *later* step (the DB row was written; a
  downstream call failed). Invalidation is skipped entirely. "The old cache entry persists, serving stale data on
  subsequent reads with no error indication." The source explicitly names **rate limits** as a place this is
  dangerous.
- **WRONG MOVE.** Assume the annotation is safe because "it invalidates on write." It invalidates only on the *happy
  path*; a partial failure that mutated state but skipped invalidation is the worst stale: silent, indefinite, in
  the place nobody is staring at.
- **RESOLUTION.** Invalidate on **both success and failure** when the store was (or might have been) mutated — call
  `invalidateAll()` in a **`finally` block**, or invalidate before-AND-after, for data where staleness is dangerous
  (tokens, permissions, rate limits). Also watch the framework ordering bug (invalidation running *before* business
  logic finished → §S-07 repopulate race).
- **VERIFY.** A test where the mutating method throws after the DB write still results in an invalidated cache;
  invalidation is in a `finally` (or before+after), not only the success path.
- (source: field-04 §4 [the-main-thread.com / Markus Eisele, 2026-04-26])

---

## S-09 🟠 The synchronized-TTL scheduled stampede (the one-line fix nobody applies)

- **SETUP.** A deploy/bulk-import/cache-warm writes thousands of keys, each with the **same** TTL (e.g. 3600s).
- **TRIGGER.** One hour later all those keys expire in the **same second** → simultaneous miss → every hot key
  stampedes the origin at once. (Mirror: a fixed retry interval after an outage re-stampedes the origin the instant
  it recovers.)
- **WRONG MOVE.** Add a distributed lock / single-flight to fight the stampede (heavier machinery) without fixing
  the root cause — the synchronization. Or not notice until the origin melts.
- **RESOLUTION.** **Jitter the TTL:** `ttl ± rand(jitter)` so keys expire spread across a window, not a spike. One
  line, the highest ROI/effort fix in the whole vertical. Apply the same to retry backoffs (**full jitter**:
  `random(0, min(cap, base*2^n))`). The 2026 GitHub volume filing this (cachex #8, togetherly #103, Nodus #46,
  mcp-runtime #304, aiokafka #1165) proves practitioners keep forgetting it.
- **VERIFY.** TTLs written in a batch have spread expiry times (not identical); retry backoff includes randomness;
  `grep` for fixed `EXPIRE`/`setTimeout` constants on hot paths finds none on bulk writes.
- (source: field-01 §4, field-05 §4)

---

## S-10 🔴 The retry storm at recovery (AWS US-East-1, Oct 2025 — "congestive collapse")

- **SETUP.** Many services depend on one backend (DynamoDB endpoint). All use exponential-backoff retries (the
  deployed "best practice"). A DNS race removes all IPs for the endpoint → it's unreachable.
- **TRIGGER.** Every SDK/service/app retries exponentially → "millions of retries flooded internal network
  systems… a feedback loop that affected even unrelated services." Then at **recovery**, EC2's lease subsystem tried
  to re-establish all leases across the fleet at once → "**congestive collapse** and was unable to make forward
  progress." ~15 hours, 4–6.5M+ error reports, 1,000+ companies.
- **WRONG MOVE.** Plain exponential backoff with no jitter, no retry budget, no circuit breaker. Every client
  retries at t=1s,2s,4s *together* (zero variance), and the whole backlog hits the dependency simultaneously the
  instant it recovers.
- **RESOLUTION.** (1) **Full jitter** on every backoff (controls variance, de-synchronizes the herd). (2) **Budget
  retries with a retry-token-bucket** — retries consume tokens; empty bucket → fail fast / shed load rather than
  amplify. (3) **Circuit-break a clearly-down dependency** (stop retrying entirely) and **reopen gradually**
  (half-open trickle) so recovery doesn't re-trigger the outage. Plan for the *recovery* moment, not just the
  failure moment.
- **VERIFY.** Backoff is jittered; a retry budget exists (caps total in-flight retries, not just per-request
  attempts); a circuit breaker opens on sustained failure and reopens half-open; a simulated dependency
  down→recover cycle does not produce a synchronized retry wave at recovery.
- (source: field-05 §1, §3, §4 [getpanto.ai AWS Oct-2025])

---

## S-11 🟡 Cache the herd vs FIX the origin (Depot, Nov 2025 — the contrarian case)

- **SETUP.** A service experiences a thundering herd: upstream issues → retries build demand → DB CPU jumps to 100%.
  One JSON-extraction query runs "tens of thousands of times per minute." (Depot, Staff-Eng postmortem.)
- **TRIGGER.** Someone proposes "add a cache / read replicas" to absorb the herd.
- **WRONG MOVE.** Reflexively cache the hot query. The query was slow because it was **unindexed**, not intrinsically
  expensive — a cache hides a fixable bug AND adds invalidation risk (field-04). "There are only two hard things…"
  — don't take on cache invalidation to paper over a missing index.
- **RESOLUTION.** First ask: *is the origin slow because it's inefficient, or because it's intrinsically expensive
  and redundantly recomputed?* Depot fixed it with **query optimization** — missing indexes, `EXPLAIN`-guided
  selection, batched `WHERE IN`, and a **composite index with the `json_extract` built in** so MySQL evaluated it
  as part of the index scan. Result: avoided the 100%-CPU state without a cache. Cache *intrinsically-expensive
  redundant* work; *fix* work that's slow because it's inefficient.
- **VERIFY.** Before adding a cache, an `EXPLAIN` on the hot query shows it's index-covered; a cache is added only
  for fills that remain expensive after the query is optimized.
- (source: field-05 §2 [depot.dev, 2025-11-21])

---

## S-12 🟠 Showing "requests remaining" burns a request (Upstash #17, 18 comments of confusion)

- **SETUP.** A product wants to render "X requests left" in a response header using `@upstash/ratelimit`.
- **TRIGGER.** The dev tries to GET the Redis key directly to read the count, but "the key appears to be appended
  with a variable number value that gets in the way of doing a standard redis GET" (the window-id suffix), and the
  natural `.limit()` API only exposes the count *as a side effect of consuming one*. So reading "remaining"
  decrements the quota.
- **WRONG MOVE.** Call `.limit()` just to read remaining (burns a request), or reverse-engineer the key name to GET
  it directly (brittle — the window suffix changes).
- **RESOLUTION.** Use **`getRemaining(identifier)`** — it reads the quota WITHOUT consuming. Don't reconstruct or GET
  the Redis key directly. Note the sliding-window `reset` is "start of next window," not an exact retry-after — don't
  display it literally (issue #59).
- **VERIFY.** Rendering remaining quota does not change the count; the code uses `getRemaining`, not `limit`, for
  display; retry-after is not taken literally from a sliding-window `reset`.
- (source: ecosystem-08 #17, #59)

---

## S-13 🔴 The double-charge: a payment retry without idempotency (the Stripe pattern)

- **SETUP.** A "charge $50" endpoint has no idempotency handling. A client's request times out at the network layer
  (the charge actually succeeded server-side) and the client retries.
- **TRIGGER.** The retry executes the charge again → the customer is charged **twice**. (Two concurrent requests
  with the same intent can also both execute.)
- **WRONG MOVE.** Add a naive "have I seen this key?" check that's (a) a per-instance Map (Map-bug, fails on
  serverless), (b) non-atomic (two concurrent same-key requests both pass the check), or (c) fails-OPEN on store
  error (executes the charge when uncertain).
- **RESOLUTION.** Implement the Stripe pattern: require an `Idempotency-Key` header (UUID) on mutating endpoints;
  **atomic claim** `SET idemp:{key} INPROGRESS NX EX 86400` (first wins, second sees in-progress → 409/returns
  stored result); **request-fingerprint check** (hash method+path+body; same → return cached response, **different
  → 400** for key reuse); store the serialized response on success with a 24h TTL; **fail-CLOSED** if the store is
  unavailable, with a **DB unique-constraint** as the durable backstop. Never cache a GET under idempotency.
- **VERIFY.** Replaying the same key returns the original response (no second charge); two concurrent same-key
  requests result in exactly one execution; same key + different body → 400; store-unavailable → reject (not
  double-execute); a DB unique constraint exists on the key.
- (source: ecosystem-06 [Stripe idempotency pattern], field-06 fail-closed framing)

---

## S-14 🔴 Migrating a limiter onto Cloudflare Workers KV (the silent fail-open)

- **SETUP.** A team running a Redis/Upstash rate limiter wants to "simplify" by moving the counter to Cloudflare
  Workers KV ("it's an edge KV store, looks like a drop-in").
- **TRIGGER.** After the migration the limit "works" in one region but lets traffic through elsewhere, and busy keys
  under-count. Root cause: KV is **eventually consistent (up to 60s cross-region)** and capped at **1 write/sec/key
  on every plan** (no way to raise it). KV write is 171.8ms p50 vs Upstash 6.2ms (~28× slower on the side a limiter
  hammers).
- **WRONG MOVE.** Use KV as a per-request counter/limiter store. "Any rate limiter keyed on something high-traffic
  like a user ID or IP" silently fails open — the 60s lag means other regions are stale, and the 1-write/sec cap
  drops writes on busy keys.
- **RESOLUTION.** For an edge counter/limiter on Cloudflare, use a **Durable Object** (single-threaded, strongly-
  consistent per-object → exact global counting) or keep it on **Upstash Redis**. Reserve **Workers KV for
  read-mostly edge config/blobs/feature-flags**, never counters. Remember a migration that changes the runtime
  target changes the *client* (HTTP↔TCP), and **cut over, don't trickle** a write-heavy store.
- **VERIFY.** No rate limiter or per-request counter is backed by CF Workers KV; edge counters use a Durable Object
  or Upstash; KV usage is limited to read-mostly data; a cross-region test shows the limit holds (not 60s-stale).
- (source: field-07 §1 [upstash.com vs Cloudflare KV, 2026-05-27])

---

## S-15 🟠 The wrong runtime build in Next.js middleware (`Can't resolve 'stream'`)

- **SETUP.** A dev adds `@upstash/ratelimit` to Next.js **Edge middleware** (`middleware.ts`), importing the SDK the
  way a Node example showed.
- **TRIGGER.** Build breaks: `Module not found: Can't resolve 'stream' … @upstash/redis/esm/platforms/nodejs.js` —
  the SDK auto-picked the **Node** platform build, which uses `stream`, unavailable in the Edge runtime.
- **WRONG MOVE.** Add a `stream` polyfill / webpack fallback to force the Node build into the edge runtime (fights
  the platform; ships a heavier, wrong build).
- **RESOLUTION.** Import the **edge-safe entry** for the runtime. On modern versions `Redis.fromEnv()` resolves the
  correct platform automatically; on older versions import the runtime-specific entry (`@upstash/redis/cloudflare`,
  etc.). Lift the runtime-correct setup from `upstash/ratelimit-js/examples/<your-runtime>` (nextjs-middleware,
  vercel-edge, cloudflare-workers) — the examples pre-solve this trap. Also wire `context.waitUntil(pending)` on
  edge if analytics/multi-region is on (else writes silently drop).
- **VERIFY.** The middleware builds for the Edge runtime with no Node-module resolution error; the import matches the
  runtime; `waitUntil(pending)` is present when analytics/multi-region is enabled.
- (source: ecosystem-08 #9, ecosystem-02 §3, ecosystem-07 §1)

---

## S-16 🟡 The Upstash bill surprise: a sliding-window limiter at $25k/month

- **SETUP.** A limiter uses `Ratelimit.slidingWindow` with `analytics: true` on a Global Upstash Redis with 3 read
  regions. Traffic grows to ~1,000 req/s sustained. The dev assumed "1 request = 1 command, $0.20/100K is cheap."
- **TRIGGER.** The monthly bill is in the tens of thousands. Sliding window is **4 commands** (`EVAL, GET, GET,
  INCR`), +1 analytics = 5, and Global multiplies the write side: `(1+3)*writeCmds + readCmds + 1` → 10+ cmds/req.
- **WRONG MOVE.** Blame Upstash / assume a billing bug. It's the pricing model meeting a high-command write-heavy
  workload — exactly what real-time limiters generate.
- **RESOLUTION.** (1) **Count commands, not requests**, before choosing per-command pricing. (2) Keep write-heavy
  limiters **Regional, never Global** (Global multiplies the expensive write side). (3) Drop analytics if unused.
  (4) For genuinely high sustained traffic switch the limiter to a **fixed instance** (Redis Cloud/ElastiCache/
  Valkey) — flat fee wins past ~100M cmds/day; keep Upstash for bursty/edge paths. (5) Consider **fixed window**
  (2 cmds) where a 2× boundary burst is acceptable — halves the bill. The algorithm choice is a *cost* decision.
- **VERIFY.** The design's commands/request is computed and documented; the limiter is Regional (not Global);
  analytics is on only if used; a break-even calc against a fixed instance exists for the expected volume.
- (source: field-03 §1, §4, §5 [Upstash costs doc, BuildMVPFast 2026-06-06])

---

## S-17 🟠 Conflating rate limiting with concurrency limiting (Upstash #71)

- **SETUP.** A team needs "max 10 simultaneous calls to an expensive downstream (an LLM provider)" and reaches for
  `@upstash/ratelimit` token bucket.
- **TRIGGER.** The token bucket caps requests *per time*, not *in-flight at once* — under bursty load 50 calls fire
  concurrently (each consuming a token over time) and the downstream's concurrency cap is blown / costs spike.
  @upstash/ratelimit does NOT do concurrency caps (issue #71, 12 comments).
- **WRONG MOVE.** Tune the token-bucket rate trying to approximate concurrency — it's the wrong dimension; you
  either throttle legitimate throughput or still allow concurrency bursts.
- **RESOLUTION.** Use a **semaphore / concurrency limiter** for "max N in-flight": `bottleneck`, `p-limit`, or
  `rate-limiter-flexible`'s `RateLimiterConcurrency`. Rate limiting (requests/time) and concurrency limiting
  (max in-flight) are different problems; you often need both (see S-03 — pair rate with concurrency).
- **VERIFY.** The number of simultaneous in-flight calls never exceeds N regardless of arrival rate; the tool used is
  a concurrency limiter/semaphore, not a time-based rate limiter.
- (source: ecosystem-08 #71)

---

## S-18 🟡 Stale LLM response after a model/RAG upgrade (no error signature)

- **SETUP.** The fleet caches LLM responses keyed on the prompt text only, to cut cost/latency. Cache hit-rate is
  great.
- **TRIGGER.** The team upgrades the model (`gpt-5.x → next`) or re-indexes the RAG corpus. Cached responses keep
  serving the OLD model's answers — and "you can't always tell when a cached response has gone stale; it still looks
  like a valid answer, it's just wrong." No error, no alert, indefinitely.
- **WRONG MOVE.** Cache on prompt alone and rely on TTL to eventually flush — TTL is too slow and a stale LLM answer
  has no "looks broken" signal to catch later. A DEL sweep across all old keys is risky and easy to get wrong
  (prefix mismatch, S-06).
- **RESOLUTION.** **Version-key** the cache: include the **model version, prompt-template version, and RAG-corpus
  version** in the cache key. After an upgrade the old entries simply never match again — no DEL sweep, no stale
  serving. Version-keying is the safest bulk-invalidation strategy and is mandatory for LLM caching.
- **VERIFY.** The cache key contains model + prompt-template + RAG-corpus versions; after a simulated model-version
  bump, no pre-bump response is served; no DEL sweep is required to invalidate post-upgrade.
- (source: field-04 §7 [BuildMVPFast LLM caching])

---

## S-19 🟠 Multi-region rate limiter overshoots a hard quota (CRDT small-margin)

- **SETUP.** A billing/hard-quota limit ("1,000 API calls/month, enforced exactly") is implemented with
  `MultiRegionRatelimit` for low global latency.
- **TRIGGER.** The quota is exceeded "by a small margin" — `MultiRegionRatelimit` checks the closest DB and returns
  immediately, replicating asynchronously via CRDTs, so "there is no way to guarantee the set ratelimit is not
  exceeded by a small margin." Also: token bucket is unsupported in multi-region, and sliding-window multi-region
  = "large number of commands… long request processing times."
- **WRONG MOVE.** Use multi-region for an *exact* cap because it's lower latency. Multi-region trades **exactness for
  latency** — wrong when the limit is a correctness boundary (billing, hard quota).
- **RESOLUTION.** For an EXACT global cap, use **single-region** (everyone pays the RTT to one DB) or a **Cloudflare
  Durable Object** (single logical instance = exact). Reserve multi-region for limits where a small overage is
  acceptable, and there use **fixed window** (token bucket unsupported, sliding-window too chatty). Decide by the
  *cost of being wrong*: a small quota overage is a refund; an outage from failing-closed under partition is worse.
- **VERIFY.** Hard-quota/billing limits are single-region or DO-backed (not multi-region CRDT); multi-region limits
  use fixed window and tolerate small overage; the consistency model matches what the limit protects.
- (source: ecosystem-02 §4, ecosystem-03 §3, field-06 §3C)

---

## How Wave S should use these

- **L1 (assertion):** turn each VERIFY into a unit assertion (e.g. S-06: reader and invalidator import the same
  `cacheKey()`; S-12: `getRemaining` doesn't change the count).
- **L2 (behavior):** run the SETUP, inject the TRIGGER, assert the RESOLUTION's observable behavior (e.g. S-04:
  origin queried once under concurrent cold-cache load; S-03: 100-stream burst rejected after the limit).
- **L3 (trajectory):** give a fresh agent only the SETUP + TRIGGER and grade whether it *reaches* the RESOLUTION
  without falling into the WRONG MOVE (e.g. S-14: does it refuse to put a limiter on CF KV and reach for a DO?).
- **Severity legend:** 🔴 = correctness/security bug (must pass) · 🟠 = silent-stale/cost/coverage (high priority)
  · 🟡 = design-fit/right-tool (taste). Counts: 9×🔴, 8×🟠, 2×🟡 across S-01..S-19.
