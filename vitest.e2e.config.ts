import { defineConfig } from "vitest/config";

/**
 * Cockpit E2E config (Cluster G2) — `pnpm test:e2e`. Runs ONLY `test/e2e/**` (the cockpit end-to-end: boots the real
 * `scripts/cockpit.mjs`, asserts the 4 views over HTTP, runs the CLI-flow smoke, and screenshots each view when a
 * browser is resolvable). Kept separate from `vitest.config.ts` (which excludes `test/e2e/**`) so the fast default
 * `pnpm test` stays fast; this is the explicit cockpit gate, mirroring the `test:acceptance` separation. Longer
 * timeouts: the eval re-run + Playwright screenshots take longer than a unit test.
 */
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.test.ts"],
    environment: "node",
    testTimeout: 90000,
    hookTimeout: 30000,
  },
});
