---
title: "echo FIELD — Cache Stampede / Thundering Herd: postmortems, mitigations, taste"
type: field-research
domain: caching
created: "2026-06-16"
researcher: FIELD-INTELLIGENCE (CP123 Wave-R)
currency: "June 2026 — prefers sources <6 months old; older sources flagged inline"
sources:
  - { url: "https://github.com/drizzle-team/drizzle-orm/issues/5841", date: "2026-06-01", author: "issue author + PR #5862", note: "single-flight dedup for $withCache — DIRECTLY echo-relevant" }
  - { url: "https://github.com/electric-sql/electric/issues/4266", date: "2026-05-04", author: "@alco (ElectricSQL maintainer)", note: "ShapeCache thundering-herd architecture breakdown" }
  - { url: "https://oneuptime.com/blog/post/2026-01-21-redis-cache-stampede/view", date: "2026-01-21", author: "OneUptime", note: "4 canonical mitigation patterns + formulas" }
  - { url: "https://blog.bytebytego.com/p/a-crash-course-in-caching-final-part", date: "2024-ish", author: "Alex Xu / ByteByteGo", note: "canonical caching reference (older, still trusted for fundamentals)" }
  - { url: "https://systemdr.substack.com/p/the-thundering-herd-problem-mitigation", date: "2026", author: "System Design Roadmap", note: "PAYWALLED — intro only; Shopify/AWS numbers NOT verifiable from this source (see GAP)" }
---

# Cache Stampede / Thundering Herd — what bites in production, and the taste to avoid it

> **The one-sentence definition (carry this).** A cache stampede (a.k.a. thundering herd, a.k.a. dog-piling) is
> when a hot key expires (or a cold cache starts empty) and N concurrent requests all miss, all fire the same
> expensive origin query *simultaneously*, and the origin (DB / upstream API) drowns under N identical
> redundant requests. The cache, meant to *protect* the origin, instead *concentrates* a synchronized spike
> onto it at the worst moment.

---

## 1. The drizzle-orm `$withCache` stampede (#5841) — the canonical echo case study

**Source:** https://github.com/drizzle-team/drizzle-orm/issues/5841 — opened 2026-06-01, PR #5862 exists.
This is the single most echo-relevant find in this research: a *production ORM's cache feature* shipping
without stampede protection, in June 2026.

**The exact problem, verbatim from the issue author:**

> "when two or more concurrent SELECTs share the same cache key and the cache is cold, every caller
> independently calls `cache.get`, sees `undefined`, and fires a separate DB query."

**The root cause — a "check-then-act" with no deduplication:**

```
if (fromCache === undefined) {
  result = await query();   // <-- every concurrent caller reaches here independently
  await this.cache.put(...);
  return result;
}
```

**The proof-of-concept output (this is what a stampede *looks like* in a test):**

```
DB calls fired: [ 'DB_CALL:concurrent-A', 'DB_CALL:concurrent-B' ]
STAMPEDE CONFIRMED: both concurrent SELECTs missed the cache and fired a duplicate DB query.
```

**The proposed fix — in-flight request deduplication (single-flight):**
> "Store `Promise<unknown>` objects indexed by cache key. When a cache miss occurs, check if a request is
> already in-flight; if in-flight, return the existing promise instead of firing a new query. Clean up the
> Map entry after completion."

### ⚠️ echo's CRITICAL annotation — the fix collides with REF-1/REF-2 (the Map bug class)

The drizzle fix uses **`Map<cacheKey, Promise>` at module/process scope** for in-flight tracking. That is
*correct for a single long-lived Node process* — but it is **the exact pattern the energy law bans on
serverless** (REF-1, `typescript.md` line 13) and that turbo P-02 (REF-2) escalated to "racy under Fluid
Compute." On Vercel/Lambda:
- **Cold-empty:** a fresh instance's in-flight Map is empty → no dedup → the stampede the fix was meant to
  prevent **still happens** across instances.
- **Warm-racy + multi-instance:** 250 concurrent requests on instance A dedup among themselves, but instance
  B, C, … each run their own stampede. With 50 warm instances you turn an N-request stampede into a
  50-request stampede — **better, but not single-flight.**

