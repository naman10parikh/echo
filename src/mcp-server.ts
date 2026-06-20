#!/usr/bin/env node
/**
 * echo MCP server — the agent-callable form of Jobs 1–8 (PLAN §4.2, §3 C7; HARNESS-OVERRIDES §7).
 *
 * This is echo's OWN MCP server (NOT the inherited github/context7/memory/obsidian template). It exposes the
 * rate-limit/cache vertical's tools over stdio so any MCP client (Claude Code, the energy hub, a sibling employee)
 * can call them. Every tool REUSES the Cluster-B command logic — the pure functions in `commands/*` and
 * `brain-index` — so the CLI, the MCP, and the cockpit all agree (one rule, one place; O-13 applied to our code).
 *
 * Transport: stdio (the default for a local MCP server). A documented hosted-OAuth shape (Stripe standard) is the
 * production path (see `## Dual-mode` in the README / SANDBOX.md) — not wired here, no live keys ever touch this file.
 *
 * Why the LOW-LEVEL `Server` + `setRequestHandler` (not the high-level `McpServer`): the low-level path lets us
 * declare each tool's `inputSchema` as plain JSON Schema (no extra `zod` runtime dependency) and gives full control
 * over the `tools/list` + `tools/call` JSON-RPC contract the §9 contract test asserts. (Karpathy: Simplicity First —
 * minimum surface that satisfies the contract.)
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import { runLimiter } from "./commands/limiter.js";
import { runCache } from "./commands/cache.js";
import { runIdempotency } from "./commands/idempotency.js";
import { runStampede } from "./commands/stampede.js";
import { computeCost } from "./commands/cost.js";
import { echoKey } from "./commands/key.js";
import { recommendStore } from "./commands/store.js";
import { checkEnv } from "./commands/doctor.js";
import { runAudit } from "./commands/audit.js";
import { askBrain } from "./brain-index.js";

/**
 * A tool definition: name + description + JSON-Schema input + a handler that returns a structured payload.
 * The handler returns a plain object; we JSON-stringify it into a text content block (the MCP tool-result shape),
 * which is what the contract test round-trips.
 */
interface EchoTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties: Record<string, unknown>;
    readonly required?: readonly string[];
  };
  readonly handler: (args: Record<string, unknown>) => unknown;
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown): boolean => v === true;

/**
 * The 10 echo tools — the agent-callable form of the CLI command tree (PLAN §4.2). Each reuses a Cluster-B pure
 * function; the MCP layer is a thin adapter (it does not re-derive any judgment).
 */
