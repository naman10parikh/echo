# echo

<!-- fleet:header:start -->
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE) [![Agent-native](https://img.shields.io/badge/agent--native-yes-2f5d8a?style=flat-square)](AGENTS.md) [![MCP server](https://img.shields.io/badge/MCP-server-1e3f60?style=flat-square)](#use-it-from-any-coding-agent) [![Skills](https://img.shields.io/badge/skills-5-2f6b4f?style=flat-square)](skills/)

**Rate limits and caching for serverless APIs.**

Echo is an agent employee, a packaged specialist agent with its own skills, memory and tests. It owns one job: rate limits and caching. Coding agents use it through its skills, its MCP server and its command line. Its evals gate every merge in CI. A person makes every change.

_Echo is part of an agent-native play for agent-native systems that can eventually be recursively self-improving and evolving, operated by agent employees._

[AGENTS.md](AGENTS.md) · [llms.txt](llms.txt) · [Skills](skills/) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [All projects](https://github.com/naman10parikh)
<!-- fleet:header:end -->

echo turns "use Upstash" into a correct, tested, costed limiter or cache. It picks the store, the algorithm, the key schema, the TTL, the invalidation and the idempotency semantics, refuses a `new Map()` counter, a spoofable-header key and a limiter on Cloudflare KV, and proves the limit holds under concurrent load. It is for coding agents first (CLI and MCP) and people second (the cockpit): state that outlives the request, counted, cached and never leaked. Powered by Energy.

<!-- fleet:use:start -->
## Use it from any coding agent

**Claude Code**: the plugin brings the skills, sub-agents, hooks and MCP server.

```
/plugin marketplace add naman10parikh/echo
/plugin install echo@echo
```

<details><summary>Its MCP server, Codex, Cursor, Gemini CLI, one skill and the command line</summary>

**Its MCP server**, in any MCP client:

```bash
claude mcp add --transport stdio echo -- npx -y -p github:naman10parikh/echo echo-mcp
codex mcp add echo -- npx -y -p github:naman10parikh/echo echo-mcp
```

Cursor (`.cursor/mcp.json`), Gemini CLI (`.gemini/settings.json`) and most other clients take the same command as JSON:

```json
{
  "mcpServers": {
    "echo": {
      "command": "npx",
      "args": [
        "-y",
        "-p",
        "github:naman10parikh/echo",
        "echo-mcp"
      ]
    }
  }
}
```

**Gemini CLI**: the extension brings the context and the MCP server.

```bash
gemini extensions install https://github.com/naman10parikh/echo
```

**One skill** (5 in all, in [skills/](skills/)), in any agent that reads Agent Skills:

```bash
gemini skills install https://github.com/naman10parikh/echo --path skills/echo-state-audit
git clone --depth 1 https://github.com/naman10parikh/echo /tmp/echo && cp -r /tmp/echo/skills/echo-state-audit ~/.claude/skills/
```

**The command line:**

```bash
npx -y -p github:naman10parikh/echo echo-cli --help
```

</details>

Codex, Cursor, OpenCode, GitHub Copilot and other agents read [AGENTS.md](AGENTS.md); Claude Code reads [CLAUDE.md](CLAUDE.md) and Gemini CLI reads [GEMINI.md](GEMINI.md), which import it. [llms.txt](llms.txt) maps every surface for agents that read first.
<!-- fleet:use:end -->

## Quick start

```bash
git clone https://github.com/naman10parikh/echo && cd echo
pnpm install && pnpm build                                  # tsc → dist/ (the CLI and the MCP server)
node dist/cli.js audit eval/fixtures/bad-map-counter        # BUG route.ts:7, a source-of-truth Map on serverless (exit 1)
node dist/cli.js audit eval/fixtures/ok-ephemeral-cache     # OK, ephemeralCache: new Map() is the one legit Map (exit 0)
node dist/cli.js limiter login                              # Upstash Redis, slidingWindow, keyed on identity, fail-closed
node dist/cli.js store --runtime cf                         # a Durable Object; refuses Workers KV as a counter
node dist/cli.js cost --algo sliding --rps 50               # 4 commands per request, $1,036.8 a month, the break-even
node dist/cli.js brain "fail-open"                          # BM25 over the brain → OPINIONS.md#O-04
pnpm test && pnpm eval                                      # 26 tests; 8/8 CI-blocking golden tasks, both corpora calibrated
```

Everything above runs offline at no cost. Only `echo doctor` and the live-Upstash CI job need `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

## How it works

### What echo owns (and what it doesn't)

echo is the fleet's **rate-limit / caching / edge-KV** owner — the place HTTP-edge cross-request state gets externalized correctly. The neighboring seams:

- **turbo** (backend) _forbids_ the `new Map()` counter; **echo** provides the correct externalization. That handoff is echo's flagship seam.
- **bee** owns background-jobs / queues / durable-workflows + worker-side flow control. echo is HTTP-edge only.
- **penny** owns product billing; echo's idempotency tool is the request-dedup primitive, not the payment ledger.

### The CLI

Inside a clone, call it as `node dist/cli.js`; from npx, call it as `echo-cli` (a shell runs its built-in `echo` before any bin of that name). The usage line still says `echo`.

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

### The MCP server

echo exposes its own stdio MCP server (the root `.mcp.json` starts it from GitHub with npx; env refs only, no live keys):

`echo_audit_state` · `echo_design_limiter` · `echo_design_cache` · `echo_design_idempotency` · `echo_design_stampede` · `echo_cost` · `echo_key` · `echo_recommend_store` · `echo_ask` · `echo_doctor`

```bash
node dist/mcp-server.js   # speaks JSON-RPC over stdio
```

### The brain (echo's expertise)

23 defended opinions, 29 version-pinned pitfalls, 19 production failure scenarios live under `brain/` and are queryable: `echo brain "fail-open"` → `OPINIONS.md#O-04`. The three roots every failure reduces to:

1. **Shared-mutable-state** — a Map / a header / a non-atomic counter trusted when it shouldn't be.
2. **Synchronization** — stampedes & retry storms; fixed by jitter + distributed coordination.
3. **Keys-as-broken-contracts** — key trust & coverage drift; fixed by building keys in one place and making coverage a test.

### The acceptance test (the bar)

On a fresh checkout: `echo limiter` wraps a handler with a sliding-window limiter whose limit **HOLDS** under concurrent load, `echo cache` produces a working stale-while-revalidate path, and `echo audit` exits non-zero on a `new Map()` cross-request counter while passing an `ephemeralCache: new Map()`.

```bash
pnpm run test:acceptance:limiter   # admitted == limit under a concurrent burst (in-proc by default, SRH in CI)
pnpm run test:acceptance:cache     # miss→fill, hit, stale-served+bg-refetch + jittered TTL
pnpm eval                          # the Hamel L1/L2/L3 golden pyramid (8 🔴 tasks red-block CI)
```

The local-first acceptance runs at $0 with no provider creds (D15); the live-Upstash path runs as a separate on-demand CI job. See `SANDBOX.md`.

### Project map

A recursively self-improving, agent-native harness — built on the Energy harness formula.

- `AGENTS.md` — how a coding agent invokes echo (the CLI tree + MCP tools + the NOT-list)
- `CLAUDE.md` — operating rules for working _in_ this repo
- `llms.txt` — the agent-readable index (CLI + MCP + brain map)
- `identity/SOUL.md` — the full echo persona
- `skills/` — 5 repo-authored skills (state-audit · limiter-design · invalidation · stampede-herd · cost-and-migrate)
- `.claude/agents/echo-*.md` — 2 packaged sub-agent reviewers (limiter-reviewer · invalidation-auditor)
- `brain/` — the 6 expertise artifacts

### See also

- **[turbo](https://github.com/naman10parikh/turbo)** — backend/API runtime; forbids the `new Map()` counter echo externalizes.
- **[bee](https://github.com/naman10parikh/bee)** — background-jobs / queues / durable-workflows; the worker-side complement to echo's HTTP-edge seam.
- **[penny](https://github.com/naman10parikh/penny)** — product billing; pairs with echo's idempotency primitive for payment-class endpoints.

<!-- fleet:anatomy:start -->
## What it is made of

Every project in this fleet is graded on the same 11 harness components and on self-improvement. Each mark is backed by a file you can open.

| Component | Grade | Where |
| --- | --- | --- |
| Identity | ✅ | identity/SOUL.md:1 identity/BRAND.md:12 |
| Memory | ✅ | identity/MEMORY.md:1 src/brain-index.ts:2 memory/LEARNINGS.md:5 |
| Skills | ✅ | skills/echo-state-audit/SKILL.md:1 skills/echo-limiter-design/SKILL.md:1 |
| Tools/CLIs | ✅ | package.json:13 src/cli.ts:155 |
| Hooks | ✅ | .claude/settings.json:4 hooks/hooks.json:4 hooks/echo-state-guard.js:1 |
| Sub-agents | ✅ | .claude/agents/echo-limiter-reviewer.md:2 .claude/agents/echo-invalidation-auditor.md:2 |
| MCPs | ✅ | src/mcp-server.ts:1 package.json:14 .mcp.json:3 |
| Dispatch | ✅ | src/dispatch.ts:62 .github/workflows/rsi.yml:25 |
| Evals | ✅ | src/eval/golden/run.ts:1 .github/workflows/echo-ci.yml:149 |
| Observability | ✅ | src/observability.ts:69 |
| Sandbox/Infra | ✅ | SANDBOX.md:1 .github/workflows/echo-ci.yml:80 |
| Self-improvement | ✅ | dsip.json:1 workflows/rsi.workflow.js:56 .github/workflows/rsi.yml:25 |

✅ real and tested · 🟡 partial, with the reason in the row · ❌ absent
<!-- fleet:anatomy:end -->

<!-- fleet:footer:start -->
## How it improves itself

It carries its own evals and a self-improvement contract, [`dsip.json`](dsip.json), which says what it may change and how a change is judged. Its evals gate every merge in CI. A person makes every change. Lessons it learns are kept as rules in its memory files.

## Part of a fleet

One of the projects by [Naman Parikh](https://github.com/naman10parikh). Each owns one part of an agent's harness, or of the product around an agent, and all of them follow one standard.

Siblings: [agentdial](https://github.com/naman10parikh/agentdial) (identity) · [wikimem](https://github.com/naman10parikh/wikimem) (memory) · [skillsmith](https://github.com/naman10parikh/skillsmith) (skills) · [agent-booster](https://github.com/naman10parikh/agent-booster) (tools / CLIs) · [armory](https://github.com/naman10parikh/armory) (MCPs and the component registry) · [agentgrid](https://github.com/naman10parikh/agentgrid) (dispatch) · [agentswarm](https://github.com/naman10parikh/agentswarm) (dispatch) · [agentbench](https://github.com/naman10parikh/agentbench) (evals) · [agentmoney](https://github.com/naman10parikh/agentmoney) (observability) · [claude-harness](https://github.com/naman10parikh/claude-harness) (the whole harness, as a template).

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md). AI-assisted pull requests are welcome. Report a vulnerability privately, as [SECURITY.md](SECURITY.md) explains.

## License

MIT, © 2026 Naman Parikh. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
<!-- fleet:footer:end -->
