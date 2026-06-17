---
title: "echo TOOL-MATRIX — Canonical Tools, Defaults vs Alts, Agent-Access Surface, Required Secrets"
type: synthesis
created: "2026-06-16"
updated: "2026-06-16"
tags: [tool-matrix, defaults, cli, api, mcp, secrets, env-vars, versions, rate-limiting, caching, redis, upstash, cloudflare]
synthesist: SYNTHESIS / taste-node (CP123 Wave-R)
sources: ["brain/research/raw/ecosystem-01,02,03,04,05,06,07,09,10.md", "brain/research/raw/field-03,07.md"]
summary: "The canonical tool table for echo: per decision, the DEFAULT vs the ALT, when-to-use-which, the AGENT-ACCESS surface (CLI flags / API / MCP), the pinned VERSION (gh-API-authoritative, 2026-06-16), and the ENV VARS / SECRETS each needs. The secrets column feeds the Wave-P Required-Secrets manifest — every secret here is a candidate row for echo's .env.example (which currently lacks the Upstash/Cloudflare vars this domain requires)."
related: ["[[echo EXPERTISE-MAP]]", "[[echo OPINIONS]]", "[[echo KNOWN-PITFALLS]]", "[[echo BATTLE-TESTED-SCENARIOS]]"]
---

# echo TOOL-MATRIX

> **How to use.** Each section = one decision echo's build waves make. **Bold row = default**; the alt rows name the
> exact condition to switch. The **Agent-access** column is what makes the tool *operable by a coding agent* (prefer
> JSON output + non-interactive flags). The **Secrets/env** column is load-bearing for **Wave P**: it's the source
> list for the Required-Secrets manifest. Versions are gh-API-authoritative as of **2026-06-16** (the researcher
> flagged that WebFetch mis-dated GitHub release pages — `gh api published_at` was used to correct them; re-verify
> in the RSI loop with `gh api repos/<o>/<r>/releases` + `npm view <pkg> version`).
>
> **The currency caveat carried from research:** `@upstash/ratelimit` is *mature and barely-changing* — ONE release
> in the 6 months before June 2026 (v2.0.8). The risk is **staleness-vs-platform-reality** (the API predates Fluid
> Compute concurrency), not churn. (source: ecosystem-01)

---

## §1 — The rate limiter (the flagship decision)

