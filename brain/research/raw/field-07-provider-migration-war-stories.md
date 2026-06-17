---
title: "echo FIELD — Provider migration war stories: Upstash ↔ Redis Cloud ↔ ElastiCache ↔ Cloudflare KV"
type: field-research
domain: caching / rate-limiting / infra
created: "2026-06-16"
researcher: FIELD-INTELLIGENCE (CP123 Wave-R)
currency: "June 2026 — Cloudflare-KV comparison 2026-05-27; alternatives page 2026-06-06"
sources:
  - { url: "https://upstash.com/blog/upstash-redis-vs-cloudflare-kv", date: "2026-05-27", author: "Upstash (note: vendor source, but cites Cloudflare's own docs for the damning numbers)", note: "KV unsuitable for rate limiting — hard numbers" }
  - { url: "https://www.buildmvpfast.com/alternatives/upstash", date: "2026-06-06", author: "BuildMVPFast", note: "migration steps + gotchas (HTTP vs TCP, command compat, Global=read-optimized)" }
  - { url: "https://trybuildpilot.com/588-upstash-vs-redis-cloud-vs-elasticache-2026", date: "2026", author: "BuildPilot", note: "3-way managed Redis comparison" }
  - { url: "https://www.13labs.au/compare/upstash-vs-redis-cloud", date: "2026", author: "13labs", note: "when-to-switch criteria (page 503'd on fetch — criteria via WebSearch synthesis → flagged)" }
  - { url: "https://johal.in/opinion-you-use-upstash-10-redis-72-serverless/", date: "2026", author: "johal.in", note: "opinion: Upstash 1.0 / Redis 7.2 for serverless rate limiting (title only — not fetched → GAP)" }
---

# Provider Migration — what breaks when you switch your cache/limit store

> **The thesis (carry this).** The serverless-Redis market in 2026 (Upstash, Vercel KV, Redis Cloud,
> ElastiCache, Cloudflare Workers KV, Momento, Valkey) looks interchangeable but is NOT — they differ on the
> two axes that break rate limiters and caches: **consistency model** and **per-key write throughput**. The
> most expensive migration mistake is moving a write-heavy limiter onto an eventually-consistent or
> per-key-throttled store (Cloudflare KV) and discovering it silently fails open. echo owns the "which store,
> and what breaks when you move" knowledge.

---

## 1. The migration that silently breaks your limiter: Redis → Cloudflare Workers KV

**Source:** upstash.com/blog/upstash-redis-vs-cloudflare-kv (2026-05-27, vendor-authored but citing
Cloudflare's *own* docs for the limits — the damning facts are Cloudflare's, not Upstash's spin). This is the
#1 "wrong tool" migration in echo's vertical because KV *looks* like a drop-in edge KV store and is
catastrophic for limiters/counters.

**The two killers (verbatim):**
- **Eventual consistency:** "Writes propagate across regions within **'up to 60 seconds'** per the official
  documentation… newly created keys may not appear in other regions for up to 60 seconds." "To get
  write-after-write consistency, the docs recommend routing writes through a Durable Object."
- **One write per second per key (verbatim):** "**1 write per second to the same key on every plan**" with
  "no documented mechanism to raise this per-key threshold."

**Why that destroys a rate limiter (verbatim):** KV is unsuitable for "**any rate limiter keyed on something
high-traffic like a user ID or IP because of the 1 write/sec per key limit.** … KV-based rate limiters work
when the key is a time bucket… and even then the data is up to 60 seconds out of date in other regions."
Also listed unsuitable: "Counters and view tallies, Session state that updates on every request, Live
leaderboards, Job queues, **Any write-heavy pattern with repeated mutations to the same key.**"

**The latency gap (verbatim benchmark):** KV write 171.8 ms p50 / 253.2 ms p99; Upstash Redis 6.2 ms p50 /
8.6 ms p99 — "approximately **28× faster.**" KV's read path is fast at the edge; its *write* path (the side a
limiter hammers) is slow and throttled.

**echo's taste:** **Cloudflare Workers KV is a read-mostly edge cache, NOT a counter/limiter store.** Use it
for config, feature flags, rarely-changing cached blobs at the edge. For a rate limiter or any per-request
counter on Cloudflare, the correct primitive is **Durable Objects** (single-threaded, strongly-consistent
per-object) or Upstash. Migrating a limiter Redis→KV is a silent fail-open: the limit "works" in one region,
lags 60s in others, and the 1-write/sec cap means a busy key just drops writes.

---

## 2. Upstash ↔ Redis Cloud ↔ ElastiCache — the when-to-switch decision

**Sources:** BuildMVPFast (2026-06-06) + 13labs (criteria via WebSearch synthesis; the page 503'd on direct
fetch — flagged secondhand). The recurring, cross-source decision criteria:

