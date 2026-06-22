import { defineConfig, configDefaults } from "vitest/config";

/**
 * echo test config. Tests live in `test/**` (the contract / dispatch / acceptance suites) and run against the
 * compiled `dist/**` modules where a test exercises the built artifact (the MCP server is imported from `dist/` so
 * the test proves the SHIPPED server, not just the TS source). Vitest transpiles TS test files directly via esbuild,
 * so `test/` is outside `tsconfig.json`'s `include` (which is `src/**`) on purpose — `tsc` builds the product, vitest
 * runs the tests.
 *
 * The cockpit E2E (`test/e2e/**`, Cluster G2) boots the real cockpit server + re-runs the eval pyramid, so it is the
 * explicit `pnpm test:e2e` gate and is EXCLUDED from the fast default `pnpm test` — the same separation the
 * acceptance suite uses (`pnpm test:acceptance`). `test:e2e` re-includes it via `--config` overrides on the CLI.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "test/e2e/**"],
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
