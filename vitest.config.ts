import { defineConfig } from "vitest/config";

/**
 * echo test config. Tests live in `test/**` (the contract / dispatch / acceptance suites) and run against the
 * compiled `dist/**` modules where a test exercises the built artifact (the MCP server is imported from `dist/` so
 * the test proves the SHIPPED server, not just the TS source). Vitest transpiles TS test files directly via esbuild,
 * so `test/` is outside `tsconfig.json`'s `include` (which is `src/**`) on purpose — `tsc` builds the product, vitest
 * runs the tests.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
