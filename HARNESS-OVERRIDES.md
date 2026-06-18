# echo — HARNESS-OVERRIDES.md (vertical-specific DONE-criteria)

> **Who reads this.** Wave-V graders grade echo against `audit/HARNESS-CHECKLIST-2026.md` **as amended by this
> file**. Where this file overrides the generic checklist DONE-criteria for echo's vertical (rate-limiting /
> caching), **this file wins.** Grading uses the locked calibration (`memory feedback_harness_component_grading_calibration.md`):
> **✅ = real + wired + proven with file-level evidence** (a `command → result / commit / run-id` receipt, cp122
> style); **🟡 = present but not proven / file-only**; **❌ = absent**. "It compiles" ≠ ✅. Maturity = round(1+4×coverage).
>
> **echo's type:** dev-tool / meta-harness employee, consumed by **coding agents** (Claude Code, energy hub,
> sibling employees) first, humans (the cockpit) second. This drives two structural overrides up front:
> 1. **Identity-reachability = N/A → ✅-by-policy** (not 🟡). echo has no phone/WhatsApp/voice face; its surfaces are
>    CLI + MCP + cockpit. A grader must NOT dock echo for 0 live messaging channels.
> 2. **Memory's queryable layer indexes the EXPERTISE BRAIN** (`brain/`), not code history. ✅ requires a BM25 query
>    over `brain/` returning the right OPINIONS/PITFALLS/SCENARIOS rows.

---

## Component overrides (the 11 + 2 cross-cutting)

### 1. Identity — **OVERRIDE**
- **1a · Self · ✅ =** `identity/SOUL.md` + `BRAND.md` filled with the real echo persona (rate-limit/cache domain
  expert); name=echo + tagline + "powered by Energy"; CLAUDE.md non-generic and **states the turbo boundary**; and
  **`grep -rn "{{" identity/ CLAUDE.md AGENTS.md` returns 0** (the scaffold shipped a `{{AGENT_NAME}}` SOUL stub, a
  wikimem-template AGENTS.md, and a `TODO:` CLAUDE.md — ✅ is impossible until all three are rewritten; a grader who
  sees any `{{...}}`, "Wiki Schema", or "TODO:" residue marks ❌).
- **1b · Reachability · ✅ = N/A-by-policy.** echo is a tool-employee; CLI + MCP + cockpit are the reachability
  surfaces. **Grade ✅ (not 🟡, not ❌)** when CLI runs (`echo --help` rc 0) AND the MCP `tools/list` responds. Do
  **not** require any phone/email/WhatsApp/SMS/voice/Telegram/Slack channel — those are N/A for this vertical.

### 2. Memory — **OVERRIDE**
- **✅ =** `identity/MEMORY.md` ≤2,000 tokens (echo's load-bearing laws: the one-line state law + the 3 roots +
  the default stack) **AND** a real BM25 semantic layer over **`brain/`** proven to return brain hits:
  `echo brain "fail-open"` (or `scripts/memory-search.sh`) returns the `OPINIONS.md#O-04` / `KNOWN-PITFALLS.md#P-11`
  rows. **A `MEMORY.md` file + grep alone = 🟡.** The queryable layer indexing the **expertise brain** (the 6
  artifacts) — not git/code history — is what makes it ✅ for echo. Evidence: a query → cited brain row, rc 0.

### 3. Skills — **OVERRIDE (raise the floor + name them)**
- **✅ =** ≥3 real `skills/*/SKILL.md` (echo's target is **5**: `echo-state-audit`, `echo-limiter-design`,
  `echo-invalidation`, `echo-stampede-herd`, `echo-cost-and-migrate`), each with `## Trigger` / steps / output, each
  **encoding a named OPINIONS/PITFALLS cluster** (not generic). The flagship `echo-state-audit` MUST encode the
  O-01/O-02 + P-01/P-02 `new Map()` distinction (the turbo seam). A skill that doesn't cite/encode a brain stance =
  🟡. Evidence: `ls skills/*/SKILL.md | wc -l` ≥3 and each file names its brain anchor.

### 4. Tools / CLIs — **OVERRIDE (the CLI is the hands)**
- **✅ =** `bin` in `package.json` → `#!/usr/bin/env node`; `echo --help`/`--version` exit 0; **the signature
  command `echo audit` works** (exit 1 on a `new Map()` source-of-truth counter fixture, exit 0 on an
  `ephemeralCache: new Map()` fixture — the P-01/P-02 judgment); the full §4.1-PLAN command tree runs. Tool list
  appears in AGENTS.md + llms.txt. **Browser/computer-use = N/A** (echo operates Redis/SDKs; `redis-cli`/`upstash`
  CLI are the inspection tools — a grader must not dock echo for no browser tool). Evidence: `node dist/cli.js
  --help` rc 0 + the two `echo audit` exit codes.

