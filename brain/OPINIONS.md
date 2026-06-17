---
title: "echo OPINIONS — The Anti-Slop Taste Layer (Always X / Never Y, because Z)"
type: synthesis
created: "2026-06-16"
updated: "2026-06-16"
tags: [opinions, taste, stances, anti-slop, defaults, rate-limiting, caching, idempotency]
synthesist: SYNTHESIS / taste-node (CP123 Wave-R)
sources: ["brain/research/raw/ecosystem-*.md", "brain/research/raw/field-*.md"]
summary: "Explicit, defensible taste stances for the rate-limiting/caching employee. Each is ALWAYS/NEVER + the REASON + the SOURCE + the ESCAPE HATCH (when the opinion does NOT apply). This is the layer that makes echo opinionated instead of a Wikipedia summary — a fresh agent inherits a POINT OF VIEW, not a list of options."
related: ["[[echo EXPERTISE-MAP]]", "[[echo KNOWN-PITFALLS]]", "[[echo BATTLE-TESTED-SCENARIOS]]", "[[echo GAPS-AND-DISPUTES]]"]
---

# echo OPINIONS

> **Why this file exists.** A domain expert is not someone who lists every option — it's someone who has a *default*
> and can defend it, AND knows the exact condition under which to abandon it. Each opinion below is a stance echo
> holds by default, with the reason, the source, and the escape hatch. **An opinion without an escape hatch is
> dogma;** every one here names when it flips. When a task contradicts an opinion, that's a signal to check the
> escape hatch — not to silently comply (Karpathy "Think Before Coding").

---

## O-01 — ALWAYS put cross-request state in an external store; NEVER in a process the platform can share, recycle, or fan out

- **Reason.** A rate counter and a cache value are *by definition* cross-request state. A module-scope `Map` is wrong
  for two compounding reasons in 2026: it's **empty on cold start** (the limiter no-ops, the cache always misses)
  AND, more dangerously, **shared & raced under Vercel Fluid Compute** (default-on, one warm instance serving 250+
  concurrent requests → cross-user data bleed + a fail-open limiter). This is a *security* bug, not just a cache
  miss — and it's invisible in `vercel dev`.
- **Source.** energy `.claude/rules/typescript.md:13`; turbo P-02/S-01/O-01 (field-00 REF-1/REF-2/REF-4);
  ecosystem-00:69-75.
- **The one-line test.** "Is this a process the platform is free to share, recycle, or fan out?" If yes, it can't
  hold authoritative state. Canonical homes: Upstash Redis · Supabase · Vercel KV · Cloudflare Durable Objects /
  Workers KV.
- **Escape hatch.** A DB **connection pool** is safe at module scope (it manages its own concurrency). And see O-02
  — a *lossy cache over an external store* is allowed.

## O-02 — A module-scope Map is FINE iff a miss is safe; a BUG iff a miss is unsafe

- **Reason.** The distinction O-01 omits and that echo OWNS teaching: `@upstash/ratelimit`'s `ephemeralCache`
  (a deny-list `Map` short-circuit) is correct *because if it's empty/stale, the request falls through to Redis →
  the answer is still safe*. It never *grants* access it shouldn't — it only short-circuits *already-known-blocked*
  identities. The naive limiter uses a Map as the *source of truth* and fails OPEN (grants access). The rule:
  **a Map cache is fine when a miss is safe (deny-list, best-effort), a bug when a miss is unsafe (the counter
  itself).**
- **Source.** ecosystem-02 §1, field-03 §3.
- **Escape hatch.** None for the source-of-truth case. The exception (ephemeralCache) is itself the escape hatch to
  O-01 — keep it, don't "fix" it (KNOWN-PITFALLS P-02).

## O-03 — ALWAYS key rate limits on authenticated identity behind auth; NEVER on a client-settable header

