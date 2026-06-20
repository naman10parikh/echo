// FIXTURE (P-01 BUG): a module-scope Map used as the SOURCE OF TRUTH for a rate-limit counter on serverless.
// This is the canonical S-01 anti-pattern — "works" in `vercel dev`, silently fails open + leaks across users
// under Vercel Fluid Compute in prod. `echo audit` MUST exit 1 on this fixture.
import { NextRequest, NextResponse } from "next/server";

// ❌ Cross-request state in a process the platform can share/recycle/fan out (O-01 violation, P-01).
const counts = new Map<string, number>();

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "anon";
  const n = (counts.get(ip) ?? 0) + 1;
  counts.set(ip, n);
  if (n > 5) return NextResponse.json({ error: "rate limited" }, { status: 429 });
  return NextResponse.json({ ok: true });
}
