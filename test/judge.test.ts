/**
 * The L3 judge sends a request only when it is told which model to judge with.
 *
 * The real judge calls the Anthropic Messages API, which needs a model name, and echo never picks one for you: with
 * ANTHROPIC_API_KEY alone the deterministic verdict stands and nothing leaves the machine. Imported from `dist/` to
 * test the shipped artifact, as the other suites do.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { judge } from "../dist/eval/judge.js";

const spec = {
  scenario: "S-14",
  question: "Does the answer pick a Durable Object?",
  answer: "Use a Durable Object for the limiter.",
  resolutionRegex: /Durable Object/,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the L3 judge", () => {
  it("sends nothing with a key but no ECHO_JUDGE_MODEL", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("ECHO_JUDGE_MODEL", "");
    const verdict = await judge(spec);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(verdict).toMatchObject({ passed: true, source: "deterministic" });
  });

  it("asks the model named in ECHO_JUDGE_MODEL when the key is set too", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "PASS" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("ECHO_JUDGE_MODEL", "judge-model-from-env");
    const verdict = await judge(spec);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body)).model).toBe("judge-model-from-env");
    expect(verdict).toMatchObject({ passed: true, source: "llm+deterministic" });
  });
});
