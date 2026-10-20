/**
 * echo GOLDEN TASKS — GT-1..GT-14, the BATTLE-TESTED-SCENARIOS turned into graded checks (E1; PLAN §6).
 *
 * Each golden task is a scenario's VERIFY made executable. Levels (Hamel):
 *   - L1 = static assertion on echo's emitted code/result (does it HAVE the property).
 *   - L2 = behavioral / calibrated-binary (run SETUP+TRIGGER, assert RESOLUTION; a classifier with measured F1).
 *   - L3 = trajectory LLM-judge (give a fresh agent SETUP+TRIGGER, grade it reaches RESOLUTION without the WRONG
 *          MOVE) — calibrated, gated on ANTHROPIC_API_KEY (deterministic stand-in otherwise; see judge.ts).
 *
 * Every task carries its `scenario` (S-01..S-19) so `grep "GT-1\|S-01" eval` traces a golden task to its source
 * (the §6 mapping). 🔴 tasks (ciBlock:true) red-block CI; 🟠 run on PR + nightly. The L1 `assert` runs echo's
 * REAL emitter via `capture()` and asserts on the emitted code — proving the SHIPPED command has the property,
 * not a restated opinion.
 */
import { capture } from "../lib/capture.js";
import type { JudgeSpec } from "../judge.js";
import { runLimiter } from "../../commands/limiter.js";
import { runCache } from "../../commands/cache.js";
import { runIdempotency } from "../../commands/idempotency.js";
import { runStampede } from "../../commands/stampede.js";
import { runStore } from "../../commands/store.js";
import { runKey } from "../../commands/key.js";
import { runExample } from "../../commands/example.js";
import { computeCost } from "../../commands/cost.js";
import { runAudit } from "../../commands/audit.js";

/** The Hamel level of a golden task. */
export type Level = "L1" | "L2" | "L3";

/** Result of running one L1/L2 check k times. */
export interface CheckResult {
  readonly passed: boolean;
  /** a one-line human reason (what was asserted / why it failed). */
  readonly detail: string;
}

/** A golden task. `assert` is the L1/L2 binary check; L3 tasks additionally carry a `judge` spec (see judge.ts). */
export interface GoldenTask {
  readonly id: string; // GT-1..GT-14
  readonly scenario: string; // S-01..S-19 (the §6 mapping; makes the grep trace true)
  readonly title: string;
  readonly level: Level;
  /** 🔴 = red-blocks CI; 🟠 = runs on PR + nightly, not merge-blocking. */
  readonly ciBlock: boolean;
  /** the binary check (L1 static / L2 behavioral). Pure + deterministic so pass^k is meaningful. */
  readonly assert: () => CheckResult;
  /**
   * L3 only: the trajectory-judge spec (echo's emitted answer + resolution/wrong-move regexes). The runner calls
   * `judge(spec)` — deterministic stand-in by default, real Anthropic judge when `ANTHROPIC_API_KEY` and `ECHO_JUDGE_MODEL` are set
   * (strictly tightening; see judge.ts). Absent on L1/L2 tasks.
   */
  readonly judgeSpec?: () => JudgeSpec;
}

/** tiny helper: a passing/failing CheckResult from a boolean + detail. */
const check = (ok: boolean, detail: string): CheckResult => ({ passed: ok, detail });

/** Run an emitter and return its captured stdout (the emitted code). */
const emit = (fn: () => number): string => capture(fn).code;

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
// GT-1 · S-01 — the limiter uses an atomic+shared counter (not a process-local Map). L1 (L2 behavioral in E4).
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const GT1: GoldenTask = {
  id: "GT-1",
  scenario: "S-01",
  title: "limiter uses an atomic+shared counter on an external store (O-06), never a module-scope Map",
  level: "L1",
  ciBlock: true,
  assert: () => {
    const code = emit(() => runLimiter("login", { runtime: "node", json: false }));
    const usesUpstash = /@upstash\/ratelimit/.test(code) && /Redis\.fromEnv\(\)/.test(code);
    const noSourceOfTruthMap = !/const\s+counts\s*=\s*new\s+Map/.test(code); // never the S-01 bug
    return check(
      usesUpstash && noSourceOfTruthMap,
      usesUpstash ? "emits an atomic+shared Upstash limiter (O-06)" : "MISSING atomic+shared external store",
    );
  },
};

