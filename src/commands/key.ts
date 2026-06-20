/**
 * `echo key <entity> <id>` — the ONE contract key builder (O-13: keys-as-contracts; S-06 prefix-drift fix).
 *
 * The #1 invalidation bug is reader and invalidator hand-building the key string on separate sides (`user:` vs
 * `users:`) → `DEL` returns 0, stale persists silently. echo's answer: there is ONE `cacheKey(entity, id)`
 * function, built once, imported by reader + invalidator + limiter. This command emits that key (and the function
 * that builds it) so every surface shares the SAME contract.
 */
import chalk from "chalk";

/** The canonical key contract. Single source — `echo key`, the limiter, the cache, and the invalidator all use it. */
export function echoKey(entity: string, id: string): string {
  const e = String(entity).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "");
  const i = String(id).trim().replace(/[^a-zA-Z0-9_:.-]+/g, "");
  return `${e}:${i}`;
}

/** Emit the key + the one-function contract source. Returns exit code. */
export function runKey(entity: string, id: string, opts: { json?: boolean } = {}): number {
  const key = echoKey(entity, id);
  if (opts.json) {
    process.stdout.write(JSON.stringify({ key, entity, id }, null, 2) + "\n");
    return 0;
  }
  process.stdout.write(chalk.bold(`echo key — ${entity}/${id}\n\n`));
  process.stdout.write(chalk.green(key) + "\n\n");
  process.stdout.write(
    chalk.dim("// The ONE key contract — import this in the reader, the invalidator, AND the limiter (O-13).\n") +
      chalk.dim("// Hand-built key strings on separate sides drift (user: vs users:) → DEL returns 0, stale persists (S-06).\n") +
      "export function cacheKey(entity: string, id: string): string {\n" +
      "  return `${entity.toLowerCase()}:${id}`;\n" +
      "}\n",
  );
  return 0;
}
