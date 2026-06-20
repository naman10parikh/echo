/**
 * `echo doctor` — assert env presence at boot (P-13), before any `.limit()` is ever called.
 *
 * A missing `UPSTASH_REDIS_REST_URL`/`_TOKEN` throws at the first `.limit()`, and a `timeout` fail-open limiter can
 * then SILENTLY allow everything (P-13 + O-04). echo's discipline: assert presence at boot, fail-CLOSED on a
 * security limiter if the store can't be reached. This command reports which required vars are present WITHOUT ever
 * printing a value (the energy no-log-tokens law) and exits non-zero when any required var is missing.
 */
import chalk from "chalk";

// Tier-1 required vars for the default Upstash stack (TOOL-MATRIX §7).
const REQUIRED = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"] as const;
// Optional vars (the DB-unique idempotency backstop) — reported but not required for ✅.
const OPTIONAL = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

export interface DoctorResult {
  readonly envOK: boolean;
  readonly missing: string[];
  readonly present: string[];
  readonly optionalPresent: string[];
}

export function checkEnv(env: NodeJS.ProcessEnv = process.env): DoctorResult {
  const missing: string[] = [];
  const present: string[] = [];
  for (const k of REQUIRED) {
    if (env[k] && String(env[k]).length > 0) present.push(k);
    else missing.push(k);
  }
  const optionalPresent = OPTIONAL.filter((k) => env[k] && String(env[k]).length > 0);
  return { envOK: missing.length === 0, missing, present, optionalPresent };
}

export function runDoctor(opts: { json?: boolean } = {}): number {
  const r = checkEnv();
  if (opts.json) {
    // NB: only presence flags — never the values (no-log-tokens law).
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    return r.envOK ? 0 : 1;
  }
  process.stdout.write(chalk.bold("echo doctor — store env preflight (P-13)\n\n"));
  for (const k of r.present) process.stdout.write(chalk.green(`  ✓ ${k} set\n`));
  for (const k of r.missing) process.stdout.write(chalk.red(`  ✗ ${k} MISSING\n`));
  for (const k of r.optionalPresent) process.stdout.write(chalk.dim(`  • ${k} set (idempotency DB backstop)\n`));
  process.stdout.write("\n");
  if (!r.envOK) {
    process.stdout.write(
      chalk.red(
        "store env incomplete — assert these at boot; a security limiter must fail-CLOSED if the store is unreachable (P-13/O-04).\n",
      ),
    );
    return 1;
  }
  process.stdout.write(chalk.green("store env present — safe to construct the limiter.\n"));
  return 0;
}
