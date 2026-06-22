#!/usr/bin/env node
/**
 * echo cockpit — the chairman's eyes on the rate-limit/cache employee (PLAN §10; D3; Cluster G).
 *
 * A zero-dependency Node `http` server (the proven sentinel/talent-intel stdlib pattern, kept in-language so it can
 * import echo's own compiled `dist/` modules directly instead of shelling Python↔Node). Serves a warm-black Energy
 * SPA on localhost:7779 with the four §10 views and their JSON APIs:
 *
 *   1. Brain browser     — the 6 brain artifacts rendered + a BM25 search box        → GET /api/artifact, /api/brain
 *   2. Run log           — logs/runs.jsonl with the domain-native commands/request    → GET /api/runs
 *   3. Eval scores       — the Hamel L1/L2/L3 pyramid + acceptance status + pass^k    → GET /api/eval
 *   4. Ask-the-employee  — `echo ask` (askBrain) → answer + brain citations           → GET /api/ask
 *
 * G1 delivers the served shell + the four view routes; G2 wires them to live data (this file does both — the data
 * wiring is small enough that splitting G1/G2 across files would be gold-plating; the SPA lives in static/cockpit/).
 *
 * Robustness (mirrors sentinel's "missing module → honest 503, never crash boot"): the `dist/` imports are LAZY and
 * fail-soft. If `pnpm build` hasn't run, the shell + static still serve 200 and each data route returns a 503 with a
 * plain "run pnpm build" message — so `node scripts/cockpit.mjs` always boots (the G1 verify hits `/`).
 *
 * Security: localhost-only bind, GET-only, 8 MB body cap is N/A (no POST), artifact path-traversal guarded to brain/.
 * Never prints a secret (it reads none — the cockpit is a read-only window over local files + pure functions).
 */
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url)); // .../echo/scripts
const REPO = resolve(HERE, ".."); // .../echo
const STATIC = join(HERE, "cockpit"); // .../echo/scripts/cockpit (the SPA assets)
const BRAIN = join(REPO, "brain");
const PORT = Number(process.env.ECHO_COCKPIT_PORT || 7779); // PLAN §14 (sentinel=7777; sibling spacing)

// The 6 indexed brain artifacts shown in the Brain browser (preamble/MOC/ORG_* carry no O-/P-/S- rows → excluded,
// matching src/brain-index.ts INDEXED_FILES so the browser and the search index agree on "what echo knows").
const BRAIN_ARTIFACTS = [
  "EXPERTISE-MAP.md",
  "BATTLE-TESTED-SCENARIOS.md",
  "KNOWN-PITFALLS.md",
  "OPINIONS.md",
  "GAPS-AND-DISPUTES.md",
  "TOOL-MATRIX.md",
];

const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** Lazily import echo's compiled brain-index (the queryable memory layer). Fail-soft: returns null if unbuilt. */
async function loadBrainModule() {
  const path = join(REPO, "dist", "brain-index.js");
  if (!existsSync(path)) return null;
  try {
    return await import(`file://${path}`);
  } catch {
    return null; // a broken/partial build → 503 on the data routes, never a boot crash
  }
}

/** Send a JSON response with the given status. */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

/** Send a plain-text error. */
function sendText(res, status, msg) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(msg);
}

/** GET /api/brain?q=<query> — BM25 hits over brain/ (the search box). */
async function handleBrain(res, q) {
  const mod = await loadBrainModule();
  if (!mod) return sendJson(res, 503, { error: "brain index unbuilt — run `pnpm build` then `pnpm run brain:index`" });
  const query = (q || "").trim();
  if (!query) return sendJson(res, 200, { query: "", hits: [] });
  const hits = mod.searchBrain(query, 8);
  return sendJson(res, 200, { query, hits });
}

/** GET /api/ask?q=<question> — `echo ask`: the top brain answer + citations (the Ask-the-employee box). */
async function handleAsk(res, q) {
  const mod = await loadBrainModule();
  if (!mod) return sendJson(res, 503, { error: "brain index unbuilt — run `pnpm build` then `pnpm run brain:index`" });
  const question = (q || "").trim();
  if (!question) return sendJson(res, 200, { question: "", answer: "", citations: [] });
  const { answer, citations } = mod.askBrain(question);
  return sendJson(res, 200, { question, answer, citations });
}

/** GET /api/runs — the last N lines of logs/runs.jsonl, newest first, parsed (the Run log view). */
async function handleRuns(res) {
  const path = join(REPO, "logs", "runs.jsonl");
  if (!existsSync(path)) return sendJson(res, 200, { runs: [], note: "no runs yet — invoke any `echo` command" });
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch {
    return sendJson(res, 200, { runs: [], note: "run log unreadable" });
  }
  const runs = text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((r) => r !== null)
    .reverse() // newest first
    .slice(0, 200);
  // Surface the domain-native metric: the most recent run that carried commands/request (O-19).
  const lastCost = runs.find((r) => typeof r.cmdsPerReq === "number");
  return sendJson(res, 200, { runs, lastCost: lastCost ?? null });
}

