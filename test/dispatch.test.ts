/**
 * Dispatch routing test (PLAN §3 C8; MASTER-TODOS D1).
 *
 * Asserts that the internal routing loop (`planDesign`) assigns the CORRECT sub-tool(s) for a multi-step
 * `echo design <endpoint>` request — the C8 "internal routing loop tested (multi-step design assigns the right
 * sub-tool)" receipt. We test the PURE planner so the routing decision is asserted directly (no stdout capture),
 * and import it from `dist/` to prove the SHIPPED artifact (the convention the contract test established).
 *
 * The opinions under test (from brain/OPINIONS.md):
 *   - admission-first (O-17): the limiter is step 1 when present.
 *   - O-21: a mutating/payment-class endpoint gets idempotency (the inverse of rate limiting, fail-CLOSED).
 *   - O-10..O-14: a hot read path gets a cache; an LLM read version-keys (O-14).
 *   - O-15/O-16: an expensive origin gets the herd defense.
 *   - never zero defenses: an unclassifiable endpoint still gets a limiter.
 */
import { describe, it, expect } from "vitest";
import { planDesign, runDesign } from "../dist/dispatch.js";
import type { DispatchPlan, SubTool } from "../dist/dispatch.js";

/** Helper: the ordered list of sub-tool names a plan routes to. */
const tools = (p: DispatchPlan): SubTool[] => p.steps.map((s) => s.tool);

describe("dispatch routing — planDesign", () => {
  it("routes a payment checkout to limiter + idempotency (admission-first, then exactly-once)", () => {
    const plan = planDesign("POST /checkout");
    const order = tools(plan);
    // Multi-step: a payment endpoint needs BOTH a limiter AND idempotency (the core C8 multi-step assertion).
    expect(order).toContain("limiter");
    expect(order).toContain("idempotency");
    // admission-first (O-17): the limiter runs before idempotency claims/executes.
    expect(order.indexOf("limiter")).toBeLessThan(order.indexOf("idempotency"));
  });

  it("routes a login endpoint to a limiter (security, fail-CLOSED)", () => {
    const plan = planDesign("login");
    expect(tools(plan)).toContain("limiter");
    // a pure auth check is not a cacheable read and not a mutating write → limiter only.
    expect(tools(plan)).not.toContain("cache");
  });

  it("routes a read profile to a cache, not a limiter+idempotency", () => {
    const plan = planDesign("GET /profile");
    expect(tools(plan)).toContain("cache");
    expect(tools(plan)).not.toContain("idempotency");
  });

  it("routes an LLM completion to cache (version-keyed) + stampede (expensive fill)", () => {
    const plan = planDesign("llm completion endpoint");
    const order = tools(plan);
    expect(order).toContain("cache");
    expect(order).toContain("stampede");
    // O-14: the LLM cache step is version-keyed — the planner passes the `llm` pattern, not the raw endpoint.
    const cacheStep = plan.steps.find((s) => s.tool === "cache");
    expect(cacheStep?.arg).toBe("llm");
  });

  it("never returns zero defenses — an unclassifiable endpoint still gets a limiter", () => {
    const plan = planDesign("xyzzy");
    expect(plan.steps.length).toBeGreaterThanOrEqual(1);
    expect(tools(plan)).toContain("limiter");
  });

  it("every step carries a brain-anchored reason (the routing is opinionated, not a bag of tools)", () => {
    const plan = planDesign("POST /orders");
    for (const step of plan.steps) {
      expect(step.reason).toMatch(/O-\d|S-\d/); // each routing decision cites a brain opinion/scenario
    }
  });
});

describe("dispatch execution — runDesign", () => {
  it("runs a multi-step design end-to-end and returns a clean exit code", () => {
    // Capture stdout so the chained emitters don't spam the test reporter; assert the code chained successfully.
    const chunks: string[] = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((c: string | Uint8Array): boolean => {
      chunks.push(typeof c === "string" ? c : Buffer.from(c).toString("utf8"));
      return true;
    }) as unknown as typeof process.stdout.write;
    process.stderr.write = (() => true) as unknown as typeof process.stderr.write;
    let rc: number;
    try {
      rc = runDesign("POST /checkout", { json: true });
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
    expect(rc).toBe(0);
    // The JSON path emits the routing plan; it must include both routed tools.
    const out = chunks.join("");
    expect(out).toContain("limiter");
    expect(out).toContain("idempotency");
  });
});
