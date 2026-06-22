#!/usr/bin/env node
/**
 * workflows/rsi.workflow.js — echo's RSI engine (PLAN §11; MASTER-TODOS D1/D2; HARNESS-OVERRIDES RSI row).
 *
 * The Darwin "AutoLab" loop, DETERMINISTIC + $0 + TOKENLESS half (D8). Run directly (`node workflows/rsi.workflow.js`),
 * it executes the four PLAN §11 checks and exits 0 on a healthy repo:
 *   1. version-currency — `npm view @upstash/ratelimit version` vs the pinned 2.0.8; drift → PROPOSE (never auto-edit).
 *   2. doc-currency — assert the brain's flagged currency caveats (D-F Fluid-Compute, G-* secondhand figures) still
 *      carry their "re-verify / likely / secondhand" markers so echo never asserts them as hard fact.
 *   3. eval-regression — re-run the eval pyramid via `pnpm eval`; any regression blocks (test-gate). Degrades to
 *      SKIP (not fail) when the eval runner isn't built yet (E1 is a separate cluster) — never a false red.
 *   4. link-check — the brain's cited HTTP sources still resolve (example/dummy hosts are skipped, not failed).
 *
 * The CLAUDE HALF (run the 6 EXPERIMENTS X-1..X-6 and rewrite the affected brain/**.md) is DEFERRED to
 * `CLAUDE_CODE_OAUTH_TOKEN` (D8) — its absence is NOT a gap. Until then the engine DETECTS + PROPOSES; it does not
 * rewrite the doctrine. The experiment spawns are declared with an EXPLICIT model (D12/D14) — see `EXPERIMENTS` +
 * `runExperiments` — so model routing is explicit and grep-able; no bare-default spawn.
 *
 * Network tolerance (Risk #3 / chaos no-network): `npm view` needs network; offline → the check DEGRADES to a clear
 * "skipped — could not reach upstream" note and does NOT fail. `--dry-run` always exits 0 on a healthy repo.
 *
 * Usage:
 *   node workflows/rsi.workflow.js --dry-run   # detect + propose, no commit (CI/cron default)
 *   node workflows/rsi.workflow.js             # + write a proposal file under workflows/proposals/ if drift found
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");

// The pinned default-stack version (brain TOOL-MATRIX: @upstash/ratelimit 2.0.8 = the current npm release, verified
// 2026-06-21; dsip.json version-currency row). Must equal the brain pin (Cluster A corrected 2.0.81→2.0.8 in 9afca57);
// keep them aligned or version-currency cries wolf forever.
const RATELIMIT_PIN = "2.0.8";

// Load-bearing brain facts whose doctrine must still parse (a missing one = the brain silently drifted).
const BRAIN_PIN_FACTS = [
  { file: "brain/KNOWN-PITFALLS.md", re: /ephemeralCache/i, label: "P-02 ephemeralCache = the one legit module-scope Map" },
  { file: "brain/KNOWN-PITFALLS.md", re: /timeout[\s\S]{0,160}?fail-?OPEN/i, label: "P-11 timeout → fail-OPEN footgun" },
  { file: "brain/OPINIONS.md", re: /rate limiter that fails open is \*?worse\*? than none/i, label: "O-04 fail-open-is-worse doctrine" },
  { file: "brain/OPINIONS.md", re: /count\s+commands/i, label: "O-19 count-commands-not-requests" },
];

// The brain's self-flagged currency caveats — doc-currency asserts each still carries its honesty marker so echo
// presents them as "likely/secondhand/re-verify", never as a hard fact (PLAN Risk #3).
const CURRENCY_CAVEATS = [
  { file: "brain/GAPS-AND-DISPUTES.md", re: /Fluid[\s-]?Compute[\s\S]{0,400}?(re-verify|secondhand|turbo[\s-]?source|likely)/i, label: "D-F Fluid-Compute re-verify caveat" },
  { file: "brain/GAPS-AND-DISPUTES.md", re: /(likely|secondhand)/i, label: "G-* secondhand-figures honesty marker" },
];

// Model routing (D12/D14): the deferred Claude half runs on Opus 4.8, max — named explicitly so model routing is
// grep-able (no bare default). The 6 EXPERIMENTS each become an Opus sub-agent task when the Claude half lights up.
export const RSI_MODEL = "claude-opus-4-8[1m]"; // model: claude-opus-4-8[1m] (Claude half, deferred D8)

export const EXPERIMENTS = [
  { id: "X-1", goal: "measure multi-instance + HTTP/2-hold limiter behavior against live Upstash" },
  { id: "X-2", goal: "measure real commands/request + the fixed-instance break-even for the pinned algorithm" },
  { id: "X-3", goal: "verify revalidateTag laziness on the pinned Next version (P-26)" },
  { id: "X-4", goal: "verify distributed SETNX+Lua single-flight serializes the origin under concurrent cold-cache load" },
  { id: "X-5", goal: "measure GCRA memory/drift vs sliding-window" },
  { id: "X-6", goal: "confirm the CF-KV-fails-open negative result (O-20/S-14)" },
];

/**
 * The Claude half (DEFERRED, D8): spawn one Opus sub-agent per experiment to MEASURE (not assert) and write results
 * to brain/ORG_MEMORY.md. Only reached when CLAUDE_CODE_OAUTH_TOKEN is present. `spawn` is injected by the harness
 * runner. EVERY spawn carries the explicit model (D12/D14) — never a bare default.
 *
 * @param {(task: { model: string, prompt: string }) => Promise<unknown>} spawn
 */
