// FIXTURE (P-02 OK): the ONE legitimate module-scope Map — `ephemeralCache: new Map()` passed to
// @upstash/ratelimit. It is a lossy deny-list cache OVER Redis: if empty/stale the request falls through to
// Redis, so the answer is still safe (O-02). `echo audit` MUST exit 0 on this fixture — never flag it as P-01.
import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, "60 s"),
  // ✅ The legit module-scope Map — a short-circuit over the authoritative Redis counter (P-02).
  ephemeralCache: new Map(),
  timeout: 1000,
});

export async function POST(req: NextRequest) {
  const identity = req.headers.get("authorization") ?? "anon";
  const { success } = await ratelimit.limit(identity);
  if (!success) return NextResponse.json({ error: "rate limited" }, { status: 429 });
  return NextResponse.json({ ok: true });
}
