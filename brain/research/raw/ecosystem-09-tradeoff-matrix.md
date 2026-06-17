# echo ECOSYSTEM-09 — competing tools: the honest trade-off matrix (June 2026)

> Not a feature list — a "when does each one actually win / lose" matrix with the failure modes.
> Stars/dates from `gh api` 2026-06-16; behavior from docs + high-engagement issues.

## Rate-limiting libraries (TS/JS ecosystem)

| Tool | Stars | License | Store(s) | Algorithms | Runtime fit | The honest take |
|---|---|---|---|---|---|---|
| **@upstash/ratelimit** | 2,038 | MIT | Upstash **HTTP-Redis only** | fixed / sliding / token-bucket; +dynamic, +ephemeralCache, +multi-region CRDT | **Edge + serverless (best)**; long-Node = HTTP-hop overhead | The serverless default. Loses when you need TCP-Redis (issue #115), concurrency limiting (#71), or exact global cap (multi-region overshoots). Slow release cadence = stable but can lag platform reality (Fluid Compute). |
| **rate-limiter-flexible** (animir) | 3,558 | ISC | **everything**: Redis/ioredis/node-redis, Valkey, Mongo, Postgres, MySQL, Memcached, in-memory, cluster | token-bucket-ish (atomic INCR), + **RateLimiterConcurrency**, in-memory block, insurance-limiter fallback | **Long-running Node (best)**; NOT edge (needs TCP client) | The swiss-army knife. Wins on backend flexibility + has concurrency limiting + a fail-over "insurance" limiter. Loses at the edge (no HTTP-Redis-first story like Upstash). Most-starred pure limiter. |
| **express-rate-limit** | 3,263 | MIT-ish | pluggable via `rate-limit-redis` (Redis/Redict/Valkey), memory, others | fixed window (counter) | Express/Node only | Simplest, ubiquitous middleware. **Default store is in-memory = per-instance = WRONG for multi-instance/serverless** (must add `rate-limit-redis`). Has the famous **proxy-bypass bug** (issue #234, below). v8 dropped Node<16 + changed store API. |
| **Cloudflare Workers `ratelimit` binding** | n/a (platform) | n/a | platform-managed | sliding window | Cloudflare Workers only | GA Sept-2025, zero-dep, fastest. BUT **per-PoP not global** (a determined attacker spread across PoPs gets N×limit), period ∈ {10,60}s only. Use a Durable Object for exact global. |
| **Cloudflare Durable Object limiter** | n/a | n/a | DO storage (SQLite-backed, GA 2026) | you implement (any) | Cloudflare only | The ONLY exact, strongly-consistent global edge limiter. Cost/complexity higher; one DO can be a hot-spot. The right tool when overshoot is unacceptable. |
| **unkey** | 5,339 | source-available | hosted platform | sliding/fixed + API-key mgmt | any (API call) | Not a library — a **platform** (API keys + rate limits + analytics + usage billing). Wins when you want managed API-key auth + limits together; loses if you want a zero-dependency in-process limiter or to avoid a vendor. Most-starred in this list. |
| **GCRA (redis-gcra / throttled)** | 52 / — | MIT | Redis/Valkey Lua | GCRA only | any with Redis | Most memory-efficient (1 TAT/key) + burst-correct, no drip process. Loses on ergonomics — you wire the Lua yourself; no batteries (analytics/multi-region). Expert escalation. |

### The express-rate-limit proxy-bypass bug (a security finding echo MUST teach)
> Issue #234 (CLOSED, +4, **14 comments**): "rate limiter can be **bypassed easily if behind a
> reverse proxy that includes port numbers in 'X-Forwarded-For'** header." (source:
> github.com/express-rate-limit/express-rate-limit/issues/234)
- **Root cause:** the limiter keys on client IP, but extracts it naively from `X-Forwarded-For`.
  If the proxy appends `:port` (which varies per connection) the "IP" is unique every request →
  every request is its own bucket → **limit bypassed entirely.** Generalizes: **wrong key
  extraction = silent total bypass.** echo's law: the rate-limit key must be the *stable client
  identity* (validated `trust proxy` + correct XFF parsing, or authenticated userId/apiKey), never
  a raw header an attacker controls. This is the #1 rate-limiter security bug in the wild.

### Other express-rate-limit signal (issues, by reactions)
- #168 (+8, 12c) "Support the new RateLimit standardization proposal" — the IETF `RateLimit`
  header draft; everyone converging on standard headers.
- #32 (+5, 10c) "X-RateLimit-Reset header" — exposing reset time is a perennial ask (mirrors
  Upstash #59).
- #533/#624 "depends on vulnerable versions of `ip`/`ip-address`" — **supply-chain reminder**:
  even tiny limiter deps pull CVEs; echo must pin + audit. (source: `gh api .../issues?sort=reactions`)

### rate-limiter-flexible signal (issues, by reactions)
- #176 (+8, 13c) "add support for redis v4" → shipped `RateLimiterRedisNext` (node-redis v4-only
  class) — the migration story; old `RateLimiterRedis` vs new `RateLimiterRedisNext`. echo must
  know which class for which client version. (source: github.com/animir/.../issues/176)
- #290 (+3, 13c) "Support Valkey" + #287 "Support SQLite" — the backend-breadth requests that
  define its niche. (source: issues/290, 287)
- #103 (+3) "RateLimiterMongo: option not to create indexes (a must for serverless)" — even the
  flexible lib has serverless footguns (auto-index-creation on cold start). (source: issues/103)

## Caching/store layer (the other axis)

| Store | Best for | Avoid for | Cost shape | Consistency |
|---|---|---|---|---|
| **Upstash Redis** | edge + serverless counters/cache; the rate-limit default | nothing major (HTTP hop on long-Node) | $0.20/100K cmds, reads=writes | strong (single region); CRDT eventual (multi-region) |
| **Vercel KV** | same as Upstash (it IS Upstash) + Vercel billing | — | = Upstash | = Upstash |
| **Cloudflare KV** | read-mostly edge cache of rendered data | **counters / rate limits** (10× write cost, eventual) | $0.50/M read, **$5/M write** | eventual |
| **Cloudflare Durable Objects** | exact global counters, read-your-writes edge cache | high-cardinality cheap caching | per-request + storage | **strong** |
| **node-redis / ioredis → Redis/Valkey** | long-running Node, lowest latency (TCP pool) | edge (no TCP) | self-host or managed | strong |
| **In-memory (Map/LRU)** | lossy cache OVER an external truth (e.g. ephemeralCache) | **any authoritative cross-request state** | free | none (per-instance, racy under Fluid Compute) |

## The one-paragraph synthesis (echo's default stack)
**Edge/serverless (the energy default host): `@upstash/ratelimit` (sliding window) on Upstash
Redis (HTTP), `ephemeralCache` on, `waitUntil(pending)` for analytics, `timeout` tuned per
fail-open/closed need, `dynamicLimits` for runtime control.** Long-running Node:
`rate-limiter-flexible` on ioredis/node-redis → Redis/Valkey (TCP). Exact global at the edge:
Cloudflare Durable Object. Custom memory-critical: GCRA Lua. Cloudflare KV is a read cache, never
a counter. In-memory is only ever a lossy short-circuit over a distributed source of truth — the
echo law that ties the whole domain back to the turbo `new Map()` boundary.
