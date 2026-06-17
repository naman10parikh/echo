# echo ECOSYSTEM-04 — the store layer: Redis / Upstash / serverless-KV (June 2026)

> The distributed store under every echo limiter/cache. Which store, why, cost, latency, the
> Valkey shift. Sources cited inline (Upstash's own benchmarks are vendor-biased — flagged).
> Retrieved 2026-06-16.

## The serverless-Redis landscape (2026)

### Upstash Redis — echo's default store
- **Why:** dual protocol — "supports both the Redis protocol AND HTTPS, so the same database
  works from Workers, Vercel, AWS Lambda, a Node server." The HTTP path is the ONLY way to talk
  to Redis from edge runtimes that can't open TCP sockets — this is why @upstash/ratelimit picks
  it. (source: upstash.com/blog/upstash-redis-vs-cloudflare-kv, 2026)
- **Pricing (2026):** "$0.20 per 100,000 commands (same price reads & writes) + $0.25 per
  GB-month storage. Free tier: 500K commands/month, 200GB/month bandwidth free." (source:
  upstash.com pricing via buildmvpfast.com/api-costs/cache, April 2026) — **per-command billing
  is the cost model echo must reason about** (every `limit()` = several commands).
- **Replication model:** "active replication — a write goes to the primary region and gets
  pushed to every read region, with every region holding the full dataset." (source:
  upstash.com/blog/upstash-redis-vs-cloudflare-kv) — this is why single-region multi-replica
  ≠ MultiRegionRatelimit (all writes still funnel to primary; see ecosystem-02 §4).
- **JS SDK** `@upstash/redis`: 950★, MIT, pushed 2026-06-11 (source: `gh api repos/upstash/redis-js`).

### Vercel KV — Upstash with Vercel billing
- "Vercel KV is **Upstash under the hood** with Vercel billing integration — same underlying
  technology and pricing." (source: buildmvpfast.com/compare, 2026) — so all echo advice about
  Upstash applies; the only delta is who invoices you and tighter Vercel-dashboard integration.
  (Note: Vercel KV has been transitioning to the Vercel Marketplace + Upstash-native over
  2025-26; verify current provisioning path.)

### Cloudflare KV — the wrong default for rate limiting
- **Pricing:** "$0.50/M reads, $5.00/M writes, $5.00/M deletes, $0.50/GB-month storage."
  Writes are **10× the read price** — terrible for rate limiting (which is write-heavy: every
  request increments). (source: buildmvpfast.com/api-costs/cache, 2026)
- **Latency/consistency:** "KV's heavy caching and **eventual consistency** hurt latency when
  you read shortly after a write … fast when the same key gets read a lot in the same region …
  slow on the first read in a region and a lot slower on writes." (source:
  upstash.com/blog/edgecaching-benchmark — VENDOR-BIASED, but the eventual-consistency point is
  architecturally true and independently documented by Cloudflare). **echo verdict:** Cloudflare
  KV is a **read-mostly edge cache**, NOT a rate-limit/counter store. For CF rate limiting use
  the native `ratelimit` binding (per-PoP) or a **Durable Object** (exact, strongly consistent).

### Valkey — the OSS Redis fork echo must now know
- Redis Inc. relicensed Redis (away from pure OSS) in 2024 → the community forked **Valkey**
  (Linux Foundation, BSD). "AWS ElastiCache added Valkey" (Oct 2024). It is now a first-class
  Redis-compatible target. (source: github.com/animir/node-rate-limiter-flexible/issues/290 +
  aws.amazon.com/about-aws/whats-new/2024/10/amazon-elasticache-valkey/)
- **echo relevance:** rate-limit libs are adding explicit Valkey support (`rate-limiter-flexible`
  issue #290, `rate-limit-redis` lists "Redis/Redict/Valkey"). When self-hosting the store,
  Valkey is the license-clean Redis. echo should treat "Redis" as "Redis/Valkey/Redict" — the
  protocol, not the trademark.

## Latency ranking (2026, from Upstash's benchmark — flagged vendor-biased)
"Benchmarks ranked **Upstash Redis first** and **Cloudflare Workers KV last** on global
latency." (source: upstash.com/blog/edgecaching-benchmark) — treat the *ordering* as plausible
(matches the architectural reasoning: active-replication full-dataset-per-region beats pull-based
central-store-with-edge-pull for write-then-read), but treat the *magnitudes* with suspicion
since Upstash authored it. **GAP: an independent third-party benchmark would strengthen this.**

## echo's store decision rule
1. Edge runtime (Workers/Vercel Edge) + need a counter → **Upstash Redis (HTTP)** via
   @upstash/ratelimit. Can't use TCP clients here.
2. Long-running Node server, latency-critical, want TCP pooling → **node-redis v4+ / ioredis to
   Upstash-over-Redis-protocol or self-hosted Valkey**, with `rate-limiter-flexible` (NOT
   @upstash/ratelimit — it's HTTP-only, issue #115).
3. Cloudflare-native, exact global limit → **Durable Object** (strongly consistent).
4. Cloudflare-native, simple per-PoP limit, lowest effort → native **`ratelimit` binding**.
5. Read-mostly edge cache of rendered data → **Cloudflare KV** (its sweet spot; NOT for counters).
6. Self-host the store → **Valkey** (license-clean Redis).