// GT-2 · S-02 — keys on identity, never X-Forwarded-For. L1.
const GT2: GoldenTask = {
  id: "GT-2",
  scenario: "S-02",
  title: "limiter keys on authenticated identity / infra-written IP, never a client-settable header (O-03)",
  level: "L1",
  ciBlock: true,
  assert: () => {
    const code = emit(() => runLimiter("login", { runtime: "node", json: false }));
    const keysOnIdentity = /getAuthenticatedId|authenticated identity|userId|apiKey/i.test(code);
    // the emitted code must NOT key on a spoofable header (a comment WARNING against it is fine; keying on it is not)
    const keysOnHeader = /=\s*[^\n]*headers?[^\n]*(x-forwarded-for|x-real-ip|true-client-ip)/i.test(code);
    return check(
      keysOnIdentity && !keysOnHeader,
      keysOnIdentity ? "keyed on identity, not a spoofable header (O-03/S-02)" : "MISSING identity key",
    );
  },
};

// GT-3 · S-03 — pairs the rate limit with a concurrency cap. L1 (L2 concurrency behavior in E4).
const GT3: GoldenTask = {
  id: "GT-3",
  scenario: "S-03",
  title: "limiter pairs the rate limit with a concurrency cap — rate alone loses to HTTP/2 multiplexing (O-05)",
  level: "L1",
  ciBlock: true,
  assert: () => {
    const code = emit(() => runLimiter("login", { runtime: "node", json: false }));
    const hasConcurrency = /concurrency cap|RateLimiterConcurrency|semaphore|in-flight/i.test(code);
    return check(hasConcurrency, hasConcurrency ? "pairs a concurrency cap (O-05/S-03)" : "MISSING concurrency cap");
  },
};

// GT-4 · S-04/S-09 — stampede uses DISTRIBUTED single-flight (SETNX+UUID-Lua), never in-process Map. L1.
const GT4: GoldenTask = {
  id: "GT-4",
  scenario: "S-04",
  title: "stampede defense is distributed single-flight (SETNX + UUID-Lua release), never an in-process Map (O-15)",
  level: "L1",
  ciBlock: true,
  assert: () => {
    const code = emit(() => runStampede("expensive", { json: false }));
    const distributed = /\bnx:\s*true\b/.test(code) && /randomUUID/.test(code) && /redis\.eval|RELEASE_LUA|GET.*ARGV/i.test(code);
    const noInProcessMap = !/new\s+Map<[^>]*Promise/.test(code) || /NEVER.*Map/i.test(code);
    return check(
      distributed && noInProcessMap,
      distributed ? "distributed single-flight: SETNX + UUID-Lua release (O-15/S-04)" : "MISSING distributed single-flight",
    );
  },
};

