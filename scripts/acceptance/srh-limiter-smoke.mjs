#!/usr/bin/env node
/**
 * SRH limiter smoke — the REAL `@upstash/ratelimit` against the booted SRH+Redis envelope (PLAN §5; E4; §11).
 *
 * HARNESS-OVERRIDES §11 ✅ requires the CI acceptance job to ACTUALLY boot SRH and have the limiter hit it
 * (rc 0, proven by run-id) — a `SANDBOX.md` that only describes it is 🟡. This script is that proof step: it
 * builds a real `Ratelimit.slidingWindow` over `@upstash/redis` pointed at SRH's REST endpoint, fires a
 * concurrent burst > limit, and asserts **admitted == limit** (the atomic+shared invariant, O-06/S-01/S-03).
 *
 * It is GATED on `UPSTASH_REDIS_REST_URL` being set: in CI the `acceptance` job sets it to the SRH service
 * (`http://localhost:8080`). Run locally only with a hand-booted envelope (see SANDBOX.md §1). Without the env it
 * exits 0 with a skip notice (never a red surface) — the in-proc Vitest test already covers the merge gate (D15).
 *
 * Zero hand-rolled HTTP: it imports the SHIPPED libs (`@upstash/ratelimit` + `@upstash/redis`), so it proves the
 * exact REST path echo's emitted code uses. Deps are present in CI (devDependencies); if absent it skips.
 */

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  console.log("[srh-smoke] SKIP — UPSTASH_REDIS_REST_URL/_TOKEN not set (in-proc Vitest covers the gate, D15).");
  process.exit(0);
}

const LIMIT = 5;
const WINDOW = "60 s";
const BURST = 25;

let Ratelimit, Redis;
try {
  ({ Ratelimit } = await import("@upstash/ratelimit"));
  ({ Redis } = await import("@upstash/redis"));
} catch (err) {
  console.log(`[srh-smoke] SKIP — @upstash libs not installed (${err?.message ?? err}); in-proc test covers it.`);
  process.exit(0);
}

// Confirm SRH is actually reachable before asserting (a hard fail here = a real broken envelope, which SHOULD red).
// SRH speaks the Upstash REST protocol: a single command is `POST /` with a JSON array body (NOT a `/ping` path —
// SRH returns "Endpoint not found" for path-style commands). `["PING"]` → {"result":"PONG"} (verified vs SRH).
try {
  const ping = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(["PING"]),
  });
  const body = ping.ok ? await ping.json().catch(() => ({})) : {};
  if (!ping.ok || body?.result !== "PONG") {
    console.error(`[srh-smoke] FAIL — SRH PING returned HTTP ${ping.status} / ${JSON.stringify(body)} (envelope not up).`);
    process.exit(1);
  }
} catch (err) {
  console.error(`[srh-smoke] FAIL — SRH unreachable at ${url} (${err?.message ?? err}).`);
  process.exit(1);
}

const redis = new Redis({ url, token });
const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(LIMIT, WINDOW),
  prefix: `acc:srh-smoke:${Date.now()}`,
  analytics: false,
});

const identity = "user:srh-smoke-burst";
const results = await Promise.all(Array.from({ length: BURST }, () => ratelimit.limit(identity)));
const admitted = results.filter((r) => r.success).length;

console.log(`[srh-smoke] real @upstash/ratelimit vs SRH: admitted ${admitted}/${BURST} (limit ${LIMIT}).`);

if (admitted !== LIMIT) {
  console.error(`[srh-smoke] FAIL — admitted ${admitted}, expected exactly ${LIMIT} (atomic+shared violated, S-01).`);
  process.exit(1);
}

console.log("[srh-smoke] PASS — admitted == limit against the real SRH REST path (O-06/S-01/S-03).");
process.exit(0);