**The taste echo must teach:** *in-process single-flight only deduplicates within one process.* On a fleet
of serverless instances you need **distributed single-flight** — a shared lock in Redis/Upstash (SETNX) or a
`stale-while-revalidate` served from the shared cache. The drizzle fix is right for a stateful server (long-
running container, Fastify/Hono on a box, a Durable Object) and *insufficient* on per-request serverless.
This single distinction is echo's highest-leverage opinion.

---

## 2. ElectricSQL ShapeCache under thundering herd (#4266) — a real production breakdown

**Source:** https://github.com/electric-sql/electric/issues/4266 — opened 2026-05-04 by @alco (maintainer).
A rare *maintainer-authored* dissection of how a thundering herd actually melts a real system. Four distinct
bottlenecks, each a generalizable lesson:

1. **Pre-admission work saturates a pool before load-shedding can reject.** Electric does a SQLite read to
   resolve the shape *before* the admission-control gate. So under a herd, the read pool is exhausted by
   requests that would have been rejected anyway. **Lesson:** *admission control / rate limiting must run
   BEFORE any expensive work, not after.* (Directly echo: a rate limiter placed after the DB call protects
   nothing.)
2. **Serialization through a single mailbox:** "1000 requests for the same shape become 1000 sequential
   mailbox entries." Coalescing helped only for *identical* shapes. **Lesson:** dedup keyed too coarsely
   (or too finely) doesn't coalesce the traffic you actually have.
3. **Shared write-connection contention** between request setup and background flushing. **Lesson:** the
   resource you serialize on (a lock, a connection, a GenServer) becomes the new bottleneck — move
   contention off the hot path.
4. **Synchronous setup causes head-of-line blocking:** "any one slow shape setup" blocks unrelated requests.
   Formula given: `mailbox_growth_rate = incoming_rps − 1 / shape_setup_latency`. **Lesson:** when fill
   latency > inter-arrival time, the queue grows unboundedly — the mathematical signature of a stampede.

**Why coalescing alone was judged insufficient (verbatim framing):** existing coalescing "eliminates
redundant SQLite work but does *not* prevent redundant GenServer.call queuing, reduce pre-admission read
load, [or] prevent head-of-line blocking from slow shape setups." **echo takeaway:** single-flight is
necessary but not sufficient — you also need (a) admission control *first*, (b) backpressure/shedding when
the in-flight queue is deep, (c) isolation so one slow fill doesn't block all keys.

---

## 3. The four canonical mitigation patterns (OneUptime, 2026-01-21) — echo's pattern menu

**Source:** https://oneuptime.com/blog/post/2026-01-21-redis-cache-stampede/view (2026-01-21).

| # | Pattern | Mechanism | Tradeoff (verbatim/paraphrased) | echo verdict |
|---|---------|-----------|----------------------------------|--------------|
| 1 | **Distributed lock** (SETNX) | One request acquires `SET key val NX EX timeout`, fetches origin; others wait/poll. Release via **Lua script comparing a UUID** so you "release lock only if we own it (atomic)." | "Blocks waiting requests but guarantees single origin fetch per key." | The **serverless-safe single-flight** — this is the distributed version §1 demands. Mandatory Lua-guarded release. |
| 2 | **Probabilistic early expiration (XFetch)** | Refresh *before* expiry with rising probability: `P(refresh) = exp(-remaining / (beta * delta))`, delta = compute time. | "Spreads load smoothly but requires tracking computation time; more complex than locking." | Best for *predictable hot keys*; the math is the antidote to synchronized expiry. |
| 3 | **Single-flight / request coalescing** | In-memory: concurrent callers for one key share one fetch. | **"Efficient but requires in-memory call tracking; doesn't persist across instances."** | ⚠️ This is the drizzle fix. The "doesn't persist across instances" caveat IS the Map-bug class. In-process only. |
| 4 | **Stale-while-revalidate (SWR)** | Serve stale immediately, refresh in background. "Never blocks on cache misses for warm keys." | "Returns potentially outdated data but ensures availability." | The best *default* for read-heavy UIs — the user never waits on a fill. Pairs with HTTP `stale-while-revalidate`. |

**OneUptime's strong guidance (verbatim):** *"Layer your defenses: Use multiple strategies together"* rather
than relying on a single mechanism. Their production example "merges singleflight, probabilistic early
expiration, background refresh, and distributed locking as fallback."

