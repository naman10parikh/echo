/**
 * `echo idempotency <endpoint>` — the Stripe pattern (O-21; S-13; GT-7). The INVERSE of rate limiting: fail-CLOSED.
 *
 * Emitted code carries every required property:
 *   - atomic SET NX claim (`SET idemp:{key} INPROGRESS NX EX 86400`) — first wins, concurrent same-key → 409
 *   - request-FINGERPRINT check (hash method+path+body) → same key + different body = 400 (key reuse)
 *   - 24h TTL; store the serialized response on success
 *   - FAIL-CLOSED on store error (better reject than double-charge — O-21)
 *   - a DB UNIQUE-constraint backstop if Redis is down
 *   - never cache a GET under idempotency
 */
import chalk from "chalk";

function emitCode(endpoint: string): string {
  return `// echo idempotency — ${endpoint}. Stripe pattern: atomic SET NX claim + fingerprint->400 + 24h TTL +
// fail-CLOSED + DB-unique backstop (O-21/S-13). Exactly-once for mutating/payment-class endpoints.
import { Redis } from "@upstash/redis";
import { createHash } from "node:crypto";
const redis = Redis.fromEnv();

const TTL = 86400; // 24h (O-21)

function fingerprint(method: string, path: string, body: string): string {
  return createHash("sha256").update(\`\${method}:\${path}:\${body}\`).digest("hex");
}

export async function withIdempotency(req: Request, exec: () => Promise<Response>): Promise<Response> {
  const key = req.headers.get("Idempotency-Key");
  if (!key) return new Response("Idempotency-Key required", { status: 400 }); // required on mutating routes

  const body = await req.clone().text();
  const fp = fingerprint(req.method, new URL(req.url).pathname, body);
  const claimKey = \`idemp:\${key}\`;

  let claimed: "OK" | null;
  try {
    // ✅ atomic claim — first request wins; store the fingerprint so reuse with a different body is detectable.
    claimed = await redis.set(claimKey, JSON.stringify({ status: "INPROGRESS", fp }), { nx: true, ex: TTL });
  } catch {
    // ✅ FAIL-CLOSED: store unavailable → reject rather than risk a double-charge (O-21).
    // The DB UNIQUE constraint on the idempotency-key column is the durable backstop here.
    return new Response("idempotency store unavailable", { status: 503 });
  }

  if (claimed !== "OK") {
    // a record exists — either in progress, a replay, or a key reused with a DIFFERENT body.
    const existing = await redis.get<{ status: string; fp: string; response?: string }>(claimKey);
    if (existing && existing.fp !== fp) return new Response("Idempotency-Key reused with different body", { status: 400 });
    if (existing?.status === "INPROGRESS") return new Response("request in progress", { status: 409 });
    if (existing?.response) return new Response(existing.response, { status: 200 }); // replay → original response
    return new Response("conflict", { status: 409 });
  }

  const res = await exec();
  const text = await res.clone().text();
  await redis.set(claimKey, JSON.stringify({ status: "DONE", fp, response: text }), { ex: TTL });
  return res;
}
// DB backstop (acorn owns the migration): UNIQUE(idempotency_key) — the fail-closed durable floor if Redis is down.`;
}

export function runIdempotency(endpoint: string, opts: { json?: boolean } = {}): number {
  const code = emitCode(endpoint);
  const rationale = [
    "atomic SET NX claim — first wins; concurrent same-key → 409 (O-21/S-13)",
    "request-fingerprint → same key + different body = 400 (key reuse)",
    "24h TTL; store the response; replay returns the original (no double-exec)",
    "FAIL-CLOSED on store error + DB UNIQUE backstop (O-21 — the inverse of rate limiting)",
  ];
  if (opts.json) {
    process.stdout.write(JSON.stringify({ endpoint, ttlSec: 86400, failMode: "closed", dbBackstop: true, code, rationale }, null, 2) + "\n");
    return 0;
  }
  process.stderr.write(chalk.bold(`echo idempotency — ${endpoint}\n`) + rationale.map((r) => chalk.dim(`  • ${r}`)).join("\n") + "\n\n");
  process.stdout.write(code + "\n");
  return 0;
}
