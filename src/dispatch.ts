/**
 * echo dispatch — the internal routing loop (PLAN §3 C8; MASTER-TODOS D1).
 *
 * For a multi-step `echo design <endpoint>` request, this decides WHICH of echo's sub-tools apply (limiter vs cache
 * vs idempotency vs stampede) and in WHAT ORDER, then chains them. It is the "which employee-skill runs for this
 * request" router — the CLI/MCP form of echo picking the right tool per Job (EXPERTISE-MAP J1–J8).
 *
 * Design (Karpathy: Simplicity First). The routing is a PURE function `planDesign(endpoint)` → an ordered list of
 * steps. It owns NO emitter logic — each step names a Cluster-B sub-tool (`runLimiter`/`runCache`/`runIdempotency`/
 * `runStampede`), which `runDesign` invokes. Splitting plan-from-emit keeps the routing unit-testable without
 * capturing stdout, and means the dispatch reuses the EXACT same emitters the CLI + MCP use (one rule, one place).
 *
 * Classification mirrors the regex style already proven in `commands/limiter.ts` (`planFor`) and
 * `commands/stampede.ts` — keyword → decision, no NLP, no model call. A request can map to MULTIPLE tools
 * (a payment endpoint that's also read-heavy gets limiter + idempotency + cache), which is the whole point of a
 * "multi-step design".
 */
import { runLimiter } from "./commands/limiter.js";
import { runCache } from "./commands/cache.js";
import { runIdempotency } from "./commands/idempotency.js";
import { runStampede } from "./commands/stampede.js";

/** The four sub-tools the design router can route to (the design-time subset of the CLI tree). */
export type SubTool = "limiter" | "idempotency" | "cache" | "stampede";

/** One planned step: which sub-tool, the concrete arg to call it with, and WHY it was selected (the rationale). */
export interface DispatchStep {
  readonly tool: SubTool;
  /** the argument passed to the sub-tool emitter (e.g. the endpoint kind for `limiter`, the pattern for `cache`). */
  readonly arg: string;
  readonly reason: string;
}

/** The full plan for a `design` request: the endpoint it was derived from + the ordered steps. */
export interface DispatchPlan {
  readonly endpoint: string;
  readonly steps: readonly DispatchStep[];
}

const RE = {
  // mutating / write verbs (and the payment-class nouns) → needs exactly-once (idempotency, O-21).
  mutating: /payment|checkout|charge|pay|order|purchase|booking|book|transfer|create|signup|register|submit|post|write|mutat|enroll|subscribe|refund/i,
  // security / abuse-prone → always a limiter, fail-CLOSED (O-03/O-04).
  security: /login|auth|signin|sign-in|password|otp|verify|token|payment|checkout|reset/i,
  // read / fetch / list / profile → cacheable hot path (SWR, O-10..O-14).
  cacheable: /read|get|list|feed|profile|search|fetch|query|view|dashboard|report|llm|completion|embedding|recommend/i,
  // expensive origin (LLM, aggregation, heavy report) → herd defense on the fill (O-15/O-16).
  expensive: /llm|completion|embedding|aggregat|report|analytics|heavy|expensive|inference|model/i,
} as const;

/**
 * Route an endpoint description to an ORDERED list of sub-tool steps.
 *
 * Order matters and follows admission-first (O-17): admission control (the limiter) runs BEFORE any expensive work,
 * so `limiter` is always step 1 when present; idempotency claims the request before execution (step 2); the cache /
 * stampede defenses wrap the read/fill that follows (steps 3–4). The order encodes echo's own opinions, not just a
 * bag of tools.
 *
 * Guarantees at least one step: a request echo can't otherwise classify still gets a default limiter (echo's
 * security-paranoid default — "when in doubt, gate it"; never return zero defenses).
 */
export function planDesign(endpoint: string): DispatchPlan {
  const e = endpoint.toLowerCase();
  const steps: DispatchStep[] = [];

  const isSecurity = RE.security.test(e);
  const isMutating = RE.mutating.test(e);
  const isCacheable = RE.cacheable.test(e);
  const isExpensive = RE.expensive.test(e);

  // 1. Admission control FIRST (O-17). Security endpoints always get a limiter; so do mutating ones (abuse-prone).
  if (isSecurity || isMutating || (!isCacheable && !isExpensive)) {
    steps.push({
      tool: "limiter",
      arg: endpoint,
      reason: isSecurity
        ? "security endpoint → bypass-proof limiter, fail-CLOSED, admission-first (O-03/O-04/O-17)"
        : isMutating
          ? "mutating endpoint → rate-limit the abuse-prone write before it executes (O-17)"
          : "unclassified endpoint → default to a limiter (security-paranoid default — never zero defenses)",
    });
  }

  // 2. Exactly-once for any mutating / payment-class endpoint (O-21 — the inverse of rate limiting, fail-CLOSED).
  if (isMutating) {
    steps.push({
      tool: "idempotency",
      arg: endpoint,
      reason: "mutating/payment-class → exactly-once via the Stripe pattern, fail-CLOSED + DB-unique backstop (O-21)",
    });
  }

  // 3. Cache the hot read path (SWR + always-TTL+jitter + per-tenant key, O-10..O-14).
  if (isCacheable) {
    steps.push({
      tool: "cache",
      // `cache llm` version-keys on model+prompt-template+RAG-corpus (O-14); otherwise a generic SWR cache.
      arg: isExpensive && /llm|completion|embedding|inference|model/i.test(e) ? "llm" : endpoint,
      reason: isExpensive
        ? "expensive read → cache with version-keying for LLM/model state (O-14/S-18)"
        : "hot read path → stale-while-revalidate cache, per-tenant key, always-TTL+jitter (O-10..O-14)",
    });
  }

  // 4. Herd defense on an expensive fill (distributed single-flight or SWR — NEVER an in-process Map, O-15).
  if (isExpensive) {
    steps.push({
      tool: "stampede",
      arg: "expensive",
      reason: "expensive origin → distributed single-flight on the fill so the origin is hit once (O-15/O-16/S-04)",
    });
  }

  return { endpoint, steps };
}

/**
 * Execute a design plan: run each planned sub-tool's emitter in order. Returns the worst exit code (0 = all clean).
 * Each emitter writes its code to stdout + rationale to stderr exactly as the standalone CLI command does — the
 * `design` command is a thin orchestrator over the same emitters (no duplicated emit logic).
 */
export function runDesign(endpoint: string, opts: { runtime?: string; json?: boolean } = {}): number {
  const plan = planDesign(endpoint);

  if (opts.json) {
    // For the JSON path, emit the PLAN (the routing decision) — the machine-readable form a caller chains on.
    process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
    return 0;
  }

  process.stderr.write(`echo design — ${endpoint}: ${plan.steps.length} step(s) → ${plan.steps.map((s) => s.tool).join(" → ")}\n\n`);

  let worst = 0;
  for (const step of plan.steps) {
    process.stderr.write(`── ${step.tool}: ${step.reason}\n`);
    const rc = runStep(step, opts.runtime);
    if (rc > worst) worst = rc;
  }
  return worst;
}

/** Dispatch one step to its sub-tool emitter (the routing target). */
function runStep(step: DispatchStep, runtime?: string): number {
  switch (step.tool) {
    case "limiter":
      return runLimiter(step.arg, { runtime });
    case "idempotency":
      return runIdempotency(step.arg);
    case "cache":
      return runCache(step.arg, { runtime });
    case "stampede":
      return runStampede(step.arg);
  }
}
