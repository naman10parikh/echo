/**
 * `echo brain "<question>"` — BM25 query over the expertise brain (the queryable memory layer, C2).
 *
 * Standalone + importable: the CLI registers it, and the MCP `echo_ask` tool reuses `askBrain` from brain-index.
 * Prints the cited brain rows (FILE#ANCHOR) so a coding agent gets a POINT OF VIEW with receipts, not a paraphrase.
 */
import chalk from "chalk";
import { searchBrain } from "../brain-index.js";

export interface BrainCmdOptions {
  /** Max hits to print (default 5). */
  readonly limit?: number;
  /** Emit machine-readable JSON instead of the human table (for the cockpit / MCP path). */
  readonly json?: boolean;
}

/** Run the brain query. Returns the process exit code (0 = hit, 1 = no match). */
export function runBrain(query: string, opts: BrainCmdOptions = {}): number {
  const limit = opts.limit ?? 5;
  const hits = searchBrain(query, limit);

  if (opts.json) {
    process.stdout.write(JSON.stringify({ query, hits }, null, 2) + "\n");
    return hits.length > 0 ? 0 : 1;
  }

  if (hits.length === 0) {
    process.stdout.write(
      chalk.yellow(`No brain row matches "${query}".`) +
        " echo does not invent — try a known anchor (O-04 / P-01 / S-02) or rephrase.\n",
    );
    return 1;
  }

  process.stdout.write(chalk.bold(`echo brain — "${query}"\n\n`));
  for (const h of hits) {
    process.stdout.write(
      `${chalk.cyan(h.citation)}  ${chalk.dim(`(score ${h.score})`)}\n` +
        `  ${h.title.replace(/^#+\s*/, "")}\n` +
        `  ${chalk.dim(h.snippet)}\n\n`,
    );
  }
  return 0;
}
