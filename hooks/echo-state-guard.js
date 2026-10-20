#!/usr/bin/env node
/**
 * echo-state-guard — the signature PreToolUse hook (the `new Map()`-on-serverless guard; B5).
 *
 * Fires on Edit|Write. When an edit introduces a `new Map()`/`Set()`/`{}`/`LRU` used as a SOURCE OF TRUTH for
 * cross-request state under an `app/api/**` (or `pages/api/**`) path, it BLOCKS (P-01), and it EXPLICITLY ALLOWS
 * `ephemeralCache: new Map()` passed to @upstash/ratelimit (P-02 — the ONE legit module-scope Map). This is
 * acceptance-test clause 3 (PLAN §5) at edit-time — the same judgment as `echo audit`, at the moment of writing.
 *
 * ONE RULE, ONE PLACE: the verdict comes from `scanText()` in `dist/lib/map-detector.js` — the exact same detector
 * the `echo audit` CLI (B3) uses. The hook adds nothing to the rule; it only routes the right slice of the
 * Edit/Write payload through it (keys-as-contracts, O-13, applied to our own code).
 *
 * Wiring (.claude/settings.json): PreToolUse matcher "Edit|Write" → `node hooks/echo-state-guard.js`.
 *
 * Contract (Claude Code PreToolUse):
 *   stdin  = { tool_name, tool_input: { file_path, content?, new_string? }, session_id, cwd, ... }
 *   stdout (block) = { hookSpecificOutput: { hookEventName:"PreToolUse", permissionDecision:"deny",
 *                      permissionDecisionReason: "..." } }
 *   stdout (pass)  = "{}"   (and exit 0)
 *
 * FAIL-OPEN by design: this is a developer-ergonomics guard on the *product* side (steering an edit), not a
 * security gate on echo's own runtime. If the detector can't be loaded (stale/missing `dist/`) or the payload is
 * malformed, the hook allows the edit ("{}") rather than blocking a developer over our own build state. (echo's
 * fail-CLOSED stance, O-04, is for *limiters on security endpoints* — not for a lint hook.) The CLI `echo audit`
 * + the CI acceptance test are the authoritative gate; this hook is the early warning.
 */

import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Only serverless-handler paths are the P-01 surface. A `new Map()` in a normal module is fine; the bug is
// specific to a process the platform shares/recycles/fans out (a request handler under app/api or pages/api).
const SERVERLESS_PATH_RE = /(?:^|\/)(?:app|src\/app|pages|src\/pages)\/api\//;

/** Read all of stdin as a string. */
async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

/** Allow the tool call through (the default / fail-open). */
function allow() {
  process.stdout.write("{}");
}

/** Block the tool call with a reason (P-01). */
function block(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
}

/**
 * Load the shared detector from the built CLI. Returns `scanText` or null (→ fail-open). The detector is the
 * SINGLE source of the P-01/P-02 rule; we never re-implement it here.
 */
async function loadScanText() {
  // hooks/ is at the repo root; the compiled detector is dist/lib/map-detector.js (relative to repo root).
  // A plugin install has no dist/, so fall back to the source file: Node 22.18+ strips its types on import.
  const candidates = [
    join(__dirname, "..", "dist", "lib", "map-detector.js"),
    join(__dirname, "..", "src", "lib", "map-detector.ts"),
  ];
  for (const detectorPath of candidates) {
    try {
      const mod = await import(detectorPath);
      if (typeof mod.scanText === "function") return mod.scanText;
    } catch {
      // Intentionally silent: try the next candidate; none loading means fail-open below.
    }
  }
  return null; // stale/missing build and no type-stripping Node → fail-open (don't block a dev over our build state)
}

async function main() {
  const raw = await readStdin();

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return allow(); // malformed payload → fail-open
  }

  const toolName = data?.tool_name;
  if (toolName !== "Edit" && toolName !== "Write") return allow();

  const input = data?.tool_input ?? {};
  const filePath = input.file_path ?? "";

  // Scope to serverless handlers only — that is where P-01 bites.
  if (!SERVERLESS_PATH_RE.test(String(filePath))) return allow();

  // Write carries the full new file body in `content`; Edit carries the edited region in `new_string`.
  // Scan whichever is present (concatenate so a multi-field payload is fully covered).
  const text = [input.content, input.new_string].filter((s) => typeof s === "string").join("\n");
  if (!text) return allow();

  const scanText = await loadScanText();
  if (!scanText) return allow(); // detector unavailable → fail-open

  let result;
  try {
    result = scanText(filePath || "edit", text);
  } catch {
    return allow(); // detector should never throw, but if it does, don't block the dev
  }

  const bugs = result?.bugs ?? [];
  if (bugs.length > 0) {
    const first = bugs[0];
    const loc = isAbsolute(first.file) ? first.file : first.file;
    return block(
      `⛔ [echo-state-guard] source-of-truth Map on serverless (P-01) at ${loc}:${first.line} — ` +
        `\`${first.code}\`. A module-scope Map/Set/{} in app/api/** is empty on cold start AND shared+raced under ` +
        `Vercel Fluid Compute (cross-user bleed + fail-open limiter). Externalize to Upstash/Redis/Supabase/KV ` +
        `(O-01). If this is the legit \`ephemeralCache: new Map()\` over @upstash/ratelimit, that one is allowed (P-02).`,
    );
  }

  // No source-of-truth Map (clean, or only ephemeralCache/pool/local Maps → P-02/OK) → allow.
  return allow();
}

main();
