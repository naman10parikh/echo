/**
 * `echo audit <path>` — the P-01/P-02 detector (the turbo seam echo OWNS; PLAN §4.1, §5 clause 3, B3).
 *
 * Scans a path for TS/TSX files and flags a `new Map()`/module-scope counter used as a SOURCE OF TRUTH
 * (P-01 → BUG, exit 1, prints `file:line` + reason) while PASSING `ephemeralCache: new Map()` (P-02 → OK, exit 0).
 * The judgment lives in `../lib/map-detector` (shared with the B5 hook — one rule, one place). Malformed TS is
 * handled gracefully (read errors skip the file; the regex scan never throws) → Testing §9 chaos: exit≠0 only on
 * a real bug or a path error, never a crash.
 *
 * Exit codes: 0 = clean (no source-of-truth Map; ephemeralCache passes), 1 = at least one P-01 bug OR a bad path.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import chalk from "chalk";
import { scanText, type MapFinding } from "../lib/map-detector.js";

const SCAN_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".next", "coverage"]);

/** Recursively collect scannable source files under `dir`. */
function collectFiles(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc; // unreadable dir → skip, don't crash
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) collectFiles(full, acc);
    else if (SCAN_EXT.test(name)) acc.push(full);
  }
  return acc;
}

/** Run the audit over `path` (a file or directory). Returns the process exit code. */
export function runAudit(path: string, opts: { json?: boolean } = {}): number {
  if (!existsSync(path)) {
    process.stderr.write(chalk.red(`echo audit: path not found: ${path}\n`));
    return 1;
  }

  let files: string[];
  try {
    files = statSync(path).isDirectory() ? collectFiles(path) : [path];
  } catch {
    process.stderr.write(chalk.red(`echo audit: cannot read path: ${path}\n`));
    return 1;
  }

  const bugs: MapFinding[] = [];
  const okMaps: MapFinding[] = [];
  for (const f of files) {
    let text: string;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue; // unreadable file → skip (chaos-safe)
    }
    const res = scanText(relative(process.cwd(), f) || f, text);
    bugs.push(...res.bugs);
    okMaps.push(...res.okMaps);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ bugs, okMaps, filesScanned: files.length }, null, 2) + "\n");
    return bugs.length > 0 ? 1 : 0;
  }

  for (const ok of okMaps) {
    process.stdout.write(
      chalk.green("OK  ") + chalk.dim(`${ok.file}:${ok.line}  `) + ok.reason + "\n",
    );
  }
  for (const bug of bugs) {
    process.stdout.write(
      chalk.red("BUG ") + chalk.bold(`${bug.file}:${bug.line}  `) + bug.reason + "\n" +
        chalk.dim(`      ${bug.code}\n`),
    );
  }

  if (bugs.length > 0) {
    process.stdout.write(
      chalk.red(`\n${bugs.length} source-of-truth Map(s) on serverless — externalize to Upstash/Redis (O-01).\n`),
    );
    return 1;
  }
  process.stdout.write(
    chalk.green(`\nclean — ${files.length} file(s) scanned, no source-of-truth Map (P-01).\n`),
  );
  return 0;
}
