/**
 * echo EVAL RUNNER — `npm run eval` → `dist/eval/golden/run.js` (E1; PLAN §6, §9; HARNESS-OVERRIDES §9).
 *
 * Runs the full Hamel pyramid and prints a binary (pass/fail, NOT Likert) report:
 *
 *   1. GOLDEN TASKS (GT-1..GT-14): each task's L1/L2 `assert` is run k≥3 times (pass^k — a single passing trial
 *      is not evidence). A task passes iff ALL k trials pass. L3 tasks additionally run the trajectory `judge`
 *      (deterministic stand-in by default, real Anthropic judge when ANTHROPIC_API_KEY is set — strictly
 *      tightening; see ../judge.ts).
 *
 *   2. L2 CALIBRATION: echo's OWN detectors (the SHIPPED `scanText` behind `echo audit`; the spoofable-key
 *      classifier) are run over the labeled `corpus.ts` rows (≥50, mined from the BATTLE-TESTED-SCENARIOS
 *      WRONG-MOVE/RESOLUTION pairs). We compute precision / recall / F1 / Cohen's κ and assert the §9 bar:
 *      F1 ≥ 0.8 OR κ ≥ 0.6. This proves the binary judgment is a CALIBRATED decision, not a coin flip.
 *
 * EXIT CODE (the merge gate): non-zero iff (a) ANY 🔴 CI-blocking golden task fails, or (b) a calibration corpus
 * falls below the F1/κ bar. 🟠 tasks and the L3 judge dissent are REPORTED but do not red-block (PLAN §6: 🟠 run
 * on PR + nightly). This is the eval-as-immune-system: it runs after the spine and after every extension.
 *
 * Design (Karpathy Simplicity-First): zero new deps, pure Node. Async only because the L3 judge may call the API.
 */
import { GOLDEN_TASKS, CI_BLOCKING_IDS, type GoldenTask } from "./tasks.js";
import { judge } from "../judge.js";
import { classifyMap, classifySpoofableKey } from "../lib/classifiers.js";
import { MAP_DETECTOR_CORPUS, SPOOFABLE_KEY_CORPUS, type CorpusRow } from "../lib/corpus.js";

/** How many times each L1/L2 assert is run (pass^k). ≥3 per HARNESS-OVERRIDES §9. */
const K = Number(process.env.ECHO_EVAL_K ?? 3);
/** The §9 calibration bar: a corpus passes iff F1 ≥ this OR κ ≥ KAPPA_BAR. */
const F1_BAR = 0.8;
const KAPPA_BAR = 0.6;

/** ANSI-free status glyphs (the report must grep cleanly for "pass"/"fail"). */
const PASS = "PASS";
const FAIL = "FAIL";

/** Run one task's `assert` K times; pass iff all K agree-pass (pass^k). Returns the binary result + a reason. */
function runAssertPassK(task: GoldenTask): { passed: boolean; detail: string } {
  let lastDetail = "";
  for (let i = 0; i < K; i++) {
    const r = task.assert();
    lastDetail = r.detail;
    if (!r.passed) return { passed: false, detail: `${r.detail} (failed on trial ${i + 1}/${K})` };
  }
  return { passed: true, detail: `${lastDetail} (pass^${K})` };
}

/** Binary-classification metrics for a corpus run with a "bad"/"good" classifier ("bad" = the positive class). */
interface Metrics {
  readonly tp: number;
  readonly fp: number;
  readonly tn: number;
  readonly fn: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  readonly kappa: number;
  readonly n: number;
}

/** Run a classifier over a labeled corpus and compute precision / recall / F1 / Cohen's κ ("bad" = positive). */
function calibrate(corpus: readonly CorpusRow[], classify: (code: string) => "bad" | "good"): Metrics {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const row of corpus) {
    const pred = classify(row.code);
    if (row.label === "bad" && pred === "bad") tp++;
    else if (row.label === "good" && pred === "bad") fp++;
    else if (row.label === "good" && pred === "good") tn++;
    else fn++; // label bad, pred good
  }
  const n = corpus.length;
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  // Cohen's κ for the 2×2 confusion matrix (agreement above chance).
  const po = (tp + tn) / n; // observed agreement
  const pBadActual = (tp + fn) / n;
  const pBadPred = (tp + fp) / n;
  const pe = pBadActual * pBadPred + (1 - pBadActual) * (1 - pBadPred); // expected by chance
  const kappa = pe === 1 ? 1 : (po - pe) / (1 - pe);
  return { tp, fp, tn, fn, precision, recall, f1, kappa, n };
}

