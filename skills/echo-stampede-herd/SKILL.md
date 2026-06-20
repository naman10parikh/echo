---
name: echo-stampede-herd
description: Tame both herds — the cache-expiry stampede and the retry storm. Use when the task is "thundering herd", "the origin melts when the cache expires", "retry storm", "everything retries at once after an outage", or "we got a stampede on cold start". Encodes distributed single-flight (NOT in-process), full-jitter backoff + retry budget + circuit breaker, admission-first, and fix-the-origin-before-caching.
---

# echo-stampede-herd — both herds share one root (synchronization) and one fix (jitter)

> **Brain anchors:** O-15, O-16, O-17, O-18 (OPINIONS) · P-22, P-23, P-24, P-25 (PITFALLS) ·
> S-04, S-09, S-10, S-11 (BATTLE-TESTED-SCENARIOS). Behind `echo stampede <key-cost>`.

## Trigger

- "thundering herd" / "the origin melts when the cache expires" / "we got a stampede on cold start".
- "retry storm" / "everything retries at once after an outage" / "the recovery re-killed the service".
- Adding a cache over an expensive fill (check FIRST whether the origin is just inefficient — O-18).

## The meta-insight echo leads with (O-16)

Both herds — the **expiry herd** (cache stampede) and the **recovery herd** (retry storm) — have the **same root
cause: synchronization**, and **the same fix: jitter.** *Full jitter* (`sleep = random(0, min(cap, base*2^n))`) beats
plain exponential backoff because backoff controls the *average* retry rate while jitter controls the *variance* —
and zero-variance (everyone retries at the same instant) is what *makes* the herd. The 2026 GitHub volume filing this
proves the whole industry keeps forgetting it. **Jitter is the one line that fixes both of echo's domains.**

## The 4 stances echo applies

1. **On serverless, DISTRIBUTED single-flight or SWR — in-process single-flight is a LIE (O-15 / P-23).** An in-memory
   `Map<key, Promise>` dedup only works within one process — across 50 warm instances it's a 50-request stampede, not
   single-flight (the drizzle #5841 fix as shipped is correct only on a stateful box). Use **Redis `SET lock NX EX`
   with a Lua-guarded UUID release**, or **SWR** served from the shared cache. *(Escape hatch: a genuinely stateful
   runtime — long-running container, Fastify/Hono on a box, a Durable Object — CAN use in-process single-flight.)*
2. **JITTER every TTL and every retry backoff (O-16 / P-22).** Fixed TTLs on a batch of keys (deploy/import/warm)
   expire in the same second → simultaneous miss → stampede. Fixed retry intervals after an outage re-stampede on
   recovery. Add `ttl ± rand` and full-jitter backoff. Pair with a **retry budget** (cap total retries) and a
   **circuit breaker** (stop hammering a down origin).
3. **Run admission control / rate limiting BEFORE the expensive work (O-17 / P-24).** A limiter placed *after* the DB
   call protects nothing — the read pool is exhausted by requests that would have been rejected anyway (ElectricSQL
   #4266: "pre-admission work saturates the pool before load-shedding can reject"). Ordering is free to get right.
4. **Don't reflexively CACHE a herd — first ask if the origin is just INEFFICIENT (O-18 / P-25).** Depot (Nov-2025)
   fixed a thundering herd with *query optimization, NOT caching* (a composite index folding `json_extract` into the
   scan). A cache over a fixable query *hides a bug* and *adds invalidation risk* — you take on one of the two hard
   things to paper over a missing index. `EXPLAIN` first; cache only what's still expensive after the query is fixed.

## Steps

1. **Classify the cause:** expiry herd (synchronized TTLs / cold cache) vs retry storm (synchronized backoff) vs a
   slow origin masquerading as a herd.
2. **If a slow origin (O-18):** `EXPLAIN` the hot query, add the missing index — STOP. Don't cache a bug.
3. **If a real herd:** `echo stampede <cheap|expensive>` →
   - **expensive fill** → **distributed single-flight** (SETNX + Lua UUID release) so the origin is queried **once**.
   - **cheap fill / read-mostly** → **SWR** (serve stale, refetch one in background).
4. **Jitter** every TTL and every retry backoff (full jitter); add a retry budget + circuit breaker.
5. Ensure admission/rate-limit runs **before** the expensive call (hand off to `echo-limiter-design`).
6. **Verify:** under N concurrent cold-cache requests the origin is queried **once**; after a simulated outage,
   retries are spread (not a spike); TTLs in a batch have distinct expiries.

## Output format

Emitted defense code (stdout) — a distributed-single-flight lock OR an SWR path — + a rationale block naming:
**cause · distributed-not-in-process · full-jitter (TTL + backoff) · retry-budget · circuit-breaker · admission-first**,
each tied to its stance (O-15..O-18). Never emits an in-process `Map<key, Promise>` as the serverless defense.
