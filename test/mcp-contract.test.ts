/**
 * MCP contract test (PLAN §9 Contract row; MASTER-TODOS C1).
 *
 * Drives echo's OWN MCP server in-process over an in-memory transport pair and asserts:
 *   1. `tools/list` returns exactly echo's 10 vertical tools (NOT the 4-stub github/context7/memory/obsidian template).
 *   2. Each tool round-trips: a valid `tools/call` returns a text content block whose JSON payload matches the tool's
 *      contract (the §4.2 return shapes) — proving the MCP reuses the real Cluster-B command logic, not a stub.
 *
 * This is a BEHAVIORAL receipt (HARNESS-OVERRIDES §7): the server actually answers JSON-RPC, and each tool actually
 * produces its expected property (e.g. echo_design_limiter emits sliding-window fail-CLOSED; echo_recommend_store
 * refuses CF-KV; echo_ask cites a brain row). We import the server from `dist/` so we test the SHIPPED artifact.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
// Import the built server (proves the shipped dist artifact, per the §9 "test the artifact" convention).
import { createEchoServer, ECHO_TOOL_NAMES } from "../dist/mcp-server.js";

const EXPECTED_TOOLS = [
  "echo_audit_state",
  "echo_design_limiter",
  "echo_design_cache",
  "echo_design_idempotency",
  "echo_design_stampede",
  "echo_cost",
  "echo_key",
  "echo_recommend_store",
  "echo_ask",
  "echo_doctor",
];

/** Connect a client to a fresh echo server over a linked in-memory transport pair. */
async function connectClient(): Promise<Client> {
  const server = createEchoServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "echo-contract-test", version: "0.0.0" }, { capabilities: {} });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

/** Parse the first text content block of a tool result back into an object. */
function parseToolResult(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const text = result.content.find((c) => c.type === "text")?.text ?? "{}";
  return JSON.parse(text);
}