/** Pretty-print a metrics block + whether it clears the §9 bar (F1≥0.8 OR κ≥0.6). */
function reportCalibration(name: string, m: Metrics): boolean {
  const cleared = m.f1 >= F1_BAR || m.kappa >= KAPPA_BAR;
  process.stdout.write(
    `  ${cleared ? PASS : FAIL}  ${name}: n=${m.n} P=${m.precision.toFixed(2)} R=${m.recall.toFixed(2)} ` +
      `F1=${m.f1.toFixed(2)} κ=${m.kappa.toFixed(2)} (bar: F1≥${F1_BAR} or κ≥${KAPPA_BAR})\n`,
  );
  return cleared;
}

async function main(): Promise<void> {
  process.stdout.write("echo eval — Hamel pyramid (binary pass/fail, pass^" + K + ")\n");
  process.stdout.write("═".repeat(96) + "\n");

  // ── 1. GOLDEN TASKS ────────────────────────────────────────────────────────────────────────────────────────
  process.stdout.write("GOLDEN TASKS (GT-1..GT-14 → S-01..S-19):\n");
  const failedBlocking: string[] = [];
  for (const task of GOLDEN_TASKS) {
    const res = runAssertPassK(task);
    const flag = task.ciBlock ? "🔴" : "🟠";
    process.stdout.write(
      `  ${res.passed ? PASS : FAIL}  ${flag} ${task.id} [${task.level}] ${task.scenario} — ${res.detail}\n`,
    );
    if (!res.passed && task.ciBlock) failedBlocking.push(task.id);

    // L3 trajectory judge (reported; deterministic stand-in unless ANTHROPIC_API_KEY tightens it). Never blocks
    // here on its own — the L1 proxy assert above is the merge floor; the judge is the calibrated trajectory view.
    if (task.judgeSpec) {
      const verdict = await judge(task.judgeSpec());
      process.stdout.write(
        `        └─ L3 judge (${verdict.source}): ${verdict.passed ? PASS : FAIL} — ${verdict.detail}\n`,
      );
    }
  }

  // ── 2. L2 CALIBRATION ──────────────────────────────────────────────────────────────────────────────────────
  process.stdout.write("\nL2 CALIBRATION (echo's OWN detectors over the mined WRONG-MOVE/RESOLUTION corpus):\n");
  const mapMetrics = calibrate(MAP_DETECTOR_CORPUS, classifyMap);
  const keyMetrics = calibrate(SPOOFABLE_KEY_CORPUS, classifySpoofableKey);
  const mapCleared = reportCalibration("map-detector (S-01/P-01)", mapMetrics);
  const keyCleared = reportCalibration("spoofable-key (S-02/P-04)", keyMetrics);
  const totalRows = mapMetrics.n + keyMetrics.n;
  process.stdout.write(`  (total calibration rows: ${totalRows} — §9 wants 50–100)\n`);

  // ── VERDICT ────────────────────────────────────────────────────────────────────────────────────────────────
  process.stdout.write("═".repeat(96) + "\n");
  const calibrationFailed = !mapCleared || !keyCleared;
  const blocked = failedBlocking.length > 0 || calibrationFailed || totalRows < 50;

  if (failedBlocking.length > 0) {
    process.stdout.write(`${FAIL}: 🔴 CI-blocking golden tasks failed: ${failedBlocking.join(", ")}\n`);
  }
  if (calibrationFailed) {
    process.stdout.write(`${FAIL}: a calibration corpus fell below the F1/κ bar.\n`);
  }
  if (totalRows < 50) {
    process.stdout.write(`${FAIL}: calibration corpus too small (${totalRows} < 50 rows).\n`);
  }

  const blockingTotal = CI_BLOCKING_IDS.length;
  const blockingPassed = blockingTotal - failedBlocking.length;
  if (!blocked) {
    process.stdout.write(
      `${PASS}: ${blockingPassed}/${blockingTotal} 🔴 golden tasks green; both corpora calibrated; ${totalRows} rows.\n`,
    );
  }
  process.exit(blocked ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`[eval] FAIL — unexpected error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
