/**
 * echo RSI workflow — the recursive-self-improvement engine (PLAN §11; MASTER-TODOS D1/D2; HARNESS-OVERRIDES RSI).
 *
 * TWO halves, per the CP123 RSI contract:
 *
 *  1. DETERMINISTIC $0 HALF (tokenless — runs NOW, nightly, D8). Pure Node, no LLM, no model spawn:
 *       - version-currency: `npm view @upstash/ratelimit version` vs the pinned 2.0.81 → flag drift to ORG_MEMORY.
 *       - doc-currency: assert the brain's flagged caveats carry a re-check date; flag stale ones.
 *       - eval-regression: re-run the L1 golden assertions + the acceptance test; any red = a proposed diff.
 *       - link-check: the brain's cited sources still resolve.
 *
 *  2. CLAUDE HALF (DEFERRED — lights up only when `CLAUDE_CODE_OAUTH_TOKEN` is set, D8). This is where the 6
 *     EXPERIMENTS (X-1..X-6) run as sub-agents and write measured results back to brain/ORG_MEMORY.md. Per D12/D14,
 *     EVERY spawn carries an EXPLICIT `model: "claude-opus-4-8[1m]"` — never a bare-default spawn (the CP123-death
 *     root cause was builders omitting `model` and inheriting a throttled session model).
 *
 * The deterministic half is what `.github/workflows/echo-rsi.yml` runs on its enabled `schedule:`; the Claude half
 * is gated behind the token so the workflow is always green tokenless (D8).
 */

/**
 * The 6 EXPERIMENTS (PLAN §11 / brain GAPS-AND-DISPUTES X-1..X-6) — each becomes a sub-agent task when the Claude
 * half is enabled. Defined declaratively so the single spawn site below carries the explicit model on every task.
 */
export const EXPERIMENTS = [
  { id: "X-1", goal: "measure multi-instance + HTTP/2-hold limiter behavior against live Upstash" },
  { id: "X-2", goal: "measure real commands/request + the fixed-instance break-even for the pinned algorithm" },
  { id: "X-3", goal: "verify revalidateTag laziness on the pinned Next version (P-26)" },
  { id: "X-4", goal: "verify distributed SETNX+Lua single-flight serializes the origin under concurrent cold-cache load" },
  { id: "X-5", goal: "measure GCRA memory/drift vs sliding-window" },
  { id: "X-6", goal: "confirm the CF-KV-fails-open negative result (O-20/S-14)" },
];

/**
 * The Claude half: spawn one Opus sub-agent per experiment to MEASURE (not assert) and write results to
 * brain/ORG_MEMORY.md. Gated by the caller on CLAUDE_CODE_OAUTH_TOKEN (D8) — this function is only reached when the
 * token is present. `spawn` is injected by the harness runner (the workflow engine), keeping this file runner-agnostic.
 *
 * @param {(task: { model: string, prompt: string }) => Promise<unknown>} spawn — the agent-spawn primitive.
 */
export async function runExperiments(spawn) {
  const results = [];
  for (const exp of EXPERIMENTS) {
    // D12/D14: EXPLICIT model on EVERY spawn — claude-opus-4-8[1m], max effort. No bare-default inheritance.
    const task = spawn({
      model: "claude-opus-4-8[1m]",
      prompt:
        `You are echo's RSI experiment runner. Run experiment ${exp.id}: ${exp.goal}. ` +
        `MEASURE the outcome (do not assert from memory). Write the measured result + date to brain/ORG_MEMORY.md, ` +
        `and if a GAPS-AND-DISPUTES dispute is now settled, propose moving it into OPINIONS with the measured backing. ` +
        `Return a one-line summary of what you measured.`,
    });
    results.push({ id: exp.id, result: await task });
  }
  return results;
}

export default { EXPERIMENTS, runExperiments };
