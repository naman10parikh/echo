# AGENTS.md — echo

> This file tells a coding agent (Claude Code, a sibling Energy employee, the energy hub) what **echo** is and how to
> invoke it. echo is the Energy fleet's **rate-limiting / caching domain-expert employee** — consumed by coding
> agents first, humans (the cockpit) second. Forged from Energy via harness-forge (CP103); Energy is the control
> center, this is one self-contained flavor.

## What echo is

The fleet's owner of the class of problems that arise the moment per-request work must remember something across
requests, instances, or the edge: **rate limiting · caching · cache invalidation · idempotency · distributed-state
correctness · stampede & retry-storm defense · the serverless-state bill.** echo turns "use Upstash" into a
*correct, tested, costed* limiter/cache.

**echo's one-line law:** *state that must outlive a request lives in an external store the platform cannot share,
recycle, or fan out.* Almost every failure here is **synchronization** (fix: jitter) or **shared-mutable-state**
(fix: atomic shared counters + keys-as-contracts).

Call echo **before you store any cross-request state on serverless.**

## The boundary (the one seam with turbo)

- **turbo** (backend/API-framework employee) **documents** the `new Map()`-on-serverless anti-pattern — the
  `app/api/**` audit grep, the "externalize" advice.
- **echo solves it** — picks the store, algorithm, key schema, TTL, invalidation strategy, idempotency semantics,
  and fail-mode. echo OWNS the `new Map()`-on-Vercel anti-pattern fix.

## How to invoke echo

### CLI (the hands) — `echo`
```
echo --help | --version                  # usage; exits 0
echo audit <path>                         # scan app/api/** for the new Map() anti-pattern (P-01) — reports a
                                          #   source-of-truth Map (BUG, exit≠0) vs ephemeralCache Map (OK, P-02)
echo limiter <endpoint-kind>              # emit a correct limiter: store+algo+identity-key+atomic+concurrency-cap+fail-mode
echo cache <pattern>                      # emit a correct cache: SWR + always-TTL+jitter + per-tenant key + invalidation
echo idempotency <endpoint>               # emit the Stripe pattern: atomic SET NX + fingerprint→400 + 24h TTL + fail-CLOSED + DB-unique backstop
echo stampede <key-cost>                  # emit the right herd defense: distributed single-flight (SETNX+Lua) or SWR — never in-process Map
echo cost --algo <a> --rps <n> [--regions <n>] [--analytics]   # commands/request × cost projection + fixed-instance break-even
echo key <entity> <id>                    # the ONE cacheKey()/limiterKey() builder — keys-as-contracts
echo store --runtime <edge|node|cf>       # recommend the store for the runtime; refuses CF-KV-as-counter
echo brain "<question>"                   # BM25 query over brain/ — the queryable memory layer
echo doctor                               # assert env presence (UPSTASH_REDIS_REST_URL/_TOKEN) at boot
echo example --runtime <r>                # print the runtime-correct upstash/ratelimit-js example (lift, don't generate)
```

### MCP server (agent-callable) — stdio, registered in `.mcp.json`
```
echo_audit_state        { path }                            -> { bugs:[{file,line,kind}], okMaps:[...] }
echo_design_limiter     { endpointKind, runtime?, failMode? }-> { code, store, algorithm, key, failMode, rationale[] }
echo_design_cache       { pattern, tenantScoped?, ttlSec? }  -> { code, strategy, key, ttlJittered, rationale[] }
echo_design_idempotency { endpoint }                         -> { code, ttlSec:86400, failMode:"closed", dbBackstop:true }
echo_design_stampede    { keyCost }                          -> { code, strategy }
echo_cost               { algorithm, rps, regions?, analytics? } -> { cmdsPerReq, monthlyUSD, breakEvenCmdsPerDay }
echo_key                { entity, id }                       -> { key }
echo_recommend_store    { runtime }                          -> { store, why, refusals }
echo_ask                { question }                         -> { answer, citations:["brain/OPINIONS.md#O-04"] }
echo_doctor             {}                                   -> { envOK, missing, reachable }
```
Run the MCP server via the entry in `.mcp.json` (stdio default; env values are `${VAR}` refs only — no live keys).
`context7` is kept alongside echo's own server (the docs MCP — the staleness antidote).

### Skills (the taste, operationalized) — `skills/*/SKILL.md`
`echo-state-audit` (the `new Map()` boundary — flagship) · `echo-limiter-design` · `echo-invalidation` ·
`echo-stampede-herd` · `echo-cost-and-migrate`. Each encodes a named OPINIONS/PITFALLS cluster.

### Sub-agent personas — `.claude/agents/echo-*.md`
`echo-limiter-reviewer` (reviews a diff against the P-01..P-29 limiter pitfalls) · `echo-invalidation-auditor`
(scoped to cache-staleness: `DEL→0`, no-TTL, forgotten-path, dual-write race).

## The brain (echo's knowledge map)

`brain/EXPERTISE-MAP.md` (mastery by job-to-be-done) · `brain/OPINIONS.md` (O-01..O-23, defended stances) ·
`brain/KNOWN-PITFALLS.md` (P-01..P-29, version-pinned, with detection columns) · `brain/BATTLE-TESTED-SCENARIOS.md`
(S-01..S-19, real production failures) · `brain/GAPS-AND-DISPUTES.md` (the 6 experiments X-1..X-6, what's unmeasured)
· `brain/TOOL-MATRIX.md` (the default-stack one-screen + secrets). Query it: `echo brain "<question>"` / `echo_ask`.

## What echo REFUSES (the NOT-list)

- ❌ API framework / route handlers / OpenAPI / Zod-at-boundary → **turbo**.
- ❌ The payment endpoint / Stripe Checkout / webhooks → **penny** (echo owns only the *idempotency* layer).
- ❌ Schema / migrations / RLS → **acorn** (echo uses a DB *unique constraint* as the idempotency backstop only).
- ❌ Auth provider setup → **badge** (echo *consumes* the authenticated identity as the limiter key).
- ❌ Analytics / error+uptime monitoring / durable queues / storage / search / i18n / compliance →
  Tally / Canary / Bee / Shelf / Truffle / Parrot / Stamp.
- ❌ Deploy / CI release engineering → **rocket**. General LLM-cost observability → **agentmoney**.

## Three things echo never recommends

1. A `new Map()` / module-scope counter as a **source of truth** on serverless — but **keep `ephemeralCache: new
   Map()`** passed to `@upstash/ratelimit` (the one legit module-scope Map; if empty it falls through to Redis → the
   answer is still safe — O-02/P-02). Do not "fix" ephemeralCache as the Map bug.
2. A limiter keyed on a **client-settable header** (`X-Forwarded-For` / `-Host` / `-Real-IP` / `True-Client-IP`) —
   silent total bypass (O-03/P-04).
3. A rate limiter / per-request counter on **Cloudflare Workers KV** — eventually consistent (up to 60s) + 1
   write/sec/key → silently fails open (O-20/P-16).

## Commit convention

`feat(skill):` · `feat(employee):` · `feat(company):` — so git snap-back works at all 3 granularities. Named-file
commits only; never `git add -A`; never commit `.env`.
