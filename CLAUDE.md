@AGENTS.md

# echo — operating rules for THIS repo

> [AGENTS.md](AGENTS.md), imported above, is the one source for every coding agent: what echo is, its law and three
> roots, its CLI and MCP tools, the boundary and the NOT-list. This file keeps the rules for working *inside* this
> repo with Claude Code. The full identity is `identity/SOUL.md`; the bootstrap laws are `identity/MEMORY.md`; the
> queryable expertise is `brain/` (query with `echo brain "<q>"`). The inherited rules in `.claude/rules/` are
> glob-loaded every session.

## What this repo is

A self-contained agent-native harness for **echo**. It ships an `echo` CLI, an `echo` MCP server, repo-authored
skills, sub-agent personas, an anti-pattern hook, an eval pyramid, and a brain — the whole package that makes any
coding agent dangerous in rate-limiting/caching work. Energy is the control center; this is one flavor.

## MCP servers

- **`.mcp.json`** (the root file, which a stranger and the Claude Code plugin load) holds only servers that need no
  secret and no relative path: echo's own server, run straight from GitHub
  (`npx -y -p github:naman10parikh/echo echo-mcp`), and context7.
- **`.mcp.dev.json`** holds the maintainer's set: `echo-local` (the built `dist/mcp-server.js`, so run `pnpm build`
  first), `github` (needs `GITHUB_PERSONAL_ACCESS_TOKEN`), and `memory` and `obsidian` (paths relative to this repo).
  Load them with `claude --mcp-config .mcp.dev.json`; add `--strict-mcp-config` to load only that set. echo's server
  reads `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from the environment it inherits; only `echo_doctor`
  needs them.

## Hooks

`.claude/settings.json` wires `hooks/echo-state-guard.js` on `PreToolUse` (`Edit|Write`), and `hooks/hooks.json`
wires the same script for the plugin. It denies a `new Map()` source-of-truth counter written under `app/api/**` or
`pages/api/**` (P-01) and allows `ephemeralCache: new Map()` (P-02), using the same detector as `echo audit`: the
built `dist/` when present, else the source file (Node 22.18+ strips its types). It fails open otherwise.

## Sub-agents

Two read-only reviewers in `.claude/agents/`, both echo's own: `echo-limiter-reviewer` (a diff against the
P-01..P-29 limiter pitfalls) and `echo-invalidation-auditor` (cache staleness: `DEL→0`, no TTL, a forgotten write
path, the dual-write race). The other personas in that folder are inherited from the fleet.

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
- **Model routing (D12/D14):** every node = the latest flagship Opus (Claude Code's default, or the alias `opus`; never a model ID), max effort. Every sub-agent persona + every
  workflow `agent()` spawn carries an **explicit** `model` — no bare-default spawn (the CP123-death root cause).
  `scripts/budget-manager.sh` is present but **inert** as a constraint (the weekly budget is disabled — never
  downshift/pause for budget; only a hard 5h `429` throttles → pause-and-resume).

## Session protocol

Read `identity/MEMORY.md` (the laws) + the relevant `brain/` artifact for the surface you're touching, *before*
editing any limiter/cache code (the `brain/KNOWN-PITFALLS.md` detection columns are the load-bearing scan). Use the
`echo` CLI / MCP and the skills to do the work — dogfood echo. Record each lesson as a rule in `memory/LEARNINGS.md`.
