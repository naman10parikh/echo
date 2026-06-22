/**
 * `echo design <endpoint> [--runtime]` — the multi-step orchestrator (PLAN §3 C8; MASTER-TODOS D1).
 *
 * Thin CLI wrapper over `dispatch.runDesign`. Given an endpoint description, the dispatch router decides which
 * sub-tools apply (limiter / idempotency / cache / stampede) and in what order, then chains their emitters. This is
 * the command behind the "internal routing loop" — `design` is the only command that fans out to multiple sub-tools.
 *
 * Kept deliberately tiny (Karpathy: Surgical Changes) — all routing + emit logic lives in `dispatch.ts`, reusing the
 * exact Cluster-B emitters; this file only parses args and exits with the dispatch result.
 */
import { runDesign } from "../dispatch.js";

export function runDesignCommand(endpoint: string, opts: { runtime?: string; json?: boolean } = {}): number {
  return runDesign(endpoint, { runtime: opts.runtime, json: opts.json });
}