/** GET /api/artifact?f=<FILE.md> — a brain artifact's raw markdown (path-traversal guarded to BRAIN_ARTIFACTS). */
async function handleArtifact(res, f) {
  const name = basename(f || ""); // strip any path components (traversal guard)
  if (!BRAIN_ARTIFACTS.includes(name)) return sendJson(res, 404, { error: `unknown artifact: ${f}` });
  const path = join(BRAIN, name);
  // Defense-in-depth: confirm the resolved path is still inside brain/.
  if (!resolve(path).startsWith(resolve(BRAIN))) return sendJson(res, 403, { error: "path escapes brain/" });
  if (!existsSync(path)) return sendJson(res, 404, { error: `missing: ${name}` });
  const markdown = await readFile(path, "utf8");
  return sendJson(res, 200, { file: name, markdown });
}

/** GET /api/artifacts — the list of brain artifacts (the Brain browser's left nav). */
function handleArtifactList(res) {
  return sendJson(res, 200, { artifacts: BRAIN_ARTIFACTS });
}

/**
 * GET /api/eval — run the canonical eval (`dist/eval/golden/run.js`) and return its parsed report (the Eval view).
 *
 * We re-run the REAL eval (not a cached snapshot) so the cockpit can never drift from the merge gate; the runner is
 * deterministic + $0 (the L3 judge falls back to the deterministic grader without ANTHROPIC_API_KEY). Parsed into
 * { tasks[], calibration[], summary, exitCode } for rendering; the raw stdout is included for the receipts view.
 */
async function handleEval(res) {
  const runner = join(REPO, "dist", "eval", "golden", "run.js");
  if (!existsSync(runner)) return sendJson(res, 503, { error: "eval unbuilt — run `pnpm build`" });
  let stdout = "";
  let exitCode = -1;
  try {
    ({ stdout, exitCode } = await runNode(runner));
  } catch (err) {
    return sendJson(res, 500, { error: `eval run failed: ${err?.message || err}` });
  }
  return sendJson(res, 200, { ...parseEval(stdout), exitCode, raw: stdout });
}

/** Spawn `node <file>` and capture stdout + exit code (no shell, deterministic). */
function runNode(file) {
  return new Promise((res2, rej) => {
    const child = spawn(process.execPath, [file], { cwd: REPO, env: process.env });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stdout += d.toString())); // fold stderr in so a runtime error is visible
    child.on("error", rej);
    child.on("close", (code) => res2({ stdout, exitCode: code ?? -1 }));
  });
}

/** Parse the eval runner's ANSI-free report into structured tasks + calibration rows + a summary line. */
function parseEval(out) {
  const lines = out.split("\n");
  const tasks = [];
  const calibration = [];
  let summary = "";
  for (const line of lines) {
    // GOLDEN line: "  PASS  🔴 GT-1 [L1] S-01 — emits ... (pass^3)"
    const gt = line.match(/^\s*(PASS|FAIL)\s+(🔴|🟠)\s+(GT-\d+)\s+\[(L\d)\]\s+(S-\d+)\s+—\s+(.+)$/);
    if (gt) {
      tasks.push({ status: gt[1], block: gt[2] === "🔴" ? "blocking" : "advisory", id: gt[3], level: gt[4], scenario: gt[5], desc: gt[6].trim() });
      continue;
    }
    // CALIBRATION line: "  PASS  map-detector (S-01/P-01): n=35 P=1.00 R=0.94 F1=0.97 κ=0.94 (bar: ...)"
    const cal = line.match(/^\s*(PASS|FAIL)\s+([a-z-]+)\s+\(([^)]+)\):\s+(.+)$/);
    if (cal && /F1=|κ=/.test(cal[4])) {
      calibration.push({ status: cal[1], detector: cal[2], scenarios: cal[3], metrics: cal[4].replace(/\s*\(bar:.*$/, "").trim() });
      continue;
    }
    if (/^PASS:|^FAIL:/.test(line.trim())) summary = line.trim();
  }
  return { tasks, calibration, summary };
}

/** Serve a static file from scripts/cockpit/ (path-traversal guarded). */
async function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const path = join(STATIC, rel);
  if (!resolve(path).startsWith(resolve(STATIC))) return sendText(res, 403, "forbidden");
  if (!existsSync(path)) return sendText(res, 404, "not found");
  const s = await stat(path);
  if (!s.isFile()) return sendText(res, 404, "not found");
  const body = await readFile(path);
  res.writeHead(200, { "content-type": STATIC_TYPES[extname(path)] || "application/octet-stream", "content-length": body.length });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method !== "GET") return sendText(res, 405, "method not allowed (cockpit is read-only)");
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = url.pathname;
    const q = url.searchParams.get("q") || "";

    if (p === "/api/brain") return await handleBrain(res, q);
    if (p === "/api/ask") return await handleAsk(res, q);
    if (p === "/api/runs") return await handleRuns(res);
    if (p === "/api/eval") return await handleEval(res);
    if (p === "/api/artifacts") return handleArtifactList(res);
    if (p === "/api/artifact") return await handleArtifact(res, url.searchParams.get("f") || "");
    if (p === "/api/health") return sendJson(res, 200, { ok: true, port: PORT, agent: "echo" });

    // Everything else → the SPA shell / static assets.
    return await serveStatic(res, p);
  } catch (err) {
    return sendText(res, 500, `cockpit error: ${err?.message || err}`);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`echo cockpit → http://localhost:${PORT}  (brain · runs · evals · ask)\n`);
});
