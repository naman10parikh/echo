/**
 * A2A card round-trip test (PLAN §4.7; MASTER-TODOS F3; HARNESS-OVERRIDES Part B "A2A card").
 *
 * The A2A card at `/.well-known/agent.json` advertises echo's capabilities to other agents. A card is only DONE if
 * its promise is REAL — i.e. an advertised capability actually round-trips, not vaporware (HARNESS-OVERRIDES: "✅
 * requires a behavioral receipt, not a file"). This test:
 *   1. Validates the card is valid JSON, `name === "echo"`, and advertises ≥4 capabilities.
 *   2. Asserts the card↔MCP binding holds: every capability string maps to one of echo's real MCP tools.
 *   3. Proves ONE capability round-trips end-to-end — `design-limiter` → the `echo_design_limiter` MCP tool over
 *      an in-memory JSON-RPC transport → a structured limiter design (the §4.7 "an A2A call to one capability
 *      round-trips"). We drive the SHIPPED `dist/` server, the same surface a remote A2A client would reach via
 *      the card's stdio transport.
 *
 * Scope (Karpathy Surgical): this proves the CARD's promise, not the full MCP contract (that is mcp-contract.test.ts).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
// Import the built server (proves the shipped dist artifact the A2A card's transport points at).
import { createEchoServer, ECHO_TOOL_NAMES } from "../dist/mcp-server.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const card = JSON.parse(readFileSync(join(repoRoot, ".well-known", "agent.json"), "utf8")) as {
  name: string;
  capabilities: string[];
  endpoint: string;
  transports: Array<{ type: string; transport?: string; command?: string; args?: string[] }>;
};

/**
 * The A2A capability → MCP tool binding. Every capability the card advertises must resolve to a real echo MCP
 * tool. (The card uses hyphenated capability names; the MCP tools use `echo_*` snake_case — this map is the
 * contract between the two surfaces.)
 */
const CAPABILITY_TO_TOOL: Record<string, string> = {
  "audit-state": "echo_audit_state",
  "design-limiter": "echo_design_limiter",
  "design-cache": "echo_design_cache",
  "design-idempotency": "echo_design_idempotency",
  "design-stampede": "echo_design_stampede",
  cost: "echo_cost",
  key: "echo_key",
  "recommend-store": "echo_recommend_store",
  ask: "echo_ask",
  doctor: "echo_doctor",
};

/** Connect a client to a fresh echo server over a linked in-memory transport pair (the A2A stdio surface, in-proc). */
async function connectClient(): Promise<Client> {
  const server = createEchoServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "echo-a2a-test", version: "0.0.0" }, { capabilities: {} });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

/** Parse the first text content block of a tool result back into an object. */
function parseToolResult(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const text = result.content.find((c) => c.type === "text")?.text ?? "{}";
  return JSON.parse(text);
}

describe("echo A2A card — valid + capabilities round-trip", () => {
  it("the card is valid, names echo, and advertises >=4 capabilities", () => {
    expect(card.name).toBe("echo");
    expect(Array.isArray(card.capabilities)).toBe(true);
    expect(card.capabilities.length).toBeGreaterThanOrEqual(4);
    // The card must point at a real transport (the stdio MCP server).
    expect(card.endpoint).toMatch(/mcp-server\.js/);
    const mcp = card.transports.find((t) => t.type === "mcp");
    expect(mcp?.transport).toBe("stdio");
  });

  it("every advertised capability binds to a real echo MCP tool (no vaporware)", () => {
    for (const cap of card.capabilities) {
      const tool = CAPABILITY_TO_TOOL[cap];
      expect(tool, `capability "${cap}" has no MCP tool binding`).toBeDefined();
      expect(ECHO_TOOL_NAMES, `MCP tool "${tool}" for capability "${cap}" is not exported`).toContain(tool);
    }
  });

  it("one capability round-trips end-to-end: design-limiter → a real limiter design", async () => {
    // Precondition: the card actually advertises this capability.
    expect(card.capabilities).toContain("design-limiter");
    const client = await connectClient();
    const result = parseToolResult(
      await client.callTool({
        name: CAPABILITY_TO_TOOL["design-limiter"],
        arguments: { endpointKind: "login", runtime: "node" },
      }),
    ) as { code: string; algorithm: string; failMode: string; key: string };
    // The round-trip returns a real, opinionated limiter design (not a stub).
    expect(result.algorithm).toMatch(/sliding/i);
    expect(result.failMode).toBe("closed");
    expect(result.key).toMatch(/identity/i);
    expect(result.code).toMatch(/@upstash\/ratelimit/);
  });

  it("a second capability round-trips: ask → a cited brain answer", async () => {
    expect(card.capabilities).toContain("ask");
    const client = await connectClient();
    const result = parseToolResult(
      await client.callTool({ name: CAPABILITY_TO_TOOL.ask, arguments: { question: "fail-open" } }),
    ) as { answer: string; citations: string[] };
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.citations.join(" ")).toMatch(/brain\/.*\.md#/);
  });
});