### 5. Hooks — **OVERRIDE (the anti-pattern guard is the signature)**
- **✅ =** a real PreToolUse (Edit/Write) hook that **FIRES**: writing a `new Map()`/module-scope counter as a
  source-of-truth in an `app/api/**` fixture path is **warned/blocked** (P-01), and writing `ephemeralCache: new
  Map()` **passes** (P-02). A hook script that exists but isn't proven to fire on the trigger = 🟡. This hook IS the
  third clause of THE acceptance test. Evidence: run the trigger → observe the block; run the ephemeralCache case →
  observe pass (the §9-PLAN `hooks` test green).

### 6. Sub-agents — **OVERRIDE (name them)**
- **✅ =** `.claude/agents/` flat (NO `agents/agents/` nest); ≥2 real echo personas with distinct scopes —
  `echo-limiter-reviewer` (reviews a diff against the P-01..P-29 limiter pitfalls) + `echo-invalidation-auditor`
  (scoped to cache-staleness: `DEL→0`, no-TTL, forgotten-path, dual-write race); each with an explicit `model` and a
  system prompt referencing `brain/`. The inherited generic personas (architect, code-reviewer, …) do **not** count
  toward echo's 2 — they must be echo-domain-scoped. Evidence: `ls .claude/agents/echo-*.md` ≥2.

### 7. MCPs — **OVERRIDE (own server, not the 4-stub template)**
- **✅ =** echo's **own** `mcp-server.ts` exposing the rate-limit/cache tools (`echo_audit_state`,
  `echo_design_limiter`, `echo_design_cache`, `echo_design_idempotency`, `echo_design_stampede`, `echo_cost`,
  `echo_key`, `echo_recommend_store`, `echo_ask`, `echo_doctor`), stdio working, registered in `.mcp.json` with
  **env refs only (no live keys)**. The inherited github/context7/memory/obsidian 4-server template **does NOT
  satisfy this** — keeping context7 alongside is fine (the staleness antidote), but ✅ requires echo's own server in
  the list. Evidence: MCP `tools/list` returns echo's tools; the contract test (§9-PLAN) round-trips each.

### 8. Dispatch (+ cron) — **OVERRIDE**
- **✅ =** an internal routing loop tested (a multi-step `echo design` flow assigns the right sub-tool) **AND** an
  **enabled** (uncommented) GH Actions `schedule:` running the deterministic RSI half (currency re-verify +
  eval-regression) — not just written, *enabled*. No `tmux select-pane`. Evidence: `.github/workflows/echo-rsi.yml`
  has an uncommented `schedule:`; a `workflow_dispatch` run is green (run-id).

### 9. Evals (+ tests) — **OVERRIDE (the golden tasks ARE the scenarios)**
- **✅ =** `eval/` with L1 assertions + ≥3 L2 behavioral golden tasks (binary, F1≥0.8 or κ≥0.6, calibrated on
  50–100 rows mined from the BATTLE-TESTED-SCENARIOS WRONG-MOVE/RESOLUTION pairs) + L3 LLM-judge (calibrated);
  Vitest + Playwright; **THE acceptance test green in CI** (the §5-PLAN three clauses); pass^k k≥3. The 8 🔴 golden
  tasks (GT-1..GT-5, GT-7, GT-8, GT-10) red-block CI. A single passing trial = not evidence (pass^k). Evidence:
  `npm run eval` rc 0 + the CI acceptance job green (run-id) + L2 reports binary pass/fail.

