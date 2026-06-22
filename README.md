# echo

**The Energy fleet's rate-limiting / caching domain-expert employee.** State that outlives the request — counted, cached, and never leaked. Powered by Energy.

echo turns "use Upstash" into a _correct, tested, costed_ limiter/cache: it picks the store, algorithm, key schema, TTL, invalidation, and idempotency semantics, refuses a `new Map()` counter / a spoofable-header key / a limiter on Cloudflare KV, and proves the limit actually holds under concurrent load. Consumed by coding agents (CLI + MCP) first, humans (the cockpit) second.

## What echo owns (and what it doesn't)

echo is the fleet's **rate-limit / caching / edge-KV** owner — the place HTTP-edge cross-request state gets externalized correctly. The neighboring seams:

- **turbo** (backend) _forbids_ the `new Map()` counter; **echo** provides the correct externalization. That handoff is echo's flagship seam.
- **bee** owns background-jobs / queues / durable-workflows + worker-side flow control. echo is HTTP-edge only.
- **penny** owns product billing; echo's idempotency tool is the request-dedup primitive, not the payment ledger.

## Install

```bash
pnpm install
pnpm build          # tsc → dist/ (the bin + MCP server)
node dist/cli.js --help
```

Published target `@energy/echo` (npm parked per fleet convention; GitHub release live).

## CLI

```
echo --help | --version                  # usage; exits 0
echo audit <path>                         # scan app/api/** for the new Map() anti-pattern (P-01) — the turbo seam echo OWNS;
                                          #   reports source-of-truth Maps (BUG) vs ephemeralCache Maps (OK, P-02); exit≠0 if a BUG found
echo limiter <endpoint-kind>              # emit a correct limiter: store + algo + identity-key + fail-mode from the OPINIONS
echo cache <pattern>                      # emit a correct cache: SWR + always-TTL+jitter + per-tenant key + invalidation strategy
echo idempotency <endpoint>               # the Stripe pattern: atomic SET NX + fingerprint→400 + 24h TTL + fail-CLOSED + DB backstop
echo stampede <key-cost>                  # the right herd defense: distributed single-flight (SETNX+Lua) or SWR — never in-process Map
echo cost --algo <a> --rps <n> [...]      # commands/request × cost projection + fixed-instance break-even (O-19)
echo key <entity> <id>                    # the ONE cacheKey()/limiterKey() builder — keys-as-contracts (O-13)
echo store --runtime <edge|node|cf>       # recommend the store for the runtime; refuses CF-KV-as-counter (O-20)
echo brain "<question>"                   # BM25 query over brain/ — the queryable memory layer
echo doctor                               # assert env presence (UPSTASH_REDIS_REST_URL/_TOKEN) at boot (P-13)
echo example --runtime <r>                # print the runtime-correct upstash/ratelimit-js example (lift-don't-generate, O-22)
```

## MCP

echo exposes its own stdio MCP server (registered in `.mcp.json`, env refs only — no live keys):

`echo_audit_state` · `echo_design_limiter` · `echo_design_cache` · `echo_design_idempotency` · `echo_design_stampede` · `echo_cost` · `echo_key` · `echo_recommend_store` · `echo_ask` · `echo_doctor`

```bash
node dist/mcp-server.js   # speaks JSON-RPC over stdio
```

## The brain (echo's expertise)

23 defended opinions, 29 version-pinned pitfalls, 19 production failure scenarios live under `brain/` and are queryable: `echo brain "fail-open"` → `OPINIONS.md#O-04`. The three roots every failure reduces to:

1. **Shared-mutable-state** — a Map / a header / a non-atomic counter trusted when it shouldn't be.
2. **Synchronization** — stampedes & retry storms; fixed by jitter + distributed coordination.
3. **Keys-as-broken-contracts** — key trust & coverage drift; fixed by building keys in one place and making coverage a test.

## The acceptance test (the bar)

On a fresh checkout: `echo limiter` wraps a handler with a sliding-window limiter whose limit **HOLDS** under concurrent load, `echo cache` produces a working stale-while-revalidate path, and `echo audit` exits non-zero on a `new Map()` cross-request counter while passing an `ephemeralCache: new Map()`.

```bash
pnpm run test:acceptance:limiter   # admitted == limit under a concurrent burst (in-proc by default, SRH in CI)
pnpm run test:acceptance:cache     # miss→fill, hit, stale-served+bg-refetch + jittered TTL
pnpm eval                          # the Hamel L1/L2/L3 golden pyramid (8 🔴 tasks red-block CI)
```

The local-first acceptance runs at $0 with no provider creds (D15); the live-Upstash path runs as a separate on-demand CI job. See `SANDBOX.md`.

## Project map

A recursively self-improving, agent-native harness — built on the Energy harness formula.

- `AGENTS.md` — how a coding agent invokes echo (the CLI tree + MCP tools + the NOT-list)
- `CLAUDE.md` — operating rules for working _in_ this repo
- `llms.txt` — the agent-readable index (CLI + MCP + brain map)
- `identity/SOUL.md` — the full echo persona
- `skills/` — 5 repo-authored skills (state-audit · limiter-design · invalidation · stampede-herd · cost-and-migrate)
- `.claude/agents/echo-*.md` — 2 packaged sub-agent reviewers (limiter-reviewer · invalidation-auditor)
- `brain/` — the 6 expertise artifacts

## See Also

- **[turbo](https://github.com/naman10parikh/turbo)** — backend/API runtime; forbids the `new Map()` counter echo externalizes.
- **[bee](https://github.com/naman10parikh/bee)** — background-jobs / queues / durable-workflows; the worker-side complement to echo's HTTP-edge seam.
- **[penny](https://github.com/naman10parikh/penny)** — product billing; pairs with echo's idempotency primitive for payment-class endpoints.

---

MIT © Energy. Part of the Energy fleet of agent-native domain-expert employees.
