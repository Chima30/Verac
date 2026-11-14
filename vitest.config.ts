import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "services/**/*.test.ts", "apps/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/*.live.test.ts"],
    environment: "node",
    // Four test files each boot an in-memory Postgres (PGlite) and apply every migration. Run in parallel on a busy machine
    // that can exceed the 10 s default hook timeout, which made the whole suite fail intermittently.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
