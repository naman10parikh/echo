/**
 * `echo stampede <key-cost>` — the herd defense (O-15/O-16; S-04/S-09; GT-4). NEVER in-process Map on serverless.
 *
 * The most common "stampede fix" (an in-memory `Map<key, Promise>` dedup) is a LIE on serverless — across 50 warm
 * instances it's a 50-request stampede, not single-flight (O-15/S-04). echo emits the correct defense:
 *   - expensive fill → DISTRIBUTED single-flight: `SET lock:{key} <uuid> NX EX <ttl>`, exactly one fetches the
 *     origin, others serve stale / poll; release via a Lua script that DELs only if the UUID matches (owner-only).
 *   - cheap fill → SWR from the shared cache (no caller blocks).
 *   - always JITTER the TTL/backoff (the one line that fixes both herds — O-16/S-09).
 */
import chalk from "chalk";

function emitDistributed(): string {
  return `// echo stampede — DISTRIBUTED single-flight (expensive fill). Exactly one instance hits the origin (O-15/S-04).
import { Redis } from "@upstash/redis";
import { randomUUID } from "node:crypto";
const redis = Redis.fromEnv();

// ✅ owner-only release — DEL only if our UUID still holds the lock (atomic, no other instance's lock deleted).
const RELEASE_LUA = \`if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end\`;

export async function singleFlight<T>(key: string, fetchOrigin: () => Promise<T>, cacheGet: () => Promise<T | null>): Promise<T> {
  const cached = await cacheGet();
  if (cached !== null) return cached;

  const lockKey = \`lock:\${key}\`;
  const token = randomUUID();
  const ttl = 5 + Math.floor(Math.random() * 2); // jittered lock TTL (O-16)
  const got = await redis.set(lockKey, token, { nx: true, ex: ttl });

  if (got !== "OK") {
    // someone else is filling — wait briefly, then serve whatever they wrote (or stale).
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
    const after = await cacheGet();
    if (after !== null) return after;
    return fetchOrigin(); // last resort; the lock holder is slow
  }
  try {
    return await fetchOrigin(); // ✅ exactly one instance reaches the origin
  } finally {
    await redis.eval(RELEASE_LUA, [lockKey], [token]); // owner-only release
  }
}
// ❌ NEVER a module-scope Map<key, Promise> as the dedup on serverless — that's a per-instance lie (O-15/S-04).`;
}

function emitSwr(): string {
  return `// echo stampede — SWR (cheap fill). Serve stale instantly, refetch in the background; no caller blocks (O-15).
// Always-TTL + JITTER so a batch of keys never expires in the same second (the scheduled stampede, O-16/S-09).
// (Same SWR engine as \`echo cache\` — reuse readSWR; a cheap fill doesn't need a distributed lock.)`;
}

export function runStampede(keyCost: string, opts: { json?: boolean } = {}): number {
  const expensive = /expensive|heavy|origin|llm|aggregat/i.test(keyCost);
  const strategy = expensive ? "distributed-single-flight" : "swr";
  const code = expensive ? emitDistributed() : emitSwr();
  const rationale = [
    expensive
      ? "expensive fill → distributed single-flight (SETNX + UUID-Lua release); origin queried ONCE (O-15/S-04)"
      : "cheap fill → SWR from the shared cache; no caller blocks (O-15)",
    "JITTER the TTL/backoff — fixes both the expiry herd and the retry herd (O-16/S-09)",
    "NEVER in-process Map<key,Promise> on serverless — a 50-instance stampede, not single-flight (O-15/S-04)",
  ];
  if (opts.json) {
    process.stdout.write(JSON.stringify({ keyCost, strategy, code, rationale }, null, 2) + "\n");
    return 0;
  }
  process.stderr.write(chalk.bold(`echo stampede — ${keyCost} → ${strategy}\n`) + rationale.map((r) => chalk.dim(`  • ${r}`)).join("\n") + "\n\n");
  process.stdout.write(code + "\n");
  return 0;
}