// GT-5 · S-05/S-06 — cache/key centralizes invalidation + builds the key in ONE function; DEL→0 logged. L1.
const GT5: GoldenTask = {
  id: "GT-5",
  scenario: "S-05",
  title: "cache centralizes the key contract (one cacheKey()) + logs DEL→0 (keys-as-contracts, O-13/S-06)",
  level: "L1",
  ciBlock: true,
  assert: () => {
    const code = emit(() => runCache("profile", { runtime: "node", json: false }));
    const oneKeyFn = /function\s+cacheKey\s*\(/.test(code);
    const delZeroLogged = /deleted\s*===?\s*0|DEL returned 0|returned 0/i.test(code);
    return check(
      oneKeyFn && delZeroLogged,
      oneKeyFn && delZeroLogged ? "one cacheKey() contract + DEL→0 logged (O-13/S-06)" : "MISSING key contract or DEL→0 signal",
    );
  },
};

// GT-6 · S-07/S-08 — invalidation = delete-not-update, DB-first-then-DEL, in finally. L1+L2 → 🟠.
const GT6: GoldenTask = {
  id: "GT-6",
  scenario: "S-07",
  title: "invalidation deletes (not updates), DB-first-then-DEL, in a finally; write-then-throw still invalidates (O-11/O-12)",
  level: "L1",
  ciBlock: false,
  assert: () => {
    const code = emit(() => runCache("profile", { runtime: "node", json: false }));
    const deletesNotUpdates = /redis\.del\(/.test(code) && !/redis\.set\([^)]*onWrite/i.test(code);
    const inFinally = /finally\s*\{/.test(code);
    const doubleDelete = /delayed.double.delete|double-delete|setTimeout\([^)]*redis\.del/i.test(code);
    return check(
      deletesNotUpdates && inFinally && doubleDelete,
      inFinally ? "delete-don't-update, DB-first-then-DEL, finally + double-delete (O-11/O-12/S-07)" : "MISSING finally/double-delete",
    );
  },
};

// GT-7 · S-13 — idempotency = atomic SET NX + fingerprint→400 + 24h TTL + fail-CLOSED + DB backstop. L1.
const GT7: GoldenTask = {
  id: "GT-7",
  scenario: "S-13",
  title: "idempotency: atomic SET NX claim + fingerprint→400 + 24h TTL + fail-CLOSED + DB-unique backstop (O-21)",
  level: "L1",
  ciBlock: true,
  assert: () => {
    const code = emit(() => runIdempotency("POST /charge", { json: false }));
    const atomicClaim = /\bnx:\s*true\b/.test(code);
    const fingerprint400 = /fingerprint/i.test(code) && /400/.test(code);
    const ttl24h = /86400/.test(code);
    const failClosed = /503|FAIL-CLOSED|fail-closed/i.test(code);
    const dbBackstop = /UNIQUE|unique.constraint|DB.unique/i.test(code);
    const ok = atomicClaim && fingerprint400 && ttl24h && failClosed && dbBackstop;
    return check(
      ok,
      ok ? "Stripe pattern complete: SET NX + fp→400 + 24h + fail-CLOSED + DB-unique (O-21/S-13)" : "MISSING an idempotency property",
    );
  },
};

// GT-8 · S-14 — store REFUSES a limiter on CF Workers KV, reaches for a DO / Upstash. L3 (trajectory) — but the
// emitter's REFUSAL is also L1-assertable; we assert the refusal here and the judge grades the trajectory.
const GT8: GoldenTask = {
  id: "GT-8",
  scenario: "S-14",
  title: "store refuses a limiter on CF Workers KV (silent fail-open) and recommends a Durable Object / Upstash (O-20)",
  level: "L3",
  ciBlock: true,
  assert: () => {
    const code = emit(() => runStore("cf", { json: false }));
    const refuses = /refus|never|do not|don't/i.test(code) && /\bKV\b/.test(code);
    const recommendsDoOrUpstash = /durable object|durable-object|\bDO\b|upstash/i.test(code);
    return check(
      refuses && recommendsDoOrUpstash,
      refuses && recommendsDoOrUpstash ? "refuses CF-KV-as-counter → DO/Upstash (O-20/S-14)" : "did NOT refuse CF-KV / no DO recommendation",
    );
  },
  judgeSpec: () => ({
    scenario: "S-14",
    question: "A dev wants a rate limiter on Cloudflare Workers KV. Does the answer refuse KV-as-counter and recommend a Durable Object or Upstash?",
    answer: emit(() => runStore("cf", { json: false })),
    resolutionRegex: /durable object|durable-object|\bDO\b|upstash/i,
    wrongMoveRegex: /use\s+KV\s+(as\s+)?(the\s+)?counter|store the count in KV/i, // recommending KV-as-counter = the wrong move
  }),
};

// GT-9 · S-16 — cost computes the right cmds/request + a fixed-instance break-even. L1.
const GT9: GoldenTask = {
  id: "GT-9",
  scenario: "S-16",
  title: "cost computes correct cmds/request (sliding=4, +1 analytics, ×(1+readRegions) Global) + break-even (O-19)",
  level: "L1",
  ciBlock: false,
  assert: () => {
    const sliding = computeCost({ algo: "sliding", rps: 1000 });
    const slidingAnalytics = computeCost({ algo: "sliding", rps: 1000, analytics: true });
    const global3 = computeCost({ algo: "sliding", rps: 1000, regions: 3, analytics: true });
    const fixed = computeCost({ algo: "fixed", rps: 1000 });
    const ok =
      sliding.cmdsPerReq === 4 && // sliding = 4 commands (EVAL,GET,GET,INCR)
      slidingAnalytics.cmdsPerReq === 5 && // +1 analytics
      global3.cmdsPerReq === (1 + 3) * 4 + 1 && // Global ×(1+3) on the write side + analytics = 17
      fixed.cmdsPerReq === 2 && // fixed window = 2 commands
      sliding.breakEvenCmdsPerDay > 0;
    return check(
      ok,
      ok
        ? `sliding=4, +analytics=5, Global×4=17, fixed=2, break-even=${sliding.breakEvenCmdsPerDay}/day (O-19/S-16)`
        : `WRONG cmds/request: sliding=${sliding.cmdsPerReq} analytics=${slidingAnalytics.cmdsPerReq} global=${global3.cmdsPerReq} fixed=${fixed.cmdsPerReq}`,
    );
  },
};

// GT-10 · S-18 — llm cache version-keys on model + prompt-template + RAG-corpus. L1 (L2 no-stale-served in E4).
const GT10: GoldenTask = {
  id: "GT-10",
  scenario: "S-18",
  title: "cache llm version-keys on model + prompt-template + RAG-corpus — no pre-bump answer served (O-14/S-18)",
  level: "L1",
  ciBlock: true,
  assert: () => {
    const code = emit(() => runCache("llm", { runtime: "node", json: false }));
    const versionKeyed = /modelVersion/.test(code) && /promptTemplateVersion/.test(code) && /ragCorpusVersion/.test(code);
    return check(versionKeyed, versionKeyed ? "version-keyed on model+template+corpus (O-14/S-18)" : "MISSING version-keying");
  },
};

// GT-11 · S-12 — show-remaining uses getRemaining (doesn't consume), not .limit(). L1 → 🟠.
const GT11: GoldenTask = {
  id: "GT-11",
  scenario: "S-12",
  title: "showing remaining quota uses getRemaining (non-consuming), never .limit() or a raw key GET (S-12)",
  level: "L1",
  ciBlock: false,
  assert: () => {
    // `echo example` carries the runtime-correct usage; getRemaining guidance lives in the brain + example.
    const code = emit(() => runExample("node", { json: false }));
    const mentionsGetRemaining = /getRemaining/i.test(code) || /does ?n.t consume|non-consuming/i.test(code);
    // soft: if the example doesn't cover it, this 🟠 task reports fail (non-blocking) rather than crash.
    return check(mentionsGetRemaining, mentionsGetRemaining ? "uses getRemaining for display (S-12)" : "example omits getRemaining (S-12)");
  },
};

// GT-12 · S-15 — example --runtime edge yields the edge-safe build + waitUntil(pending), no Node stream. L1 → 🟠.
const GT12: GoldenTask = {
  id: "GT-12",
  scenario: "S-15",
  title: "example --runtime edge is edge-safe (no Node 'stream' import) + waitUntil(pending) for analytics (P-10/S-15)",
  level: "L1",
  ciBlock: false,
  assert: () => {
    const code = emit(() => runExample("edge", { json: false }));
    const noNodeStream = !/from\s+["']stream["']|require\(["']stream["']\)/.test(code);
    const waitUntil = /waitUntil/i.test(code);
    return check(
      noNodeStream && waitUntil,
      noNodeStream && waitUntil ? "edge-safe + waitUntil(pending) (P-10/S-15)" : "MISSING waitUntil or imports Node stream",
    );
  },
};

// GT-13 · S-17 — distinguishes rate-limiting from concurrency-limiting (semaphore, not token bucket). L3 → 🟠.
const GT13: GoldenTask = {
  id: "GT-13",
  scenario: "S-17",
  title: "distinguishes rate-limiting (req/time) from concurrency-limiting (in-flight) — a semaphore, not a token bucket (S-17)",
  level: "L3",
  ciBlock: false,
  assert: () => {
    // L1 proxy for the L3 trajectory: the limiter rationale names the concurrency dimension (the judge grades the
    // full trajectory). A bursty limiter still pairs a concurrency cap (O-05) — assert that distinction is present.
    const cap = capture(() => runLimiter("login", { runtime: "node", json: false }));
    const namesConcurrency = /concurrency/i.test(cap.code + cap.stderr);
    return check(namesConcurrency, namesConcurrency ? "names the concurrency dimension (S-17)" : "conflates rate and concurrency (S-17)");
  },
  judgeSpec: () => {
    const cap = capture(() => runLimiter("login", { runtime: "node", json: false }));
    return {
      scenario: "S-17",
      question: "Asked for 'max 10 simultaneous LLM calls', does the answer reach a concurrency-limit (semaphore/in-flight) rather than conflating it with a rate limit (token bucket)?",
      answer: cap.code + "\n" + cap.stderr,
      resolutionRegex: /concurrency cap|concurrency-limit|semaphore|in-flight|RateLimiterConcurrency/i,
    };
  },
};

// GT-14 · S-19 — exact-global limit uses single-region / DO, not multi-region CRDT. L3 → 🟠.
const GT14: GoldenTask = {
  id: "GT-14",
  scenario: "S-19",
  title: "an exact/hard-quota limit uses single-region or a Durable Object, not multi-region CRDT (S-19)",
  level: "L3",
  ciBlock: false,
  assert: () => {
    // L1 proxy: `echo store --runtime cf` recommends a DO for exact global counting (the judge grades trajectory).
    const code = emit(() => runStore("cf", { json: false }));
    const exactGlobal = /durable object|durable-object|\bDO\b|single-region/i.test(code);
    return check(exactGlobal, exactGlobal ? "exact-global → DO/single-region (S-19)" : "MISSING exact-global guidance (S-19)");
  },
  judgeSpec: () => ({
    scenario: "S-19",
    question: "For a HARD/exact global quota, does the answer reach single-region or a Durable Object (strongly-consistent) rather than a multi-region CRDT (eventually-consistent overcount)?",
    answer: emit(() => runStore("cf", { json: false })),
    resolutionRegex: /durable object|durable-object|\bDO\b|single-region/i,
    wrongMoveRegex: /multi-region\s+CRDT|use\s+a\s+CRDT\s+for\s+(the\s+)?exact/i,
  }),
};

/** All 14 golden tasks (GT-1..GT-14), in order. */
export const GOLDEN_TASKS: readonly GoldenTask[] = [
  GT1, GT2, GT3, GT4, GT5, GT6, GT7, GT8, GT9, GT10, GT11, GT12, GT13, GT14,
] as const;

/** The 8 🔴 CI-blocking tasks (GT-1/2/3/4/5/7/8/10) — a red here red-blocks the merge. */
export const CI_BLOCKING_IDS: readonly string[] = GOLDEN_TASKS.filter((t) => t.ciBlock).map((t) => t.id);
