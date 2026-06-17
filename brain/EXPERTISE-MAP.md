---
title: "echo EXPERTISE-MAP — Everything the Rate-Limiting/Caching Employee Must Master"
type: synthesis
created: "2026-06-16"
updated: "2026-06-16"
tags: [expertise-map, rate-limiting, caching, idempotency, redis, upstash, edge, stampede, invalidation, serverless]
synthesist: SYNTHESIS / taste-node (CP123 Wave-R)
sources: ["brain/research/raw/ecosystem-*.md", "brain/research/raw/field-*.md"]
summary: "The map of mastery for echo, organized by JOB-TO-BE-DONE (not by tool). A fresh Claude session that reads this + the five sibling artifacts (OPINIONS / KNOWN-PITFALLS / BATTLE-TESTED-SCENARIOS / TOOL-MATRIX / GAPS-AND-DISPUTES) becomes dangerous in rate-limiting/caching work. Every node cites the raw source that grounds it."
related: ["[[echo OPINIONS]]", "[[echo KNOWN-PITFALLS]]", "[[echo BATTLE-TESTED-SCENARIOS]]", "[[echo TOOL-MATRIX]]", "[[echo GAPS-AND-DISPUTES]]"]
---

# echo EXPERTISE-MAP — by Job-To-Be-Done

> **How to read this.** echo is the Energy fleet's **rate-limiting / caching domain-expert employee**, operated by
> coding agents. It OWNS the class of problems that arise the moment per-request work must remember something across
> requests, instances, or the edge: rate limiting, caching, cache invalidation, idempotency, and distributed-state
> correctness. This file is the skeleton of what echo must know, grouped by the *job* it's doing, not by the *tool*
> it reaches for. Each node points to the raw file that grounds it and to the sibling artifact that goes deeper.
>
> **echo's one-sentence law (the through-line of every node below):** *State that must outlive a request lives in an
> external store the platform cannot share, recycle, or fan out — and almost every failure in this vertical is either*
> ***synchronization*** *(herds, fixed TTLs, fixed backoffs) or* ***shared-mutable-state*** *(the `new Map()` bug,
> spoofable keys, cross-user cache leak). The fixes are jitter, atomic shared counters, and keys-as-contracts.*
> (source: ecosystem-00, field-08 §D)

---

## The boundary echo lives on: turbo DOCUMENTS the anti-pattern, echo SOLVES it

