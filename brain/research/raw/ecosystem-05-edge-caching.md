# echo ECOSYSTEM-05 — edge caching, stale-while-revalidate, invalidation (June 2026)

> The caching half of echo. Covers Vercel Data Cache / Next.js `use cache` + `revalidateTag`,
> Cloudflare cache, SWR semantics, and the invalidation traps. Sources cited inline, ≤6mo where
> possible. Retrieved 2026-06-16.

## stale-while-revalidate (SWR) — the load-bearing pattern echo must own

SWR (HTTP `Cache-Control: stale-while-revalidate=<sec>`, RFC 5861) = **serve the stale copy
instantly, refetch fresh in the background.** It trades a small window of staleness for zero
user-facing latency on cache refresh. It is the default revalidation semantic in modern
Next.js/Vercel and the right mental model for almost all read-heavy caches.

## Vercel Data Cache / Next.js `revalidateTag` — and its sharp edges (2026)

`revalidateTag(tag)` invalidates tagged cache entries on-demand. **But the behavior is LAZY,
and that surprises everyone:**

> "With `profile='max'` (recommended), the tag entry is marked as **stale**, and the next time
> a resource with that tag is visited, it uses **stale-while-revalidate** … calling
> `revalidateTag` will **not immediately trigger many revalidations at once** — the invalidation
> only happens when any page using that tag is next visited … `revalidateTag` does **not delete
> the cached response immediately**; it turns it stale, and the next request to any page using
> that tag will refetch and overwrite the cache, while **until then, users still get the
> previous response.**" (source: nextjs.org/docs/app/api-reference/functions/revalidateTag +
> nextjs.org/docs/app/getting-started/revalidating, 2026-06)

### The real-world breakage (high-engagement discussions)
- **vercel/next.js Discussion #56822** — "Inconsistent caching with `revalidateTag()` and Vercel
  Data Cache": "in some instances — but not all, despite no code changes — content is not
  properly invalidated: stale content appears on the page." (source:
  github.com/vercel/next.js/discussions/56822) — the canonical "why is my cache still stale"
  thread; it's the lazy SWR semantics colliding with user expectation of immediate purge.
- **vercel/next.js Discussion #91785** — Next.js 16 `use cache` + `revalidateTag` "FETCH POSTS
  logs immediately after revalidation, and Link navigation shows inconsistent stale data."
  (source: github.com/vercel/next.js/discussions/91785, 2026) — newest-gen breakage; the
  client-side router cache and the server data cache can disagree.
- **`updateTag` vs `revalidateTag`** (Discussion #84805) — a newer `updateTag` API exists with
  different (more eager) semantics; echo must know which one a user actually wants. (source:
  github.com/vercel/next.js/discussions/84805)

### echo's taste on Next.js caching
1. **`revalidateTag` is eventual, not immediate.** If a user MUST see fresh data the instant
   after a mutation (e.g. their own just-edited profile), tag invalidation alone is insufficient
   — combine with a router refresh / read-your-writes path, or accept the stale window.
2. **The two-cache problem.** Next.js has a *server* Data Cache AND a *client* Router Cache. A
   server-side `revalidateTag` does not necessarily purge the client router cache → "I revalidated
   but the user still sees old data on back-navigation." This is the #1 confusion source.
3. **Tag cardinality.** One over-broad tag on everything = every mutation invalidates the world
   (stampede on next visit). Too-granular tags = you forget to invalidate something. Tag design
   is the cache-invalidation problem in disguise.

## Cloudflare caching (the edge layer)
- **Cache API + `caches.default`** in Workers for programmatic edge caching; **Cache Reserve**
  for longer persistence; **Tiered Cache** to reduce origin load. (source:
  developers.cloudflare.com/cache/, 2026-06)
- **Cache tags / purge by tag** is an **Enterprise** feature on Cloudflare — not available on
  lower plans, unlike Vercel's per-deployment tags. echo must flag this paywall when advising
  Cloudflare-based invalidation. (source: developers.cloudflare.com/cache/how-to/purge-cache/, 2026)
- **Durable Objects** double as a **strongly-consistent cache** when you need read-your-writes
  at the edge (a single logical instance, no eventual-consistency window) — the escape hatch
  when SWR's staleness is unacceptable. (source:
  developers.cloudflare.com/durable-objects/, 2026)