describe("echo MCP server — contract", () => {
  let client: Client;
  beforeAll(async () => {
    client = await connectClient();
  });

  it("tools/list returns echo's own 10 vertical tools (not the 4-stub template)", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());
    // The exported list matches what the server advertises (used by llms.txt / cockpit generators).
    expect([...ECHO_TOOL_NAMES].sort()).toEqual([...EXPECTED_TOOLS].sort());
    // Each tool has an object inputSchema (the JSON-RPC contract).
    for (const t of tools) {
      expect(t.inputSchema).toBeDefined();
      expect((t.inputSchema as { type?: string }).type).toBe("object");
      expect(typeof t.description).toBe("string");
    }
  });

  it("echo_audit_state → flags a source-of-truth Map bug, passes ephemeralCache", async () => {
    const bad = parseToolResult(
      await client.callTool({ name: "echo_audit_state", arguments: { path: "eval/fixtures/bad-map-counter/" } }),
    ) as { bugCount: number; bugs: unknown[] };
    expect(bad.bugCount).toBeGreaterThan(0);

    const ok = parseToolResult(
      await client.callTool({ name: "echo_audit_state", arguments: { path: "eval/fixtures/ok-ephemeral-cache/" } }),
    ) as { bugCount: number; okMaps: unknown[] };
    expect(ok.bugCount).toBe(0);
    expect(ok.okMaps.length).toBeGreaterThan(0);
  });

  it("echo_design_limiter → sliding-window, identity-keyed, fail-CLOSED for login", async () => {
    const r = parseToolResult(
      await client.callTool({ name: "echo_design_limiter", arguments: { endpointKind: "login", runtime: "node" } }),
    ) as { code: string; algorithm: string; failMode: string; key: string };
    expect(r.algorithm).toMatch(/sliding/i);
    expect(r.failMode).toBe("closed");
    expect(r.key).toMatch(/identity/i);
    expect(r.code).toMatch(/@upstash\/ratelimit/);
    // The code must NOT key on a spoofable header (O-03/S-02).
    expect(r.code).not.toMatch(/x-forwarded-for.*key|key.*x-forwarded-for/i);
  });

  it("echo_design_cache → SWR + always-TTL+jitter; llm version-keys", async () => {
    const r = parseToolResult(
      await client.callTool({ name: "echo_design_cache", arguments: { pattern: "profile" } }),
    ) as { code: string };
    expect(r.code).toMatch(/jitter/i);
    expect(r.code).toMatch(/SWR|stale-while-revalidate|revalidate/i);

    const llm = parseToolResult(
      await client.callTool({ name: "echo_design_cache", arguments: { pattern: "llm" } }),
    ) as { code: string };
    expect(llm.code).toMatch(/modelVersion|model.*version/i);
    expect(llm.code).toMatch(/ragCorpus|rag-corpus|RAG/i);
  });

  it("echo_design_idempotency → fail-CLOSED + 24h TTL + DB backstop", async () => {
    const r = parseToolResult(
      await client.callTool({ name: "echo_design_idempotency", arguments: { endpoint: "POST /charge" } }),
    ) as { ttlSec: number; failMode: string; dbBackstop: boolean; code: string };
    expect(r.ttlSec).toBe(86400);
    expect(r.failMode).toBe("closed");
    expect(r.dbBackstop).toBe(true);
    expect(r.code).toMatch(/nx:\s*true|SET NX|nx: true/i);
  });

  it("echo_design_stampede → distributed single-flight for an expensive fill (never in-process Map)", async () => {
    const r = parseToolResult(
      await client.callTool({ name: "echo_design_stampede", arguments: { keyCost: "expensive" } }),
    ) as { strategy: string; code: string };
    expect(r.strategy).toBe("distributed-single-flight");
    expect(r.code).toMatch(/NX|SETNX|nx:\s*true/i);
    expect(r.code).toMatch(/NEVER.*Map|never.*in-process/i);
  });

  it("echo_cost → sliding=4 cmds/req, Global multiplies the write side", async () => {
    const regional = parseToolResult(
      await client.callTool({ name: "echo_cost", arguments: { algorithm: "sliding", rps: 1000 } }),
    ) as { cmdsPerReq: number; monthlyUSD: number; global: boolean };
    expect(regional.cmdsPerReq).toBe(4);
    expect(regional.global).toBe(false);
    expect(regional.monthlyUSD).toBeGreaterThan(0);

    const global = parseToolResult(
      await client.callTool({ name: "echo_cost", arguments: { algorithm: "sliding", rps: 1000, regions: 2, analytics: true } }),
    ) as { cmdsPerReq: number; global: boolean };
    // (1+2)*4 + 1 analytics = 13
    expect(global.cmdsPerReq).toBe(13);
    expect(global.global).toBe(true);
  });

  it("echo_key → builds the one contract key", async () => {
    const r = parseToolResult(
      await client.callTool({ name: "echo_key", arguments: { entity: "User", id: "123" } }),
    ) as { key: string };
    expect(r.key).toBe("user:123");
  });

  it("echo_recommend_store → REFUSES Cloudflare Workers KV as a counter (O-20)", async () => {
    const r = parseToolResult(
      await client.callTool({ name: "echo_recommend_store", arguments: { runtime: "cf" } }),
    ) as { store: string; refusals: string[] };
    expect(r.refusals.join(" ")).toMatch(/KV/i);
    expect(r.store).toMatch(/Durable Object|Upstash/i);
  });

  it("echo_ask → returns a cited brain answer (BM25 over brain/)", async () => {
    const r = parseToolResult(
      await client.callTool({ name: "echo_ask", arguments: { question: "fail-open" } }),
    ) as { answer: string; citations: string[] };
    expect(r.citations.length).toBeGreaterThan(0);
    expect(r.citations.join(" ")).toMatch(/brain\/.*\.md#/);
    // The fail-open question should surface the fail-open/closed opinion (O-04).
    expect(`${r.answer} ${r.citations.join(" ")}`).toMatch(/O-04|fail-open|fail-closed/i);
  });

  it("echo_doctor → reports env presence flags only, never a value", async () => {
    const r = parseToolResult(await client.callTool({ name: "echo_doctor", arguments: {} })) as {
      envOK: boolean;
      missing: string[];
      present: string[];
    };
    expect(typeof r.envOK).toBe("boolean");
    expect(Array.isArray(r.missing)).toBe(true);
    expect(Array.isArray(r.present)).toBe(true);
    // The result must be presence flags, never a token value.
    expect(JSON.stringify(r)).not.toMatch(/UPSTASH_REDIS_REST_TOKEN["']?\s*:\s*["'][A-Za-z0-9]/);
  });

  it("unknown tool → graceful isError, not a crash", async () => {
    const result = await client.callTool({ name: "echo_nonexistent", arguments: {} });
    expect(result.isError).toBe(true);
  });
});