echo and turbo (the fleet's backend/API-framework expert) share exactly one seam, and turbo's own brain names it:
> "ship to Vercel-Node, promote latency-critical routes to Workers. **Rate-limit/cache = echo's seam, external store
> only.**" (source: ~/turbo/brain/EXPERTISE-MAP.md:23, quoted in ecosystem-00:23-26)

- **turbo's job:** detect & forbid module-scope mutable state in `app/api/**` (the audit grep), explain *why* it
  bleeds, and point at "externalize."
- **echo's job:** own the *externalization* — pick the store, the algorithm, the key schema, the TTL, the
  invalidation strategy, the idempotency semantics, the failure mode (fail-open vs fail-closed). echo is where "use
  Upstash" becomes a correct, tested rate limiter. (source: ecosystem-00:33-38)
- **The checklist mandate echo closes:** the rate-limit/cache/KV component is an **❌ GAP** in the fleet —
  "required by `typescript.md`, unwired." (source: field-00 REF-5, energy `audit/HARNESS-CHECKLIST-2026.md:399`)

---

## JOB 1 — Decide WHERE cross-request state lives (the founding decision)

The first thing echo does on any limiter/cache task: pick the store, and justify it against the one-line test.

- **The energy law (REF-1):** "NEVER use `new Map()` for cross-request state in Vercel API routes (`app/api/`).
  Each request may hit a cold Lambda with empty state. Use external stores (Supabase, Upstash) or pass IDs from
  client." (source: field-00 REF-1, energy `.claude/rules/typescript.md:13`)
- **The 2026 escalation (REF-2) — the bug got WORSE, two failure modes now:**
  1. **Cold-empty** (2024 framing): fresh Lambda → empty Map → cache always misses / limiter reads 0 → no-op.
  2. **Warm-racy** (2026, Vercel Fluid Compute default-on): one warm instance serves 250+ concurrent requests that
     **share** the Map → cross-user data bleed (caching) + a fail-open limiter (security). **Invisible in
     `vercel dev`** — emulators don't reuse containers. (source: field-00 REF-2, turbo P-02 / S-01)
- **The one-line test echo applies to any proposed store location:** *"Is this a process the platform is free to
  share, recycle, or fan out?"* If yes → it cannot hold authoritative state. (source: field-00 REF-4, turbo O-01)
- **The canonical store list (inherited):** Upstash Redis · Supabase · Vercel KV · Cloudflare Durable Objects /
  Workers KV. A DB **connection pool** is safe at module scope (it manages its own concurrency); a raw lazily-
  assigned client ref is not. (source: field-00 REF-2/REF-4)
- **The ONE legitimate exception (the most important distinction echo teaches):** a module-scope `Map` is FINE iff
  it is a **lossy cache over an authoritative external store** (e.g. `@upstash/ratelimit`'s `ephemeralCache`
  deny-list short-circuit), and a BUG iff it is the **source of truth**. The test: *if this Map is empty or stale,
  is the answer still safe?* Deny-list cache empty → falls through to Redis → safe. Limiter counter empty → grants
  access → fail-open → bug. (source: ecosystem-02 §1, field-03 §3 — deeper in [[echo OPINIONS]] O-02)
- **Store taste lives in:** [[echo TOOL-MATRIX]] §Store-layer · [[echo OPINIONS]] O-01/O-02 · pitfalls in
  [[echo KNOWN-PITFALLS]] P-01.

---

## JOB 2 — Build a rate limiter that an attacker can't bypass

The threat model is the job. A rate limiter that fails open is *worse* than none — it gives false safety and the
operator stops watching. (source: field-02 thesis)

### 2a. Pick the key (this is where most limiters die)
- **Never derive the key from a client-settable header** (`X-Forwarded-For`, `X-Forwarded-Host`, `X-Real-IP`,
  `True-Client-IP`). The client sets it → the attacker rotates it → a fresh bucket per request → total silent
  bypass. This is **the single most-filed rate-limit CVE genre of 2026** (Litestar GHSA-hm36-ffrh-c77c CVSS 5.3,
  Vikunja, Homebox, Coolify, LibreTranslate + 15+ open issues in one June-2026 sweep). (source: field-02 §1)
- **Right key:** the value *your own infra wrote* (Vercel's edge overwrites/prepends XFF — trust the leftmost-
  untrusted), or **the authenticated identity** (userId / apiKey) behind auth. Reserve IP-based limits for the
  genuinely-unauthenticated edge. Cloudflare's own binding doc independently says "don't key on IP." (source:
  field-02 §1, ecosystem-05 CF best-practices)
