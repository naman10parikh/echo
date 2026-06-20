/**
 * `echo example --runtime <r>` — print the runtime-correct upstash/ratelimit-js example (O-22; S-15; GT-12).
 *
 * Lift, don't generate: each runtime has ONE correct setup that pre-solves the wrong-build trap (`Can't resolve
 * 'stream'`, S-15) and the `waitUntil(pending)` wiring (P-10). The edge example uses the edge-safe import (no Node
 * `stream`) and wires `ctx.waitUntil(pending)` when analytics/multi-region is on.
 */
import chalk from "chalk";

const EXAMPLES: Record<string, { note: string; code: string }> = {
  edge: {
    note: "Vercel Edge / Next.js middleware — edge-safe import (no Node `stream`, S-15) + waitUntil (P-10).",
    code: `// upstash/ratelimit-js/examples/vercel-edge — the edge-safe build (GT-12/S-15)
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis"; // Redis.fromEnv() resolves the EDGE platform build automatically
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const config = { runtime: "edge" };

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "10 s"),
  ephemeralCache: new Map(), // P-02 legit Map
  analytics: true,
});

export default async function middleware(req: NextRequest, ctx: { waitUntil: (p: Promise<unknown>) => void }) {
  const id = req.ip ?? "anon"; // infra-written IP, NOT X-Forwarded-For (O-03)
  const { success, pending } = await ratelimit.limit(id);
  ctx.waitUntil(pending); // ✅ flush analytics/replication or writes silently drop (P-10)
  return success ? NextResponse.next() : new NextResponse("Too Many Requests", { status: 429 });
}`,
  },
  node: {
    note: "Long-running Node — rate-limiter-flexible on TCP Redis (P-12) + a concurrency cap (O-05).",
    code: `// rate-limiter-flexible on ioredis/node-redis (TCP) — the long-running-Node build (P-12)
import { RateLimiterRedis } from "rate-limiter-flexible";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL!); // TCP pool — sub-ms in-VPC (P-12)
const limiter = new RateLimiterRedis({ storeClient: redis, points: 20, duration: 60, keyPrefix: "rl" });

export async function handler(req, res, next) {
  try {
    await limiter.consume(getAuthenticatedId(req)); // atomic; identity-keyed (O-03/O-06)
    return next();
  } catch {
    return res.status(429).send("Too Many Requests");
  }
}
// Pair with RateLimiterConcurrency for "max N in-flight" (O-05/S-17).`,
  },
  cloudflare: {
    note: "Cloudflare Workers — edge-safe import; for an EXACT global cap use a Durable Object, not KV (O-20/S-14).",
    code: `// upstash/ratelimit-js/examples/cloudflare-workers — edge-safe (GT-12)
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis/cloudflare";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const ratelimit = new Ratelimit({
      redis: Redis.fromEnv(env),
      limiter: Ratelimit.slidingWindow(10, "10 s"),
      ephemeralCache: new Map(),
      analytics: true,
    });
    const { success, pending } = await ratelimit.limit(req.headers.get("cf-connecting-ip") ?? "anon");
    ctx.waitUntil(pending); // P-10
    return success ? new Response("ok") : new Response("Too Many Requests", { status: 429 });
  },
};
// ⚠️ For an EXACT global limit, use a Durable Object — never Workers KV as a counter (O-20/S-14).`,
  },
};

export function runExample(runtime: string, opts: { json?: boolean } = {}): number {
  const r = runtime.toLowerCase();
  const key = r === "cf" || r === "workers" ? "cloudflare" : r === "vercel-edge" || r === "middleware" ? "edge" : r;
  const ex = EXAMPLES[key] ?? EXAMPLES.edge;
  if (opts.json) {
    process.stdout.write(JSON.stringify({ runtime, note: ex.note, code: ex.code }, null, 2) + "\n");
    return 0;
  }
  process.stderr.write(chalk.bold(`echo example — ${runtime}\n`) + chalk.dim(`  ${ex.note}\n\n`));
  process.stdout.write(ex.code + "\n");
  return 0;
}