- **Stay on Upstash when** code is at the edge / multi-region / not in one VPC. Verbatim (WebSearch synthesis):
  "the moment your code is not in that VPC (edge, multi-cloud, browser, or just multi-region), **Upstash wins
  by being reachable at all.**" It scales to zero (pay nothing idle).
- **Switch to a fixed instance (Redis Cloud / ElastiCache) when** sustained volume is high. Verbatim: "For
  high-traffic apps (**100M+ commands/day**), instance-based pricing (Redis Cloud, ElastiCache) becomes more
  economical." (This is the field-03 break-even, stated by a third party.)
- **Switch to Redis Cloud for** full Redis modules — "RedisJSON, RediSearch, RedisTimeSeries" — which Upstash
  doesn't fully support.
- **Switch to ElastiCache when** you're "deeply invested in AWS and need native integration" (VPC, IAM,
  CloudWatch) and your code lives in-VPC (sub-0.5ms p50 vs Upstash's HTTP 1–5ms overhead).

**The latency framing (verbatim):** "If your code lives next to the cache in one AWS region, **ElastiCache
wins on raw latency**" (sub-0.5 ms p50 from us-east-1b); "the HTTP/REST API adds **1–5 ms latency** compared
to TCP connections."

---

## 3. What actually breaks in the migration (the mechanical gotchas)

From BuildMVPFast's migration section (2026-06-06), the concrete breakage points — each a real "it didn't just
work" moment:

1. **HTTP client vs TCP client.** Verbatim: "If migrating from a TCP-only client, switch to the Upstash HTTP
   client for edge/serverless compatibility." The reverse (Upstash→ElastiCache) means going from `@upstash/
   redis` (fetch-based) back to a TCP client (`ioredis`) — which **won't run in edge runtimes** (no TCP). A
   migration that changes the runtime target changes the client, not just the connection string.
2. **Command compatibility.** Verbatim: "Upstash Redis supports most standard Redis commands **but not all
   modules** (RedisSearch, RedisJSON, etc.). Check command compatibility before migrating." A cache/limiter
   using a module command silently has no equivalent.
3. **Global = read-optimized (write penalty).** Verbatim: "Upstash global replication is **read-optimized.
   Writes go to a primary region** and replicate to read replicas. Design your app accordingly." A
   write-heavy limiter on Global mode pays the multi-region write multiplier (field-03 §1) AND has write
   latency to the primary region from far edges.
4. **Pub/Sub → QStash for queues.** Verbatim: "If you currently use Redis Pub/Sub… for message queue patterns,
   consider QStash instead." Pub/Sub semantics don't survive a naive port.
5. **Data export/import.** "Export and import any persistent data… using RDB dump or SCAN-based migration."
   SCAN-based migration on a live, write-heavy cache races with ongoing writes — plan a cutover, not a
   trickle.
6. **Re-verify hit rate + latency post-cutover.** "Test your cache hit rates and latency. Upstash adds slight
   latency vs. in-VPC Redis due to HTTP overhead." A cache that was fast in-VPC may have a *worse* effective
   hit-value at the edge if each hit now costs an HTTP round trip.

---

## 4. The Valkey wildcard (2026 license-fork relevance)

Redis's license change (2024) spawned **Valkey** (the Linux Foundation OSS fork, now the default in many
distros and clouds). Per the Upstash "Redis vs Valkey 2026" comparison (in the search set), Valkey is now a
first-class managed option (AWS ElastiCache offers Valkey at a discount to Redis). **echo's note:** for a
*self-hosted or AWS-native* cache/limiter, Valkey is the cost-optimized Redis-compatible default in 2026; the
command surface a limiter/cache uses (INCR, EXPIRE, EVAL, sorted sets) is identical. This is a migration
*opportunity* (cheaper) rather than a breakage — but verify Lua/module parity. (Date: 2026; treated as
context, not a deep-dive — → light coverage, see GAP.)

---

## 5. echo's migration decision (the one-screen answer)

1. **Never put a rate limiter or per-request counter on Cloudflare Workers KV** (1 write/sec/key + up to 60s
   eventual consistency = silent fail-open). Use Durable Objects or Upstash for counters at the edge;
   reserve KV for read-mostly edge config/blobs. (§1)
2. **Upstash/Vercel KV for edge/serverless/bursty; switch to a fixed instance (Redis Cloud/ElastiCache/
   Valkey) past ~100M commands/day** or when you need Redis modules / in-VPC sub-ms latency. (§2)
3. **A migration that changes the runtime target changes the client** (HTTP↔TCP) — not just the connection
   string; budget for it. (§3.1)
4. **Keep write-heavy limiters Regional, not Global** — Global multiplies the expensive (write) side. (§3.3)
5. **Cut over, don't trickle** a write-heavy store (SCAN migration races live writes). (§3.5)
6. **Valkey is the 2026 cost-default for self-hosted/AWS Redis-compatible** — same limiter/cache command
   surface; verify Lua/module parity. (§4)
