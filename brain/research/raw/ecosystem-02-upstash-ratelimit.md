# echo ECOSYSTEM-02 — @upstash/ratelimit deep-dive (the canonical serverless limiter)

> Why this is echo's flagship tool: it is the default rate limiter for the exact platform echo
> defends (Vercel/serverless/edge), uses HTTP-based Redis (works where TCP doesn't — edge
> runtimes), and is Lua-atomic. v2.0.8 (2026-01-12), 2,038★, MIT.
> Primary source: official docs (firecrawl-scraped 2026-06-16) + GitHub issues.

## The load-bearing operational flows (echo must know these cold)

### Construction + the four algorithms
```ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "10 s"), // or fixedWindow / tokenBucket
  analytics: true,
  prefix: "ratelimit:free",                       // namespacing for multiple limiters
});
const { success, limit, remaining, reset, pending, reason } = await ratelimit.limit(id);
```
(source: upstash.com/docs/redis/sdks/ratelimit-ts/features + /algorithms, 2026-06)

### 1. Ephemeral cache — THE one legitimate module-scope Map (echo MUST teach this distinction)
> "For extreme load or denial of service attacks, it might be too expensive to call redis for
> every incoming request, just to find out it should be blocked … You can use an ephemeral in
> memory cache by passing some variable of type `Map<string, number>` as the `ephemeralCache`
> option … **The cache must be outside of your serverless function handler.** … When a request
> is received with some identifier before its reset time, the request will be denied without
> having to call Redis. `reason` field will be `cacheBlock`." (source: .../features, 2026-06)
```ts
const cache = new Map(); // MUST be outside the handler (module scope)
const ratelimit = new Ratelimit({ /* ... */ ephemeralCache: cache });
```
- **echo's nuance — this is the exception to the energy `new Map()` law, and echo owns the
  distinction:** A module-scope `Map` used as a *correctness store* (the value IS the source of
  truth) is FORBIDDEN (cross-user bleed, lost on cold start). A module-scope `Map` used as an
  *optimization cache over an external source of truth* (Redis) is FINE — and is exactly what
  Upstash recommends. The difference: if this Map is empty (cold start) or stale (different
  instance), correctness is preserved because Redis is still consulted; the Map only short-
  circuits *already-known-blocked* identifiers. **echo's law: module-scope Map is OK iff it is a
  lossy cache over an authoritative external store, never the store itself.** Default is on
  (`new Map()` auto-created); disable with `ephemeralCache: false`.
