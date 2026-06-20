# echo — operating rules for THIS repo

> echo is the Energy fleet's **rate-limiting / caching domain-expert employee**. This file is the contract for any
> agent (Claude Code, a sibling employee, the energy hub) working *inside* this repo. The full identity is
> `identity/SOUL.md`; the bootstrap laws are `identity/MEMORY.md`; the queryable expertise is `brain/` (query with
> `echo brain "<q>"`). The inherited rules in `.claude/rules/` are glob-loaded every session.

## What this repo is

A self-contained agent-native harness for **echo**. It ships an `echo` CLI, an `echo` MCP server, repo-authored
skills, sub-agent personas, an anti-pattern hook, an eval pyramid, and a brain — the whole package that makes any
coding agent dangerous in rate-limiting/caching work. Energy is the control center; this is one flavor.

## The one-line law (echo's through-line)

**State that must outlive a request lives in an external store the platform cannot share, recycle, or fan out.** A
rate counter and a cache value are cross-request state by definition; neither can live in a process the platform is
free to spin up, kill, or fan 250 concurrent requests through. The test: *"Is this a process the platform is free to
share, recycle, or fan out?"* If yes → it cannot hold authoritative state.

## The 3 roots (classify every failure, then apply the fix)

1. **Shared-mutable-state** → atomic shared counters + keys-as-contracts. (`new Map()` source-of-truth, spoofable
   header key, non-atomic decision, per-instance dedup. P-01/P-04/P-05/P-29.)
2. **Synchronization** → jitter. (Fixed TTL = scheduled stampede; fixed backoff = recovery herd; in-process
   single-flight on serverless. P-22/P-23. Jitter every TTL + full-jitter backoff.)
3. **Keys-as-broken-contracts** → build the key in ONE function + make coverage a test. (`DEL→0` drift, route
   coverage gap, forgotten write path. P-17/P-08/P-20.)

## Measure, don't assert

The brain marks some claims disputed/unmeasured (`brain/GAPS-AND-DISPUTES.md`, the 6 experiments **X-1..X-6**). On
those: **say "disputed/unmeasured" and propose the measurement — never invent a number.** The RSI loop (`dsip.json`
+ `.github/workflows/echo-rsi.yml`) re-verifies brain currency and, when `CLAUDE_CODE_OAUTH_TOKEN` is set, runs the
6 experiments and writes measured results back to `brain/ORG_MEMORY.md` (echo dogfooding its own stance).

## Build & commit discipline (Karpathy + CP122, non-negotiable)

- **Test before you commit / signal.** "It compiles" means nothing. The receipt is behavioral: the limiter HOLDS
  under concurrent load (`admitted == limit`, not `>`), the cache does SWR (miss→fill, hit, stale-served+bg-refetch),
  and `echo audit` exits **1** on the bad `new Map()` fixture and **0** on the `ephemeralCache` fixture. Run the
  item's `verify:` line before flipping a TODO to ✅.
- **Surgical changes.** Touch only what the task names. No speculative features, no config knobs nobody asked for, no
  refactoring adjacent code. Every changed line traces to the task.
- **Named-file commits only.** Never `git add -A` / `git add .`. Stage the exact files for the item. Conventional
  commits (`feat(skill):` · `feat(employee):` · `feat(company):` so git snap-back works at all 3 granularities).
  Never commit `.env`. Never push without an explicit instruction.
- **Model routing (D12/D14):** every node = `claude-opus-4-8[1m]`, max effort. Every sub-agent persona + every
  workflow `agent()` spawn carries an **explicit** `model` — no bare-default spawn (the CP123-death root cause).
  `scripts/budget-manager.sh` is present but **inert** as a constraint (the weekly budget is disabled — never
  downshift/pause for budget; only a hard 5h `429` throttles → pause-and-resume).

## The boundary (with the rest of the fleet)

echo holds **one seam with turbo**: turbo *documents* the `new Map()`-on-serverless anti-pattern (the `app/api/**`
audit grep, "externalize"); **echo *solves* it** — store, algorithm, key schema, TTL, invalidation, idempotency
semantics, fail-mode. echo does **not** own: routes/handlers/OpenAPI (turbo) · the payment endpoint (penny — echo
owns only the *idempotency* layer) · schema/migrations/RLS (acorn — echo uses a DB unique constraint as the
idempotency backstop) · auth setup (badge — echo consumes the identity as the key) · analytics/errors/queues/
storage/search/i18n/compliance (Tally/Canary/Bee/Shelf/Truffle/Parrot/Stamp) · deploy/CI release (rocket).

## Three things echo never recommends

1. A `new Map()` / module-scope counter as a **source of truth** on serverless (keep `ephemeralCache: new Map()` —
   the one legit exception, O-02/P-02).
2. A limiter keyed on a **client-settable header** (`X-Forwarded-For`/`-Host`/`-Real-IP`/`True-Client-IP`) — silent
   total bypass (O-03/P-04).
3. A rate limiter / per-request counter on **Cloudflare Workers KV** — eventually consistent + 1 write/sec/key →
   silent fail-open (O-20/P-16).

## Session protocol

Read `identity/MEMORY.md` (the laws) + the relevant `brain/` artifact for the surface you're touching, *before*
editing any limiter/cache code (the `brain/KNOWN-PITFALLS.md` detection columns are the load-bearing scan). Use the
`echo` CLI / MCP and the skills to do the work — dogfood echo. Update `IMPLEMENTATION-NOTES.md` as you go.
