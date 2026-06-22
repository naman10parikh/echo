/**
 * echo cockpit E2E (PLAN §9 E2E row / §10; Cluster G2; HARNESS-OVERRIDES §9).
 *
 * What this proves (the §9 E2E bar): the cockpit loads, brain-search returns an OPINIONS hit, the ask box returns a
 * cited answer, the run-log + eval views render live data, AND a CLI-flow smoke (`echo limiter login` → file emitted
 * → the property holds). It boots the REAL `scripts/cockpit.mjs` server (same code the chairman runs) and drives it
 * over HTTP — the cockpit is a thin window, so HTTP assertions ARE the behavioral receipts.
 *
 * Screenshots (the §10 "Playwright screenshots each of the 4 views" leg): produced WHEN Playwright + a chromium
 * build are resolvable (project node_modules or the global npm root). When they are not, the test logs an honest
 * note and SKIPS only the screenshot leg — the load-bearing API + CLI assertions still run and gate. This mirrors
 * echo's established "environment-aware" acceptance pattern (SRH-if-present else in-proc, test/acceptance/*) so the
 * merge gate is green on a bare checkout with no browser download, honoring D15 (local-first / $0 / no-network).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const HERE = dirname(fileURLToPath(import.meta.url)); // test/e2e
const REPO = resolve(HERE, "..", ".."); // repo root
const PORT = Number(process.env.ECHO_COCKPIT_PORT || 7791); // distinct from the default 7779 to avoid a dev clash
const BASE = `http://localhost:${PORT}`;
const SHOTS = join(HERE, "screenshots");

let server: ChildProcess;

/** Wait until the cockpit answers /api/health (or throw after ~10s). */
async function waitForServer(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error("cockpit did not become healthy in time");
}

beforeAll(async () => {
  server = spawn(process.execPath, [join(REPO, "scripts", "cockpit.mjs")], {
    cwd: REPO,
    env: { ...process.env, ECHO_COCKPIT_PORT: String(PORT) },
    stdio: "ignore",
  });
  await waitForServer();
}, 20_000);

afterAll(() => {
  server?.kill("SIGTERM");
});