const TOOLS: EchoTool[] = [
  {
    name: "echo_audit_state",
    description:
      "Scan a path for the new Map() anti-pattern: a source-of-truth Map on serverless is a BUG (P-01); " +
      "ephemeralCache: new Map() is OK (P-02). The turbo seam echo owns. Returns { bugs, okMaps }.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "file or directory to scan (e.g. app/api/)" } },
      required: ["path"],
    },
    handler: (args) => {
      // Reuse the EXACT `echo audit` detector + file-walk (one rule, one place — O-13). The CLI's JSON path emits
      // `{ bugs, okMaps, filesScanned }`; we capture and return it so the MCP and CLI verdicts are byte-identical.
      const res = captureJson(() => runAudit(str(args.path), { json: true })) as {
        bugs?: unknown[];
        okMaps?: unknown[];
      };
      const bugs = Array.isArray(res.bugs) ? res.bugs : [];
      return { path: str(args.path), bugs, okMaps: Array.isArray(res.okMaps) ? res.okMaps : [], bugCount: bugs.length };
    },
  },
  {
    name: "echo_design_limiter",
    description:
      "Emit a bypass-proof rate limiter: store + algorithm + identity-key + atomic + concurrency-cap + fail-mode " +
      "(O-03..O-09). e.g. login → sliding-window, identity-keyed, fail-CLOSED. Returns { code, store, algorithm, key, failMode, rationale }.",
    inputSchema: {
      type: "object",
      properties: {
        endpointKind: { type: "string", description: "e.g. login, api, public, payment" },
        runtime: { type: "string", description: "edge | node | cf", enum: ["edge", "node", "cf"] },
      },
      required: ["endpointKind"],
    },
    handler: (args) => captureJson(() => runLimiter(str(args.endpointKind), { runtime: str(args.runtime, "node"), json: true })),
  },
  {
    name: "echo_design_cache",
    description:
      "Emit a correct cache: stale-while-revalidate + always-TTL+jitter + per-tenant key + delete-don't-update " +
      "invalidation (O-10..O-14). pattern 'llm' version-keys on model+prompt-template+RAG-corpus. Returns { code, rationale }.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "e.g. profile, list, llm" },
        runtime: { type: "string", description: "edge | node | cf", enum: ["edge", "node", "cf"] },
      },
      required: ["pattern"],
    },
    handler: (args) => captureJson(() => runCache(str(args.pattern), { runtime: str(args.runtime, "node"), json: true })),
  },
  {
    name: "echo_design_idempotency",
    description:
      "Emit the Stripe idempotency pattern: atomic SET NX claim + fingerprint→400 + 24h TTL + fail-CLOSED + " +
      "DB-unique backstop (O-21). Returns { code, ttlSec, failMode, dbBackstop, rationale }.",
    inputSchema: {
      type: "object",
      properties: { endpoint: { type: "string", description: "the mutating endpoint to make exactly-once" } },
      required: ["endpoint"],
    },
    handler: (args) => captureJson(() => runIdempotency(str(args.endpoint), { json: true })),
  },
  {
    name: "echo_design_stampede",
    description:
      "Emit the right herd defense: distributed single-flight (SETNX+UUID-Lua) for an expensive fill, or SWR for a " +
      "cheap one — NEVER an in-process Map on serverless (O-15). Returns { strategy, code, rationale }.",
    inputSchema: {
      type: "object",
      properties: { keyCost: { type: "string", description: "cheap | expensive", enum: ["cheap", "expensive"] } },
      required: ["keyCost"],
    },
    handler: (args) => captureJson(() => runStampede(str(args.keyCost, "expensive"), { json: true })),
  },
  {
    name: "echo_cost",
    description:
      "Cost a limiter: commands/request × monthly projection + fixed-instance break-even (O-19/S-16). sliding=4 cmds, " +
      "+1 analytics, Global ×(1+readRegions). Returns { cmdsPerReq, monthlyUSD, breakEvenCmdsPerDay, global, notes }.",
    inputSchema: {
      type: "object",
      properties: {
        algorithm: { type: "string", description: "fixed | sliding | token-bucket" },
        rps: { type: "number", description: "requests per second" },
        regions: { type: "number", description: "read regions (Global mode if >0)" },
        analytics: { type: "boolean", description: "include the +1 analytics command" },
      },
      required: ["algorithm", "rps"],
    },
    handler: (args) =>
      computeCost({ algo: str(args.algorithm), rps: num(args.rps), regions: num(args.regions, 0), analytics: bool(args.analytics) }),
  },
  {
    name: "echo_key",
    description:
      "Build the ONE contract key (keys-as-contracts, O-13) — the same key the reader, invalidator, and limiter " +
      "must all import. Returns { key, entity, id }.",
    inputSchema: {
      type: "object",
      properties: {
        entity: { type: "string", description: "the entity, e.g. user" },
        id: { type: "string", description: "the id" },
      },
      required: ["entity", "id"],
    },
    handler: (args) => ({ key: echoKey(str(args.entity), str(args.id)), entity: str(args.entity), id: str(args.id) }),
  },
  {
    name: "echo_recommend_store",
    description:
      "Recommend the store for a runtime and name the refusals — REFUSES Cloudflare Workers KV as a counter " +
      "(it fails open, O-20). Returns { runtime, store, why, refusals }.",
    inputSchema: {
      type: "object",
      properties: { runtime: { type: "string", description: "edge | node | cf" } },
      required: ["runtime"],
    },
    handler: (args) => recommendStore(str(args.runtime)),
  },
  {
    name: "echo_ask",
    description:
      "Ask echo's expertise brain (BM25 over brain/) — returns a cited answer with brain citations " +
      "(e.g. brain/OPINIONS.md#O-04). echo does not invent; if nothing matches it says so. Returns { answer, citations }.",
    inputSchema: {
      type: "object",
      properties: { question: { type: "string", description: "natural-language question about rate-limiting/caching" } },
      required: ["question"],
    },
    handler: (args) => askBrain(str(args.question)),
  },
  {
    name: "echo_doctor",
    description:
      "Assert store env presence (UPSTASH_REDIS_REST_URL/_TOKEN) BEFORE any .limit() (P-13). Reports presence flags " +
      "only — NEVER a token value (no-log-tokens law). Returns { envOK, missing, present, optionalPresent }.",
    inputSchema: { type: "object", properties: {} },
    handler: () => checkEnv(),
  },
];

/**
 * Run a CLI command's JSON path while capturing its stdout (the command writes JSON to stdout when `json: true`),
 * and parse it back into an object. This lets the MCP reuse the EXACT emitter the CLI uses — the emitted code and
 * rationale are identical across surfaces. stderr (the human rationale banner) is suppressed for the MCP path.
 */
function captureJson(run: () => number): unknown {
  const chunks: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  // Narrow override for capture (restored in finally). The real signature has overloads; we only need the
  // single-arg form the commands use, so cast through `unknown` to the field type.
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as unknown as typeof process.stdout.write;
  try {
    run();
  } finally {
    process.stdout.write = origWrite;
  }
  const out = chunks.join("");
  try {
    return JSON.parse(out);
  } catch {
    return { raw: out };
  }
}

/** Build the echo MCP server (exported for the contract test, which drives it in-process over an in-memory pair). */
export function createEchoServer(): Server {
  const server = new Server(
    { name: "echo", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `unknown tool: ${req.params.name}` }],
        isError: true,
      };
    }
    try {
      const result = tool.handler((req.params.arguments ?? {}) as Record<string, unknown>);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      // Never leak a secret; surface a bounded error string (the energy Result / no-silent-failure law).
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `echo tool error (${tool.name}): ${msg}` }], isError: true };
    }
  });

  return server;
}

/** The exported tool list (names + schemas), reused by the contract test + the cockpit / llms.txt generators. */
export const ECHO_TOOL_NAMES = TOOLS.map((t) => t.name);

/** stdio entrypoint (the default). Only runs when invoked directly, not when imported by the contract test. */
async function main(): Promise<void> {
  const server = createEchoServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // The server now reads JSON-RPC from stdin and writes to stdout; it stays alive until the transport closes.
}

// Run as a stdio server only when executed directly (`node dist/mcp-server.js`), never on import.
const invokedDirectly =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("mcp-server.js") || process.argv[1].endsWith("mcp-server.ts"));
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`echo MCP server failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
