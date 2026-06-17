# echo ECOSYSTEM-07 — best starter / template / example repos (June 2026)

> Ranked by usefulness as a *baseline echo can lift from*, with stars/last-commit/why. Sources:
> `gh api` + firecrawl search, 2026-06-16. Bias toward official + recently-pushed.

## Tier 1 — the canonical baselines (use these)

### 1. `upstash/ratelimit-js` (2,038★, MIT, pushed 2026-03-09) — and especially its `examples/`
The library itself, but the **`examples/` directory is the real gold** — one working setup per
runtime, which is exactly the matrix echo serves:
`cloudflare-pages · cloudflare-workers · deno · enable-protection · nextjs-middleware · nextjs ·
remix · vercel-edge · with-vercel-kv` (source: `gh api repos/upstash/ratelimit-js/contents/examples`).
- **Why:** each example is the runtime-correct import + the `waitUntil(pending)` wiring + the
  `Redis.fromEnv()` pattern. echo's per-runtime scaffolds should be derived from these (they
  pre-solve issue #9's "wrong build for the runtime" trap). `enable-protection` shows deny-lists/
  traffic-protection; `with-vercel-kv` shows the Vercel-KV-as-store path.

### 2. `w3cj/hono-open-api-starter` (turbo's reference; bump deps first)
Not echo-specific, but it's the backend skeleton echo's limiters plug INTO, and turbo already
vetted it: "wires the entire law (Zod-boundary + typed routes + OpenAPI + Pino + Vitest +
file-split) — use as baseline, but bump deps first (last push Oct 2025)." (source:
~/turbo/brain/EXPERTISE-MAP.md:58). echo adds the rate-limit middleware on top.

### 3. Vercel template: "Ratelimit with Upstash Redis"
Official Vercel deploy-template (vercel.com/templates/next.js/ratelimit-with-upstash-redis) —
one-click Next.js + Upstash. (source: WebSearch, npmjs/vercel, 2026). Good for "show me a
deployable end-to-end" but thinner than the library examples.

## Tier 2 — focused community examples (read, don't necessarily fork)
- **`ahmadrosid/rate-limit-nextjs`** — minimal "rate limit your Next.js app with Upstash Redis."
  Good single-file reference. (source: github.com/ahmadrosid/rate-limit-nextjs, firecrawl)
- **vercel/next.js Discussion #62178** — "Using upstash/redis to implement rate limiting on api
  routes" — the community thread with the App-Router pattern + the gotchas people hit. Useful as
  a "what confuses real users" source, not a repo. (source: github.com/vercel/next.js/discussions/62178)
- **Azion marketplace template** `upstash-rate-limiting.mdx` — shows the *edge-CDN* (non-Vercel,
  non-CF) deployment shape; useful for breadth. (source: github.com/aziontech/docs, firecrawl)

## Tier 3 — algorithm-reference repos (for the GCRA / custom-Lua path)
- **`Losant/redis-gcra`** (52★, pushed 2026-02-13) — GCRA implemented as Redis Lua. THE
  reference if echo needs a GCRA limiter that @upstash/ratelimit doesn't provide. Recently
  maintained. (source: `gh api repos/Losant/redis-gcra`)
- **`throttled/throttled`** (Go) — brandur's recommended GCRA reference implementation. Read for
  the algorithm, port the Lua. (source: brandur.org/rate-limiting → github.com/throttled/throttled)
- **`express-rate-limit/rate-limit-redis`** (218★, pushed 2026-06-14, MIT) — the Redis store for
  express-rate-limit; supports "Redis/Redict/Valkey." Reference for the TCP-client store path.
  (source: `gh search repos`)

## The honest "which starter" rule for echo
- Edge/serverless rate limit → **lift `upstash/ratelimit-js/examples/<your-runtime>`.** Period.
  It pre-solves the runtime-build and `waitUntil` traps.
- Long-running Node TCP-Redis → **`rate-limiter-flexible` README examples** (it speaks ioredis/
  node-redis natively; @upstash/ratelimit can't — issue #115).
- Custom GCRA → **`Losant/redis-gcra`** Lua.
- The API skeleton underneath → **`w3cj/hono-open-api-starter`** (turbo-vetted), bump deps.

## Client libs echo will reference (the stores' own clients)
- `redis/node-redis` v4+ (17,546★, pushed 2026-06-15) — the official TCP client.
- `redis/ioredis` (15,295★, pushed 2026-06-08) — the other TCP client; what users want for
  Upstash-over-TCP but can't use with @upstash/ratelimit.
- `@upstash/redis` (950★) — the HTTP client (edge-safe), the one @upstash/ratelimit uses.
