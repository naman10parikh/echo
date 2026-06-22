/**
 * echo eval — L3 trajectory judge (E1; PLAN §6 "L3 = trajectory LLM-judge, calibrated").
 *
 * L3 grades a *trajectory*: give a fresh agent only the scenario SETUP + TRIGGER and check it reaches the
 * RESOLUTION without committing the WRONG MOVE. For echo the "trajectory" we can grade deterministically is
 * echo's OWN emitted answer for the scenario's trigger — does the shipped command, given the scenario, produce
 * the resolution property (refuse CF-KV, recommend a Durable Object, name the concurrency dimension, …)?
 *
 * Two modes (Hamel "calibrated, gated on the key"):
 *   1. DETERMINISTIC STAND-IN (default, $0, runs on a bare checkout + in CI without secrets): a focused regex
 *      grader over echo's emitted answer. This is the calibrated proxy — it is the SAME property the L1 assert
 *      checks, but framed as "did the trajectory reach the resolution". It is deterministic so `pass^k` is
 *      meaningful and `npm run eval` is green with no API key.
 *   2. REAL LLM JUDGE (additive, gated on ANTHROPIC_API_KEY): when the key is present, an Anthropic
 *      `claude-opus-4-8[1m]` call grades the same trajectory and we AND the two verdicts (the real judge can
 *      only make the bar stricter, never looser — it never turns a deterministic FAIL into a PASS). This keeps
 *      the merge gate non-flaky (deterministic) while letting the nightly run exercise the real judge (D8-style
 *      "present-but-deferred": no key → the deterministic verdict stands).
 *
 * Design (Karpathy Simplicity-First): zero new deps. The real-judge call uses the Anthropic *Messages REST API*
 * via `fetch` (already global in Node 18+) — no SDK import, no install. Fully fail-soft: any network/parse error
 * falls back to the deterministic verdict (a judge outage must never red-block the eval).
 */

/** A single L3 trajectory grading spec attached to a golden task. */
export interface JudgeSpec {
  /** the scenario id (S-14, S-17, S-19) — for traceability in the report. */
  readonly scenario: string;
  /** the trajectory question put to the judge ("given this trigger, did the answer reach the resolution?"). */
  readonly question: string;
  /** echo's emitted answer for the scenario trigger (the trajectory under grade). */
  readonly answer: string;
  /** the deterministic resolution check (the calibrated proxy + the strict floor the real judge ANDs with). */
  readonly resolutionRegex: RegExp;
  /** the wrong-move the trajectory must NOT contain (if present → FAIL even when the resolution is also present). */
  readonly wrongMoveRegex?: RegExp;
}

/** A judge verdict. `source` records which grader produced it (for the report). */
export interface Verdict {
  readonly passed: boolean;
  readonly detail: string;
  readonly source: "deterministic" | "llm+deterministic";
}

/** The model the real L3 judge runs on (D12/D14: every echo node is Opus 4.8 max). Overridable for forward-compat. */
const JUDGE_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8[1m]";

/**
 * The deterministic trajectory grade: the answer reaches the resolution (regex hits) AND does not contain the
 * wrong move. This is the calibrated proxy that runs everywhere ($0, no key) and the strict floor the real judge
 * can only tighten.
 */
function deterministicVerdict(spec: JudgeSpec): { passed: boolean; detail: string } {
  const reachesResolution = spec.resolutionRegex.test(spec.answer);
  const hasWrongMove = spec.wrongMoveRegex ? spec.wrongMoveRegex.test(spec.answer) : false;
  const passed = reachesResolution && !hasWrongMove;
  const detail = passed
    ? `trajectory reaches the resolution (${spec.scenario})`
    : hasWrongMove
      ? `trajectory contains the WRONG MOVE (${spec.scenario})`
      : `trajectory does NOT reach the resolution (${spec.scenario})`;
  return { passed, detail };
}

/**
 * Grade an L3 trajectory. Deterministic by default; if `ANTHROPIC_API_KEY` is set, ALSO ask the real judge and
 * AND the verdicts (strictly tightening). Always fail-soft to the deterministic verdict.
 */
export async function judge(spec: JudgeSpec): Promise<Verdict> {
  const det = deterministicVerdict(spec);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return { ...det, source: "deterministic" };
  }
  try {
    const llmPass = await askRealJudge(spec, key);
    // AND the verdicts: the real judge can only make the bar STRICTER (never flips a deterministic FAIL → PASS).
    const passed = det.passed && llmPass;
    return {
      passed,
      detail: passed ? `${det.detail} (LLM judge concurs)` : det.passed ? "LLM judge dissents (stricter)" : det.detail,
      source: "llm+deterministic",
    };
  } catch {
    // Intentionally silent: a judge outage must never red-block the eval — fall back to the deterministic verdict.
    return { ...det, source: "deterministic" };
  }
}

/**
 * Ask the real Anthropic judge whether the trajectory reaches the resolution. Returns a boolean. Uses the
 * Messages REST API via `fetch` (no SDK). The prompt forces a strict `PASS`/`FAIL` token so parsing is trivial.
 */
async function askRealJudge(spec: JudgeSpec, apiKey: string): Promise<boolean> {
  const body = {
    model: JUDGE_MODEL,
    max_tokens: 16,
    system:
      "You grade whether a rate-limiting/caching expert's answer reaches the correct RESOLUTION for a scenario " +
      "without committing the WRONG MOVE. Reply with EXACTLY one token: PASS or FAIL. No other text.",
    messages: [
      {
        role: "user",
        content:
          `SCENARIO ${spec.scenario}.\nQUESTION: ${spec.question}\n\nTHE ANSWER UNDER GRADE:\n` +
          "```\n" +
          spec.answer.slice(0, 4000) +
          "\n```\n\nDid the answer reach the resolution without the wrong move? Reply PASS or FAIL.",
      },
    ],
  };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`judge HTTP ${res.status}`);
  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = (json.content ?? []).map((c) => c.text ?? "").join(" ").trim().toUpperCase();
  return text.startsWith("PASS");
}