### Cloudflare Workers `ratelimit` binding — authoritative behavior (verbatim, 2026-06)
From the official bindings doc (firecrawl-scraped 2026-06-16):
- **Per-PoP, NOT global (CONFIRMED verbatim):** "Rate limits that you define and enforce in your
  Worker are **local to the Cloudflare location** that your Worker runs in … For each unique key
  you pass to your rate limiting binding, there is a **unique limit per Cloudflare location**."
  (source: developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/#locality)
- **Permissive / eventually consistent (CONFIRMED verbatim):** "the Rate Limiting API is
  **permissive, eventually consistent, and intentionally designed to NOT be used as an accurate
  accounting system** … the isolate that serves each request will check against its locally
  cached value … Very quickly, but not immediately, these requests will count toward the rate
  limit within that Cloudflare location." (source: same, #accuracy) → **echo: never use the CF
  binding for billing/hard-quota; use a Durable Object for exact counting.**
- **Zero added latency:** "The underlying counters are cached on the same machine … updated
  asynchronously … You are NOT waiting on a network request." (source: same, #performance)
- **`period` ∈ {10, 60} seconds ONLY**, `simple: {limit, period}`, configured in
  `wrangler.toml [[ratelimits]]`; call `env.MY_RATE_LIMITER.limit({key})` → `{success}`.
  (source: same, #configuration)
- **Cloudflare itself says DON'T key on IP** (mirrors the express-rate-limit #234 bypass bug):
  "It is **not recommended to use IP addresses or locations** … these can be shared by many
  users … Good choices: API keys in Authorization headers, URL paths/routes, user IDs and tenant
  IDs — stable identifiers unlikely to change request-to-request." (source: same, #best-practices)
  → independent corroboration of echo's key-stability law.
- **Hono middleware that serves the turbo+echo seam directly:**
  `@elithrar/workers-hono-rate-limit`, `@hono-rate-limiter/cloudflare` (multi-store),
  `hono-cf-rate-limit` — drop-in rate-limit middleware for Hono (turbo's framework) on Workers.
  (source: same, #examples)

## The two hard problems of caching (Phil Karlton's law), echo's framing
> "There are only two hard things in computer science: cache invalidation and naming things."
echo owns the first. The taxonomy echo must teach:
1. **TTL (time-based)** — simplest; cache is wrong for up to TTL seconds. Pair with SWR to hide
   refresh latency. Default for data where bounded staleness is fine.
2. **Tag/key-based purge (event-based)** — invalidate on write. Correct but requires you to
   enumerate every tag a mutation touches (the hard part). Lazy on Vercel, Enterprise-only on
   Cloudflare.
3. **Write-through / read-your-writes** — update cache atomically with the store, or route the
   writer's own reads to origin. The only way to guarantee a user sees their own write instantly.
   Use a Durable Object or skip-cache-for-author.
4. **Stampede protection** — when a hot key expires, N concurrent requests all miss and hammer
   origin ("thundering herd / cache stampede"). Fixes: SWR (serve stale during refetch),
   request coalescing / single-flight (one refetch, others wait), early/probabilistic
   expiration. echo MUST pair any TTL cache on a hot key with stampede protection.

## In-memory vs distributed (the echo dividing line — ties back to the turbo boundary)
- **In-memory (per-instance Map/LRU):** fastest, zero network, BUT (a) empty on cold start,
  (b) **shared & raced across concurrent requests under Vercel Fluid Compute** (the turbo S-01
  bug), (c) inconsistent across instances. **Only safe as a lossy optimization cache over an
  authoritative external store** (exactly the @upstash/ratelimit `ephemeralCache` pattern) —
  never as the source of truth. (cross-ref: ecosystem-00 boundary, ecosystem-02 §1)
- **Distributed (Redis/Upstash/KV/DO):** survives cold starts, consistent across instances,
  the only correct home for cross-request state. Costs a network RTT (HTTP for edge). This is
  echo's default for anything that must be correct.
- **echo's law (the synthesis of the energy `new Map()` rule + Upstash's `ephemeralCache`):**
  *Authoritative state → distributed store, always. In-memory is permitted only as a
  short-circuit cache that stays correct when empty or stale.*
