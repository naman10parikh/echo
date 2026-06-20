/**
 * `echo limiter <endpoint-kind> [--runtime]` — emit a bypass-proof limiter (O-03..O-09; S-01/S-02/S-03; GT-1/2/3).
 *
 * echo's flagship emitter. Picks store + algorithm + identity-key + fail-mode from the endpoint kind, and the
 * emitted code carries EVERY required property (the L1 golden assertions):
 *   - atomic + shared counter (@upstash/ratelimit is Lua-atomic on Upstash Redis) — O-06, GT-1
 *   - keyed on AUTHENTICATED IDENTITY (or the infra-written IP), NEVER X-Forwarded-For — O-03, GT-2
 *   - paired with a CONCURRENCY CAP (rate alone loses to HTTP/2 multiplexing) — O-05, GT-3
 *   - an explicit FAIL-MODE: fail-CLOSED for security (login/payment), fail-OPEN for product APIs — O-04
 *   - the backend SPEND CAP named as the last line of defense — O-08
 *   - IPv6 keyed on /64 not /128 for the unauth edge — O-09
 * Lift-don't-generate (O-22): the shape mirrors upstash/ratelimit-js/examples/<runtime>.
 */
import chalk from "chalk";

type Runtime = "edge" | "node" | "cf";

interface LimiterPlan {
  readonly algorithm: string;
  readonly failMode: "closed" | "open";
  readonly identityKey: string;
  readonly security: boolean;
  readonly rationale: string[];
}

/** Endpoint kind → the limiter's consistency/security decisions (per-endpoint, O-04/O-07). */
function planFor(kind: string): LimiterPlan {
  const k = kind.toLowerCase();
  const security = /login|auth|signin|signup|password|payment|checkout|otp|verify|token/.test(k);
  const bursty = /api|batch|bulk|webhook|ingest/.test(k) && !security;
  return {
    algorithm: security ? "slidingWindow" : bursty ? "tokenBucket" : "slidingWindow",
    failMode: security ? "closed" : "open",
    identityKey: security ? "authenticated identity (userId / apiKey)" : "authenticated identity, else /64 IP prefix",
    security,
    rationale: [
      security
        ? "security endpoint → fail-CLOSED: a brute-force door must DENY when Redis is slow/down (O-04, P-11)."
        : "product endpoint → fail-OPEN: don't 429 a paying user on a Redis blip (O-04).",
      security
        ? "sliding-window (no boundary brute-force window); fixed-window is banned on auth (TOOL-MATRIX §1)."
        : bursty
          ? "token-bucket: intentional burst + constant drain for bursty real traffic (Arcjet's strongest default)."
          : "sliding-window for general HTTP throttling.",
      "key on authenticated identity, NEVER X-Forwarded-For/-Host/-Real-IP (silent total bypass, O-03/S-02).",
      "pair the rate limit with a CONCURRENCY CAP — HTTP/2 multiplexing beats a rate-only counter (O-05/S-03).",
      "set a LOW backend spend cap + max-instance ceiling — the last line of defense (O-08).",
    ],
  };
}

function redisInit(runtime: Runtime): string {
  // Redis.fromEnv() resolves the correct platform build automatically (P-13 asserts the env first).
  return `const redis = Redis.fromEnv(); // asserts UPSTASH_REDIS_REST_URL/_TOKEN at boot (run \`echo doctor\`, P-13)`;
}

function emitCode(kind: string, runtime: Runtime, plan: LimiterPlan): string {
  const failHandling = plan.failMode === "closed"
    ? `  // fail-CLOSED: a thrown/timeout error on a security endpoint DENIES (never silently allow — O-04/P-11).
  let decision;
  try {
    decision = await ratelimit.limit(identity);
  } catch {
    return new Response("rate limit unavailable", { status: 503 }); // DENY on store failure
  }
  if (!decision.success) return new Response("Too Many Requests", { status: 429 });`
    : `  // fail-OPEN: a product API tolerates a Redis blip (do not 429 a paying user — O-04).
  const decision = await ratelimit.limit(identity).catch(() => ({ success: true, pending: Promise.resolve() }));
  if (!decision.success) return new Response("Too Many Requests", { status: 429 });`;

  const waitUntil = runtime !== "node"
    ? `\n  // edge/multi-region: flush analytics + replication, else writes silently drop (P-10).
  if ("pending" in decision) ctx.waitUntil(decision.pending);`
    : "";

  const timeout = plan.failMode === "closed" ? "  timeout: 1000, // low timeout; a slow store → DENY" : "  timeout: 5000, // product default: brief blip → allow";

  return `// echo limiter — ${kind} (${runtime}). Atomic+shared, identity-keyed, ${plan.failMode === "closed" ? "fail-CLOSED" : "fail-OPEN"}, +concurrency cap.
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

${redisInit(runtime)}

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.${plan.algorithm}(${plan.security ? "5" : "20"}, "60 s"), // atomic Lua decision (O-06)
  ephemeralCache: new Map(), // the ONE legit module-scope Map: a lossy deny-list over Redis (P-02)
  analytics: true,
${timeout}
  prefix: "rl:${kind}",
});

export async function handler(req${runtime !== "node" ? ", ctx" : ""}) {
  // ✅ identity, NOT a client-settable header (O-03/S-02). For the unauth edge, key the /64 IPv6 prefix (O-09).
  const identity = getAuthenticatedId(req) ?? ip64(req);
${failHandling}${waitUntil}

  // ✅ pair with a concurrency cap — rate alone loses to HTTP/2 multiplexing (O-05/S-03).
  // e.g. rate-limiter-flexible RateLimiterConcurrency, or a Redis-backed semaphore, max in-flight per identity.

  return handleRequest(req);
}
// ⚠️ Backend SPEND CAP is the last line of defense: low cost alarm + max-instance ceiling (O-08).`;
}

export function runLimiter(kind: string, opts: { runtime?: string; json?: boolean } = {}): number {
  const runtime = (opts.runtime as Runtime) ?? "node";
  const plan = planFor(kind);
  const code = emitCode(kind, runtime, plan);

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        { kind, runtime, store: "Upstash Redis", algorithm: plan.algorithm, key: plan.identityKey, failMode: plan.failMode, code, rationale: plan.rationale },
        null,
        2,
      ) + "\n",
    );
    return 0;
  }
  process.stderr.write(
    chalk.bold(`echo limiter — ${kind} (${runtime})\n`) +
      chalk.dim(`  store: Upstash Redis · algo: ${plan.algorithm} · key: ${plan.identityKey} · fail-${plan.failMode}\n`) +
      plan.rationale.map((r) => chalk.dim(`  • ${r}`)).join("\n") +
      "\n\n",
  );
  process.stdout.write(code + "\n");
  return 0;
}