- **Reason.** `X-Forwarded-For` / `-Host` / `X-Real-IP` / `True-Client-IP` are set by the *client* → an attacker
  rotates them for a fresh bucket per request → **silent total bypass.** This is the single most-filed rate-limit
  CVE genre of 2026 (Litestar CVSS 5.3, Vikunja, Homebox, Coolify, LibreTranslate + 15 more in one June-2026 sweep).
  A rate limiter that fails open is *worse* than none — false safety + the operator stops watching.
- **Source.** field-02 §1, ecosystem-05 (Cloudflare independently: "don't key on IP").
- **Escape hatch.** Unauthenticated edges have no identity → key on **socket IP / the value your own infra wrote**
  (Vercel's edge overwrites XFF — trust leftmost-untrusted), and for IPv6 key the **/64 prefix, not /128** (O-09).
  Even then, expect IP rotation (residential proxies, ~$500/mo for unlimited) — IP limits are a speed bump, not a
  wall.

## O-04 — ASK "fail-open or fail-closed?" on every limiter; default fail-OPEN for product APIs, fail-CLOSED for security

- **Reason.** `@upstash/ratelimit`'s `timeout` (default 5s) makes the limiter pass *regardless of the limit* when
  Redis is slow — correct for a product API (don't 429 a paying user on a blip), a brute-force door on login/payment
  endpoints. The fail-open/closed choice is echo's **core judgment call**, and the library's default is a footgun
  for abuse-prevention.
- **Source.** ecosystem-02 §2 (KNOWN-PITFALLS P-11).
- **Escape hatch.** This opinion *is* the conditional: availability-critical → fail-open; abuse/correctness-critical
  → fail-closed (low timeout, treat a thrown error as DENY). Never pick one without naming which the endpoint is.

## O-05 — ALWAYS pair a rate limit with a concurrency cap; a per-minute counter alone is not a defense

- **Reason.** HTTP/2 (and HTTP/3) multiplexing lands a burst of concurrent streams "in the same millisecond" that
  beats any rate-only counter via a TOCTOU race at the check ($8,347 in 6 hours with a *correct, Redis-backed,
  IP-keyed* limiter). Rate (requests/time) and concurrency (in-flight) are different dimensions; you need both.
- **Source.** field-02 §4 (BATTLE-TESTED-SCENARIOS S-03).
- **Escape hatch.** A genuinely single-threaded / non-multiplexed path (a queue consumer, an internal cron) may not
  need a concurrency cap. Anything public + HTTP/2 does.

## O-06 — The limit DECISION must be atomic (one Lua op / atomic token decrement); NEVER incr-then-separate-read

- **Reason.** Two round trips (`incr`, then a separate `read`/compare) is a TOCTOU bypass — concurrent requests
  increment correctly but all decide "under limit" before the increments settle. The increment and the decision
  must be the same op.
- **Source.** field-02 §4, field-06 §3B ("the counter must be atomic + shared — that's the real engineering, not the
  algorithm").
- **Escape hatch.** None. Use a Lua script (`INCR`+compare) or a library that decrements atomically (`@upstash/
  ratelimit` does this). This is non-negotiable for any shared counter.

## O-07 — Lead with the CONSISTENCY MODEL; the algorithm is a secondary, per-endpoint tuning knob

- **Reason.** Arcjet, verbatim: "Distributed rate limiting is fundamentally a consistency problem. **Algorithm
  choice matters, but state coordination dominates complexity at scale.**" Average engineers argue about token
  bucket vs sliding window; experts decide strong-vs-eventual consistency first (the hard part is the distributed
  counter — hot keys, clock skew, region isolation, atomicity).
- **Source.** field-06 §2.2, §3B.
- **Escape hatch.** For a single-instance limiter (no distribution) the algorithm *is* the main decision — the
  consistency-first rule applies *at scale*.

## O-08 — The backend SPEND CAP is the last line of defense; the limiter protects the app, the cap protects the business

- **Reason.** Auto-scaling *amplifies* an attack (3→47 EC2 in the $8,347 story — "scaled TO the attack rather than
  rejecting it"). A **low** cost alarm ($500, not $8,347) + hard ceilings (max instances, max DB connections) turns
  an $8k incident into a $200 one. No rate limiter is perfect; the spend cap is the floor under the worst case.
- **Source.** field-02 §4.
- **Escape hatch.** None worth naming — a spend cap is cheap insurance. The only tuning is the threshold (set it
  *low*, not at the catastrophe level).

## O-09 — For IPv6, ALWAYS key on the /64 (or /56) prefix; NEVER the full /128

- **Reason.** A single IPv6 allocation is often a /64 (18 quintillion addresses). Per-/128 limiting lets an attacker
  rotate within their own allocation for free, forever (CardSort #12).
- **Source.** field-02 §3.
- **Escape hatch.** If you can prove the upstream assigns one stable address per user (rare), /128 is fine —
  otherwise /64.

## O-10 — ALWAYS set a TTL on every cached key, and jitter it

- **Reason.** Every invalidation scheme can fail (forgotten path, prefix mismatch, success-only, dual-write race);
  the TTL is the only thing that *guarantees* eventual correctness — "prevents zombie cache entries from persisting
  indefinitely if your invalidation logic has bugs." And a *fixed* TTL across a fleet of keys is a **scheduled
  stampede** (synchronized expiry).
- **Source.** field-04 §5, field-01 §4.
- **Escape hatch.** None. Even with event-driven invalidation on top, the TTL stays as the safety net. The only
  knob is the duration (pick from the data's staleness tolerance; jitter always).

## O-11 — DELETE, don't UPDATE, the cache on write; DB FIRST, then DEL; double-delete for strict freshness

- **Reason.** Updating the cache races worse than deleting (two writers interleave, the loser's value sticks);
  deletion "forces fresh retrieval, avoiding stale-data propagation." DB-first-then-DEL is the base ordering; a
  **delayed-double-delete** closes the repopulate-stale window where a concurrent reader writes back the old value
  after the DEL.
- **Source.** field-04 §3.
- **Escape hatch.** Write-through (atomic cache+store update) is acceptable for read-your-writes-critical data via a
  Durable Object / single logical writer; for everything else, delete.

## O-12 — Invalidate on SUCCESS **and** FAILURE (`finally`) when the store was mutated

- **Reason.** Success-only invalidation (framework cache annotations) leaves stale data when a method mutates the
  store then throws — "the old cache entry persists in the one place nobody is staring at," and the source explicitly
  names *rate limits* as a danger zone.
- **Source.** field-04 §4.
- **Escape hatch.** If the mutation and invalidation are in one atomic transaction that rolls back together, the
  finally isn't needed — but that's rare across a cache+DB boundary.

## O-13 — Centralize invalidation in the DATA LAYER / CDC, not the endpoint; keys are CONTRACTS built in ONE function

- **Reason.** "If invalidation lives in the controller, the second controller will forget it" (the #1 invalidation
  bug — the admin endpoint that didn't invalidate). And hand-built key strings on reader/invalidator sides drift
  (`user:` vs `users:`) → `DEL` returns 0, stale persists silently. Invalidation is a property of the *data*, not
  the *endpoint*; the key is a *contract*, built once.
- **Source.** field-04 §1, §2; same shape as the spoofable-key bug (field-02 §1) and the coverage-gap bug.
- **Escape hatch.** A tiny app with exactly one write path can inline invalidation — but the moment a second path
  exists (admin, webhook, script), centralize. And `DEL → 0` on an expected key should always be a logged signal.

## O-14 — ALWAYS version-key anything whose validity depends on external state (LLM model/RAG/schema version)

- **Reason.** A stale LLM answer has **no error signature** — "it still looks like a valid answer, it's just wrong."
  Caching on prompt alone serves the old model's answers after an upgrade, indefinitely, silently. Putting the model
  version + prompt-template version + RAG-corpus version in the key means old entries simply never match again — no
  risky DEL sweep. Directly relevant to the Energy fleet, which caches LLM calls.
- **Source.** field-04 §7.
- **Escape hatch.** None for LLM/RAG caches. For deterministic data, schema-version-keying is optional but cheap.

## O-15 — On serverless, DISTRIBUTED single-flight (SETNX+Lua release) or SWR; in-process single-flight is a LIE

- **Reason.** An in-memory `Map<key, Promise>` dedup only works within one process — across 50 warm instances it's a
  50-request stampede, not single-flight (the drizzle #5841 fix as shipped). This is echo's *highest-leverage*
  opinion: the most common "stampede fix" is wrong on the exact platform echo defends.
- **Source.** field-01 §1, §3.
- **Escape hatch.** A genuinely stateful runtime (long-running container, Fastify/Hono on a box, a Durable Object)
  CAN use in-process single-flight — that's exactly where the drizzle fix is correct.

## O-16 — JITTER every TTL and every retry backoff (full jitter) — the one line that fixes BOTH herds

- **Reason.** Cache stampedes (expiry herd) and retry storms (recovery herd) share one root cause —
  **synchronization** — and one fix: jitter. "Full jitter" (`sleep = random(0, min(cap, base*2^n))`) beats plain
  exponential backoff because backoff controls the *average* retry rate while jitter controls the *variance*, and
  zero-variance (everyone retries at the same instant) is what causes the herd. The 2026 GitHub volume filing this
  proves the whole industry keeps forgetting it.
- **Source.** field-01 §4, field-05 §4.
- **Escape hatch.** None. Fixed intervals are scheduled herds. This is the rule that connects echo's two domains.

## O-17 — RUN admission control / rate limiting BEFORE the expensive work, never after

- **Reason.** A limiter placed after the DB call protects nothing — the read pool is exhausted by requests that
  would have been rejected anyway (ElectricSQL #4266: "pre-admission work saturates the pool before load-shedding
  can reject").
- **Source.** field-01 §2.
- **Escape hatch.** None — ordering is free to get right.

## O-18 — Don't reflexively CACHE a herd; first ask if the origin is just INEFFICIENT

- **Reason.** Depot (Nov-2025) fixed a thundering herd with *query optimization, NOT caching* (a composite index
  folding `json_extract` into the index scan). A cache over a fixable query *hides a bug* and *adds invalidation
  risk* — you take on "one of the two hard things" to paper over a missing index.
- **Source.** field-05 §2 (DISPUTE D in [[echo GAPS-AND-DISPUTES]]).
- **Escape hatch.** Cache *intrinsically-expensive, redundantly-recomputed* work (an external API call, a heavy
  aggregation that's already index-optimal). The decision tree: `EXPLAIN` first; cache only what's still expensive
  after the query is fixed.

## O-19 — COUNT COMMANDS, not requests, before choosing per-command pricing; keep write-heavy limiters REGIONAL

- **Reason.** A sliding-window limiter is **4 Redis commands/request** (+1 analytics), and Global multiplies the
  write side `×(1+readRegions)` → a "$0.20/100K is cheap" assumption becomes a ~$25,920/month bill at 1k req/s.
  "Pay-per-command is cheap" is only true if you count commands. Global mode multiplies the *expensive* (write) side
  of a write-heavy limiter.
- **Source.** field-03 §1, §4; ecosystem-02 §pricing.
- **Escape hatch.** Low/bursty traffic → per-command Upstash is the right default (scales to zero). Past ~100M
  cmds/day → switch the limiter to a **fixed instance** (Redis Cloud/ElastiCache/Valkey). The algorithm choice is a
  *cost* decision too (fixed window = 2 cmds = half the bill where a 2× boundary burst is acceptable).

## O-20 — NEVER put a rate limiter or per-request counter on Cloudflare Workers KV

- **Reason.** KV is **eventually consistent (up to 60s cross-region)** and capped at **1 write/sec/key (un-raisable)**
  with write p50 ~172ms (~28× slower than Upstash on the side a limiter hammers) — a limiter keyed on a user
  ID/IP **silently fails open** and drops writes on busy keys. KV is a *read-mostly edge cache*.
- **Source.** field-07 §1, ecosystem-04 §CF-KV.
- **Escape hatch.** Edge counters → **Durable Object** (strong, exact) or Upstash. KV is fine for read-mostly
  config / feature flags / rarely-changing blobs.

## O-21 — Idempotency FAILS-CLOSED (the inverse of rate limiting); use the Stripe pattern, with a DB-unique backstop

- **Reason.** An idempotency store is a cache with exactly-once semantics — same distributed-state class as rate
  limiting but it inverts one knob: **better to reject a duplicate-uncertain request than double-charge.** The Stripe
  pattern (required `Idempotency-Key`, atomic `SET NX` claim, request-fingerprint → 400 on key reuse, 24h TTL, store
  the response) + a **DB unique-constraint** backstop if Redis is down.
- **Source.** ecosystem-06, field-06 fail-closed framing.
- **Escape hatch.** None for payment-class endpoints. Lower-stakes idempotency (a non-financial "create" that's
  cheap to re-run) can tolerate a weaker guarantee — but default to fail-closed.

## O-22 — Prefer the runtime-correct EXAMPLE over hand-rolling; lift from `upstash/ratelimit-js/examples/<runtime>`

- **Reason.** The library's `examples/` directory has one correct setup per runtime (nextjs-middleware, vercel-edge,
  cloudflare-workers, deno, remix, with-vercel-kv) — each pre-solves the "wrong platform build" trap (issue #9) and
  the `waitUntil(pending)` wiring (P-10). Retrieve, don't generate.
- **Source.** ecosystem-07 §1, ecosystem-08 #9.
- **Escape hatch.** For TCP-Redis on a long-running Node server, @upstash/ratelimit is the wrong base entirely (it's
  HTTP-only, issue #115) — lift from `rate-limiter-flexible` instead. For a custom GCRA limiter, lift from
  `Losant/redis-gcra`.

## O-23 — "Redis" means the FAMILY (Redis/Valkey/Redict); Valkey is the 2026 cost-default for self-host/AWS

- **Reason.** Redis's 2024 relicense spawned **Valkey** (Linux Foundation, BSD), now first-class in ElastiCache (at
  a discount) and command-compatible for everything a limiter/cache uses (`INCR`, `EXPIRE`, `EVAL`, sorted sets).
  Treating "Redis" as a trademark instead of a protocol leaves the license-clean, cheaper option on the table.
- **Source.** field-07 §4, ecosystem-04 §Valkey.
- **Escape hatch.** If you need a Redis *module* (RedisJSON/RediSearch/RedisTimeSeries) Valkey may lack parity —
  verify before switching; for plain limiter/cache commands, Valkey is the default.

---

## The opinions in one breath (what makes echo *opinionated*, not encyclopedic)

External store always (O-01), Map only when a miss is safe (O-02). Key on identity not headers (O-03), decide
fail-open/closed (O-04), pair rate with concurrency (O-05), atomic decision (O-06), consistency-model first (O-07),
spend cap as the floor (O-08), IPv6 /64 (O-09). Cache: always-TTL+jitter (O-10), delete-don't-update + double-delete
(O-11), invalidate in `finally` (O-12), centralize in the data layer + keys-as-contracts (O-13), version-key LLM
caches (O-14). Herds: distributed single-flight not in-process (O-15), jitter both (O-16), admission-first (O-17),
fix-the-origin-before-caching (O-18). Cost: count commands + Regional (O-19), never a limiter on CF KV (O-20).
Idempotency fails-closed (O-21). Lift the runtime example (O-22). Redis = the family, Valkey-default (O-23).

**The meta-stance:** most failures in this vertical are **synchronization** (jitter fixes it) or **shared-mutable-
state** (atomic shared counters + keys-as-contracts fix it). Lead with those two, and the rest is tuning.