| Decision | Tool | Version | When to use | Agent-access | Secrets/env |
|---|---|---|---|---|---|
| **Edge + serverless limiter (DEFAULT)** | **`@upstash/ratelimit`** + `@upstash/redis` | **2.0.8** (2026-01-12, MIT, 2,038★) · redis 1.35.x | The energy-default host (Vercel/serverless/edge). HTTP-Redis works where TCP doesn't. Lua-atomic. | npm SDK; `new Ratelimit({redis, limiter, analytics, prefix, timeout, ephemeralCache, dynamicLimits})` → `.limit(id,{rate})`, `.getRemaining(id)`, `.resetUsedTokens(id)`, `.setDynamicLimit({limit})` | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (for `Redis.fromEnv()`) |
| Long-running Node, TCP pooling, OR need concurrency limiting | `rate-limiter-flexible` (animir) | 5.x (ISC, 3,558★) | Persistent Node server where the HTTP-hop is pure overhead; multi-backend (Redis/ioredis/node-redis/Valkey/Mongo/Postgres/MySQL/Memcached/in-memory); **has `RateLimiterConcurrency`** + insurance-limiter fallback | npm SDK; `RateLimiterRedis` (legacy clients) vs **`RateLimiterRedisNext`** (node-redis v4) — pick by client version (issue #176) | depends on store (Redis URL / connection opts) |
| Express/Node middleware, simplest | `express-rate-limit` + `rate-limit-redis` | 8.x (MIT, ~3.1k) · store 4.x (2026-06-14) | Express apps. **Default store is in-memory = per-instance = WRONG for multi-instance/serverless — MUST add `rate-limit-redis`.** v8 dropped Node<16 + changed store API (`increment` return shape). Famous proxy-bypass (#234). | npm middleware | store: Redis URL / connection opts |
| Cloudflare edge, simple per-PoP throttle, zero-dep | CF Workers `ratelimit` binding | GA 2025-09-19 (platform) | Lowest-effort CF throttle. **Per-PoP NOT global; eventually consistent; "NOT an accurate accounting system"; `period ∈ {10,60}s` only.** | `wrangler.toml [[unsafe.bindings]] ratelimit` `simple={limit,period}`; `env.MY_RATE_LIMITER.limit({key})` → `{success}` | none (platform binding); `CLOUDFLARE_API_TOKEN` for `wrangler` deploy |
| Cloudflare edge, **exact global** limit | CF **Durable Object** (you implement the limiter) | DO GA; SQLite-backed GA 2026 | The ONLY exact, strongly-consistent global edge limiter. One DO = single logical instance aggregating across PoPs. Higher cost/complexity; one DO can hot-spot. | DO class w/ in-DO counter; `env.NS.idFromName(key)` → `stub.fetch()` | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (wrangler) |
| Custom GCRA, memory-critical, huge key cardinality | `Losant/redis-gcra` (Lua) | 52★ (2026-02-13, MIT) | One TAT/key, atomic single-op, **no drip worker** — the connoisseur's multi-region pick. NOT in @upstash/ratelimit. | Redis `EVAL` of the Lua; or port `throttled/throttled` (Go) | Redis URL (any Redis/Valkey) |
| Managed API-keys + limits + usage billing together | `unkey` | 5,339★ (source-available) | A *platform*, not a library — when you want managed API-key auth + limits + analytics + usage billing in one. | API call to Unkey | `UNKEY_ROOT_KEY` (+ Unkey account) |

**Algorithm selection (the per-endpoint knob inside the limiter):**

| Algorithm | API (Upstash) | Upstash cmds/req | Burst behavior | Use when | Never |
|---|---|---|---|---|---|
| **Sliding window (DEFAULT for HTTP throttle)** | `Ratelimit.slidingWindow(n, "10 s")` | **4** (`EVAL,GET,GET,INCR`) | smooths boundary; approx (uniform prior-window) | general single-region HTTP throttling | — |
| **Token bucket (DEFAULT for bursty APIs — Arcjet's "strongest default")** | `Ratelimit.tokenBucket(refill, "10 s", max)` | **4** (`EVAL,HMGET,HSET,PEXPIRE`) | intentional burst + constant drain ("API credits") | bursty real traffic (batch, app launch, retries) | **multi-region (unsupported)** |
| Fixed window | `Ratelimit.fixedWindow(n, "10 s")` | **2** (`EVAL,INCR`) — cheapest | 2× burst at boundary | coarse internal quotas; cost-sensitive paths | **auth/login (boundary brute-force)** |
| GCRA | (custom Lua, not Upstash) | n/a | dual-rate, no drip worker | multi-region, memory-critical, abuse-sensitive | when you don't control the Redis Lua |

> Cost/region adders: analytics **+1**, deny-list **+2**, dynamic limits **+1**; Global **×(1+readRegions)** on the
> write side. **Count commands, not requests** (O-19). Algorithm choice is a *cost* decision too. (source: field-03 §1)

---

## §2 — The store layer (where the counter/cache lives)

| Store | Best for | Avoid for | Cost shape (2026) | Consistency | Secrets/env |
|---|---|---|---|---|---|
| **Upstash Redis (DEFAULT)** | edge + serverless counters/cache; the rate-limit default; scales to zero | nothing major (HTTP hop ~1–5ms/cmd on long-Node) | **$0.20/100K cmds** (reads=writes) + $0.25/GB-mo; 500K free/mo | strong (single region); **CRDT eventual (multi-region)** | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`; Upstash API token for provisioning |
| Vercel KV | same as Upstash (it **IS** Upstash) + Vercel billing/dashboard | — | **2× Upstash** ($0.40/100K) | = Upstash | Vercel-provisioned KV env (verify post-Marketplace path — GAP G-7) |
| **Cloudflare Workers KV** | **read-mostly** edge cache of rendered data/config/flags | **counters / rate limits / sessions / leaderboards** | $0.50/M read, **$5/M write (10×)**, $0.50/GB-mo | **eventual (up to 60s); 1 write/sec/key** | `CLOUDFLARE_API_TOKEN` (wrangler) |
| **Cloudflare Durable Objects** | **exact global counters**, read-your-writes edge cache | high-cardinality cheap caching (one DO can hot-spot) | per-request + storage (SQLite-backed cheaper) | **strong** (single logical instance) | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| node-redis / ioredis → Redis/Valkey | long-running Node, lowest latency (TCP pool; sub-0.5ms in-VPC) | **edge (no raw TCP sockets)** | self-host or managed flat fee | strong | `REDIS_URL` (TCP); TLS/auth per provider |
| Redis Cloud / ElastiCache (Valkey) | high sustained volume (>~100M cmds/day); Redis modules; in-VPC | bursty/scale-to-zero workloads (flat fee wastes idle) | flat instance fee | strong | provider creds (`REDIS_URL` / AWS IAM/VPC) |
| In-memory (Map/LRU) | **lossy cache OVER an external truth** (e.g. `ephemeralCache`) | **any authoritative cross-request state** | free | none (per-instance, racy under Fluid Compute) | — |

**Store decision rule (from ecosystem-04 §60, field-07 §5):**
1. Edge runtime + need a counter → **Upstash Redis (HTTP)** (can't use TCP here).
2. Long-running Node, latency-critical, TCP pooling → node-redis/ioredis → Redis/Valkey + `rate-limiter-flexible`.
3. Cloudflare-native, exact global limit → **Durable Object**. 4. Cloudflare-native, simple per-PoP → **`ratelimit`
   binding**. 5. Read-mostly edge cache → **Cloudflare KV** (its sweet spot; NEVER a counter — O-20).
6. Self-host the store → **Valkey** (license-clean Redis; verify module/Lua parity — GAP G-8).
7. Past ~100M cmds/day sustained → switch the limiter to a **fixed instance** (Redis Cloud/ElastiCache).

---

## §3 — Caching & invalidation (the other half of echo)

| Decision | Tool / mechanism | When to use | Agent-access | Secrets/env |
|---|---|---|---|---|
| **Read-heavy cache refresh (DEFAULT)** | **stale-while-revalidate** (HTTP `Cache-Control: stale-while-revalidate`, RFC 5861) | almost all read-heavy caches — serve stale instantly, refetch in background | framework/header config | — |
| Next.js on-demand invalidation | `revalidateTag(tag)` / **`updateTag()`** (Next 16) | tag-based purge. **`revalidateTag` is LAZY** (mark-stale + SWR on next visit); use **`updateTag`** for read-your-writes | Next.js server action / route handler | — (verify version behavior — GAP G-3) |
| Cloudflare programmatic edge cache | Cache API `caches.default` / Cache Reserve / Tiered Cache | edge caching in Workers; reduce origin load | `caches.default.put/match` in Worker | `CLOUDFLARE_API_TOKEN` |
| Cloudflare tag purge | cache-tags / purge-by-tag | **Enterprise-only** — flag the paywall on lower plans (KNOWN-PITFALLS P-27) | CF API | `CLOUDFLARE_API_TOKEN` (Enterprise zone) |
| Read-your-writes at the edge (no stale window) | Cloudflare **Durable Object** as strongly-consistent cache | when SWR's staleness is unacceptable | DO class | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| Distributed single-flight (stampede defense) | Redis `SET lock:{key} <uuid> NX EX <ttl>` + **Lua-guarded (UUID) release** | serverless stampede protection on expensive fills (in-process Map is a lie — O-15) | Redis `SET NX` + `EVAL` release | store creds (Upstash/Redis) |

**Invalidation strategy menu (field-04 §6):** TTL (the safety net — always on, jittered) · event-driven (best
freshness; centralize in the data layer/CDC) · **version-based** (best for bulk + LLM caches — old keys age out, no
DEL) · tag-based (grouped; watch the tag-set's own TTL). **Stampede menu (field-01 §3):** distributed lock (SETNX)
· probabilistic early expiry (XFetch) · in-process single-flight (latency opt only, never serverless defense) · SWR.

---

## §4 — Idempotency (exactly-once mutations)

| Decision | Mechanism | When to use | Agent-access | Secrets/env |
|---|---|---|---|---|
| **Mutating-endpoint idempotency (DEFAULT)** | **Stripe pattern**: `SET idemp:{key} INPROGRESS NX EX 86400` (atomic claim) + request-fingerprint hash → **400** on reuse + store response + **fail-CLOSED** | all non-GET mutating routes (required on payment-class) | Redis `SET NX` + `EVAL`; emit the IETF `Idempotency-Key` header | store creds (Upstash/Redis) |
| Durable backstop (Redis down) | **DB UNIQUE constraint** on the key column | the fail-closed durable fallback when Redis is unavailable | SQL migration | DB creds (`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` or `DATABASE_URL`) |
| Redis Cluster co-location | hash-tag `{...}` in the key | keep same-API idempotency keys in the same Redis slot | key construction | — |

---

## §5 — The agent-access surface (CLIs / MCPs an LLM uses to operate this)

| Surface | Tool | What the agent does | Version | Secrets/env |
|---|---|---|---|---|
| **Docs MCP (DEFAULT for "current API of X")** | **Context7** (`upstash/context7`) | `resolve-library-id` + `get-library-docs` → CURRENT @upstash/ratelimit docs (antidote to staleness). **Already wired in this energy harness.** | 57,525★ (2026-06-16) | none (or Context7 key for higher limits) |
| Provision/inspect Upstash | `upstash/mcp-server` | "create a Redis DB for my session store," "show keys/commands for this prefix," "command usage this month" | 55★ (2026-04-20) | Upstash API token (`UPSTASH_EMAIL` + `UPSTASH_API_KEY`) |
| Upstash account CLI | `upstash` (`upstash/cli`) | create/list Redis DBs, read usage, manage tokens — scriptable | 30★ (2026-04) | Upstash API token |
| Cloudflare ops | `wrangler` | deploy Workers w/ `ratelimit` binding, create KV/DO namespaces, `wrangler kv:*` | platform CLI | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| Inspect actual Redis state | `redis-cli` / `valkey-cli` | `INCR`/`TTL`/`TIME`/`GET` — debug a limiter's real Redis state | platform CLI | `REDIS_URL` / host+port+auth |
| Vercel provisioning | `vercel` | provision Vercel KV / set Upstash env vars | platform CLI | `VERCEL_TOKEN` |
| CF MCP servers | Cloudflare official MCP (docs + bindings) | query CF docs/bindings from an agent | platform | `CLOUDFLARE_API_TOKEN` |

---

## §6 — Starter/reference repos (lift, don't generate — O-22)

| Repo | What | When |
|---|---|---|
| **`upstash/ratelimit-js/examples/<runtime>`** (DEFAULT) | one correct setup per runtime: cloudflare-pages/workers, deno, nextjs-middleware, nextjs, remix, vercel-edge, with-vercel-kv, enable-protection | edge/serverless limiter — pre-solves the wrong-build (#9) + `waitUntil` traps |
| `rate-limiter-flexible` README examples | ioredis/node-redis-native limiter examples | long-running Node TCP-Redis limiter |
| `Losant/redis-gcra` | GCRA as Redis Lua | custom GCRA path |
| `w3cj/hono-open-api-starter` (turbo-vetted) | the API skeleton echo's limiters plug into (bump deps first) | the backend underneath the limiter |
| `ahmadrosid/rate-limit-nextjs` · Vercel "Ratelimit with Upstash Redis" template | minimal Next.js + Upstash references | "show me a deployable end-to-end" |

Store clients: `redis/node-redis` v4+ (17,546★, 2026-06-15, TCP) · `redis/ioredis` (15,295★, 2026-06-08, TCP) ·
`@upstash/redis` (950★, HTTP/edge-safe — the one @upstash/ratelimit uses).

---

## §7 — Required-Secrets manifest (the Wave-P feed)

> echo's current `.env.example` is the generic Energy template — it does **NOT** yet include the Upstash/Cloudflare
> vars this domain requires. Wave P should add the **Tier-1** block below. **Boot-time assertion is mandatory**
> (KNOWN-PITFALLS P-13): a missing Upstash var throws at the first `.limit()`, and with `timeout` fail-open it can
> SILENTLY allow everything. Assert presence at boot — don't rely on the limiter to surface it.

**Tier 1 — required for the DEFAULT stack (add to `.env.example`):**
```
# Upstash Redis (echo's default store for limiters + caches + idempotency)
# Get at: https://console.upstash.com → Redis → REST API
UPSTASH_REDIS_REST_URL=https://xxxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=...
```

**Tier 2 — required only when the alt store/runtime is chosen:**
```
# Upstash account ops (only if using upstash CLI / mcp-server to provision/inspect)
# UPSTASH_EMAIL=...
# UPSTASH_API_KEY=...

# Cloudflare (only if deploying Workers ratelimit binding / Durable Objects / KV via wrangler)
# CLOUDFLARE_API_TOKEN=...
# CLOUDFLARE_ACCOUNT_ID=...

# TCP Redis / Valkey (only for long-running Node + rate-limiter-flexible, NOT edge)
# REDIS_URL=rediss://default:<password>@<host>:<port>

# Unkey (only if using the managed API-key+limits platform)
# UNKEY_ROOT_KEY=...
```

**Already in echo's `.env.example` (reused by idempotency DB-backstop / no new secret needed):**
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (the DB unique-constraint fail-closed backstop —
§4), `VERCEL_TOKEN` (Vercel KV provisioning — not currently present; add if Vercel KV is the store).

**Secret-handling rules (inherited):** never commit real values; never log a token (the energy `Result`/no-silent-
failure law applies); for hosted-agent flows prefer the env-var contract over inline. Cross-ref energy
`.claude/rules/typescript.md` (the `new Map()` law that makes the external store — and thus these secrets —
non-optional).

---

## §8 — The one-screen default stack (echo's recommendation)

**Edge/serverless (the energy default host):** `@upstash/ratelimit` (sliding window for HTTP throttle / token bucket
for bursty APIs) on **Upstash Redis (HTTP)**, `ephemeralCache` ON (lossy deny-list short-circuit), `waitUntil(pending)`
when analytics/multi-region is on, `timeout` tuned per fail-open/closed need, `dynamicLimits` for runtime control,
**Regional not Global** for write-heavy limiters. **Long-running Node:** `rate-limiter-flexible` on ioredis/node-redis
→ Redis/Valkey (TCP). **Exact global at the edge:** Cloudflare Durable Object. **Custom memory-critical:** GCRA Lua
(`Losant/redis-gcra`). **Cloudflare KV is a read cache, never a counter.** **In-memory is only ever a lossy
short-circuit over a distributed source of truth** — the echo law that ties the whole domain back to the energy
`new Map()` boundary. **Caching:** SWR default + always-TTL+jitter + version-key LLM responses + centralized
invalidation. **Idempotency:** Stripe pattern, fail-CLOSED, DB-unique backstop.

(source: ecosystem-09 §57-64, field-08 §B — the consolidated laws.)