- Typo gotcha (issue #14, FIXED): the option was once exported as `ephermeralCache` (misspelled).
  On old versions this silently no-ops the cache. (source: github.com/upstash/ratelimit-js/issues/14)

### 2. Timeout — the fail-OPEN switch (a deliberate availability/security tradeoff echo must surface)
> "an optional timeout in milliseconds, after which the request will be **allowed to pass
> regardless of what the current limit is** … useful if you don't want network issues to cause
> your application to reject requests. Default value of the timeout is **5 seconds**." `reason`
> shows `timeout` when this fires. (source: .../features, 2026-06)
- **echo taste:** `timeout` makes the limiter **fail-open**. Correct for most product APIs
  (don't 429 a paying user because Redis blipped). **WRONG for security-critical limits** (login
  brute-force, payment endpoints) where you want fail-CLOSED — there, set a very low timeout and
  treat a thrown error as "deny." echo must always ask: "fail-open or fail-closed?" and the
  default 5s fail-open is a footgun for abuse-prevention use cases.

### 3. Analytics + the `pending` dangling-promise trap (edge-runtime correctness)
> "If you are using rate limiting in Cloudflare Workers, Vercel Edge or a similar environment,
> you need to make sure that the analytics request is delivered correctly … Otherwise you may
> observe lower numbers than the actual number of calls. To make sure that the request
> completes, you can use the `pending` field." (source: .../features, 2026-06)
```ts
const { pending } = await ratelimit.limit("id");
context.waitUntil(pending); // Cloudflare/Vercel: settle the dangling promise
```
- **echo taste:** on edge runtimes, **always `waitUntil(pending)`** when analytics OR
  multi-region is on. Forgetting it = silently-dropped writes (undercounted analytics, un-
  replicated multi-region state). This is the #1 silent edge bug with this library.

### 4. Multi-region (CRDT) — the "small-margin overshoot" honesty
> "`MultiRegionRatelimit` … checks the current limit in the closest db and returns immediately.
> Only afterwards will the state be asynchronously replicated to the other databases leveraging
> CRDTs … there is no way to guarantee the set ratelimit is not exceeded by a small margin.
> This is the tradeoff for reduced global latency." (source: .../features, 2026-06)
- **echo taste:** multi-region trades **exactness for latency**. If you need an EXACT global
  cap (billing, hard quota), multi-region is wrong — use single-region (everyone pays the RTT to
  one db) or a Cloudflare Durable Object (single logical instance = exact). Also: sliding-window
  + multi-region = "large number of commands … long request processing times" (Upstash's own
  warning) → use fixed-window in multi-region; token bucket is unsupported there entirely.

### 5. Dynamic limits (the 2026 headline, v2.0.8) — change limits without redeploy
```ts
const ratelimit = new Ratelimit({ /* ... */ dynamicLimits: true });
await ratelimit.setDynamicLimit({ limit: 5 });   // global, stored in Redis
const currentLimit = await ratelimit.getDynamicLimit();
await ratelimit.setDynamicLimit({ limit: false }); // revert to default
```
> "Dynamic limits work with single region `fixedWindow`, `slidingWindow`, `tokenBucket`. Multi
> region algorithms aren't supported." (source: .../features, 2026-06)
- **echo taste:** the right tool for "we're under attack, halve the limit NOW" or per-tier
  changes without a deploy. Replaces the old anti-pattern of baking the number into code.

### 6. Custom rates (variable cost) + multiple limiters per tier
```ts
await ratelimit.limit("id", { rate: batchSize }); // subtract N instead of 1
```
Multiple limiters via distinct `prefix` (free vs paid). (source: .../features, 2026-06)
- Note: issue #58 ("dynamic token cost on tokenBucket") was the request that this `rate` param
  answers — variable per-request cost is now first-class. (source: issues/58)

## The other Upstash store: @upstash/redis (the HTTP-Redis SDK)
- Why it exists: edge runtimes (Cloudflare Workers, Vercel Edge) **cannot open raw TCP sockets**,
  so a normal Redis client (ioredis/node-redis) won't run there. `@upstash/redis` speaks Redis
  over **HTTP/REST**, so it works everywhere a `fetch` exists. This is *the* reason
  @upstash/ratelimit is the serverless default. (source: github.com/upstash/redis README, 2026)
- **The ioredis incompatibility (open issue #115, 13 comments):** users want to use ioredis
  (raw TCP, no HTTP overhead) as the store to cut latency, but @upstash/ratelimit only accepts
  the @upstash/redis HTTP client. Still OPEN as of 2026-06 — a real, unresolved limitation echo
  must flag: **on long-running Node servers (not edge), the HTTP-Redis hop adds latency vs a
  pooled TCP client; you can't swap in ioredis with this library.** (source:
  github.com/upstash/ratelimit-js/issues/115)

## Pricing/cost shape an agent must internalize
- Upstash Redis bills **per-command** (request-based) on the free/pay-as-you-go tiers. Every
  `limit()` call is multiple Redis commands (more for sliding window, +1 for analytics, ×N for
  multi-region). The `ephemeralCache` exists specifically to cut command count under attack
  ("too expensive to call redis for every incoming request"). echo must reason about
  commands-per-request, not just requests. (source: .../features caching section + costs page ref)
