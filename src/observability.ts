/**
 * echo observability — append-only run log + the domain-native `commands/request` metric (PLAN §3 C10; E2).
 *
 * Component C10's ✅ bar (HARNESS-OVERRIDES §10): every CLI/MCP run appends ONE JSON line to `logs/runs.jsonl`
 * with `{model, tool, duration_ms, outcome, ts}` AND echo's domain-native metric — the **commands/request** +
 * projected monthly cost a `echo cost` run computed (O-19, the number echo costs every design from). Generic
 * run-logging alone = 🟡 for echo; ✅ wants commands/request surfaced. So this module does two things:
 *
 *   1. `instrument(program)` — a commander hook that times each command and writes the run line on process exit
 *      (the CLI commands call `process.exit()` synchronously inside their actions, so a `postAction` hook never
 *      fires — we record on the `exit` event instead, where `appendFileSync` is still valid).
 *   2. `recordDomainMetric(...)` — the `cost` command calls this so the run line carries `commandsPerRequest`
 *      + `monthlyUSD` (the domain metric), proving C10 is echo-native, not generic.
 *
 * Design (Karpathy: Simplicity First). Zero deps, synchronous, fail-soft: a logging failure must NEVER change the
 * command's exit code or crash the CLI (observability is not allowed to break the tool it observes — the inverse of
 * O-04's "fail-open is worse than none": here the logger fails SILENTLY-OPEN because it is not a security gate).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";

/** One appended run record (the C10 line shape). `cmdsPerReq`/`monthlyUSD` present only for `echo cost`. */
export interface RunRecord {
  /** ISO-8601 timestamp of when the run finished. */
  readonly ts: string;
  /** the model this node runs on (D12/D14: every echo node is Opus 4.8 max). */
  readonly model: string;
  /** the CLI/MCP tool invoked (the command name, e.g. "limiter", "cost", "audit"). */
  readonly tool: string;
  /** wall-clock duration of the command in milliseconds. */
  readonly duration_ms: number;
  /** "ok" (exit 0) | "error" (non-zero exit) | "crash" (uncaught). */
  readonly outcome: "ok" | "error" | "crash";
  /** echo's domain-native metric — commands/request for a costed design (O-19); only set by `echo cost`. */
  readonly cmdsPerReq?: number;
  /** projected monthly USD for the costed design (O-19/S-16); only set by `echo cost`. */
  readonly monthlyUSD?: number;
}

/**
 * The model every echo node runs on. Per D12/D14 the whole CP123 fleet runs Claude Code's default model at max effort —
 * the run log records it so observability proves the model-routing invariant (no bare-default downshift).
 * Overridable via `ANTHROPIC_MODEL` for forward-compat, but defaults to the locked CP123 model.
 */
const ECHO_MODEL = process.env.ANTHROPIC_MODEL || "default";

/** Resolve the repo-root `logs/runs.jsonl` from this module's location (dist/observability.js → ../logs). */
function runsLogPath(): string {
  // dist/observability.js lives one level under the repo root; logs/ is a repo-root sibling of dist/.
  const here = dirname(fileURLToPath(import.meta.url)); // .../echo/dist
  return join(here, "..", "logs", "runs.jsonl");
}

// The domain metric the `cost` command stashes for the exit-time logger to merge into the run line. Module-scope
// here is correct (this is a single-shot CLI process, not serverless cross-request state — NOT a P-01 surface).
let pendingDomainMetric: { cmdsPerReq: number; monthlyUSD: number } | null = null;

/**
 * Record echo's domain-native metric for the current run. Called by `runCost` so the run line carries
 * commands/request + monthly cost (the C10 ✅ requirement). No-op-safe if called more than once (last wins).
 */
export function recordDomainMetric(metric: { cmdsPerReq: number; monthlyUSD: number }): void {
  pendingDomainMetric = metric;
}

/** Append one run record to `logs/runs.jsonl`, creating `logs/` if needed. Fail-soft: never throws. */
export function appendRun(rec: RunRecord): void {
  try {
    const path = runsLogPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(rec) + "\n", "utf8");
  } catch {
    // Intentionally silent: a logging failure must not break the command it observes (C10 is not a gate).
  }
}

/**
 * Instrument a commander program: time each command and write a run line on process exit.
 *
 * We hook `preAction` to capture the tool name + start time, then write on the `exit` event (the actions
 * `process.exit()` synchronously, so `postAction` is unreachable). `process.exitCode`/the exit arg gives the
 * outcome. Registered once per process; idempotent if called twice.
 */
export function instrument(program: Command): void {
  let tool = "unknown";
  let start = Date.now();
  let armed = false;

  program.hook("preAction", (_thisCommand, actionCommand) => {
    try {
      tool = actionCommand.name();
    } catch {
      tool = "unknown";
    }
    start = Date.now();
    if (!armed) {
      armed = true;
      process.on("exit", (code) => {
        const outcome: RunRecord["outcome"] = code === 0 ? "ok" : "error";
        const rec: RunRecord = {
          ts: new Date().toISOString(),
          model: ECHO_MODEL,
          tool,
          duration_ms: Date.now() - start,
          outcome,
          ...(pendingDomainMetric ? { cmdsPerReq: pendingDomainMetric.cmdsPerReq, monthlyUSD: pendingDomainMetric.monthlyUSD } : {}),
        };
        appendRun(rec);
      });
    }
  });
}