### 10. Observability — **OVERRIDE (the domain-native metric)**
- **✅ =** append-only `logs/runs.jsonl` (model + duration + tool + outcome per run) wired into a hook **AND** echo's
  domain-native metric is observable: a `echo cost` run records the computed **commands/request** + projected
  monthly cost (O-19's number, the one echo costs every design from). Generic run-logging alone = 🟡 for echo —
  ✅ wants the commands/request metric surfaced. Evidence: a CLI run grows `runs.jsonl` by 1 valid line with `tool`
  + `duration_ms`; `echo cost --algo sliding --rps 1000` emits 4-cmd/req + the $-projection.

### 11. Sandbox / Infra — **OVERRIDE (the real integration point is a live Redis-protocol store)**
- **✅ =** a documented runtime envelope that boots a **local Redis + serverless-redis-http (SRH)** so
  `@upstash/ratelimit` (HTTP-only) runs deterministically with **zero Upstash creds** (the CI acceptance default),
  with a `SANDBOX.md` recording the service config + the separate on-demand live-Upstash job; OR an E2B/devcontainer
  template at the real integration point. ✅ requires the acceptance job actually booting SRH and the limiter hitting
  it (rc 0, proven by run-id) — not just a template file. A `SANDBOX.md` describing it but not run = 🟡. Evidence: the
  CI acceptance run-id shows the SRH service up + limiter hit + rc 0.

### Cross-cutting · RSI / open-endedness — **OVERRIDE**
- **✅ (≥ L1, the ship minimum) =** `dsip.json` (domains: currency / eval-regression / experiments; per §11-PLAN) +
  `rsi.yml`→`rsi-reusable.yml` + `workflows/rsi.workflow.js`; `darwin-check dsip.json` reports **≥ L1** (evals gate
  merges — the acceptance test + 🔴 golden tasks red-block CI); the **deterministic $0 half runs** (version-currency
  + doc-currency + eval-regression + link-check), tokenless (D8). **L2** = the nightly loop runs + writes diffs.
  The Claude half (the 6 EXPERIMENTS X-1..X-6 writing results to `brain/ORG_MEMORY.md`) is **deferred to
  `CLAUDE_CODE_OAUTH_TOKEN`** and is **not required for ✅** (D8) — but the gate must be present-and-wired (grep
  shows the token-gated step exists). Evidence: `darwin-check dsip.json` ≥ L1; a deterministic RSI run writes a
  diff/log; `grep CLAUDE_CODE_OAUTH_TOKEN` finds the deferred Claude-half gate.

### Cross-cutting · Model routing — **OVERRIDE (per D12/D14)**
- **✅ =** `scripts/budget-manager.sh` present; under D12/D14 every echo node = `claude-opus-4-8[1m]` max effort;
  echo's own sub-agents + any workflow `agent()` calls carry an **explicit** `model` (no bare-default spawn).
  Evidence: `grep -rn "model" .claude/agents/echo-*.md workflows/*.js` shows explicit model on every spawn.

---

## Packaging-surface overrides (Part B)

echo's type = dev-tool/meta-harness employee → **required surfaces:** CLI + MCP + plugin + skill-set + AGENTS.md +
CLAUDE.md + llms.txt + A2A card + packaged sub-agent persona. **N/A (don't dock):** framework adapter
(`@energy/agent-toolkit`) is meta-harness-only and **optional** for echo; Identity-reachability surfaces (phone/etc.)
are N/A.

- **CLI ✅ =** `npm pack --dry-run` clean; `echo --help` rc 0; published target `@energy/echo` (npm **parked**, GitHub
  release **live** — fleet convention; do not dock for "npm not published" if the GH release is live).
- **MCP ✅ =** echo's own server listed (not the 4-stub template); `tools/list` round-trips; env refs only.
- **Plugin ✅ =** `.claude-plugin/manifest.json` valid JSON, bundles the 5 skills + echo MCP + commands + the
  state-guard hook + the 2 personas; every referenced path resolves.
- **Skill-set ✅ =** ≥3 (target 5) exported, each with a trigger, each encoding a brain stance.
- **A2A card ✅ =** `/.well-known/agent.json` valid; one capability round-trips.
- **AGENTS.md / CLAUDE.md ✅ =** rewritten for echo (the stale wikimem-template AGENTS.md + `TODO:` CLAUDE.md are
  ❌ until rewritten — `grep "Wiki Schema\|TODO:\|{{"` must return 0).
- **llms.txt ✅ =** present at `/llms.txt`, links resolve, lists the CLI tree + MCP tools + the brain map.
- **Packaged sub-agent ✅ =** `echo-limiter-reviewer` persona file with a clear scope, tested via `Agent` from
  energy.

---

## Product-surface note (Part C)

echo **IS the Part C2 "Rate limiting / caching / edge KV" owner** for the fleet (the checklist's `❌ GAP — Upstash
required by typescript.md, unwired`). So for echo, this row flips from a *consumed default* to an *owned capability*:
✅ = echo provides the correct externalization (the `new Map()` fix) + the limiter/cache/idempotency design tools.
echo does **not** own the rest of C1/C2 (frontend/mobile/backend/DB/auth/payments/deploy/secrets/monitoring/
analytics/email/jobs/storage/search/compliance/i18n) — those are sibling employees; a grader must not expect echo to
ship them.

---

## The one-line grading rule for echo

> **✅ requires a behavioral receipt, not a file.** For echo specifically: the limiter must be *shown to hold under
> concurrent load*, the cache must be *shown to do SWR*, and `echo audit` must *exit 1 on the bad Map and 0 on the
> ephemeralCache Map*. Presence of code that "looks right" is 🟡. The acceptance test (run-id green in CI) is the
> single highest-order receipt — if it's green, components 4/5/9/11 are substantially proven at once.
