# echo ECOSYSTEM-10 — what an AGENT (not a human) needs to operate these tools

> echo is an agent-native harness. This file is the CLI/API/MCP surface an LLM uses to actually
> DO rate-limiting/caching work, not just describe it. Sources cited inline. Retrieved 2026-06-16.

## MCP servers an agent can wire up

### Upstash MCP Server — `upstash/mcp-server` (55★, pushed 2026-04-20)
> "lets your agent **manage and debug your Upstash resources directly**, across Redis, QStash,
> Workflow, and Upstash Box. Works with any MCP-compatible client." (source:
> github.com/upstash/mcp-server + skywork.ai writeup, 2026)
- **Agent use:** "Create a Redis database for my new session store," "show me the keys/commands
  for this rate-limit prefix," "what's my command usage this month." This is the *operate-the-
  account* MCP — provisioning + debugging the live store. Needs an Upstash API token.
- echo should declare this in `.mcp.json` for any flow that provisions/inspects Upstash.

### Context7 MCP — `upstash/context7` (57,525★, pushed 2026-06-16) — ALSO by Upstash
> "up-to-date code documentation formatted for LLM consumption … two tools: `resolve-library-id`
> and `get-library-docs`." Use it to ask "how do I use the latest @upstash/ratelimit?" and get
> CURRENT docs (not stale training data). (source: upstash.com/blog/context7-llmtxt-cursor, 2026)
- **Already wired in THIS energy harness** (the conversation has `mcp__context7__*`). echo should
  default to Context7 for any "current API of library X" question — it is the antidote to the
  staleness problem flagged in ecosystem-01. The `@upstash/ratelimit` repo even ships a
  `context7.json` (seen in changelog v2.0.6/2.0.7) so its docs are Context7-indexed.

### Cloudflare's MCP / `wrangler` — operate Workers/DO/KV from an agent
- `wrangler` CLI is the agent's hands for Cloudflare: `wrangler kv:*`, deploying Workers with the
  `ratelimit` binding, creating Durable Object namespaces. Cloudflare also ships official MCP
  servers (docs + bindings) the agent can call. (source: developers.cloudflare.com, 2026)

## CLIs an agent should know
| CLI | What the agent does with it | Source |
|---|---|---|
| `upstash` (`upstash/cli`, 30★, 2026-04) | create/list Redis DBs, read usage, manage tokens — scriptable account ops | github.com/upstash/cli |
| `wrangler` | deploy Workers w/ ratelimit binding, manage KV/DO namespaces | developers.cloudflare.com |
| `redis-cli` / `valkey-cli` | inspect keys, run `INCR`/`TTL`/`TIME`, debug a limiter's actual Redis state | redis.io / valkey.io |
| `vercel` | provision Vercel KV / env vars for Upstash creds | vercel.com/docs |

## APIs / SDK surface (the code an agent writes)
- **`@upstash/ratelimit`** — `new Ratelimit({redis, limiter, analytics, prefix, timeout,
  ephemeralCache, dynamicLimits})`; methods: `.limit(id, {rate})`, `.getRemaining(id)`,
  `.resetUsedTokens(id)`, `.blockUntilReady(id, timeout)`, `.setDynamicLimit({limit})`. (source:
  upstash.com/docs/redis/sdks/ratelimit-ts/methods + /features)
- **`@upstash/redis`** — `Redis.fromEnv()` (reads `UPSTASH_REDIS_REST_URL` + `_TOKEN` env), full
  Redis command set over HTTP. Edge-safe (no TCP). (source: github.com/upstash/redis-js)
- **Cloudflare Workers `ratelimit` binding** — `env.MY_RATE_LIMITER.limit({key})` returns
  `{success}`; configured in `wrangler.toml` `[[unsafe.bindings]]` with `simple={limit,period}`,
  period ∈ {10,60}s, **per-PoP**. (source: developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- **Durable Objects** — agent writes a DO class with an in-DO counter; `env.NS.idFromName(key)` →
  `stub.fetch()` for an exact, strongly-consistent global limiter. (source:
  developers.cloudflare.com/durable-objects/)

## The env-var contract an agent must set (the operational gotcha)
- Upstash needs `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` for `Redis.fromEnv()`.
  Forgetting these → the limiter throws at first call (and with `timeout` fail-open, it may
  SILENTLY allow everything — a dangerous combination an agent must guard against by asserting
  env presence at boot, not relying on the limiter to surface the error).
- echo's `.env.example` should template these + Cloudflare account/zone/token for wrangler.

## What an agent specifically needs to AVOID (operating gotchas, not feature gaps)
1. **Don't put the limiter/cache in the wrong runtime build** (issue #9): pick the edge-safe
   import for edge middleware.
2. **Don't forget `waitUntil(pending)`** on edge when analytics/multi-region is on (silent drops).
3. **Don't read the Redis key directly to get "remaining"** (issue #17) — use `getRemaining`.
4. **Don't assume `vercel dev` reproduces concurrency bugs** — local emulators don't reuse
   containers, so the Fluid-Compute cross-user-bleed bug (turbo S-01) is invisible locally. The
   agent must reason about it from the code, or test against a real deploy.
5. **Don't use Cloudflare KV as a counter store** (write-cost + eventual consistency).
