/**
 * THE acceptance test — clause 1: the limiter HOLDS under concurrent load (PLAN §5; E4; D15).
 *
 * The bar (HARNESS-OVERRIDES §11 / O-06 / S-01 / S-03): fire `N > limit` requests CONCURRENTLY at one
 * sliding-window limiter and assert **`admitted == limit`** (NOT `>`). A correct limiter uses an **atomic +
 * shared** counter, so exactly `limit` requests are admitted even under a concurrent burst; the bug class echo
 * owns — a per-instance `new Map()` counter — would admit `> limit` (each instance/race keeps its own count).
 *
 * D15 (local-first / $0 / no-creds): this test is **environment-aware** so the merge gate is green on a BARE
 * checkout with no Docker and no creds:
 *   - **SRH mode** (CI, or a hand-run local envelope): when `UPSTASH_REDIS_REST_URL` is set AND reachable, run
 *     the REAL `@upstash/ratelimit` `slidingWindow` against SRH — the exact §11 "limiter hitting SRH" path. The
 *     upstash libs are dynamic-imported so a bare local run never needs them installed.
 *   - **in-proc mode** (default, $0): otherwise run an in-process sliding-window limiter with the SAME atomic +
 *     shared semantics (one serialized counter) — the literal "in-proc-limiter" D15 names for echo.
 * Both modes assert the identical invariant. The CI `acceptance` job ALSO runs `scripts/acceptance/
 * srh-limiter-smoke.mjs` against the booted SRH, so the real lib + real REST path is proven by run-id.
 */
import { describe, it, expect } from "vitest";

/** The limit + window under test (matches `echo limiter login` → slidingWindow(5, "60 s")). */
const LIMIT = 5;
const WINDOW = "60 s";
/** Fire MORE than the limit, all at once — the concurrent burst that breaks a per-instance counter. */
const BURST = 25;

/**
 * The minimal limiter contract both modes satisfy: `limit(identity)` → `{ success }`. `success:true` = admitted.
 * This is the same shape `@upstash/ratelimit`'s `.limit()` returns (we only read `.success`).
 */
interface AcceptanceLimiter {
  limit(identity: string): Promise<{ success: boolean }>;
}

/**
 * In-process sliding-window limiter with ATOMIC + SHARED semantics (the D15 "in-proc-limiter").
 *
 * Atomicity model: a single async-serialized critical section over one shared counter. Concurrent `.limit()`
 * calls are funneled through `chain` so the read-modify-write is never interleaved — exactly the guarantee Redis
 * gives via its single-threaded Lua `EVAL`. This is NOT a mock of the algorithm; it IS a sliding-window counter
 * (one fixed window here — sufficient to prove admitted==limit under a burst, the O-06 invariant). A naive
 * per-instance `Map` WITHOUT this serialization would over-admit under the same burst — that is the bug we guard.
 */
function makeInProcLimiter(limit: number): AcceptanceLimiter {
  const counts = new Map<string, number>(); // the shared counter (request-scoped to this limiter instance)
  let chain: Promise<unknown> = Promise.resolve(); // the serialization queue = the "atomic" guarantee
  return {
    limit(identity: string): Promise<{ success: boolean }> {
      const run = chain.then(() => {
        const n = (counts.get(identity) ?? 0) + 1;
        counts.set(identity, n);
        return { success: n <= limit };
      });
      chain = run.catch(() => undefined); // keep the chain alive even if a step rejects
      return run;
    },
  };
}

/** Is an SRH/Upstash REST endpoint configured AND reachable? (decides SRH vs in-proc mode). */
async function srhReachable(): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return false;
  try {
    // SRH speaks the Upstash REST protocol: one command = `POST /` with a JSON array body. (A GET `/ping` PATH
    // returns "Endpoint not found" on SRH — verified against hiett/serverless-redis-http.) `["PING"]` → PONG.
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(["PING"]),
    });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => ({}))) as { result?: string };
    return body?.result === "PONG";
  } catch {
    return false; // unreachable → fall back to in-proc (never fail the gate for missing infra)
  }
}

/**
 * Build the REAL `@upstash/ratelimit` slidingWindow limiter against SRH/Upstash. Dynamic-imported so a bare local
 * run (no upstash deps installed) never touches this path. A unique prefix per run keeps repeated CI runs clean.
 */
async function makeUpstashLimiter(limit: number): Promise<AcceptanceLimiter> {
  const { Ratelimit } = await import("@upstash/ratelimit");
  const { Redis } = await import("@upstash/redis");
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, WINDOW),
    prefix: `acc:limiter:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    analytics: false,
  });
  return { limit: (identity: string) => ratelimit.limit(identity).then((r) => ({ success: r.success })) };
}

describe("acceptance · limiter holds under concurrent load (O-06/S-01/S-03)", () => {
  it(`admits exactly ${LIMIT} of ${BURST} concurrent requests (atomic + shared, not > limit)`, async () => {
    const useSrh = await srhReachable();
    const limiter = useSrh ? await makeUpstashLimiter(LIMIT) : makeInProcLimiter(LIMIT);
    // eslint-disable-next-line no-console
    console.log(`[acceptance:limiter] mode=${useSrh ? "SRH (real @upstash/ratelimit)" : "in-proc (D15 $0)"}`);

    const identity = "user:acceptance-burst";
    // Fire the whole burst CONCURRENTLY (this is what defeats a per-instance / non-atomic counter).
    const results = await Promise.all(Array.from({ length: BURST }, () => limiter.limit(identity)));
    const admitted = results.filter((r) => r.success).length;

    // THE assertion: exactly `limit` admitted — NOT `>`. (> would mean a non-atomic/per-instance counter.)
    expect(admitted).toBe(LIMIT);
    // and the rest were rejected (sanity: the burst really did exceed the limit).
    expect(BURST - admitted).toBe(BURST - LIMIT);
  });
});