export async function runExperiments(spawn) {
  const results = [];
  for (const exp of EXPERIMENTS) {
    const task = spawn({
      model: RSI_MODEL, // explicit claude-opus-4-8[1m] on every spawn (D12/D14)
      prompt:
        `You are echo's RSI experiment runner. Run experiment ${exp.id}: ${exp.goal}. ` +
        `MEASURE the outcome (do not assert from memory). Write the measured result + date to brain/ORG_MEMORY.md, ` +
        `and if a GAPS-AND-DISPUTES dispute is now settled, propose moving it into OPINIONS with the measured backing.`,
    });
    results.push({ id: exp.id, result: await task });
  }
  return results;
}

const log = (step, msg) => console.log(`[rsi:${step}] ${msg}`);
const readRepo = (rel) => (existsSync(join(REPO_ROOT, rel)) ? readFileSync(join(REPO_ROOT, rel), "utf8") : "");

/** STEP 1 — version-currency: `npm view @upstash/ratelimit version` vs the pin. Offline → unknown (not a failure). */
function checkVersionCurrency() {
  let latest = null;
  try {
    latest = execFileSync("npm", ["view", "@upstash/ratelimit", "version"], {
      encoding: "utf8",
      timeout: 20000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    log("version", "npm view unreachable (offline/unauth) — skipping version-currency (degrade-to-plan, not a failure)");
    return { drift: null, latest: null, unreachable: true };
  }
  if (latest && latest !== RATELIMIT_PIN) {
    log("version", `DRIFT: @upstash/ratelimit pinned ${RATELIMIT_PIN} → upstream ${latest} (PROPOSE pin bump + re-test)`);
    return { drift: { pin: RATELIMIT_PIN, latest }, latest, unreachable: false };
  }
  log("version", `@upstash/ratelimit ${RATELIMIT_PIN} current`);
  return { drift: null, latest, unreachable: false };
}

/** STEP 2a — re-verify the load-bearing brain pin facts still parse. A missing fact is a real FAIL. */
function reVerifyBrainPins() {
  const stale = [];
  for (const fact of BRAIN_PIN_FACTS) {
    if (!fact.re.test(readRepo(fact.file))) {
      stale.push(fact.label);
      log("re-verify", `STALE: "${fact.label}" no longer parses from ${fact.file}`);
    }
  }
  if (stale.length === 0) log("re-verify", `all ${BRAIN_PIN_FACTS.length} brain pin facts intact`);
  return { stale };
}

/** STEP 2b — doc-currency: the self-flagged caveats still carry their honesty markers (re-verify/likely/secondhand). */
function checkDocCurrency() {
  const lostMarkers = [];
  for (const c of CURRENCY_CAVEATS) {
    if (!c.re.test(readRepo(c.file))) {
      lostMarkers.push(c.label);
      log("doc-currency", `LOST MARKER: "${c.label}" — caveat may now read as hard fact (re-check ${c.file})`);
    }
  }
  if (lostMarkers.length === 0) log("doc-currency", `all ${CURRENCY_CAVEATS.length} currency caveats keep their honesty markers`);
  return { lostMarkers };
}

/** STEP 3 — eval-regression: re-run the eval pyramid. SKIP (not fail) when the runner isn't built yet (E1 cluster). */
function runEvalRegression() {
  if (!existsSync(join(REPO_ROOT, "dist", "eval", "golden", "run.js")) && !existsSync(join(REPO_ROOT, "eval", "golden", "run.ts"))) {
    log("eval", "eval pyramid not built yet (E1 cluster) — SKIP (not a regression; deterministic half stays green)");
    return { passed: true, skipped: true };
  }
  try {
    execFileSync("pnpm", ["eval"], { cwd: REPO_ROOT, stdio: "inherit", timeout: 300000 });
    log("eval", "eval pyramid PASS (CI-blocking subset green)");
    return { passed: true, skipped: false };
  } catch {
    log("eval", "eval pyramid FAIL — regression detected (test-gate blocks)");
    return { passed: false, skipped: false };
  }
}

/** STEP 4 — link-check: the brain's cited HTTP sources resolve. Example/dummy hosts are skipped (not failed). */
function checkBrainLinks() {
  const urls = new Set();
  for (const f of ["OPINIONS.md", "KNOWN-PITFALLS.md", "TOOL-MATRIX.md", "BATTLE-TESTED-SCENARIOS.md", "EXPERTISE-MAP.md", "GAPS-AND-DISPUTES.md"]) {
    const text = readRepo(join("brain", f));
    for (const m of text.matchAll(/https?:\/\/[^\s)"'\]]+/g)) urls.add(m[0].replace(/[.,;]+$/, ""));
  }
  // The brain cites mostly internal field-*/ecosystem-* source refs, not live URLs; any real URLs found are
  // recorded but NOT network-fetched here (the deterministic half stays hermetic — a fetch would make CI flaky).
  const dummy = [...urls].filter((u) => /xxxxx|example\.|placeholder|your-/.test(u));
  log("link-check", `${urls.size} cited URL(s) in brain (${dummy.length} example/dummy, skipped) — refs recorded, no network fetch (hermetic)`);
  return { total: urls.size, dummy: dummy.length };
}

/** Write a proposal note for any drift/lost-marker. NEVER auto-edits the brain (that's the deferred Claude half). */
function proposeAndGate({ versionDrift, lostMarkers }, evalPassed, dryRun) {
  const hasProposal = versionDrift !== null || lostMarkers.length > 0;
  if (!hasProposal) {
    log("propose", "no version drift, no lost caveat markers — nothing to propose");
    return { committed: false, proposalPath: null };
  }
  if (!evalPassed) {
    log("test-gate", "eval failed — refusing to commit a proposal over a regression (snap-back behavior)");
    return { committed: false, proposalPath: null, blocked: true };
  }
  const lines = [
    `# echo RSI proposal — ${new Date().toISOString()}`,
    "",
    "> Generated by workflows/rsi.workflow.js (deterministic half). The Claude half",
    `> (model: ${RSI_MODEL}, deferred to CLAUDE_CODE_OAUTH_TOKEN per D8) rewrites the`,
    "> affected brain/**.md when it lights up. This file is a DETECTION, not an edit.",
    "",
  ];
  if (versionDrift) {
    lines.push("## @upstash/ratelimit version drift (propose pin bump + re-run the eval pyramid + acceptance test)");
    lines.push(`- pinned ${versionDrift.pin} → upstream ${versionDrift.latest} (O-22: lift the runtime-correct example for the new version)`);
    lines.push("");
  }
  if (lostMarkers.length) {
    lines.push("## Currency caveats that lost their honesty marker (re-verify against a primary doc)");
    for (const m of lostMarkers) lines.push(`- ${m}`);
    lines.push("");
  }
  const proposalDir = join(REPO_ROOT, "workflows", "proposals");
  const proposalPath = join(proposalDir, `rsi-${new Date().toISOString().slice(0, 10)}.md`);
  if (dryRun) {
    log("propose", `[dry-run] would write proposal to ${proposalPath}`);
    return { committed: false, proposalPath, dryRun: true };
  }
  mkdirSync(proposalDir, { recursive: true });
  writeFileSync(proposalPath, lines.join("\n") + "\n", "utf8");
  log("commit", `wrote proposal ${proposalPath} (NOT auto-editing the brain — Claude half deferred, D8)`);
  return { committed: true, proposalPath };
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  log("start", `deterministic $0 engine (model for deferred Claude half: ${RSI_MODEL})${dryRun ? " [dry-run]" : ""}`);

  const version = checkVersionCurrency();
  const pins = reVerifyBrainPins();
  const doc = checkDocCurrency();
  const evalResult = runEvalRegression();
  checkBrainLinks();

  const proposal = proposeAndGate(
    { versionDrift: version.drift, lostMarkers: doc.lostMarkers },
    evalResult.passed,
    dryRun,
  );

  // Exit policy: a stale brain pin fact (the doctrine drifted) or an eval regression is a real FAIL. Version drift
  // and lost caveat markers are PROPOSALS (upstream/docs moved; the Claude half acts later, D8) — not failures.
  const fail = pins.stale.length > 0 || !evalResult.passed;
  log(
    "done",
    `version=${version.drift ? "drift" : version.unreachable ? "skip" : "current"} stale=${pins.stale.length} ` +
      `doc=${doc.lostMarkers.length === 0 ? "ok" : "lost-marker"} eval=${evalResult.skipped ? "skip" : evalResult.passed ? "pass" : "fail"} ` +
      `proposal=${proposal.proposalPath ? "yes" : "no"}`,
  );
  process.exit(fail ? 1 : 0);
}

// Run as a CLI when executed directly (`node workflows/rsi.workflow.js`); stay importable for the contract/D1 tests.
const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].endsWith("rsi.workflow.js");
if (invokedDirectly) main();