**echo's synthesized recommendation (the taste):**
- **Default** to SWR + jittered TTL for read-heavy paths (cheap, no user-facing latency).
- Add **distributed lock (pattern 1)** for *expensive* fills where even a few duplicate origin calls hurt.
- Add **XFetch (pattern 2)** for a small set of known mega-hot keys with predictable cost.
- Treat **in-process single-flight (pattern 3)** as a *latency optimization within one instance*, never as
  your stampede defense on serverless.

---

## 4. The TTL-jitter pattern — the cheapest stampede fix nobody applies (GitHub field signal)

A cluster of June-2026 GitHub issues shows the *most common stampede root cause* is **synchronized expiry**:
many keys written at the same time (deploy, bulk import, cache warm) get the **same TTL** → they all expire
in the same second → simultaneous miss.

- `theplant/cachex#8` (2026-06-03): "**Add jitter to initial TTL to prevent cache stampede?**" — the fix is
  literally `ttl ± rand(jitter)` so keys expire spread across a window, not a spike.
- `igortsives/togetherly#103` (2026-05-16): "Limit + jitter first-tick thundering herd in source scheduler."
- `Nodus-protocol/...#46` (2026-06-11): "**No retry jitter** — synchronized retries cause thundering herd
  after outages."
- `Agent-Hellboy/mcp-runtime#304` (2026-06-10): "add jitter to policy reload ticker to prevent thundering
  herd."

**echo's taste:** *always jitter TTLs and retry backoffs.* A fixed TTL on a fleet of keys is a scheduled
stampede. A fixed retry interval after an outage is a synchronized re-stampede the moment the origin recovers
(this is the AWS-style retry-storm mechanism — see field-02). Cost: one line. This is the single highest
ROI/effort fix in the whole vertical, and the volume of 2026 issues filing it proves practitioners keep
forgetting it.

---

## 5. The historical anchors (well-known, cited with a currency caveat)

- **Shopify Black Friday 2019 product-recommendation cache stampede** (widely retold): a hot cache expired
  at ~2:47 AM; within ~3s, ~47,000 concurrent requests hit the primary DB regenerating the same value; DB
  CPU → 98%; p50 20ms → 4,500ms; ~8-minute outage, ~$10M lost sales. **CURRENCY CAVEAT:** this is repeated
  across multiple 2025-2026 blog posts (e.g. the systemdr piece) but I could **not** locate a Shopify
  first-party postmortem confirming these exact numbers — treat the numbers as *illustrative/secondhand*,
  the *mechanism* as canonical. (→ GAPS)
- **AWS US-East October 2025 outage** — cited as a case where "cascading failures combine with retry storms
  to amplify problems." The retry-storm-as-thundering-herd link is real and well-documented as a pattern;
  the specific Oct-2025 detail is covered in field-02 with a better source. (→ field-02)
- **ByteByteGo / Alex Xu "Crash Course in Caching"** remains the canonical *fundamentals* reference (older,
  ~2024) — trusted for the taxonomy (cache-aside, read-through, write-through, write-behind) but NOT current
  on serverless specifics. Use for vocabulary, not for 2026 platform behavior.

---

## 6. The synthesized stampede decision (what echo tells a builder)

1. **Is this serverless (per-request Lambda/Vercel)?** If yes, **in-process single-flight is a lie** — your
   defense MUST be in the shared store (distributed lock, or SWR served from shared cache). (REF-1/REF-2)
2. **Jitter every TTL and every retry backoff.** Non-negotiable, one line, prevents synchronized expiry and
   retry storms. (§4)
3. **Run admission control / rate limit BEFORE the expensive fill,** not after. (electric-sql §2 lesson 1)
4. **Default to SWR for read-heavy UI paths;** the user never waits on a regeneration. (§3 pattern 4)
5. **Add a distributed SETNX lock (Lua-guarded release) only for fills expensive enough that a handful of
   duplicates hurt.** Don't lock cheap fills — the lock becomes the bottleneck. (§3 pattern 1; electric §2
   lesson 3)
6. **XFetch (probabilistic early expiry) for the few known mega-hot keys.** (§3 pattern 2)
