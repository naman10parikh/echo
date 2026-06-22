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
import { runBrain } from "./commands/brain.js";
import { runDesignCommand } from "./commands/design.js";
import { runAudit } from "./commands/audit.js";
import { runLimiter } from "./commands/limiter.js";
import { runCache } from "./commands/cache.js";
import { runIdempotency } from "./commands/idempotency.js";
import { runStampede } from "./commands/stampede.js";
import { runCost } from "./commands/cost.js";
import { runKey } from "./commands/key.js";
import { runStore } from "./commands/store.js";
import { runDoctor } from "./commands/doctor.js";
import { runExample } from "./commands/example.js";

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

// ── D1 (Cluster D) — the dispatch loop: route a multi-step request to the right sub-tools and chain them. ───────
program
  .command("design")
  .argument("<endpoint>", "an endpoint description, e.g. 'POST /checkout', 'login', 'GET /profile', 'llm completion'")
  .option("--runtime <r>", "edge | node | cf", "node")
  .option("--json", "emit the routing PLAN as JSON (the ordered sub-tool steps) instead of the chained code")
  .description("route a request to the right sub-tools (limiter/idempotency/cache/stampede) and chain them (C8)")
  .action((endpoint: string, opts: { runtime?: string; json?: boolean }) => {
    process.exit(runDesignCommand(endpoint, { runtime: opts.runtime, json: opts.json }));
  });

// ── B3/B4 (Cluster B) — the command cores. Each emits the required PROPERTY (the L1 golden assertions). ─────────
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
  .option("--runtime <r>", "edge | node | cf", "node")
  .option("--json", "emit JSON {code, store, algorithm, key, failMode, rationale}")
  .description("emit a correct limiter: store+algo+identity-key+atomic+concurrency-cap+fail-mode")
  .action((kind: string, opts: { runtime?: string; json?: boolean }) => {
    process.exit(runLimiter(kind, { runtime: opts.runtime, json: opts.json }));
  });

program
  .command("cache")
  .argument("<pattern>", "e.g. profile, llm, list")
  .option("--runtime <r>", "edge | node | cf", "node")
  .option("--json", "emit JSON {code, rationale}")
  .description("emit a correct cache: SWR + always-TTL+jitter + per-tenant key + invalidation")
  .action((pattern: string, opts: { runtime?: string; json?: boolean }) => {
    process.exit(runCache(pattern, { runtime: opts.runtime, json: opts.json }));
  });

program
  .command("idempotency")
  .argument("<endpoint>", "the mutating endpoint to make exactly-once")
  .option("--json", "emit JSON {code, rationale}")
  .description("emit the Stripe pattern: atomic SET NX + fingerprint->400 + 24h TTL + fail-CLOSED + DB-unique backstop")
  .action((endpoint: string, opts: { json?: boolean }) => {
    process.exit(runIdempotency(endpoint, { json: opts.json }));
  });

program
  .command("stampede")
  .argument("<key-cost>", "cheap | expensive")
  .option("--json", "emit JSON {strategy, code, rationale}")
  .description("emit the herd defense: distributed single-flight (SETNX+Lua) or SWR — never in-process Map")
  .action((keyCost: string, opts: { json?: boolean }) => {
    process.exit(runStampede(keyCost, { json: opts.json }));
  });

program
  .command("cost")
  .requiredOption("--algo <a>", "fixed | sliding | token-bucket")
  .requiredOption("--rps <n>", "requests/second", (v) => parseInt(v, 10))
  .option("--regions <n>", "read regions for Global mode", (v) => parseInt(v, 10))
  .option("--analytics", "include the +1 analytics command")
  .option("--json", "emit JSON {cmdsPerReq, monthlyUSD, breakEvenCmdsPerDay}")
  .description("commands/request x cost projection + fixed-instance break-even (O-19, S-16)")
  .action((opts: { algo: string; rps: number; regions?: number; analytics?: boolean; json?: boolean }) => {
    process.exit(runCost({ algo: opts.algo, rps: opts.rps, regions: opts.regions, analytics: opts.analytics }, { json: opts.json }));
  });

program
  .command("key")
  .argument("<entity>", "the entity, e.g. user")
  .argument("<id>", "the id")
  .option("--json", "emit JSON {key, entity, id}")
  .description("the ONE cacheKey()/limiterKey() builder — keys-as-contracts (O-13)")
  .action((entity: string, id: string, opts: { json?: boolean }) => {
    process.exit(runKey(entity, id, { json: opts.json }));
  });

program
  .command("store")
  .requiredOption("--runtime <r>", "edge | node | cf")
  .option("--json", "emit JSON {store, why, refusals}")
  .description("recommend the store for the runtime; refuses CF-KV-as-counter (O-20)")
  .action((opts: { runtime: string; json?: boolean }) => {
    process.exit(runStore(opts.runtime, { json: opts.json }));
  });

program
  .command("doctor")
  .option("--json", "emit JSON {envOK, missing, present} (presence flags only — never values)")
  .description("assert env presence (UPSTASH_REDIS_REST_URL/_TOKEN) at boot (P-13); report store reachability")
  .action((opts: { json?: boolean }) => {
    process.exit(runDoctor({ json: opts.json }));
  });

program
  .command("example")
  .requiredOption("--runtime <r>", "the runtime, e.g. edge, node, cloudflare-workers")
  .option("--json", "emit JSON {note, code}")
  .description("print the runtime-correct upstash/ratelimit-js example (lift, don't generate, O-22)")
  .action((opts: { runtime: string; json?: boolean }) => {
    process.exit(runExample(opts.runtime, { json: opts.json }));
  });

program.parseAsync(process.argv);