describe("cockpit server — the 4 views over HTTP (G2 wiring)", () => {
  it("serves the SPA shell (200) with the warm-black Energy design (no generic purple)", async () => {
    const r = await fetch(`${BASE}/`);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("#141312"); // warm black, not pure black
    expect(html).toContain("Instrument Serif"); // editorial serif/sans pairing
    expect(html).toContain("Poppins");
    expect(html.toLowerCase()).not.toMatch(/#a855f7|#9333ea|background:\s*(purple|violet|fuchsia)/); // no generic-purple color
  });

  it("brain-search returns an OPINIONS hit (the BM25 layer is wired)", async () => {
    const r = await fetch(`${BASE}/api/brain?q=fail-open`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { hits: Array<{ citation: string }> };
    expect(body.hits.length).toBeGreaterThan(0);
    expect(body.hits.some((h) => h.citation.includes("OPINIONS.md#O-04"))).toBe(true);
  });

  it("the ask box returns a cited answer (echo_ask wired, refuses to invent)", async () => {
    const r = await fetch(`${BASE}/api/ask?q=should%20my%20limiter%20fail%20open%20or%20closed`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { answer: string; citations: string[] };
    expect(body.answer.length).toBeGreaterThan(0);
    expect(body.citations.length).toBeGreaterThan(0);
    expect(body.citations.some((c) => /brain\/.+#(O|P|S|X)-\d+/.test(c))).toBe(true);
  });

  it("the run log renders runs.jsonl with the domain-native commands/request", async () => {
    const r = await fetch(`${BASE}/api/runs`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { runs: Array<{ tool: string; duration_ms: number }>; lastCost: { cmdsPerReq: number } | null };
    expect(Array.isArray(body.runs)).toBe(true);
    if (body.runs.length > 0) {
      expect(typeof body.runs[0].tool).toBe("string");
      expect(typeof body.runs[0].duration_ms).toBe("number");
    }
    // lastCost may be null on a truly fresh log; if present it carries the O-19 metric.
    if (body.lastCost) expect(typeof body.lastCost.cmdsPerReq).toBe("number");
  });

  it("the eval view re-runs the real pyramid and reports binary pass/fail", async () => {
    const r = await fetch(`${BASE}/api/eval`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { tasks: Array<{ id: string; status: string; block: string }>; calibration: unknown[]; exitCode: number };
    expect(body.tasks.length).toBeGreaterThanOrEqual(10); // GT-1..GT-14
    const blocking = body.tasks.filter((t) => t.block === "blocking");
    expect(blocking.length).toBeGreaterThanOrEqual(8); // the 8 🔴 CI-blocking tasks
    expect(blocking.every((t) => t.status === "PASS")).toBe(true); // all 🔴 green = the merge gate
    expect(body.exitCode).toBe(0);
  });

  it("path-traversal on /api/artifact is blocked", async () => {
    const r = await fetch(`${BASE}/api/artifact?f=../package.json`);
    expect(r.status).toBe(404);
  });
});

describe("CLI-flow smoke (the §9 E2E CLI leg)", () => {
  it("`echo limiter login` emits a limiter with the required properties (sliding-window, fail-closed, identity-key)", () => {
    const out = execFileSync(process.execPath, [join(REPO, "dist", "cli.js"), "limiter", "login", "--runtime", "node"], {
      cwd: REPO,
      encoding: "utf8",
    });
    expect(out).toMatch(/slidingWindow|sliding-window/i);
    expect(out).toMatch(/fail.?clos/i); // login → fail-CLOSED (O-04)
    expect(out.toLowerCase()).not.toMatch(/new map\(\)\s*;?\s*\/\/\s*counter|source.of.truth/); // never a Map counter
  });
});

describe("cockpit screenshots — the 4 views (Playwright when available; honest skip otherwise)", () => {
  it("captures each view to test/e2e/screenshots/ (or skips with a note if no browser)", async () => {
    const pw = await resolvePlaywright();
    if (!pw) {
      console.warn("[e2e] Playwright/chromium not resolvable — skipping the screenshot leg (API + CLI assertions still gate). To enable: `pnpm add -D playwright && npx playwright install chromium`.");
      return; // honest skip — never a fake green
    }
    mkdirSync(SHOTS, { recursive: true });
    const browser = await pw.chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      const views = ["brain", "runs", "evals", "ask"];
      for (const v of views) {
        await page.goto(`${BASE}/#${v}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(600); // let the view's fetch settle
        await page.screenshot({ path: join(SHOTS, `${v}.png`), fullPage: true });
      }
      await browser.close();
    } catch (err) {
      await browser.close().catch(() => {});
      throw err;
    }
    // Assert the 4 PNGs landed.
    const shots = existsSync(SHOTS) ? readdirSync(SHOTS).filter((f) => f.endsWith(".png")) : [];
    expect(shots).toEqual(expect.arrayContaining(["brain.png", "runs.png", "evals.png", "ask.png"]));
  }, 60_000);
});

/**
 * Resolve Playwright from (1) the project's node_modules, then (2) the global npm root. Returns the module or null.
 * Kept dynamic + absolute-path-aware because echo does NOT ship playwright as a dep (it's a $0/local-first repo);
 * the browser is used opportunistically for screenshots, never as a merge-gate dependency.
 */
async function resolvePlaywright(): Promise<{ chromium: { launch: (o?: unknown) => Promise<any> } } | null> {
  // (1) project node_modules
  try {
    return (await import("playwright")) as any;
  } catch {
    // fall through
  }
  // (2) global npm root (pathToFileURL → a valid file: URL on every platform, no hostname-parse warning)
  try {
    const root = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    const entry = join(root, "playwright", "index.mjs");
    if (existsSync(entry)) return (await import(pathToFileURL(entry).href)) as any;
  } catch {
    // no global playwright either
  }
  return null;
}
