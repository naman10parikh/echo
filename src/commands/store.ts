/**
 * `echo store --runtime <edge|node|cf>` — recommend the store for the runtime, and REFUSE CF-KV-as-counter (O-20).
 *
 * The store decision rule (TOOL-MATRIX §2): edge → Upstash Redis (HTTP, can't use TCP); long-running Node → TCP
 * Redis/Valkey + rate-limiter-flexible; Cloudflare exact-global → Durable Object; CF read-mostly → KV. The
 * load-bearing REFUSAL: Cloudflare Workers KV is eventually consistent (≤60s) + 1 write/sec/key → a limiter on KV
 * SILENTLY FAILS OPEN (S-14, O-20). echo names the refusal and reaches for a Durable Object / Upstash instead —
 * this is GT-8 (the L3 "does it refuse" judgment).
 */
import chalk from "chalk";

export interface StoreRec {
  readonly runtime: string;
  readonly store: string;
  readonly why: string;
  readonly refusals: string[];
}

export function recommendStore(runtime: string): StoreRec {
  const r = runtime.toLowerCase();
  if (r === "edge" || r === "vercel-edge") {
    return {
      runtime,
      store: "Upstash Redis (HTTP)",
      why: "edge has no raw TCP sockets → HTTP-Redis is the only path; strong single-region, scales to zero (O-01, TOOL-MATRIX §2).",
      refusals: ["never a limiter/counter on Cloudflare Workers KV — it fails open (O-20)"],
    };
  }
  if (r === "node" || r === "server") {
    return {
      runtime,
      store: "node-redis/ioredis → Redis/Valkey (TCP) + rate-limiter-flexible",
      why: "long-running Node → TCP pooling cuts the HTTP hop; rate-limiter-flexible also gives concurrency caps (P-12). Valkey is the license-clean cost default (O-23).",
      refusals: ["@upstash/ratelimit is HTTP-only — don't force it where TCP pooling matters (P-12)"],
    };
  }
  if (r === "cf" || r === "cloudflare" || r === "workers") {
    return {
      runtime,
      store: "Cloudflare Durable Object (exact global) — or Upstash Redis",
      why: "for an exact/global edge counter use a Durable Object (single logical instance, strongly consistent). REFUSE Workers KV as a counter store.",
      refusals: [
        "REFUSE Cloudflare Workers KV as a limiter/counter: eventually consistent (≤60s) + 1 write/sec/key → silently fails open (O-20, S-14)",
        "the CF `ratelimit` binding is per-PoP, not global — not an exact accounting system (P-28)",
      ],
    };
  }
  return {
    runtime,
    store: "Upstash Redis (HTTP) — the energy default",
    why: `unknown runtime "${runtime}"; defaulting to the energy serverless host. Re-run with edge|node|cf for a tuned pick.`,
    refusals: ["never a limiter on Cloudflare Workers KV (O-20)"],
  };
}

export function runStore(runtime: string, opts: { json?: boolean } = {}): number {
  const rec = recommendStore(runtime);
  if (opts.json) {
    process.stdout.write(JSON.stringify(rec, null, 2) + "\n");
    return 0;
  }
  process.stdout.write(chalk.bold(`echo store — runtime: ${runtime}\n\n`));
  process.stdout.write(`  ${chalk.green("→ " + rec.store)}\n`);
  process.stdout.write(`  ${chalk.dim(rec.why)}\n\n`);
  for (const x of rec.refusals) process.stdout.write(chalk.red("  ✗ REFUSE: ") + x + "\n");
  return 0;
}
