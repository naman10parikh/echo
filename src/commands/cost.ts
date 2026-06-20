/**
 * `echo cost --algo <a> --rps <n> [--regions <n>] [--analytics]` — the domain-native cost model (O-19, S-16).
 *
 * "Pay-per-command is cheap" is only true if you COUNT COMMANDS. A sliding-window limiter is 4 Redis commands/
 * request, +1 analytics, and Global multiplies the WRITE side ×(1+readRegions). This command computes
 * commands/request → projected monthly $ → the fixed-instance break-even, so a designed limiter's cost is
 * observable, not guessed. The returned `cmdsPerReq` + `monthlyUSD` is also the number echo's observability layer
 * (E2) logs per design. Arithmetic matches S-16 exactly.
 */
import chalk from "chalk";

// Upstash per-command pricing (2026): $0.20 / 100K commands, reads = writes (TOOL-MATRIX §2).
const USD_PER_CMD = 0.2 / 100_000;
// A typical fixed Redis/Valkey instance flat fee (order-of-magnitude break-even anchor, S-16/O-19).
const FIXED_INSTANCE_USD_MONTH = 100;
const SECONDS_PER_MONTH = 86_400 * 30;

/** Base command count per request for each algorithm (Upstash command profiles, P-15 / TOOL-MATRIX §1). */
const BASE_CMDS: Record<string, number> = {
  fixed: 2, // EVAL, INCR — cheapest
  "fixed-window": 2,
  sliding: 4, // EVAL, GET, GET, INCR
  "sliding-window": 4,
  "token-bucket": 4, // EVAL, HMGET, HSET, PEXPIRE
  token: 4,
};

export interface CostInput {
  readonly algo: string;
  readonly rps: number;
  readonly regions?: number; // read regions → Global mode if >0
  readonly analytics?: boolean;
}

export interface CostResult {
  readonly algo: string;
  readonly cmdsPerReq: number;
  readonly rps: number;
  readonly monthlyUSD: number;
  readonly breakEvenCmdsPerDay: number;
  readonly global: boolean;
  readonly notes: string[];
}

/** Compute the cost model. Pure — reused by the CLI and (E2) the run logger. */
export function computeCost(input: CostInput): CostResult {
  const algoKey = input.algo.toLowerCase();
  const base = BASE_CMDS[algoKey] ?? 4; // default to the chatty (safe-high) profile if unknown
  const analyticsAdder = input.analytics ? 1 : 0;
  const readRegions = Math.max(0, input.regions ?? 0);
  const global = readRegions > 0;

  // Global multiplies the WRITE side ×(1+readRegions); reads are added once. We approximate the limiter as
  // write-heavy (the real-time counter): writeCmds≈base, so Global → (1+readRegions)*base + analytics (S-16).
  const cmdsPerReq = global ? (1 + readRegions) * base + analyticsAdder : base + analyticsAdder;

  const cmdsPerSecond = cmdsPerReq * input.rps;
  const monthlyUSD = cmdsPerSecond * SECONDS_PER_MONTH * USD_PER_CMD;
  // Break-even: cmds/day at which a fixed instance's flat fee equals the per-command bill.
  const breakEvenCmdsPerDay = Math.round(FIXED_INSTANCE_USD_MONTH / (USD_PER_CMD * 30));

  const notes: string[] = [];
  notes.push(`${base} base cmds/request for ${input.algo}${analyticsAdder ? " +1 analytics" : ""}.`);
  if (global) {
    notes.push(
      `Global mode ×(1+${readRegions}) on the write side — keep write-heavy limiters REGIONAL (O-19/S-16).`,
    );
  }
  if (monthlyUSD > 1000) {
    notes.push(
      `~$${Math.round(monthlyUSD).toLocaleString()}/mo — past ~${breakEvenCmdsPerDay.toLocaleString()} cmds/day a fixed instance (Redis Cloud/ElastiCache/Valkey) wins.`,
    );
  }
  if (algoKey.startsWith("sliding") || algoKey === "token" || algoKey === "token-bucket") {
    notes.push("fixed-window (2 cmds) halves the bill where a 2× boundary burst is acceptable (O-19).");
  }

  return {
    algo: input.algo,
    cmdsPerReq,
    rps: input.rps,
    monthlyUSD: Math.round(monthlyUSD * 100) / 100,
    breakEvenCmdsPerDay,
    global,
    notes,
  };
}

export function runCost(input: CostInput, opts: { json?: boolean } = {}): number {
  const r = computeCost(input);
  if (opts.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    return 0;
  }
  process.stdout.write(chalk.bold(`echo cost — ${input.algo} @ ${input.rps} req/s${r.global ? " (Global)" : ""}\n\n`));
  process.stdout.write(`  commands/request : ${chalk.cyan(String(r.cmdsPerReq))} cmd\n`);
  process.stdout.write(`  projected monthly: ${chalk.cyan("$" + r.monthlyUSD.toLocaleString())}\n`);
  process.stdout.write(`  break-even (fixed): ${chalk.dim(r.breakEvenCmdsPerDay.toLocaleString() + " cmds/day")}\n\n`);
  for (const n of r.notes) process.stdout.write(chalk.dim("  • " + n + "\n"));
  return 0;
}
