#!/usr/bin/env node
/**
 * echo CLI — the rate-limit/cache employee's hands.
 *
 * COORDINATION NOTE (CP123 Wave-B): this file was scaffolded by the Cluster-A builder to land the `brain` command
 * (the queryable memory layer, item A6) with a buildable CLI floor. The Cluster-B builder (item B2/B3/B4) OWNS the
 * full command tree and fills the stub bodies below (audit, limiter, cache, idempotency, stampede, cost, key, store,
 * doctor, example) — replace each `stub(...)` with the real `src/commands/<cmd>.ts` implementation. Do NOT remove
 * the `brain` wiring (A6). Keep `commander` + `chalk` (npm-package-conventions).
 */
import { Command } from "commander";
import chalk from "chalk";
import { runBrain } from "./commands/brain.js";
import { runAudit } from "./commands/audit.js";

const program = new Command();

program
  .name("echo")
  .description("Rate-limiting / caching domain-expert employee — correct, tested, costed limiters & caches.")
  .version("0.1.0");

// ── A6 (Cluster A) — the queryable memory layer (REAL). Do not stub. ───────────────────────────────────────────
program
  .command("brain")
  .argument("<question>", "natural-language question to ask echo's expertise brain (BM25 over brain/)")
  .option("-l, --limit <n>", "max hits", (v) => parseInt(v, 10), 5)
  .option("--json", "emit JSON instead of the human table")
  .description("BM25 query over brain/ — the queryable memory layer (cited OPINIONS/PITFALLS/SCENARIOS rows)")
  .action((question: string, opts: { limit: number; json?: boolean }) => {
    process.exit(runBrain(question, { limit: opts.limit, json: opts.json }));
  });

// ── B2/B3/B4 (Cluster B) — OWNED BY THE CLUSTER-B BUILDER. Stubs below; fill with src/commands/<cmd>.ts. ────────
function stub(name: string): void {
  process.stdout.write(
    chalk.yellow(`echo ${name}: not yet implemented`) +
      chalk.dim(" (Cluster B — see MASTER-TODOS B3/B4)\n"),
  );
}

program
  .command("audit")
  .argument("<path>", "path to scan for the new Map() anti-pattern (P-01) vs ephemeralCache (P-02)")
  .option("--json", "emit JSON instead of the human report")
  .description("scan app/api/** for a source-of-truth Map (BUG, exit!=0) vs ephemeralCache Map (OK) — the turbo seam")
  .action((path: string, opts: { json?: boolean }) => {
    process.exit(runAudit(path, { json: opts.json }));
  });

program
  .command("limiter")
  .argument("<endpoint-kind>", "e.g. login, api, public")
  .option("--runtime <r>", "edge | node | cf")
  .description("emit a correct limiter: store+algo+identity-key+atomic+concurrency-cap+fail-mode")
  .action(() => stub("limiter"));

program
  .command("cache")
  .argument("<pattern>", "e.g. profile, llm, list")
  .option("--runtime <r>", "edge | node | cf")
  .description("emit a correct cache: SWR + always-TTL+jitter + per-tenant key + invalidation")
  .action(() => stub("cache"));

program
  .command("idempotency")
  .argument("<endpoint>", "the mutating endpoint to make exactly-once")
  .description("emit the Stripe pattern: atomic SET NX + fingerprint->400 + 24h TTL + fail-CLOSED + DB-unique backstop")
  .action(() => stub("idempotency"));

program
  .command("stampede")
  .argument("<key-cost>", "cheap | expensive")
  .description("emit the herd defense: distributed single-flight (SETNX+Lua) or SWR — never in-process Map")
  .action(() => stub("stampede"));

program
  .command("cost")
  .requiredOption("--algo <a>", "fixed | sliding | token-bucket")
  .requiredOption("--rps <n>", "requests/second", (v) => parseInt(v, 10))
  .option("--regions <n>", "read regions for Global mode", (v) => parseInt(v, 10))
  .option("--analytics", "include the +1 analytics command")
  .description("commands/request x cost projection + fixed-instance break-even (O-19, S-16)")
  .action(() => stub("cost"));

program
  .command("key")
  .argument("<entity>", "the entity, e.g. user")
  .argument("<id>", "the id")
  .description("the ONE cacheKey()/limiterKey() builder — keys-as-contracts (O-13)")
  .action(() => stub("key"));

program
  .command("store")
  .requiredOption("--runtime <r>", "edge | node | cf")
  .description("recommend the store for the runtime; refuses CF-KV-as-counter (O-20)")
  .action(() => stub("store"));

program
  .command("doctor")
  .description("assert env presence (UPSTASH_REDIS_REST_URL/_TOKEN) at boot (P-13); report store reachability")
  .action(() => stub("doctor"));

program
  .command("example")
  .requiredOption("--runtime <r>", "the runtime, e.g. edge, node, cloudflare-workers")
  .description("print the runtime-correct upstash/ratelimit-js example (lift, don't generate, O-22)")
  .action(() => stub("example"));

program.parseAsync(process.argv);
