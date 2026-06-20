---
name: echo-cost-and-migrate
description: Cost a limiter/cache design BEFORE recommending a store, and migrate stores without a silent fail-open. Use when the task is "is Upstash too expensive", "our Redis bill blew up", "should we move off Upstash", "move the store", or "can we use Cloudflare KV / Workers for this". Counts COMMANDS not requests, keeps write-heavy limiters Regional, refuses a limiter on Cloudflare Workers KV, and treats a runtime change as a client change.
---

# echo-cost-and-migrate — count commands, keep it Regional, never a limiter on CF KV

> **Brain anchors:** O-19, O-20, O-23 (OPINIONS) · P-15, P-16, P-13 (PITFALLS) · S-14, S-16 (BATTLE-TESTED-SCENARIOS).
> Behind `echo cost` + `echo store`. The "$0.20/100K is cheap" assumption is the trap this skill exists to kill.

## Trigger

- "is Upstash too expensive" / "our Redis bill blew up" / a surprise $600+ Redis invoice.
- "should we move off Upstash" / "move the store" / "can we self-host the limiter".
- "can we use Cloudflare KV / Workers for this counter" (the answer is usually **no** — O-20).
- Choosing a store for a new limiter/cache (cost the design *before* recommending).

## The cost stances (O-19 / P-15)

**COUNT COMMANDS, not requests.** A limiter is multiple Redis commands per request, and per-command pricing
(Upstash $0.20/100K; **Vercel KV is 2×** at $0.40/100K) turns "cheap" into a five-figure monthly bill:

| Algorithm | Commands/request | Notes |
| --- | --- | --- |
| fixed window | **2** (`EVAL, INCR`) | cheapest; tolerates a 2× boundary burst |
| sliding window | **4** (`EVAL, GET, GET, INCR`) | smooth; the common default |
| token bucket | **4** (`EVAL, HMGET, HSET, PEXPIRE`) | bursty-bounded |

Adders: **+1** analytics · **+2** deny-list · **+1** dynamic limits. **Global mode multiplies the WRITE side
`×(1 + readRegions)`** — a write-heavy limiter in 3-region Global at 1k req/s can hit ~$25,920/month vs ~$5,000
Regional. The formula: `cmds/req × adders × (1+readRegions) × req/s × 86,400 × days`.

**Stances:**
- **Keep write-heavy limiters REGIONAL (O-19).** Global multiplies the expensive (write) side. Use Global only when
  you genuinely need multi-region reads.
- **The algorithm is a COST decision too.** fixed-window (2 cmds) is half the bill of sliding (4) where a boundary
  burst is acceptable. Drop unused analytics (−1).
- **Past ~100M cmds/day, switch to a FIXED INSTANCE** (Redis Cloud / ElastiCache / **Valkey**). Per-command Upstash
  is the right default for low/bursty traffic (scales to zero); the break-even is where the flat fee beats
  per-command. `echo cost` computes the break-even cmds/day.

## The migration stances (O-20 / O-23)

- **NEVER put a rate limiter or per-request counter on Cloudflare Workers KV (O-20 / P-16 / S-14).** KV is
  **eventually consistent (up to 60s cross-region)** + **1 write/sec/key (un-raisable)** + write p50 ~172ms (~28×
  slower than Upstash on the side a limiter hammers) → a limiter keyed on a user/IP **silently fails open** and drops
  writes on busy keys. Edge counters → **Durable Object** (strong, exact) or Upstash. KV is a *read-mostly edge cache*
  (config / feature flags / blobs) only. `echo store --runtime cf` **refuses** KV-as-counter and reaches for a DO.
- **"Redis" means the FAMILY; Valkey is the 2026 cost-default for self-host/AWS (O-23).** Redis's 2024 relicense
  spawned **Valkey** (Linux Foundation, BSD), first-class in ElastiCache at a discount and command-compatible for
  everything a limiter/cache uses (`INCR`, `EXPIRE`, `EVAL`, sorted sets). *(Escape hatch: a Redis module —
  RedisJSON/RediSearch — may lack Valkey parity; verify before switching.)*
- **A runtime change is a CLIENT change.** `@upstash/ratelimit` is **HTTP-Redis ONLY** (P-12) — you cannot swap in
  ioredis/node-redis. Moving a limiter to a long-running Node box means switching to **`rate-limiter-flexible`**
  (TCP, also has concurrency limiting), not just re-pointing a URL.
- **Migrate via cut-over, not a trickle, and assert env at boot (P-13).** A missing `UPSTASH_REDIS_REST_URL`/`_TOKEN`
  throws at the first `.limit()` — and with `timeout` fail-open it can **silently allow everything**. `echo doctor`
  asserts env presence before any limiter call.

## Steps

1. **Count commands** for the chosen algorithm × adders × regions: `echo cost --algo <a> --rps <n> [--regions <n>]
   [--analytics]` → cmds/req, projected monthly $, and the fixed-instance break-even.
2. **If write-heavy and Global:** drop to **Regional**; reconsider sliding→fixed-window if a boundary burst is OK.
3. **Past the break-even:** recommend a fixed instance (Valkey/ElastiCache/Redis Cloud).
4. **For an edge runtime:** `echo store --runtime cf` — **refuse KV-as-counter**, recommend a Durable Object or Upstash.
5. **For a migration:** name it a client change if the runtime changes (Upstash↔rate-limiter-flexible); cut over (don't
   trickle); add the boot-time env assertion (`echo doctor`); never leave a limiter silently fail-open mid-migration.

## Output format

A cost table (cmds/req · monthly $ · break-even cmds/day) from `echo cost`, and/or a store recommendation from
`echo store` naming the **refusals** (e.g. `cf-kv-as-counter → Durable Object`). For a migration: a cut-over plan
naming whether it's a client change and the boot-time env assertion to add.