- **IPv6:** key on the **/64 (or /56) prefix, never /128** — a single allocation is a /64 (18 quintillion addrs);
  per-/128 limiting is free to rotate within your own allocation forever (CardSort #12). (source: field-02 §3)
- **Coverage is correctness:** a limiter that protects 9/10 routes protects 0 — "non-middleware route" bugs are
  bypasses (commitpulse #1868). Enforce at the edge or audit every route. (source: field-02 §2)

### 2b. Make the decision atomic + shared (the coordination problem)
- **The counter must be atomic AND shared.** On serverless: `INCR`+`EXPIRE` in Redis, or sliding-window/GCRA in a
  Lua script so the read-modify-write is one round trip. An in-process `Map`/LRU limiter is (a) per-process →
  bypassable on serverless, (b) racy → undercounts (read-modify-write isn't atomic), (c) its own GC becomes a
  bottleneck. (source: field-02 §2)
- **TOCTOU is the subtle killer:** `incr` then a *separate* `read`/compare lets HTTP/2 multiplexing land 100
  concurrent streams "in the same millisecond" that all see "under limit" → the $8,347 bypass. The increment AND
  the decision must be one atomic op. (source: field-02 §4)
- **Pair rate with concurrency:** a per-minute rate is necessary but not sufficient; also cap *in-flight*
  concurrency per connection/identity (HTTP/2 multiplexes a burst that beats a per-minute counter). (source:
  field-02 §4 — opinion in [[echo OPINIONS]] O-05)
- **Arcjet's load-bearing insight:** "Distributed rate limiting is fundamentally a **consistency problem**.
  Algorithm choice matters, but state coordination dominates complexity at scale." Lead with the consistency model,
  not the algorithm. (source: field-06 §2.2)

### 2c. Pick the algorithm (a *secondary, per-endpoint* tuning knob)
The four echo must know cold — full taste table in [[echo TOOL-MATRIX]] §Algorithms, disputes in
[[echo GAPS-AND-DISPUTES]] D-A/D-B:
- **Fixed window** — cheapest (2 Upstash cmds: `EVAL, INCR`), leakiest. Tolerates **2× burst at the boundary**
  → "a login endpoint protected by fixed window can be brute-forced at window boundaries." OK only for coarse
  internal quotas. **Never on auth.** (source: ecosystem-03 §1, field-06 §1)
- **Sliding window (counter approx)** — Upstash's default; exact formula `rate = prev*((period-elapsed)/period) +
  curr` (4 cmds: `EVAL, GET, GET, INCR`). The sane HTTP-throttle default; bounded memory; approximation assumes
  uniform prior-window flow. (source: ecosystem-03 §2)
- **Token bucket** — Arcjet's "**strongest default for modern APIs**" *because real traffic is bursty* (batch
  jobs, app launches, retry waves); allows controlled burst + caps sustained rate (4 cmds). The "API credits"
  model. **Not supported in MultiRegion.** (source: ecosystem-03 §3, field-06 §2.1)
- **GCRA (Generic Cell Rate Algorithm)** — the connoisseur's distributed choice; one TAT (Theoretical Arrival
  Time) per key, atomic single-op, **no drip/refill worker to lag** (the killer operational advantage in
  multi-region). NOT in `@upstash/ratelimit` — use `Losant/redis-gcra` Lua. (source: ecosystem-03 §4, field-06 §2.3)
- **echo's decision rule:** consistency model first → token bucket for general bursty APIs → sliding-window/GCRA
  for abuse-sensitive endpoints (login/reset/expensive ops, no boundary brute-force) → GCRA for multi-region →
  right-size by cost (fixed=2 cmds where 2× boundary burst is harmless). (source: field-06 §4, ecosystem-03 §decision)

### 2d. Choose the failure mode (echo's core judgment call)
- **`timeout` makes `@upstash/ratelimit` fail-OPEN** (default 5s: request passes regardless if Redis is slow).
  Correct for product APIs (don't 429 a paying user on a Redis blip). **A FOOTGUN for security-critical limits**
  (login brute-force, payment endpoints) which must fail-CLOSED. echo always asks: "fail-open or fail-closed?"
  (source: ecosystem-02 §2 — opinion in [[echo OPINIONS]] O-04)

### 2e. The last line of defense: the backend spend cap
- Auto-scaling *amplifies* an attack (scaled 3→47 EC2 in the $8,347 story). The rate limiter protects the *app*;
  a **low cost alarm + hard ceilings** (max instances, max DB connections) protects the *business* — turns an $8k
  incident into a $200 one. (source: field-02 §4 — opinion in [[echo OPINIONS]] O-08)

---

## JOB 3 — Cache hot paths without serving stale or leaking across users

### 3a. Cache-key isolation (the security-grade requirement turbo hands echo by name)
- turbo S-12 literally names echo: "cache middleware cross-user leakage … echo (rate-limit/cache) must treat
  cache-key isolation as **first-class**." A cache keyed on URL alone, on a multi-tenant route, leaks user A's
  response to user B — the most common cache bug that is *also* a security incident. **The cache key must include
  the tenant/user/auth boundary.** (source: field-00 REF-3, turbo S-12)
- **Keys are contracts — build them in ONE function** (`cacheKey(entity, id)`) used by reader AND invalidator AND
  limiter. Key drift (prefix mismatch) and key trust (spoofable header) are the same class of bug. (source:
  field-04 §2, field-02 §1, field-08 L3)

### 3b. Invalidation — "one of the two hard things" (Phil Karlton)
The taxonomy + the war stories (deeper in [[echo BATTLE-TESTED-SCENARIOS]] S-05..S-08, [[echo OPINIONS]] O-10..O-14):
- **The forgotten write path (#1 invalidation bug):** a second write path (admin endpoint) forgets to invalidate →
  stale reads. Fix: invalidation is a property of the **data, not the endpoint** — centralize in the data-access
  layer or CDC. "If invalidation lives in the controller, the second controller will forget it." (source: field-04 §1)
- **The namespace/prefix mismatch:** `DEL users:{id}` when the writer used `user:{id}` → `DEL` returns **0**
  (deleted nothing), which is **not an error** and looks identical to "wasn't cached" → stale persists silently
  (5 microservices, tens of thousands of sessions). **Treat `DEL → 0` as a logged signal.** (source: field-04 §2)
- **The dual-write / repopulate-stale race:** DB-write-then-DEL still races — a concurrent reader can read OLD from
  DB, then write it back into cache after the DEL. Fixes: **delete don't update**, **DB first then DEL**,
  **delayed-double-delete** (DEL, write, DEL again after a short delay) or a single-flight lock. (source: field-04 §3)
- **Success-only invalidation:** framework cache annotations (`@CacheInvalidateAll`) run **only on success** — a
  method that mutates the store then throws leaves stale data "in the one place nobody is staring at." Invalidate
  in a `finally` for data where staleness is dangerous (tokens, permissions, **rate limits**). (source: field-04 §4)
- **The four strategies:** TTL (the safety net, always on) · event-driven (best freshness, vulnerable to forgotten/
  failure paths) · version-based (best for bulk + LLM; old keys age out, no risky DEL) · tag-based (grouped; watch
  the tag-set's own TTL). (source: field-04 §6)

### 3c. TTL discipline
- **Always set a TTL** — the only thing that *guarantees* eventual correctness when every invalidation scheme can
  fail. **Jitter it** (fixed TTL on a fleet of keys = a scheduled stampede). **Account for layered staleness =
  SUM of TTLs** (a value cached downstream of another cache is as stale as both combined). When in doubt, shorter
  TTL + stale-while-revalidate beats a long TTL. (source: field-04 §5)

### 3d. LLM response caching (the Energy fleet's own use case)
- A stale LLM answer has **no error signature** — it's plausible and wrong. **Put the model version, prompt-template
  version, and RAG-corpus version IN the cache key.** Version-keying means stale entries simply never match again —
  no risky DEL sweep. This is not optional for the fleet, which caches LLM calls. (source: field-04 §7 — opinion O-14)

### 3e. Edge caching + SWR + Next.js (the platform reality echo defends)
- **stale-while-revalidate** (RFC 5861): serve stale instantly, refetch in background — the right default for
  almost all read-heavy caches. (source: ecosystem-05 §SWR)
- **Next.js `revalidateTag` is LAZY, not an immediate purge:** it marks the tag stale; the next visit to a page
  using that tag triggers SWR. "until then, users still get the previous response." The #1 "why is my cache still
  stale" confusion. (source: ecosystem-05, nextjs docs)
- **The two-cache problem:** Next.js has a *server* Data Cache AND a *client* Router Cache — a server `revalidateTag`
  doesn't purge the client router cache → "I revalidated but the user sees old data on back-navigation." Next.js 16
  added `updateTag()` for eager read-your-writes. (source: ecosystem-05, vercel/next.js #91785)
- **Tag cardinality is the invalidation problem in disguise:** one over-broad tag → every mutation invalidates the
  world (stampede on next visit); too-granular → you forget one. (source: ecosystem-05 §taste-3)
- **Cloudflare specifics:** Cache API / `caches.default` for programmatic edge cache; **cache-tag purge is
  Enterprise-only** (flag this paywall); Durable Objects double as a strongly-consistent read-your-writes edge
  cache when SWR's staleness is unacceptable. (source: ecosystem-05 §Cloudflare)

---

## JOB 4 — Protect the origin from the thundering herd (stampede + retry storm)

The two herds share a root cause (**synchronization**) and a one-line fix (**jitter**). (source: field-08 L17)

### 4a. Cache stampede (herd caused by *expiry*)
- **The definition:** a hot key expires (or cold cache starts empty), N concurrent requests all miss, all fire the
  same expensive origin query simultaneously, origin drowns. The cache meant to *protect* the origin instead
  *concentrates* a synchronized spike onto it. (source: field-01 thesis)
- **The four mitigation patterns** (menu in [[echo TOOL-MATRIX]] §Stampede, deeper in S-01/S-02):
  1. **Distributed lock (SETNX, Lua-guarded release)** — the serverless-safe single-flight. Mandatory atomic
     release comparing a UUID. Use for *expensive* fills.
  2. **Probabilistic early expiration (XFetch)** — `P(refresh) = exp(-remaining/(beta*delta))`; refresh before
     expiry. For known mega-hot keys with predictable cost.
  3. **In-process single-flight** — ⚠️ "doesn't persist across instances" — this is the Map-bug class. A *latency
     optimization within one instance*, NEVER your stampede defense on serverless.
  4. **Stale-while-revalidate** — serve stale, refresh in background; the best default for read-heavy UI.
  (source: field-01 §3 OneUptime; "layer your defenses")
- **The serverless trap (echo's highest-leverage opinion):** the drizzle-orm `$withCache` fix (#5841, June 2026)
  uses an in-process `Map<key, Promise>` for in-flight dedup — *correct for a long-running server, the Map-bug on
  serverless.* With 50 warm instances you turn an N-request stampede into a 50-request stampede. **In-process
  single-flight only deduplicates within one process; serverless needs distributed single-flight.** (source:
  field-01 §1)
- **Admission control runs BEFORE the expensive fill, not after** — a rate limiter placed after the DB call
  protects nothing (ElectricSQL #4266 lesson 1). (source: field-01 §2)
- **The cheapest fix nobody applies: TTL jitter.** Synchronized expiry (many keys written at deploy/import with the
  same TTL → all expire the same second) is the most common stampede root cause. `ttl ± rand(jitter)`. One line,
  highest ROI in the vertical (proven by the volume of 2026 issues filing it). (source: field-01 §4)

### 4b. Retry storm (herd caused by *failure + recovery*)
- **The mechanism:** a dependency goes down → every client retries → synchronized retries become a self-inflicted
  DDoS that keeps it down AND flattens it again the instant it recovers. The AWS US-East-1 Oct-2025 outage: a DNS
  bug + retry amplification → 15-hour cascade, "congestive collapse" at recovery (every client reconnecting at
  once). **The dangerous moment is recovery.** (source: field-05 §1)
- **Full jitter** beats plain exponential backoff: `sleep = random(0, min(cap, base*2^n))` — it maximally
  de-synchronizes. Backoff controls the *average* retry rate; jitter controls the *variance* — and zero-variance
  (everyone retries at the same instant) is what causes the herd. (source: field-05 §4)
- **Budget retries with a retry-token-bucket** (retries consume tokens; empty bucket → fail fast / shed load),
  not just per-request backoff. A retry is a *local* decision with *global* consequences. (source: field-05 §3)
- **Circuit-break a down dependency** (stop retrying entirely once clearly down) and **reopen gradually** (half-open
  trickle) to avoid the recovery herd. (source: field-05 §3)
- **Humility: don't reflexively cache a herd** — first ask if the origin is slow because it's *inefficient*. Depot
  (Nov-2025) fixed a thundering herd with *query optimization, NOT caching* (a composite index folding the
  `json_extract` into the index scan). A cache over a fixable query hides a bug and adds invalidation risk. (source:
  field-05 §2 — dispute D-D in [[echo GAPS-AND-DISPUTES]])

---

## JOB 5 — Make mutating endpoints exactly-once (idempotency)

An idempotency-key store IS a cache with exactly-once semantics — the same distributed-state class as rate limiting,
but it inverts one knob: **idempotency fails-CLOSED** (correctness > availability) where rate limiting often
fails-open. The canonical reference is Stripe. (source: ecosystem-06)

- **The Stripe pattern (the gold standard):**
  1. **Required on mutating endpoints** — client sends a unique `Idempotency-Key` (UUID); reject if missing on
     payment-class endpoints.
  2. **Request-fingerprint check (the critical correctness gate):** store a hash of method+path+body with the key;
     on replay, same hash → return the cached response, **different hash → 400** (the client is reusing one key for
     two operations).
  3. **24-hour TTL** (Stripe's balance of dedup coverage vs storage).
  4. **Atomic claim:** `SET idemp:{key} INPROGRESS NX EX 86400` — first wins and proceeds; second sees the
     in-progress marker → 409/retry-after or returns the stored result. Beats the two-concurrent-same-key race.
  5. **Recovery points / state machine** — a request that crashed mid-way (charged the card, didn't write the DB
     row) resumes at the right step rather than re-charging.
  (source: ecosystem-06 §Stripe-pattern)
- **Store specifics:** shared store mandatory (per-instance Map is WRONG, same Map-bug reason); Redis Cluster slot
  pinning via hash-tags `{...}` so related keys co-locate; **DB unique-constraint fallback** as the durable
  fail-closed backstop if Redis is down. (source: ecosystem-06 §Redis-implementation)
- **Emit the standard header** — there's an IETF draft RFC ("The Idempotency-Key HTTP Header Field"); use it, not
  a bespoke one. (source: ecosystem-06 §RFC)
- **Never cache a GET under idempotency** (GETs are already idempotent by HTTP semantics). (source: ecosystem-06 §6)
- **The inversion table** (rate-limit vs idempotency — same class, one flipped knob): both distributed+atomic; RL
  TTL = window (s–min) vs idempotency = 24h; RL key = identifier vs idempotency = client UUID; RL **fail-OPEN** vs
  idempotency **fail-CLOSED**; RL atomic = `INCR`/Lua vs idempotency = `SET NX`/Lua. (source: ecosystem-06 §differences)

---

## JOB 6 — Reason about the bill before recommending the store (cost is correctness)

The bill is a real attack surface AND a design constraint. Per-command serverless Redis is brilliant at low traffic
(scales to zero) and terrifying at high traffic on a chatty workload. (source: field-03 thesis)

- **Count commands, not requests** — the number echo starts every cost answer from:
  - Fixed window = **2 cmds** (`EVAL, INCR`) · Sliding window = **4 cmds** (`EVAL, GET, GET, INCR`) · Token bucket
    = **4 cmds** (`EVAL, HMGET, HSET, PEXPIRE`). Adders: analytics +1, deny-list +2, dynamic limits +1.
  - **Multi-region multiplier:** `(1 + readRegionCount) * writeCommandCount + readCommandCount` (+1 analytics) →
    a sliding-window+analytics limiter on a Global DB with 3 read regions is easily **10+ commands/request**.
  (source: field-03 §1, ecosystem-02 §pricing)
- **echo's killer arithmetic:** sliding window (4) + analytics (1) = 5 cmds/req. At 1,000 req/s sustained = 432M
  cmds/day = ~$25,920/month at $0.20/100K — 100–5,000× a flat Redis Cloud instance. **This is the archetypal
  Reddit surprise** ("they charge $0.20/100k but…"); the dev assumed 1 request = 1 command. (source: field-03 §1, §2)
- **Pricing facts:** Upstash $0.20/100K cmds (reads=writes) + $0.25/GB-mo storage, 500K free/mo. **Vercel KV =
  Upstash under the hood but 2× the per-command price** ($0.40/100K). Cloudflare KV writes are **10× reads**
  ($5/M write vs $0.50/M read) — terrible for write-heavy limiters. (source: ecosystem-04 §pricing, field-03 §4)
- **echo's cost rules:** keep write-heavy limiters **Regional, never Global** (Global multiplies the expensive
  write side); switch to a **fixed instance** (Redis Cloud/ElastiCache/Valkey) past ~100M cmds/day; the algorithm
  choice is a *cost* decision too (fixed window halves the bill vs sliding/token). (source: field-03 §5, field-07 §2)
- **The ephemeral-cache caveat:** it cuts cost only for *already-blocked* identities (a deny-list short-circuit);
  it does NOTHING for the 4-command cost of *allowed* requests, where the bill actually lives. (source: field-03 §3)

---

## JOB 7 — Migrate the store without silently breaking the limiter

The serverless-Redis market looks interchangeable but differs on the two axes that break limiters/caches:
**consistency model** and **per-key write throughput**. (source: field-07 thesis)

- **The #1 silent-fail migration: Redis → Cloudflare Workers KV.** KV is **eventually consistent (up to 60s cross-
  region)** and capped at **1 write/sec/key on every plan** (no documented way to raise it) → "any rate limiter
  keyed on something high-traffic like a user ID or IP" silently fails open; busy keys drop writes. KV write is
  171.8ms p50 vs Upstash 6.2ms (~28× slower on the side a limiter hammers). **KV is a read-mostly edge cache, NOT
  a counter store — use Durable Objects or Upstash for edge counters.** (source: field-07 §1)
- **The when-to-switch decision:** stay on Upstash/Vercel-KV for edge/multi-region/bursty (scales to zero, reachable
  where TCP isn't); switch to a fixed instance (Redis Cloud/ElastiCache/Valkey) past ~100M cmds/day, or when you
  need Redis modules (RedisJSON/RediSearch), or in-VPC sub-ms latency. (source: field-07 §2)
- **The mechanical gotchas:** a migration that changes the runtime target changes the **client** (HTTP `@upstash/
  redis` ↔ TCP `ioredis` — TCP won't run at the edge), not just the connection string; check command/module
  compatibility; Global = write-penalty; **cut over, don't trickle** a write-heavy store (SCAN migration races live
  writes). (source: field-07 §3)
- **Valkey is the 2026 cost-default for self-hosted/AWS Redis-compatible** (LF BSD fork after Redis's 2024
  relicense; ElastiCache offers it at a discount). Treat "Redis" as the family "Redis/Valkey/Redict" — the
  protocol, not the trademark; verify Lua/module parity. (source: field-07 §4, ecosystem-04 §Valkey)

---

## JOB 8 — Operate all of this as an AGENT (not a human)

echo is agent-native; this is the CLI/API/MCP surface an LLM uses to actually DO the work. Full table in
[[echo TOOL-MATRIX]] §Agent-surface.

- **MCPs:** `upstash/mcp-server` (provision/inspect Upstash Redis/QStash from an agent — needs an Upstash API
  token); **Context7** (`upstash/context7`, the docs MCP — already wired in this energy harness; the antidote to
  the staleness problem, since `@upstash/ratelimit` ships a `context7.json`); Cloudflare's MCP + `wrangler`.
  (source: ecosystem-10 §MCP)
- **CLIs:** `upstash` (create/list DBs, read usage), `wrangler` (deploy Workers w/ ratelimit binding, KV/DO
  namespaces), `redis-cli`/`valkey-cli` (inspect keys, `INCR`/`TTL`/`TIME`, debug actual Redis state), `vercel`
  (provision KV / env vars). (source: ecosystem-10 §CLI)
- **SDK surface echo writes:** `@upstash/ratelimit` (`new Ratelimit({redis, limiter, analytics, prefix, timeout,
  ephemeralCache, dynamicLimits})`; `.limit(id, {rate})`, `.getRemaining(id)`, `.resetUsedTokens(id)`,
  `.blockUntilReady(id, timeout)`, `.setDynamicLimit({limit})`); `@upstash/redis` (`Redis.fromEnv()`); Cloudflare
  `env.MY_RATE_LIMITER.limit({key})`; Durable Object class with in-DO counter. (source: ecosystem-10 §API)
- **The env-var contract (operational footgun):** Upstash needs `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
  for `Redis.fromEnv()`. Forgetting them → the limiter throws at first call, and **with `timeout` fail-open it may
  SILENTLY allow everything.** Assert env presence at boot, don't rely on the limiter to surface it. (source:
  ecosystem-10 §env)
- **What an agent must AVOID:** wrong runtime build (issue #9, edge vs node entry); forgetting `waitUntil(pending)`
  on edge when analytics/multi-region is on (silent drops); reading the Redis key directly for "remaining" (issue
  #17 — use `getRemaining`); assuming `vercel dev` reproduces the Fluid-Compute concurrency bug; using CF KV as a
  counter. (source: ecosystem-10 §avoid — all in [[echo KNOWN-PITFALLS]])

---

## The map in one screen (what a fresh echo session must be able to do)

1. **Place state correctly** — external store, never a shared/recycled process; in-memory only as a lossy cache
   over an authoritative store. (Job 1)
2. **Build a bypass-proof limiter** — key on identity not spoofable headers, atomic+shared counter, concurrency cap,
   chosen fail-open/closed, per-endpoint algorithm, backend spend cap. (Job 2)
3. **Cache without leaking or going stale** — per-tenant keys, centralized invalidation in the data layer,
   delete-don't-update + DB-first + double-delete, invalidate in `finally`, always-TTL+jitter, version-key LLM
   responses, SWR default, know Next.js `revalidateTag` is lazy. (Job 3)
4. **Tame both herds** — distributed single-flight (not in-process) for stampede, full-jitter backoff + retry
   budget + circuit breaker for retry storms, jitter every TTL, admission-control-first, and don't reflexively
   cache a fixable-slow origin. (Job 4)
5. **Make mutations exactly-once** — Stripe idempotency: required key, fingerprint→400, 24h TTL, atomic SET NX,
   fail-CLOSED, DB-unique backstop. (Job 5)
6. **Cost the design first** — count commands not requests, Regional not Global for write-heavy, fixed instance
   past the break-even. (Job 6)
7. **Migrate without silent fail-open** — never a limiter on CF Workers KV, runtime-change = client-change,
   cut-over not trickle. (Job 7)
8. **Operate it as an agent** — Upstash/Context7 MCP, `upstash`/`wrangler`/`redis-cli`, assert env at boot. (Job 8)

The five sibling artifacts go deeper: [[echo OPINIONS]] (the taste/anti-slop layer) · [[echo KNOWN-PITFALLS]]
(the mid-build gotcha table) · [[echo BATTLE-TESTED-SCENARIOS]] (the golden eval tasks) · [[echo TOOL-MATRIX]]
(default-vs-alt + secrets for Wave P) · [[echo GAPS-AND-DISPUTES]] (where echo must experiment, not assert).
